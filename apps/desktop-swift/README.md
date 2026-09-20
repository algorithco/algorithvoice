# desktop-swift — native macOS app (placeholder)

The macOS app starts here (Swift/SwiftUI, macOS 13+).

`apps/desktop-tauri` stays **Windows/Linux only** (`nsis`/`deb`/`appimage`).
No `.dmg`, no `.icns`, no `macOSPrivateApi` in the Tauri bundle — ever.

Shared contracts the Swift app will reuse:

- `packages/shared-types` — Zod schemas are the wire-format reference
  (`deviceType: desktop-macos`, `supportedOs: macos`, `ModelOs::Macos` in
  `apps/desktop-tauri/src-tauri/src/local_asr/manifest.rs`).
- `infra/prisma` — backend data model (the Swift app talks to the same API).
- `apps/desktop-tauri/src-tauri/src/local_asr/default_manifest.json` —
  model catalog (SHA-256 URLs/sizes the Swift downloader can mirror).
