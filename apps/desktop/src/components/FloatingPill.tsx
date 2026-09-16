import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveHistory } from "../lib/history.js";
import {
  blobToBase64,
  MIN_PRESS_MS,
  PTT_ERROR_EVENT,
  PTT_TRANSCRIPT_EVENT,
  pickSupportedMimeType,
  saveLastTranscript,
  transcribeAndPaste,
} from "../lib/ptt.js";
import { isTauri, setTrayState } from "../lib/session.js";

type PillState = "idle" | "recording" | "processing";

/** Hard stop so a lost `pointerup` can never record unbounded. */
const MAX_RECORD_MS = 120_000;
/** Blobs smaller than this carry no speech — discard without billing. */
const MIN_BLOB_BYTES = 2048;
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
export function FloatingPill() {
  const [state, setState] = useState<PillState>("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const stateRef = useRef<PillState>("idle");
  const mountedRef = useRef(true);
  const startingRef = useRef(false);
  const pressTokenRef = useRef(0);
  const discardRef = useRef(false);
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
      if (
        discardRef.current ||
        pressedMs < MIN_PRESS_MS ||
        blob.size < MIN_BLOB_BYTES
      ) {
        // Accidental tap / Esc-cancel / empty take — discard silently.
        discardRef.current = false;
        setPill("idle");
        return;
      }
      if (!mountedRef.current) return;
      setPill("processing");
      try {
        const base64 = await blobToBase64(blob);
        if (!mountedRef.current) return;
        const result = await transcribeAndPaste(base64, mimeType);
        if (!mountedRef.current) return;
        saveLastTranscript(result.text);
        void saveHistory(result.text);
        void emit(PTT_TRANSCRIPT_EVENT, {
          text: result.text,
          pasted: result.pasted,
        });
        if (!result.pasted) {
          // Auto-paste unavailable (Wayland / macOS permission) — leave
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
        const message =
          e instanceof Error ? e.message : "Transcription failed.";
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
                  : "border-gray-200 bg-black text-white hover:scale-105 active:scale-95 dark:border-gray-700 dark:bg-white dark:text-black",
          ].join(" ")}
        >
          {state === "processing" ? <SpinnerIcon /> : <MicIcon />}
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

function MicIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M10 3a3 3 0 0 0-3 3v4a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3m-1 9a1 1 0 0 1 2 0 4.002 4.002 0 0 1-3.874 4H7a.5.5 0 0 0 0 1h6a.5.5 0 0 0 0-1h-.126A4.002 4.002 0 0 1 9 12m-1-6a1 1 0 0 1 2 0v4a1 1 0 0 1-2 0z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="motion-safe:animate-spin"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M17 10a7 7 0 0 0-7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
