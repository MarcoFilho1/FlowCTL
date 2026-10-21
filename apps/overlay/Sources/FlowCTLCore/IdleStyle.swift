/// What the idle animation is: the graph's nodes form shapes (the default),
/// or they gather into the snail that walks along the bottom of the screen.
/// The viewer takes it through `window.flowctl.setIdleStyle(style)`.
public enum IdleStyle: String, CaseIterable {
    case shapes
    case pet

    public static let standard = IdleStyle.shapes

    public var title: String {
        switch self {
        case .shapes: return "Shapes"
        case .pet: return "Snail"
        }
    }
}
