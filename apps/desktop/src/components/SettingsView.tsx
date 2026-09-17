import type { SttMode } from "@algorith-voice/shared-types";
import { Button, Input } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import {
  DEMO_EMAIL,
  isTauri,
  login,
  loginDemo,
  logout,
  type SessionInfo,
  sessionStatus,
  signup,
} from "../lib/session.js";
import { ModelManager } from "./ModelManager.js";
import { OAuthButtons } from "./OAuthButtons.js";

export interface Prefs {
  hotkey: string;
  mode: SttMode;
  theme: "dark" | "light";
  /** Manifest id of the local model to transcribe with (null = none). */
  activeModelId: string | null;
}

function LoginForm({ onDone }: { onDone: (s: SessionInfo) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = isSignup
        ? await signup(email, password, "Desktop")
        : await login(email, password);
      onDone(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-black">
      <OAuthButtons onDone={onDone} />
      <div className="my-6 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        <span className="text-xs uppercase tracking-wide text-gray-500">
          or with email
        </span>
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="flex flex-col gap-4">
        <label className="text-sm text-gray-500" htmlFor="av-login-email">
          Email
          <Input
            id="av-login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-2"
          />
        </label>
        <label className="text-sm text-gray-500" htmlFor="av-login-password">
          Password
          <Input
            id="av-login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? "new-password" : "current-password"}
            className="mt-2"
          />
        </label>
      </div>
      {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={submit} disabled={busy || !email || !password}>
          {busy ? "Please wait" : isSignup ? "Create account" : "Log in"}
        </Button>
        <Button variant="secondary" onClick={() => setIsSignup(!isSignup)}>
          {isSignup ? "Have an account?" : "New here?"}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setError(null);
            void loginDemo()
              .then(onDone)
              .catch((e: unknown) =>
                setError(
                  e instanceof Error ? e.message : "Demo sign-in failed.",
                ),
              );
          }}
          disabled={busy}
        >
          Demo
        </Button>
      </div>
      <p className="mt-3 text-xs text-gray-500">
        Demo uses {DEMO_EMAIL} locally — no backend required.
      </p>
    </div>
  );
}

export function SettingsView({
  prefs,
  onPrefs,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
}) {
  const [session, setSession] = useState<SessionInfo>({ loggedIn: false });
  const [autostart, setAutostart] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hotkeyInput, setHotkeyInput] = useState(prefs.hotkey);

  useEffect(() => {
    setHotkeyInput(prefs.hotkey);
  }, [prefs.hotkey]);

  useEffect(() => {
    void sessionStatus()
      .then(setSession)
      .catch(() => {});
    if (isTauri()) {
      void isEnabled()
        .then(setAutostart)
        .catch(() => {});
    }
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
    } catch {
      // Plugin unavailable in browser preview.
    }
  };

  const handleHotkeySave = async () => {
    const next = hotkeyInput.trim();
    if (!next) {
      setHotkeyError("Hotkey must not be empty.");
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
        setHotkeyError(e instanceof Error ? e.message : String(e));
      }
    } else {
      // Browser preview: just save pref
      onPrefs({ ...prefs, hotkey: next });
      setHotkeyError(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[900px] p-8">
      <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-white">
        Settings
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage your account and preferences. Changes save automatically.
      </p>

      <section className="mt-8 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-black">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
          Account
        </h2>
        <div className="mt-4">
          {session.loggedIn ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-white/[0.03]">
                <div>
                  <p className="text-sm font-medium text-black dark:text-white">
                    {session.email}
                  </p>
                  <p className="text-xs text-gray-500">
                    Signed in • Plan: free
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void logout().then(() => setSession({ loggedIn: false }));
                  }}
                >
                  Log out
                </Button>
              </div>
              <p className="text-xs text-gray-500">
                Session stored securely in OS keyring. Tokens never touch disk.
              </p>
            </div>
          ) : (
            <LoginForm onDone={setSession} />
          )}
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-black">
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
              <div className="mt-4">
                <ModelManager prefs={prefs} onPrefs={onPrefs} />
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-500">
                Cloud uses Groq Whisper (whisper-large-v3-turbo). Audio is sent
                securely; transcripts are stored only locally.
              </p>
            )}
            <p className="mt-2 text-xs text-gray-500">
              Audio is processed locally on this computer in local mode — no
              audio or transcripts are uploaded.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-black">
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

      <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-black">
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

      <p className="mt-8 text-xs text-gray-500">
        Algorith Voice v0.3.0 • Pure black & white • No fake analytics
      </p>
    </div>
  );
}
