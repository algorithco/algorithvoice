import { Button, Input, WaveformGlyph } from "@algorith-voice/ui";
import { useState } from "react";
import { login, signup } from "../lib/session.js";
import type { Prefs } from "./SettingsView.js";

const STEPS = ["Account", "Hotkey", "Model", "Ready"];

// First-run flow: account → hotkey → model → ready. Clear illustrated steps,
// monochrome, no decoration.
export function OnboardingView({
  prefs,
  onPrefs,
  onDone,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cloudOnly, setCloudOnly] = useState(false);

  const createAccount = async () => {
    setError(null);
    try {
      await signup(email, password, "Desktop");
      setStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  };

  const skipLogin = async () => {
    try {
      await login(email, password);
      setStep(1);
    } catch {
      setStep(1);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-[640px] flex-col justify-center p-8">
      <WaveformGlyph className="text-black dark:text-white" />
      <h1 className="av-display mt-4">Welcome to Algorith Voice</h1>
      <p className="av-small mt-4 text-gray-500">
        Step {step + 1} of {STEPS.length}: {STEPS[step]}
      </p>

      {step === 0 ? (
        <div className="mt-6">
          <p className="av-body av-prose text-gray-500">
            Create an account to sync devices and use cloud transcription. Local
            dictation works without one.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            <Input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <Input
              type="password"
              placeholder="Password (12+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          {error ? (
            <p className="av-small mt-3 text-gray-500">{error}</p>
          ) : null}
          <div className="mt-4 flex gap-2">
            <Button
              onClick={createAccount}
              disabled={!email || password.length < 12}
            >
              Create account
            </Button>
            <Button variant="secondary" onClick={skipLogin}>
              Continue without account
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 ? (
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
            <Button onClick={() => setStep(2)}>Continue</Button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
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
                setStep(3);
              }}
            >
              Continue
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
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
