import { Button, RecordingOverlay, WaveformGlyph } from "@algorith-voice/ui";
import { useRef, useState } from "react";
import { setTrayState, type TrayState } from "../lib/session.js";
import BlurText from "./BlurText.js";

// Core interaction moment: PTT simulator wired to the real tray command.
// Phase 2 replaces the timers with cpal → VAD → STT → inject.
export function DictateView({ hotkey }: { hotkey: string }) {
  const [tray, setTray] = useState<TrayState>("idle");
  const [preview, setPreview] = useState(
    "Hold the hotkey and speak — text lands here.",
  );
  const timers = useRef<number[]>([]);

  const simulate = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setTray("recording");
    void setTrayState("recording");
    setPreview("Listening…");
    timers.current.push(
      window.setTimeout(() => {
        setTray("processing");
        void setTrayState("processing");
        setPreview("Transcribing…");
      }, 900),
      window.setTimeout(() => {
        setTray("idle");
        void setTrayState("idle");
        setPreview("The quick brown fox jumps over the lazy dog.");
      }, 1800),
    );
  };

  return (
    <div className="p-8">
      <h1 className="av-display">
        <BlurText text="Dictate" />
      </h1>
      <p className="av-body av-prose mt-2 text-gray-500">
        Hold{" "}
        <span className="av-mono text-black dark:text-white">{hotkey}</span> to
        talk. Release to inject text into the focused app.
      </p>

      <div className="mt-6 flex items-center gap-4">
        <WaveformGlyph className="text-black dark:text-white" />
        <span className="av-small text-gray-500">
          {tray === "idle"
            ? "Idle"
            : tray === "recording"
              ? "Recording"
              : "Processing"}
        </span>
      </div>

      <div className="mt-6 border border-gray-200 p-4 dark:border-gray-800">
        <p className="av-small mb-2 text-gray-500">Preview</p>
        <p className="av-mono">{preview}</p>
      </div>

      {tray !== "idle" ? (
        <div className="mt-6">
          <RecordingOverlay
            state={tray === "recording" ? "listening" : "transcribing"}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <Button onClick={simulate}>Simulate push-to-talk</Button>
      </div>
    </div>
  );
}
