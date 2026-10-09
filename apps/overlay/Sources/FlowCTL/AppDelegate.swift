import AppKit
import FlowCTLCore

final class AppDelegate: NSObject, NSApplicationDelegate, StatusMenuActions {
    let preferences = Preferences()
    private let paths = Paths()
    private var registry = SessionRegistry(now: Date())
    private var panel: OverlayPanel?
    private var bridge: WebBridge?
    private var server: SocketServer?
    private var statusMenu: StatusMenu?
    private var timers: [Timer] = []
    /// The person hid the panel; only a new session or one waiting on them brings it back.
    private var userHidden = false
    /// The corner the panel keeps fixed while it grows, and where that corner is.
    private var anchor: (corner: Corner, point: CGPoint) = (.topRight, .zero)

    func applicationDidFinishLaunching(_ notification: Notification) {
        if SocketServer.isServing(at: paths.socket.path) {
            log("another FlowCTL already serves \(paths.socket.path); quitting")
            NSApp.terminate(nil)
            return
        }
        do {
            try paths.prepare()
        } catch {
            log("cannot prepare \(paths.root.path): \(error)")
        }

        NSApp.mainMenu = Self.mainMenu()
        let bridge = WebBridge(page: paths.viewerPage)
        bridge.currentBodies = { [weak self] in self?.registry.bodies ?? [] }
        bridge.onFocus = { [weak self] sessionId, nodeId in self?.focusTerminal(of: sessionId, node: nodeId) }
        bridge.currentLook = { [weak self] in self?.preferences.look ?? .standard }
        self.bridge = bridge
        let panel = OverlayPanel(content: bridge.webView)
        panel.onHide = { [weak self] in self?.hidePanel(byUser: true) }
        panel.onDragEnded = { [weak self] in self?.reanchor() }
        self.panel = panel
        anchor = restoredAnchor()
        layOut(animated: false)
        applyPreferences()
        statusMenu = StatusMenu(actions: self)

        restoreSessions()
        startServer()
        showPanel()

        timers = [
            Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() },
            Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in self?.cleanUpFiles() }
        ]
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    /// Opening the app again (Finder, Spotlight, `open -a FlowCTL`) shows the panel.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showPanel()
        return false
    }

    // MARK: Sessions

    /// The sessions the mod left on disk while the overlay was closed.
    private func restoreSessions() {
        let plan = cleanUpFiles()
        for entry in plan.show {
            guard case let .success(info) = Snapshot.parse(entry.data) else { continue }
            _ = registry.accept(info, body: entry.data, now: entry.modified)
            bridge?.push(entry.data)
        }
        log("restored \(plan.show.count) session(s) from \(paths.sessions.path)")
    }

    /// Deletes ended and day-old snapshot files; returns the plan it followed.
    @discardableResult
    private func cleanUpFiles() -> SessionFiles.Plan {
        let plan = SessionFiles.plan(SessionFiles.read(directory: paths.sessions), now: Date())
        for name in plan.delete {
            try? FileManager.default.removeItem(at: paths.sessions.appendingPathComponent(name))
        }
        if !plan.delete.isEmpty { log("deleted \(plan.delete.count) old snapshot file(s)") }
        return plan
    }

    private func startServer() {
        let server = SocketServer(path: paths.socket.path) { [weak self] request in
            self?.route(request) ?? .notFound
        }
        do {
            try server.start()
            self.server = server
        } catch {
            log("socket server failed: \(error)")
        }
    }

    /// Runs on the socket queue.
    private func route(_ request: HTTPRequest) -> HTTPResponse {
        if let response = DebugHooks.route(request, app: self) { return response }
        switch (request.method, request.path) {
        case ("GET", "/health"):
            return .ok()
        case ("POST", "/snapshot"):
            switch Snapshot.parse(request.body) {
            case .failure(let error):
                return .badRequest("not a schema \(Snapshot.schema) snapshot: \(error)")
            case .success(let info):
                let body = request.body
                DispatchQueue.main.async { self.receive(info, body: body) }
                return .ok("accepted\n")
            }
        case (_, "/health"), (_, "/snapshot"):
            return .methodNotAllowed
        default:
            return .notFound
        }
    }

    private func receive(_ info: SnapshotInfo, body: Data) {
        let outcome = registry.accept(info, body: body, now: Date())
        guard outcome != .stale else { return }
        bridge?.push(body)
        if AutoShow.shouldShow(outcome: outcome, state: info.state, enabled: preferences.showAutomatically, userHidden: userHidden) {
            showPanel()
        }
        statusMenu?.refreshIcon()
    }

    private func tick() {
        let now = Date()
        let expired = registry.expireEnded(now: now)
        for id in expired {
            log("closing the ended session tab \(id)")
            bridge?.remove(id) { [weak self] in self?.registry.bodies ?? [] }
        }
        if preferences.hideWhenIdle, isPanelVisible, registry.isIdle(now: now) {
            hidePanel(byUser: false)
        }
        statusMenu?.refreshIcon()
    }

    // MARK: Size and place

    private func layOut(animated: Bool) {
        guard let panel else { return }
        let screen = screenFrame(containing: anchor.point)
        let size = PanelGeometry.fit(preferences.panelSize.size, screen: screen)
        let frame = PanelGeometry.frame(size: size, corner: anchor.corner, at: anchor.point, screen: screen)
        guard frame != panel.frame else { return }
        if animated, panel.isVisible {
            NSAnimationContext.runAnimationGroup { context in
                context.duration = 0.2
                context.allowsImplicitAnimation = true
                panel.animator().setFrame(frame, display: true)
            }
        } else {
            panel.setFrame(frame, display: true)
        }
    }

    /// After a drag, the anchor becomes the screen corner nearest the panel.
    private func reanchor() {
        guard let panel else { return }
        let screen = panel.screen?.visibleFrame ?? screenFrame(containing: panel.frame.origin)
        let corner = PanelGeometry.nearestCorner(of: panel.frame, in: screen)
        let point = PanelGeometry.point(of: corner, in: panel.frame)
        // Dragged partly off screen: the anchor stays on it.
        anchor = (corner, CGPoint(x: min(max(point.x, screen.minX), screen.maxX), y: min(max(point.y, screen.minY), screen.maxY)))
        preferences.anchor = anchor
        log("anchored to the \(corner.rawValue) corner at \(Int(anchor.point.x)),\(Int(anchor.point.y))")
    }

    /// Last session's anchor if its point is still on a screen, else the top-right corner.
    private func restoredAnchor() -> (corner: Corner, point: CGPoint) {
        if let saved = preferences.anchor, NSScreen.screens.contains(where: { Self.reaches($0, saved.point) }) {
            return saved
        }
        return PanelGeometry.defaultAnchor(screen: screenFrame(containing: nil))
    }

    private func screenFrame(containing point: CGPoint?) -> CGRect {
        let screen = point.flatMap { p in NSScreen.screens.first { Self.reaches($0, p) } } ?? NSScreen.main ?? NSScreen.screens.first
        return screen?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
    }

    /// Whether `point` is on `screen`, its right and top edges included: an
    /// anchor dragged flush to the edge sits exactly there.
    private static func reaches(_ screen: NSScreen, _ point: CGPoint) -> Bool {
        screen.frame.insetBy(dx: -1, dy: -1).contains(point)
    }

    // MARK: Terminal focus

    /// A node was clicked: bring its session's terminal forward.
    private func focusTerminal(of sessionId: String, node: String?) {
        guard let session = registry.sessions[sessionId] else {
            return log("focus: no session \(sessionId)")
        }
        TerminalFocuser.focus(TerminalInfo.from(snapshot: session.body)) { outcome in
            log("focus \(sessionId)\(node.map { " (\($0))" } ?? ""): \(outcome)")
        }
    }

    // MARK: Panel

    var isPanelVisible: Bool { panel?.isVisible ?? false }
    var activeSessionCount: Int { registry.activeCount(now: Date()) }
    var isAnySessionWaiting: Bool { registry.isAnyWaiting }

    func togglePanel() {
        if isPanelVisible { hidePanel(byUser: true) } else { showPanel() }
    }

    func preferencesChanged() {
        applyPreferences()
        bridge?.applyLook(preferences.look)
        layOut(animated: true)
    }

    private func showPanel() {
        userHidden = false
        panel?.orderFrontRegardless()
    }

    private func hidePanel(byUser: Bool) {
        if byUser { userHidden = true }
        panel?.orderOut(nil)
    }

    private func applyPreferences() {
        panel?.alphaValue = CGFloat(preferences.opacity)
        panel?.level = preferences.alwaysOnTop ? .floating : .normal
    }

    // MARK: Debug hooks (FLOWCTL_DEBUG=1)

    var debugPanel: OverlayPanel? { panel }
    var debugBridge: WebBridge? { bridge }

    /// As if the person dragged the panel to `origin`.
    func debugDrag(to origin: CGPoint) {
        panel?.setFrameOrigin(origin)
        reanchor()
    }

    func debugHasMenuItem(_ title: String) -> Bool {
        (statusMenu?.describe() ?? []).contains { row in
            row["title"] as? String == title || (row["items"] as? [[String: Any]] ?? []).contains { $0["title"] as? String == title }
        }
    }

    func debugMenu(_ title: String) -> Bool {
        statusMenu?.performItem(titled: title) ?? false
    }

    func debugState() -> [String: Any] {
        let frame = panel?.frame ?? .zero
        return [
            "panel": [
                "visible": isPanelVisible,
                "key": panel?.isKeyWindow == true,
                "frame": [frame.origin.x, frame.origin.y, frame.width, frame.height],
                "level": panel?.level == .floating ? "floating" : "normal",
                "alpha": Double(panel?.alphaValue ?? 0),
                "closeButtonVisible": !(panel?.closeButton?.isHidden ?? true),
                "shadow": panel?.hasShadow == true,
                "opaque": panel?.isOpaque == true,
                "userHidden": userHidden
            ],
            "sessions": registry.order.map { id -> [String: Any] in
                let session = registry.sessions[id]
                return ["id": id, "seq": session?.info.seq ?? 0, "state": session?.info.state.rawValue ?? "?", "nodes": session?.info.nodeCount ?? 0]
            },
            "activeSessions": activeSessionCount,
            "anchor": ["corner": anchor.corner.rawValue, "x": Double(anchor.point.x), "y": Double(anchor.point.y)],
            "panelSize": preferences.panelSize.rawValue,
            "look": preferences.look.rawValue,
            "hoverMovesRelayed": bridge?.hover.moves ?? 0,
            "menu": statusMenu?.describe() ?? []
        ]
    }

    /// For ⌘Q and ⌘W while the panel is key, and for copying from the page.
    private static func mainMenu() -> NSMenu {
        let menu = NSMenu()
        let app = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "Hide Panel", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Quit FlowCTL", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        app.submenu = appMenu
        menu.addItem(app)

        let edit = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(NSMenuItem(title: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        edit.submenu = editMenu
        menu.addItem(edit)
        return menu
    }
}

/// Where everything lives: ~/.flowctl (0700), its socket (0600) and sessions.
struct Paths {
    let root = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".flowctl", isDirectory: true)
    var sessions: URL { root.appendingPathComponent("sessions", isDirectory: true) }
    var socket: URL { root.appendingPathComponent("overlay.sock") }

    /// The viewer bundled in the app; FLOWCTL_VIEWER_DIR overrides it in development.
    var viewerPage: URL {
        if let dir = ProcessInfo.processInfo.environment["FLOWCTL_VIEWER_DIR"] {
            return URL(fileURLWithPath: dir, isDirectory: true).appendingPathComponent("index.html")
        }
        return Bundle.main.resourceURL!.appendingPathComponent("viewer/index.html")
    }

    /// Creates ~/.flowctl and sessions/, and tightens ~/.flowctl to 0700
    /// whoever created it first (the mod's recorder may have).
    func prepare() throws {
        let manager = FileManager.default
        try manager.createDirectory(at: sessions, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try manager.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
    }
}
