import CoreGraphics
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
    public static let all: [Check] = http + snapshots + registry + files + geometry + focus + look + sound + theme + viewerState
}

// MARK: - Helpers

private func bytes(_ text: String) -> Data { Data(text.utf8) }
extension OverlayChecks { static func bytesOf(_ text: String) -> Data { Data(text.utf8) } }

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

private func info(_ id: String = "s1", seq: Int = 1, state: SessionState = .working, pid: Int32? = nil) -> SnapshotInfo {
    SnapshotInfo(sessionId: id, seq: seq, state: state, updatedAt: 0, nodeCount: 1, pid: pid)
}

private let t0 = Date(timeIntervalSince1970: 1_000_000)

extension Data {
    /// The same snapshot JSON with a terminal.pid, for the liveness checks.
    func withPid(_ pid: Int) -> Data {
        OverlayChecks.bytesOf(String(decoding: self, as: UTF8.self).replacingOccurrences(of: #""planSource""#, with: #""terminal":{"pid":\#(pid)},"planSource""#))
    }
}

// MARK: - HTTP

private let http: [Check] = [
    Check(group: "http", name: "parses a POST split across reads") { expect in
        let body = #"{"a":1}"#
        let result = parse(["POST /snapshot?x=1 HTTP/1.1\r\nHost: overlay\r\nContent-", "Length: \(body.utf8.count)\r\n\r\n{\"a\"", ":1}"])
        guard case let .complete(request) = result else { return expect.that(false, "incomplete: \(result)") }
        expect.equal(request.method, "POST")
        expect.equal(request.path, "/snapshot", "query is kept apart")
        expect.equal(request.query, "x=1")
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
        expect.equal(sessions.replayBodies(now: t0).count, 1)
    },
    Check(group: "sessions", name: "idle once nothing has been active for more than 5 min, counted from launch") { expect in
        var sessions = SessionRegistry(now: t0)
        expect.equal(SessionRegistry.idleAfter, 300, "the production limit")
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(300)), "exactly 5 min is not more than 5 min")
        expect.that(sessions.isIdle(now: t0.addingTimeInterval(301)), "idle after 5 min with no session")
        _ = sessions.accept(info(seq: 1), body: Data(), now: t0.addingTimeInterval(400))
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(600)), "a working session is active")
        _ = sessions.accept(info(seq: 2, state: .idle), body: Data(), now: t0.addingTimeInterval(610))
        // Working until the idle snapshot at 610: the five minutes count from there.
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(910)), "still within 5 min of the last activity")
        expect.that(sessions.isIdle(now: t0.addingTimeInterval(911)), "idle after 5 min since the last activity")
    },
    Check(group: "sessions", name: "a shorter idle limit can be given, as the debug override does") { expect in
        var sessions = SessionRegistry(now: t0, idleAfter: 3)
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(3)), "3 s is not more than 3 s")
        expect.that(sessions.isIdle(now: t0.addingTimeInterval(4)), "idle after 3 s")
        _ = sessions.accept(info(seq: 1, state: .waitingYou), body: Data(), now: t0.addingTimeInterval(5))
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(7)), "waiting on the person is active")
    },
    Check(group: "sessions", name: "an old snapshot read from disk does not turn the idle clock back") { expect in
        var sessions = SessionRegistry(now: t0)
        _ = sessions.accept(info(seq: 1), body: Data(), now: t0.addingTimeInterval(-300))
        expect.equal(sessions.activeCount(now: t0), 1, "a 5-minute-old working file still counts")
        let silent = t0.addingTimeInterval(SessionRegistry.staleAfter - 300 + 1)
        expect.equal(sessions.activeCount(now: silent), 0, "past the 30 min limit, counted from the file's date")
        expect.that(!sessions.isIdle(now: t0.addingTimeInterval(59)), "launch still starts the minute")
    },
    Check(group: "sessions", name: "without a pid, working or waiting stops counting after 30 min of silence") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { _ in true })
        _ = sessions.accept(info("w", seq: 1, state: .working), body: Data(), now: t0)
        _ = sessions.accept(info("q", seq: 1, state: .waitingYou), body: Data(), now: t0)
        let later = t0.addingTimeInterval(SessionRegistry.staleAfter + 1)
        expect.equal(sessions.activeCount(now: t0), 2)
        expect.equal(sessions.activeCount(now: later), 0, "neither counts")
        expect.that(!sessions.isAnyWaiting(now: later), "a stale waiting session does not light the icon")
        expect.that(sessions.isAnyWaiting(now: t0), "fresh, it does")
        expect.that(sessions.isIdle(now: later.addingTimeInterval(SessionRegistry.idleAfter)), "so it does not hold off the idle hide")
    },
    Check(group: "liveness", name: "a live pid keeps a session as it said; a dead one is ended") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { $0 == 4242 })
        _ = sessions.accept(info("live", seq: 1, state: .waitingYou, pid: 4242), body: Data(), now: t0)
        _ = sessions.accept(info("dead", seq: 1, state: .waitingYou, pid: 9999), body: Data(), now: t0)
        let later = t0.addingTimeInterval(SessionRegistry.staleAfter * 4)
        expect.equal(sessions.activeCount(now: later), 1, "a live waiting session is not stale: its pid is the proof")
        expect.that(sessions.isAnyWaiting(now: later), "the live one lights the icon")
        let dead = sessions.sessions["dead"]
        expect.equal(dead.map { sessions.effectiveState(of: $0, now: later) }, .ended, "a dead pid is ended, whatever it said")
    },
    Check(group: "liveness", name: "a waiting session whose process is gone does not light the icon") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { _ in false })
        _ = sessions.accept(info("gone", seq: 1, state: .waitingYou, pid: 68_123), body: Data(), now: t0)
        expect.that(!sessions.isAnyWaiting(now: t0), "the icon stays normal")
        expect.equal(sessions.activeCount(now: t0), 0)
        expect.equal(sessions.reconcile(now: t0), ["gone"], "marked ended once")
        expect.equal(sessions.reconcile(now: t0.addingTimeInterval(1)), [], "and not again")
        expect.equal(sessions.expireEnded(now: t0.addingTimeInterval(29)), [], "its tab stays 30 s, like an ended one")
        expect.equal(sessions.expireEnded(now: t0.addingTimeInterval(30)), ["gone"], "then leaves")
    },
    Check(group: "liveness", name: "a live pid is not reconciled, and an ended snapshot is not doubled") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { _ in true })
        _ = sessions.accept(info("a", seq: 1, state: .working, pid: 7), body: Data(), now: t0)
        expect.equal(sessions.reconcile(now: t0), [])
        _ = sessions.accept(info("a", seq: 2, state: .ended, pid: 7), body: Data(), now: t0)
        expect.equal(sessions.reconcile(now: t0), [], "already ended by its own snapshot")
    },
    Check(group: "liveness", name: "the probe says a running process is alive and a missing one is not") { expect in
        expect.that(ProcessLiveness.isAlive(getpid()), "this process")
        expect.that(!ProcessLiveness.isAlive(0), "pid 0 is never a session")
        expect.that(!ProcessLiveness.isAlive(-1), "nor is -1")
        expect.that(!ProcessLiveness.isAlive(2_000_000_000), "a pid no process has")
    },
    Check(group: "liveness", name: "a snapshot names its process by terminal.pid") { expect in
        let withPid = try? Snapshot.parse(bytes(String(decoding: snapshotJSON(), as: UTF8.self).replacingOccurrences(of: #""planSource""#, with: #""terminal":{"pid":4321},"planSource""#))).get()
        expect.equal(withPid?.pid, 4321)
        expect.equal(try? Snapshot.parse(snapshotJSON()).get().pid, nil, "older snapshots have none")
        expect.equal(try? Snapshot.parse(bytes(String(decoding: snapshotJSON(), as: UTF8.self).replacingOccurrences(of: #""planSource""#, with: #""terminal":{"pid":-5},"planSource""#))).get().pid, nil, "a pid that is not a process is ignored")
    },
    Check(group: "sessions", name: "auto-show: an active session brings the panel up unless the person closed it") { expect in
        let fresh = SessionRegistry.Outcome.accepted(isNewSession: false, startedWaiting: false)
        expect.that(AutoShow.shouldShow(outcome: fresh, state: .working, enabled: true, hiddenBy: .nobody), "working shows")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .idle, enabled: true, hiddenBy: .nobody), "idle does not")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .working, enabled: false, hiddenBy: .nobody), "disabled")
        expect.that(!AutoShow.shouldShow(outcome: .stale, state: .working, enabled: true, hiddenBy: .nobody), "stale")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .working, enabled: true, hiddenBy: .user), "closed by the person")
        expect.that(AutoShow.shouldShow(outcome: .accepted(isNewSession: true, startedWaiting: false), state: .working, enabled: true, hiddenBy: .user), "a new session reopens")
        expect.that(AutoShow.shouldShow(outcome: .accepted(isNewSession: false, startedWaiting: true), state: .waitingYou, enabled: true, hiddenBy: .user), "waiting on the person reopens")
    },
    Check(group: "sessions", name: "after an idle hide only a session that is working or waiting brings the panel back") { expect in
        let fresh = SessionRegistry.Outcome.accepted(isNewSession: false, startedWaiting: false)
        let newcomer = SessionRegistry.Outcome.accepted(isNewSession: true, startedWaiting: false)
        expect.that(AutoShow.shouldShow(outcome: fresh, state: .working, enabled: true, hiddenBy: .idle), "a session resumes: it shows")
        expect.that(AutoShow.shouldShow(outcome: .accepted(isNewSession: false, startedWaiting: true), state: .waitingYou, enabled: true, hiddenBy: .idle), "a session waits on the person: it shows")
        expect.that(!AutoShow.shouldShow(outcome: newcomer, state: .idle, enabled: true, hiddenBy: .idle), "a new idle session does not")
        expect.that(!AutoShow.shouldShow(outcome: fresh, state: .idle, enabled: true, hiddenBy: .idle), "an idle snapshot does not")
    },
    Check(group: "sessions", name: "opening the app does not bring back an idle hide, but does after the person closed it") { expect in
        expect.that(AutoShow.reopenShows(.nobody), "not hidden: shows")
        expect.that(AutoShow.reopenShows(.user), "the person closed it: opening the app shows it")
        expect.that(!AutoShow.reopenShows(.idle), "idle: nothing resumed, so opening the app does not show it")
    },
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
        let plan = SessionFiles.plan(entries, now: now, isAlive: { _ in true })
        expect.equal(plan.show.map(\.name), ["a.json", "b.json"])
        expect.equal(plan.delete, ["broken-old.json", "ended.json", "stale.json"])
    },
    Check(group: "files", name: "a file whose process is gone is deleted; a live or pid-less one is kept") { expect in
        let now = t0
        let entries = [
            SessionFiles.Entry(name: "dead.json", data: snapshotJSON(id: "d", state: "waiting_you").withPid(68_123), modified: now),
            SessionFiles.Entry(name: "live.json", data: snapshotJSON(id: "l", state: "waiting_you").withPid(4321), modified: now),
            SessionFiles.Entry(name: "old-style.json", data: snapshotJSON(id: "o", state: "waiting_you"), modified: now)
        ]
        let plan = SessionFiles.plan(entries, now: now, isAlive: { $0 == 4321 })
        expect.equal(plan.delete, ["dead.json"])
        expect.equal(plan.show.map(\.name), ["live.json", "old-style.json"], "the pid-less file is shown: it is only stale in the registry")
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

// MARK: - Panel geometry

private let laptop = CGRect(x: 0, y: 0, width: 1470, height: 923)

private let geometry: [Check] = [
    Check(group: "geometry", name: "three fixed sizes, medium by default, cut to a small screen") { expect in
        expect.equal(PanelSize.allCases.map(\.size), [CGSize(width: 280, height: 180), CGSize(width: 360, height: 220), CGSize(width: 480, height: 300)])
        expect.equal(PanelSize.standard, .medium)
        expect.equal(PanelSize.allCases.map(\.title), ["Small", "Medium", "Large"])
        expect.equal(PanelGeometry.fit(PanelSize.large.size, screen: laptop), PanelSize.large.size)
        expect.equal(PanelGeometry.fit(PanelSize.large.size, screen: CGRect(x: 0, y: 0, width: 400, height: 250)), CGSize(width: 400, height: 250))
    },
    Check(group: "geometry", name: "a top-right anchor grows left and down") { expect in
        let corner = CGPoint(x: 1458, y: 911)
        let small = PanelGeometry.frame(size: CGSize(width: 120, height: 120), corner: .topRight, at: corner, screen: laptop)
        let big = PanelGeometry.frame(size: CGSize(width: 300, height: 200), corner: .topRight, at: corner, screen: laptop)
        expect.equal(PanelGeometry.point(of: .topRight, in: small), corner)
        expect.equal(PanelGeometry.point(of: .topRight, in: big), corner)
        expect.equal(big.minX, 1158)
        expect.equal(big.minY, 711)
    },
    Check(group: "geometry", name: "every anchor keeps its corner fixed") { expect in
        let point = CGPoint(x: 700, y: 450)
        for corner in Corner.allCases {
            for size in [CGSize(width: 120, height: 120), CGSize(width: 400, height: 300)] {
                let frame = PanelGeometry.frame(size: size, corner: corner, at: point, screen: laptop)
                expect.equal(PanelGeometry.point(of: corner, in: frame), point, "\(corner) at \(size)")
            }
        }
    },
    Check(group: "geometry", name: "a frame that would stick out is moved back on screen") { expect in
        let frame = PanelGeometry.frame(size: CGSize(width: 400, height: 300), corner: .bottomLeft, at: CGPoint(x: 1300, y: 800), screen: laptop)
        expect.that(laptop.contains(frame), "inside: \(frame)")
    },
    Check(group: "geometry", name: "after a drag the anchor is the nearest screen corner") { expect in
        let at = { (x: CGFloat, y: CGFloat) in CGRect(x: x, y: y, width: 200, height: 200) }
        expect.equal(PanelGeometry.nearestCorner(of: at(1200, 700), in: laptop), .topRight)
        expect.equal(PanelGeometry.nearestCorner(of: at(10, 700), in: laptop), .topLeft)
        expect.equal(PanelGeometry.nearestCorner(of: at(10, 10), in: laptop), .bottomLeft)
        expect.equal(PanelGeometry.nearestCorner(of: at(1200, 10), in: laptop), .bottomRight)
        let anchor = PanelGeometry.defaultAnchor(screen: laptop)
        expect.equal(anchor.corner, .topRight)
        expect.equal(anchor.point, CGPoint(x: 1458, y: 911))
    }
]

// MARK: - Terminal focus

private let focus: [Check] = [
    Check(group: "focus", name: "reads the optional terminal field of a snapshot") { expect in
        var json = String(decoding: snapshotJSON(), as: UTF8.self)
        expect.equal(TerminalInfo.from(snapshot: bytes(json)), nil, "absent")
        json.removeLast()
        json += #","terminal":{"app":"com.apple.Terminal","program":"Apple_Terminal","tty":"ttys021","ids":{"TERM_SESSION_ID":"abc","bad":3}}}"#
        expect.equal(TerminalInfo.from(snapshot: bytes(json)),
                     TerminalInfo(app: "com.apple.Terminal", program: "Apple_Terminal", tty: "ttys021", ids: ["TERM_SESSION_ID": "abc"]))
    },
    Check(group: "focus", name: "Terminal.app is focused by tty, iTerm2 by session id or tty") { expect in
        expect.equal(FocusAction.plan(for: TerminalInfo(app: "com.apple.Terminal", tty: "ttys021")), .terminalTab(tty: "/dev/ttys021"))
        expect.equal(FocusAction.plan(for: TerminalInfo(program: "Apple_Terminal", tty: "/dev/ttys004")), .terminalTab(tty: "/dev/ttys004"), "by TERM_PROGRAM")
        let uuid = "8B5E5C3A-0F0C-4B1E-9D6C-2F7A1B2C3D4E"
        expect.equal(FocusAction.plan(for: TerminalInfo(program: "iTerm.app", tty: "ttys7", ids: ["ITERM_SESSION_ID": "w0t1p0:\(uuid.lowercased())"])),
                     .iTermSession(uniqueId: uuid, tty: "/dev/ttys7"))
        expect.equal(FocusAction.plan(for: TerminalInfo(app: "com.googlecode.iterm2")), .activate(bundleId: "com.googlecode.iterm2"), "nothing to select by")
    },
    Check(group: "focus", name: "other terminals are brought forward by bundle id") { expect in
        expect.equal(FocusAction.plan(for: TerminalInfo(app: "com.evercraftlabs.Maestro", program: "Maestri", ids: ["MAESTRI_TERMINAL_ID": "X"])),
                     .activate(bundleId: "com.evercraftlabs.Maestro"))
        expect.equal(FocusAction.plan(for: TerminalInfo(program: "Maestri")), .activate(bundleId: "com.evercraftlabs.Maestro"))
        expect.equal(FocusAction.plan(for: TerminalInfo(program: "something-else")), .none)
        expect.equal(FocusAction.plan(for: nil), .none)
    },
    Check(group: "focus", name: "only plain device paths and UUIDs reach a script") { expect in
        expect.equal(FocusAction.devicePath("ttys021"), "/dev/ttys021")
        expect.equal(FocusAction.devicePath("/dev/tty5"), "/dev/tty5")
        for bad in ["ttys021\"", "../ttys1", "/dev/disk0", "ttys", "ttys1; rm", ""] {
            expect.equal(FocusAction.devicePath(bad), nil, bad)
        }
        expect.equal(FocusAction.iTermUniqueId("w0t0p0:\" & beep"), nil)
        expect.equal(FocusAction.plan(for: TerminalInfo(app: "com.apple.Terminal\" & do shell script \"x", tty: "ttys1")), .none, "a malformed bundle id")
        expect.equal(FocusAction.plan(for: TerminalInfo(app: "com.apple.Terminal", tty: "x\" & beep")), .activate(bundleId: "com.apple.Terminal"))
    },
    Check(group: "focus", name: "scripts select the tab and fall back to the app") { expect in
        let terminal = FocusAction.terminalTab(tty: "/dev/ttys021")
        expect.that(terminal.appleScript?.contains(#"if tty of t is "/dev/ttys021" then"#) == true, "matches the tty")
        expect.equal(terminal.fallbackBundleId, "com.apple.Terminal")
        expect.that(FocusAction.iTermSession(uniqueId: nil, tty: "/dev/ttys1").appleScript?.contains(#"unique id of s is "-""#) == true, "a missing id matches nothing")
        expect.equal(FocusAction.activate(bundleId: "a.b").appleScript, nil)
        expect.equal(FocusAction.none.fallbackBundleId, nil)
    }
]

// MARK: - Page look

private let look: [Check] = [
    Check(group: "look", name: "pixel is the default; the raw values are what the viewer receives") { expect in
        expect.equal(PageLook.standard, .pixel)
        expect.equal(PageLook.allCases.map(\.rawValue), ["pixel", "smooth"])
        expect.equal(PageLook.allCases.map(\.title), ["Pixel", "Smooth"])
        expect.equal(PageLook(rawValue: "retro"), nil, "unknown looks are not accepted")
    }
]

// MARK: - The state the viewer is sent

/// Reads the sessionState and seq of a stamped snapshot.
private func stamped(_ data: Data) -> (state: String?, seq: Int?, nodes: Int?) {
    let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    return (object?["sessionState"] as? String, (object?["seq"] as? NSNumber)?.intValue, (object?["nodes"] as? [Any])?.count)
}

private let viewerState: [Check] = [
    Check(group: "viewer", name: "restamping changes only the state and seq, keeping the rest") { expect in
        let original = snapshotJSON(id: "a", seq: 4, state: "waiting_you", nodes: 3)
        let out = Snapshot.restamped(original, state: .ended, seq: 9)
        expect.equal(stamped(out).state, "ended")
        expect.equal(stamped(out).seq, 9)
        expect.equal(stamped(out).nodes, 3, "nodes kept")
        expect.equal(Snapshot.parse(out).map(\.nodeCount), .success(3), "still a valid snapshot")
    },
    Check(group: "viewer", name: "a dead process is sent as ended, once, with a seq that keeps rising") { expect in
        var alive: Set<Int32> = [4242]
        var sessions = SessionRegistry(now: t0, isAlive: { alive.contains($0) })
        _ = sessions.accept(info("w", seq: 1, state: .waitingYou, pid: 4242), body: snapshotJSON(id: "w", seq: 1, state: "waiting_you"), now: t0)
        let first = sessions.pendingPushes(now: t0)
        expect.equal(first.count, 1)
        expect.equal(stamped(first.first ?? Data()).state, "waiting_you")
        expect.equal(sessions.pendingPushes(now: t0.addingTimeInterval(5)).count, 0, "nothing new: nothing sent")

        alive = []
        let gone = sessions.pendingPushes(now: t0.addingTimeInterval(10))
        expect.equal(gone.count, 1, "its state changed: one update")
        expect.equal(stamped(gone.first ?? Data()).state, "ended")
        expect.that((stamped(gone.first ?? Data()).seq ?? 0) > (stamped(first.first ?? Data()).seq ?? 0), "the viewer's seq rises")
        expect.equal(sessions.pendingPushes(now: t0.addingTimeInterval(15)).count, 0)
    },
    Check(group: "viewer", name: "30 min without a pid is sent as idle, once") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { _ in true })
        _ = sessions.accept(info("q", seq: 1, state: .waitingYou), body: snapshotJSON(id: "q", seq: 1, state: "waiting_you"), now: t0)
        _ = sessions.pendingPushes(now: t0)
        let later = t0.addingTimeInterval(SessionRegistry.staleAfter + 1)
        let pushes = sessions.pendingPushes(now: later)
        expect.equal(pushes.count, 1)
        expect.equal(stamped(pushes.first ?? Data()).state, "idle")
        expect.equal(sessions.pendingPushes(now: later.addingTimeInterval(5)).count, 0)
    },
    Check(group: "viewer", name: "a page that starts over gets every session in its effective state") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { $0 == 1 })
        _ = sessions.accept(info("live", seq: 1, state: .working, pid: 1), body: snapshotJSON(id: "live", seq: 1, state: "working"), now: t0)
        _ = sessions.accept(info("dead", seq: 1, state: .waitingYou, pid: 2), body: snapshotJSON(id: "dead", seq: 1, state: "waiting_you"), now: t0)
        let bodies = sessions.replayBodies(now: t0).map { stamped($0).state }
        expect.equal(bodies, ["working", "ended"])
    },
    Check(group: "viewer", name: "a new snapshot is sent in full, even when its state did not change") { expect in
        var sessions = SessionRegistry(now: t0, isAlive: { _ in true })
        _ = sessions.accept(info("a", seq: 1, state: .working), body: snapshotJSON(id: "a", seq: 1, state: "working"), now: t0)
        _ = sessions.pendingPushes(now: t0)
        _ = sessions.accept(info("a", seq: 2, state: .working), body: snapshotJSON(id: "a", seq: 2, state: "working"), now: t0.addingTimeInterval(1))
        expect.equal(sessions.pendingPushes(now: t0.addingTimeInterval(1)).count, 1)
    }
]

// MARK: - Sound choice

private let sound: [Check] = [
    Check(group: "sound", name: "four choices: off, and three styles; same as look is the default") { expect in
        expect.equal(SoundChoice.allCases.map(\.title), ["Off", "Same as Look", "Clean", "8-bit"])
        expect.equal(SoundChoice.standard, .look)
        expect.equal(SoundChoice.allCases.map(\.isOn), [false, true, true, true])
    },
    Check(group: "sound", name: "the stored sound flag and style give the choice") { expect in
        expect.equal(SoundChoice.from(sound: false, style: "pixel"), .off, "off stays off whatever the style")
        expect.equal(SoundChoice.from(sound: true, style: "look"), .look)
        expect.equal(SoundChoice.from(sound: true, style: "smooth"), .smooth)
        expect.equal(SoundChoice.from(sound: true, style: "pixel"), .pixel)
        expect.equal(SoundChoice.from(sound: true, style: "off"), .look, "a style that is not one is the default")
        expect.equal(SoundChoice.from(sound: true, style: "retro"), .look)
    }
]

// MARK: - Theme choice

private let theme: [Check] = [
    Check(group: "theme", name: "auto, dark and light; auto is the default and an unknown value is auto") { expect in
        expect.equal(ThemeChoice.allCases.map(\.rawValue), ["auto", "dark", "light"])
        expect.equal(ThemeChoice.allCases.map(\.title), ["Auto", "Dark", "Light"])
        expect.equal(ThemeChoice.standard, .auto)
        expect.equal(ThemeChoice.from("dark"), .dark)
        expect.equal(ThemeChoice.from("purple"), .auto)
        expect.equal(ThemeChoice.from(""), .auto)
    }
]
