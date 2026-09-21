import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { motion } from "motion/react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppSidebar } from "./components/AppSidebar.js";
import { AuthView } from "./components/AuthView.js";
import { ArrowLeft } from "./components/animate-ui/icons/arrow-left.js";
import { PanelLeft } from "./components/animate-ui/icons/panel-left.js";
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const { showAuth, loggedIn } = useAuthGate(session);
  const showOnboarding = useOnboardingGate({ loggedIn, onboarded });

  // Auto-collapse on narrow viewports and keep content usable on small screens
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 767px)");
    const sync = () => {
      if (mql.matches) setCollapsed(true);
    };
    sync();
    // Modern browsers
    if (mql.addEventListener) mql.addEventListener("change", sync);
    else mql.addListener(sync);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", sync);
      else mql.removeListener(sync);
    };
  }, []);

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
    let cancelled = false;
    void listen<SessionInfo>("session-changed", (event) => {
      const payload = event.payload as unknown as SessionInfo;
      if (payload && typeof payload.loggedIn === "boolean") {
        setSession(payload);
        if (!payload.loggedIn) setView("dashboard");
      }
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: session-changed listen failed", e),
      );
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [setSession]);

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastSavedRef = useRef<Prefs>(prefs);
  useEffect(() => {
    lastSavedRef.current = prefs;
  }, [prefs]);
  const updatePrefs = useCallback(
    (p: Prefs) => {
      setPrefs(p);
      const task = saveQueueRef.current.then(async () => {
        await savePrefs(p);
        if (isTauri()) {
          await emit("settings-refresh").catch((e: unknown) => {
            console.warn("algorith-voice: settings-refresh emit failed", e);
          });
        }
        lastSavedRef.current = p;
      });
      task.catch((e: unknown) => {
        console.error("algorith-voice: savePrefs failed", e);
        // keep optimistic UI — do not revert; next reload will reconcile
      });
      // Keep queue chain alive even after failure
      saveQueueRef.current = task.catch(() => {});
    },
    [setPrefs],
  );

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
            <div className="flex min-h-screen overflow-hidden">
              <div className="hidden md:flex">
                <AppSidebar
                  active={view}
                  onSelect={(id) => setView(id as View)}
                  collapsed={collapsed}
                  onCollapsedChange={setCollapsed}
                  email={null}
                  onLogout={handleLogout}
                />
              </div>
              {mobileOpen ? (
                <button
                  type="button"
                  aria-label="Close menu"
                  className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
                  onClick={() => setMobileOpen(false)}
                />
              ) : null}
              <div
                className={`fixed inset-y-0 left-0 z-50 flex max-w-[85vw] transition-transform duration-200 md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
              >
                <AppSidebar
                  active={view}
                  onSelect={(id) => {
                    setView(id as View);
                    setMobileOpen(false);
                  }}
                  collapsed={false}
                  onCollapsedChange={() => {}}
                  email={null}
                  onLogout={handleLogout}
                />
              </div>
              <div className="min-w-0 flex-1 overflow-auto">
                <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-gray-200 bg-white px-3 dark:border-white/10 dark:bg-black md:hidden">
                  <button
                    type="button"
                    aria-label={mobileOpen ? "Close menu" : "Open menu"}
                    onClick={() => setMobileOpen((v) => !v)}
                    className="grid size-8 place-items-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
                  >
                    <PanelLeft size={18} />
                  </button>
                  <span className="text-sm font-semibold tracking-tight text-black dark:text-white">
                    Settings
                  </span>
                </div>
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
        <div className="flex min-h-screen overflow-hidden">
          {/* Desktop sidebar */}
          <div className="hidden md:flex">
            <AppSidebar
              active={view}
              onSelect={(id) => setView(id as View)}
              collapsed={collapsed}
              onCollapsedChange={setCollapsed}
              email={session?.email ?? null}
              onLogout={handleLogout}
            />
          </div>
          {/* Mobile drawer */}
          {mobileOpen ? (
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
          ) : null}
          <div
            className={`fixed inset-y-0 left-0 z-50 flex max-w-[85vw] transition-transform duration-200 md:hidden ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
          >
            <AppSidebar
              active={view}
              onSelect={(id) => {
                setView(id as View);
                setMobileOpen(false);
              }}
              collapsed={false}
              onCollapsedChange={() => {}}
              email={session?.email ?? null}
              onLogout={handleLogout}
            />
          </div>
          <div className="min-w-0 flex-1 overflow-auto">
            {/* Mobile top bar */}
            <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-gray-200 bg-white px-3 dark:border-white/10 dark:bg-black md:hidden">
              <button
                type="button"
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                onClick={() => setMobileOpen((v) => !v)}
                className="grid size-8 place-items-center rounded-md text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/10"
              >
                <PanelLeft size={18} />
              </button>
              <span className="text-sm font-semibold tracking-tight text-black dark:text-white">
                Algorith Voice
              </span>
              <span className="ml-auto text-xs text-gray-500">
                {view === "dashboard"
                  ? "Dashboard"
                  : view === "dictate"
                    ? "Dictate"
                    : view === "history"
                      ? "History"
                      : "Settings"}
              </span>
            </div>
            {view === "dashboard" ? (
              <DashboardView
                hotkey={prefs.hotkey}
                mode={prefs.mode}
                activeModelId={prefs.activeModelId}
                email={session?.email ?? null}
                onNavigate={setView}
              />
            ) : null}
            {view === "dictate" ? (
              <DictateView
                hotkey={prefs.hotkey}
                mode={prefs.mode}
                activeModelId={prefs.activeModelId}
              />
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
