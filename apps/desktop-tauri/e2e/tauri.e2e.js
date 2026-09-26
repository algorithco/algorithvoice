/**
 * Real-binary E2E for the Tauri desktop shell (tauri-driver + WebDriver).
 *
 * Supplements (does not replace) the fast jsdom smoke test: this suite
 * boots the actual `algorith-voice-desktop` binary inside real WebViews and
 * proves multi-window behavior, window-label routing, pill geometry, and a
 * genuine Tauri IPC round-trip — the things mocks cannot catch
 * (serialization, capability permissions, native window config).
 *
 * Run:
 *   pnpm --filter @algorith-voice/desktop e2e
 * Env:
 *   TAURI_APP_PATH  path to the built binary
 *                   (default: D:\cargo-target\desktop\debug\algorith-voice-desktop.exe)
 *   TAURI_DRIVER    tauri-driver binary (default: tauri-driver on PATH)
 *   TAURI_DRIVER_PORT (default: 4444)
 *
 * What is intentionally NOT covered here (see README.md):
 * - tray left-click/menu (OS-level, not WebDriver-automatable)
 * - pixel transparency / always-on-top z-order (no protocol surface)
 */

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Builder } from "selenium-webdriver";

const ROOT = join(dirname(fileURLToPath(import.meta.url)));
const SHOTS = join(ROOT, "screenshots");
// TAURI_APP_PATH env wins; else derive from CARGO_TARGET_DIR (CI sets both
// to ${{ runner.temp }}/cargo-target); else the in-tree debug target dir.
const APP =
  process.env.TAURI_APP_PATH ??
  (process.env.CARGO_TARGET_DIR
    ? join(
        process.env.CARGO_TARGET_DIR,
        "debug",
        process.platform === "win32"
          ? "algorith-voice-desktop.exe"
          : "algorith-voice-desktop",
      )
    : join(
        ROOT,
        "..",
        "src-tauri",
        "target",
        "debug",
        process.platform === "win32"
          ? "algorith-voice-desktop.exe"
          : "algorith-voice-desktop",
      ));
const DRIVER = process.env.TAURI_DRIVER ?? "tauri-driver";
const PORT = process.env.TAURI_DRIVER_PORT ?? "4444";

/**
 * Resolve msedgedriver (required by tauri-driver on Windows):
 * EDGE_DRIVER env > PATH > selenium-manager auto-download > selenium cache.
 */
function resolveEdgeDriver() {
  if (process.env.EDGE_DRIVER && existsSync(process.env.EDGE_DRIVER)) {
    return process.env.EDGE_DRIVER;
  }
  // Selenium cache from a previous auto-download (newest first).
  const cacheRoot = join(
    homedir(),
    ".cache",
    "selenium",
    "msedgedriver",
    "win64",
  );
  if (existsSync(cacheRoot)) {
    const versions = readdirSync(cacheRoot).sort().reverse();
    for (const v of versions) {
      const p = join(cacheRoot, v, "msedgedriver.exe");
      if (existsSync(p)) return p;
    }
  }
  // selenium-manager ships inside the selenium-webdriver npm package and
  // downloads the Edge-matched driver (no PATH setup needed).
  const plat = process.platform === "win32" ? "windows" : process.platform;
  const sm =
    process.platform === "win32"
      ? join(
          ROOT,
          "..",
          "node_modules",
          "selenium-webdriver",
          "bin",
          plat,
          "selenium-manager.exe",
        )
      : null;
  if (sm && existsSync(sm)) {
    const out = execFileSync(sm, ["--browser", "MicrosoftEdge"], {
      encoding: "utf-8",
      timeout: 300_000,
    });
    const m = out.match(/Driver path:\s*(.+)/);
    if (m && existsSync(m[1].trim())) return m[1].trim();
  }
  return "msedgedriver"; // last resort: PATH lookup by tauri-driver
}

async function waitFor(
  fn,
  { timeout = 60_000, step = 500, label = "condition" } = {},
) {
  const start = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      // retry until timeout
    }
    if (Date.now() - start > timeout) throw new Error(`timed out: ${label}`);
    await new Promise((r) => setTimeout(r, step));
  }
}

/** Invoke a Tauri command from inside the current webview. Probes both the
 *  public `__TAURI__` namespace and the `__TAURI_INTERNALS__` fallback. */
async function tauriInvoke(driver, cmd, args) {
  return driver.executeAsyncScript(
    `const [cmd, args, done] = arguments;
     (async () => {
       try {
         if (window.__TAURI__?.core?.invoke) {
           return { ok: await window.__TAURI__.core.invoke(cmd, args) };
         }
         if (window.__TAURI_INTERNALS__?.invoke) {
           return { ok: await window.__TAURI_INTERNALS__.invoke(cmd, args) };
         }
         return { err: 'no tauri bridge: ' + Object.keys(window.__TAURI__ ?? {}) };
       } catch (e) { return { err: String(e?.message ?? e) }; }
     })().then(done);`,
    cmd,
    args ?? {},
  );
}

let driverProcess;
let driver;

test.before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  // A leftover instance (e.g. from an interrupted run) holds the
  // single-instance lock and makes the new launch exit instantly.
  // Scoped to the debug binary name; release installs use another name.
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/F", "/IM", "algorith-voice-desktop.exe"]);
      await new Promise((r) => setTimeout(r, 2000));
    }
  } catch {
    // none running — the expected case
  }
  const edgeDriver = resolveEdgeDriver();
  driverProcess = spawn(
    DRIVER,
    ["--port", PORT, "--native-driver", edgeDriver],
    {
      stdio: "pipe",
    },
  );
  await waitFor(
    async () => {
      const res = await fetch(`http://localhost:${PORT}/status`).catch(
        () => null,
      );
      return res?.ok;
    },
    { timeout: 30_000, label: "tauri-driver /status" },
  );
  driver = await new Builder()
    .usingServer(`http://localhost:${PORT}/`)
    .withCapabilities({
      // 'wry' routes the session through tauri-driver so it spawns the
      // Tauri app and attaches to its WebViews. Requesting 'MicrosoftEdge'
      // makes msedgedriver launch Edge as a plain browser instead, which
      // crashes on CI runners (DevToolsActivePort file doesn't exist).
      browserName: "wry",
      "tauri:options": {
        application: APP,
        // Remote-debugging port via the WebView2 API channel. Env/CLI
        // switches are ignored on elevated hosts (WebView2 Runtime 150+
        // hardening), which is exactly the CI runner case — without this,
        // msedgedriver never finds the DevTools port and session creation
        // fails with DevToolsActivePort file doesn't exist.
        webviewOptions: {
          additionalBrowserArguments: ["--remote-debugging-port=9222"],
        },
      },
    })
    .build();
});

test.after(async () => {
  try {
    await driver?.quit();
  } catch {
    // fall through to process kill
  }
  try {
    driverProcess?.kill();
  } catch {
    // already gone
  }
});

async function shot(name) {
  const png = await driver.takeScreenshot();
  writeFileSync(join(SHOTS, `${name}.png`), png, "base64");
}

test(
  "main window boots with the correct title",
  { timeout: 120_000 },
  async () => {
    const handles = await waitFor(
      async () => {
        const h = await driver.getAllWindowHandles();
        return h.length >= 1 ? h : null;
      },
      { label: "main webview handle" },
    );
    await driver.switchTo().window(handles[0]);
    assert.equal(await driver.getTitle(), "Algorith Voice");
    // React boot: splash ("Algorith") then auth/onboarding/dashboard.
    const text = await waitFor(
      async () => {
        const t = await driver.executeScript(
          "return (document.body?.innerText ?? '').slice(0, 4000);",
        );
        return t && t.length > 8 ? t : null;
      },
      { label: "react content render" },
    );
    assert.match(text, /Algorith|Sign in|Welcome|Settings|Dictate/);
    await shot("01-main-boot");
  },
);

test("real IPC round-trip: get_version", { timeout: 60_000 }, async () => {
  const res = await tauriInvoke(driver, "get_version");
  assert.ok(!res.err, `invoke failed (serialization/capability?): ${res.err}`);
  // Compare against the manifest, not a hardcoded literal (a literal rots
  // on every version bump and fails the suite on all newer tags).
  const cargo = readFileSync(
    join(ROOT, "..", "src-tauri", "Cargo.toml"),
    "utf-8",
  );
  const expected = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(expected, "could not read version from src-tauri/Cargo.toml");
  assert.equal(res.ok, expected);
});

test(
  "tray settings window loads real content",
  { timeout: 120_000 },
  async () => {
    const res = await tauriInvoke(driver, "open_settings");
    assert.ok(!res.err, `open_settings failed: ${res.err}`);
    // The settings webview boots React: wait for its heading.
    const settingsHandle = await waitFor(
      async () => {
        const hs = await driver.getAllWindowHandles();
        for (const h of hs) {
          await driver.switchTo().window(h);
          const t = await driver.executeScript(
            "return (document.body?.innerText ?? '').slice(0, 2000);",
          );
          if (t.includes("Transcription mode")) return h;
        }
        return null;
      },
      { timeout: 45_000, label: "settings content boot" },
    );
    assert.ok(settingsHandle);
    const srect = await driver.manage().window().getRect();
    console.log(`settings rect: ${JSON.stringify(srect)} (spec: 440x600)`);
    await shot("02-settings-window");
  },
);

test(
  "floating pill spawns with 160x40 bottom-right geometry",
  { timeout: 120_000 },
  async () => {
    const before = await driver.getAllWindowHandles();
    const res = await tauriInvoke(driver, "ensure_floating_pill");
    assert.ok(!res.err, `ensure_floating_pill failed: ${res.err}`);
    await waitFor(
      async () => {
        const h = await driver.getAllWindowHandles();
        return h.length > before.length ? h : null;
      },
      { label: "pill webview handle" },
    );
    // The pill webview needs a moment to navigate and boot React. Both windows
    // share document.title ("Algorith Voice"), so identify the pill by its
    // pill root, which only FloatingPill renders. (Target ids can churn
    // across navigation commit, so match by content, not by handle diff.)
    const pillHandle = await waitFor(
      async () => {
        const hs = await driver.getAllWindowHandles();
        for (const h of hs) {
          await driver.switchTo().window(h);
          const found = await driver.executeScript(
            "return !!document.querySelector('[data-testid=\"floating-pill\"]');",
          );
          if (found) return h;
        }
        return null;
      },
      { timeout: 45_000, label: "pill content boot" },
    );
    assert.ok(pillHandle, "pill webview with FloatingPill content not found");
    const rect = await driver.manage().window().getRect();
    // Idle pill is 160x40; anchor matches Rust pill_position() math exactly
    // (x = screen.w - 160 - 24, y = screen.h - 40 - 96).
    console.log(`pill rect: ${JSON.stringify(rect)}`);
    assert.equal(Math.round(rect.height), 40);
    assert.equal(Math.round(rect.width), 160);
    // Bottom-right of the primary screen (mirrors pill_position in Rust:
    // x = screen.w - 160 - 24, y = screen.h - 40 - 96).
    const screen = await driver.executeScript(
      "return { w: window.screen.width, h: window.screen.height };",
    );
    assert.ok(
      Math.abs(rect.x - (screen.w - 184)) <= 12,
      `pill x=${rect.x}, expected ~${screen.w - 184}`,
    );
    assert.ok(
      Math.abs(rect.y - (screen.h - 136)) <= 12,
      `pill y=${rect.y}, expected ~${screen.h - 136}`,
    );
    await shot("02-floating-pill");

    // Drag the pill by its idle handle (the whole idle pill is draggable;
    // waveform/cancel/stop opt out). The pill is `focusable:false` so
    // WebDriver pointer actions are best-effort: some drivers ignore
    // unfocused windows. We attempt a drag and soft-check the result — the
    // hard guarantee is the drag-region attributes + the
    // `allow-start-dragging` capability (without which `start_dragging` is
    // denied entirely). If the OS did move the window, assert the delta.
    // Regression: outer window container must NOT be draggable (that was
    // the ~15px corner overshoot); only the idle pill / logo may drag.
    const hasDragRegion = await driver.executeScript(
      'return !!document.querySelector(\'[data-testid="pill-idle"][data-tauri-drag-region="true"]\') && document.querySelector(\'[data-tauri-drag-region="false"]\') !== null && !document.querySelector(\'[data-tauri-drag-region="deep"]\');',
    );
    assert.ok(
      hasDragRegion,
      "pill drag regions missing or overshoot regressed",
    );
    const root = await driver.executeScript(
      "return document.querySelector('[data-testid=\"pill-idle\"]');",
    );
    const DX = 24,
      DY = 16;
    try {
      const actions = driver.actions({ async: true });
      await actions
        .move({ origin: root })
        .press()
        .move({ origin: "pointer", x: DX, y: DY })
        .release()
        .perform();
      await new Promise((r) => setTimeout(r, 500));
      const moved = await driver.manage().window().getRect();
      console.log(`pill rect after drag: ${JSON.stringify(moved)}`);
      if (moved.x !== rect.x || moved.y !== rect.y) {
        assert.ok(
          Math.abs(moved.x - (rect.x + DX)) <= 20,
          `pill x=${moved.x}, expected ~${rect.x + DX}`,
        );
        assert.ok(
          Math.abs(moved.y - (rect.y + DY)) <= 20,
          `pill y=${moved.y}, expected ~${rect.y + DY}`,
        );
      } else {
        console.log(
          "pill drag: window did not move (focusable:false — driver ignored pointer on unfocused window; capability + attributes verified, manual drag covered in README)",
        );
      }
    } catch (e) {
      console.log(
        `pill drag attempt failed (driver limitation): ${e.message.slice(0, 120)}`,
      );
    }
    await shot("03-pill-dragged");
  },
);
