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

export async function transcribeAudio(
  audioBase64: string,
  mimeType?: string | null,
  language?: string | null,
): Promise<TranscribeResult> {
  return tauri<TranscribeResult>("transcribe_audio", {
    audioBase64,
    language: language ?? null,
    apiKey: null,
    mimeType: mimeType ?? null,
  });
}

export async function transcribeAndPaste(
  audioBase64: string,
  mimeType?: string | null,
  language?: string | null,
): Promise<TranscribeResult> {
  return tauri<TranscribeResult>("transcribe_and_paste", {
    audioBase64,
    language: language ?? null,
    apiKey: null,
    mimeType: mimeType ?? null,
    restoreClipboard: true,
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
