import { Logo } from "@algorith-voice/ui";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Square, X } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { saveHistory } from "../lib/history.js";
import { loadPrefs } from "../lib/prefs.js";
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
import {
  createRecordingCuePlayer,
  type RecordingCuePlayer,
} from "../lib/recordingSounds.js";
import { isTauri } from "../lib/session/env.js";
import { setTrayState } from "../lib/session/tray.js";
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

/** Must match Rust: PILL_WIDTH_IDLE / PILL_WIDTH_RECORDING / PILL_HEIGHT. */
const PILL_WIDTH_IDLE = 160;
const PILL_WIDTH_RECORDING = 224;
const PILL_HEIGHT = 40;
const WAVE_BARS = 20;
/**
 * Normalized RMS above near-silence for 8-bit Web Audio samples.
 *
 * Laptop microphones with OS processing disabled can produce surprisingly
 * quiet speech, so this deliberately sits just above a one-quantum signal
 * (1 / 128). Duration filtering below rejects isolated clicks.
 */
export const SPEECH_RMS_THRESHOLD = 0.008;
/** Reject a click, while retaining a single quiet word or a short phrase. */
export const MIN_SPEECH_ACTIVITY_MS = 90;
const MAX_SPEECH_FRAME_MS = 50;

/** Normalized root-mean-square energy for unsigned Web Audio time samples. */
export function audioFrameRms(data: Uint8Array): number {
  if (data.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of data) {
    const normalized = ((sample as number) - 128) / 128;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / data.length);
}

/** Accumulate sustained speech while gently forgetting isolated noise. */
export function updateSpeechActivityMs(
  currentMs: number,
  rms: number,
  elapsedMs: number,
): number {
  const delta = Math.max(0, Math.min(MAX_SPEECH_FRAME_MS, elapsedMs));
  if (rms >= SPEECH_RMS_THRESHOLD) return currentMs + delta;
  // Bridge the natural quiet gaps between syllables instead of erasing most
  // of a short phrase before the next voiced sound arrives.
  return Math.max(0, currentMs - delta * 0.1);
}

/** Convert time-domain microphone samples into visibly responsive bar heights. */
export function waveformBarHeights(
  data: Uint8Array,
  height: number,
  barCount = WAVE_BARS,
): number[] {
  const count = Math.max(1, Math.floor(barCount));
  const usableHeight = Math.max(4, height);
  const step = Math.max(1, Math.floor(data.length / count));

  return Array.from({ length: count }, (_, index) => {
    let peak = 0;
    const start = index * step;
    for (let offset = 0; offset < step; offset += 1) {
      const amplitude =
        Math.abs(((data[start + offset] ?? 128) as number) - 128) / 128;
      if (amplitude > peak) peak = amplitude;
    }

    // Remove a tiny mic noise floor, then apply a curved gain so normal speech
    // remains easy to see without clipping louder input immediately.
    const audible = Math.max(0, peak - 0.012);
    const response = Math.min(1, Math.sqrt(audible * 4.5));
    return 4 + response * (usableHeight - 4);
  });
}

/** Ease bar movement over time, with a quick attack and gentler release. */
export function smoothWaveformBarHeights(
  previous: number[],
  target: number[],
): number[] {
  return target.map((next, index) => {
    const current = previous[index] ?? 4;
    const easing = next >= current ? 0.38 : 0.18;
    return current + (next - current) * easing;
  });
}

/**
 * Floating push-to-talk pill (rendered only in the `floating-pill` window).
 *
 * Two visual states:
 * - idle (160x40): [drag handle | hold-to-talk target]. Keeping these
 *   separate prevents a move gesture from accidentally starting a take.
 * - recording (224x40): [logo | live waveform | X cancel | stop & send].
 *   Only the logo handle stays draggable; waveform + buttons opt out.
 *
 * Dragging calls Tauri's `startDragging()` directly from the logo handle.
 * The outer window container is never draggable, so transparent corners
 * cannot capture a move gesture and interactive controls remain reliable.
 *
 * - Press-and-hold → recording, release → processing → auto-paste.
 * - Presses < 300 ms are discarded as accidental (Superwhisper-style).
 * - Pointer capture keeps the press alive when the cursor slips off the
 *   pill; release anywhere still sends.
 * - Global hotkey (`ptt-pressed` / `ptt-released` from Rust, already
 *   deduped against OS key-repeat) drives the same state machine.
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
  const recordingCuesRef = useRef<RecordingCuePlayer | null>(null);

  // Preload bundled cues once so global-hotkey playback starts immediately.
  useEffect(() => {
    const cues = createRecordingCuePlayer();
    recordingCuesRef.current = cues;
    cues.preload();
    return () => {
      cues.dispose();
      if (recordingCuesRef.current === cues) recordingCuesRef.current = null;
    };
  }, []);

  const startWindowDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (!isTauri()) return;
      void getCurrentWindow()
        .startDragging()
        .catch((error) =>
          console.warn("algorith-voice: pill drag failed", error),
        );
    },
    [],
  );

  // Live waveform taps the SAME MediaStream used for recording.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const waveRafRef = useRef(0);
  const waveHeightsRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const speechActivityMsRef = useRef(0);
  const speechFrameAtRef = useRef(0);
  const speechDetectionAvailableRef = useRef(false);

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

  // Every notice is mirrored to the Dictate view via PTT_ERROR_EVENT.
  // The pill is compact and can only show a truncated label/tooltip,
  // so without the mirror, outcomes like "tap too short" vanish without
  // a trace on the screen the user is watching.
  const showNotice = useCallback((message: string) => {
    if (!mountedRef.current) return;
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => {
      if (mountedRef.current) setNotice(null);
    }, NOTICE_MS);
    if (isTauri()) void emit(PTT_ERROR_EVENT, message);
  }, []);

  const teardownWaveform = useCallback(() => {
    if (waveRafRef.current) {
      try {
        cancelAnimationFrame(waveRafRef.current);
      } catch {
        // Ignore.
      }
      waveRafRef.current = 0;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    try {
      analyserRef.current?.disconnect();
    } catch {
      // Already disconnected.
    }
    sourceRef.current = null;
    analyserRef.current = null;
    waveHeightsRef.current = [];
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) {
      try {
        void ctx.close().catch(() => {});
      } catch {
        // Already closed.
      }
    }
  }, []);

  const attachWaveform = useCallback(
    (stream: MediaStream) => {
      teardownWaveform();
      try {
        const AudioContextClass =
          window.AudioContext ??
          (
            window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.55;
        src.connect(analyser);
        audioCtxRef.current = ctx;
        sourceRef.current = src;
        analyserRef.current = analyser;
        speechDetectionAvailableRef.current = true;
        speechFrameAtRef.current = performance.now();
        if (ctx.state === "suspended") {
          void ctx.resume().catch(() => {});
        }
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          if (!mountedRef.current || analyserRef.current !== analyser) return;
          // React may not have mounted the recording canvas by the first frame.
          // Keep the analyser alive until the state/render catches up instead of
          // silently terminating the waveform loop forever.
          if (stateRef.current !== "recording") {
            waveRafRef.current = requestAnimationFrame(tick);
            return;
          }
          try {
            analyser.getByteTimeDomainData(data);
          } catch {
            waveRafRef.current = requestAnimationFrame(tick);
            return;
          }
          const frameAt = performance.now();
          speechActivityMsRef.current = updateSpeechActivityMs(
            speechActivityMsRef.current,
            audioFrameRms(data),
            frameAt - speechFrameAtRef.current,
          );
          speechFrameAtRef.current = frameAt;
          const canvas = canvasRef.current;
          if (canvas) {
            const dpr = window.devicePixelRatio || 1;
            const cssW = canvas.clientWidth || 120;
            const cssH = canvas.clientHeight || 24;
            const wantW = Math.max(1, Math.round(cssW * dpr));
            const wantH = Math.max(1, Math.round(cssH * dpr));
            if (canvas.width !== wantW || canvas.height !== wantH) {
              canvas.width = wantW;
              canvas.height = wantH;
            }
            const g = canvas.getContext("2d");
            if (g) {
              g.clearRect(0, 0, canvas.width, canvas.height);
              g.save();
              g.scale(dpr, dpr);
              let color = "#ffffff";
              try {
                const computed = getComputedStyle(canvas).color;
                if (computed) color = computed;
              } catch {
                // Fall back to white.
              }
              g.fillStyle = color;
              const gap = 2;
              const barW = Math.max(
                2,
                (cssW - gap * (WAVE_BARS - 1)) / WAVE_BARS,
              );
              const targets = waveformBarHeights(data, cssH);
              const heights = smoothWaveformBarHeights(
                waveHeightsRef.current,
                targets,
              );
              waveHeightsRef.current = heights;
              for (let i = 0; i < WAVE_BARS; i += 1) {
                const h = heights[i] ?? 4;
                const x = i * (barW + gap);
                const y = (cssH - h) / 2;
                const r = Math.min(1.5, barW / 2);
                g.beginPath();
                const anyG = g as CanvasRenderingContext2D & {
                  roundRect?: (
                    x: number,
                    y: number,
                    w: number,
                    h: number,
                    r: number,
                  ) => void;
                };
                if (typeof anyG.roundRect === "function") {
                  anyG.roundRect(x, y, barW, h, r);
                } else {
                  g.rect(x, y, barW, h);
                }
                g.fill();
              }
              g.restore();
            }
          }
          waveRafRef.current = requestAnimationFrame(tick);
        };
        waveRafRef.current = requestAnimationFrame(tick);
      } catch {
        // Waveform is decorative — recording must survive its failure.
      }
    },
    [teardownWaveform],
  );

  const stopTracks = useCallback(() => {
    teardownWaveform();
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
  }, [teardownWaveform]);

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
      if (
        speechDetectionAvailableRef.current &&
        speechActivityMsRef.current < MIN_SPEECH_ACTIVITY_MS
      ) {
        discardRef.current = false;
        setPill("idle");
        showNotice("No speech detected — nothing was sent.");
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
        try {
          const fresh = await loadPrefs({ allowMigration: false });
          if (
            !(
              prefsRef.current.mode === "local" &&
              fresh.mode === "cloud" &&
              prefsRef.current.activeModelId
            )
          ) {
            prefsRef.current = fresh;
          }
        } catch {
          // Keep last known prefs if store unreadable
        }
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
        if (
          !useLocal &&
          typeof navigator !== "undefined" &&
          navigator.onLine === false
        ) {
          showNotice(
            "Offline — switch to Local (offline) in Settings to transcribe without internet.",
          );
          setPill("idle");
          return;
        }
        const base64 = useLocal
          ? await blobToWav16kMono(blob)
          : await blobToBase64(blob);
        if (!mountedRef.current) return;
        const language =
          curPrefs.language === "auto" ? undefined : curPrefs.language;
        const result = await transcribeAndPaste(
          base64,
          useLocal ? "audio/wav" : mimeType,
          language,
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
        // Tauri serializes Rust `AppError` as `{code, message}`, which
        // `invoke` rejects with as a plain object — extract the message so
        // users never see raw JSON like `{"code":"transcribe",...}`.
        let raw: string;
        if (e instanceof Error) {
          raw = e.message;
        } else if (typeof e === "string") {
          raw = e;
        } else if (
          e !== null &&
          typeof e === "object" &&
          typeof (e as { message?: unknown }).message === "string"
        ) {
          raw = (e as { message: string }).message;
        } else {
          raw = JSON.stringify(e);
        }
        let message = raw;
        const lower = raw.toLowerCase();
        if (
          raw.includes("model-not-loaded") ||
          raw.includes("model_not_loaded") ||
          raw.includes("no local model") ||
          lower.includes("model_not_loaded") ||
          lower.includes("model-not-loaded")
        ) {
          message = "No local model — download one in Settings → Local.";
        } else if (
          lower.includes("groq api key") ||
          lower.includes("groq") ||
          raw.includes("Groq API key")
        ) {
          message =
            "Cloud mode needs a Groq key — paste one in Dictate, or switch to Local (offline) in Settings.";
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
        setPill("idle");
      }
    },
    [clearTimers, setPill, showNotice],
  );

  const stopPress = useCallback(() => {
    // Invalidate a still-pending `getUserMedia` so it aborts cleanly.
    pressTokenRef.current++;
    startingRef.current = false;
    if (stateRef.current !== "recording") {
      // A tap or an early release is not a recording lifecycle event. Stop a
      // pending start cue silently and never answer it with the stop cue.
      recordingCuesRef.current?.cancel();
      stopTracks();
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        recorderRef.current = null;
        stopTracks();
        clearTimers();
        recordingCuesRef.current?.playStop();
        setPill("idle");
      }
      // `onstop` continues the pipeline (discard vs. transcribe).
      return;
    }
    stopTracks();
    clearTimers();
    recordingCuesRef.current?.playStop();
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
    chunksRef.current = [];
    speechActivityMsRef.current = 0;
    speechFrameAtRef.current = 0;
    speechDetectionAvailableRef.current = false;
    const holdStartedAt = performance.now();

    // Prepare preferences and the microphone silently. A quick click should
    // neither record nor make a cue; only a deliberate hold enters the audible
    // recording lifecycle.
    try {
      const fresh = await loadPrefs({ allowMigration: false });
      if (
        !(
          prefsRef.current.mode === "local" &&
          fresh.mode === "cloud" &&
          prefsRef.current.activeModelId
        )
      ) {
        prefsRef.current = fresh;
      }
    } catch {
      // Store unreadable — fall back to last known prefs.
    }
    if (token !== pressTokenRef.current || !mountedRef.current) {
      startingRef.current = false;
      return;
    }
    let stream: MediaStream;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 1 },
            sampleRate: { ideal: 16000 },
            sampleSize: { ideal: 16 },
          } as MediaTrackConstraints,
        });
        // Speech-oriented processing raises quiet voices and reduces steady
        // room noise for both local and cloud transcription.
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        if (name === "OverconstrainedError" || name === "NotSupportedError") {
          console.warn(
            "algorith-voice: ideal audio constraints failed, retrying defaults",
            e,
          );
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: { ideal: true },
              noiseSuppression: { ideal: true },
              autoGainControl: { ideal: true },
            },
          });
        } else {
          throw e;
        }
      }
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
    streamRef.current = stream;
    const remainingHoldMs = Math.max(
      0,
      MIN_PRESS_MS - (performance.now() - holdStartedAt),
    );
    if (remainingHoldMs > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, remainingHoldMs);
      });
    }
    // Aborted before the deliberate-hold threshold was reached.
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
    // The start cue now means exactly one thing: a valid hold is transitioning
    // into recording. Wait for it so speaker audio is never transcribed.
    await recordingCuesRef.current?.playStart();
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
      // The microphone is fully closed before speaker audio begins, so the
      // stop cue can never be included in the captured transcription.
      recordingCuesRef.current?.playStop();
      void finishWithBlob(blob, pressedMs, mime);
    };
    recorder.onerror = () => {
      recorderRef.current = null;
      chunksRef.current = [];
      stopTracks();
      showNotice("Microphone error — hold again to retry.");
      setPill("idle");
    };
    // Measure duration from actual capture start, excluding cue playback,
    // preference loading, and any microphone permission UI.
    pressStartRef.current = Date.now();
    recorder.start();
    startingRef.current = false;
    setPill("recording");
    // Tap the SAME stream for the live waveform — no second mic request.
    attachWaveform(stream);
    setElapsedMs(0);
    tickTimerRef.current = window.setInterval(() => {
      if (mountedRef.current) setElapsedMs(Date.now() - pressStartRef.current);
    }, 500);
    // Hard stop: bounds memory / upload / cost even if `pointerup` is lost.
    maxTimerRef.current = window.setTimeout(() => {
      showNotice("Max length reached — sending.");
      stopPress();
    }, MAX_RECORD_MS);
  }, [
    attachWaveform,
    finishWithBlob,
    setPill,
    showNotice,
    stopPress,
    stopTracks,
  ]);

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
    })
      .then((fn) => {
        unPressed = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: pill ptt-pressed listen failed", e),
      );
    void listen("ptt-released", () => {
      stopPress();
    })
      .then((fn) => {
        unReleased = fn;
      })
      .catch((e) =>
        console.warn("algorith-voice: pill ptt-released listen failed", e),
      );
    return () => {
      unPressed?.();
      unReleased?.();
    };
  }, [startPress, stopPress]);

  // Resize the native window to match the active layout (idle 160px vs
  // recording 224px). Rust preserves the current right edge, so a pill the
  // user moved stays where they put it while it grows leftward.
  // No-op in browser preview.
  useEffect(() => {
    if (!isTauri()) return;
    const expanded = state === "recording";
    void invoke("set_floating_pill_expanded", { expanded }).catch(() => {
      // Window may not exist yet in tests / preview — ignore.
    });
  }, [state]);

  // Ensure pill window is transparent on Windows/WebView2
  useEffect(() => {
    const prevHtml = document.documentElement.style.background;
    const prevBody = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    document.body.style.overflow = "hidden";
    document.body.style.margin = "0";
    document.body.style.padding = "0";
    return () => {
      document.documentElement.style.background = prevHtml;
      document.body.style.background = prevBody;
      document.body.style.overflow = "";
      document.body.style.margin = "";
      document.body.style.padding = "";
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

  const pillWidth =
    state === "recording" ? PILL_WIDTH_RECORDING : PILL_WIDTH_IDLE;
  const idleLabel = notice ?? "Algorith Voice";
  const idleTitle = notice ?? "Hold to talk — drag to move";
  const recTitle = `Recording ${formatElapsed(elapsedMs)} — release to transcribe`;
  const label =
    state === "recording"
      ? recTitle
      : state === "processing"
        ? "Transcribing…"
        : idleTitle;

  return (
    <div
      data-tauri-drag-region="false"
      className="grid h-screen w-screen place-items-center overflow-hidden bg-transparent"
      style={{ background: "transparent", margin: 0, padding: 0 }}
    >
      <span aria-live="polite" className="sr-only">
        {state === "recording"
          ? "Recording."
          : state === "processing"
            ? "Transcribing."
            : (notice ?? "Idle.")}
      </span>
      <div
        data-testid="floating-pill"
        data-state={state}
        style={{ width: pillWidth, height: PILL_HEIGHT }}
        className={[
          "flex items-center overflow-hidden rounded-full border shadow-lg transition-[width,background-color,border-color] duration-200 ease-out select-none",
          state === "recording"
            ? "border-red-300 bg-red-500 text-white"
            : state === "processing"
              ? "border-gray-300 bg-gray-400 text-white dark:border-gray-600"
              : notice
                ? "border-amber-300 bg-black text-white dark:bg-white dark:text-black"
                : "border-gray-200 bg-black text-white dark:border-white/15 dark:bg-white dark:text-black",
        ].join(" ")}
      >
        {state === "recording" ? (
          <div
            data-tauri-drag-region="false"
            className="flex h-full w-full items-center gap-1.5 px-2"
          >
            <div
              data-testid="pill-logo-drag"
              title="Drag to move"
              aria-hidden="true"
              onPointerDown={startWindowDrag}
              className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <Logo className="h-4 w-auto" />
            </div>
            <canvas
              ref={canvasRef}
              data-tauri-drag-region="false"
              data-testid="pill-waveform"
              className="h-7 min-w-0 flex-1 text-white"
              style={{ width: 72, height: 28 }}
            />
            <span
              aria-hidden="true"
              data-tauri-drag-region="false"
              className="shrink-0 font-mono text-[10px] leading-4 tabular-nums opacity-90"
            >
              {formatElapsed(elapsedMs)}
            </span>
            <button
              type="button"
              aria-label="Cancel recording"
              title="Cancel (Esc)"
              data-tauri-drag-region="false"
              data-testid="pill-cancel"
              onClick={(e) => {
                e.stopPropagation();
                cancelPress();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-white/90 transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none active:bg-white/30"
            >
              <X size={14} />
            </button>
            <button
              type="button"
              aria-label="Stop and send"
              title="Stop and send"
              data-tauri-drag-region="false"
              data-testid="pill-stop"
              onClick={(e) => {
                e.stopPropagation();
                stopPress();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-white text-red-600 transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-red-500 focus-visible:outline-none active:scale-95"
            >
              <Square size={12} fill="currentColor" />
            </button>
          </div>
        ) : state === "processing" ? (
          <output
            data-tauri-drag-region="false"
            className="flex h-full w-full items-center gap-2 px-3"
            aria-label="Transcribing…"
          >
            <div
              data-testid="pill-logo-drag"
              title="Drag to move"
              aria-hidden="true"
              onPointerDown={startWindowDrag}
              className="flex h-8 w-8 shrink-0 cursor-grab items-center justify-center active:cursor-grabbing"
            >
              <Logo className="h-4 w-auto" />
            </div>
            <Loader size={16} animation="spin" animate />
            <span className="truncate text-xs font-medium">Transcribing…</span>
          </output>
        ) : (
          <div
            data-testid="pill-idle"
            className="flex h-full w-full items-center px-1.5"
          >
            <button
              type="button"
              aria-label="Move floating pill"
              title="Drag to move"
              data-testid="pill-drag-handle"
              onPointerDown={startWindowDrag}
              onContextMenu={(event) => event.preventDefault()}
              className="grid h-8 w-8 shrink-0 cursor-grab place-items-center rounded-full transition-colors hover:bg-white/15 active:cursor-grabbing dark:hover:bg-black/10"
            >
              <Logo className="h-4 w-auto" />
            </button>
            <button
              type="button"
              aria-label={idleTitle}
              aria-pressed={false}
              title={idleTitle}
              data-testid="pill-talk"
              onPointerDown={(event) => {
                if (!event.isPrimary) return;
                if (event.pointerType === "mouse" && event.button !== 0) return;
                event.preventDefault();
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Capture unsupported — pointerup outside may be missed
                  // (MAX_RECORD_MS still bounds the take).
                }
                if (notice) setNotice(null);
                void startPress();
              }}
              onPointerUp={stopPress}
              onPointerCancel={stopPress}
              onKeyDown={(event) => {
                // Keyboard hold-to-talk: Space/Enter starts, keyup sends.
                if (event.repeat) return;
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  void startPress();
                }
              }}
              onKeyUp={(event) => {
                if (event.key === " " || event.key === "Enter") {
                  event.preventDefault();
                  stopPress();
                }
              }}
              onContextMenu={(event) => event.preventDefault()}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center px-1.5 text-left focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
            >
              <span className="truncate text-xs font-semibold tracking-wide">
                {idleLabel}
              </span>
            </button>
          </div>
        )}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
