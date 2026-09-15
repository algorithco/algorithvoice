// Pure STT helpers — no framework imports, fully unit-testable.

export class ProviderError extends Error {
  readonly http: number;
  readonly retryable: boolean;
  readonly body: string;

  constructor(http: number, body: string) {
    super(`stt provider ${http}`);
    this.http = http;
    this.body = body;
    this.retryable =
      http === 408 || http === 425 || http === 429 || http >= 500;
  }
}

export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "name" in e &&
    e.name === "AbortError"
  );
}

const SUPPORTED_FORMATS = new Set([
  "wav",
  "mp3",
  "flac",
  "m4a",
  "ogg",
  "webm",
  "aac",
]);

const MIME_BY_FORMAT: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  webm: "audio/webm",
  aac: "audio/aac",
};

export function mimeForFormat(format: string): string {
  return MIME_BY_FORMAT[format] ?? "application/octet-stream";
}

/** Resolve upload format: trusted allowlist from filename, else magic-byte sniff. */
export function resolveAudioFormat(
  filename: string | undefined,
  audio: Uint8Array,
): string | null {
  const ext = (filename?.split(".").pop() ?? "").toLowerCase();
  if (SUPPORTED_FORMATS.has(ext)) return ext;
  return sniffAudioFormat(audio);
}

/** Magic-byte sniff for common containers. Returns null when unknown. */
export function sniffAudioFormat(audio: Uint8Array): string | null {
  if (audio.length < 12) return null;
  const ascii = (at: number, len: number) =>
    String.fromCharCode(...audio.subarray(at, at + len));
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "wav";
  if (
    ascii(0, 3) === "ID3" ||
    (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0)
  )
    return "mp3";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(4, 4) === "ftyp") return "m4a";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (
    audio[0] === 0x1a &&
    audio[1] === 0x45 &&
    audio[2] === 0xdf &&
    audio[3] === 0xa3
  )
    return "webm";
  return null;
}

/** Nominal bytes/sec per container for metering fallback estimates. */
const BYTES_PER_SEC: Record<string, number> = {
  wav: 32000, // 16kHz mono 16-bit
  mp3: 16000,
  flac: 16000,
  m4a: 16000,
  ogg: 8000,
  webm: 8000,
  aac: 16000,
};

/**
 * Server-side duration estimate. Prefers the WAV data-chunk header
 * (exact), else nominal bitrate. Never trusts the provider blindly.
 */
export function estimateDurationSec(audio: Uint8Array, format: string): number {
  if (format === "wav" && audio.length >= 44) {
    const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
    if (String.fromCharCode(...audio.subarray(0, 4)) === "RIFF") {
      const byteRate = view.getUint32(28, true);
      const dataSize = view.getUint32(40, true);
      if (byteRate > 0 && dataSize > 0 && dataSize <= audio.length) {
        return dataSize / byteRate;
      }
    }
  }
  const rate = BYTES_PER_SEC[format] ?? 16000;
  return audio.length / rate;
}

/** Sanitize provider-reported duration; fall back to local estimate. */
export function resolveDurationSec(
  reported: unknown,
  audio: Uint8Array,
  format: string,
): number {
  const n = typeof reported === "number" ? reported : Number.NaN;
  if (Number.isFinite(n) && n > 0 && n <= 7200) return n;
  return estimateDurationSec(audio, format);
}
