import AppKit
import FlowCTLCore

/// Endpoints for checking a running overlay without Screen Recording or
/// Accessibility permissions. Served only when FLOWCTL_DEBUG=1.
///
///   GET  /debug/state            panel, sessions and menu as JSON
///   GET  /debug/capture          PNG of the panel (own window: no permission needed)
///   POST /debug/close            clicks the panel's close button
///   POST /debug/menu?item=Title  runs a menu bar item, as a click on it would
///   POST /debug/click            clicks the panel's title bar (it becomes key, as on a real click)
///   POST /debug/key?key=q        sends ⌘<key> to the panel through NSApp.sendEvent
enum DebugHooks {
    static let isEnabled = ProcessInfo.processInfo.environment["FLOWCTL_DEBUG"] == "1"

    /// Runs on the socket queue; the work happens on the main thread.
    static func route(_ request: HTTPRequest, app: AppDelegate) -> HTTPResponse? {
        guard isEnabled, request.path.hasPrefix("/debug/") else { return nil }
        let query = parameters(request.query)
        return DispatchQueue.main.sync {
            switch (request.method, request.path) {
            case ("GET", "/debug/state"):
                return json(app.debugState())
            case ("GET", "/debug/capture"):
                return capture(app.debugPanel).map { .ok($0 + "\n") } ?? .badRequest("capture failed")
            case ("POST", "/debug/close"):
                guard let button = app.debugPanel?.standardWindowButton(.closeButton) else { return .badRequest("no close button") }
                button.performClick(nil)
                return .ok()
            case ("POST", "/debug/menu"):
                guard let title = query["item"] else { return .badRequest("item= is required") }
                guard app.debugHasMenuItem(title) else { return .badRequest("no menu item titled \(title)") }
                // After the reply: "Quit FlowCTL" would end the process before it.
                DispatchQueue.main.async { _ = app.debugMenu(title) }
                return .ok()
            case ("POST", "/debug/click"):
                guard let panel = app.debugPanel else { return .badRequest("no panel") }
                return click(panel) ? .ok() : .badRequest("could not make the event")
            case ("POST", "/debug/key"):
                guard let key = query["key"], let panel = app.debugPanel else { return .badRequest("key= is required") }
                DispatchQueue.main.async { _ = sendCommandKey(key, to: panel) }
                return .ok()
            default:
                return .notFound
            }
        }
    }

    private static func json(_ object: Any) -> HTTPResponse {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys]) else {
            return .badRequest("state is not JSON")
        }
        return .ok(String(decoding: data, as: UTF8.self) + "\n")
    }

    private static func capture(_ panel: NSPanel?) -> String? {
        guard let panel, panel.windowNumber > 0,
              let image = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(panel.windowNumber), [.boundsIgnoreFraming, .bestResolution])
        else { return nil }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("flowctl-overlay-capture.png")
        return (try? png.write(to: url)) != nil ? url.path : nil
    }

    /// A mouse down and up in the middle of the title bar, through NSApp.sendEvent.
    private static func click(_ panel: NSPanel) -> Bool {
        let point = NSPoint(x: panel.frame.width / 2, y: panel.frame.height - 14)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0
            ) else { return false }
            NSApp.sendEvent(event)
        }
        return true
    }

    private static func sendCommandKey(_ key: String, to panel: NSPanel) -> Bool {
        guard let event = NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: panel.windowNumber, context: nil, characters: key, charactersIgnoringModifiers: key,
            isARepeat: false, keyCode: key == "q" ? 12 : key == "w" ? 13 : 0
        ) else { return false }
        NSApp.sendEvent(event)
        return true
    }
}

private func parameters(_ query: String) -> [String: String] {
    var components = URLComponents()
    components.percentEncodedQuery = query
    var result: [String: String] = [:]
    for item in components.queryItems ?? [] { result[item.name] = item.value ?? "" }
    return result
}
