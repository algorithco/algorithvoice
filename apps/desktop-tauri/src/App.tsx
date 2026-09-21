import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { AppSidebar } from "./components/AppSidebar.js";
import { AuthView } from "./components/AuthView.js";
import { ArrowLeft } from "./components/animate-ui/icons/arrow-left.js";
import { DashboardView } from "./components/DashboardView.js";
import { DictateView } from "./components/DictateView.js";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { FloatingPill } from "./components/FloatingPill.js";
import { HistoryView } from "./components/HistoryView.js";
import ParticleLogoLoader from "./components/ParticleLogoLoader.js";
import { type Prefs, SettingsView } from "./components/SettingsView.js";
import { UpdateAnnouncement } from "./components/UpdateAnnouncement.js";
import { useAuthGate } from "./hooks/useAuthGate.js";
import { useOnboardingGate } from "./hooks/useOnboardingGate.js";
import { useSplashSequence } from "./hooks/useSplashSequence.js";
import { useWindowLabel } from "./hooks/useWindowLabel.js";
import { DEFAULT_PREFS, saveOnboarded, savePrefs } from "./lib/prefs.js";
import { ensureFloatingPill } from "./lib/ptt.js";
import { logout } from "./lib/session/auth.js";
import { isTauri } from "./lib/session/env.js";
import type { SessionInfo } from "./lib/session/types.js";

// Code-split heavy, rarely-needed bundles so the floating-pill and settings
// windows don't pay for onboarding/model-management on first paint.
const OnboardingView = lazy(() =>
  import("./components/OnboardingView.js").then((m) => ({
    default: m.OnboardingView,
  })),
);

type View = "dashboard" | "dictate" | "history" | "settings";

export default function App() {
  const [view, setView] = useState<View>("dashboard");
  const { isSettings, isPill } = useWindowLabel();
  const {
    prefs,
    setPrefs,
    onboarded,
    setOnboarded,
    ready,
    session,
    setSession,
    splashDone,
  } = useSplashSequence({
    isSettingsWindow: isSettings,
    isFloatingPill: isPill,
  });
  const [collapsed, setCollapsed] = useState(false);
  const { showAuth, loggedIn } = useAuthGate(session);
  const showOnboarding = useOnboardingGate({ loggedIn, onboarded });

  // Auto-show floating pill once main app is ready (not in pill/settings windows)
  useEffect(() => {
    if (isPill || isSettings) return;
    if (!ready || !splashDone || !onboarded || session === null) return;
    if (!isTauri()) return;
    const id = window.setTimeout(() => {
      void ensureFloatingPill().catch((e: unknown) => {
        console.error("algorith-voice: ensureFloatingPill failed", e);
      });
    }, 650);
    return () => clearTimeout(id);
  }, [ready, splashDone, onboarded, session, isPill, isSettings]);

  // Restore the saved custom hotkey on boot: Rust only arms DEFAULT_HOTKEY
  // in setup(), so without this a restart silently reverts to Ctrl+Space
  // while the UI still displays the custom binding.
  useEffect(() => {
    if (isPill || isSettings) return;
    if (!ready || !splashDone || !onboarded || session === null) return;
    if (!isTauri()) return;
    if (prefs.hotkey === DEFAULT_PREFS.hotkey) return;
    void invoke("register_hotkey", { shortcut: prefs.hotkey }).catch(
      (e: unknown) => {
        console.error("algorith-voice: boot hotkey restore failed", e);
      },
    );
  }, [ready, splashDone, onboarded, session, isPill, isSettings, prefs.hotkey]);

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
    })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: session-changed listen failed", e),
      );
    return () => {
      if (unlisten) unlisten();
    };
  }, [setSession]);

  const updatePrefs = (p: Prefs) => {
    const prev = prefs;
    setPrefs(p);
    void savePrefs(p)
      .then(() => {
        // The floating-pill window runs its own JS context: it loads prefs
        // once at boot and only resyncs on `settings-refresh`. Without this
        // emit the pill keeps a stale mode (e.g. "cloud") after the user
        // switches to Local in Settings, so PTT takes the Groq path and
        // fails with "missing Groq API key" despite local mode selected.
        // Also re-read per-press in FloatingPill as safety net.
        if (isTauri()) {
          void emit("settings-refresh").catch((e: unknown) => {
            console.warn("algorith-voice: settings-refresh emit failed", e);
          });
        }
      })
      .catch((e: unknown) => {
        console.error("algorith-voice: savePrefs failed — reverting", e);
        // Verification failed (store diverged) — revert UI so it matches disk
        setPrefs(prev);
      });
  };

  const handleLogout = () => {
    void logout()
      .then(() => setSession({ loggedIn: false }))
      .catch(() => setSession({ loggedIn: false }));
  };

  const shell =
    "min-h-screen bg-white text-black dark:bg-black dark:text-white";

  if (isPill) {
    return (
      <ErrorBoundary>
        <FloatingPill prefs={prefs} />
      </ErrorBoundary>
    );
  }

  const updateBanner = !isSettings && !isPill ? <UpdateAnnouncement /> : null;

  if (isSettings) {
    return (
      <ErrorBoundary>
        <main className={shell}>
          <SettingsView prefs={prefs} onPrefs={updatePrefs} />
        </main>
      </ErrorBoundary>
    );
  }

  if (!ready || !splashDone || session === null) {
    return (
      <ErrorBoundary>
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
                style={{
                  fontFeatureSettings: '"ss01"',
                  letterSpacing: "0.14em",
                }}
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
      </ErrorBoundary>
    );
  }

  if (showAuth) {
    if (view === "settings") {
      return (
        <ErrorBoundary>
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
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
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
      </ErrorBoundary>
    );
  }

  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <main className={shell}>
          <Suspense fallback={<div className="p-8 text-sm">Loading…</div>}>
            <OnboardingView
              prefs={prefs}
              onPrefs={updatePrefs}
              onDone={() => {
                setOnboarded(true);
                void saveOnboarded();
              }}
            />
          </Suspense>
        </main>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
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
                mode={prefs.mode}
                email={session?.email ?? null}
                onNavigate={setView}
              />
            ) : null}
            {view === "dictate" ? (
              <DictateView hotkey={prefs.hotkey} mode={prefs.mode} />
            ) : null}
            {view === "history" ? <HistoryView /> : null}
            {view === "settings" ? (
              <SettingsView prefs={prefs} onPrefs={updatePrefs} />
            ) : null}
          </div>
        </div>
      </main>
    </ErrorBoundary>
  );
}
