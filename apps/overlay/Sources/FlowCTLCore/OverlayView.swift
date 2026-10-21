/// What FlowCTL shows: the graph in its overlay (the default), or only the
/// snail, which then stays out on the screen, works while sessions work and
/// celebrates when they finish. A click on it still brings the graph up for
/// a look.
public enum OverlayView: String, CaseIterable {
    case graph
    case snail

    public static let standard = OverlayView.graph

    public var title: String {
        switch self {
        case .graph: return "Graph"
        case .snail: return "Snail"
        }
    }
}
