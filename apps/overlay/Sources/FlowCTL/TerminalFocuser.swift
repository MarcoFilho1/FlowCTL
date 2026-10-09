import AppKit
import FlowCTLCore

/// Brings a session's terminal forward when its node is clicked.
///
/// Terminal.app and iTerm2 are scripted to select the session's own tab,
/// which asks the person once for Automation permission (System Settings >
/// Privacy & Security > Automation). The script runs in `osascript`, off the
/// main thread, so a pending or refused prompt never freezes the panel; when
/// it cannot select the tab, the app is brought forward instead.
enum TerminalFocuser {
    static func focus(_ terminal: TerminalInfo?, completion: @escaping (String) -> Void = { log($0) }) {
        let action = FocusAction.plan(for: terminal)
        guard let script = action.appleScript else {
            activate(action.fallbackBundleId, because: "\(action)", completion: completion)
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let outcome = runAppleScript(script)
            DispatchQueue.main.async {
                switch outcome {
                case .success("found"):
                    completion("focused \(action)")
                case .success(let other):
                    activate(action.fallbackBundleId, because: "tab not found (\(other)) for \(action)", completion: completion)
                case .failure(let error):
                    activate(action.fallbackBundleId, because: "script failed for \(action): \(error)", completion: completion)
                }
            }
        }
    }

    private static func activate(_ bundleId: String?, because reason: String, completion: @escaping (String) -> Void) {
        guard let bundleId, let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            completion("nothing to focus: \(reason)")
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, error in
            DispatchQueue.main.async {
                completion(error.map { "could not activate \(bundleId): \($0.localizedDescription)" } ?? "activated \(bundleId) (\(reason))")
            }
        }
    }

    /// Runs a script with /usr/bin/osascript; stdout trimmed, or the error text.
    private static func runAppleScript(_ script: String) -> Result<String, ScriptError> {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        do {
            try process.run()
        } catch {
            return .failure(ScriptError(message: error.localizedDescription))
        }
        let timeout = DispatchWorkItem { if process.isRunning { process.terminate() } }
        // The first run waits for the person to answer the permission prompt.
        DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timeout)
        let output = out.fileHandleForReading.readDataToEndOfFile()
        let errors = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        timeout.cancel()
        guard process.terminationStatus == 0 else {
            // -1743: the person refused Automation for this app.
            return .failure(ScriptError(message: String(decoding: errors, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        return .success(String(decoding: output, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines))
    }

    struct ScriptError: Error, CustomStringConvertible {
        let message: String
        var description: String { message.isEmpty ? "osascript failed" : message }
    }
}
