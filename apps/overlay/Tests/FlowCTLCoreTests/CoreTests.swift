import OverlayChecks
import XCTest

/// Every check of OverlayChecks under XCTest (`swift test` needs Xcode;
/// `swift run overlay-checks` runs the same checks without it). One test runs
/// them all, so a new group of checks is covered without being listed here.
final class CoreTests: XCTestCase {
    func testAllChecks() {
        XCTAssertFalse(OverlayChecks.all.isEmpty)
        for check in OverlayChecks.all {
            let expect = Expect()
            check.body(expect)
            for failure in expect.failures { XCTFail("\(check.group) · \(check.name): \(failure)") }
        }
    }
}
