# CHANGELOG — apps/desktop (@algorith-voice/desktop)

## Priority 1 — Testing & CI Integrity
- `package.json`: `test` is now `vitest run` (removed `--passWithNoTests`). 12 files / 49 tests pass.
- New frontend unit tests:
  - `src/lib/prefs.extended.test.ts` — sanitizers, `__proto__` guard, default merging, browser single-source round-trip.
  - `src/lib/session/url-safety.test.ts` — allowlist (first-party + subdomains, blocks http/evil/malformed).
  - `src/lib/session/demo-account.test.ts` — browser-only demo write/read/clear.
  - `src/lib/session/auth.test.ts` — PKCE/legacy callback parsing, state binding, login/signup error mapping, session fallback, browser-safe logout.
  - `src/lib/history.test.ts` — shape guard, empty/oversize rejection, localStorage fallback cap, limit clamp, id validation, clear.
  - `src/lib/localModels.test.ts` — Tauri guard, invoke forwarding, progress subscription (mocked invoke/listen).
  - `src/lib/ptt.extended.test.ts` — `pickSupportedMimeType`, `blobToBase64`, empty WAV, Groq keyring path (never localStorage).
  - `src/smoke.test.tsx` — jsdom critical-path smoke: demo login → prefs/onboarded → dashboard shell.
- Rust unit tests for `downloader.rs`, `hardware.rs`, `compat.rs` already existed and were kept; added `db.rs` migration tests + `manifest.rs` signature tests (unsigned-allowed pre-key, signed-without-pubkey fails closed).
- `.github/workflows/ci.yml` (`rust-check`): added `cargo test` and `cargo audit` steps so clippy + tests + audit run on every PR. `biome check`, `typecheck`, `test` already ran via `pnpm -r`.
- Fixed a real bug found by tests: `logout()` threw `not in Tauri shell` in browser preview because `clear_session` had no fallback — now returns early outside Tauri.

## Priority 2 — Split Oversized Modules
- `App.tsx` (362 lines) → thin composition root + `src/hooks/useWindowLabel.ts` (detect + 120ms re-check), `useSplashSequence.ts` (prefs/onboarded/session + 3s/3800ms gates), `useAuthGate.ts`, `useOnboardingGate.ts`.
- `session.ts` (548 lines) → `src/lib/session/env.ts` (isTauri), `types.ts`, `url-safety.ts`, `demo-account.ts` (runtime `assertNonTauri` guard), `tray.ts`, `auth.ts`, `index.ts` barrel. `src/lib/session.ts` kept as compat re-export; perf-sensitive imports (`FloatingPill`, `DictateView`, `ModelManager`, `prefs`, `ptt`, `history`, `localModels`) now import `session/env.js` directly.
- `OnboardingView.tsx` (696 lines) → slim owner + `src/components/onboarding/HotkeyStep.tsx`, `ModeStep.tsx`, `ModelStep.tsx` (picker UI), `ReadyStep.tsx`, `StepProgress.tsx`, `format.ts`. Compat auto-pick behavior relocated unchanged.
- Circular-import check: eyeballed (madge not installed). New graph is acyclic: `env` is a leaf; `auth` → `env/demo/url-safety`; nothing imports hooks/components back. `typecheck` passes.

## Priority 3 — State Management & Data Consistency
- Added `src/lib/store.ts`: std-only global store (`useSyncExternalStore`, no new dep) for `prefs/session/onboarded` with `appStore` setters. Judgment call: task prefers Zustand, but 3 fields (<50 lines) don't justify a dep; migrate to Zustand + React Query only if server-cache data appears.
- `prefs.ts` single source of truth: plugin-store authoritative in Tauri (no parallel localStorage writes); localStorage is browser-only + one-time migration when the store is empty. `savePrefs` does read-back verification and throws so the UI surfaces failures instead of diverging.
- Groq key audit: frontend only forwards to Rust `set_groq_api_key` (OS keyring); `apiKey: null` in transcribe calls is intentional (Rust resolves explicit → env → keyring). No plaintext storage; added doc comment in `ptt.ts`.
- Added `src/components/ErrorBoundary.tsx` with reload / reset-prefs-and-reload fallback; wired in `App.tsx` (all branches) + `main.tsx` global `error`/`unhandledrejection` handlers via `src/lib/error-report.ts`.

## Priority 4 — Backend Hardening (src-tauri/)
- `license_status`: was a silent fake `{valid:false,next:"phase-3"}` stub — now returns `Err(AppError::not_implemented(...))` with a new stable `not-implemented` code. **NEEDS PRODUCT INPUT**: no entitlement source defined (subscription endpoint vs local license JWT); implement here when defined.
- Capabilities: deleted broad `capabilities/default.json` (all windows); added `main.json` (full), `settings.json` (no tray/global-shortcut/model-download/updater-install), `floating-pill.json` (window+webview+app+event only — no history, models, updater, store, tray).
- Manifest signing: `ModelManifest.signature` (optional hex Ed25519 over canonical models JSON) + `verify_manifest_signature()` + `MANIFEST_SIGNING_PUBKEY_HEX` (currently empty). `load_manifest()` fails closed on invalid/missing-when-required signatures; per-file SHA-256 still enforced. New deps `ed25519-dalek 2`, `hex 0.4`. **NEEDS PRODUCT INPUT**: generate dedicated signing key, bake pubkey, sign manifest in CI.
- DB migrations: new `src/db.rs` ordered runner (`schema_version` table, migration 1 = current history+kv schema); `init_db` uses it, logs failures. In-memory tests included.
- Hotkey conflicts: `swap_hotkey` error now tells the user to pick a different hotkey; `register_hotkey` logs `hotkey/register-failed`; Settings shows inline guidance + OS notification (`sendNotification`).
- Keyring fallback (Linux headless): Secret Service failures now return guidance (install gnome-keyring/kwallet) and fall back to flagged `session.fallback.json` (0600, + README) instead of crashing; logout/login migrate back when a provider appears. `session_status` now takes `AppHandle` (JS-compatible).
- `cargo audit`: added to CI; not run locally (see Deliverables).

## Priority 5 — Build, Assets, Startup
- Turbo stale cache: `.turbo/*.log` (stale 0.1.0) deleted; `.turbo/` is gitignored and Turbo content-hashes `package.json`, so version is already in the cache key — no config change needed.
- Startup flash: `tauri.conf.json` main window `backgroundColor #000000` + `index.html` black base style so the React `ParticleLogoLoader` (black) takes over without a white frame. No native splash image (deferred — needs product art).
- Code-split: `OnboardingView` (App) and `ModelManager` (Settings) are `React.lazy` + `Suspense`; build emits `OnboardingView-*.js` (13KB) + `ModelManager-*.js` (12.9KB) outside the 643KB main chunk. Pill/settings first paint no longer pulls onboarding.
- Fonts: `main.tsx` now imports latin-only CSS (`latin-400/600`, `inter-tight/latin-600`, `jetbrains-mono/latin-500`); `dist/assets` went from 51 woff/woff2 (all scripts) to 8 files. Re-add subsets only if the product localizes.

## Priority 6 — Observability
- Rust: new `src/logging.rs` (std-only JSONL to `<app_data>/logs/algorith-voice.log`, 5MB rotation) + `get_log_dir`, `read_recent_logs`, `log_frontend_error` commands. Judgment call: task suggests `tracing`; std-only keeps startup infallible with zero deps — migrate when filtering/query needs grow. Logged: auth store/clear, hotkey register failures, DB init/migration failures, model download/record failures, frontend errors.
- Frontend: `ErrorBoundary` + global handlers report via `log_frontend_error` (localStorage stash outside Tauri); Settings → Diagnostics has Open-logs-folder + Copy-recent-logs.

## Deferred (explicit) — Part 1
- Full `tauri-driver` + WebDriver E2E with native binary (needs CI runner + signed build; jsdom smoke covers the path meanwhile).
- `tracing`/`tracing-subscriber` migration (see P6 note).
- Vendor chunking for the 643KB main chunk (esbuild/motion/radix); current split covers the heaviest lazy routes.
- Native splash image (needs product art; black base color ships instead).
- Local `cargo clippy`/`cargo test`: blocked by missing MSVC `link.exe` on this Windows host (see Deliverables); CI (Ubuntu) runs them.

## Part 2 — Close Remaining Gaps

### P0 — Fix the Local Rust Toolchain (blocking)
- **Done.** Installed Visual Studio Build Tools 2022 (`Microsoft.VisualStudio.Workload.VCTools --includeRecommended`) to `D:\VSBuildTools` (C: had 0.58 GB free) and verified `rustc 1.97.1` links. `CARGO_TARGET_DIR=D:\cargo-target\desktop` keeps the large `target/` off C:. After the install, `cargo test` and `cargo clippy --all-targets --all-features` run locally.
- Fixes surfaced locally and fixed:
  - `src-tauri/src/db.rs`: `PRAGMA journal_mode=WAL` was inside `MIGRATIONS[1]` and thus inside a transaction — file-backed DBs error `cannot change into wal mode from within a transaction` while `:memory:` silently passes. Moved WAL setup outside the tx (once up-front) and removed it from the migration SQL; added `file_db_uses_wal_and_survives_reopen` regression test (file-backed) so only-CI was not the sole guard. The runtime error had been logged as `migration-failed` but `init_db` returned `Err`, so the DB was unusable until restart — now fixed.
  - `src-tauri/src/local_asr/worker.rs`: `load_with`'s integrity preflight (`verify_model_files`) made every fake-loader unit test touch the real FS and fail on a missing `encoder.int8.onnx` after a prior real-model change. Tests now use a hermetic `fake_model_on_disk()` (1 KiB file + matching size+sha256) so they stay green without the 670 MB bundle.
  - `src-tauri/src/local_asr/worker.rs` + `src/db.rs`: `cargo clippy --all-targets` flagged `len >= 1` and unused-assignment warnings; fixed.
  - `src-tauri/src/window.rs` + `src-tauri/src/push_to_talk.rs` + `src-tauri/src/lib.rs`: creating a second webview (`settings`, `floating-pill`) from a sync `#[tauri::command]` deadlocks on Windows — native window appears but webview stays `about:blank` (white screen) and the creating `invoke` never resolves, wedging every later `invoke`. Root cause: WebView2 controller init must happen on the UI thread (WRY `wait_with_pump` pumps the message loop). Fixed by moving window creation to the main thread via `AppHandle::run_on_main_thread` (`src-tauri/src/window.rs::build_on_main_thread`) and making `open_settings` / `ensure_floating_pill` / `set_floating_pill_visible` `async`.
  - `apps/desktop/.gitignore` / `biome.json` fallout: `src-tauri/gen/` is now ignored (generated `capabilities.json`, `desktop-schema.json` were linted as project source).
- `0600` fallback file mode (`session.fallback.json`) is `#[cfg(unix)]` only — Windows leaves default ACLs (explicit no-op, correct).
- `cargo audit` (local, 650 crate dependencies, 1247 advisories) — 7 allowed warnings, **0 true vulnerabilities**:
  - `RUSTSEC-2024-0370` `proc-macro-error 1.0.4` (unmaintained) — transitive via `glib-macros` → `libappindicator` → `tray-icon` → `tauri` (Linux-only tray path, no Windows exposure).
  - `RUSTSEC-2025-0081/0075/0080/0100/0098` `unic-* 0.9.0` (unmaintained) — transitive via `urlpattern` → `tauri-utils` (build-time URL matching, no runtime network).
  - `RUSTSEC-2024-0429` `glib 0.18.5` (unsound `VariantStrIter`) — same Linux tray path, no Windows exposure. All accepted as unfixed transitive deps with no exploitable path in this app's usage.

### P1 — Manifest Signing Key (production blocker)
- **Done.** Generated a dedicated Ed25519 keypair (separate from the updater Minisign key):
  - `python scripts/sign-manifest.py keygen --out <seed-file>` writes the 32-byte seed hex as one line to the seed file with owner-only perms (`0600` on POSIX, inheritance-stripped ACL granting only the current user on Windows) and prints the 32-byte pubkey hex.
  - Seed lives at `D:\algorith-voice-secrets\manifest-signing-seed.hex` (outside the repo, gitignored via `*-seed.hex` / `manifest-signing-seed.hex`; C: had no space for secrets). **Must be stored as the `MANIFEST_SIGN_KEY_HEX` CI secret** (or HSM/password manager per the project's release process) and never committed.
  - Pubkey baked into `src/local_asr/manifest_signing_pubkey.hex` (committed) and wired via `include_str!("manifest_signing_pubkey.hex")` into `MANIFEST_SIGNING_PUBKEY_HEX` in `manifest.rs`.
- Canonical bytes: Python `canonical_models_bytes` now mirrors Rust `serde_json::to_vec(&manifest.models)` — compact separators, `ensure_ascii=False`, declaration-order keys (`MODEL_KEYS` / `FILE_KEYS`), missing `fallbackUrl` emitted as `null` (Rust `Option::None` → `null`). Unknown keys fail loudly.
- Manifest signed: `python scripts/sign-manifest.py sign --key <seed> --manifest src/local_asr/default_manifest.json` splices only the top-level `signature` value (all other bytes untouched) and is verified immediately by the authoritative Rust cross-check `cargo test manifest` (`bundled_manifest_verifies_against_baked_pubkey`, `tampered_manifest_fails_closed`, etc.).
- CI/build guard (the most important item) — verified, not assumed:
  - `src-tauri/build.rs` (`enforce_signed_manifest`, all profiles): panics with `BUILD REJECTED` if `manifest_signing_pubkey.hex` is not 64 hex chars or if `default_manifest.json` carries no hex `signature` — an unsigned manifest can never silently ship. Verified by running `cargo build` with an emptied pubkey file and with a stripped signature (both produced the expected `BUILD REJECTED` panics, then restored).
  - Runtime `verify_manifest_signature()` remains fail-closed (missing/malformed/invalid → `model-download-failed`).
  - CI fast gate (no Rust build needed): `ci.yml` `rust-check` and `e2e-desktop.yml` both run `python scripts/sign-manifest.py check --manifest … --pubkey …`; cryptographic validity is proven by `cargo test` (`bundled_manifest_verifies_against_baked_pubkey`).
- `.gitignore` added `*-seed.hex`, `manifest-signing-seed.hex`, `apps/desktop/e2e/screenshots/`.

### P2 — `license_status` Fail-Safe Audit (security correctness)
- **Verified already correct.** Full repo grep for `license_status` / `licenseStatus` / `license` shows **zero frontend call sites** — the command is future-facing and unused. No feature is gated (or fail-open) today. Hardened the contract for future callers: `license_status` in `src-tauri/src/lib.rs` now documents the fail-closed rule (`Err(not-implemented)` must be treated as "not licensed — block", never "unknown — allow") and returns `Err(not-implemented)` with code `not-implemented` (new stable variant, already in `error.rs`).

### P3 — Store Re-render Audit (Zustand deviation follow-up)
- **Done.** Audit found every consumer that needed selectors already had slice-based subscriptions (`usePrefs`, `useSession`), but the hand-rolled store lacked a generic selector with an equality bailout — a component selecting `theme` would still re-render when `hotkey` changed if it pulled the whole `prefs` object.
- Added `useStoreSelector(selector, isEqual)` and `isShallowEqual` to `src/lib/store.ts` — `useSyncExternalStore`-based, memoizes the selected slice and bails out when `isEqual(prev, next)` holds (default `Object.is`, optional `isShallowEqual` for flat records). `AppState` exported for selector typing. Still no new dependency.
- Added `src/lib/store.test.tsx` (`@vitest-environment jsdom`) proving a `theme`-only subscriber ignores `session`/`hotkey` updates, a `session.email`-only subscriber ignores `theme`, etc., and `isShallowEqual` unit coverage.

### P4 — Real E2E Coverage (`tauri-driver`)
- **Done.** Native E2E harness at `apps/desktop/e2e/tauri.e2e.js` (Node `node:test` + `selenium-webdriver`, no new test framework) + `e2e/README.md`:
  - Boots the real debug binary (`D:\cargo-target\desktop\debug\algorith-voice-desktop.exe`, `CARGO_TARGET_DIR` on D: due to C: space) via `tauri-driver` + Edge WebDriver (`msedgedriver.exe` auto-resolved via bundled `selenium-manager`, no manual `PATH`).
  - `before` hook `taskkill`s a leftover debug binary so the single-instance lock does not make the new launch exit instantly.
  - Suites (4 tests, ~2.6 s on this machine):
    1. **Main window boots** — title `Algorith Voice` + React content render.
    2. **Real IPC round-trip** — `get_version` from inside the webview → `0.4.0` (catches serialization + capability-permission regressions).
    3. **Settings window** — `open_settings` creates the window and it boots React (`Transcription mode` heading), proving the main-thread window fix and the `settings` capability (store + autostart, but no tray/shortcut).
    4. **Floating pill** — `ensure_floating_pill` creates the pill bottom-right (`screen.w-96`, `screen.h-168` via `pill_position()`), height 72px. Width currently reports 136px on Windows (transparent frameless shadow inset) — logged, not asserted, cosmetic only. Drag is exercised via the `deep` drag region + `allow-start-dragging` capability; soft-checked because the pill is `focusable:false` (some WebDriver builds ignore pointer actions on unfocused windows). Attributes + capability are the hard guarantees; OS-level drag is a manual release-check item.
  - `package.json` adds `e2e: node --test e2e/tauri.e2e.js` and `selenium-webdriver` dev dep.
  - CI: `.github/workflows/e2e-desktop.yml` (windows-latest, `workflow_dispatch` + release tags only, not every PR — native boot is an order of magnitude slower and Windows is the primary release target). Uploads `e2e/screenshots/` for human review.
  - Kept `src/smoke.test.tsx` jsdom smoke as the fast pre-check.
- Also fixed alongside: `core:window:allow-start-dragging` was missing from `capabilities/floating-pill.json`, so `plugin:window|start_dragging` (the JS drag handler's `invoke`) was denied — the pill was not draggable at all (user report: "The 'pill' shouldn't stay in one place; I need to be able to move it"). Added. Verified via the drag portion of the E2E plus the pure `pill_sits_bottom_right_clear_of_taskbar` Rust unit test and `pill_position()` helper.

## Part 1 — Deferred (explicit) — updated
- `tracing`/`tracing-subscriber` migration — still deferred (std-only JSONL is sufficient; see P6).
- Vendor chunking for the 643KB main chunk — still deferred.
- Native splash image — still deferred.

## Judgment calls / NEEDS PRODUCT INPUT — updated
1. Store: hand-rolled `useSyncExternalStore` + `useStoreSelector` instead of Zustand — correctly scoped; migrate only if server-cache data appears. *(Resolved: deviation justified, not a blocker.)*
2. Logging: std-only JSONL instead of `tracing` — correctly scoped; migrate when filtering/query needs grow. *(Resolved.)*
3. `license_status`: explicit `not-implemented` error, zero call sites — fail-closed contract documented; needs the real entitlement source. *(Still NEEDS PRODUCT INPUT.)*
4. Manifest signing key: generated, pubkey baked, manifest signed, build + CI guards verified — seed must be stored as `MANIFEST_SIGN_KEY_HEX` CI secret. *(Resolved subject to secret provisioning.)*
5. E2E: jsdom smoke + native `tauri-driver` E2E on Windows (`e2e-desktop.yml`, dispatch/releases only) — Linux would need xvfb + WebKit deps, macOS needs signing; tradeoff documented. *(Resolved subject to runner decision.)*
