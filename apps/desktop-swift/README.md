# desktop-swift — native macOS app

Swift/SwiftUI, macOS 13+, Xcode 26 (Swift 6.2 toolchain). Faithful native port
of `apps/desktop-tauri` (the behavioral spec) — a new client of the existing
system, reusing the backend, `packages/shared-types` contracts, and the model
catalog. No new endpoints, no new WS message types, no new Zod-shaped contracts.

`apps/desktop-tauri` stays **Windows/Linux only** (`nsis`/`deb`/`appimage`).
No `.dmg`, no `.icns`, no `macOSPrivateApi` in the Tauri bundle — ever.

## Layout

```text
Package.swift   swift-tools 6.2; targets map to the directories below
Core/           AlgorithVoiceCore — portable logic, no AppKit:
                AppError, HotkeyValidator, TrayState, VoiceProtocol (WS),
                LocalModels (manifest), SHA256, License (7d grace),
                BackendConfig. Every public value type is Sendable.
App/            AlgorithVoice executable: entry point + Features/
                (PushToTalk, LocalSTT, Settings, Licensing land per-PR)
Resources/      Info.plist (bundle id com.algorithvoice.app — same SERVICE
                string the Rust side uses for the Keychain, so session +
                Groq-key items are shared with no migration) + future assets
Tests/          XCTest suites, one file per Core module
.github/workflows/release-desktop-macos.yml   additive macOS CI (does not
                touch the Windows/Linux release-desktop.yml matrix)
```

## Conventions

- `packages/shared-types` (Zod) is the wire-format reference. Swift `Codable`
  types must accept exactly what the backend sends — see `Core/VoiceProtocol.swift`.
- Backend base URL follows the Tauri convention (`auth.ts`): `ALGORITHVOICE_API_URL`
  (or `VITE_API_URL`) → dev `http://127.0.0.1:3001` → prod `https://api.algorithvoice.com`.
- Cloud STT: `POST /stt/token` → short-lived JWT → `GET /stt/stream?token=`
  (frozen backend auth strategy); audio is binary PCM16 16kHz mono;
  `hello` uses `sampleRate: 16000, codec: "pcm16"` literally.
- Tokens/API keys go in macOS Keychain (`Security` framework, service
  `com.algorithvoice.app`, account `groq-api-key` for BYOK) — never
  `UserDefaults`, never plaintext. Key resolution mirrors
  `resolve_groq_key()`: explicit override → env → Keychain.
- Concurrency (Swift 6.2 Approachable Concurrency, incremental): the app
  target sets `.defaultIsolation(MainActor.self)` (SE-0466) — UI code is
  single-threaded by default, no `@MainActor` boilerplate. Core stays
  `nonisolated` + `Sendable`. `@concurrent` is reserved for measured CPU hot
  paths (audio resample, GB-scale SHA-256, inference — PR3/PR4, profile first).
  Language mode stays `.v5`; full Swift 6 strict checking is a follow-up.
- Quality bar: no `!` outside tests (SwiftLint `force_unwrapping` errors),
  `async`/`throws` with typed `AppError` domains, zero warnings.

## Build / test (macOS only)

```bash
cd apps/desktop-swift
swift build
swift test
swiftlint --strict   # brew install swiftlint
```

(No Xcode project yet — SPM is the build unit; the `.app` bundle, signing,
notarization, Sparkle, and `.dmg` arrive with the PR6 release pipeline.)

## PR sequence (branch `feature/desktop-swift-mvp`)

1. ✅ Scaffold + CI skeleton + portable Core + unit tests (this PR)
2. Networking layer (auth/license/usage REST against existing routes) + tests
3. Push-to-talk core (CGEventTap hotkey, `NSPanel` pill, `AVAudioEngine` tap, cloud STT)
4. Local STT (sherpa-onnx XCFramework via official SPM support — see below)
5. Settings, tray (`NSStatusItem`), license/billing UI
6. Sparkle (stable channel) + signed/notarized `.dmg`

## Decision log

- **sherpa-onnx on macOS: viable, same engine.** Upstream merged official
  Swift/SPM support (`k2-fsa/sherpa-onnx` PR #3816, July 2026): versioned
  XCFrameworks + C-API module map + Swift wrapper + CI. No engine swap needed;
  PR4 pins a versioned XCFramework and wraps the C API for the
  `parakeet-tdt-0.6b-v3` offline transducer. No decision required.
- **Hotkey mechanism (PR3):** `CGEventTap` (accessibility-gated, sees key
  up/down globally) over `NSEvent` global monitor.
- **Paste (PR3):** `NSPasteboard` + synthesized Cmd+V via `CGEvent`, preserving
  and restoring prior clipboard contents (the Rust side never restores — the
  Swift app does it anyway; better UX, same protocol).
- `deviceFingerprint` (PR5): `IOPlatformUUID` via IOKit.
- Billing UI: deep-link to web billing, no native Stripe UI.

## Shared contracts reused

- `packages/shared-types` — Zod schemas are the wire-format reference
  (`deviceType: desktop-macos`, `supportedOs: macos`, `ModelOs::Macos`).
- `infra/prisma` — backend data model (same API).
- `apps/desktop-tauri/src-tauri/src/local_asr/default_manifest.json` —
  model catalog, consumed as-is (SHA-256 URLs/sizes mirrored by the downloader).
