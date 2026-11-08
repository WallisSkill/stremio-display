// swift-tools-version:5.3

import PackageDescription

let package = Package(
    name: "tauri-plugin-wistv-video",
    platforms: [
        .iOS(.v15),
    ],
    products: [
        .library(
            name: "tauri-plugin-wistv-video",
            type: .static,
            targets: ["tauri-plugin-wistv-video"]
        ),
    ],
    dependencies: [
        .package(name: "Tauri", path: "../.tauri/tauri-api"),
    ],
    targets: [
        .target(
            name: "tauri-plugin-wistv-video",
            dependencies: [
                .byName(name: "Tauri"),
            ],
            path: "Sources"
        ),
    ]
)
