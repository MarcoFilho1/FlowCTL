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
            Key.hideWhenIdle: true,
            Key.showSubagents: true,
            Key.sound: true,
            Key.soundStyle: SoundChoice.standard.rawValue,
            Key.theme: ThemeChoice.standard.rawValue,
            Key.idleAnimation: true
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

    /// Draw subagents in the graph (on by default); the viewer takes it through setShowSubagents.
    var showSubagents: Bool {
        get { defaults.bool(forKey: Key.showSubagents) }
        set { defaults.set(newValue, forKey: Key.showSubagents) }
    }

    /// The viewer's sounds for graph events (on by default); the viewer takes it through setSound.
    /// A user who turned sound off keeps it off: the stored `false` is what they chose.
    var sound: Bool {
        get { defaults.bool(forKey: Key.sound) }
        set { defaults.set(newValue, forKey: Key.sound) }
    }

    /// The style of the sounds when they are on: look, smooth or pixel (sent as setSoundStyle).
    var soundStyle: String {
        get { defaults.string(forKey: Key.soundStyle) ?? SoundChoice.standard.rawValue }
        set { defaults.set(newValue, forKey: Key.soundStyle) }
    }

    /// The graph's shapes after a minute with nothing working (on by default; setIdleAnimation).
    var idleAnimation: Bool {
        get { defaults.bool(forKey: Key.idleAnimation) }
        set { defaults.set(newValue, forKey: Key.idleAnimation) }
    }

    /// Shapes or the snail, when the idle animation is on (sent as setIdleStyle).
    var idleStyle: IdleStyle {
        get { defaults.string(forKey: Key.idleStyle).flatMap(IdleStyle.init(rawValue:)) ?? .standard }
        set { defaults.set(newValue.rawValue, forKey: Key.idleStyle) }
    }

    /// The palette: auto (follow macOS), dark or light (sent as setTheme).
    var themeChoice: ThemeChoice {
        get { ThemeChoice.from(defaults.string(forKey: Key.theme) ?? ThemeChoice.standard.rawValue) }
        set { defaults.set(newValue.rawValue, forKey: Key.theme) }
    }

    /// The sound menu's choice, from the two stored values.
    var soundChoice: SoundChoice {
        get { SoundChoice.from(sound: sound, style: soundStyle) }
        set {
            sound = newValue.isOn
            if newValue.isOn { soundStyle = newValue.rawValue }
        }
    }

    /// Hide the panel after five minutes with no active session (on by default).
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
        static let showSubagents = "showSubagents"
        static let sound = "sound"
        static let soundStyle = "soundStyle"
        static let theme = "theme"
        static let idleAnimation = "idleAnimation"
        static let idleStyle = "idleStyle"
    }
}
