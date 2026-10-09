import AppKit
import FlowCTLCore

/// Endpoints for checking a running overlay without Screen Recording or
/// Accessibility permissions. Served only when FLOWCTL_DEBUG=1.
///
///   GET  /debug/state            panel, sessions and menu as JSON
///   GET  /debug/capture          PNG of the panel (own window: no permission needed)
///   POST /debug/close            clicks the panel's close button
///   POST /debug/menu?item=Title  runs a menu bar item, as a click on it would
///   POST /debug/click            clicks the panel's strip (it becomes key, as on a real click)
///   POST /debug/focus?session=   the page posts { type: "focus" } through the real message handler
///   POST /debug/drag?x=&y=       moves the panel there and re-anchors, as after a drag
///   POST /debug/mouse?x=&y=&type=move|click   a mouse event at a point of the page
///                                (from its top-left): a click through NSApp.sendEvent,
///                                a move through the hover relay
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
                guard let button = app.debugPanel?.closeButton else { return .badRequest("no close button") }
                button.performClick(nil)
                return .ok()
            case ("POST", "/debug/menu"):
                guard let title = query["item"] else { return .badRequest("item= is required") }
                guard app.debugHasMenuItem(title) else { return .badRequest("no menu item titled \(title)") }
                // After the reply: "Quit FlowCTL" would end the process before it.
                DispatchQueue.main.async { _ = app.debugMenu(title) }
                return .ok()
            case ("POST", "/debug/focus"):
                guard let session = query["session"] else { return .badRequest("session= is required") }
                app.debugBridge?.postFromPage(["type": "focus", "sessionId": session, "nodeId": query["node"] ?? ""])
                return .ok()
            case ("POST", "/debug/drag"):
                guard let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else { return .badRequest("x= and y= are required") }
                app.debugDrag(to: CGPoint(x: x, y: y))
                return .ok()
            case ("POST", "/debug/mouse"):
                guard let panel = app.debugPanel, let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else {
                    return .badRequest("x= and y= are required")
                }
                // Page point (top-left origin, below the strip) to window point (bottom-left).
                let point = NSPoint(x: x, y: panel.frame.height - OverlayPanel.stripHeight - y)
                if query["type"] == "click" {
                    return mouse([.leftMouseDown, .leftMouseUp], at: point, in: panel) ? .ok() : .badRequest("could not make the event")
                }
                // A move enters where the always-on tracking area would hand it in.
                guard let relay = app.debugBridge?.hover, let event = NSEvent.mouseEvent(
                    with: .mouseMoved, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                    windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 0, pressure: 0
                ) else { return .badRequest("could not make the event") }
                relay.mouseMoved(with: event)
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

    /// A mouse down and up in the middle of the strip, through NSApp.sendEvent.
    private static func click(_ panel: NSPanel) -> Bool {
        mouse([.leftMouseDown, .leftMouseUp], at: NSPoint(x: panel.frame.width / 2, y: panel.frame.height - 9), in: panel)
    }

    private static func mouse(_ types: [NSEvent.EventType], at point: NSPoint, in panel: NSPanel) -> Bool {
        for type in types {
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: type == .mouseMoved ? 0 : 1,
                pressure: type == .leftMouseDown ? 1 : 0
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
