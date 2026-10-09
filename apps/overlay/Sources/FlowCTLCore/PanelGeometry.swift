import CoreGraphics

/// The panel's corners, in screen coordinates (y grows upward, as AppKit's).
public enum Corner: String, CaseIterable {
    case topLeft, topRight, bottomLeft, bottomRight
}

/// How big the panel is and where it sits. The viewer asks for the size its
/// graph needs; the panel grows from a small square up to a cap and keeps
/// one corner (its anchor) where it is. Pure, so it is checked without a screen.
public enum PanelGeometry {
    public static let minSize = CGSize(width: 120, height: 120)
    public static let maxSize = CGSize(width: 480, height: 640)
    /// The cap is also at most this share of the screen, each way.
    public static let maxScreenShare: CGFloat = 0.4
    /// Kept between the panel and the screen's edges.
    public static let margin: CGFloat = 12

    /// The largest size on this screen.
    public static func cap(screen: CGRect) -> CGSize {
        CGSize(
            width: max(minSize.width, min(maxSize.width, (screen.width * maxScreenShare).rounded(.down))),
            height: max(minSize.height, min(maxSize.height, (screen.height * maxScreenShare).rounded(.down)))
        )
    }

    /// The window size for the page size the viewer asked for, plus `chrome`
    /// (the strip above the page), between the minimum and the cap.
    public static func size(desired: CGSize, chrome: CGFloat, screen: CGRect) -> CGSize {
        let cap = cap(screen: screen)
        let width = desired.width.isFinite ? desired.width : minSize.width
        let height = desired.height.isFinite ? desired.height + chrome : minSize.height
        return CGSize(
            width: min(cap.width, max(minSize.width, width.rounded(.up))),
            height: min(cap.height, max(minSize.height, height.rounded(.up)))
        )
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
}
