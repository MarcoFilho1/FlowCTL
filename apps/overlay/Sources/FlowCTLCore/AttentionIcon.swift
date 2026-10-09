import Foundation

/// The menu bar icon while a session needs the person: a yellow node that
/// blinks, drawn in the panel's look (a pixel sprite or a smooth disc).
public enum AttentionIcon {
    public enum Part: Equatable {
        case outline, body, light, shade
    }

    /// The pixel node, `size` cells across, row by row (nil outside the disc).
    /// The same disc the viewer draws: an outline rim, a light corner top
    /// left, a shade corner bottom right.
    public static func pixelDisc(size: Int) -> [[Part?]] {
        let c = Double(size - 1) / 2
        let radius = Double(size) / 2 - 0.15
        func inside(_ x: Int, _ y: Int) -> Bool {
            x >= 0 && y >= 0 && x < size && y < size && pow(Double(x) - c, 2) + pow(Double(y) - c, 2) <= radius * radius
        }
        return (0..<size).map { y in
            (0..<size).map { x in
                guard inside(x, y) else { return nil }
                if !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1) { return .outline }
                let d = Double(x) - c + Double(y) - c
                if d <= -(Double(size) * 0.42) { return .light }
                if d >= Double(size) * 0.38 { return .shade }
                return .body
            }
        }
    }

    /// Pixel art blinks in whole steps, as the viewer's "!" does.
    public static let pixelStep: TimeInterval = 0.4
    /// The smooth node pulses, as the viewer's waiting dot does.
    public static let smoothPeriod: TimeInterval = 1.4
    public static let dimmest = 0.3

    /// How opaque the node is `t` seconds into its blinking.
    public static func alpha(look: PageLook, at t: TimeInterval) -> Double {
        switch look {
        case .pixel:
            return Int((max(0, t) / pixelStep).rounded(.down)) % 2 == 0 ? 1 : dimmest
        case .smooth:
            let wave = (cos(2 * Double.pi * t / smoothPeriod) + 1) / 2
            return dimmest + (1 - dimmest) * wave
        }
    }

    /// How often the icon redraws while it blinks.
    public static func frameInterval(look: PageLook) -> TimeInterval {
        look == .pixel ? pixelStep : 1.0 / 20
    }
}
