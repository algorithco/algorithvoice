import { describe, expect, it } from "vitest";
import {
  estimateDurationSec,
  isAbortError,
  ProviderError,
  resolveAudioFormat,
  resolveDurationSec,
  sniffAudioFormat,
} from "./stt.utils.js";

function wavBytes(
  dataSize: number,
  byteRate = 32000,
  extraChunkSize = 0,
): Uint8Array {
  const extraPadded = extraChunkSize + (extraChunkSize % 2);
  const dataHeader = extraChunkSize > 0 ? 44 + extraPadded : 36;
  const buf = new Uint8Array(dataHeader + 8 + dataSize);
  const set = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  };
  set(0, "RIFF");
  set(8, "WAVE");
  set(12, "fmt ");
  const view = new DataView(buf.buffer);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  if (extraChunkSize > 0) {
    set(36, "LIST");
    view.setUint32(40, extraChunkSize, true);
  }
  set(dataHeader, "data");
  view.setUint32(dataHeader + 4, dataSize, true);
  return buf;
}

describe("sniffAudioFormat", () => {
  it("detects wav/mp3/flac/m4a/ogg/webm", () => {
    expect(sniffAudioFormat(wavBytes(100))).toBe("wav");
    const mp3 = new Uint8Array(12);
    mp3[0] = 0xff;
    mp3[1] = 0xfb;
    expect(sniffAudioFormat(mp3)).toBe("mp3");
    const flac = new Uint8Array(12);
    flac.set([0x66, 0x4c, 0x61, 0x43]);
    expect(sniffAudioFormat(flac)).toBe("flac");
    const m4a = new Uint8Array(12);
    m4a.set([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]);
    expect(sniffAudioFormat(m4a)).toBe("m4a");
    const ogg = new Uint8Array(12);
    ogg.set([0x4f, 0x67, 0x67, 0x53]);
    expect(sniffAudioFormat(ogg)).toBe("ogg");
    const webm = new Uint8Array(12);
    webm.set([0x1a, 0x45, 0xdf, 0xa3]);
    expect(sniffAudioFormat(webm)).toBe("webm");
  });
  it("returns null for unknown or short input", () => {
    expect(sniffAudioFormat(new Uint8Array(100))).toBeNull();
    expect(sniffAudioFormat(new Uint8Array(4))).toBeNull();
  });
});

describe("resolveAudioFormat", () => {
  it("trusts allowlisted extensions", () => {
    expect(resolveAudioFormat("clip.MP3", new Uint8Array(100))).toBe("mp3");
  });
  it("sniffs when extension is missing or hostile", () => {
    expect(resolveAudioFormat("recording", wavBytes(64))).toBe("wav");
    expect(resolveAudioFormat("evil.wav.exe", new Uint8Array(100))).toBeNull();
  });
});

describe("estimateDurationSec", () => {
  it("H6: reads exact duration from a canonical wav header", () => {
    expect(estimateDurationSec(wavBytes(64000, 32000), "wav")).toBeCloseTo(
      2,
      5,
    );
  });
  it("H6: finds fmt and data around an extra RIFF chunk", () => {
    expect(estimateDurationSec(wavBytes(64000, 32000, 7), "wav")).toBe(2);
  });
  it("H6: forged and truncated wav headers cannot under-meter", () => {
    const forged = wavBytes(10 * 1024 * 1024, 0xffffffff);
    expect(estimateDurationSec(forged, "wav")).toBeGreaterThan(54);

    const truncated = wavBytes(32000).subarray(0, 16044);
    expect(estimateDurationSec(truncated, "wav")).toBe(1);
  });
  it.each(["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"])(
    "H6: applies a lower bound and minimum charge for %s",
    (format) => {
      expect(estimateDurationSec(new Uint8Array(1), format)).toBe(1);
    },
  );
  it("H6: does not charge empty uploads", () => {
    expect(estimateDurationSec(new Uint8Array(), "wav")).toBe(0);
  });
});

describe("resolveDurationSec", () => {
  it("H6: accepts sane provider values, estimates the rest", () => {
    const audio = wavBytes(64000, 32000);
    expect(resolveDurationSec(2.5, audio, "wav")).toBe(2.5);
    expect(resolveDurationSec(undefined, audio, "wav")).toBeCloseTo(2, 5);
    expect(resolveDurationSec(-3, audio, "wav")).toBeCloseTo(2, 5);
    expect(resolveDurationSec(99999, audio, "wav")).toBe(7200);
  });
  it("H6: rejects a provider duration below the byte lower bound", () => {
    const audio = new Uint8Array(400000);
    expect(resolveDurationSec(1, audio, "mp3")).toBe(10);
  });
});

describe("ProviderError", () => {
  it("marks 429/5xx/timeout retryable, 4xx not", () => {
    expect(new ProviderError(429, "").retryable).toBe(true);
    expect(new ProviderError(503, "").retryable).toBe(true);
    expect(new ProviderError(504, "").retryable).toBe(true);
    expect(new ProviderError(400, "").retryable).toBe(false);
    expect(new ProviderError(401, "").retryable).toBe(false);
    expect(new ProviderError(402, "").retryable).toBe(false);
  });
  it("O-OBSERVABILITY: never retains upstream response bodies", () => {
    const secretProviderBody = "transcript and provider diagnostic";
    const error = new ProviderError(503, secretProviderBody);

    expect(JSON.stringify(error)).not.toContain(secretProviderBody);
    expect(Object.values(error)).not.toContain(secretProviderBody);
  });
  it("detects aborts", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
  });
});
