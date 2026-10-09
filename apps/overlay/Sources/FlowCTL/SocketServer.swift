import Darwin
import FlowCTLCore
import Foundation

/// HTTP on a Unix domain socket, one request per connection: what the mod's
/// `$.http.fetch(url, { socketPath })` and `curl --unix-socket` speak.
final class SocketServer {
    private let path: String
    private let handler: (HTTPRequest) -> HTTPResponse
    private let queue = DispatchQueue(label: "dev.flowctl.overlay.socket", attributes: .concurrent)
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?

    init(path: String, handler: @escaping (HTTPRequest) -> HTTPResponse) {
        self.path = path
        self.handler = handler
    }

    /// Binds the socket, replacing a stale one. Call `isServing` first: this
    /// unlinks whatever is at `path`.
    func start() throws {
        unlink(path)
        listenFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listenFD >= 0 else { throw OverlayError.posix("socket") }

        var addr = try Self.address(path)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listenFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { throw OverlayError.posix("bind \(path)") }
        chmod(path, 0o600)
        guard listen(listenFD, 16) == 0 else { throw OverlayError.posix("listen") }

        let source = DispatchSource.makeReadSource(fileDescriptor: listenFD, queue: queue)
        source.setEventHandler { [weak self] in self?.acceptOne() }
        source.resume()
        acceptSource = source
        log("listening on \(path)")
    }

    func stop() {
        acceptSource?.cancel()
        if listenFD >= 0 { close(listenFD) }
        unlink(path)
    }

    /// Whether another overlay answers `GET /health` on `path` (single instance).
    static func isServing(at path: String) -> Bool {
        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        guard var addr = try? address(path) else { return false }
        var timeout = timeval(tv_sec: 1, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var noSigPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        let connected = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connected == 0 else { return false }
        let request = Array("GET /health HTTP/1.1\r\nHost: overlay\r\n\r\n".utf8)
        guard write(fd, request, request.count) == request.count else { return false }
        var reply = [UInt8](repeating: 0, count: 64)
        let n = read(fd, &reply, reply.count)
        return n > 0 && String(decoding: reply[0..<n], as: UTF8.self).hasPrefix("HTTP/1.1 200")
    }

    private static func address(_ path: String) throws -> sockaddr_un {
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard path.utf8.count < capacity else { throw OverlayError.message("socket path longer than \(capacity - 1) bytes") }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: path.utf8)
            raw[path.utf8.count] = 0
        }
        return addr
    }

    private func acceptOne() {
        let fd = accept(listenFD, nil, nil)
        guard fd >= 0 else { return }
        var noSigPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        queue.async { [weak self] in self?.serve(fd) }
    }

    private func serve(_ fd: Int32) {
        defer { close(fd) }
        var parser = HTTPRequestParser()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        var response = HTTPResponse.badRequest("incomplete request")
        reading: while true {
            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { break }
            switch parser.feed(Data(chunk[0..<n])) {
            case .needMore: continue
            case .failed(let failure): response = failure; break reading
            case .complete(let request): response = handler(request); break reading
            }
        }
        let bytes = response.serialized()
        bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let written = write(fd, raw.baseAddress! + offset, raw.count - offset)
                if written <= 0 { return }
                offset += written
            }
        }
    }
}

enum OverlayError: Error, CustomStringConvertible {
    case posix(String)
    case message(String)

    var description: String {
        switch self {
        case .posix(let what): return "\(what): \(String(cString: strerror(errno)))"
        case .message(let text): return text
        }
    }
}

func log(_ message: String) {
    let stamp = ISO8601DateFormatter.string(from: Date(), timeZone: .current, formatOptions: [.withInternetDateTime, .withFractionalSeconds])
    FileHandle.standardError.write(Data("[\(stamp)] \(message)\n".utf8))
}
