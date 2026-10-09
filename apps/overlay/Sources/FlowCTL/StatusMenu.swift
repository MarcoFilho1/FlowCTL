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

    /// The icon turns into a warning while a session waits on the person.
    func refreshIcon() {
        let waiting = actions?.isAnySessionWaiting ?? false
        let name = waiting ? "exclamationmark.circle.fill" : "point.3.connected.trianglepath.dotted"
        let image = NSImage(systemSymbolName: name, accessibilityDescription: waiting ? "FlowCTL: a session needs you" : "FlowCTL")
        image?.isTemplate = !waiting
        item.button?.image = image
        item.button?.contentTintColor = waiting ? .systemYellow : nil
        if image == nil { item.button?.title = "FlowCTL" }
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

    @objc private func setSize(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String, let size = PanelSize(rawValue: raw), let actions else { return }
        actions.preferences.panelSize = size
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
