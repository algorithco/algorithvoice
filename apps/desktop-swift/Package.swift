// swift-tools-version: 6.2
import PackageDescription

// Algorith Voice — native macOS app (macOS 13+, Xcode 26, Swift 6.2 toolchain).
//
// Layout mirrors the requested structure via explicit target paths:
//   Core/      → AlgorithVoiceCore (portable logic: validation, wire
//                protocol, manifest, license grace — no AppKit, so it stays
//                testable and its behavior matches the Tauri/Rust spec 1:1).
//   App/       → AlgorithVoice executable (entry point + Features/ UI).
//   Resources/ → .app bundling assets (Info.plist used by the Xcode/signing
//                pipeline in PR6; `swift build` does not bundle a .app).
//   Tests/     → XCTest suites, one file per Core module.
//
// Concurrency posture (Swift 6.2 Approachable Concurrency, adopted
// incrementally — one feature at a time):
// - The executable target opts into MainActor-by-default (SE-0466):
//   UI-adjacent code is single-threaded unless explicitly opted out with
//   `nonisolated` or moved into an actor. No `@MainActor` boilerplate needed.
// - Core stays default-isolated (`nonisolated`) and every public value type
//   is explicitly `Sendable`, so it can be shared across isolation domains
//   without data races — and stays testable without actor hops.
// - Language mode stays `.v5` for now: full Swift 6 strict checking is a
//   follow-up once CI compiles green (incremental migration, not big-bang).
// - `@concurrent` is reserved for measured CPU hot paths (audio resample,
//   multi-GB SHA-256 verify, on-device inference in PR3/PR4) — profile
//   first, never blanket-applied.
let package = Package(
    name: "AlgorithVoice",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "AlgorithVoice", targets: ["AlgorithVoice"])
    ],
    targets: [
        .target(
            name: "AlgorithVoiceCore",
            path: "Core",
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]
        ),
        .executableTarget(
            name: "AlgorithVoice",
            dependencies: ["AlgorithVoiceCore"],
            path: "App",
            swiftSettings: [
                .swiftLanguageMode(.v5),
                // SE-0466: single-threaded UI code by default.
                .defaultIsolation(MainActor.self),
            ]
        ),
        .testTarget(
            name: "AlgorithVoiceCoreTests",
            dependencies: ["AlgorithVoiceCore"],
            path: "Tests",
            swiftSettings: [
                .swiftLanguageMode(.v5),
            ]
        ),
    ]
)
