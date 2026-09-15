import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar.js";
import { AuthView } from "./components/AuthView.js";
import { DictateView } from "./components/DictateView.js";
import { HistoryView } from "./components/HistoryView.js";
import { OnboardingView } from "./components/OnboardingView.js";
import { type Prefs, SettingsView } from "./components/SettingsView.js";
import {
  DEFAULT_PREFS,
  loadOnboarded,
  loadPrefs,
  saveOnboarded,
  savePrefs,
} from "./lib/prefs.js";
import { type SessionInfo, sessionStatus } from "./lib/session.js";

type View = "dictate" | "history" | "settings";

export default function App() {
  const [view, setView] = useState<View>("dictate");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [onboarded, setOnboarded] = useState(true);
  const [isSettingsWindow, setIsSettingsWindow] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setIsSettingsWindow(getCurrentWindow().label === "settings");
    } catch {
      setIsSettingsWindow(false);
    }
    void Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
      setPrefs(p);
      setOnboarded(o);
      setReady(true);
    });
    void sessionStatus()
      .then(setSession)
      .catch(() => setSession({ loggedIn: false }));
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  if (!ready || session === null) return null;

  const shell =
    "min-h-screen bg-white text-black dark:bg-black dark:text-white";

  if (isSettingsWindow) {
    return (
      <main className={shell}>
        <SettingsView prefs={prefs} onPrefs={updatePrefs} />
      </main>
    );
  }

  // Signed-out users land on the login page first — nothing else renders
  // before this.
  if (!session.loggedIn) {
    return (
      <main className={shell}>
        <AuthView onDone={setSession} />
      </main>
    );
  }

  if (!onboarded) {
    return (
      <main className={shell}>
        <OnboardingView
          prefs={prefs}
          onPrefs={updatePrefs}
          onDone={() => {
            setOnboarded(true);
            void saveOnboarded();
          }}
        />
      </main>
    );
  }

  return (
    <main className={shell}>
      <div className="flex min-h-screen">
        <AppSidebar
          active={view}
          onSelect={(id) => setView(id as View)}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          email={session?.email ?? null}
        />
        <div className="min-w-0 flex-1">
          {view === "dictate" ? <DictateView hotkey={prefs.hotkey} /> : null}
          {view === "history" ? <HistoryView /> : null}
          {view === "settings" ? (
            <SettingsView prefs={prefs} onPrefs={updatePrefs} />
          ) : null}
        </div>
      </div>
    </main>
  );
}
