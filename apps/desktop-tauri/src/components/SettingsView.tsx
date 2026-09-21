import type { SttMode } from "@algorith-voice/shared-types";
import { Button, Input } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { lazy, Suspense, useEffect, useState } from "react";
import { isTauri } from "../lib/session/env.js";
import { LocalUsageSection } from "./LocalUsageSection.js";
import { triggerUpdateCheck } from "./UpdateAnnouncement.js";

const ModelManager = lazy(() =>
  import("./ModelManager.js").then((m) => ({ default: m.ModelManager })),
);

export interface Prefs {
  hotkey: string;
  mode: SttMode;
  theme: "dark" | "light";
  /** Manifest id of the local model to transcribe with (null = none). */
  activeModelId: string | null;
}

export function SettingsView({
  prefs,
  onPrefs,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
}) {
  const [autostart, setAutostart] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeyInput, setHotkeyInput] = useState(prefs.hotkey);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    setHotkeyInput(prefs.hotkey);
  }, [prefs.hotkey]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string>("get_version")
      .then(setAppVersion)
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isTauri()) {
      void isEnabled()
        .then(setAutostart)
        .catch(() => {
          // autostart plugin may not be available in some builds
        });
    }
    // Listen for tray refresh (hide->show) so toggles stay in sync
    let unlisten: (() => void) | undefined;
    if (isTauri()) {
      void import("@tauri-apps/api/event").then(({ listen }) =>
        listen("settings-refresh", () => {
          void isEnabled()
            .then(setAutostart)
            .catch(() => {});
        }).then((fn) => {
          unlisten = fn;
        }),
      );
    }
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const toggleAutostart = async () => {
    try {
      if (autostart) {
        await disable();
        setAutostart(false);
      } else {
        await enable();
        setAutostart(true);
      }
    } catch (e) {
      // Surface silently before: now at least log so Settings not silently dead
      console.warn("autostart toggle failed", e);
    }
  };

  const handleHotkeySave = async () => {
    const next = hotkeyInput.trim();
    if (!next) {
      setHotkeyError("Hotkey must not be empty.");
      return;
    }
    if (next.length > 32) {
      setHotkeyError("Hotkey too long (max 32 characters).");
      return;
    }
    if (!/^[A-Za-z0-9+_ -]+$/.test(next)) {
      setHotkeyError("Hotkey contains unsupported characters.");
      return;
    }
    const lower = next.toLowerCase();
    const hasModifier = [
      "ctrl",
      "alt",
      "shift",
      "super",
      "meta",
      "command",
      "cmd",
    ].some((m) => lower.includes(m));
    if (!hasModifier || !lower.includes("+")) {
      setHotkeyError("Use a modifier + key, e.g. Ctrl+Space.");
      return;
    }
    if (next === prefs.hotkey) {
      setHotkeyError(null);
      return;
    }
    if (isTauri()) {
      try {
        await invoke("register_hotkey", { shortcut: next });
        onPrefs({ ...prefs, hotkey: next });
        setHotkeyError(null);
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : (() => {
                  try {
                    return JSON.stringify(e);
                  } catch {
                    return String(e);
                  }
                })();
        setHotkeyError(
          `${msg} — pick a different hotkey (it may be owned by the OS or another app).`,
        );
        // Surface registration failure outside the inline hint too: hotkey
        // conflicts are otherwise easy to miss.
        try {
          const { sendNotification } = await import(
            "@tauri-apps/plugin-notification"
          );
          sendNotification({
            title: "Hotkey unavailable",
            body: msg.slice(0, 200),
          });
        } catch {
          // Notification plugin is best-effort.
        }
      }
    } else {
      // Browser preview: just save pref
      onPrefs({ ...prefs, hotkey: next });
      setHotkeyError(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[900px] p-4 sm:p-6 lg:p-8 2xl:max-w-[1060px]">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-white">
        Settings
      </h1>
      <p className="mt-2 text-sm text-gray-500 lg:text-[15px]">
        Manage your preferences. Changes save automatically.
      </p>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          Dictation
        </h2>
        <div className="mt-4 flex flex-col gap-6">
          <label
            className="flex flex-col gap-2 text-sm text-gray-500"
            htmlFor="av-hotkey"
          >
            Push-to-talk hotkey
            <div className="flex gap-2">
              <Input
                id="av-hotkey"
                value={hotkeyInput}
                onChange={(e) => {
                  setHotkeyInput(e.target.value);
                  setHotkeyError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleHotkeySave();
                }}
                onBlur={() => void handleHotkeySave()}
                className="flex-1 font-mono"
                spellCheck={false}
                placeholder="Ctrl+Space"
              />
              <Button
                variant="secondary"
                onClick={() => void handleHotkeySave()}
              >
                Save
              </Button>
            </div>
            {hotkeyError ? (
              <span className="text-xs text-red-500">{hotkeyError}</span>
            ) : (
              <span className="text-xs text-gray-500">
                Press and hold to talk. Works in any app. Example: Ctrl+Space,
                Alt+Space
              </span>
            )}
          </label>

          <div>
            <p className="text-sm text-gray-500">Transcription mode</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant={prefs.mode === "cloud" ? "primary" : "secondary"}
                onClick={() => onPrefs({ ...prefs, mode: "cloud" })}
              >
                Cloud
              </Button>
              <Button
                variant={prefs.mode === "local" ? "primary" : "secondary"}
                onClick={() => onPrefs({ ...prefs, mode: "local" })}
                title="On-device transcription — audio never leaves this computer"
              >
                Local (offline)
              </Button>
            </div>
            {prefs.mode === "local" ? (
              <>
                <div className="mt-4">
                  <Suspense
                    fallback={
                      <p className="text-xs text-gray-500">
                        Loading model manager…
                      </p>
                    }
                  >
                    <ModelManager prefs={prefs} onPrefs={onPrefs} />
                  </Suspense>
                </div>
                {prefs.activeModelId ? (
                  <p className="mt-2 text-xs text-gray-500">
                    Audio is processed locally on this computer — no audio or
                    transcripts are uploaded.
                  </p>
                ) : (
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                    No local model selected — download one below and click “Use
                    this model” to enable offline transcription.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Cloud uses Groq Whisper (whisper-large-v3-turbo). Audio is sent
                securely; transcripts are stored only locally.
              </p>
            )}
          </div>
        </div>
      </section>

      <LocalUsageSection />

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          Appearance
        </h2>
        <div className="mt-4 flex gap-2">
          {(["dark", "light"] as const).map((t) => (
            <Button
              key={t}
              variant={prefs.theme === t ? "primary" : "secondary"}
              onClick={() => onPrefs({ ...prefs, theme: t })}
            >
              {t === "dark" ? "Dark" : "Light"}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Applies instantly. Respects system theme on first launch.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          System
        </h2>
        <label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-black dark:text-white">
          <input
            type="checkbox"
            checked={autostart}
            onChange={toggleAutostart}
            className="size-4 accent-black dark:accent-white"
          />
          Launch at login
        </label>
        <p className="mt-2 text-xs text-gray-500">
          Starts Algorith Voice in the background when you sign in.
        </p>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          Updates
        </h2>
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div>
              <p className="text-sm font-medium text-black dark:text-white">
                {appVersion ? `v${appVersion}` : "Algorith Voice"}
              </p>
              <p className="text-xs text-gray-500">
                {isTauri()
                  ? "Installed via Tauri updater"
                  : "Browser preview — updater disabled"}
              </p>
            </div>
            <Button
              variant="secondary"
              disabled={checkingUpdate}
              onClick={() => {
                if (!isTauri()) return;
                setCheckingUpdate(true);
                triggerUpdateCheck();
                window.setTimeout(() => setCheckingUpdate(false), 2500);
              }}
            >
              {checkingUpdate ? "Checking…" : "Check for updates"}
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-gray-500">
            When a new version is available you’ll see a banner at the top.
            Update installs in-app and restarts automatically — no manual
            download. You can also{" "}
            <a
              href="https://github.com/algorithco/algorithvoice/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-black dark:hover:text-white"
            >
              view releases on GitHub
            </a>
            .
          </p>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-4 sm:p-6 dark:border-white/10 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          Diagnostics
        </h2>
        <p className="mt-2 text-xs text-gray-500">
          Structured Rust logs live in{" "}
          <span className="font-mono">&lt;app_data&gt;/logs/</span> (auth,
          downloads, hotkeys, DB). Attach them when reporting issues.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                if (!isTauri()) return;
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const dir = await invoke<string>("get_log_dir");
                  const { openUrl } = await import("@tauri-apps/plugin-opener");
                  // openUrl handles file:// on desktop shells; fall back to copy.
                  await openUrl(`file://${dir}`).catch(async () => {
                    await navigator.clipboard.writeText(dir).catch(() => {});
                  });
                } catch {
                  // best-effort
                }
              })();
            }}
          >
            Open logs folder
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void (async () => {
                try {
                  const { invoke } = await import("@tauri-apps/api/core");
                  const text = await invoke<string>("read_recent_logs", {
                    maxBytes: 200_000,
                  });
                  await navigator.clipboard.writeText(text).catch(() => {});
                } catch {
                  // best-effort
                }
              })();
            }}
          >
            Copy recent logs
          </Button>
        </div>
      </section>

      <p className="mt-8 text-xs text-gray-500">
        Algorith Voice {appVersion ? `v${appVersion}` : "v0.4.0"} • Pure black
        &amp; white • No fake analytics
      </p>
    </div>
  );
}
