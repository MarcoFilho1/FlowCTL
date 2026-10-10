/// The viewer's palette: follow macOS's appearance (the default), or dark or
/// light whatever it is. The overlay cannot see what is behind it, so a light
/// Mac over a black terminal needs Dark. The viewer takes it as
/// `setTheme('auto' | 'dark' | 'light')`.
public enum ThemeChoice: String, CaseIterable {
    case auto
    case dark
    case light

    public static let standard = ThemeChoice.auto

    public var title: String {
        switch self {
        case .auto: return "Auto"
        case .dark: return "Dark"
        case .light: return "Light"
        }
    }

    /// The choice for a stored value; anything unknown is the default.
    public static func from(_ raw: String) -> ThemeChoice {
        ThemeChoice(rawValue: raw) ?? .standard
    }
}
