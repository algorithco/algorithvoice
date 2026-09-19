import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveHistory } from "../lib/history.js";
import {
  blobToBase64,
  blobToWav16kMono,
  MIN_PRESS_MS,
  PTT_ERROR_EVENT,
  PTT_TRANSCRIPT_EVENT,
  pickSupportedMimeType,
  saveLastTranscript,
  transcribeAndPaste,
} from "../lib/ptt.js";
import { isTauri } from "../lib/session/env.js";
import { setTrayState } from "../lib/session/tray.js";
import { AudioLines } from "./animate-ui/icons/audio-lines.js";
import { Loader } from "./animate-ui/icons/loader.js";
import type { Prefs } from "./SettingsView.js";

type PillState = "idle" | "recording" | "processing";

/** Hard stop so a lost `pointerup` can never record unbounded. */
const MAX_RECORD_MS = 120_000;
/** Blobs smaller than this carry no speech — discard without billing. */
const MIN_BLOB_BYTES = 2048;
/** Blobs larger than this are rejected before decode to avoid OOM (DoS). */
const MAX_BLOB_BYTES = 15 * 1024 * 1024;
/** How long pill notices (error / clipboard-fallback) stay visible. */
const NOTICE_MS = 5000;

/**
 * Floating push-to-talk pill (rendered only in the `floating-pill` window).
 *
 * - Press-and-hold → recording, release → processing → auto-paste.
 * - Presses < 300 ms are discarded as accidental (Superwhisper-style).
 * - Pointer capture keeps the press alive when the cursor slips off the
 *   56 px button; release anywhere still sends.
 * - Global hotkey (`ptt-pressed` / `ptt-released` from Rust, already
 *   deduped against OS key-repeat) drives the same state machine.
 * - The padded frame is the drag region (`deep`); the round button opts
 *   out so press never starts a window move.
 */
export function FloatingPill({ prefs }: { prefs: Prefs }) {
  const [state, setState] = useState<PillState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stateRef = useRef<PillState>("idle");
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const pressTokenRef = useRef(0);
  const discardRef = useRef(false);
  const prefsRef = useRef(prefs);
  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pressStartRef = useRef(0);
  const maxTimerRef = useRef(0);
  const noticeTimerRef = useRef(0);
  const tickTimerRef = useRef(0);

  const setPill = useCallback((next: PillState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
    if (isTauri()) {
      void setTrayState(
        next === "recording"
          ? "recording"
          : next === "processing"
            ? "processing"
            : "idle",
      );
    }
  }, []);

  const showNotice = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setNotice(null);
    }, NOTICE_MS);
  }, []);

  const stopTracks = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Track already stopped.
        }
      }
    }
  }, []);

  const clearTimers = useCallback(() => {
    window.clearTimeout(maxTimerRef.current);
    window.clearInterval(tickTimerRef.current);
  }, []);

  const finishWithBlob = useCallback(
    async (blob: Blob, pressedMs: number, mimeType: string) => {
      clearTimers();
      if (discardRef.current) {
        discardRef.current = false;
        setPill("idle");
        return;
      }
      if (pressedMs < MIN_PRESS_MS) {
        discardRef.current = false;
        setPill("idle");
        showNotice("Hold a bit longer — tap was too short.");
        return;
      }
      if (blob.size < MIN_BLOB_BYTES) {
        discardRef.current = false;
        setPill("idle");
        showNotice("No speech detected — try again, speak while holding.");
        return;
      }
      if (blob.size > MAX_BLOB_BYTES) {
        discardRef.current = false;
        setPill("idle");
        showNotice("Recording too long — keep it under 2 minutes.");
        return;
      }
      if (!mountedRef.current) return;
      setPill("processing");
      try {
        // Local mode re-encodes through Web Audio (decode + 16 kHz mono
        // WAV) because MediaRecorder cannot emit WAV anywhere; the Rust
        // side validates it with the same parser the worker tests cover.
        // Cloud mode keeps sending the original blob untouched.
        const curPrefs = prefsRef.current;
        const useLocal = curPrefs.mode === "local";
        if (useLocal && !curPrefs.activeModelId) {
          showNotice("No local model — pick one in Settings → Local.");
          setPill("idle");
          return;
        }
        const base64 = useLocal
          ? await blobToWav16kMono(blob)
          : await blobToBase64(blob);
        if (!mountedRef.current) return;
        const result = await transcribeAndPaste(
          base64,
          useLocal ? "audio/wav" : mimeType,
          undefined,
          useLocal
            ? { mode: "local", modelId: curPrefs.activeModelId }
            : undefined,
        );
        if (!mountedRef.current) return;
        saveLastTranscript(result.text);
        void saveHistory(result.text);
        void emit(PTT_TRANSCRIPT_EVENT, {
          text: result.text,
          pasted: result.pasted,
        });
        if (!result.pasted) {
          // Auto-paste failed — leave
          // the text on the clipboard so one Ctrl+V finishes the job.
          try {
            await navigator.clipboard.writeText(result.text);
          } catch {
            // Clipboard API may be unavailable; transcript is saved.
          }
          showNotice("Copied — press Ctrl+V to paste.");
        }
        setPill("idle");
      } catch (e) {
        const raw =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : JSON.stringify(e);
        // Surface actionable guidance for known classes
        let message = raw;
        if (
          raw.includes("model_not_loaded") ||
          raw.includes("no local model")
        ) {
          message = "No local model — download one in Settings → Local.";
        } else if (
          raw.includes("web audio") ||
          raw.includes("offline resampling")
        ) {
          message = `${raw} — try Cloud mode in Settings.`;
        } else if (raw.includes("inference-empty-result")) {
          message = "No speech detected — speak clearly while holding.";
        } else if (raw.includes("engine") || raw.includes("out-of-memory")) {
          message = raw;
        } else if (!raw || raw === "Transcription failed.") {
          message = "Transcription failed — check microphone and try again.";
        }
        showNotice(message);
        if (isTauri()) void emit(PTT_ERROR_EVENT, message);
        setPill("idle");
      }
    },
    [clearTimers, setPill, showNotice],
  );

  const stopPress = useCallback(() => {
    // Invalidate a still-pending `getUserMedia` so it aborts cleanly.
    pressTokenRef.current++;
    startingRef.current = false;
    if (stateRef.current !== "recording") return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
        stopTracks();
        clearTimers();
        setPill("idle");
      }
      // `onstop` continues the pipeline (discard vs. transcribe).
      return;
    }
    stopTracks();
    clearTimers();
    setPill("idle");
  }, [clearTimers, setPill, stopTracks]);

  const startPress = useCallback(async () => {
    // Sync guard: `getUserMedia` awaits below, so re-entrancy from
    // touch-emulation, hotkey repeat or double binding must be rejected
    // here, before any async work starts.
    if (stateRef.current !== "idle" || startingRef.current) return;
    startingRef.current = true;
    const token = ++pressTokenRef.current;
    discardRef.current = false;
    pressStartRef.current = Date.now();
    chunksRef.current = [];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      startingRef.current = false;
      if (token !== pressTokenRef.current || !mountedRef.current) return;
      const name = e instanceof DOMException ? e.name : "";
      showNotice(
        name === "NotAllowedError"
          ? "Microphone blocked — allow access, then hold again."
          : name === "NotFoundError"
            ? "No microphone found — check OS sound settings."
            : name === "NotReadableError"
              ? "Microphone is busy — close the other app and retry."
              : "Microphone unavailable — check OS sound settings.",
      );
      setPill("idle");
      return;
    }
    // Aborted while permission prompt was open (release / Esc / unmount).
    if (token !== pressTokenRef.current || !mountedRef.current) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore.
        }
      }
      startingRef.current = false;
      return;
    }
    streamRef.current = stream;
    const mimeType = pickSupportedMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      startingRef.current = false;
      stopTracks();
      showNotice("Recording not supported in this webview.");
      setPill("idle");
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const pressedMs = Date.now() - pressStartRef.current;
      const mime = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: mime });
      chunksRef.current = [];
      recorderRef.current = null;
      stopTracks();
      void finishWithBlob(blob, pressedMs, mime);
    };
    recorder.onerror = () => {
      recorderRef.current = null;
      stopTracks();
      showNotice("Microphone error — hold again to retry.");
      setPill("idle");
    };
    recorder.start();
    startingRef.current = false;
    setPill("recording");
    setElapsedMs(0);
    tickTimerRef.current = window.setInterval(() => {
      if (mountedRef.current) setElapsedMs(Date.now() - pressStartRef.current);
    }, 500);
    // Hard stop: bounds memory / upload / cost even if `pointerup` is lost.
    maxTimerRef.current = window.setTimeout(() => {
      showNotice("Max length reached — sending.");
      stopPress();
    }, MAX_RECORD_MS);
  }, [finishWithBlob, setPill, showNotice, stopPress, stopTracks]);

  const cancelPress = useCallback(() => {
    if (stateRef.current !== "recording") return;
    discardRef.current = true;
    stopPress();
  }, [stopPress]);

  // Global hotkey mirrors the pointer state machine.
  useEffect(() => {
    if (!isTauri()) return;
    let unPressed: (() => void) | undefined;
    let unReleased: (() => void) | undefined;
    void listen("ptt-pressed", () => {
      void startPress();
    }).then((fn) => {
      unPressed = fn;
    });
    void listen("ptt-released", () => {
      stopPress();
    }).then((fn) => {
      unReleased = fn;
    });
    return () => {
      unPressed?.();
      unReleased?.();
    };
  }, [startPress, stopPress]);

  // Ensure pill window is transparent on Windows/WebView2
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
      document.body.style.overflow = "";
    };
  }, []);

  // Esc cancels a recording; unmount tears everything down safely.
  useEffect(() => {
    mountedRef.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancelPress();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mountedRef.current = false;
      window.removeEventListener("keydown", onKey);
      pressTokenRef.current++;
      try {
        recorderRef.current?.stop();
      } catch {
        // Already stopped.
      }
      recorderRef.current = null;
      stopTracks();
      clearTimers();
      window.clearTimeout(noticeTimerRef.current);
    };
  }, [cancelPress, clearTimers, stopTracks]);

  const label =
    state === "recording"
      ? `Recording ${formatElapsed(elapsedMs)} — release to transcribe`
      : state === "processing"
        ? "Transcribing…"
        : (notice ?? "Hold to talk — drag edges to move");

  return (
    <div
      data-tauri-drag-region="deep"
      className="grid h-screen w-screen cursor-grab place-items-center bg-transparent active:cursor-grabbing"
      style={{ background: "transparent" }}
    >
      <span aria-live="polite" className="sr-only">
        {state === "recording"
          ? "Recording."
          : state === "processing"
            ? "Transcribing."
            : (notice ?? "Idle.")}
      </span>
      <span className="relative grid place-items-center">
        <button
          type="button"
          aria-label={label}
          aria-pressed={state === "recording"}
          title={label}
          data-tauri-drag-region="false"
          onPointerDown={(e) => {
            if (!e.isPrimary) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;
            e.preventDefault();
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              // Capture unsupported — pointerup outside may be missed
              // (MAX_RECORD_MS still bounds the take).
            }
            if (notice) setNotice(null);
            void startPress();
          }}
          onPointerUp={stopPress}
          onPointerCancel={stopPress}
          onKeyDown={(e) => {
            // Keyboard hold-to-talk: Space/Enter starts, keyup sends.
            if (e.repeat) return;
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              void startPress();
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              stopPress();
            }
          }}
          onContextMenu={(e) => e.preventDefault()}
          className={[
            "grid size-14 cursor-pointer place-items-center rounded-full border shadow-lg transition-all duration-150 select-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black focus-visible:outline-none",
            state === "recording"
              ? "scale-110 border-red-300 bg-red-500 text-white motion-safe:animate-pulse"
              : state === "processing"
                ? "border-gray-300 bg-gray-400 text-white motion-safe:animate-pulse dark:border-gray-600"
                : notice
                  ? "border-amber-300 bg-black text-white dark:bg-white dark:text-black"
                  : "border-gray-200 bg-black text-white hover:scale-105 active:scale-95 dark:border-white/15 dark:bg-white dark:text-black",
          ].join(" ")}
        >
          {state === "processing" ? (
            <Loader size={22} animation="spin" animate />
          ) : (
            <AudioLines size={22} animate={state === "recording"} />
          )}
        </button>
        {state === "recording" ? (
          <span
            aria-hidden="true"
            className="absolute -bottom-1 rounded-full bg-black/80 px-1.5 py-px font-mono text-[10px] leading-4 text-white tabular-nums dark:bg-white/90 dark:text-black"
          >
            {formatElapsed(elapsedMs)}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
