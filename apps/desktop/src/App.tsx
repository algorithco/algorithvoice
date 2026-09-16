import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar.js";
import { AuthView } from "./components/AuthView.js";
import { DashboardView } from "./components/DashboardView.js";
import { DictateView } from "./components/DictateView.js";
import { FloatingPill } from "./components/FloatingPill.js";
import { HistoryView } from "./components/HistoryView.js";
import { OnboardingView } from "./components/OnboardingView.js";
import ParticleLogoLoader from "./components/ParticleLogoLoader.js";
import { type Prefs, SettingsView } from "./components/SettingsView.js";
import {
  DEFAULT_PREFS,
  loadOnboarded,
  loadPrefs,
  saveOnboarded,
  savePrefs,
} from "./lib/prefs.js";
import { type SessionInfo, sessionStatus } from "./lib/session.js";

type View = "dashboard" | "dictate" | "history" | "settings";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [onboarded, setOnboarded] = useState(true);
  const [isSettingsWindow, setIsSettingsWindow] = useState(false);
  const [isFloatingPill, setIsFloatingPill] = useState(false);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    try {
      const label = getCurrentWindow().label;
      setIsSettingsWindow(label === "settings");
      setIsFloatingPill(label === "floating-pill");
    } catch {
      setIsSettingsWindow(false);
      setIsFloatingPill(false);
    }
    void Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
      setPrefs(p);
      setOnboarded(o);
      setReady(true);
    });
    void sessionStatus()
      .then(setSession)
      .catch(() => setSession({ loggedIn: false }));
    const t = setTimeout(() => setSplashDone(true), 3800);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  const shell =
    "min-h-screen bg-white text-black dark:bg-black dark:text-white";

  if (isFloatingPill) {
    return <FloatingPill prefs={prefs} />;
  }

  // Settings runs in its own window: render instantly with defaults and let
  // prefs/session upgrade in place. Never gate it behind the main splash or
  // session flow — the window must show UI even if those stall in a second
  // webview.
  if (isSettingsWindow) {
    return (
      <main className={shell}>
        <SettingsView prefs={prefs} onPrefs={updatePrefs} />
      </main>
    );
  }

  if (!ready || !splashDone || session === null) {
    return (
      <main className="fixed inset-0 bg-black">
        <ParticleLogoLoader
          className="absolute inset-0"
          logoSize={300}
          particleCount={7000}
          cycleDuration={7000}
        />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="h-[300px] w-full shrink-0" aria-hidden />
          <div className="flex select-none items-center gap-[0.24em] -translate-y-[52px]">
            <motion.span
              initial={{ x: -220, filter: "blur(18px)", opacity: 0 }}
              animate={{ x: 0, filter: "blur(0px)", opacity: 1 }}
              transition={{
                duration: 1.05,
                delay: 0.6,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              className="text-[34px] font-[700] tracking-[0.14em] text-white md:text-[42px]"
              style={{ fontFeatureSettings: '"ss01"', letterSpacing: "0.14em" }}
            >
              Algorith
            </motion.span>
            <motion.span
              initial={{ x: 220, filter: "blur(18px)", opacity: 0 }}
              animate={{ x: 0, filter: "blur(0px)", opacity: 1 }}
              transition={{
                duration: 1.05,
                delay: 0.6,
                ease: [0.22, 0.61, 0.36, 1],
              }}
              className="text-[34px] font-[300] tracking-[0.14em] text-white md:text-[42px]"
            >
              Voice
            </motion.span>
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-10 left-1/2 flex -translate-x-1/2 flex-col items-center gap-3">
          <div className="h-[2px] w-24 overflow-hidden rounded bg-white/10">
            <div
              className="h-full w-1/2 bg-white"
              style={{ animation: "shimmer 1.2s ease-in-out infinite" }}
            />
          </div>
          <p className="text-[10px] tracking-[0.2em] text-white/50 uppercase">
            Loading
          </p>
        </div>
      </main>
    );
  }

  // Signed-out users land on the login page first — nothing else renders
  // before this. (Settings/floating-pill windows return earlier above.)
  if (!session.loggedIn) {
    return (
      <main className="min-h-screen bg-transparent text-white">
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
        <div className="min-w-0 flex-1 overflow-auto">
          {view === "dashboard" ? (
            <DashboardView
              hotkey={prefs.hotkey}
              email={session?.email ?? null}
              onNavigate={setView}
            />
          ) : null}
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
