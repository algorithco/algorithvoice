// Pure STT helpers — no framework imports, fully unit-testable.

export class ProviderError extends Error {
  readonly http: number;
  readonly retryable: boolean;

  constructor(http: number, _discardedBody?: string) {
    super(`stt provider ${http}`);
    this.http = http;
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

/** Generous upper bounds used to prevent a forged duration from under-metering. */
const MAX_BYTES_PER_SEC: Record<string, number> = {
  wav: 192000, // 48 kHz, stereo, 16-bit PCM
  mp3: 40000, // 320 kbps
  flac: 288000, // generous ceiling for lossless 48 kHz stereo audio
  m4a: 64000, // 512 kbps
  ogg: 64000,
  webm: 128000,
  aac: 64000,
};

const MAX_DURATION_SEC = 7200;

function asciiAt(audio: Uint8Array, at: number, length: number): string {
  return String.fromCharCode(...audio.subarray(at, at + length));
}

function wavHeaderDurationSec(audio: Uint8Array): number | null {
  if (
    audio.length < 12 ||
    asciiAt(audio, 0, 4) !== "RIFF" ||
    asciiAt(audio, 8, 4) !== "WAVE"
  ) {
    return null;
  }

  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  let byteRate: number | null = null;
  let dataBytes: number | null = null;

  for (let offset = 12; offset + 8 <= audio.length; ) {
    const id = asciiAt(audio, offset, 4);
    const declaredSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const availableSize = Math.min(declaredSize, audio.length - dataStart);

    if (id === "fmt " && availableSize >= 12) {
      const candidate = view.getUint32(dataStart + 8, true);
      if (candidate > 0) byteRate = candidate;
    } else if (id === "data") {
      dataBytes = Math.max(0, availableSize);
    }

    if (declaredSize > audio.length - dataStart) break;
    offset = dataStart + declaredSize + (declaredSize % 2);
  }

  return byteRate && dataBytes !== null ? dataBytes / byteRate : null;
}

/**
 * Server-side duration estimate. Uses a parsed WAV duration when available,
 * but never below a container-specific lower bound derived from upload size.
 */
export function estimateDurationSec(audio: Uint8Array, format: string): number {
  if (audio.length === 0) return 0;
  const maxRate = MAX_BYTES_PER_SEC[format] ?? 288000;
  const lowerBound = audio.length / maxRate;
  const headerDuration = format === "wav" ? wavHeaderDurationSec(audio) : null;
  return Math.min(
    MAX_DURATION_SEC,
    Math.max(1, lowerBound, headerDuration ?? 0),
  );
}

/** Sanitize provider-reported duration; fall back to local estimate. */
export function resolveDurationSec(
  reported: unknown,
  audio: Uint8Array,
  format: string,
): number {
  const lowerBound = estimateDurationSec(audio, format);
  const n = typeof reported === "number" ? reported : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return lowerBound;
  return Math.min(MAX_DURATION_SEC, Math.max(lowerBound, n));
}
