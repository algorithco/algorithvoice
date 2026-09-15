import { Sidebar } from "@algorith-voice/ui";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
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

type View = "dictate" | "history" | "settings";

const ITEMS = [
  { id: "dictate", label: "Dictate" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [view, setView] = useState<View>("dictate");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [onboarded, setOnboarded] = useState(true);
  const [isSettingsWindow, setIsSettingsWindow] = useState(false);
  const [ready, setReady] = useState(false);

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
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  if (!ready) return null;

  const shell =
    "min-h-screen bg-white text-black dark:bg-black dark:text-white";

  if (isSettingsWindow) {
    return (
      <main className={shell}>
        <SettingsView prefs={prefs} onPrefs={updatePrefs} />
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
        <div className="border-r border-gray-200 dark:border-gray-800">
          <Sidebar
            items={ITEMS}
            active={view}
            onSelect={(id) => setView(id as View)}
          />
        </div>
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
