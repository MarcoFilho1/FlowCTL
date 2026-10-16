import SwiftUI

// The control panel's round toggles draw their own glyphs, and each one acts
// out what its option does when it is switched: the nodes gather into a
// circle, the pin comes off, the window sinks away or rises up.

enum ToggleGlyph {
    case onTop, animation, autoShow, hideWhenIdle
}

/// A glyph in a 16×16 box, in the given color, animating between off and on.
struct ToggleGlyphView: View {
    let glyph: ToggleGlyph
    let on: Bool
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        content
            .frame(width: 16, height: 16)
            .animation(reduceMotion ? .easeInOut(duration: 0.2) : .spring(response: 0.5, dampingFraction: 0.72), value: on)
    }

    @ViewBuilder private var content: some View {
        switch glyph {
        case .animation: GraphMorph(progress: on ? 1 : 0, color: color, spins: on && !reduceMotion)
        case .onTop: PinnedWindows(on: on, color: color)
        case .autoShow: RisingWindow(on: on, color: color)
        case .hideWhenIdle: SleepingWindow(on: on, color: color)
        }
    }
}

// MARK: Animation: a mini graph that gathers into a ring of nodes

/// Five nodes: off, a small graph read left to right; on, a ring, as the
/// idle animation forms the nodes into shapes. Edges shared by both stay,
/// the others fade in or out.
private enum Morph {
    static let graph: [CGPoint] = [
        CGPoint(x: 0.06, y: 0.5), CGPoint(x: 0.38, y: 0.18), CGPoint(x: 0.38, y: 0.82),
        CGPoint(x: 0.68, y: 0.5), CGPoint(x: 0.96, y: 0.5)
    ]
    /// The ring's order is 0, 1, 3, 4, 2: each node keeps its neighbours from the graph where it can.
    static let ring: [CGPoint] = {
        let order = [0, 1, 3, 4, 2]
        var points = [CGPoint](repeating: .zero, count: 5)
        for (slot, node) in order.enumerated() {
            let angle = -CGFloat.pi / 2 + CGFloat(slot) * 2 * .pi / 5
            points[node] = CGPoint(x: 0.5 + 0.4 * cos(angle), y: 0.5 + 0.4 * sin(angle))
        }
        return points
    }()
    static let shared: [(Int, Int)] = [(0, 1), (1, 3), (3, 4)]
    static let graphOnly: [(Int, Int)] = [(0, 2), (2, 3)]
    static let ringOnly: [(Int, Int)] = [(4, 2), (2, 0)]

    static func point(_ index: Int, _ progress: CGFloat, in rect: CGRect, turn: CGFloat) -> CGPoint {
        let a = graph[index], b = ring[index]
        var x = a.x + (b.x - a.x) * progress, y = a.y + (b.y - a.y) * progress
        if turn != 0 {
            // The ring turns slowly about its centre once formed.
            let dx = x - 0.5, dy = y - 0.5, angle = turn * progress
            x = 0.5 + dx * cos(angle) - dy * sin(angle)
            y = 0.5 + dx * sin(angle) + dy * cos(angle)
        }
        return CGPoint(x: rect.minX + x * rect.width, y: rect.minY + y * rect.height)
    }
}

private struct MorphEdges: Shape {
    var progress: CGFloat
    var turn: CGFloat
    let edges: [(Int, Int)]

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for (a, b) in edges {
            path.move(to: Morph.point(a, progress, in: rect, turn: turn))
            path.addLine(to: Morph.point(b, progress, in: rect, turn: turn))
        }
        return path
    }
}

private struct MorphNodes: Shape {
    var progress: CGFloat
    var turn: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius: CGFloat = 1.7
        for index in 0..<5 {
            let p = Morph.point(index, progress, in: rect, turn: turn)
            path.addEllipse(in: CGRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2))
        }
        return path
    }
}

struct GraphMorph: View {
    let progress: CGFloat
    let color: Color
    /// On, the ring turns slowly (not with Reduce Motion).
    let spins: Bool

    var body: some View {
        // Paused when off: the ring's last angle stays and unwinds with the progress, so nothing jumps.
        TimelineView(.animation(minimumInterval: 1 / 30, paused: !spins)) { context in
            drawing(turn: CGFloat(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 12) / 12) * 2 * .pi)
        }
    }

    private func drawing(turn: CGFloat) -> some View {
        ZStack {
            MorphEdges(progress: progress, turn: turn, edges: Morph.shared).stroke(color, lineWidth: 1.2)
            MorphEdges(progress: progress, turn: turn, edges: Morph.graphOnly).stroke(color, lineWidth: 1.2).opacity(1 - progress)
            MorphEdges(progress: progress, turn: turn, edges: Morph.ringOnly).stroke(color, lineWidth: 1.2).opacity(progress)
            MorphNodes(progress: progress, turn: turn).fill(color)
        }
    }
}

// MARK: On Top: a window over another, held by a pin

private struct PinnedWindows: View {
    let on: Bool
    let color: Color

    var body: some View {
        ZStack {
            // The window behind, and the one in front.
            RoundedRectangle(cornerRadius: 1.8, style: .continuous)
                .stroke(color.opacity(0.55), lineWidth: 1.2)
                .frame(width: 9, height: 7)
                .offset(x: -3, y: 4)
            RoundedRectangle(cornerRadius: 1.8, style: .continuous)
                .fill(color)
                .frame(width: 10, height: 8)
                .offset(x: 2.5, y: 1.5)
            // The pin: in the front window when on; pulled out and gone when off.
            Image(systemName: "pin.fill")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(color)
                .background(Circle().fill(.clear))
                .rotationEffect(.degrees(on ? 40 : 75))
                .offset(x: on ? 6.5 : 10, y: on ? -5.5 : -12)
                .opacity(on ? 1 : 0)
                .scaleEffect(on ? 1 : 0.6)
        }
    }
}

// MARK: Auto Show: a window that rises from the bottom edge

private struct RisingWindow: View {
    let on: Bool
    let color: Color

    var body: some View {
        ZStack(alignment: .bottom) {
            // The screen's bottom edge, where the window waits when off.
            Capsule().fill(color.opacity(0.55)).frame(width: 14, height: 1.4)
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(color)
                .frame(width: 11, height: on ? 9 : 1.4)
                .offset(y: on ? -4 : 0)
                .opacity(on ? 1 : 0.4)
            // A spark above it as it arrives.
            Image(systemName: "sparkle")
                .font(.system(size: 6, weight: .bold))
                .foregroundStyle(color)
                .offset(x: 6, y: on ? -13 : -4)
                .opacity(on ? 1 : 0)
                .scaleEffect(on ? 1 : 0.3)
        }
        .frame(width: 16, height: 16, alignment: .bottom)
    }
}

// MARK: Hide When Idle: a window that fades and sinks, a moon rising over it

private struct SleepingWindow: View {
    let on: Bool
    let color: Color

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .stroke(color, style: StrokeStyle(lineWidth: 1.3, dash: on ? [2, 1.6] : [20, 0]))
                .frame(width: 11, height: 8)
                .offset(x: -1.5, y: on ? 3.5 : 1)
                .opacity(on ? 0.6 : 1)
            Image(systemName: "moon.fill")
                .font(.system(size: 7, weight: .bold))
                .foregroundStyle(color)
                .offset(x: 4.5, y: on ? -4.5 : 2)
                .rotationEffect(.degrees(on ? 0 : -40))
                .opacity(on ? 1 : 0)
                .scaleEffect(on ? 1 : 0.4)
        }
    }
}

// MARK: Debug sheet

/// Every glyph off and on, and the graph half way, on the toggles' circles:
/// /debug/glyphs renders it large to look at the drawings.
struct ToggleGlyphSheet: View {
    var body: some View {
        VStack(spacing: 8) {
            ForEach([false, true], id: \.self) { on in
                HStack(spacing: 8) {
                    ForEach([ToggleGlyph.onTop, .animation, .autoShow, .hideWhenIdle], id: \.self) { glyph in
                        ZStack {
                            Circle().fill(on ? Color.accentColor : Color.primary.opacity(0.1))
                            ToggleGlyphView(glyph: glyph, on: on, color: on ? .white : .primary)
                        }
                        .frame(width: 30, height: 30)
                    }
                    ZStack {
                        Circle().fill(Color.primary.opacity(0.1))
                        GraphMorph(progress: on ? 0.66 : 0.33, color: .primary, spins: false).frame(width: 16, height: 16)
                    }
                    .frame(width: 30, height: 30)
                }
            }
        }
        .padding(8)
        .background(Color.white)
    }
}
