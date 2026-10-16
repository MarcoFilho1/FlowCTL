import AppKit
import FlowCTLCore

protocol StatusMenuActions: AnyObject {
    var isPanelVisible: Bool { get }
    var activeSessionCount: Int { get }
    var isAnySessionWaiting: Bool { get }
    /// The sessions the control panel lists: live ones, most recent first.
    var sessionRows: [SessionRow] { get }
    var preferences: Preferences { get }
    func togglePanel()
    func preferencesChanged()
    /// Brings a session's terminal forward.
    func focusSession(_ id: String)
}

/// The menu bar item: always there, so the panel can always be found and the
/// app always quit. A click opens the control panel (Control Center's way);
/// Settings… opens the settings window.
final class StatusMenu: NSObject {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private weak var actions: StatusMenuActions?
    let model = ControlModel()
    private(set) lazy var panel = ControlPanelController(model: model)
    private(set) lazy var settings = SettingsWindowController(model: model)

    init(actions: StatusMenuActions) {
        self.actions = actions
        super.init()
        model.actions = actions
        model.toggleOverlay = { [weak self] in
            self?.actions?.togglePanel()
            self?.model.refresh()
        }
        model.focusSession = { [weak self] id in
            self?.panel.hide()
            self?.actions?.focusSession(id)
        }
        model.openSettings = { [weak self] in self?.openSettings() }
        model.showAbout = { [weak self] in self?.showAbout() }
        model.quit = { NSApp.terminate(nil) }
        panel.onVisibleChange = { [weak self] visible in self?.item.button?.highlight(visible) }
        item.button?.target = self
        item.button?.action = #selector(clicked)
        item.button?.sendAction(on: [.leftMouseDown, .rightMouseDown])
        item.button?.toolTip = "FlowCTL"
        refreshIcon()
    }

    func debugClick() { clicked() }

    @objc private func clicked() {
        guard let button = item.button, let window = button.window else { return }
        panel.toggle(below: window.convertToScreen(button.convert(button.bounds, to: nil)))
    }

    /// Sessions, preferences or the overlay changed: the panel and the settings show it.
    func refresh() {
        model.refresh()
        refreshIcon()
    }

    @objc func openSettings() {
        panel.hide()
        settings.show()
    }

    @objc func showAbout() {
        panel.hide()
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: "FlowCTL",
            .credits: NSAttributedString(
                string: "A live graph of what Claude Code is doing.\ngithub.com/MarcoFilho1/FlowCTL",
                attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]
            )
        ])
    }

    /// FlowCTL's node as a menu bar glyph: the logo's pixel disc, in the
    /// menu bar's own color (a template), with its shine left open.
    static let glyph: NSImage = {
        let side: CGFloat = 18
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
            let disc = AttentionIcon.pixelDisc(size: 8)
            let cell: CGFloat = 2
            let origin = (side - cell * 8) / 2
            NSColor.black.setFill()
            for (y, row) in disc.enumerated() {
                for (x, part) in row.enumerated() {
                    guard let part, part != .light else { continue }
                    NSRect(x: origin + CGFloat(x) * cell, y: origin + CGFloat(y) * cell, width: cell, height: cell).fill()
                }
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "FlowCTL"
        return image
    }()

    /// While a session waits on the person, the icon is a yellow node that
    /// blinks, in the panel's look.
    func refreshIcon() {
        let waiting = actions?.isAnySessionWaiting ?? false
        let look = actions?.preferences.look ?? .standard
        guard waiting else {
            stopBlinking()
            item.button?.image = Self.glyph
            item.button?.contentTintColor = nil
            return
        }
        item.button?.title = ""
        item.button?.contentTintColor = nil
        guard blink == nil || blinkLook != look else { return }
        stopBlinking()
        blinkLook = look
        let began = Date()
        let draw = { [weak self] in
            let still = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
            let alpha = still ? 1 : AttentionIcon.alpha(look: look, at: Date().timeIntervalSince(began))
            self?.item.button?.image = StatusMenu.attentionImage(look: look, alpha: alpha)
        }
        draw()
        let timer = Timer(timeInterval: AttentionIcon.frameInterval(look: look), repeats: true) { _ in draw() }
        RunLoop.main.add(timer, forMode: .common)
        blink = timer
    }

    private var blink: Timer?
    private var blinkLook: PageLook?

    private func stopBlinking() {
        blink?.invalidate()
        blink = nil
        blinkLook = nil
    }

    private static let yellow = NSColor(srgbRed: 0xf2 / 255, green: 0xc9 / 255, blue: 0x4c / 255, alpha: 1)
    private static let ink = NSColor(srgbRed: 0x14 / 255, green: 0x16 / 255, blue: 0x1b / 255, alpha: 1)

    /// The node as the viewer draws it: a pixel sprite, or a disc with a shine.
    static func attentionImage(look: PageLook, alpha: Double) -> NSImage {
        let side: CGFloat = 18
        let image = NSImage(size: NSSize(width: side, height: side), flipped: true) { _ in
            NSGraphicsContext.current?.cgContext.setAlpha(alpha)
            switch look {
            case .pixel:
                let disc = AttentionIcon.pixelDisc(size: 8)
                let cell: CGFloat = 2
                let origin = (side - cell * 8) / 2
                for (y, row) in disc.enumerated() {
                    for (x, part) in row.enumerated() {
                        guard let part else { continue }
                        switch part {
                        case .outline: ink.setFill()
                        case .body: yellow.setFill()
                        case .light: yellow.blended(withFraction: 0.45, of: .white)?.setFill()
                        case .shade: yellow.blended(withFraction: 0.3, of: .black)?.setFill()
                        }
                        NSRect(x: origin + CGFloat(x) * cell, y: origin + CGFloat(y) * cell, width: cell, height: cell).fill()
                    }
                }
            case .smooth:
                let disc = NSBezierPath(ovalIn: NSRect(x: 2, y: 2, width: side - 4, height: side - 4))
                yellow.setFill()
                disc.fill()
                yellow.blended(withFraction: 0.35, of: .black)?.setStroke()
                disc.lineWidth = 1
                disc.stroke()
                NSColor.white.withAlphaComponent(0.35).setFill()
                NSBezierPath(ovalIn: NSRect(x: 5, y: 4.5, width: 4.5, height: 3.5)).fill()
            }
            return true
        }
        image.isTemplate = false
        image.accessibilityDescription = "FlowCTL: a session needs you"
        return image
    }

    /// The panel's controls by title, for the debug hooks: what a click on each does, and whether it is on.
    private var entries: [(title: String, on: Bool?, run: () -> Void)] {
        guard let actions else { return [] }
        let prefs = actions.preferences
        let change = { [weak self] (edit: @escaping (Preferences) -> Void) -> () -> Void in
            { edit(prefs); self?.actions?.preferencesChanged(); self?.refresh() }
        }
        var rows: [(title: String, on: Bool?, run: () -> Void)] = [
            (actions.isPanelVisible ? "Hide Panel" : "Show Panel", nil, { [weak self] in self?.model.toggleOverlay() }),
            ("Sound", prefs.sound, change { $0.soundChoice = $0.sound ? .off : SoundChoice.from(sound: true, style: $0.soundStyle) }),
            ("Always on Top", prefs.alwaysOnTop, change { $0.alwaysOnTop.toggle() }),
            ("Show Automatically", prefs.showAutomatically, change { $0.showAutomatically.toggle() }),
            ("Hide When Idle", prefs.hideWhenIdle, change { $0.hideWhenIdle.toggle() }),
            ("Show Subagents", prefs.showSubagents, change { $0.showSubagents.toggle() }),
            ("Idle Animation", prefs.idleAnimation, change { $0.idleAnimation.toggle() }),
            ("Settings…", nil, { [weak self] in self?.openSettings() }),
            ("About FlowCTL", nil, { [weak self] in self?.showAbout() }),
            ("Quit FlowCTL", nil, { NSApp.terminate(nil) })
        ]
        rows += PageLook.allCases.map { look in (look.title, prefs.look == look, change { $0.look = look }) }
        rows += PanelSize.allCases.map { size in (size.title, prefs.panelSize == size, change { $0.panelSize = size }) }
        rows += ThemeChoice.allCases.map { theme in ("Theme \(theme.title)", prefs.themeChoice == theme, change { $0.themeChoice = theme }) }
        rows += SoundChoice.allCases.map { sound in ("Sound \(sound.title)", prefs.soundChoice == sound, change { $0.soundChoice = sound }) }
        rows += Preferences.opacities.map { value in ("\(Int((value * 100).rounded()))%", abs(prefs.opacity - value) < 0.01, change { $0.opacity = value }) }
        return rows
    }

    /// Runs the control titled `title` as a click on it would (debug hooks only).
    func performItem(titled title: String) -> Bool {
        guard let entry = entries.first(where: { $0.title == title }) else { return false }
        entry.run()
        return true
    }

    /// The controls' titles and whether each is on, as the panel shows them now.
    func describe() -> [[String: Any]] {
        entries.map { entry in
            var row: [String: Any] = ["title": entry.title, "enabled": true]
            row["on"] = entry.on ?? false
            return row
        }
    }
}
