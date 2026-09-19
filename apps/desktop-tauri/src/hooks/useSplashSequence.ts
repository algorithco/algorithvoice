import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { Prefs } from "../components/SettingsView.js";
import { DEFAULT_PREFS, loadOnboarded, loadPrefs } from "../lib/prefs.js";
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
      void Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
        setPrefs(p);
        setOnboarded(o);
        setReady(true);
      });
      let unlisten: (() => void) | undefined;
      void listen("settings-refresh", () => {
        void loadPrefs().then(setPrefs);
      }).then((fn) => {
        unlisten = fn;
      });
      return () => {
        if (unlisten) unlisten();
      };
    }
    void Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
      setPrefs(p);
      setOnboarded(o);
      setReady(true);
    });
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
