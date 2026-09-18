import type { LocalModel } from "@algorith-voice/shared-types";
import { Logo } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
  downloadModel,
  getHardwareInfo,
  getModelCompatibilities,
  getModelStatus,
  type HardwareInfo,
  listAvailableModels,
  type ModelCompatibility,
  selectActiveModel,
} from "../lib/localModels.js";
import { isTauri } from "../lib/session/env.js";
import { HotkeyStep } from "./onboarding/HotkeyStep.js";
import { ModelStep } from "./onboarding/ModelStep.js";
import { ModeStep } from "./onboarding/ModeStep.js";
import { ReadyStep } from "./onboarding/ReadyStep.js";
import Particles from "./Particles.js";
import type { Prefs } from "./SettingsView.js";

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
        // Auto-pick based on real compatibility levels, not hard-coded thresholds
        if (!pickedModelId && list.length > 0) {
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
      } catch (e) {
        if (!cancelled)
          setModelError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, cloudOnly]);

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

      <div className="relative z-10 flex min-h-screen w-full items-center justify-center p-6 md:p-8">
        <div className="flex w-full max-w-[680px] flex-col items-center text-center">
          <Logo className="h-8 w-auto text-white md:h-9" />
          <div className="h-8" />
          <h1 className="text-[32px] font-semibold leading-[1.1] tracking-tight text-white md:text-[44px]">
            Welcome to Algorith Voice
          </h1>
          <div className="h-3" />
          <p className="text-sm tracking-wide text-white/40">
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
                setPreparing(true);
                setModelError(null);
                try {
                  onPrefs({
                    ...prefs,
                    mode: "local",
                    activeModelId: pickedModelId,
                  });
                  try {
                    const st = await getModelStatus(pickedModelId);
                    if (
                      st.status === "not-downloaded" ||
                      st.status === "error"
                    ) {
                      await downloadModel(pickedModelId);
                      setModelError(
                        `Download started for ${pickedModelId} — track progress in Settings → Local. You can start with Cloud and switch when ready.`,
                      );
                    } else if (st.status === "ready") {
                      await selectActiveModel(pickedModelId).catch(() => {});
                    }
                  } catch {
                    // Status check is best-effort
                  }
                  setStep(3);
                } finally {
                  setPreparing(false);
                }
              }}
              onSkip={() => {
                onPrefs({ ...prefs, mode: "cloud", activeModelId: null });
                setStep(3);
              }}
            />
          ) : null}

          {step === 3 ? (
            <ReadyStep hotkey={prefs.hotkey} onDone={onDone} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
