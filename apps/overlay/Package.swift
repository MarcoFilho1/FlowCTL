// swift-tools-version:6.0
import PackageDescription

let v5: [SwiftSetting] = [.swiftLanguageMode(.v5)]

let package = Package(
    name: "FlowCTLOverlay",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "FlowCTL", targets: ["FlowCTL"]),
        .executable(name: "overlay-checks", targets: ["overlay-checks"])
    ],
    targets: [
        // Pure logic (Foundation only): HTTP parsing, snapshots, sessions, file cleanup.
        .target(name: "FlowCTLCore", swiftSettings: v5),
        // The checks of FlowCTLCore, run by XCTest (`swift test`, needs Xcode) and by
        // `swift run overlay-checks` (works with the Command Line Tools alone).
        .target(name: "OverlayChecks", dependencies: ["FlowCTLCore"], swiftSettings: v5),
        .executableTarget(name: "overlay-checks", dependencies: ["OverlayChecks"], swiftSettings: v5),
        // The app: panel, menu bar item, web view, socket server.
        .executableTarget(name: "FlowCTL", dependencies: ["FlowCTLCore"], swiftSettings: v5),
        .testTarget(name: "FlowCTLCoreTests", dependencies: ["OverlayChecks"], swiftSettings: v5)
    ]
)
