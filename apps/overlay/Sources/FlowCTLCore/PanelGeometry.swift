import CoreGraphics

/// The panel's corners, in screen coordinates (y grows upward, as AppKit's).
public enum Corner: String, CaseIterable {
    case topLeft, topRight, bottomLeft, bottomRight
}

/// The panel's fixed sizes, picked in the menu bar (Size).
public enum PanelSize: String, CaseIterable {
    case small, medium, large

    public static let standard = PanelSize.medium

    /// The whole window, strip included, in points.
    public var size: CGSize {
        switch self {
        case .small: return CGSize(width: 280, height: 180)
        case .medium: return CGSize(width: 360, height: 220)
        case .large: return CGSize(width: 480, height: 300)
        }
    }

    public var title: String {
        switch self {
        case .small: return "Small"
        case .medium: return "Medium"
        case .large: return "Large"
        }
    }
}

/// Where the panel sits: one corner (its anchor) stays put, so a size change
/// grows or shrinks it away from that corner. Pure, so it is checked without a screen.
public enum PanelGeometry {
    /// Kept between the panel and the screen's edges.
    public static let margin: CGFloat = 12

    /// `size`, cut to fit a screen smaller than it.
    public static func fit(_ size: CGSize, screen: CGRect) -> CGSize {
        CGSize(width: min(size.width, screen.width), height: min(size.height, screen.height))
    }

    public static func point(of corner: Corner, in frame: CGRect) -> CGPoint {
        switch corner {
        case .topLeft: return CGPoint(x: frame.minX, y: frame.maxY)
        case .topRight: return CGPoint(x: frame.maxX, y: frame.maxY)
        case .bottomLeft: return CGPoint(x: frame.minX, y: frame.minY)
        case .bottomRight: return CGPoint(x: frame.maxX, y: frame.minY)
        }
    }

    /// A frame of `size` whose `corner` sits at `point`, moved inside `screen`
    /// if it would stick out. A top-right anchor grows left and down.
    public static func frame(size: CGSize, corner: Corner, at point: CGPoint, screen: CGRect) -> CGRect {
        var x: CGFloat
        var y: CGFloat
        switch corner {
        case .topLeft: x = point.x; y = point.y - size.height
        case .topRight: x = point.x - size.width; y = point.y - size.height
        case .bottomLeft: x = point.x; y = point.y
        case .bottomRight: x = point.x - size.width; y = point.y
        }
        x = min(max(x, screen.minX), screen.maxX - size.width)
        y = min(max(y, screen.minY), screen.maxY - size.height)
        return CGRect(x: x, y: y, width: size.width, height: size.height)
    }

    /// The screen corner nearest the panel's center: the anchor after a drag.
    public static func nearestCorner(of frame: CGRect, in screen: CGRect) -> Corner {
        let left = frame.midX < screen.midX
        let top = frame.midY >= screen.midY
        switch (top, left) {
        case (true, true): return .topLeft
        case (true, false): return .topRight
        case (false, true): return .bottomLeft
        case (false, false): return .bottomRight
        }
    }

    /// Where a panel first appears: the top-right corner, inside the margin.
    public static func defaultAnchor(screen: CGRect) -> (corner: Corner, point: CGPoint) {
        (.topRight, CGPoint(x: screen.maxX - margin, y: screen.maxY - margin))
    }

    /// The saved anchor while its point is on one of `screens`, its right and
    /// top edges included (an anchor dragged flush to the edge sits exactly
    /// there); otherwise the default corner of `fallback`. A monitor unplugged
    /// takes its anchor with it, and plugging it back brings the saved one back.
    public static func restore(_ saved: (corner: Corner, point: CGPoint)?, screens: [CGRect], fallback: CGRect) -> (corner: Corner, point: CGPoint) {
        if let saved, screens.contains(where: { $0.insetBy(dx: -1, dy: -1).contains(saved.point) }) {
            return saved
        }
        return defaultAnchor(screen: fallback)
    }
}
