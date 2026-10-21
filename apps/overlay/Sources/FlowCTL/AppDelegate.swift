import AppKit
import CoreAudio
import FlowCTLCore

final class AppDelegate: NSObject, NSApplicationDelegate, StatusMenuActions {
    let preferences = Preferences()
    private let paths = Paths()
    private var registry = SessionRegistry(now: Date(), idleAfter: AppDelegate.idleLimit)
    private var panel: OverlayPanel?
    private var bridge: WebBridge?
    private var server: SocketServer?
    private var statusMenu: StatusMenu?
    private var timers: [Timer] = []
    /// The snail's window, and whether the snail is out in it (the panel is hidden meanwhile).
    private var pet: PetWindow?
    private var petOut = false
    private var petReturning = false
    /// The person hid the panel; only a new session or one waiting on them brings it back.
    /// What hid the panel, if anything: decides what may bring it back.
    private var hiddenBy: HiddenBy = .nobody
    /// How long with no active session before the panel hides (5 minutes).
    /// FLOWCTL_IDLE_SECONDS shortens it, for checks, when FLOWCTL_DEBUG=1.
    static var idleLimit: TimeInterval {
        guard DebugHooks.isEnabled, let raw = ProcessInfo.processInfo.environment["FLOWCTL_IDLE_SECONDS"],
              let seconds = Double(raw), seconds > 0
        else { return SessionRegistry.idleAfter }
        return seconds
    }
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
        bridge.currentBodies = { [weak self] in self?.replayBodies() ?? [] }
        bridge.onFocus = { [weak self] sessionId, nodeId in self?.focusTerminal(of: sessionId, node: nodeId) }
        bridge.currentLook = { [weak self] in self?.preferences.look ?? .standard }
        bridge.currentShowSubagents = { [weak self] in self?.preferences.showSubagents ?? true }
        bridge.currentSound = { [weak self] in self?.preferences.sound ?? true }
        bridge.currentSoundStyle = { [weak self] in self?.preferences.soundStyle ?? SoundChoice.standard.rawValue }
        bridge.currentTheme = { [weak self] in self?.preferences.themeChoice.rawValue ?? ThemeChoice.standard.rawValue }
        bridge.currentIdleAnimation = { [weak self] in self?.preferences.idleAnimation ?? true }
        bridge.currentIdleStyle = { [weak self] in self?.preferences.effectiveIdleStyle ?? .standard }
        self.bridge = bridge
        let panel = OverlayPanel(content: bridge.webView)
        panel.onHide = { [weak self] in self?.hidePanel(.user) }
        bridge.onClose = { [weak self] in self?.hidePanel(.user) }
        bridge.onGripDragEnded = { [weak self] in self?.reanchor() }
        bridge.onPetFormed = { [weak self] point in self?.petFormed(at: point) }
        self.panel = panel
        let pet = PetWindow(page: paths.viewerPage)
        pet.onClick = { [weak self] in self?.petClicked() }
        pet.currentBodies = { [weak self] in self?.replayBodies() ?? [] }
        self.pet = pet
        anchor = restoredAnchor()
        layOut(animated: false)
        // A monitor plugged or unplugged: a panel anchored to a screen that is
        // gone moves to one that is there, and back when the screen returns.
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            self?.screensChanged()
        }
        // The Mac woke, its screen came back or the user came back to it:
        // WebKit can leave the page's audio silent after any of them. With a
        // session open the Mac often never sleeps (Claude Code keeps it awake),
        // so the screen's wake is the one that comes.
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            NSWorkspace.shared.notificationCenter.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
                self?.bridge?.resetAudio()
            }
        }
        // The sound output changed (earbuds connected, a monitor's speakers):
        // the page's audio stays on the old one until it is made again.
        var output = AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultOutputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain
        )
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &output, .main) { [weak self] _, _ in
            log("sound output changed")
            self?.bridge?.resetAudio()
        }
        applyPreferences()
        statusMenu = StatusMenu(actions: self)

        restoreSessions()
        startServer()
        lastView = preferences.view
        if isSnailView { putSnailOut() } else { showPanel() }

        timers = [
            Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.tick() },
            Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in self?.cleanUpFiles() }
        ]
    }

    func applicationWillTerminate(_ notification: Notification) {
        pet?.vanish()
        server?.stop()
    }

    /// Opening the app again (Finder, Spotlight, the Dock, `open -a FlowCTL`) shows
    /// the panel, unless it went away for idleness: that comes back only when a
    /// session resumes. Before this, every open brought it back, so using the Mac
    /// (launching anything that opens FlowCTL) looked like a session resuming.
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if AutoShow.reopenShows(hiddenBy) { showPanel() }
        return false
    }

    // MARK: Sessions

    /// The sessions the mod left on disk while the overlay was closed.
    private func restoreSessions() {
        let plan = cleanUpFiles()
        for entry in plan.show {
            guard case let .success(info) = Snapshot.parse(entry.data) else { continue }
            _ = registry.accept(info, body: entry.data, now: entry.modified)
        }
        flushToViewer()
        log("restored \(plan.show.count) session(s) from \(paths.sessions.path)")
    }

    /// Deletes ended and day-old snapshot files; returns the plan it followed.
    @discardableResult
    private func cleanUpFiles() -> SessionFiles.Plan {
        let plan = SessionFiles.plan(SessionFiles.read(directory: paths.sessions), now: Date(), isAlive: ProcessLiveness.isAlive)
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
        flushToViewer()
        if petOut { pet?.setAlert(isAnySessionWaiting) }
        // Only the snail: it shows what happens itself (works, celebrates, rattles); the panel stays away.
        if isSnailView { return statusMenu?.refresh() ?? () }
        if AutoShow.shouldShow(outcome: outcome, state: info.state, enabled: preferences.showAutomatically, hiddenBy: hiddenBy) {
            // The snail rattles its shell a moment first, so the person sees why it goes.
            if petOut, info.state == .waitingYou {
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.showPanel() }
            } else {
                showPanel()
            }
        }
        statusMenu?.refresh()
    }

    /// Sends the page what changed: new snapshots, and sessions whose effective state moved.
    private func flushToViewer() {
        for body in registry.pendingPushes(now: Date()) {
            bridge?.push(body)
            pet?.push(body)
        }
    }

    /// Every session as the page should draw it now, for a page that starts over.
    private func replayBodies() -> [Data] {
        registry.replayBodies(now: Date())
    }

    private func tick() {
        let now = Date()
        // A session whose process is gone ends now: its tab leaves as an ended one's does.
        for id in registry.reconcile(now: now) {
            log("session \(id) ended: its process is gone")
        }
        let expired = registry.expireEnded(now: now)
        for id in expired {
            log("closing the ended session tab \(id)")
            bridge?.remove(id) { [weak self] in self?.replayBodies() ?? [] }
            pet?.remove(id)
        }
        // A session whose process went away, or that went quiet, changes state here.
        flushToViewer()
        if preferences.hideWhenIdle, isPanelShown, registry.isIdle(now: now) {
            hidePanel(.idle)
        }
        if petOut { pet?.setAlert(isAnySessionWaiting) }
        statusMenu?.refresh()
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
        PanelGeometry.restore(preferences.anchor, screens: NSScreen.screens.map(\.frame), fallback: screenFrame(containing: nil))
    }

    private func screensChanged() {
        let restored = restoredAnchor()
        guard restored.corner != anchor.corner || restored.point != anchor.point else { return layOut(animated: false) }
        anchor = restored
        log("screens changed: anchored to the \(anchor.corner.rawValue) corner at \(Int(anchor.point.x)),\(Int(anchor.point.y))")
        layOut(animated: false)
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

    /// Up for the person: visible and not on its way out.
    var isPanelVisible: Bool { isPanelShown }
    var activeSessionCount: Int { registry.activeCount(now: Date()) }
    /// Only a live session waiting on the person lights the icon.
    var isAnySessionWaiting: Bool { registry.isAnyWaiting(now: Date()) }

    /// Live sessions for the control panel, the newest first, each named after its folder.
    var sessionRows: [SessionRow] {
        let now = Date()
        return registry.order.reversed().compactMap { id -> SessionRow? in
            guard let session = registry.sessions[id] else { return nil }
            let state = registry.effectiveState(of: session, now: now)
            guard state != .ended else { return nil }
            let snapshot = (try? JSONSerialization.jsonObject(with: session.body)) as? [String: Any]
            let folder = (snapshot?["cwd"] as? String).map { URL(fileURLWithPath: $0).lastPathComponent }
            return SessionRow(id: id, name: folder.flatMap { $0.isEmpty ? nil : $0 } ?? "Session", state: state)
        }
    }

    @objc func openSettings() { statusMenu?.openSettings() }
    @objc func showAbout() { statusMenu?.showAbout() }

    func focusSession(_ id: String) {
        showPanel()
        focusTerminal(of: id, node: nil)
    }

    func togglePanel() {
        if isPanelVisible { hidePanel(.user) } else { showPanel() }
        statusMenu?.refresh()
    }

    func preferencesChanged() {
        applyPreferences()
        bridge?.applyLook(preferences.look)
        bridge?.applyShowSubagents(preferences.showSubagents)
        bridge?.applySound(preferences.sound)
        bridge?.applySoundStyle(preferences.soundStyle)
        bridge?.applyTheme(preferences.themeChoice.rawValue)
        bridge?.applyIdleAnimation(preferences.idleAnimation)
        bridge?.applyIdleStyle(preferences.effectiveIdleStyle)
        pet?.apply(look: preferences.look, theme: preferences.themeChoice)
        if preferences.view != lastView {
            lastView = preferences.view
            // Only the snail now: it comes out. The graph again: it goes home.
            if isSnailView { putSnailOut() } else if petOut { showPanel() }
        } else if petOut, !isSnailView, !(preferences.idleAnimation && preferences.idleStyle == .pet) {
            // The snail turned off while it is out: it goes home.
            showPanel()
        }
        statusMenu?.refresh()
        layOut(animated: true)
    }

    /// How long the panel takes to appear or disappear.
    private static let fadeDuration: TimeInterval = 0.25
    /// Going away for idleness is slower than a close, so it does not look like a cut.
    private static let idleFadeDuration: TimeInterval = 0.8
    /// True while the panel is fading out, so a tick does not start it again.
    private var hiding = false
    /// Counts show and hide requests: a fade-out that was overtaken must not order the panel out.
    private var visibilityChange = 0

    private func showPanel() {
        // The snail is out: it flies home first, and the panel comes up when it lands.
        if petOut { return bringPetBack() }
        hiddenBy = .nobody
        guard let panel else { return }
        // A snail that formed while the panel was hidden never left: it melts back now.
        if !panel.isVisible, preferences.idleStyle == .pet { bridge?.petBack() }
        let target = CGFloat(preferences.opacity)
        if isPanelShown, panel.alphaValue == target { return }
        visibilityChange += 1
        hiding = false
        if !panel.isVisible { panel.alphaValue = 0 }
        panel.orderFrontRegardless()
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.fadeDuration
            panel.animator().alphaValue = target
        }
    }

    // MARK: The snail

    /// The nodes gathered into the snail in the panel: its own window takes
    /// it from that very spot, and the panel goes. Only from a panel on screen,
    /// with the snail chosen.
    private func petFormed(at page: CGPoint) {
        guard isSnailView || (preferences.idleAnimation && preferences.idleStyle == .pet), isPanelShown, !petOut, let panel, let pet else { return }
        let feet = CGPoint(x: panel.frame.minX + page.x, y: panel.frame.maxY - page.y)
        petOut = true
        bridge?.petAway()
        pet.emerge(at: feet, look: preferences.look, theme: preferences.themeChoice, screen: panel.screen)
        pet.setAlert(isAnySessionWaiting)
        // The panel goes at once: the snail is already in its own window, in the same place.
        visibilityChange += 1
        hiddenBy = .idle
        panel.orderOut(nil)
        panel.alphaValue = CGFloat(preferences.opacity)
        statusMenu?.refresh()
        log("the snail is out")
    }

    /// The snail flies home into the panel, which comes up as it lands; the
    /// page then sends the nodes back to the graph.
    private func bringPetBack() {
        guard petOut, !petReturning, let panel, let pet else { return }
        petReturning = true
        layOut(animated: false)
        // Where the snail stands in the panel: the bottom middle (see the viewer's FEET_UP).
        let feet = CGPoint(x: panel.frame.midX, y: panel.frame.minY + 10)
        pet.retreat(to: feet) { [weak self] in
            guard let self else { return }
            self.petOut = false
            self.petReturning = false
            self.showPanel()
            self.bridge?.petBack()
            log("the snail is back")
            // Only the snail: this is a look at the graph, and the snail comes back out after a while.
            if self.isSnailView { self.armPeek() }
        }
    }

    /// A click on the snail: while a session waits for the person (the shell
    /// rattling under its "!"), straight to that session's terminal; else the
    /// graph, in the overlay.
    private func petClicked() {
        if let id = waitingSessionId {
            focusTerminal(of: id, node: nil)
        } else {
            showPanel()
        }
    }

    /// The session waiting for the person that changed last, if any.
    private var waitingSessionId: String? {
        let now = Date()
        return registry.sessions.values
            .filter { registry.effectiveState(of: $0, now: now) == .waitingYou }
            .max { $0.info.updatedAt < $1.info.updatedAt }?
            .info.sessionId
    }

    // MARK: Only the snail

    private var isSnailView: Bool { preferences.view == .snail }
    /// The view when the preferences were last applied: a change to it moves the snail.
    private var lastView: OverlayView = .standard
    private var peekTimer: Timer?
    /// A look at the graph, with only the snail chosen, lasts this long (the mouse on the panel holds it).
    private static let peekSeconds: TimeInterval = 60

    /// Out comes the snail, to stay: from the panel's nodes when the panel
    /// is up (they gather into it), else dropped in from above its spot.
    private func putSnailOut() {
        peekTimer?.invalidate()
        guard !petOut, let panel, let pet else { return }
        if isPanelShown {
            // The page gathers the nodes into the snail; petFormed takes it from there.
            bridge?.petAway()
            return
        }
        petOut = true
        bridge?.petAway()
        let screen = panel.screen ?? NSScreen.main
        let visible = screen?.visibleFrame ?? .zero
        pet.emerge(at: CGPoint(x: visible.maxX - 220, y: visible.minY + 260), look: preferences.look, theme: preferences.themeChoice, screen: screen)
        pet.setAlert(isAnySessionWaiting)
        hiddenBy = .idle
        statusMenu?.refresh()
        log("the snail is out (snail view)")
    }

    /// After a minute's look at the graph, the snail comes back out, unless the mouse is on the panel.
    private func armPeek() {
        peekTimer?.invalidate()
        peekTimer = Timer.scheduledTimer(withTimeInterval: Self.peekSeconds, repeats: false) { [weak self] _ in
            guard let self, self.isSnailView, !self.petOut else { return }
            if let panel = self.panel, panel.frame.contains(NSEvent.mouseLocation) { return self.armPeek() }
            self.putSnailOut()
        }
    }

    private func hidePanel(_ by: HiddenBy) {
        // Only the snail: the graph going away (closed, or idle) puts the snail back out, dropped in.
        if isSnailView, !petOut, let panel, panel.isVisible {
            panel.orderOut(nil)
            panel.alphaValue = CGFloat(preferences.opacity)
            return putSnailOut()
        }
        hiddenBy = by
        guard let panel, panel.isVisible, !hiding else { return }
        visibilityChange += 1
        let change = visibilityChange
        hiding = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = by == .idle ? Self.idleFadeDuration : Self.fadeDuration
            panel.animator().alphaValue = 0
        }, completionHandler: { [weak self] in
            guard let self, self.visibilityChange == change else { return }
            panel.orderOut(nil)
            // Back to the chosen opacity, ready for the next showPanel.
            panel.alphaValue = CGFloat(self.preferences.opacity)
            self.hiding = false
            self.statusMenu?.refresh()
        })
    }

    /// Whether the panel is up for the person (visible and not on its way out).
    private var isPanelShown: Bool {
        (panel?.isVisible ?? false) && !hiding
    }

    private func applyPreferences() {
        panel?.alphaValue = CGFloat(preferences.opacity)
        panel?.level = preferences.alwaysOnTop ? .floating : .normal
    }

    // MARK: Debug hooks (FLOWCTL_DEBUG=1)

    var debugPanel: OverlayPanel? { panel }
    var debugStatusMenu: StatusMenu? { statusMenu }
    var debugBridge: WebBridge? { bridge }
    var debugPet: PetWindow? { pet }

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
                "grip": gripState(),
                "shadow": panel?.hasShadow == true,
                "opaque": panel?.isOpaque == true,
                "hiddenBy": "\(hiddenBy)",
                "idleAnimation": preferences.idleAnimation
            ],
            "pet": [
                "out": petOut,
                "returning": petReturning,
                "style": preferences.idleStyle.rawValue,
                "view": preferences.view.rawValue,
                "frame": pet.map { [$0.debugFrame.minX, $0.debugFrame.minY, $0.debugFrame.width, $0.debugFrame.height] } ?? []
            ],
            "sessions": registry.order.map { id -> [String: Any] in
                let session = registry.sessions[id]
                var row: [String: Any] = ["id": id, "seq": session?.info.seq ?? 0, "state": session?.info.state.rawValue ?? "?", "nodes": session?.info.nodeCount ?? 0]
                if let session {
                    row["effective"] = registry.effectiveState(of: session, now: Date()).rawValue
                }
                if let pid = session?.info.pid { row["pid"] = Int(pid) }
                return row
            },
            "activeSessions": activeSessionCount,
            "waitingIcon": isAnySessionWaiting,
            "pageViewChain": pageViewChain(),
            "anchor": ["corner": anchor.corner.rawValue, "x": Double(anchor.point.x), "y": Double(anchor.point.y)],
            "panelSize": preferences.panelSize.rawValue,
            "look": preferences.look.rawValue,
            "showSubagents": preferences.showSubagents,
            "sound": preferences.sound,
            "theme": preferences.themeChoice.rawValue,
            "soundChoice": preferences.soundChoice.rawValue,
            "hoverMovesRelayed": bridge?.hover.moves ?? 0,
            "menu": statusMenu?.describe() ?? []
        ]
    }

    /// The grip as the viewer reported it, for the debug state; NSNull when none.
    private func gripState() -> Any {
        guard let grip = bridge?.debugGrip else { return NSNull() }
        return ["x": Double(grip.minX), "y": Double(grip.minY), "width": Double(grip.width), "height": Double(grip.height)]
    }

    /// The views a gesture over the middle of the page would reach, innermost first.
    func pageViewChain() -> [String] {
        guard let panel, let content = panel.contentView else { return [] }
        let point = NSPoint(x: panel.frame.width / 2, y: panel.frame.height / 2)
        var names: [String] = []
        var view: NSView? = content.hitTest(point)
        while let current = view {
            names.append(String(describing: type(of: current)))
            view = current.superview
        }
        return names
    }

    /// For ⌘Q and ⌘W while the panel is key, and for copying from the page.
    private static func mainMenu() -> NSMenu {
        let menu = NSMenu()
        let app = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(title: "About FlowCTL", action: #selector(AppDelegate.showAbout), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Settings…", action: #selector(AppDelegate.openSettings), keyEquivalent: ","))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w"))
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
    /// FLOWCTL_HOME, with FLOWCTL_DEBUG=1, stands in for the home folder: a second
    /// copy of the app for checks, with its own socket and sessions.
    let root: URL = {
        let home = DebugHooks.isEnabled ? ProcessInfo.processInfo.environment["FLOWCTL_HOME"] : nil
        return URL(fileURLWithPath: home ?? NSHomeDirectory()).appendingPathComponent(".flowctl", isDirectory: true)
    }()
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
