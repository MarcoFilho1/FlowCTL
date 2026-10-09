/// How the viewer draws: pixel art (the default) or smooth. The viewer takes
/// it through `window.flowctl.setLook(look)`.
public enum PageLook: String, CaseIterable {
    case pixel
    case smooth

    public static let standard = PageLook.pixel

    public var title: String {
        switch self {
        case .pixel: return "Pixel"
        case .smooth: return "Smooth"
        }
    }
}
