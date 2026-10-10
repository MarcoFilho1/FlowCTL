import FlowCTLCore
import WebKit

/// The viewer page and the ways in and out of it. In: `window.flowctl.push(snapshot)`,
/// the snapshot crossing as an argument, never spliced into script text. Out:
/// `window.webkit.messageHandlers.flowctl.postMessage(...)` with
/// `{ type: "focus", sessionId, nodeId }` (a node was clicked). The window's
/// size is the person's choice (Size in the menu bar), so `{ type: "size" }`,
/// which older viewers send, is ignored.
final class WebBridge: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private let page: URL
    private var isReady = false
    private var queued: [Data] = []
    /// Asked for every snapshot to push again when the page had to load anew.
    var currentBodies: () -> [Data] = { [] }
    /// A node was clicked.
    var onFocus: ((_ sessionId: String, _ nodeId: String?) -> Void)?
    /// The look the person picked (pixel by default), applied on every load.
    var currentLook: () -> PageLook = { .standard }
    /// Whether the person wants subagents drawn (on by default).
    var currentShowSubagents: () -> Bool = { true }
    /// Whether the viewer plays its sounds (on by default).
    var currentSound: () -> Bool = { true }
    /// Whether the graph forms its shapes when idle (on by default).
    var currentIdleAnimation: () -> Bool = { true }
    /// The palette the person picked (auto by default).
    var currentTheme: () -> String = { ThemeChoice.standard.rawValue }
    /// The style of the sounds (look by default).
    var currentSoundStyle: () -> String = { SoundChoice.standard.rawValue }
    /// Hands the page hover moves while the app is inactive.
    let hover = HoverRelay()

    init(page: URL) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        // The overlay's sounds play without a click: no media type needs a user gesture.
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let messages = MessageProxy()
        configuration.userContentController.add(messages, name: "flowctl")
        configuration.userContentController.addUserScript(WKUserScript(source: HoverRelay.pageScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = PageView(frame: .zero, configuration: configuration)
        webView = view
        super.init()
        messages.bridge = self
        webView.navigationDelegate = self
        webView.setAccessibilityLabel("FlowCTL task graph")
        // The page is transparent over whatever is behind the panel, in either theme.
        // `drawsBackground` is private; skip it rather than crash if it is ever gone.
        if webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) || webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        webView.underPageBackgroundColor = .clear
        // WKWebView tracks the mouse only while its app is active, and the
        // overlay's never is: relay moves from a tracking area that is always on.
        view.bridge = self
        hover.webView = webView
        webView.addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: hover))
        load()
    }

    func push(_ body: Data) {
        if isReady { send(body) } else { queued.append(body) }
    }

    /// Closes a session's tab: `window.flowctl.remove(sessionId)`, or a fresh
    /// page with `remaining` pushed again on a viewer too old to have it.
    func remove(_ sessionId: String, remaining: @escaping () -> [Data]) {
        guard isReady else {
            reload(replaying: remaining())
            return
        }
        let script = "if (window.flowctl && typeof window.flowctl.remove === 'function') { window.flowctl.remove(sessionId); return true } return false"
        webView.callAsyncJavaScript(script, arguments: ["sessionId": sessionId], in: nil, in: .page) { [weak self] result in
            if case .success(let removed) = result, (removed as? Bool) == true { return }
            log("the page cannot remove \(sessionId); reloading it")
            self?.reload(replaying: remaining())
        }
    }

    /// Loads the page again and pushes `bodies` once it is up.
    func reload(replaying bodies: [Data]) {
        queued = bodies
        load()
    }

    private func load() {
        isReady = false
        log("loading \(page.path)")
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    private func send(_ body: Data) {
        let script = "return window.flowctl ? window.flowctl.push(JSON.parse(snapshot)) : false"
        webView.callAsyncJavaScript(script, arguments: ["snapshot": String(decoding: body, as: UTF8.self)], in: nil, in: .page) { result in
            switch result {
            case .failure(let error): log("push failed: \(error.localizedDescription)")
            case .success(let value): if (value as? Bool) == false { log("the page dropped a snapshot") }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The page's script may still be setting up window.flowctl when the
        // load finishes: wait for it (up to a second) before pushing.
        let wait = "for (let i = 0; i < 50 && !window.flowctl; i++) await new Promise((r) => setTimeout(r, 20)); return !!window.flowctl"
        webView.callAsyncJavaScript(wait, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, (value as? Bool) == true {} else { log("window.flowctl never appeared") }
            self.isReady = true
            // The look first, so the sessions below are drawn in it.
            self.applyLook(self.currentLook())
            self.applyTheme(self.currentTheme())
            self.applyShowSubagents(self.currentShowSubagents())
            self.applySound(self.currentSound())
            self.applySoundStyle(self.currentSoundStyle())
            self.applyIdleAnimation(self.currentIdleAnimation())
            let pending = self.queued
            self.queued.removeAll()
            pending.forEach(self.send)
        }
    }

    /// `window.flowctl.setLook(look)`, when the viewer has it (PR #27 added it;
    /// an older viewer keeps drawing as it does and the overlay logs that).
    /// Waits for the page: a look picked while it loads is applied on load.
    func applyLook(_ look: PageLook) {
        setPageOption("setLook", value: look.rawValue, what: "look \(look.rawValue)", missing: "the viewer has no setLook yet")
    }

    /// `window.flowctl.setShowSubagents(show)`, the same way: applied on every
    /// load, and logged as not applied to a viewer that does not have it yet.
    func applyShowSubagents(_ show: Bool) {
        setPageOption("setShowSubagents", value: show, what: "subagents \(show ? "shown" : "hidden")", missing: "the viewer has no setShowSubagents yet")
    }

    /// `window.flowctl.setIdleAnimation(on)`, the same way: applied on every load.
    func applyIdleAnimation(_ on: Bool) {
        setPageOption("setIdleAnimation", value: on, what: "idle animation \(on ? "on" : "off")", missing: "the viewer has no setIdleAnimation yet")
    }

    /// `window.flowctl.setTheme(theme)`, the same way, right after the look.
    func applyTheme(_ theme: String) {
        setPageOption("setTheme", value: theme, what: "theme \(theme)", missing: "the viewer has no setTheme yet")
    }

    /// `window.flowctl.setSoundStyle(style)`, the same way, after setSound.
    func applySoundStyle(_ style: String) {
        setPageOption("setSoundStyle", value: style, what: "sound style \(style)", missing: "the viewer has no setSoundStyle yet")
    }

    /// `window.flowctl.setSound(on)`, the same way: applied on every load.
    func applySound(_ on: Bool) {
        setPageOption("setSound", value: on, what: "sound \(on ? "on" : "off")", missing: "the viewer has no setSound yet")
    }

    /// Calls `window.flowctl.<name>(value)` when the page has it. `name` is
    /// always one of the literals above, so it is safe to put in the script.
    private func setPageOption(_ name: String, value: Any, what: String, missing: String) {
        guard isReady else { return }
        let script = "if (window.flowctl && typeof window.flowctl.\(name) === 'function') { window.flowctl.\(name)(value); return true } return false"
        webView.callAsyncJavaScript(script, arguments: ["value": value], in: nil, in: .page) { result in
            switch result {
            case .failure(let error): log("\(what) failed: \(error.localizedDescription)")
            case .success(let applied):
                log((applied as? Bool) == true ? "\(what) applied" : "\(what) not applied: \(missing)")
            }
        }
    }

    /// The grip as the viewer last reported it (debug hooks).
    var debugGrip: CGRect? { (webView as? PageView)?.grip }

    /// The person dragged the panel by the grip: the anchor is re-read from where it is now.
    var onGripDragEnded: (() -> Void)?
    /// The viewer's × was clicked: hide the panel, as the native one did.
    var onClose: (() -> Void)?

    fileprivate func gripDragEnded() {
        onGripDragEnded?()
    }

    fileprivate func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "grip":
            guard let x = (message["x"] as? NSNumber)?.doubleValue, let y = (message["y"] as? NSNumber)?.doubleValue,
                  let width = (message["width"] as? NSNumber)?.doubleValue, let height = (message["height"] as? NSNumber)?.doubleValue,
                  [x, y, width, height].allSatisfy(\.isFinite), width >= 0, height >= 0
            else { return log("ignored a grip message: \(message)") }
            (webView as? PageView)?.grip = width > 0 && height > 0 ? CGRect(x: x, y: y, width: width, height: height) : nil
            log("grip: \(x),\(y) \(width)x\(height)")
        case "close":
            onClose?()
        case "size":
            break
        case "focus":
            guard let sessionId = message["sessionId"] as? String, !sessionId.isEmpty else { return }
            onFocus?(sessionId, message["nodeId"] as? String)
        default:
            log("ignored a \(type) message from the page")
        }
    }

    /// A pinch, phase by phase: the page gets gesturestart, gesturechange (the
    /// running scale) and gestureend, with the point the pinch is at.
    private var pinchScale: CGFloat = 1

    func receivePinch(_ event: NSEvent) {
        var point = webView.convert(event.locationInWindow, from: nil)
        if !webView.isFlipped { point.y = webView.bounds.height - point.y }
        switch event.phase {
        case .began:
            pinchScale = 1
            pinch("start", scale: 1, at: point)
        case .changed:
            pinchScale *= 1 + event.magnification
            pinch("change", scale: pinchScale, at: point)
        case .ended, .cancelled:
            pinch("end", scale: pinchScale, at: point)
        default:
            break
        }
    }

    /// A pinch made of these per-event magnifications, from a page point (debug hooks).
    func debugPinch(_ magnifications: [Double], atPage point: CGPoint) {
        pinchScale = 1
        pinch("start", scale: 1, at: point)
        for magnification in magnifications {
            pinchScale *= 1 + CGFloat(magnification)
            pinch("change", scale: pinchScale, at: point)
        }
        pinch("end", scale: pinchScale, at: point)
    }

    private func pinch(_ phase: String, scale: CGFloat, at point: CGPoint) {
        webView.callAsyncJavaScript("window.__flowctlPinch && window.__flowctlPinch(phase, scale, x, y)", arguments: ["phase": phase, "scale": Double(scale), "x": Double(point.x), "y": Double(point.y)], in: nil, in: .page) { result in
            if case .failure(let error) = result { log("pinch \(phase) failed: \(error.localizedDescription)") }
        }
    }

    /// Posts a message from inside the page, as the viewer does (debug hooks).
    func postFromPage(_ message: [String: Any]) {
        webView.callAsyncJavaScript("window.webkit.messageHandlers.flowctl.postMessage(message)", arguments: ["message": message], in: nil, in: .page) { result in
            if case .failure(let error) = result { log("postMessage failed: \(error.localizedDescription)") }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("page failed: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("web content process ended; reloading")
        reload(replaying: currentBodies())
    }
}

/// The script message handler, held weakly: WKUserContentController keeps its
/// handlers alive, and the bridge owns the web view.
private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var bridge: WebBridge?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        bridge?.receive(message.body)
    }
}

/// The page's web view. A trackpad pinch arrives here as `magnify(with:)`; it
/// is passed to the page as the gesture events the viewer listens to, and not
/// to WebKit, so no gesture is raised twice.
final class PageView: WKWebView {
    weak var bridge: WebBridge?

    /// The grip the viewer draws in its top bar, in page points from the top-left.
    /// Nil or empty: no grip.
    var grip: CGRect? {
        didSet { window?.invalidateCursorRects(for: self) }
    }

    override func magnify(with event: NSEvent) {
        bridge?.receivePinch(event)
    }

    /// The panel never activates, so its first click would otherwise only make it
    /// key and be lost: the page takes the press on the first click too.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    /// The page point (top-left origin, as the viewer lays out) of a window point.
    private func pagePoint(of event: NSEvent) -> CGPoint {
        let point = convert(event.locationInWindow, from: nil)
        return CGPoint(x: point.x, y: isFlipped ? point.y : bounds.height - point.y)
    }

    /// The grip in this view's own coordinates (its origin at the bottom unless flipped).
    private func gripInView() -> CGRect? {
        guard let grip, grip.width > 0, grip.height > 0 else { return nil }
        let y = isFlipped ? grip.minY : bounds.height - grip.maxY
        return CGRect(x: grip.minX, y: y, width: grip.width, height: grip.height)
    }

    /// A press on the grip drags the window, and makes the panel key so ⌘W and
    /// ⌘Q work after it; a press anywhere else is the page's, as before.
    override func mouseDown(with event: NSEvent) {
        guard let grip, grip.width > 0, grip.contains(pagePoint(of: event)) else {
            super.mouseDown(with: event)
            return
        }
        (window as? OverlayPanel)?.allowKey()
        window?.performDrag(with: event)
        bridge?.gripDragEnded()
    }

    override func resetCursorRects() {
        super.resetCursorRects()
        if let rect = gripInView() {
            addCursorRect(rect, cursor: .openHand)
        }
    }
}

/// Owner of the web view's always-on tracking area. WebKit ignores mouse
/// moves while its app is inactive, and the overlay's always is, so hover
/// would never reach the page; this hands each move to `pageScript`, which
/// raises the mouseover/mouseout pair a real move would (React derives
/// onMouseEnter/onMouseLeave from those). `pageScript` also defines
/// `__flowctlDrag` and `__flowctlWheel`, the same for presses and scrolls.
final class HoverRelay: NSResponder {
    static let pageScript = """
    (() => {
      // Hover: the mouseover/mouseout pair a real move raises.
      let last = null;
      let at = { x: -1, y: -1 };
      window.__flowctlPointer = (x, y) => {
        at = { x, y };
        const target = x < 0 ? null : document.elementFromPoint(x, y);
        if (target === last) return;
        const init = (related) => ({ bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, relatedTarget: related });
        if (last && last.isConnected) last.dispatchEvent(new MouseEvent("mouseout", init(target)));
        if (target) target.dispatchEvent(new MouseEvent("mouseover", init(last)));
        last = target;
      };

      // Pinch: a trackpad pinch as the gesture events the viewer listens to.
      // `scale` is the running scale of the pinch, starting at 1 on "start".
      window.__flowctlPinch = (phase, scale, x, y) => {
        const target = (x >= 0 && document.elementFromPoint(x, y)) || document.body;
        const type = phase === "start" ? "gesturestart" : phase === "end" ? "gestureend" : "gesturechange";
        const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
        Object.defineProperty(event, "scale", { value: scale });
        Object.defineProperty(event, "clientX", { value: x });
        Object.defineProperty(event, "clientY", { value: y });
        target.dispatchEvent(event);
      };

      // Drag: pointerdown, pointermove (buttons 1) and pointerup on the element
      // under the press, pointerId 1, with the matching mouse events; a press
      // that moved less than 4 px also clicks.
      let press = null;
      window.__flowctlDrag = (phase, x, y) => {
        at = { x, y };
        if (phase === "down") press = { target: document.elementFromPoint(x, y), x, y, moved: 0 };
        const target = press && press.target && press.target.isConnected ? press.target : document.elementFromPoint(x, y);
        if (!target) return;
        if (press) press.moved = Math.max(press.moved, Math.hypot(x - press.x, y - press.y));
        const pointer = { down: "pointerdown", move: "pointermove", up: "pointerup" }[phase];
        const mouse = { down: "mousedown", move: "mousemove", up: "mouseup" }[phase];
        if (!pointer) return;
        const init = {
          bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
          pointerId: 1, pointerType: "mouse", isPrimary: true,
          button: phase === "move" ? -1 : 0, buttons: phase === "up" ? 0 : 1
        };
        target.dispatchEvent(new PointerEvent(pointer, init));
        target.dispatchEvent(new MouseEvent(mouse, { ...init, button: 0 }));
        if (phase === "up") {
          if (press && press.moved < 4) target.dispatchEvent(new MouseEvent("click", { ...init, button: 0, detail: 1 }));
          press = null;
        }
      };

      // Wheel and two-finger trackpad scroll, in pixels, at a point (or the
      // last one the pointer was seen at).
      window.__flowctlWheel = (dx, dy, x, y) => {
        const px = x ?? at.x, py = y ?? at.y;
        const target = (px >= 0 ? document.elementFromPoint(px, py) : null) || document.body;
        target.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, composed: true, view: window,
          clientX: px, clientY: py, deltaX: dx, deltaY: dy, deltaMode: 0
        }));
      };
    })();
    """

    weak var webView: WKWebView?
    /// Moves relayed so far (debug state).
    private(set) var moves = 0
    private var inFlight = false
    private var pending: CGPoint?

    override func mouseMoved(with event: NSEvent) {
        moves += 1
        guard let webView else { return }
        var point = webView.convert(event.locationInWindow, from: nil)
        if !webView.isFlipped { point.y = webView.bounds.height - point.y }
        send(point)
    }

    override func mouseExited(with event: NSEvent) {
        send(CGPoint(x: -1, y: -1))
    }

    /// One call in flight at a time; the latest point waits for it.
    private func send(_ point: CGPoint) {
        guard !inFlight else {
            pending = point
            return
        }
        inFlight = true
        webView?.callAsyncJavaScript("window.__flowctlPointer && window.__flowctlPointer(x, y)", arguments: ["x": Double(point.x), "y": Double(point.y)], in: nil, in: .page) { [weak self] _ in
            guard let self else { return }
            self.inFlight = false
            if let next = self.pending {
                self.pending = nil
                self.send(next)
            }
        }
    }
}
