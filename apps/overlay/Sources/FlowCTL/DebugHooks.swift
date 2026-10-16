import AppKit
import WebKit
import FlowCTLCore

/// Endpoints for checking a running overlay without Screen Recording or
/// Accessibility permissions. Served only when FLOWCTL_DEBUG=1.
///
///   GET  /debug/state            panel, sessions and menu as JSON
///   GET  /debug/capture          PNG of the panel (own window: no permission needed);
///                                ?window=control or ?window=settings for those windows
///   POST /debug/control?open=1|0 opens (kept open) or closes the menu bar panel
///   POST /debug/close            clicks the panel's close button
///   POST /debug/menu?item=Title  runs a menu bar item, as a click on it would
///   POST /debug/click            presses the grip (the page's grip, as the viewer reported it): the panel becomes key
///   POST /debug/focus?session=   the page posts { type: "focus" } through the real message handler
///   POST /debug/drag?x=&y=       moves the panel there and re-anchors, as after a drag
///   POST /debug/eval             runs the request body as JavaScript in the page; returns its result
///   GET  /debug/page-events      counts of pointer/mouse/wheel events the page saw
///                                (trusted = from WebKit, synthetic = from a relay)
///   POST /debug/drag-page?x=&y=&dx=&dy=&steps=   a press, drag and release in the page,
///                                through NSApp.sendEvent
///   POST /debug/wheel?x=&y=&dx=&dy=   a two-finger scroll at a page point, through NSApp.sendEvent
///   POST /debug/page-relays      calls __flowctlDrag (down, 3 moves, up) and __flowctlWheel in the page
///   POST /debug/pinch?x=&y=&m=0.1,0.1,-0.05   a pinch with these per-event magnifications, through the page view
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
                // window=control (the menu bar panel) or window=settings; the overlay otherwise.
                let window: NSWindow? = switch query["window"] {
                case "control": app.debugStatusMenu?.panel.debugWindow
                case "settings": app.debugStatusMenu?.settings.debugWindow
                default: app.debugPanel
                }
                return capture(window).map { .ok($0 + "\n") } ?? .badRequest("capture failed")
            case ("POST", "/debug/control"):
                // Opens the menu bar panel below the status item, kept open; open=0 closes it.
                guard let menu = app.debugStatusMenu else { return .badRequest("no status item") }
                menu.panel.keepOpen = query["open"] != "0"
                if menu.panel.keepOpen != menu.panel.isVisible { menu.debugClick() }
                return .ok()
            case ("POST", "/debug/close"):
                // The viewer's × sends this message; the bridge hides the panel as it did.
                app.debugBridge?.postFromPage(["type": "close"])
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
            case ("POST", "/debug/eval"):
                guard let webView = app.debugBridge?.webView else { return .badRequest("no page") }
                let source = String(decoding: request.body, as: UTF8.self)
                return .ok(evaluate(source, in: webView) + "\n")
            case ("GET", "/debug/page-events"):
                return pageEvents(app)
            case ("POST", "/debug/page-relays"):
                let script = """
                window.__flowctlDrag("down", 150, 100);
                for (const x of [170, 190, 210]) window.__flowctlDrag("move", x, 110);
                window.__flowctlDrag("up", 210, 110);
                window.__flowctlWheel(0, -40, 150, 100);
                """
                app.debugBridge?.webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                    if case .failure(let error) = result { log("page relays failed: \(error.localizedDescription)") }
                }
                return .ok()
            case ("POST", "/debug/drag-page"):
                guard let panel = app.debugPanel, let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else {
                    return .badRequest("x= and y= are required")
                }
                let dx = query["dx"].flatMap(Double.init) ?? 60, dy = query["dy"].flatMap(Double.init) ?? 0
                let steps = max(1, query["steps"].flatMap(Int.init) ?? 6)
                let start = pagePoint(x, y, in: panel)
                guard mouse([.leftMouseDown], at: start, in: panel) else { return .badRequest("could not make the event") }
                // One step a frame, as a hand drags; WebKit coalesces moves sent together.
                for step in 1...steps {
                    let k = Double(step) / Double(steps)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.016 * Double(step)) {
                        _ = mouse([.leftMouseDragged], at: NSPoint(x: start.x + dx * k, y: start.y - dy * k), in: panel)
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.016 * Double(steps + 1)) {
                    _ = mouse([.leftMouseUp], at: NSPoint(x: start.x + dx, y: start.y - dy), in: panel)
                }
                return .ok()
            case ("POST", "/debug/wheel"):
                guard let panel = app.debugPanel, let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else {
                    return .badRequest("x= and y= are required")
                }
                let dx = query["dx"].flatMap(Int32.init) ?? 0, dy = query["dy"].flatMap(Int32.init) ?? -40
                var flags: CGEventFlags = []
                if query["ctrl"] == "1" { flags.insert(.maskControl) }
                if query["cmd"] == "1" { flags.insert(.maskCommand) }
                return wheel(dx: dx, dy: dy, flags: flags, at: pagePoint(x, y, in: panel), in: panel) ? .ok() : .badRequest("could not make the event")
            case ("POST", "/debug/pinch"):
                guard let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else {
                    return .badRequest("x= and y= are required")
                }
                let steps = (query["m"] ?? "0.1").split(separator: ",").compactMap { Double($0) }
                app.debugBridge?.debugPinch(steps, atPage: CGPoint(x: x, y: y))
                return .ok()
            case ("POST", "/debug/mouse"):
                guard let panel = app.debugPanel, let x = query["x"].flatMap(Double.init), let y = query["y"].flatMap(Double.init) else {
                    return .badRequest("x= and y= are required")
                }
                // Page point (top-left origin, below the strip) to window point (bottom-left).
                let point = NSPoint(x: x, y: panel.frame.height - y)
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
                guard let panel = app.debugPanel, let grip = app.debugBridge?.debugGrip else { return .badRequest("no grip reported by the page") }
                let centre = pagePoint(grip.midX, grip.midY, in: panel)
                return mouse([.leftMouseDown, .leftMouseUp], at: centre, in: panel) ? .ok() : .badRequest("could not make the event")
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

    private static func capture(_ panel: NSWindow?) -> String? {
        guard let panel, panel.windowNumber > 0,
              let image = CGWindowListCreateImage(.null, .optionIncludingWindow, CGWindowID(panel.windowNumber), [.boundsIgnoreFraming, .bestResolution])
        else { return nil }
        let rep = NSBitmapImageRep(cgImage: image)
        guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
        let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("flowctl-overlay-capture.png")
        return (try? png.write(to: url)) != nil ? url.path : nil
    }

    /// Page point (top-left origin) to window point (bottom-left).
    private static func pagePoint(_ x: Double, _ y: Double, in panel: NSPanel) -> NSPoint {
        NSPoint(x: x, y: panel.frame.height - y)
    }

    /// A pixel scroll as a trackpad makes, made with CGEvent (NSEvent has no
    /// scroll constructor). Such an event carries no window, so it is handed
    /// to the view under the point, as AppKit does with a real one; its screen
    /// location is set so that its window location is the page point.
    private static func wheel(dx: Int32, dy: Int32, flags: CGEventFlags = [], at point: NSPoint, in panel: NSPanel) -> Bool {
        guard let cg = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) else { return false }
        cg.flags = flags
        cg.location = CGPoint(x: point.x, y: (NSScreen.screens.first?.frame.height ?? 0) - point.y)
        guard let event = NSEvent(cgEvent: cg), let view = panel.contentView?.hitTest(point) else { return false }
        view.scrollWheel(with: event)
        log("debug wheel: \(type(of: view)) at \(event.locationInWindow)")
        return true
    }

    /// Runs `source` in the page on the main thread and returns the result as text.
    private static func evaluate(_ source: String, in webView: WKWebView) -> String {
        var text = "undefined"
        var finished = false
        webView.evaluateJavaScript(source) { value, error in
            text = error.map { "error: \($0.localizedDescription)" } ?? value.map { "\($0)" } ?? "undefined"
            finished = true
        }
        let deadline = Date().addingTimeInterval(2)
        while !finished, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        return text
    }

    /// Installs a counter in the page on first call, then reads it.
    private static func pageEvents(_ app: AppDelegate) -> HTTPResponse {
        guard let webView = app.debugBridge?.webView else { return .badRequest("no page") }
        let script = """
        if (!window.__flowctlProbe) {
          window.__flowctlProbe = {};
          for (const type of ["pointerdown", "pointermove", "pointerup", "mousedown", "mousemove", "mouseup", "click", "wheel", "gesturestart", "gesturechange"]) {
            document.addEventListener(type, (event) => {
              const mods = type === "wheel" && (event.ctrlKey || event.metaKey) ? ".mod" : "";
              const key = type + mods + (event.isTrusted ? ".trusted" : ".synthetic");
              window.__flowctlProbe[key] = (window.__flowctlProbe[key] || 0) + 1;
            }, true);
          }
        }
        return JSON.stringify(window.__flowctlProbe);
        """
        let done = DispatchSemaphore(value: 0)
        var text = "{}"
        webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
            if case .success(let value) = result, let value = value as? String { text = value }
            done.signal()
        }
        // On the main thread already: spin the run loop while the page answers.
        let deadline = Date().addingTimeInterval(2)
        while done.wait(timeout: .now()) == .timedOut, Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.01))
        }
        return .ok(text + "\n")
    }

    private static func mouse(_ types: [NSEvent.EventType], at point: NSPoint, in panel: NSPanel) -> Bool {
        for type in types {
            guard let event = NSEvent.mouseEvent(
                with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: panel.windowNumber, context: nil, eventNumber: 0,
                clickCount: type == .mouseMoved || type == .leftMouseDragged ? 0 : 1,
                pressure: type == .leftMouseUp || type == .mouseMoved ? 0 : 1
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
