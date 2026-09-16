import { Button, Logo } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import Particles from "./Particles.js";
import type { Prefs } from "./SettingsView.js";

const STEPS = ["Hotkey", "Model", "Ready"] as const;

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
  const [cloudOnly, setCloudOnly] = useState(true);
  const [hotkeyInput, setHotkeyInput] = useState(prefs.hotkey);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  useEffect(() => {
    setHotkeyInput(prefs.hotkey);
  }, [prefs.hotkey]);

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

              <StepProgress current={0} />
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
                  onPrefs({ ...prefs, mode: cloudOnly ? "cloud" : "local" });
                  setStep(2);
                }}
                className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
              >
                Continue
              </Button>

              <div className="h-12" />

              <StepProgress current={1} />
            </>
          ) : null}

          {step === 2 ? (
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

              <StepProgress current={2} />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StepProgress({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-0">
      {[0, 1, 2].map((i) => (
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
          {i < 2 ? (
            <div
              className={`h-px w-[72px] transition-colors md:w-[96px] ${
                i < current ? "bg-white/30" : "bg-white/10"
              }`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
