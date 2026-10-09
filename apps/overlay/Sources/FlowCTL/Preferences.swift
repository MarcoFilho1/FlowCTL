import CoreGraphics
import FlowCTLCore
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

    /// How the viewer draws: pixel art by default.
    var look: PageLook {
        get { defaults.string(forKey: Key.look).flatMap(PageLook.init(rawValue:)) ?? .standard }
        set { defaults.set(newValue.rawValue, forKey: Key.look) }
    }

    var panelSize: PanelSize {
        get { defaults.string(forKey: Key.panelSize).flatMap(PanelSize.init(rawValue:)) ?? .standard }
        set { defaults.set(newValue.rawValue, forKey: Key.panelSize) }
    }

    /// The corner the panel grows from and where it sits, after the last drag.
    var anchor: (corner: Corner, point: CGPoint)? {
        get {
            guard let raw = defaults.string(forKey: Key.anchorCorner), let corner = Corner(rawValue: raw),
                  defaults.object(forKey: Key.anchorX) != nil, defaults.object(forKey: Key.anchorY) != nil
            else { return nil }
            return (corner, CGPoint(x: defaults.double(forKey: Key.anchorX), y: defaults.double(forKey: Key.anchorY)))
        }
        set {
            defaults.set(newValue?.corner.rawValue, forKey: Key.anchorCorner)
            defaults.set(newValue.map { Double($0.point.x) }, forKey: Key.anchorX)
            defaults.set(newValue.map { Double($0.point.y) }, forKey: Key.anchorY)
        }
    }

    private enum Key {
        static let panelSize = "panelSize"
        static let look = "look"
        static let anchorCorner = "anchorCorner"
        static let anchorX = "anchorX"
        static let anchorY = "anchorY"
        static let opacity = "opacity"
        static let alwaysOnTop = "alwaysOnTop"
        static let showAutomatically = "showAutomatically"
        static let hideWhenIdle = "hideWhenIdle"
    }
}
