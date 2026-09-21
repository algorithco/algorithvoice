import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Prefs } from "../components/SettingsView.js";
import {
  DEFAULT_PREFS,
  loadOnboarded,
  loadPrefs,
  withTimeout,
} from "../lib/prefs.js";
import { sessionStatus } from "../lib/session/auth.js";
import type { SessionInfo } from "../lib/session/types.js";

/** Main-window boot: prefs + onboarded + session with never-block splash timing. */
export function useSplashSequence(opts: {
  isSettingsWindow: boolean;
  isFloatingPill: boolean;
}) {
  const { isSettingsWindow, isFloatingPill } = opts;
  const isSecondary = isSettingsWindow || isFloatingPill;
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [onboarded, setOnboarded] = useState(true);
  const [ready, setReady] = useState(isSecondary);
  const [session, setSession] = useState<SessionInfo | null>(
    isSecondary ? { loggedIn: false } : null,
  );
  const [splashDone, setSplashDone] = useState(isSecondary);

  useEffect(() => {
    if (isSecondary) {
      // Secondary windows must not render with DEFAULT_PREFS cloud flash:
      // wait for store read (withTimeout guards never-block) before ready.
      void withTimeout(
        Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
          setPrefs(p);
          setOnboarded(o);
        }),
        3000,
        undefined,
      )
        .catch((e) => console.warn("algorith-voice: secondary prefs load failed", e))
        .finally(() => setReady(true));
      let unlisten: (() => void) | undefined;
      void listen("settings-refresh", () => {
        void loadPrefs()
          .then(setPrefs)
          .catch((e) => console.warn("algorith-voice: settings-refresh reload failed", e));
      })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn("algorith-voice: settings-refresh listen failed", e));
      return () => {
        if (unlisten) unlisten();
      };
    }
    // Prefs must never block first paint: 3s deadline, then defaults.
    // (Session already had its own 3s fallback below.)
    void withTimeout(
      Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
        setPrefs(p);
        setOnboarded(o);
      }),
      3000,
      undefined,
    )
      .catch((e) => console.warn("algorith-voice: prefs load failed", e))
      .finally(() => setReady(true));
    // Session must never block splash forever — 3s fallback to logged-out
    let settled = false;
    void sessionStatus()
      .then((s) => {
        settled = true;
        setSession(s);
      })
      .catch(() => {
        settled = true;
        setSession({ loggedIn: false });
      });
    const fallback = window.setTimeout(() => {
      if (!settled) setSession({ loggedIn: false });
    }, 3000);
    const t = setTimeout(() => setSplashDone(true), 3800);
    return () => {
      clearTimeout(t);
      clearTimeout(fallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once; secondary flags are initial-only
  }, []);

  return {
    prefs,
    setPrefs,
    onboarded,
    setOnboarded,
    ready,
    session,
    setSession,
    splashDone,
  };
}
