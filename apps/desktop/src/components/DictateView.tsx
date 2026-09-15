import { Button, RecordingOverlay, WaveformGlyph } from "@algorith-voice/ui";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { isTauri, setTrayState, type TrayState } from "../lib/session.js";

// Core interaction moment: PTT simulator wired to the real tray command.
// Phase 2 replaces the timers with cpal → VAD → STT → inject.
// The global hotkey registered in Rust emits `ptt-pressed` / `ptt-released`,
// which drive the same state machine as the simulator below.
export function DictateView({ hotkey }: { hotkey: string }) {
  const [tray, setTray] = useState<TrayState>("idle");
  const [preview, setPreview] = useState(
    "Hold the hotkey and speak — text lands here.",
  );
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenPressed: (() => void) | undefined;
    let unlistenReleased: (() => void) | undefined;
    void listen("ptt-pressed", () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setTray("recording");
      void setTrayState("recording");
      setPreview("Listening…");
    }).then((fn) => {
      unlistenPressed = fn;
    });
    void listen("ptt-released", () => {
      setTray("processing");
      void setTrayState("processing");
      setPreview("Transcribing…");
    }).then((fn) => {
      unlistenReleased = fn;
    });
    return () => {
      unlistenPressed?.();
      unlistenReleased?.();
    };
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

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
      <h1 className="av-display">Dictate</h1>
      <p className="av-body av-prose mt-2 text-gray-500">
        Hold{" "}
        <span className="av-mono text-black dark:text-white">{hotkey}</span> to
        talk. Release to inject text into the focused app.
      </p>

      <output className="mt-6 flex items-center gap-4" aria-live="polite">
        <WaveformGlyph className="text-black dark:text-white" />
        <span className="av-small text-gray-500">
          {tray === "idle"
            ? "Idle"
            : tray === "recording"
              ? "Recording"
              : "Processing"}
        </span>
      </output>

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
