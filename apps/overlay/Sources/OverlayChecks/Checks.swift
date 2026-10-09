import FlowCTLCore
import Foundation

/// Collects failed expectations; XCTest and the `overlay-checks` runner report them.
public final class Expect {
    public private(set) var failures: [String] = []

    public init() {}

    public func that(_ condition: @autoclosure () -> Bool, _ message: String, line: UInt = #line) {
        if !condition() { failures.append("line \(line): \(message)") }
    }

    public func equal<T: Equatable>(_ actual: T, _ expected: T, _ message: String = "", line: UInt = #line) {
        if actual != expected { failures.append("line \(line): \(message) expected \(expected), got \(actual)") }
    }
}

public struct Check {
    public let group: String
    public let name: String
    public let body: (Expect) -> Void
}

public enum OverlayChecks {
    public static let all: [Check] = http + snapshots + registry + files
}

// MARK: - Helpers

private func bytes(_ text: String) -> Data { Data(text.utf8) }

private func parse(_ chunks: [String]) -> HTTPParseResult {
    var parser = HTTPRequestParser()
    var result = HTTPParseResult.needMore
    for chunk in chunks { result = parser.feed(bytes(chunk)) }
    return result
}

func snapshotJSON(id: String = "s1", seq: Int = 1, state: String = "working", updatedAt: Double = 0, nodes: Int = 1) -> Data {
    let list = (0..<nodes).map { #"{"id":"n\#($0)","kind":"task","title":"t","status":"running","blockedBy":[]}"# }
    return bytes(#"{"schema":1,"seq":\#(seq),"sessionId":"\#(id)","cwd":"/p","updatedAt":\#(updatedAt),"sessionState":"\#(state)","planSource":"tasks","nodes":[\#(list.joined(separator: ","))],"layout":{},"warnings":[]}"#)
}

private func info(_ id: String = "s1", seq: Int = 1, state: SessionState = .working) -> SnapshotInfo {
    SnapshotInfo(sessionId: id, seq: seq, state: state, updatedAt: 0, nodeCount: 1)
}

private let t0 = Date(timeIntervalSince1970: 1_000_000)

// MARK: - HTTP

private let http: [Check] = [
    Check(group: "http", name: "parses a POST split across reads") { expect in
        let body = #"{"a":1}"#
        let result = parse(["POST /snapshot?x=1 HTTP/1.1\r\nHost: overlay\r\nContent-", "Length: \(body.utf8.count)\r\n\r\n{\"a\"", ":1}"])
        guard case let .complete(request) = result else { return expect.that(false, "incomplete: \(result)") }
        expect.equal(request.method, "POST")
        expect.equal(request.path, "/snapshot", "query is stripped")
        expect.equal(request.headers["host"], "overlay", "header names are lowercased")
        expect.equal(request.body, bytes(body))
    },
    Check(group: "http", name: "a GET with no body completes at the blank line") { expect in
        expect.equal(parse(["GET /health HTTP/1.1\r\n\r\n"]),
                     .complete(HTTPRequest(method: "GET", path: "/health", headers: [:], body: Data())))
    },
    Check(group: "http", name: "waits for the rest of the body") { expect in
        expect.equal(parse(["POST /snapshot HTTP/1.1\r\nContent-Length: 10\r\n\r\n12345"]), .needMore)
    },
    Check(group: "http", name: "refuses chunked bodies, bad lengths and garbage") { expect in
        expect.equal(parse(["POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n"]), .failed(.lengthRequired))
        expect.equal(parse(["POST / HTTP/1.1\r\nContent-Length: -1\r\n\r\n"]), .failed(.badRequest("bad content-length")))
        expect.equal(parse(["POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\n"]), .failed(.badRequest("conflicting content-length")))
        expect.equal(parse(["HELLO\r\n\r\n"]), .failed(.badRequest("bad request line")))
        expect.equal(parse(["GET / HTTP/1.1\r\nNoColon\r\n\r\n"]), .failed(.badRequest("bad header line")))
    },
    Check(group: "http", name: "refuses bodies and headers past the limits") { expect in
        expect.equal(parse(["POST / HTTP/1.1\r\nContent-Length: \(HTTPRequestParser.maxBodyBytes + 1)\r\n\r\n"]), .failed(.tooLarge))
        expect.equal(parse(["GET / HTTP/1.1\r\nX: " + String(repeating: "a", count: HTTPRequestParser.maxHeaderBytes + 1)]),
                     .failed(.badRequest("headers too large")))
    },
    Check(group: "http", name: "a response is one closed exchange") { expect in
        let text = String(decoding: HTTPResponse.ok("hi\n").serialized(), as: UTF8.self)
        expect.that(text.hasPrefix("HTTP/1.1 200 OK\r\n"), "status line")
        expect.that(text.contains("Content-Length: 3\r\n"), "length")
        expect.that(text.contains("Connection: close\r\n"), "closes")
        expect.that(text.hasSuffix("\r\n\r\nhi\n"), "body")
    }
]

// MARK: - Snapshots

private let snapshots: [Check] = [
    Check(group: "snapshot", name: "reads id, seq, state and node count") { expect in
        let parsed = try? Snapshot.parse(snapshotJSON(id: "abc", seq: 7, state: "waiting_you", updatedAt: 5, nodes: 3)).get()
        expect.equal(parsed, SnapshotInfo(sessionId: "abc", seq: 7, state: .waitingYou, updatedAt: 5, nodeCount: 3))
    },
    Check(group: "snapshot", name: "refuses what the viewer could not draw") { expect in
        expect.equal(Snapshot.parse(bytes("[]")), .failure(.notJSONObject))
        expect.equal(Snapshot.parse(bytes("nope")), .failure(.notJSONObject))
        expect.equal(Snapshot.parse(bytes(#"{"schema":2}"#)), .failure(.wrongSchema))
        expect.equal(Snapshot.parse(snapshotJSON(id: "")), .failure(.missingField("sessionId")))
        expect.equal(Snapshot.parse(snapshotJSON(state: "sleeping")), .failure(.missingField("sessionState")))
        let fractional = String(decoding: snapshotJSON(), as: UTF8.self).replacingOccurrences(of: #""seq":1"#, with: #""seq":1.5"#)
        expect.equal(Snapshot.parse(bytes(fractional)), .failure(.missingField("seq")))
    },
    Check(group: "snapshot", name: "only working and waiting count as active") { expect in
        expect.equal([SessionState.working, .waitingYou, .idle, .ended].map(\.isActive), [true, true, false, false])
    }
]

// MARK: - Sessions

private let registry: [Check] = [
    Check(group: "sessions", name: "drops a seq that is not newer, per session") { expect in
        var sessions = SessionRegistry(now: t0)
        expect.equal(sessions.accept(info(seq: 5), body: Data(), now: t0), .accepted(isNewSession: true, startedWaiting: false))
        expect.equal(sessions.accept(info(seq: 5), body: Data(), now: t0), .stale)
        expect.equal(sessions.accept(info(seq: 4), body: Data(), now: t0), .stale)
        expect.equal(sessions.accept(info("s2", seq: 1), body: Data(), now: t0), .accepted(isNewSession: true, startedWaiting: false))
        expect.equal(sessions.accept(info(seq: 6, state: .waitingYou), body: Data(), now: t0), .accepted(isNewSession: false, startedWaiting: true))
        expect.equal(sessions.accept(info(seq: 7, state: .waitingYou), body: Data(), now: t0), .accepted(isNewSession: false, startedWaiting: false))
        expect.equal(sessions.order, ["s1", "s2"])
    },
    Check(group: "sessions", name: "an ended session's tab goes 30 s after it ended") { expect in
        var sessions = SessionRegistry(now: t0)
        _ = sessions.accept(info(seq: 1), body: Data(), now: t0)
        _ = sessions.accept(info("s2", seq: 1), body: Data(), now: t0)
        _ = sessions.accept(info(seq: 2, state: .ended), body: Data(), now: t0)
        _ = sessions.accept(info(seq: 3, state: .ended), body: Data(), now: t0.addingTimeInterval(20))
        expect.equal(sessions.expireEnded(now: t0.addingTimeInterval(29)), [], "the clock starts at the first ended snapshot")
        expect.equal(sessions.expireEnded(now: t0.addingTimeInterval(30)), ["s1"])
        expect.equal(sessions.order, ["s2"])
        expect.equal(sessions.bodies.count, 1)
    },
    Check(group: "sessions", name: "idle once nothing has been active for 60 s, counted from launch") { expect in
        var sessions = SessionRegistry(now: t0)
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(59)), "not idle right after launch")
        expect.that(sessions.isIdle(now: t0.addingTimeInterval(60)), "idle a minute after launch with no session")
        _ = sessions.accept(info(seq: 1), body: Data(), now: t0.addingTimeInterval(100))
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(200)), "a working session is active")
        _ = sessions.accept(info(seq: 2, state: .idle), body: Data(), now: t0.addingTimeInterval(210))
        // Working until the idle snapshot at 210: the minute counts from there.
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(269)), "less than 60 s since it was active")
        expect.that(sessions.isIdle(now: t0.addingTimeInterval(270)), "idle 60 s after the last activity")
    },
    Check(group: "sessions", name: "an old snapshot read from disk does not turn the idle clock back") { expect in
        var sessions = SessionRegistry(now: t0)
        _ = sessions.accept(info(seq: 1), body: Data(), now: t0.addingTimeInterval(-300))
        expect.equal(sessions.activeCount(now: t0), 1, "a 5-minute-old working file still counts")
        let silent = t0.addingTimeInterval(SessionRegistry.workingSilenceLimit - 300)
        expect.equal(sessions.activeCount(now: silent), 0, "until the silence limit, counted from the file's date")
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(59)), "launch still starts the minute")
    },
    Check(group: "sessions", name: "a working session that went silent stops counting; a waiting one does not") { expect in
        var sessions = SessionRegistry(now: t0)
        _ = sessions.accept(info("w", seq: 1, state: .working), body: Data(), now: t0)
        _ = sessions.accept(info("q", seq: 1, state: .waitingYou), body: Data(), now: t0)
        let later = t0.addingTimeInterval(SessionRegistry.workingSilenceLimit + 1)
        expect.equal(sessions.activeCount(now: t0), 2)
        expect.equal(sessions.activeCount(now: later), 1)
        expect.that(sessions.isAnyWaiting, "q waits on the person")
    },
    Check(group: "sessions", name: "auto-show: active sessions bring the panel up unless the person closed it") { expect in
        let fresh = SessionRegistry.Outcome.accepted(isNewSession: false, startedWaiting: false)
        expect.that(AutoShow.shouldShow(outcome: fresh, state: .working, enabled: true, userHidden: false), "working shows")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .idle, enabled: true, userHidden: false), "idle does not")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .working, enabled: false, userHidden: false), "disabled")
        expect.that(!AutoShow.shouldShow(outcome: .stale, state: .working, enabled: true, userHidden: false), "stale")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .working, enabled: true, userHidden: true), "closed by the person")
        expect.that(AutoShow.shouldShow(outcome: .accepted(isNewSession: true, startedWaiting: false), state: .working, enabled: true, userHidden: true), "a new session reopens")
        expect.that(AutoShow.shouldShow(outcome: .accepted(isNewSession: false, startedWaiting: true), state: .waitingYou, enabled: true, userHidden: true), "waiting on the person reopens")
    }
]

// MARK: - Files

private let files: [Check] = [
    Check(group: "files", name: "shows live sessions oldest first, deletes ended and day-old ones") { expect in
        let now = t0
        let old = now.addingTimeInterval(-SessionFiles.maxAge - 1)
        let entries = [
            SessionFiles.Entry(name: "b.json", data: snapshotJSON(id: "b", updatedAt: 20), modified: now),
            SessionFiles.Entry(name: "a.json", data: snapshotJSON(id: "a", updatedAt: 10), modified: now),
            SessionFiles.Entry(name: "ended.json", data: snapshotJSON(id: "e", state: "ended"), modified: now),
            SessionFiles.Entry(name: "stale.json", data: snapshotJSON(id: "s"), modified: old),
            SessionFiles.Entry(name: "partial.json", data: bytes("{\"schema\":1,"), modified: now),
            SessionFiles.Entry(name: "broken-old.json", data: bytes("x"), modified: old),
            SessionFiles.Entry(name: "notes.txt", data: bytes("x"), modified: old)
        ]
        let plan = SessionFiles.plan(entries, now: now)
        expect.equal(plan.show.map(\.name), ["a.json", "b.json"])
        expect.equal(plan.delete, ["broken-old.json", "ended.json", "stale.json"])
    },
    Check(group: "files", name: "reads a directory, and a missing one as empty") { expect in
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("flowctl-checks-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        expect.equal(SessionFiles.read(directory: dir), [])
        try? FileManager.default.createDirectory(at: dir.appendingPathComponent("sub"), withIntermediateDirectories: true)
        try? snapshotJSON().write(to: dir.appendingPathComponent("s1.json"))
        let entries = SessionFiles.read(directory: dir)
        expect.equal(entries.map(\.name), ["s1.json"], "files only, no folders")
        expect.equal(entries.first?.data, snapshotJSON())
    }
]
