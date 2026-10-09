/// What the viewer's sounds sound like: off, or on in one of three styles. The
/// viewer takes it as `setSound(on)` and `setSoundStyle(style)`.
public enum SoundChoice: String, CaseIterable {
    case off
    /// The same style as the viewer's look (`look`).
    case look
    /// Clean sounds: the smooth look's style (`smooth`).
    case smooth
    /// 8-bit sounds: the pixel look's style (`pixel`).
    case pixel

    public static let standard = SoundChoice.look

    public var title: String {
        switch self {
        case .off: return "Off"
        case .look: return "Same as Look"
        case .smooth: return "Clean"
        case .pixel: return "8-bit"
        }
    }

    /// Whether the sounds play.
    public var isOn: Bool { self != .off }

    /// The two stored values for this choice: on/off, and the style (kept when off,
    /// so turning sound back on keeps the style it had).
    public static func from(sound: Bool, style: String) -> SoundChoice {
        guard sound else { return .off }
        guard let choice = SoundChoice(rawValue: style), choice != .off else { return .standard }
        return choice
    }
}
