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
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(
    isSecondary ? { loggedIn: false } : null,
  );
  const [splashDone, setSplashDone] = useState(isSecondary);

  useEffect(() => {
    let cancelled = false;
    if (isSecondary) {
      void withTimeout(
        Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
          if (cancelled) return;
          setPrefs(p);
          setOnboarded(o);
        }),
        3000,
        undefined,
      )
        .catch((e) =>
          console.warn("algorith-voice: secondary prefs load failed", e),
        )
        .finally(() => {
          if (!cancelled) setReady(true);
        });
      let unlisten: (() => void) | undefined;
      let listenCancelled = false;
      void listen("settings-refresh", () => {
        void loadPrefs({ allowMigration: false })
          .then((p) => {
            if (!listenCancelled) setPrefs(p);
          })
          .catch((e) =>
            console.warn("algorith-voice: settings-refresh reload failed", e),
          );
      })
        .then((fn) => {
          if (listenCancelled) fn();
          else unlisten = fn;
        })
        .catch((e) =>
          console.warn("algorith-voice: settings-refresh listen failed", e),
        );
      return () => {
        cancelled = true;
        listenCancelled = true;
        if (unlisten) unlisten();
      };
    }
    void withTimeout(
      Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
        if (cancelled) return;
        setPrefs(p);
        setOnboarded(o);
      }),
      3000,
      undefined,
    )
      .catch((e) => console.warn("algorith-voice: prefs load failed", e))
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    let settled = false;
    void sessionStatus()
      .then((s) => {
        if (cancelled) return;
        settled = true;
        setSession(s);
      })
      .catch(() => {
        if (cancelled) return;
        settled = true;
        setSession({ loggedIn: false });
      });
    const fallback = window.setTimeout(() => {
      if (!cancelled && !settled) setSession({ loggedIn: false });
    }, 3000);
    const t = setTimeout(() => {
      if (!cancelled) setSplashDone(true);
    }, 3800);
    return () => {
      cancelled = true;
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
