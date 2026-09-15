import { Button, Input, Logo } from "@algorith-voice/ui";
import { useState } from "react";
import BlurText from "./BlurText.js";
import type { Prefs } from "./SettingsView.js";

const STEPS = ["Hotkey", "Model", "Ready"];

// First-run flow: account → hotkey → model → ready. Clear illustrated steps,
// monochrome, no decoration.
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
  const [cloudOnly, setCloudOnly] = useState(false);

  return (
    <div className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center p-8">
      <Logo className="h-6 w-auto text-black dark:text-white" />
      <h1 className="av-display mt-4">
        <BlurText text="Welcome to Algorith Voice" delay={120} />
      </h1>
      <p className="av-small mt-4 text-gray-500">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      {step === 0 ? (
        <div className="mt-6">
          <p className="av-body av-prose text-gray-500">
            Hold this combination to talk. Release to type. It works in any app.
          </p>
          <Input
            value={prefs.hotkey}
            onChange={(e) => onPrefs({ ...prefs, hotkey: e.target.value })}
            className="av-mono mt-4"
            spellCheck={false}
          />
          <div className="mt-4">
            <Button onClick={() => setStep(1)}>Continue</Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="mt-6">
          <div className="flex flex-col gap-2">
            <Button
              variant={cloudOnly ? "secondary" : "primary"}
              onClick={() => setCloudOnly(false)}
            >
              Download speech model (142 MB, offline)
            </Button>
            <Button
              variant={cloudOnly ? "primary" : "secondary"}
              onClick={() => setCloudOnly(true)}
            >
              Cloud only (no download)
            </Button>
          </div>
          <p className="av-small mt-3 text-gray-500">
            {cloudOnly
              ? "Audio is sent to the transcription service only while you hold the hotkey."
              : "Transcription runs fully offline. Audio never leaves this device."}
          </p>
          <div className="mt-4">
            <Button
              onClick={() => {
                onPrefs({ ...prefs, mode: cloudOnly ? "cloud" : "local" });
                setStep(2);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-6">
          <p className="av-body av-prose text-gray-500">
            Everything is set. Focus any text field, hold{" "}
            <span className="av-mono text-black dark:text-white">
              {prefs.hotkey}
            </span>
            , and speak.
          </p>
          <div className="mt-4">
            <Button onClick={onDone}>Start dictating</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
