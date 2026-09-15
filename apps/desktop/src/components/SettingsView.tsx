import { Button, Input } from "@algorith-voice/ui";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import {
  isTauri,
  login,
  logout,
  type SessionInfo,
  sessionStatus,
  signup,
} from "../lib/session.js";
import { OAuthButtons } from "./OAuthButtons.js";

export interface Prefs {
  hotkey: string;
  mode: "local" | "cloud";
  vadThreshold: number;
  theme: "dark" | "light";
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
    <div>
      <OAuthButtons onDone={onDone} />
      <div className="my-4 flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
        <span className="av-small text-gray-500">or with email</span>
        <span className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
      </div>
      <div className="flex flex-col gap-3">
        <label className="av-small text-gray-500" htmlFor="av-login-email">
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
        <label className="av-small text-gray-500" htmlFor="av-login-password">
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
      {error ? <p className="av-small mt-3 text-gray-500">{error}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button onClick={submit} disabled={busy || !email || !password}>
          {busy ? "Please wait" : isSignup ? "Create account" : "Log in"}
        </Button>
        <Button variant="secondary" onClick={() => setIsSignup(!isSignup)}>
          {isSignup ? "Have an account?" : "New here?"}
        </Button>
      </div>
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

  return (
    <div className="mx-auto max-w-[640px] p-8">
      <h1 className="av-display">Settings</h1>

      <section className="mt-8">
        <h2 className="av-h2">Account</h2>
        <div className="mt-4">
          {session.loggedIn ? (
            <div className="flex items-center gap-4">
              <p className="av-body">{session.email}</p>
              <Button
                variant="secondary"
                onClick={() => {
                  void logout().then(() => setSession({ loggedIn: false }));
                }}
              >
                Log out
              </Button>
            </div>
          ) : (
            <LoginForm onDone={setSession} />
          )}
        </div>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-8 dark:border-gray-800">
        <h2 className="av-h2">Dictation</h2>
        <div className="mt-4 flex flex-col gap-4">
          <label className="av-small text-gray-500" htmlFor="av-hotkey">
            Push-to-talk hotkey
            <Input
              id="av-hotkey"
              value={prefs.hotkey}
              onChange={(e) => onPrefs({ ...prefs, hotkey: e.target.value })}
              className="av-mono mt-2"
              spellCheck={false}
            />
          </label>
          <div>
            <p className="av-small text-gray-500">Transcription mode</p>
            <div className="mt-2 flex gap-2">
              {(["local", "cloud"] as const).map((m) => (
                <Button
                  key={m}
                  variant={prefs.mode === m ? "primary" : "secondary"}
                  onClick={() => onPrefs({ ...prefs, mode: m })}
                >
                  {m === "local" ? "Local (offline)" : "Cloud"}
                </Button>
              ))}
            </div>
            <p className="av-small mt-2 text-gray-500">
              Local mode: audio never leaves this device.
            </p>
          </div>
          <label className="av-small text-gray-500">
            Voice detection sensitivity ({prefs.vadThreshold.toFixed(2)})
            <input
              type="range"
              min={0.2}
              max={0.9}
              step={0.05}
              value={prefs.vadThreshold}
              onChange={(e) =>
                onPrefs({ ...prefs, vadThreshold: Number(e.target.value) })
              }
              className="mt-2 w-full accent-black dark:accent-white"
            />
          </label>
        </div>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-8 dark:border-gray-800">
        <h2 className="av-h2">Appearance</h2>
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
      </section>

      <section className="mt-8 border-t border-gray-200 pt-8 dark:border-gray-800">
        <h2 className="av-h2">System</h2>
        <label className="av-body mt-4 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={autostart}
            onChange={toggleAutostart}
          />
          Launch at login
        </label>
      </section>
    </div>
  );
}
