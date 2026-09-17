import type { LocalModel } from "@algorith-voice/shared-types";
import { Button, Logo } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  getHardwareInfo,
  type HardwareInfo,
  listAvailableModels,
} from "../lib/localModels.js";
import { isTauri } from "../lib/session.js";
import Particles from "./Particles.js";
import type { Prefs } from "./SettingsView.js";

const STEPS = ["Hotkey", "Mode", "Model", "Ready"] as const;

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : u === 3 ? 2 : 1)} ${units[u]}`;
}

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
  const [modelError, setModelError] = useState<string | null>(null);
  const [pickedModelId, setPickedModelId] = useState<string | null>(
    () => prefs.activeModelId,
  );

  useEffect(() => {
    setHotkeyInput(prefs.hotkey);
  }, [prefs.hotkey]);

  useEffect(() => {
    setPickedModelId(prefs.activeModelId);
  }, [prefs.activeModelId]);

  // Fetch hardware + catalog when user reaches Model step in local mode
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
        const [hw, list] = await Promise.all([
          getHardwareInfo().catch(() => null),
          listAvailableModels(),
        ]);
        if (cancelled) return;
        if (hw) setHardware(hw);
        setModels(list);
        // Auto-pick recommended if nothing selected yet
        if (!pickedModelId && list.length > 0) {
          const ramGb = hw ? hw.totalRamBytes / 1_000_000_000 : 8;
          let rec = "parakeet-tdt-0.6b-v3";
          if (ramGb < 4) rec = "whisper-small";
          else if (ramGb >= 16) rec = "qwen3-asr-1.7b";
          else if (ramGb >= 12) rec = "whisper-large-v3-turbo";
          const exists = list.some((m) => m.id === rec) ? rec : list[0].id;
          setPickedModelId(exists);
        }
      } catch (e) {
        if (!cancelled)
          setModelError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, cloudOnly, pickedModelId]);

  const saveHotkey = async (raw: string): Promise<boolean> => {
    const next = raw.trim();
    if (!next) {
      setHotkeyError("Hotkey must not be empty.");
      return false;
    }
    if (next === prefs.hotkey) {
      setHotkeyError(null);
      return true;
    }
    try {
      await invoke("register_hotkey", { shortcut: next });
    } catch (e) {
      // Browser preview has no Tauri shell — keep the pref locally.
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        setHotkeyError(e instanceof Error ? e.message : String(e));
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
          {/* Logo */}
          <Logo className="h-8 w-auto text-white md:h-9" />

          <div className="h-8" />

          {/* Heading */}
          <h1 className="text-[32px] font-semibold leading-[1.1] tracking-tight text-white md:text-[44px]">
            Welcome to Algorith Voice
          </h1>

          <div className="h-3" />

          {/* Step indicator */}
          <p className="text-sm tracking-wide text-white/40">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>

          <div className="h-12" />

          {step === 0 ? (
            <>
              <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
                Hold this combination to talk. Release to type. It works in any
                app.
              </p>

              <div className="h-5" />

              <div className="w-full">
                <div className="flex h-16 w-full items-center justify-center rounded-lg border border-white/15 bg-transparent">
                  <input
                    value={hotkeyInput}
                    onChange={(e) => {
                      setHotkeyInput(e.target.value);
                      setHotkeyError(null);
                    }}
                    onBlur={(e) => {
                      void saveHotkey(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveHotkey(hotkeyInput);
                    }}
                    className="h-full w-full bg-transparent text-center text-[15px] font-medium tracking-wide text-white placeholder:text-white/30 focus:outline-none"
                    spellCheck={false}
                    aria-label="Hotkey"
                    placeholder="Ctrl + Space"
                  />
                </div>
                {hotkeyError ? (
                  <p className="mt-2 text-center text-xs text-red-400">
                    {hotkeyError}
                  </p>
                ) : (
                  <p className="mt-2 text-center text-xs text-white/25">
                    Press to record • Example: Ctrl + Space
                  </p>
                )}
              </div>

              <div className="h-7" />

              <Button
                onClick={() => {
                  void saveHotkey(hotkeyInput).then((ok) => {
                    if (ok) setStep(1);
                  });
                }}
                className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
              >
                Continue
              </Button>

              <div className="h-12" />

              <StepProgress current={0} total={4} />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
                Choose how your voice is transcribed. You can change this later
                in Settings.
              </p>

              <div className="h-8" />

              <div className="flex w-full flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setCloudOnly(true)}
                  className={`flex h-16 w-full items-center justify-center rounded-lg border text-[14px] font-medium transition-all ${
                    cloudOnly
                      ? "border-white bg-white text-black"
                      : "border-white/15 bg-transparent text-white hover:bg-white/[0.04]"
                  }`}
                >
                  Cloud (Groq Whisper) — Recommended
                </button>
                <button
                  type="button"
                  onClick={() => setCloudOnly(false)}
                  title="On-device transcription — audio never leaves this computer"
                  className={`flex h-16 w-full items-center justify-center rounded-lg border text-[14px] font-medium transition-all ${
                    !cloudOnly
                      ? "border-white bg-white text-black"
                      : "border-white/15 bg-transparent text-white hover:bg-white/[0.04]"
                  }`}
                >
                  Local (on-device) — audio never leaves this PC
                </button>
              </div>

              <p className="mt-4 max-w-[560px] text-sm leading-relaxed text-white/40">
                {cloudOnly
                  ? "Cloud uses Groq Whisper securely. Audio is sent only while you hold the hotkey and transcripts are stored only locally."
                  : "Local mode transcribes fully on-device. Pick and download a model in Settings to start dictating offline."}
              </p>

              <div className="h-7" />

              <Button
                onClick={() => {
                  const mode = cloudOnly ? "cloud" : "local";
                  onPrefs({ ...prefs, mode });
                  // Cloud skips model picker, local shows it
                  setStep(cloudOnly ? 3 : 2);
                }}
                className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
              >
                Continue
              </Button>

              <div className="h-12" />

              <StepProgress current={1} total={4} />
            </>
          ) : null}

          {step === 2 ? (
            <ModelPickerStep
              hardware={hardware}
              models={models}
              error={modelError}
              pickedId={pickedModelId}
              onPick={setPickedModelId}
              onContinue={() => {
                if (pickedModelId)
                  onPrefs({
                    ...prefs,
                    mode: "local",
                    activeModelId: pickedModelId,
                  });
                else onPrefs({ ...prefs, mode: "local" });
                setStep(3);
              }}
              onSkip={() => {
                onPrefs({ ...prefs, mode: "local", activeModelId: null });
                setStep(3);
              }}
            />
          ) : null}

          {step === 3 ? (
            <>
              <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
                Everything is set. Focus any text field, hold{" "}
                <span className="font-medium text-white">{prefs.hotkey}</span>,
                and speak.
              </p>

              <div className="h-10" />

              <Button
                onClick={onDone}
                className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
              >
                Start dictating
              </Button>

              <div className="h-12" />

              <StepProgress current={3} total={4} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModelPickerStep({
  hardware,
  models,
  error,
  pickedId,
  onPick,
  onContinue,
  onSkip,
}: {
  hardware: HardwareInfo | null;
  models: LocalModel[] | null;
  error: string | null;
  pickedId: string | null;
  onPick: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const recommendedId = useMemo(() => {
    if (!models || models.length === 0) return null;
    const ramGb = hardware ? hardware.totalRamBytes / 1_000_000_000 : 8;
    let rec = "parakeet-tdt-0.6b-v3";
    if (ramGb < 4) rec = "whisper-small";
    else if (ramGb >= 16) rec = "qwen3-asr-1.7b";
    else if (ramGb >= 12) rec = "whisper-large-v3-turbo";
    return models.some((m) => m.id === rec) ? rec : models[0].id;
  }, [hardware, models]);

  const hardwareLine = useMemo(() => {
    if (!hardware) return "Detecting system…";
    const ram = (hardware.totalRamBytes / 1_000_000_000).toFixed(1);
    const avail = (hardware.availableRamBytes / 1_000_000_000).toFixed(1);
    const gpu = hardware.gpu?.name ?? hardware.gpu?.vendor ?? "no GPU";
    const vram = hardware.gpu?.totalVramBytes
      ? ` • ${formatBytes(hardware.gpu.totalVramBytes)} VRAM`
      : "";
    return `${hardware.os} ${hardware.arch} • ${hardware.cpuModel ?? "CPU"} • ${ram} GB RAM (${avail} avail) • ${gpu}${vram}`;
  }, [hardware]);

  if (error) {
    return (
      <>
        <p className="max-w-[560px] text-sm text-amber-300">{error}</p>
        <div className="h-6" />
        <Button
          onClick={onSkip}
          className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
        >
          Skip for now
        </Button>
        <div className="h-12" />
        <StepProgress current={2} total={4} />
      </>
    );
  }

  if (!models) {
    return (
      <>
        <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50">
          Loading models…
        </p>
        <div className="h-12" />
        <StepProgress current={2} total={4} />
      </>
    );
  }

  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        Which model will you use? We recommend one based on your system.
      </p>
      <p className="mt-2 max-w-[560px] text-xs leading-relaxed text-white/30">
        {hardwareLine}
      </p>
      <div className="h-6" />
      <div className="max-h-[42vh] w-full space-y-2 overflow-auto rounded-lg border border-white/10 bg-white/[0.04] p-2 text-left">
        {models.map((m) => {
          const total = m.files.reduce((a, f) => a + f.sizeBytes, 0);
          const isPicked = pickedId === m.id;
          const isRec = m.id === recommendedId;
          const needRam = m.minRamGb;
          const ramGb = hardware ? hardware.totalRamBytes / 1_000_000_000 : 99;
          const blocked = needRam > 0 && ramGb < needRam;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(m.id)}
              className={`flex w-full flex-col rounded-md border px-3 py-2.5 text-left transition-colors ${
                isPicked
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-transparent text-white hover:bg-white/[0.06]"
              } ${blocked ? "opacity-60" : ""}`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13px] font-medium leading-tight">
                  {m.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {isRec ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${isPicked ? "bg-black text-white" : "bg-white text-black"}`}
                    >
                      Tavsiya
                    </span>
                  ) : null}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${isPicked ? "bg-black/10 text-black" : "bg-white/10 text-white/70"}`}
                  >
                    v{m.version}
                  </span>
                </span>
              </span>
              <span
                className={`mt-1 font-mono text-[11px] ${isPicked ? "text-black/60" : "text-white/40"}`}
              >
                {m.id} • {m.engine} • {formatBytes(total)} •{" "}
                {m.languages.length} langs • {m.license}
              </span>
              <span
                className={`mt-0.5 text-[11px] ${isPicked ? "text-black/50" : "text-white/30"}`}
              >
                RAM {m.minRamGb}→{m.recommendedRamGb} GB
                {m.minVramGb > 0
                  ? ` • VRAM ${m.minVramGb}→${m.recommendedVramGb} GB`
                  : ""}{" "}
                {blocked ? "• Not enough RAM" : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 max-w-[560px] text-xs text-white/25">
        You can change or download later in Settings → Local. Parakeet 25 langs
        is default for most PCs.
      </p>
      <div className="mt-6 flex w-full justify-center gap-3">
        <Button
          onClick={onContinue}
          disabled={!pickedId}
          className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
        >
          Continue
        </Button>
      </div>
      <button
        type="button"
        onClick={onSkip}
        className="mt-3 text-xs text-white/40 hover:text-white/70"
      >
        Skip — decide later in Settings
      </button>
      <div className="h-12" />
      <StepProgress current={2} total={4} />
    </>
  );
}

function StepProgress({
  current,
  total = 3,
}: {
  current: number;
  total?: number;
}) {
  const steps = total === 4 ? [0, 1, 2, 3] : [0, 1, 2];
  const last = steps.length - 1;
  return (
    <div className="flex items-center gap-0">
      {steps.map((i) => (
        <div key={i} className="flex items-center">
          <div
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              i === current
                ? "bg-white"
                : i < current
                  ? "bg-white/60"
                  : "bg-white/15"
            }`}
          />
          {i < last ? (
            <div
              className={`h-px w-[54px] transition-colors md:w-[72px] ${i < current ? "bg-white/30" : "bg-white/10"}`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
