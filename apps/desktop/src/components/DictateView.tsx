import { Button, RecordingOverlay, WaveformGlyph } from "@algorith-voice/ui";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import {
  ensureFloatingPill,
  hasGroqKey,
  loadLastTranscript,
  PTT_ERROR_EVENT,
  PTT_TRANSCRIPT_EVENT,
  type PttTranscriptPayload,
  pasteText,
  setFloatingPillVisible,
  setGroqApiKey,
} from "../lib/ptt.js";
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
  const [pillMsg, setPillMsg] = useState<string | null>(null);
  const [groqReady, setGroqReady] = useState<boolean | null>(null);
  const [groqInput, setGroqInput] = useState("");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
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

  // Mirror the floating pill: real transcripts land in Preview and the
  // last-transcript safety net; pill errors surface here (the 72 px pill
  // itself can only show a badge).
  useEffect(() => {
    setLastTranscript(loadLastTranscript());
    if (!isTauri()) return;
    let unError: (() => void) | undefined;
    let unTranscript: (() => void) | undefined;
    void listen<string>(PTT_ERROR_EVENT, (event) => {
      setPillMsg(String(event.payload ?? "Dictation failed."));
    }).then((fn) => {
      unError = fn;
    });
    void listen<PttTranscriptPayload>(PTT_TRANSCRIPT_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || !payload.text) return;
      setLastTranscript(payload.text);
      setTray("idle");
      void setTrayState("idle");
      setPreview(
        payload.pasted
          ? payload.text
          : `${payload.text}\n(Auto-paste unavailable — copied to clipboard, press Ctrl+V.)`,
      );
    }).then((fn) => {
      unTranscript = fn;
    });
    return () => {
      unError?.();
      unTranscript?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    void hasGroqKey()
      .then(setGroqReady)
      .catch(() => setGroqReady(false));
  }, []);

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

      {lastTranscript ? (
        <div className="mt-6 border border-gray-200 p-4 dark:border-gray-800">
          <p className="av-small mb-2 text-gray-500">Last transcript</p>
          <p className="av-mono">{lastTranscript}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                void pasteText(lastTranscript).catch((e: unknown) =>
                  setPillMsg(
                    e instanceof Error ? e.message : "Could not paste.",
                  ),
                );
              }}
            >
              Paste again
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(lastTranscript)
                  .then(() => setPillMsg("Copied to clipboard."))
                  .catch(() => setPillMsg("Could not access the clipboard."));
              }}
            >
              Copy
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-6 border border-gray-200 p-4 dark:border-gray-800">
        <p className="av-small mb-2 text-gray-500">
          Floating pill (frameless always-on-top, drag edges to move)
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setPillMsg(null);
              void ensureFloatingPill()
                .then(() => setPillMsg("Floating pill shown."))
                .catch((e: unknown) =>
                  setPillMsg(
                    e instanceof Error ? e.message : "Could not show pill.",
                  ),
                );
            }}
          >
            Show pill
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPillMsg(null);
              void setFloatingPillVisible(false)
                .then(() => setPillMsg("Floating pill hidden."))
                .catch((e: unknown) =>
                  setPillMsg(
                    e instanceof Error ? e.message : "Could not hide pill.",
                  ),
                );
            }}
          >
            Hide pill
          </Button>
        </div>
        {pillMsg ? (
          <p className="av-small mt-2 text-gray-500">{pillMsg}</p>
        ) : null}
        <p className="av-small mt-3 text-gray-500">
          Groq key:{" "}
          {groqReady === null
            ? "checking…"
            : groqReady
              ? "saved in OS keyring"
              : "missing — paste below to enable real transcription"}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            type="password"
            value={groqInput}
            onChange={(e) => setGroqInput(e.target.value)}
            placeholder="gsk_…"
            autoComplete="off"
            spellCheck={false}
            className="av-mono min-w-0 flex-1 border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-gray-800"
          />
          <Button
            variant="secondary"
            disabled={!groqInput.trim()}
            onClick={() => {
              void setGroqApiKey(groqInput.trim())
                .then(() => {
                  setGroqReady(true);
                  setGroqInput("");
                  setPillMsg("Groq key saved to OS keyring.");
                })
                .catch((e: unknown) =>
                  setPillMsg(
                    e instanceof Error ? e.message : "Could not save key.",
                  ),
                );
            }}
          >
            Save key
          </Button>
        </div>
      </div>
    </div>
  );
}
