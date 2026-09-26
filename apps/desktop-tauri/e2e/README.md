# Desktop E2E (tauri-driver + WebDriver)

Real-binary end-to-end coverage for the Tauri shell. The jsdom suite stays
the fast pre-check (`vitest run`); this suite boots the actual
`algorith-voice-desktop` binary in real WebViews. If you hit a white screen
(settings/pill at `about:blank`) or a hanging `invoke`, it is the
window-creation deadlock fixed in Part 2 — window building now bounces to the
main thread via `src-tauri/src/window.rs`. Rebuild after pulling.

## Prereqs (Windows dev machine)

- Visual Studio Build Tools with the C++ workload (`link.exe`) — installed to
  `D:\VSBuildTools` on this machine due to C: space (see Part 2 changelog
  Priority 0). `CARGO_TARGET_DIR=D:\cargo-target\desktop` keeps the large
  `target/` off C:.
- WebView2 Runtime (preinstalled on Windows 10/11; check
  `HKLM\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients`).
- Edge WebDriver (`msedgedriver.exe`) matching the installed Edge version:
  auto-resolved by `tauri.e2e.js` via the bundled `selenium-manager` (no
  manual `PATH` setup). Override with `EDGE_DRIVER` if needed.
- `tauri-driver` 2.x: `cargo install tauri-driver --locked` (puts
  `tauri-driver.exe` on PATH via `~/.cargo/bin`).
- A debug binary: `cargo build --manifest-path apps/desktop-tauri/src-tauri/Cargo.toml`
  with `CARGO_TARGET_DIR` set if C: is tight on space (the E2E `before` hook
  also `taskkill`s a leftover debug binary so the single-instance lock does
  not make the new launch exit instantly).

## Run

```powershell
pnpm --filter @algorith-voice/desktop e2e
# env overrides:
#   TAURI_APP_PATH   path to the binary under test
#   TAURI_DRIVER     tauri-driver binary (default: PATH lookup)
#   TAURI_DRIVER_PORT (default: 4444)
```

Screenshots land in `e2e/screenshots/` (gitignored) for human review.

## What it covers

- Main window boots with title `Algorith Voice` and renders React content.
- Real IPC round-trip (`get_version` → `0.4.0`) from inside the webview —
  catches serialization and capability-permission regressions.
- Settings window: `open_settings` creates the window and it boots React
  (`Transcription mode` heading), proving the main-thread window fix and
  the settings capability (`store`, `autostart`, but no tray/shortcut).
- Floating pill: `ensure_floating_pill` creates the pill webview
  bottom-right (`screen.w-184`, `screen.h-136` idle 160x40), matching
  `pill_position()` in `push_to_talk.rs` (also unit-tested in Rust).
  Recording expands to 260x40 via `set_floating_pill_expanded` (grows
  leftward, same bottom-right anchor). Drag is exercised via the minimal
  idle-pill / logo drag regions + `allow-start-dragging` capability
  (soft-checked: the pill is `focusable:false`, so some WebDriver builds
  ignore pointer actions on unfocused windows; attributes + capability are
  the hard guarantees; outer container is explicitly non-draggable to fix
  the ~15px corner overshoot).

## What it does NOT cover (manual checklist)

- **Tray interactions** (left-click toggle, Show/Settings/Quit menu): OS-level,
  not reachable via the WebDriver protocol. Verify by hand on release:
  1. left-click tray icon toggles the main window,
  2. Show / Settings / Quit menu items work,
  3. Quit exits the process (no ghost icon).
- **Transparency / always-on-top z-order / skip-taskbar**: no WebDriver
  surface. Verify visually (pill has no frame/shadow, floats above windows,
  absent from the taskbar) or extend the suite with screenshot diffing.
- **Global hotkey**: requires OS-level key synthesis; covered by unit tests
  (`normalize_hotkey`) plus manual press-and-hold check.

## CI

`.github/workflows/e2e-desktop.yml` runs this on `windows-latest` — on
`workflow_dispatch` and release tags only, NOT on every PR: a native build +
boot is an order of magnitude slower than unit tests, and Windows runners
are the project's release target (Linux would additionally need
xvfb + WebKit deps).
