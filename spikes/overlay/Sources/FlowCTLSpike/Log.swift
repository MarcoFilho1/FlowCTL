import Foundation

/// Monotonic milliseconds, used to measure POST → evaluateJavaScript → paint.
func nowMs() -> Double {
    Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000
}

func log(_ message: String) {
    let stamp = ISO8601DateFormatter.string(
        from: Date(), timeZone: .current, formatOptions: [.withInternetDateTime, .withFractionalSeconds])
    FileHandle.standardError.write("[\(stamp)] \(message)\n".data(using: .utf8)!)
}
