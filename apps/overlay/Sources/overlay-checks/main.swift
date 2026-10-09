import Foundation
import OverlayChecks

// Runs the FlowCTLCore checks without XCTest, which the Command Line Tools lack.
var failed = 0
for check in OverlayChecks.all {
    let expect = Expect()
    check.body(expect)
    if expect.failures.isEmpty {
        print("ok   \(check.group): \(check.name)")
    } else {
        failed += 1
        print("FAIL \(check.group): \(check.name)")
        expect.failures.forEach { print("     \($0)") }
    }
}
print("\(OverlayChecks.all.count - failed) passed, \(failed) failed")
exit(failed == 0 ? 0 : 1)
