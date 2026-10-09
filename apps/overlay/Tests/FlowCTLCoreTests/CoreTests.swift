import OverlayChecks
import XCTest

/// The checks of OverlayChecks, one XCTest per group (`swift test` needs Xcode;
/// `swift run overlay-checks` runs the same checks without it).
final class CoreTests: XCTestCase {
    func testHTTP() { run("http") }
    func testSnapshot() { run("snapshot") }
    func testSessions() { run("sessions") }
    func testFiles() { run("files") }
    func testGeometry() { run("geometry") }
    func testFocus() { run("focus") }

    func testEveryGroupIsCovered() {
        XCTAssertEqual(Set(OverlayChecks.all.map(\.group)), ["http", "snapshot", "sessions", "files", "geometry", "focus"])
    }

    private func run(_ group: String) {
        let checks = OverlayChecks.all.filter { $0.group == group }
        XCTAssertFalse(checks.isEmpty)
        for check in checks {
            let expect = Expect()
            check.body(expect)
            for failure in expect.failures { XCTFail("\(check.name): \(failure)") }
        }
    }
}
