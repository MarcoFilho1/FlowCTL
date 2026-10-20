import AppKit
import FlowCTLCore
import WebKit

/// The snail's window: small, transparent and floating, it walks along the
/// bottom of the screen, on top of the Dock when the Dock is there. The viewer
/// draws the snail and decides where it goes (`?ui=pet`); this window moves by
/// the steps the page asks for, tells it the room it has, where the mouse is
/// and whether a session waits, and lets clicks through everywhere but on the
/// snail itself.
final class PetWindow: NSObject, WKNavigationDelegate {
    /// The window's size; the snail stands in its bottom middle.
    static let size = CGSize(width: 240, height: 112)
    /// The page draws the snail's feet this far above the window's bottom.
    private static let feetUp: CGFloat = 2
    /// Where the snail itself is, in the window (bottom middle): only there does it take clicks.
    private static let body = CGRect(x: 75, y: 0, width: 90, height: 62)
    /// The mouse counts as near within this distance of the snail.
    private static let near: CGFloat = 140

    private let panel: NSPanel
    private let webView: WKWebView
    private var isReady = false
    /// Calls waiting for the page to load.
    private var waiting: [() -> Void] = []
    private var timer: Timer?
    private var screen: NSScreen?
    private var flying = false
    private var whenTucked: (() -> Void)?

    /// The snail was clicked.
    var onClick: (() -> Void)?
    var isOut: Bool { panel.isVisible }

    init(page: URL) {
        let configuration = WKWebViewConfiguration()
        let messages = PetMessages()
        configuration.userContentController.add(messages, name: "flowctl")
        // The page is the viewer's, told to be the snail's (as ?ui=pet would; a file URL takes no query).
        configuration.userContentController.addUserScript(WKUserScript(source: "window.__flowctlUI = 'pet'", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        webView = WKWebView(frame: CGRect(origin: .zero, size: Self.size), configuration: configuration)
        panel = NSPanel(contentRect: CGRect(origin: .zero, size: Self.size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        messages.pet = self
        if webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) || webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        webView.underPageBackgroundColor = .clear
        webView.navigationDelegate = self
        webView.setAccessibilityLabel("FlowCTL snail")

        panel.title = "FlowCTL snail"
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        // Every Space, but not over full-screen apps: it walks the desktop.
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.contentView = webView

        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        let wait = "for (let i = 0; i < 50 && !window.flowctlPet; i++) await new Promise((r) => setTimeout(r, 20)); return !!window.flowctlPet"
        webView.callAsyncJavaScript(wait, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, (value as? Bool) == true {} else { log("pet: window.flowctlPet never appeared") }
            self.isReady = true
            let calls = self.waiting
            self.waiting.removeAll()
            calls.forEach { $0() }
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("pet: web content process ended; reloading")
        isReady = false
        webView.reload()
    }

    // MARK: Out and back

    /// The snail formed in the overlay with its feet at `feet` (screen
    /// coordinates): the window takes it from exactly there, in its shell, and
    /// drops it to the walking line, where it comes out.
    func emerge(at feet: CGPoint, look: PageLook, theme: ThemeChoice, screen: NSScreen?) {
        self.screen = screen ?? NSScreen.main
        call("setLook", look.rawValue)
        call("setTheme", theme.rawValue)
        call("setMood", "calm")
        panel.setFrame(frame(feet: feet), display: true)
        panel.alphaValue = 1
        panel.orderFrontRegardless()
        let landing = frame(feet: CGPoint(x: clampX(feet.x), y: walkingLine()))
        flying = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.55
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().setFrame(landing, display: true)
        }, completionHandler: { [weak self] in
            guard let self else { return }
            self.flying = false
            self.reportRoom()
            self.call("land")
            self.startWatching()
        })
    }

    /// Back to the overlay: into the shell, a flight to `feet` (where the
    /// snail stands in the panel), then gone. `done` runs on arrival.
    func retreat(to feet: CGPoint, done: @escaping () -> Void) {
        guard panel.isVisible, !flying else { return done() }
        flying = true
        stopWatching()
        whenTucked = { [weak self] in
            guard let self else { return }
            let target = self.frame(feet: feet)
            // Up first, then over: a hop rather than a slide along the Dock.
            let lift = self.panel.frame.offsetBy(dx: 0, dy: 70)
            NSAnimationContext.runAnimationGroup({ context in
                context.duration = 0.22
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                self.panel.animator().setFrame(lift, display: true)
            }, completionHandler: {
                NSAnimationContext.runAnimationGroup({ context in
                    context.duration = 0.45
                    context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                    self.panel.animator().setFrame(target, display: true)
                }, completionHandler: {
                    self.flying = false
                    done()
                    // A beat so the overlay is up before the window goes.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.12) { self.panel.orderOut(nil) }
                })
            })
        }
        call("leave")
        // A page that never answers still goes home.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.tucked() }
    }

    /// Hides it at once (the snail turned off, the app quitting).
    func vanish() {
        stopWatching()
        flying = false
        whenTucked = nil
        panel.orderOut(nil)
    }

    func setAlert(_ alert: Bool) {
        call("setMood", alert ? "alert" : "calm")
    }

    func apply(look: PageLook, theme: ThemeChoice) {
        call("setLook", look.rawValue)
        call("setTheme", theme.rawValue)
    }

    // MARK: From the page

    fileprivate func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "petMove":
            guard let dx = (message["dx"] as? NSNumber)?.doubleValue, dx.isFinite, abs(dx) <= 20, !flying, panel.isVisible else { return }
            var frame = panel.frame
            frame.origin.x = clampX(frame.midX + dx) - frame.width / 2
            frame.origin.y = walkingLine() - Self.feetUp
            panel.setFrameOrigin(frame.origin)
            reportRoom()
        case "petTucked":
            tucked()
        case "petClick":
            onClick?()
        default:
            break
        }
    }

    private func tucked() {
        let next = whenTucked
        whenTucked = nil
        next?()
    }

    // MARK: Where it walks

    /// The walking line: the top of the Dock when it sits along the bottom,
    /// else the screen's bottom edge (a hidden Dock, or one at a side).
    private func walkingLine() -> CGFloat {
        guard let screen = screen ?? NSScreen.main else { return 0 }
        return screen.visibleFrame.minY > screen.frame.minY ? screen.visibleFrame.minY : screen.frame.minY
    }

    /// The window's frame with the snail's feet at `feet`.
    private func frame(feet: CGPoint) -> CGRect {
        CGRect(x: feet.x - Self.size.width / 2, y: feet.y - Self.feetUp, width: Self.size.width, height: Self.size.height)
    }

    /// Keeps the snail on its screen.
    private func clampX(_ x: CGFloat) -> CGFloat {
        guard let screen = screen ?? NSScreen.main else { return x }
        let edge = screen.frame
        return min(max(x, edge.minX + 30), edge.maxX - 30)
    }

    private func reportRoom() {
        guard let screen = screen ?? NSScreen.main else { return }
        let x = panel.frame.midX
        call("setRoom", [Double(x - screen.frame.minX - 30), Double(screen.frame.maxX - 30 - x)])
    }

    /// Ten times a second: the mouse (near or not, and whether it is on the
    /// snail, which then takes clicks), and the walking line (the Dock may
    /// have hidden or shown).
    private func startWatching() {
        stopWatching()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.watch() }
    }

    private func stopWatching() {
        timer?.invalidate()
        timer = nil
        panel.ignoresMouseEvents = true
    }

    private var lastMouse: CGFloat?? = .none

    private func watch() {
        guard panel.isVisible, !flying else { return }
        let line = walkingLine() - Self.feetUp
        if abs(panel.frame.minY - line) > 0.5 { panel.setFrameOrigin(CGPoint(x: panel.frame.minX, y: line)) }
        let mouse = NSEvent.mouseLocation
        let frame = panel.frame
        let body = Self.body.offsetBy(dx: frame.minX, dy: frame.minY)
        panel.ignoresMouseEvents = !body.contains(mouse)
        let isNear = abs(mouse.x - frame.midX) < Self.near && mouse.y < frame.maxY + 40 && mouse.y > frame.minY - 20
        let pageX: CGFloat? = isNear ? mouse.x - frame.minX : nil
        if case .some(let last) = lastMouse, last == pageX { return }
        lastMouse = .some(pageX)
        call("setMouse", pageX.map { Double($0) as Any } ?? NSNull())
    }

    /// `window.flowctlPet.<name>(...)` once the page is up. `name` is always a literal from this file.
    private func call(_ name: String, _ value: Any? = nil) {
        guard isReady else {
            waiting.append { [weak self] in self?.call(name, value) }
            return
        }
        let args: [Any]
        if let list = value as? [Any] { args = list } else if let value { args = [value] } else { args = [] }
        let script = "const p = window.flowctlPet; if (p && typeof p.\(name) === 'function') { p.\(name)(...args); return true } return false"
        webView.callAsyncJavaScript(script, arguments: ["args": args], in: nil, in: .page) { result in
            if case .failure(let error) = result { log("pet \(name) failed: \(error.localizedDescription)") }
        }
    }

    // MARK: Debug hooks

    var debugWebView: WKWebView { webView }
    var debugFrame: CGRect { panel.frame }
    var debugPanel: NSWindow { panel }
}

/// The page's messages, held weakly as WebBridge's are.
private final class PetMessages: NSObject, WKScriptMessageHandler {
    weak var pet: PetWindow?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        pet?.receive(message.body)
    }
}
