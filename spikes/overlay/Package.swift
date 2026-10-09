// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "FlowCTLSpike",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "FlowCTLSpike",
            path: "Sources/FlowCTLSpike",
            swiftSettings: [.swiftLanguageMode(.v5)]
        )
    ]
)
