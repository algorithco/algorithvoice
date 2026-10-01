import type {
  DownloadProgress,
  LocalModel,
  ModelStatusInfo,
} from "@algorith-voice/shared-types";
import { Logo } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  cancelDownload,
  downloadModel,
  getHardwareInfo,
  getInstalledModels,
  getModelCompatibilities,
  getModelStatus,
  type HardwareInfo,
  listAvailableModels,
  type ModelCompatibility,
  onDownloadProgress,
  onModelStatusChanged,
  selectActiveModel,
} from "../lib/localModels.js";
import { isTauri } from "../lib/session/env.js";
import { DownloadStep } from "./onboarding/DownloadStep.js";
import { HotkeyStep } from "./onboarding/HotkeyStep.js";
import { ModelStep } from "./onboarding/ModelStep.js";
import { ModeStep } from "./onboarding/ModeStep.js";
import { ReadyStep } from "./onboarding/ReadyStep.js";
import Particles from "./Particles.js";
import type { Prefs } from "./SettingsView.js";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.errorMessage === "string" && o.errorMessage)
      return o.errorMessage;
    if (typeof o.error === "string" && o.error) return o.error;
    if (typeof o.code === "string" && typeof o.message === "string")
      return o.message;
    try {
      const s = JSON.stringify(o);
      if (s && s !== "{}" && s !== "null") return s;
    } catch {}
  }
  return String(e);
}

const STEPS = ["Hotkey", "Mode", "Model", "Ready"] as const;

export function OnboardingView({
  prefs,
  onPrefs,
  onDone,
  initialStep = 0,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  onDone: () => void;
  initialStep?: number;
}) {
  const [step, setStep] = useState(initialStep);
  const [cloudOnly, setCloudOnly] = useState(() => prefs.mode !== "local");
  const [hotkeyInput, setHotkeyInput] = useState(prefs.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [compat, setCompat] = useState<Record<
    string,
    ModelCompatibility
  > | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [pickedModelId, setPickedModelId] = useState<string | null>(
    () => prefs.activeModelId,
  );
  const [preparing, setPreparing] = useState(false);
  // Gated download phase: while set, step 2 renders DownloadStep instead of
  // the model list, and the dashboard stays unreachable until the model is
  // downloaded, verified, and selected (finishLocalSetup).
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [downloadStatus, setDownloadStatus] = useState<ModelStatusInfo | null>(
    null,
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  useEffect(() => {
    setHotkeyInput(prefs.hotkey);
  }, [prefs.hotkey]);

  useEffect(() => {
    setPickedModelId(prefs.activeModelId);
  }, [prefs.activeModelId]);

  // Fetch hardware + catalog + compat when user reaches Model step in local mode
  useEffect(() => {
    if (step !== 2 || cloudOnly) return;
    if (!isTauri()) {
      setModelError(
        "Model manager needs the desktop app shell — you can pick a model later in Settings.",
      );
      return;
    }
    let cancelled = false;
    setModelError(null);
    void (async () => {
      try {
        const [hw, list, comp] = await Promise.all([
          getHardwareInfo().catch(() => null),
          listAvailableModels(),
          getModelCompatibilities().catch(() => null),
        ]);
        if (cancelled) return;
        if (hw) setHardware(hw);
        setModels(list);
        if (comp) {
          const map: Record<string, ModelCompatibility> = {};
          for (const c of comp) map[c.id] = c;
          setCompat(map);
        }
        // Reuse check: after reinstall the prefs are wiped but model files
        // may survive on disk. Prefer an already-verified model over
        // downloading a new one — Continue then skips straight to select.
        if (!pickedModelId) {
          let reused: string | null = null;
          try {
            const installed = await getInstalledModels().catch(() => []);
            const ready: string[] = [];
            for (const m of installed) {
              const st = await getModelStatus(m.id).catch(() => null);
              if (st?.status === "ready") ready.push(m.id);
            }
            if (ready.length > 0) {
              const rank = (id: string) => {
                const lvl = comp?.find((c) => c.id === id)?.level;
                return lvl === "recommended"
                  ? 0
                  : lvl === "compatible"
                    ? 1
                    : lvl === "barely-compatible"
                      ? 2
                      : 3;
              };
              ready.sort((a, b) => rank(a) - rank(b));
              reused = ready[0] ?? null;
            }
          } catch {
            // Fall through to auto-pick below.
          }
          if (reused) {
            setPickedModelId(reused);
          } else if (list.length > 0) {
            let rec: string | null = null;
            if (comp) {
              const byLevel = (lvl: string) =>
                list
                  .filter((m) => comp.find((c) => c.id === m.id)?.level === lvl)
                  .sort(
                    (a, b) =>
                      a.files.reduce((s, f) => s + f.sizeBytes, 0) -
                      b.files.reduce((s, f) => s + f.sizeBytes, 0),
                  );
              const recommended = byLevel("recommended");
              const compatible = byLevel("compatible");
              const barely = byLevel("barely-compatible");
              if (recommended.length > 0) rec = recommended[0].id;
              else if (compatible.length > 0) rec = compatible[0].id;
              else if (barely.length > 0) rec = barely[0].id;
              else
                rec =
                  list.find(
                    (m) =>
                      comp.find((c) => c.id === m.id)?.level !== "unsupported",
                  )?.id ?? null;
            }
            if (!rec) {
              const ramGb = hw ? hw.totalRamBytes / 1_000_000_000 : 8;
              let cand = "parakeet-tdt-0.6b-v3";
              if (ramGb < 4) cand = "whisper-small";
              else if (ramGb >= 16) cand = "qwen3-asr-1.7b";
              else if (ramGb >= 8) cand = "whisper-large-v3-turbo";
              rec = list.some((m) => m.id === cand) ? cand : list[0].id;
            }
            if (rec) setPickedModelId(rec);
          }
        }
      } catch (e) {
        if (!cancelled) setModelError(getErrorMessage(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, cloudOnly]);

  /** Download complete + verified: select (loads the engine), then Ready. */
  const finishLocalSetup = async (id: string) => {
    setDownloadBusy(true);
    try {
      await selectActiveModel(id);
      setDownloadId(null);
      setDownloadProgress(null);
      setDownloadStatus(null);
      setDownloadError(null);
      setStep(3);
    } catch (e) {
      setDownloadError(getErrorMessage(e));
    } finally {
      setDownloadBusy(false);
    }
  };

  // Live download feed while the gate is active. A `ready` status means the
  // files are verified — finish setup (select + load engine) before leaving.
  useEffect(() => {
    if (!downloadId || !isTauri()) return;
    const id = downloadId;
    let cancelled = false;
    let unProgress: (() => void) | undefined;
    let unStatus: (() => void) | undefined;
    void onDownloadProgress((p) => {
      if (!cancelled && p.id === id) setDownloadProgress(p);
    }).then((u) => {
      unProgress = u;
    });
    void onModelStatusChanged((s) => {
      if (cancelled || s.id !== id) return;
      setDownloadStatus(s);
      if (s.status === "ready") {
        void finishLocalSetup(id);
      } else if (s.status === "error") {
        setDownloadError(s.errorMessage || s.errorCode || "Download failed.");
      }
    }).then((u) => {
      unStatus = u;
    });
    return () => {
      cancelled = true;
      unProgress?.();
      unStatus?.();
    };
  }, [downloadId]);

  const resetDownloadState = () => {
    setDownloadId(null);
    setDownloadProgress(null);
    setDownloadStatus(null);
    setDownloadError(null);
    setDownloadBusy(false);
  };

  const handleDownloadCancel = async () => {
    if (!downloadId) return;
    const id = downloadId;
    setDownloadBusy(true);
    try {
      await cancelDownload(id).catch(() => null);
    } finally {
      resetDownloadState();
      setPreparing(false);
    }
  };

  const handleDownloadRetry = async () => {
    if (!downloadId) return;
    const id = downloadId;
    setDownloadBusy(true);
    setDownloadError(null);
    try {
      const st = await getModelStatus(id).catch(() => null);
      if (st?.status === "ready") {
        await finishLocalSetup(id);
        return;
      }
      await downloadModel(id);
    } catch (e) {
      setDownloadError(getErrorMessage(e));
    } finally {
      setDownloadBusy(false);
    }
  };

  const handleUseCloud = async () => {
    if (downloadId) {
      await cancelDownload(downloadId).catch(() => null);
    }
    resetDownloadState();
    setPreparing(false);
    onPrefs({ ...prefs, mode: "cloud", activeModelId: null });
    setStep(3);
  };

  const saveHotkey = async (raw: string): Promise<boolean> => {
    const next = raw.trim();
    if (!next) {
      setHotkeyError("Hotkey must not be empty.");
      return false;
    }
    if (next.length > 32) {
      setHotkeyError("Hotkey too long (max 32 characters).");
      return false;
    }
    if (!/^[A-Za-z0-9+_ -]+$/.test(next)) {
      setHotkeyError("Hotkey contains unsupported characters.");
      return false;
    }
    const lower = next.toLowerCase();
    const hasModifier = [
      "ctrl",
      "alt",
      "shift",
      "super",
      "meta",
      "command",
      "cmd",
    ].some((m) => lower.includes(m));
    if (!hasModifier || !lower.includes("+")) {
      setHotkeyError("Use a modifier + key, e.g. Ctrl+Space.");
      return false;
    }
    if (next === prefs.hotkey) {
      setHotkeyError(null);
      return true;
    }
    try {
      await invoke("register_hotkey", { shortcut: next });
    } catch (e) {
      const isShell =
        typeof window !== "undefined" &&
        ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
      if (isShell) {
        const msg =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : JSON.stringify(e);
        setHotkeyError(msg);
        return false;
      }
    }
    onPrefs({ ...prefs, hotkey: next });
    setHotkeyError(null);
    return true;
  };

  return (
    <div className="fixed inset-0 bg-black">
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Particles
          particleCount={260}
          particleSpread={10}
          speed={0.08}
          particleBaseSize={90}
          sizeRandomness={0.9}
          alphaParticles
          moveParticlesOnHover
          particleHoverFactor={0.8}
          disableRotation={false}
          cameraDistance={20}
          pixelRatio={
            typeof window !== "undefined"
              ? Math.min(window.devicePixelRatio || 1, 2)
              : 1
          }
        />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] w-full justify-center overflow-y-auto p-4 sm:p-6 md:p-8">
        <div className="my-auto flex w-full min-w-0 max-w-[680px] flex-col items-center text-center">
          <Logo className="h-8 w-auto text-white md:h-9" />
          <div className="h-8" />
          <h1 className="text-2xl sm:text-\[32px\] font-semibold leading-[1.1] tracking-tight text-white md:text-[44px]">
            Welcome to Algorith Voice
          </h1>
          <div className="h-3" />
          <p className="text-xs sm:text-sm tracking-wide text-white/60">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
          <div className="h-12" />

          {step === 0 ? (
            <HotkeyStep
              hotkeyInput={hotkeyInput}
              setHotkeyInput={setHotkeyInput}
              hotkeyError={hotkeyError}
              setHotkeyError={setHotkeyError}
              onContinue={() => {
                void saveHotkey(hotkeyInput).then((ok) => {
                  if (ok) setStep(1);
                });
              }}
            />
          ) : null}

          {step === 1 ? (
            <ModeStep
              cloudOnly={cloudOnly}
              setCloudOnly={setCloudOnly}
              onContinue={() => {
                const mode = cloudOnly ? "cloud" : "local";
                onPrefs({ ...prefs, mode });
                setStep(cloudOnly ? 3 : 2);
              }}
            />
          ) : null}

          {step === 2 ? (
            downloadId ? (
              <DownloadStep
                modelName={
                  models?.find((m) => m.id === downloadId)?.name ?? downloadId
                }
                progress={downloadProgress}
                status={downloadStatus}
                error={downloadError}
                busy={downloadBusy}
                onCancel={() => void handleDownloadCancel()}
                onRetry={() => void handleDownloadRetry()}
                onUseCloud={() => void handleUseCloud()}
              />
            ) : (
              <ModelStep
                hardware={hardware}
                models={models}
                compat={compat}
                error={modelError}
                pickedId={pickedModelId}
                busy={preparing}
                onPick={setPickedModelId}
                onContinue={async () => {
                  if (!pickedModelId) {
                    setModelError("Pick a compatible model or choose Cloud.");
                    return;
                  }
                  const c = compat?.[pickedModelId];
                  if (c?.level === "unsupported") {
                    setModelError(c.reasons.join(" "));
                    return;
                  }
                  const id = pickedModelId;
                  setPreparing(true);
                  setModelError(null);
                  try {
                    onPrefs({
                      ...prefs,
                      mode: "local",
                      activeModelId: id,
                    });
                    const st = await getModelStatus(id);
                    if (st.status === "ready") {
                      // Already downloaded + verified: select (loads the
                      // engine) and finish — no download screen needed.
                      await finishLocalSetup(id);
                    } else if (
                      st.status === "not-downloaded" ||
                      st.status === "error" ||
                      st.status === "downloading" ||
                      st.status === "verifying"
                    ) {
                      // Gate: stay on step 2 and show the download until it
                      // is complete. `downloading`/`verifying` attaches to
                      // an in-flight transfer (e.g. started in Settings).
                      if (
                        st.status === "not-downloaded" ||
                        st.status === "error"
                      ) {
                        await downloadModel(id);
                      }
                      setDownloadStatus(st);
                      setDownloadProgress(null);
                      setDownloadError(null);
                      setDownloadId(id);
                    } else {
                      setModelError(`Unexpected model status: ${st.status}`);
                    }
                  } catch (e) {
                    // Non-shell (browser preview) or backend failure: stay on
                    // the list with a message instead of advancing.
                    setModelError(getErrorMessage(e));
                  } finally {
                    setPreparing(false);
                  }
                }}
                onSkip={() => {
                  onPrefs({ ...prefs, mode: "cloud", activeModelId: null });
                  setStep(3);
                }}
              />
            )
          ) : null}

          {step === 3 ? (
            <ReadyStep hotkey={prefs.hotkey} onDone={onDone} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
