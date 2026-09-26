import type { SttMode } from "@algorith-voice/shared-types";
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
import { isTauri } from "../lib/session/env.js";
import { setTrayState, type TrayState } from "../lib/session/tray.js";

// Notices from the pill/hotkey pipeline are mode-agnostic events: an error
// raised under one mode can arrive after the user already switched to the
// other (mode saves are async; in-flight attempts finish late). Rendering
// the other mode's error reads as the app contradicting itself — e.g. a
// "Cloud mode needs a Groq key" banner while in Local mode — so such
// notices are dropped instead of shown. Patterns are deliberately tight:
// generic microphone/clipboard/paste errors pass through in both modes,
// and cloud's legit "Offline — switch to Local…" hint (which contains
// "offline" but no "groq"/"cloud") is never suppressed.
export function isNoticeRelevantToMode(
  message: string,
  isLocal: boolean,
): boolean {
  const lower = message.toLowerCase();
  if (isLocal) {
    return !lower.includes("groq") && !lower.includes("cloud");
  }
  return !lower.includes("no local model");
}

// Core interaction moment: PTT simulator wired to the real tray command.
// Phase 2 replaces the timers with cpal → VAD → STT → inject.
// The global hotkey registered in Rust emits `ptt-pressed` / `ptt-released`,
// which drive the same state machine as the simulator below.
export function DictateView({
  hotkey,
  mode,
  activeModelId,
}: {
  hotkey: string;
  mode: SttMode;
  activeModelId?: string | null;
}) {
  const [tray, setTray] = useState<TrayState>("idle");
  const [preview, setPreview] = useState(
    "Hold the hotkey and speak — text lands here.",
  );
  const [pillMsg, setPillMsg] = useState<string | null>(null);
  const [groqReady, setGroqReady] = useState<boolean | null>(null);
  const [groqInput, setGroqInput] = useState("");
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const isLocal = mode === "local";
  const needsModel = isLocal && !activeModelId;

  useEffect(() => {
    if (!pillMsg) return;
    const id = window.setTimeout(() => setPillMsg(null), 5000);
    return () => clearTimeout(id);
  }, [pillMsg]);

  useEffect(() => {
    // A mode switch invalidates the other mode's notices (see
    // isNoticeRelevantToMode); drop any that is still visible.
    setPillMsg(null);
    if (isLocal) setGroqReady(null);
    else setGroqInput("");
  }, [isLocal]);

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
    })
      .then((fn) => {
        unlistenPressed = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: ptt-pressed listen failed", e),
      );
    void listen("ptt-released", () => {
      setTray("processing");
      void setTrayState("processing");
      setPreview("Transcribing…");
    })
      .then((fn) => {
        unlistenReleased = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: ptt-released listen failed", e),
      );
    return () => {
      unlistenPressed?.();
      unlistenReleased?.();
    };
  }, []);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Mirror the floating pill: real transcripts land in Preview and the
  // last-transcript safety net; pill errors surface here (the compact
  // pill itself can only show a truncated label).
  useEffect(() => {
    setLastTranscript(loadLastTranscript());
    if (!isTauri()) return;
    let unError: (() => void) | undefined;
    let unTranscript: (() => void) | undefined;
    void listen<string>(PTT_ERROR_EVENT, (event) => {
      setPillMsg(String(event.payload ?? "Dictation failed."));
      setTray("idle");
      void setTrayState("idle");
      setPreview("Hold the hotkey and speak — text lands here.");
    })
      .then((fn) => {
        unError = fn;
      })
      .catch((e) => console.warn("algorith-voice: ptt-error listen failed", e));
    void listen<PttTranscriptPayload>(PTT_TRANSCRIPT_EVENT, (event) => {
      const payload = event.payload;
      if (!payload || !payload.text) return;
      setLastTranscript(payload.text);
      setTray("idle");
      void setTrayState("idle");
      // A fresh transcript supersedes any earlier error notice.
      setPillMsg(null);
      setPreview(
        payload.pasted
          ? payload.text
          : `${payload.text}\n(Auto-paste unavailable — copied to clipboard, press Ctrl+V.)`,
      );
    })
      .then((fn) => {
        unTranscript = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: ptt-transcript listen failed", e),
      );
    return () => {
      unError?.();
      unTranscript?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || isLocal) return;
    void hasGroqKey()
      .then(setGroqReady)
      .catch(() => setGroqReady(false));
  }, [isLocal]);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[900px] p-4 sm:p-6 lg:p-8 2xl:max-w-[1060px]">
      <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-white">
        Dictate
      </h1>
      <p className="mt-2 text-sm text-gray-500 lg:text-[15px]">
        Hold{" "}
        <span className="font-mono text-black dark:text-white">{hotkey}</span>{" "}
        to talk. Release to inject text into the focused app.
      </p>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-6 lg:p-8 dark:border-white/10 dark:bg-black">
        <div className="flex flex-col items-center text-center">
          <div
            className={`grid size-20 place-items-center rounded-full border transition-colors ${
              tray === "recording"
                ? "border-black bg-black dark:border-white dark:bg-white"
                : tray === "processing"
                  ? "border-gray-300 bg-gray-50 dark:border-white/15 dark:bg-white/5"
                  : "border-gray-200 bg-white dark:border-white/10 dark:bg-black"
            }`}
          >
            <WaveformGlyph
              className={
                tray === "recording"
                  ? "text-white dark:text-black"
                  : "text-black dark:text-white"
              }
            />
          </div>
          <p className="mt-4 text-sm font-medium text-black dark:text-white">
            {tray === "idle"
              ? "Ready to listen"
              : tray === "recording"
                ? "Listening…"
                : isLocal
                  ? "Transcribing locally…"
                  : "Transcribing…"}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {tray === "idle"
              ? `Hold ${hotkey}`
              : tray === "recording"
                ? "Release to process"
                : isLocal
                  ? "Offline — audio stays on device (~1s)"
                  : "Please wait"}
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Preview
          </p>
          <p className="mt-2 font-mono text-sm leading-relaxed text-black dark:text-white">
            {preview}
          </p>
        </div>

        {tray !== "idle" ? (
          <div className="mt-6">
            <RecordingOverlay
              state={tray === "recording" ? "listening" : "transcribing"}
            />
          </div>
        ) : null}
      </div>

      {lastTranscript ? (
        <div className="mt-6 border border-gray-200 p-4 dark:border-white/10">
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

      <div className="mt-6 border border-gray-200 p-4 dark:border-white/10">
        <p className="av-small mb-2 text-gray-500">
          Floating pill (frameless always-on-top, drag the pill or logo to move)
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
        {pillMsg && isNoticeRelevantToMode(pillMsg, isLocal) ? (
          <p
            role="alert"
            className={`av-small mt-2 rounded-md px-2 py-1.5 text-xs ${
              /model-|groq|microphone|failed|inference|audio-|out-of-memory|engine/i.test(
                pillMsg,
              )
                ? "bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800"
                : "text-gray-500"
            }`}
          >
            {pillMsg}
          </p>
        ) : null}
        {needsModel ? (
          <p
            role="alert"
            className="av-small mt-3 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            No local model selected — download one in Settings → Local, then
            click “Use this model”.
          </p>
        ) : isLocal ? (
          <p className="av-small mt-3 text-gray-500">
            Local (offline) mode — no API key needed. Audio never leaves this
            device.
          </p>
        ) : (
          <>
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
                className="av-mono min-w-0 flex-1 border border-gray-200 bg-transparent px-2 py-1 text-sm dark:border-white/10"
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
          </>
        )}
      </div>
    </div>
  );
}
