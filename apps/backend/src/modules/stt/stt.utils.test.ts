import { describe, expect, it } from "vitest";
import {
  estimateDurationSec,
  isAbortError,
  ProviderError,
  resolveAudioFormat,
  resolveDurationSec,
  sniffAudioFormat,
} from "./stt.utils.js";

function wavBytes(dataSize: number, byteRate = 32000): Uint8Array {
  const buf = new Uint8Array(44 + dataSize);
  const set = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[at + i] = s.charCodeAt(i);
  };
  set(0, "RIFF");
  set(8, "WAVE");
  new DataView(buf.buffer).setUint32(28, byteRate, true);
  new DataView(buf.buffer).setUint32(40, dataSize, true);
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
  it("reads exact duration from wav header", () => {
    expect(estimateDurationSec(wavBytes(64000, 32000), "wav")).toBeCloseTo(
      2,
      5,
    );
  });
  it("falls back to nominal bitrate", () => {
    expect(estimateDurationSec(new Uint8Array(16000), "mp3")).toBeCloseTo(1, 5);
  });
});

describe("resolveDurationSec", () => {
  it("accepts sane provider values, estimates the rest", () => {
    const audio = wavBytes(64000, 32000);
    expect(resolveDurationSec(2.5, audio, "wav")).toBe(2.5);
    expect(resolveDurationSec(undefined, audio, "wav")).toBeCloseTo(2, 5);
    expect(resolveDurationSec(-3, audio, "wav")).toBeCloseTo(2, 5);
    expect(resolveDurationSec(99999, audio, "wav")).toBeCloseTo(2, 5);
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
  it("detects aborts", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("x"))).toBe(false);
  });
});
