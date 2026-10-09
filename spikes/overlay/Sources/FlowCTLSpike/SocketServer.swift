import Darwin
import Foundation

struct HTTPRequest {
    let method: String
    let path: String
    let body: Data
    /// When the last byte of the request was read (nowMs()).
    let receivedAt: Double
}

struct HTTPResponse: Error {
    let status: Int
    let reason: String
    let body: String

    static func ok(_ body: String = "ok\n") -> HTTPResponse { .init(status: 200, reason: "OK", body: body) }
    static func badRequest(_ body: String) -> HTTPResponse { .init(status: 400, reason: "Bad Request", body: body) }
    static let notFound = HTTPResponse(status: 404, reason: "Not Found", body: "not found\n")
    static let tooLarge = HTTPResponse(status: 413, reason: "Payload Too Large", body: "too large\n")
}

/// Minimal HTTP/1.1 server on a Unix domain socket: one request per
/// connection, `Content-Length` bodies only, `Connection: close`.
/// Enough for `curl --unix-socket` and `$.http.fetch(url, { socketPath })`.
final class SocketServer {
    static let maxBody = 4 * 1024 * 1024

    private let path: String
    private let handler: (HTTPRequest) -> HTTPResponse
    private let queue = DispatchQueue(label: "flowctl.socket", attributes: .concurrent)
    private var listenFD: Int32 = -1
    private var acceptSource: DispatchSourceRead?

    init(path: String, handler: @escaping (HTTPRequest) -> HTTPResponse) {
        self.path = path
        self.handler = handler
    }

    func start() throws {
        let dir = (path as NSString).deletingLastPathComponent
        try FileManager.default.createDirectory(
            atPath: dir, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        unlink(path) // stale socket from a previous run

        listenFD = socket(AF_UNIX, SOCK_STREAM, 0)
        guard listenFD >= 0 else { throw posixError("socket") }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let capacity = MemoryLayout.size(ofValue: addr.sun_path)
        guard path.utf8.count < capacity else { throw SpikeError("socket path longer than \(capacity - 1) bytes") }
        withUnsafeMutableBytes(of: &addr.sun_path) { raw in
            raw.copyBytes(from: path.utf8)
            raw[path.utf8.count] = 0
        }
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(listenFD, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bound == 0 else { throw posixError("bind \(path)") }
        chmod(path, 0o600)
        guard listen(listenFD, 16) == 0 else { throw posixError("listen") }

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

    private func acceptOne() {
        let fd = accept(listenFD, nil, nil)
        guard fd >= 0 else { return }
        var noSigPipe: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noSigPipe, socklen_t(MemoryLayout<Int32>.size))
        queue.async { [weak self] in self?.serve(fd) }
    }

    private func serve(_ fd: Int32) {
        defer { close(fd) }
        var timeout = timeval(tv_sec: 5, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

        let response: HTTPResponse
        switch readRequest(fd) {
        case .success(let request): response = handler(request)
        case .failure(let failure): response = failure
        }
        write(fd, response)
    }

    private func readRequest(_ fd: Int32) -> Result<HTTPRequest, HTTPResponse> {
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        let separator = Data("\r\n\r\n".utf8)
        var headerEnd: Range<Data.Index>?

        while headerEnd == nil {
            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { return .failure(.badRequest("incomplete headers\n")) }
            buffer.append(chunk, count: n)
            headerEnd = buffer.range(of: separator)
            if headerEnd == nil && buffer.count > 64 * 1024 { return .failure(.badRequest("headers too large\n")) }
        }

        let head = String(decoding: buffer[..<headerEnd!.lowerBound], as: UTF8.self)
        let lines = head.components(separatedBy: "\r\n")
        let parts = lines[0].split(separator: " ")
        guard parts.count >= 2 else { return .failure(.badRequest("bad request line\n")) }

        var contentLength = 0
        for line in lines.dropFirst() {
            let pair = line.split(separator: ":", maxSplits: 1)
            if pair.count == 2, pair[0].lowercased() == "content-length" {
                contentLength = Int(pair[1].trimmingCharacters(in: .whitespaces)) ?? -1
            }
        }
        guard contentLength >= 0 else { return .failure(.badRequest("bad content-length\n")) }
        guard contentLength <= Self.maxBody else { return .failure(.tooLarge) }

        var body = Data(buffer[headerEnd!.upperBound...])
        while body.count < contentLength {
            let n = read(fd, &chunk, chunk.count)
            guard n > 0 else { return .failure(.badRequest("incomplete body\n")) }
            body.append(chunk, count: n)
        }

        return .success(HTTPRequest(
            method: String(parts[0]), path: String(parts[1]),
            body: body.prefix(contentLength), receivedAt: nowMs()))
    }

    private func write(_ fd: Int32, _ response: HTTPResponse) {
        let body = Data(response.body.utf8)
        let head = "HTTP/1.1 \(response.status) \(response.reason)\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: \(body.count)\r\n"
            + "Connection: close\r\n\r\n"
        let bytes = Data(head.utf8) + body
        bytes.withUnsafeBytes { raw in
            var offset = 0
            while offset < raw.count {
                let n = Darwin.write(fd, raw.baseAddress! + offset, raw.count - offset)
                if n <= 0 { return }
                offset += n
            }
        }
    }
}

struct SpikeError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

private func posixError(_ what: String) -> SpikeError {
    SpikeError("\(what): \(String(cString: strerror(errno)))")
}
