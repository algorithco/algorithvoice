import { Button } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "../lib/session/env.js";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

interface UpdaterInfo {
  version: string;
  notes?: string;
  pubDate?: string;
}

const DISMISS_KEY_PREFIX = "av-update-dismissed-";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STARTUP_DELAY_MS = 4000;

function isDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY_PREFIX + version) === "1";
  } catch {
    return false;
  }
}

function dismissVersion(version: string) {
  try {
    localStorage.setItem(DISMISS_KEY_PREFIX + version, "1");
  } catch {}
}

function clearDismissed(version: string) {
  try {
    localStorage.removeItem(DISMISS_KEY_PREFIX + version);
  } catch {}
}

export function UpdateAnnouncement() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [update, setUpdate] = useState<UpdaterInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const checkInFlight = useRef(false);

  const fetchCurrentVersion = useCallback(async () => {
    try {
      const v = await invoke<string>("get_version");
      setCurrentVersion(v);
      return v;
    } catch {
      return null;
    }
  }, []);

  const checkForUpdate = useCallback(async () => {
    if (!isTauri()) return;
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setError(null);
    // Don't overwrite downloading/ready states
    setStatus((s) => (s === "downloading" || s === "ready" ? s : "checking"));
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (!result) {
        setStatus("idle");
        setUpdate(null);
        return;
      }
      // result shape: { version, body, date, ... }
      const raw = result as unknown as {
        version: string;
        body?: string;
        date?: string;
      };
      const info: UpdaterInfo = {
        version: raw.version,
        notes: raw.body,
        pubDate: raw.date,
      };
      if (isDismissed(info.version)) {
        setStatus("idle");
        setUpdate(null);
        return;
      }
      setUpdate(info);
      setStatus("available");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // No update or network error — stay idle silently, but surface if user manually checked
      if (msg && !msg.toLowerCase().includes("not found")) {
        // Keep idle for auto-check, but store for manual check feedback
        setError(msg);
      }
      setStatus("idle");
    } finally {
      checkInFlight.current = false;
    }
  }, []);

  // Initial + periodic check
  useEffect(() => {
    if (!isTauri()) return;
    void fetchCurrentVersion();
    const start = window.setTimeout(() => {
      void checkForUpdate();
    }, STARTUP_DELAY_MS);
    const interval = window.setInterval(() => {
      void checkForUpdate();
    }, CHECK_INTERVAL_MS);
    const onFocus = () => void checkForUpdate();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [checkForUpdate, fetchCurrentVersion]);

  // Also listen for manual check event from Settings
  useEffect(() => {
    const handler = () => void checkForUpdate();
    window.addEventListener("av-check-update", handler);
    return () => window.removeEventListener("av-check-update", handler);
  }, [checkForUpdate]);

  const handleDismiss = useCallback(() => {
    if (update) dismissVersion(update.version);
    setDismissed(true);
    window.setTimeout(() => {
      setStatus("idle");
      setUpdate(null);
      setDismissed(false);
    }, 320);
  }, [update]);

  const handleDownload = useCallback(async () => {
    if (!update) return;
    setStatus("downloading");
    setProgress(0);
    setError(null);
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const result = await check();
      if (!result) {
        throw new Error("Update no longer available");
      }
      let downloaded = 0;
      let contentLength: number | null = null;
      await (
        result as unknown as {
          downloadAndInstall: (
            cb?: (ev: { event: string; data: Record<string, number> }) => void,
          ) => Promise<void>;
        }
      ).downloadAndInstall((ev) => {
        if (
          ev.event === "Started" &&
          typeof ev.data.contentLength === "number"
        ) {
          contentLength = ev.data.contentLength;
        } else if (
          ev.event === "Progress" &&
          typeof ev.data.chunkLength === "number"
        ) {
          downloaded += ev.data.chunkLength;
          if (contentLength) {
            setProgress(Math.round((downloaded / contentLength) * 100));
          } else {
            // Fallback: incremental
            setProgress((p) => Math.min(95, (p ?? 0) + 5));
          }
        } else if (ev.event === "Finished") {
          setProgress(100);
        }
      });
      setStatus("ready");
      setProgress(100);
      clearDismissed(update.version);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setStatus("error");
    }
  }, [update]);

  const handleRelaunch = useCallback(async () => {
    try {
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const visible =
    !dismissed &&
    (status === "available" ||
      status === "downloading" ||
      status === "ready" ||
      status === "error");

  // Also expose manual check trigger for Settings (via event)
  // No UI when idle/checking

  return (
    <AnimatePresence>
      {visible && update ? (
        <motion.div
          initial={{ y: -24, opacity: 0, scale: 0.98 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -16, opacity: 0, scale: 0.98 }}
          transition={{
            type: "spring",
            stiffness: 420,
            damping: 32,
            mass: 0.8,
          }}
          className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center p-3 sm:p-4"
          aria-live="polite"
          aria-label="Update available"
        >
          {/* Card */}
          <div className="pointer-events-auto w-full max-w-[560px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_16px_40px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.08)] dark:border-white/10 dark:bg-black">
            {/* Top accent */}
            <div className="h-1 w-full bg-black dark:bg-white" />

            <div className="p-4 sm:p-5">
              {/* Header row */}
              <div className="flex items-start gap-3">
                {/* Icon */}
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-black text-white shadow-sm dark:bg-white dark:text-black">
                  <SparkleIcon />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold tracking-tight text-black dark:text-white">
                      New version available
                    </h3>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-black dark:border-white/15 dark:bg-white/10 dark:text-white">
                      <span
                        className="size-1.5 rounded-full bg-black motion-safe:animate-pulse dark:bg-white"
                        aria-hidden
                      />
                      v{update.version}
                    </span>
                    {currentVersion ? (
                      <span className="text-xs text-gray-500 dark:text-white/60">
                        from v{currentVersion}
                      </span>
                    ) : null}
                  </div>

                  {update.notes ? (
                    <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-gray-600 dark:text-white/75">
                      {update.notes
                        .replace(/<[^>]*>/g, "")
                        .trim()
                        .slice(0, 220)}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-white/75">
                      Faster local models, polish and bug fixes. Update from
                      inside the app — no download needed.
                    </p>
                  )}

                  {update.pubDate ? (
                    <p className="mt-1 text-xs text-gray-500 dark:text-white/40">
                      Released {new Date(update.pubDate).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>

                {/* Dismiss */}
                <button
                  type="button"
                  onClick={handleDismiss}
                  aria-label="Dismiss"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-black dark:hover:bg-white/10 dark:hover:text-white"
                >
                  <XIcon />
                </button>
              </div>

              {/* Progress */}
              {status === "downloading" ? (
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-white/60">
                    <span>Downloading update…</span>
                    <span className="font-mono tabular-nums">
                      {progress ?? 0}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                    <motion.div
                      className="h-full rounded-full bg-black dark:bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${progress ?? 0}%` }}
                      transition={{
                        type: "spring",
                        stiffness: 300,
                        damping: 30,
                      }}
                    />
                  </div>
                </div>
              ) : null}

              {status === "ready" ? (
                <div className="mt-4 rounded-xl bg-black/5 px-3 py-2.5 text-sm text-black dark:bg-white/10 dark:text-white">
                  Update ready — restart to apply.
                </div>
              ) : null}

              {status === "error" && error ? (
                <div className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
                  {error.slice(0, 280)}
                </div>
              ) : null}

              {/* Actions */}
              <div className="mt-5 flex flex-wrap items-center gap-2">
                {status === "available" ? (
                  <>
                    <Button
                      onClick={handleDownload}
                      className="h-9 rounded-full bg-black px-5 text-sm font-medium text-white hover:bg-black/90 dark:bg-white dark:text-black dark:hover:bg-white/90"
                    >
                      Update now
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleDismiss}
                      className="h-9 rounded-full"
                    >
                      Later
                    </Button>
                    <a
                      href="https://github.com/algorithco/algorithvoice/releases/latest"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 text-xs font-medium text-gray-500 underline-offset-4 hover:text-black hover:underline dark:text-white/60 dark:hover:text-white"
                    >
                      Release notes
                    </a>
                  </>
                ) : null}

                {status === "downloading" ? (
                  <>
                    <Button disabled className="h-9 rounded-full">
                      Downloading…
                    </Button>
                    <span className="text-xs text-gray-500 dark:text-white/40">
                      Keep the app open
                    </span>
                  </>
                ) : null}

                {status === "ready" ? (
                  <>
                    <Button
                      onClick={handleRelaunch}
                      className="h-9 rounded-full bg-black px-5 text-white dark:bg-white dark:text-black"
                    >
                      Restart now
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleDismiss}
                      className="h-9 rounded-full"
                    >
                      Restart later
                    </Button>
                  </>
                ) : null}

                {status === "error" ? (
                  <>
                    <Button
                      onClick={handleDownload}
                      className="h-9 rounded-full"
                    >
                      Retry
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={handleDismiss}
                      className="h-9 rounded-full"
                    >
                      Dismiss
                    </Button>
                  </>
                ) : null}
              </div>

              <p className="mt-3 text-xs text-gray-500 dark:text-white/40">
                Update installs in-app and restarts automatically. Your
                transcripts stay local.
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// Tiny inline icons — flat monochrome, no lucide bundle bloat
function SparkleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2.5l1.7 5.2H19l-4.3 3.2 1.6 5.1L12 12.7 7.7 16 9.3 10.9 5 7.7h5.3L12 2.5Z"
        fill="currentColor"
      />
      <path
        d="M19 13l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"
        fill="currentColor"
        opacity={0.9}
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Helper for Settings to trigger a manual check
export function triggerUpdateCheck() {
  window.dispatchEvent(new Event("av-check-update"));
}
