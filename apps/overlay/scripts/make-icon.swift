// Draws FlowCTL's app icon and writes Resources/AppIcon.icns.
// Usage, in apps/overlay: swift scripts/make-icon.swift [preview.png]
// (needs macOS's iconutil). The icon is checked in; run this only to change it.
//
// A graphite squircle on the macOS icon grid (824 of 1024, continuous
// corners) holding a small graph: the logo's blue pixel node, working, fed by
// a finished green one, with a pending one after it.
import AppKit

/// A rectangle with continuous corners, as Apple's icons: each corner is a
/// quarter of a superellipse (|x|^n + |y|^n = 1).
func squircle(_ r: CGRect, corner c: CGFloat = 185, exponent n: CGFloat = 4) -> CGPath {
    let path = CGMutablePath()
    let centers = [
        CGPoint(x: r.maxX - c, y: r.maxY - c), CGPoint(x: r.minX + c, y: r.maxY - c),
        CGPoint(x: r.minX + c, y: r.minY + c), CGPoint(x: r.maxX - c, y: r.minY + c)
    ]
    for (i, center) in centers.enumerated() {
        for step in 0...60 {
            let t = (CGFloat(i) + CGFloat(step) / 60) * .pi / 2
            let cx = cos(t), sy = sin(t)
            let p = CGPoint(x: center.x + c * copysign(pow(abs(cx), 2 / n), cx),
                            y: center.y + c * copysign(pow(abs(sy), 2 / n), sy))
            i == 0 && step == 0 ? path.move(to: p) : path.addLine(to: p)
        }
    }
    path.closeSubpath()
    return path
}

func rgb(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat(hex >> 16 & 0xff) / 255, green: CGFloat(hex >> 8 & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
}

/// The viewer's pixel node: an 8×8 disc, outline, body, a light corner and a shade.
enum Part { case outline, body, light, shade }
let disc: [[Part?]] = {
    let o = Part.outline, b = Part.body, l = Part.light, s = Part.shade
    return [
        [nil, nil, o, o, o, o, nil, nil],
        [nil, o, l, b, b, b, o, nil],
        [o, l, b, b, b, b, b, o],
        [o, b, b, b, b, b, b, o],
        [o, b, b, b, b, b, b, o],
        [o, b, b, b, b, b, s, o],
        [nil, o, b, b, b, s, o, nil],
        [nil, nil, o, o, o, o, nil, nil]
    ]
}()

struct Node { let center: CGPoint; let cell: CGFloat; let body: UInt32; let light: UInt32; let shade: UInt32 }

func draw(_ node: Node, in ctx: CGContext) {
    let origin = CGPoint(x: node.center.x - node.cell * 4, y: node.center.y + node.cell * 4)
    for (y, row) in disc.enumerated() {
        for (x, part) in row.enumerated() {
            guard let part else { continue }
            let color: CGColor
            switch part {
            case .outline: color = rgb(0x0b0d11)
            case .body: color = rgb(node.body)
            case .light: color = rgb(node.light)
            case .shade: color = rgb(node.shade)
            }
            ctx.setFillColor(color)
            // A hair wider than a cell, so neighbouring cells leave no seam.
            ctx.fill(CGRect(x: origin.x + CGFloat(x) * node.cell - 0.5, y: origin.y - CGFloat(y + 1) * node.cell - 0.5,
                            width: node.cell + 1, height: node.cell + 1))
        }
    }
}

func drawIcon(size: CGFloat) -> NSBitmapImageRep {
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size), pixelsHigh: Int(size), bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext
    ctx.scaleBy(x: size / 1024, y: size / 1024)
    ctx.interpolationQuality = .none

    let body = CGRect(x: 100, y: 100, width: 824, height: 824)
    let shape = squircle(body)

    // The icon's own drop shadow, as the system's icons have.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10), blur: 28, color: rgb(0x000000, 0.3))
    ctx.addPath(shape)
    ctx.setFillColor(rgb(0x000000))
    ctx.fillPath()
    ctx.restoreGState()

    // Graphite, lighter at the top, as Terminal's and the developer tools'.
    ctx.saveGState()
    ctx.addPath(shape)
    ctx.clip()
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ground = CGGradient(colorsSpace: space, colors: [rgb(0x30353f), rgb(0x1b1e25), rgb(0x111318)] as CFArray, locations: [0, 0.55, 1])!
    ctx.drawLinearGradient(ground, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 100), options: [])

    // A faint dot grid: the overlay's canvas.
    ctx.setFillColor(rgb(0xffffff, 0.06))
    for gx in stride(from: 148, through: 876, by: 52) {
        for gy in stride(from: 148, through: 876, by: 52) {
            ctx.fillEllipse(in: CGRect(x: CGFloat(gx) - 4, y: CGFloat(gy) - 4, width: 8, height: 8))
        }
    }

    // The graph: done → working → pending.
    let done = Node(center: CGPoint(x: 268, y: 714), cell: 18, body: 0x3fb950, light: 0x9be9a8, shade: 0x2a8a3b)
    let working = Node(center: CGPoint(x: 540, y: 470), cell: 34, body: 0x4c8dff, light: 0xa3c5ff, shade: 0x3563b3)
    let pending = Node(center: CGPoint(x: 772, y: 282), cell: 16, body: 0xe6e9ee, light: 0xffffff, shade: 0xb4bac4)
    ctx.setLineCap(.round)
    ctx.setLineWidth(18)
    ctx.setStrokeColor(rgb(0x3fb950, 0.85))
    ctx.move(to: done.center); ctx.addLine(to: working.center); ctx.strokePath()
    ctx.setStrokeColor(rgb(0xffffff, 0.42))
    ctx.setLineDash(phase: 0, lengths: [26, 30])
    ctx.move(to: working.center); ctx.addLine(to: pending.center); ctx.strokePath()
    ctx.setLineDash(phase: 0, lengths: [])

    // The working node glows, as a running node pulses in the viewer.
    let glow = CGGradient(colorsSpace: space, colors: [rgb(0x4c8dff, 0.45), rgb(0x4c8dff, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: working.center, startRadius: 0, endCenter: working.center, endRadius: 300, options: [])
    for node in [done, pending, working] { draw(node, in: ctx) }

    // A soft sheen at the top, as on glass.
    let sheen = CGGradient(colorsSpace: space, colors: [rgb(0xffffff, 0.10), rgb(0xffffff, 0)] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(sheen, start: CGPoint(x: 512, y: 924), end: CGPoint(x: 512, y: 640), options: [])
    ctx.restoreGState()

    // A thin light rim, as the edge of macOS 26's icons.
    ctx.addPath(squircle(body.insetBy(dx: 2, dy: 2), corner: 183))
    ctx.setStrokeColor(rgb(0xffffff, 0.16))
    ctx.setLineWidth(4)
    ctx.strokePath()

    NSGraphicsContext.restoreGraphicsState()
    return rep
}

let fm = FileManager.default
let iconset = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("FlowCTL.iconset")
try? fm.removeItem(at: iconset)
try fm.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let name = scale == 1 ? "icon_\(base)x\(base).png" : "icon_\(base)x\(base)@2x.png"
        try drawIcon(size: CGFloat(base * scale)).representation(using: .png, properties: [:])!.write(to: iconset.appendingPathComponent(name))
    }
}
if CommandLine.arguments.count > 1 {
    try drawIcon(size: 1024).representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
}
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", "Resources/AppIcon.icns"]
try task.run()
task.waitUntilExit()
print(task.terminationStatus == 0 ? "Resources/AppIcon.icns" : "iconutil failed")
