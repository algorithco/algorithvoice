import { describe, expect, it } from "vitest";
import {
  audioFrameRms,
  MIN_SPEECH_ACTIVITY_MS,
  SPEECH_RMS_THRESHOLD,
  smoothWaveformBarHeights,
  updateSpeechActivityMs,
  waveformBarHeights,
} from "./FloatingPill.js";

describe("FloatingPill waveform", () => {
  it("keeps digital silence at the minimum bar height", () => {
    const silence = new Uint8Array(256).fill(128);

    expect(waveformBarHeights(silence, 28)).toEqual(new Array(20).fill(4));
  });

  it("turns microphone samples into varied, visible bars", () => {
    const samples = new Uint8Array(256).fill(128);
    for (let bar = 0; bar < 20; bar += 1) {
      samples[bar * 12] = 128 + Math.min(100, bar * 5);
    }

    const heights = waveformBarHeights(samples, 28);

    expect(heights).toHaveLength(20);
    expect(Math.max(...heights)).toBeGreaterThan(24);
    expect(
      new Set(heights.map((height) => Math.round(height))).size,
    ).toBeGreaterThan(5);
  });

  it("eases quickly into speech and gently back toward silence", () => {
    const rising = smoothWaveformBarHeights([4], [28]);
    const falling = smoothWaveformBarHeights(rising, [4]);

    expect(rising[0]).toBeGreaterThan(4);
    expect(rising[0]).toBeLessThan(28);
    expect(falling[0]).toBeLessThan(rising[0] ?? 0);
    expect(falling[0]).toBeGreaterThan(4);
    expect((rising[0] ?? 0) - 4).toBeGreaterThan(
      (rising[0] ?? 0) - (falling[0] ?? 0),
    );
  });

  it("distinguishes digital silence, room noise, and clear speech energy", () => {
    const silence = new Uint8Array(256).fill(128);
    const roomNoise = Uint8Array.from({ length: 256 }, (_, index) =>
      index % 2 === 0 ? 130 : 126,
    );
    const speech = Uint8Array.from({ length: 256 }, (_, index) =>
      index % 2 === 0 ? 160 : 96,
    );

    expect(audioFrameRms(silence)).toBe(0);
    expect(audioFrameRms(roomNoise)).toBeLessThan(SPEECH_RMS_THRESHOLD);
    expect(audioFrameRms(speech)).toBeGreaterThan(SPEECH_RMS_THRESHOLD);
  });

  it("requires sustained speech instead of accepting one noise spike", () => {
    let sustained = 0;
    for (let frame = 0; frame < 4; frame += 1) {
      sustained = updateSpeechActivityMs(
        sustained,
        SPEECH_RMS_THRESHOLD + 0.01,
        50,
      );
    }
    expect(sustained).toBeGreaterThanOrEqual(MIN_SPEECH_ACTIVITY_MS);

    let isolated = updateSpeechActivityMs(0, SPEECH_RMS_THRESHOLD + 0.01, 50);
    for (let frame = 0; frame < 4; frame += 1) {
      isolated = updateSpeechActivityMs(isolated, 0, 50);
    }
    expect(isolated).toBe(0);
  });

  it("caps delayed animation frames so backgrounding cannot fake speech", () => {
    expect(updateSpeechActivityMs(0, 1, 10_000)).toBe(50);
  });
});
