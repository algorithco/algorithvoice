import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar.js";
import { AuthView } from "./components/AuthView.js";
import { ArrowLeft } from "./components/animate-ui/icons/arrow-left.js";
import { DashboardView } from "./components/DashboardView.js";
import { DictateView } from "./components/DictateView.js";
import { FloatingPill } from "./components/FloatingPill.js";
import { HistoryView } from "./components/HistoryView.js";
import { OnboardingView } from "./components/OnboardingView.js";
import ParticleLogoLoader from "./components/ParticleLogoLoader.js";
import { type Prefs, SettingsView } from "./components/SettingsView.js";
import { UpdateAnnouncement } from "./components/UpdateAnnouncement.js";
import {
  DEFAULT_PREFS,
  loadOnboarded,
  loadPrefs,
  saveOnboarded,
  savePrefs,
} from "./lib/prefs.js";
import { ensureFloatingPill } from "./lib/ptt.js";
import {
  isTauri,
  logout,
  type SessionInfo,
  sessionStatus,
} from "./lib/session.js";

function detectWindowLabels(): { isSettings: boolean; isPill: boolean } {
  try {
    // Tauri 2 WebviewWindow label is the source of truth for secondary windows.
    // Fallback to Window label for browser preview / older mocks.
    let label: string | null = null;
    try {
      label = getCurrentWebviewWindow().label;
    } catch {
      try {
        label = getCurrentWindow().label;
      } catch {
        label = null;
      }
    }
    return {
      isSettings: label === "settings",
      isPill: label === "floating-pill",
    };
  } catch {
    return { isSettings: false, isPill: false };
  }
}

type View = "dashboard" | "dictate" | "history" | "settings";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [onboarded, setOnboarded] = useState(true);
  const initialLabels = detectWindowLabels();
  const [isSettingsWindow, setIsSettingsWindow] = useState(
    initialLabels.isSettings,
  );
  const [isFloatingPill, setIsFloatingPill] = useState(initialLabels.isPill);
  const [ready, setReady] = useState(
    initialLabels.isSettings || initialLabels.isPill,
  );
  const [session, setSession] = useState<SessionInfo | null>(
    initialLabels.isSettings || initialLabels.isPill
      ? { loggedIn: false }
      : null,
  );
  const [collapsed, setCollapsed] = useState(false);
  const [splashDone, setSplashDone] = useState(
    initialLabels.isSettings || initialLabels.isPill,
  );

  // Tauri injection can be async: re-check label shortly after mount and correct isPill/isSettings if initial was false
  useEffect(() => {
    if (isSettingsWindow || isFloatingPill) return;
    const id = window.setTimeout(() => {
      const late = detectWindowLabels();
      if (late.isSettings && !isSettingsWindow) {
        setIsSettingsWindow(true);
        setReady(true);
        setSplashDone(true);
        setSession({ loggedIn: false });
      }
      if (late.isPill && !isFloatingPill) {
        setIsFloatingPill(true);
        setReady(true);
        setSplashDone(true);
        setSession({ loggedIn: false });
      }
    }, 120);
    return () => clearTimeout(id);
  }, [isSettingsWindow, isFloatingPill]);

  useEffect(() => {
    // Secondary windows already marked ready synchronously above; main window loads prefs.
    if (isSettingsWindow || isFloatingPill) {
      void Promise.all([loadPrefs(), loadOnboarded()]).then(([p, o]) => {
        setPrefs(p);
        setOnboarded(o);
        setReady(true);
      });
      // Refresh prefs when tray reopens hidden settings window (hide->show emits settings-refresh)
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
  }, []);

  // Auto-show floating pill once main app is ready (not in pill/settings windows)
  // Note: pill is usable offline in local mode, so don't gate behind login.
  useEffect(() => {
    if (isFloatingPill || isSettingsWindow) return;
    if (!ready || !splashDone || !onboarded || session === null) return;
    if (!isTauri()) return;
    // Small delay lets main window finish paint before spawning pill
    const id = window.setTimeout(() => {
      void ensureFloatingPill().catch((e) => {
        console.warn("ensureFloatingPill auto-show failed", e);
      });
    }, 650);
    return () => clearTimeout(id);
  }, [ready, splashDone, onboarded, session, isFloatingPill, isSettingsWindow]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", prefs.theme === "dark");
  }, [prefs.theme]);

  // Keep App session in sync with logout from SettingsView or other windows
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<SessionInfo>("session-changed", (event) => {
      const payload = event.payload as unknown as SessionInfo;
      if (payload && typeof payload.loggedIn === "boolean") {
        setSession(payload);
        if (!payload.loggedIn) setView("dashboard");
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const updatePrefs = (p: Prefs) => {
    setPrefs(p);
    void savePrefs(p);
  };

  const handleLogout = () => {
    void logout()
      .then(() => setSession({ loggedIn: false }))
      .catch(() => setSession({ loggedIn: false }));
  };

  const shell =
    "min-h-screen bg-white text-black dark:bg-black dark:text-white";

  if (isFloatingPill) {
    return <FloatingPill prefs={prefs} />;
  }

  // Global in-app updater announcement (fixed top banner, outside splash)
  const updateBanner =
    !isSettingsWindow && !isFloatingPill ? <UpdateAnnouncement /> : null;

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

  // Signed-out users land on login, but Settings must remain reachable
  // (in-app Settings was dead when logged out — trap door to configure
  // hotkey/theme/local model without account).
  if (!session.loggedIn) {
    if (view === "settings") {
      return (
        <main className={shell}>
          {updateBanner}
          <div className="flex min-h-screen">
            <AppSidebar
              active={view}
              onSelect={(id) => setView(id as View)}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              email={null}
              onLogout={handleLogout}
            />
            <div className="min-w-0 flex-1 overflow-auto">
              <SettingsView prefs={prefs} onPrefs={updatePrefs} />
            </div>
          </div>
          <div className="fixed bottom-3 right-3 rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black shadow">
            <button
              type="button"
              onClick={() => setView("dashboard")}
              className="inline-flex items-center gap-1.5"
            >
              <ArrowLeft size={14} animateOnHover />
              Back to sign in
            </button>
          </div>
        </main>
      );
    }
    return (
      <main className="min-h-screen bg-transparent text-white">
        <AuthView onDone={setSession} />
        <button
          type="button"
          onClick={() => setView("settings")}
          className="fixed bottom-3 right-3 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/60 hover:bg-white/15 hover:text-white"
        >
          Settings
        </button>
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
      {updateBanner}
      <div className="flex min-h-screen">
        <AppSidebar
          active={view}
          onSelect={(id) => setView(id as View)}
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          email={session?.email ?? null}
          onLogout={handleLogout}
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
