import Foundation

/// The menu bar settings, kept in UserDefaults (dev.flowctl.overlay).
final class Preferences {
    static let opacities: [Double] = [1.0, 0.9, 0.8, 0.7, 0.5]

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        defaults.register(defaults: [
            Key.opacity: 1.0,
            Key.alwaysOnTop: true,
            Key.showAutomatically: true,
            Key.hideWhenIdle: false
        ])
    }

    var opacity: Double {
        get { defaults.double(forKey: Key.opacity) }
        set { defaults.set(newValue, forKey: Key.opacity) }
    }

    var alwaysOnTop: Bool {
        get { defaults.bool(forKey: Key.alwaysOnTop) }
        set { defaults.set(newValue, forKey: Key.alwaysOnTop) }
    }

    /// Bring the panel up when a session starts working or waits on the person.
    var showAutomatically: Bool {
        get { defaults.bool(forKey: Key.showAutomatically) }
        set { defaults.set(newValue, forKey: Key.showAutomatically) }
    }

    /// Hide the panel after a minute with no active session.
    var hideWhenIdle: Bool {
        get { defaults.bool(forKey: Key.hideWhenIdle) }
        set { defaults.set(newValue, forKey: Key.hideWhenIdle) }
    }

    private enum Key {
        static let opacity = "opacity"
        static let alwaysOnTop = "alwaysOnTop"
        static let showAutomatically = "showAutomatically"
        static let hideWhenIdle = "hideWhenIdle"
    }
}
