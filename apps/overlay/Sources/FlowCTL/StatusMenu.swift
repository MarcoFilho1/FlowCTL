import AppKit
import FlowCTLCore

protocol StatusMenuActions: AnyObject {
    var isPanelVisible: Bool { get }
    var activeSessionCount: Int { get }
    var isAnySessionWaiting: Bool { get }
    var preferences: Preferences { get }
    func togglePanel()
    func preferencesChanged()
}

/// The menu bar item: always there, so the panel can always be found and the
/// app always quit.
final class StatusMenu: NSObject, NSMenuDelegate {
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private weak var actions: StatusMenuActions?

    init(actions: StatusMenuActions) {
        self.actions = actions
        super.init()
        let menu = NSMenu()
        menu.delegate = self
        item.menu = menu
        item.button?.toolTip = "FlowCTL"
        refreshIcon()
    }

    /// While a session waits on the person, the icon is a yellow node that
    /// blinks, in the panel's look.
    func refreshIcon() {
        let waiting = actions?.isAnySessionWaiting ?? false
        let look = actions?.preferences.look ?? .standard
        guard waiting else {
            stopBlinking()
            let image = NSImage(systemSymbolName: "point.3.connected.trianglepath.dotted", accessibilityDescription: "FlowCTL")
            image?.isTemplate = true
            item.button?.image = image
            item.button?.contentTintColor = nil
            if image == nil { item.button?.title = "FlowCTL" }
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

    func menuNeedsUpdate(_ menu: NSMenu) {
        guard let actions else { return }
        menu.removeAllItems()

        menu.addItem(entry(actions.isPanelVisible ? "Hide Panel" : "Show Panel", #selector(togglePanel)))
        menu.addItem(.separator())

        let count = actions.activeSessionCount
        let sessions = NSMenuItem(title: count == 0 ? "No active sessions" : count == 1 ? "1 active session" : "\(count) active sessions", action: nil, keyEquivalent: "")
        sessions.isEnabled = false
        menu.addItem(sessions)
        menu.addItem(.separator())

        let opacity = NSMenuItem(title: "Opacity", action: nil, keyEquivalent: "")
        let levels = NSMenu()
        for value in Preferences.opacities {
            let level = entry("\(Int((value * 100).rounded()))%", #selector(setOpacity(_:)))
            level.representedObject = value
            level.state = abs(actions.preferences.opacity - value) < 0.01 ? .on : .off
            levels.addItem(level)
        }
        opacity.submenu = levels
        menu.addItem(opacity)

        let size = NSMenuItem(title: "Size", action: nil, keyEquivalent: "")
        let sizes = NSMenu()
        for option in PanelSize.allCases {
            let item = entry(option.title, #selector(setSize(_:)))
            item.representedObject = option.rawValue
            item.state = actions.preferences.panelSize == option ? .on : .off
            sizes.addItem(item)
        }
        size.submenu = sizes
        menu.addItem(size)

        let look = NSMenuItem(title: "Look", action: nil, keyEquivalent: "")
        let looks = NSMenu()
        for option in PageLook.allCases {
            let item = entry(option.title, #selector(setLook(_:)))
            item.representedObject = option.rawValue
            item.state = actions.preferences.look == option ? .on : .off
            looks.addItem(item)
        }
        look.submenu = looks
        menu.addItem(look)
        menu.addItem(toggle("Show Subagents", actions.preferences.showSubagents, #selector(toggleShowSubagents)))
        let sound = NSMenuItem(title: "Sound", action: nil, keyEquivalent: "")
        let sounds = NSMenu()
        for choice in SoundChoice.allCases {
            let item = entry(choice.title, #selector(setSoundChoice(_:)))
            item.representedObject = choice.rawValue
            item.state = actions.preferences.soundChoice == choice ? .on : .off
            sounds.addItem(item)
        }
        sound.submenu = sounds
        menu.addItem(sound)
        menu.addItem(toggle("Always on Top", actions.preferences.alwaysOnTop, #selector(toggleAlwaysOnTop)))
        menu.addItem(toggle("Show Automatically", actions.preferences.showAutomatically, #selector(toggleShowAutomatically)))
        menu.addItem(toggle("Hide When Idle", actions.preferences.hideWhenIdle, #selector(toggleHideWhenIdle)))
        menu.addItem(.separator())

        let quit = NSMenuItem(title: "Quit FlowCTL", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(quit)
    }

    private func entry(_ title: String, _ action: Selector) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
        item.target = self
        return item
    }

    private func toggle(_ title: String, _ on: Bool, _ action: Selector) -> NSMenuItem {
        let item = entry(title, action)
        item.state = on ? .on : .off
        return item
    }

    /// Runs the item titled `title` as a click on it would (debug hooks only).
    func performItem(titled title: String) -> Bool {
        guard let menu = item.menu else { return false }
        menuNeedsUpdate(menu)
        for (index, entry) in menu.items.enumerated() {
            if entry.title == title {
                menu.performActionForItem(at: index)
                return true
            }
            if let submenu = entry.submenu, let sub = submenu.items.firstIndex(where: { $0.title == title }) {
                submenu.performActionForItem(at: sub)
                return true
            }
        }
        return false
    }

    /// Item titles and their check marks, as the menu would show them now.
    func describe() -> [[String: Any]] {
        guard let menu = item.menu else { return [] }
        menuNeedsUpdate(menu)
        return menu.items.filter { !$0.isSeparatorItem }.map { entry in
            var row: [String: Any] = ["title": entry.title, "on": entry.state == .on, "enabled": entry.isEnabled]
            if let submenu = entry.submenu {
                row["items"] = submenu.items.map { ["title": $0.title, "on": $0.state == .on] }
            }
            return row
        }
    }

    @objc private func togglePanel() { actions?.togglePanel() }

    @objc private func setOpacity(_ sender: NSMenuItem) {
        guard let value = sender.representedObject as? Double, let actions else { return }
        actions.preferences.opacity = value
        actions.preferencesChanged()
    }

    @objc private func setLook(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let look = PageLook(rawValue: raw), let actions else { return }
        actions.preferences.look = look
        actions.preferencesChanged()
    }

    @objc private func setSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let size = PanelSize(rawValue: raw), let actions else { return }
        actions.preferences.panelSize = size
        actions.preferencesChanged()
    }

    @objc private func setSoundChoice(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let choice = SoundChoice(rawValue: raw), let actions else { return }
        actions.preferences.soundChoice = choice
        actions.preferencesChanged()
    }

    @objc private func toggleShowSubagents() {
        guard let actions else { return }
        actions.preferences.showSubagents.toggle()
        actions.preferencesChanged()
    }

    @objc private func toggleAlwaysOnTop() {
        guard let actions else { return }
        actions.preferences.alwaysOnTop.toggle()
        actions.preferencesChanged()
    }

    @objc private func toggleShowAutomatically() {
        guard let actions else { return }
        actions.preferences.showAutomatically.toggle()
        actions.preferencesChanged()
    }

    @objc private func toggleHideWhenIdle() {
        guard let actions else { return }
        actions.preferences.hideWhenIdle.toggle()
        actions.preferencesChanged()
    }
}
