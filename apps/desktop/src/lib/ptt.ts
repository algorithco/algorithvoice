import type { SttMode } from "@algorith-voice/shared-types";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./session.js";

// Push-to-talk invoke helpers (additive — existing session/prefs untouched).

/** Presses shorter than this are treated as accidental and discarded. */
export const MIN_PRESS_MS = 300;

async function tauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  if (!isTauri()) {
    if (fallback !== undefined) return fallback;
    throw new Error("not in Tauri shell");
  }
  return invoke<T>(cmd, args);
}

export interface TranscribeResult {
  text: string;
  /** False when auto-paste was unavailable — fall back to manual paste. */
  pasted: boolean;
}

/** Global events the pill emits so the main window can mirror status. */
export const PTT_ERROR_EVENT = "ptt-error";
export const PTT_TRANSCRIPT_EVENT = "ptt-transcript";

export interface PttTranscriptPayload {
  text: string;
  pasted: boolean;
}

export interface ForegroundInfo {
  platform: string;
  wayland: boolean;
  focus_steal_free: boolean;
  supported: boolean;
  note: string;
}

export async function ensureFloatingPill(): Promise<void> {
  await tauri("ensure_floating_pill");
}

export async function setFloatingPillVisible(visible: boolean): Promise<void> {
  await tauri("set_floating_pill_visible", { visible });
}

export async function floatingPillVisible(): Promise<boolean> {
  return tauri("floating_pill_visible", undefined, false);
}

export interface TranscribeOptions {
  /** Engine to use. Omitted (or cloud/byok) = Groq path, unchanged. */
  mode?: SttMode;
  /** Manifest id of the local model. Required when mode is "local". */
  modelId?: string | null;
}

export async function transcribeAudio(
  audioBase64: string,
  mimeType?: string | null,
  language?: string | null,
  opts?: TranscribeOptions,
): Promise<TranscribeResult> {
  return tauri<TranscribeResult>("transcribe_audio", {
    audioBase64,
    language: language ?? null,
    apiKey: null,
    mimeType: mimeType ?? null,
    mode: opts?.mode ?? null,
    modelId: opts?.modelId ?? null,
  });
}

export async function transcribeAndPaste(
  audioBase64: string,
  mimeType?: string | null,
  language?: string | null,
  opts?: TranscribeOptions,
): Promise<TranscribeResult> {
  return tauri<TranscribeResult>("transcribe_and_paste", {
    audioBase64,
    language: language ?? null,
    apiKey: null,
    mimeType: mimeType ?? null,
    restoreClipboard: true,
    mode: opts?.mode ?? null,
    modelId: opts?.modelId ?? null,
  });
}

export async function pasteText(text: string): Promise<void> {
  await tauri("paste_text", { text, restoreClipboard: true });
}

export async function setGroqApiKey(apiKey: string): Promise<void> {
  await tauri("set_groq_api_key", { apiKey });
}

export async function hasGroqKey(): Promise<boolean> {
  return tauri("has_groq_key", undefined, false);
}

export async function getForegroundInfo(): Promise<ForegroundInfo | null> {
  try {
    return await tauri<ForegroundInfo>("get_foreground_info");
  } catch {
    return null;
  }
}

/** Preferred MediaRecorder mime — first supported wins (Variant A). */
export function pickSupportedMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const mime of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  return undefined;
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("could not read audio"));
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : url);
    };
    reader.readAsDataURL(blob);
  });
}

// ---- Local-mode audio: browser decode + 16 kHz mono WAV ----
//
// MediaRecorder cannot emit WAV anywhere, but the local engine only eats
// 16 kHz mono PCM. The webview already decodes anything (WebM/Opus, MP4,
// M4A, OGG) via Web Audio, so local mode reuses that: decode the recorded
// blob, resample to 16 kHz mono, pack PCM-16 WAV, and send *that* to Rust
// (which validates it with the same parser the worker tests cover).

export const LOCAL_SAMPLE_RATE = 16000;

/** Pack mono float samples as a 16-bit PCM WAV Blob. Pure function. */
export function encodeWavPCM16(
  samples: Float32Array<ArrayBufferLike>,
  sampleRate: number,
): Blob {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * Decode any recorded blob and re-encode it as 16 kHz mono WAV base64
 * (raw base64, same shape as `blobToBase64`). Requires a browser webview;
 * not unit-testable under jsdom — `encodeWavPCM16` above carries the tests.
 */
export async function blobToWav16kMono(blob: Blob): Promise<string> {
  const inputBuffer = await blob.arrayBuffer();
  const AudioContextClass =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("web audio is unavailable for local transcription");
  }
  const context = new AudioContextClass();
  try {
    const decoded = await context.decodeAudioData(inputBuffer.slice(0));
    const channelData = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      // Downmix to mono by averaging all channels.
      const mono = new Float32Array(decoded.length);
      for (let c = 0; c < decoded.numberOfChannels; c += 1) {
        const channel = decoded.getChannelData(c);
        for (let i = 0; i < decoded.length; i += 1) {
          mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0);
        }
      }
      const scale = 1 / decoded.numberOfChannels;
      for (let i = 0; i < mono.length; i += 1) {
        mono[i] = (mono[i] ?? 0) * scale;
      }
      return wavBase64FromMono(mono, decoded.sampleRate);
    }
    return wavBase64FromMono(channelData, decoded.sampleRate);
  } finally {
    void context.close().catch(() => {});
  }
}

async function wavBase64FromMono(
  samples: Float32Array<ArrayBufferLike>,
  sampleRate: number,
): Promise<string> {
  // Copy into an ArrayBuffer-backed array: decoded channel data may carry
  // a SharedArrayBuffer typing that copyToChannel/encode reject.
  let mono: Float32Array<ArrayBuffer> = Float32Array.from(samples);
  if (sampleRate !== LOCAL_SAMPLE_RATE) {
    const OfflineClass = window.OfflineAudioContext;
    if (!OfflineClass) {
      throw new Error("offline resampling is unavailable");
    }
    const length = Math.max(
      1,
      Math.round((samples.length * LOCAL_SAMPLE_RATE) / sampleRate),
    );
    const offline = new OfflineClass(1, length, LOCAL_SAMPLE_RATE);
    const source = offline.createBufferSource();
    const buffer = offline.createBuffer(1, mono.length, sampleRate);
    buffer.copyToChannel(mono, 0);
    source.buffer = buffer;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    mono = Float32Array.from(rendered.getChannelData(0));
  }
  const wav = encodeWavPCM16(mono, LOCAL_SAMPLE_RATE);
  return blobToBase64(wav);
}

// ---- Last-transcript safety net (survives paste failures) ----

const LAST_TRANSCRIPT_KEY = "algorith-voice-last-transcript";

export function saveLastTranscript(text: string): void {
  try {
    localStorage.setItem(LAST_TRANSCRIPT_KEY, text);
  } catch {
    // Storage unavailable — transcript already pasted or shown.
  }
}

export function loadLastTranscript(): string | null {
  try {
    return localStorage.getItem(LAST_TRANSCRIPT_KEY);
  } catch {
    return null;
  }
}
