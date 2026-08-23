// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CodexResetApp",
    platforms: [.macOS(.v14)],
    products: [.executable(name: "CodexReset", targets: ["CodexReset"])],
    targets: [
        .executableTarget(name: "CodexReset"),
        .testTarget(name: "CodexResetTests", dependencies: ["CodexReset"]),
    ]
)
