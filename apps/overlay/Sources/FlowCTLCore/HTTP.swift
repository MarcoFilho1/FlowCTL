import Foundation

public struct HTTPRequest: Equatable {
    public let method: String
    /// The request target without its query string.
    public let path: String
    /// Header names lowercased.
    public let headers: [String: String]
    public let body: Data

    public init(method: String, path: String, headers: [String: String], body: Data) {
        self.method = method
        self.path = path
        self.headers = headers
        self.body = body
    }
}

public struct HTTPResponse: Equatable, Error {
    public let status: Int
    public let reason: String
    public let body: String

    public init(status: Int, reason: String, body: String) {
        self.status = status
        self.reason = reason
        self.body = body
    }

    public static func ok(_ body: String = "ok\n") -> HTTPResponse { .init(status: 200, reason: "OK", body: body) }
    public static func badRequest(_ why: String) -> HTTPResponse { .init(status: 400, reason: "Bad Request", body: why + "\n") }
    public static let notFound = HTTPResponse(status: 404, reason: "Not Found", body: "not found\n")
    public static let methodNotAllowed = HTTPResponse(status: 405, reason: "Method Not Allowed", body: "method not allowed\n")
    public static let lengthRequired = HTTPResponse(status: 411, reason: "Length Required", body: "send a Content-Length body\n")
    public static let tooLarge = HTTPResponse(status: 413, reason: "Payload Too Large", body: "too large\n")

    /// The bytes on the wire; every connection closes after one response.
    public func serialized() -> Data {
        let payload = Data(body.utf8)
        let head = "HTTP/1.1 \(status) \(reason)\r\n"
            + "Content-Type: text/plain; charset=utf-8\r\n"
            + "Content-Length: \(payload.count)\r\n"
            + "Connection: close\r\n\r\n"
        return Data(head.utf8) + payload
    }
}

public enum HTTPParseResult: Equatable {
    case needMore
    case complete(HTTPRequest)
    case failed(HTTPResponse)
}

/// An incremental HTTP/1.1 request parser for one request per connection:
/// feed it bytes as they arrive. Bodies need `Content-Length`; chunked
/// transfer is refused (411), which `curl` and `$.http.fetch` never need.
public struct HTTPRequestParser {
    public static let maxHeaderBytes = 64 * 1024
    public static let maxBodyBytes = 8 * 1024 * 1024

    private var buffer = Data()
    private var head: (method: String, path: String, headers: [String: String], bodyStart: Int, length: Int)?

    public init() {}

    public mutating func feed(_ bytes: Data) -> HTTPParseResult {
        buffer.append(bytes)

        if head == nil {
            guard let end = buffer.range(of: Data("\r\n\r\n".utf8)) else {
                return buffer.count > Self.maxHeaderBytes ? .failed(.badRequest("headers too large")) : .needMore
            }
            switch Self.parseHead(buffer.subdata(in: 0..<end.lowerBound)) {
            case .failure(let response):
                return .failed(response)
            case .success(let parsed):
                head = (parsed.method, parsed.path, parsed.headers, end.upperBound, parsed.length)
            }
        }

        guard let head else { return .needMore }
        let available = buffer.count - head.bodyStart
        guard available >= head.length else { return .needMore }
        let body = buffer.subdata(in: head.bodyStart..<(head.bodyStart + head.length))
        return .complete(HTTPRequest(method: head.method, path: head.path, headers: head.headers, body: body))
    }

    private static func parseHead(_ data: Data) -> Result<(method: String, path: String, headers: [String: String], length: Int), HTTPResponse> {
        guard let text = String(data: data, encoding: .utf8) else { return .failure(.badRequest("headers are not UTF-8")) }
        let lines = text.components(separatedBy: "\r\n")
        let parts = (lines.first ?? "").split(separator: " ", omittingEmptySubsequences: true)
        guard parts.count == 3, parts[2].hasPrefix("HTTP/1.") else { return .failure(.badRequest("bad request line")) }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() where !line.isEmpty {
            guard let colon = line.firstIndex(of: ":") else { return .failure(.badRequest("bad header line")) }
            let name = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if name == "content-length", let existing = headers[name], existing != value {
                return .failure(.badRequest("conflicting content-length"))
            }
            headers[name] = value
        }

        if headers["transfer-encoding"] != nil { return .failure(.lengthRequired) }
        var length = 0
        if let raw = headers["content-length"] {
            guard !raw.isEmpty, raw.allSatisfy(\.isASCIIDigit), let value = Int(raw) else {
                return .failure(.badRequest("bad content-length"))
            }
            length = value
        }
        guard length <= maxBodyBytes else { return .failure(.tooLarge) }

        let target = String(parts[1])
        let path = target.split(separator: "?", maxSplits: 1).first.map(String.init) ?? target
        return .success((String(parts[0]), path, headers, length))
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}
