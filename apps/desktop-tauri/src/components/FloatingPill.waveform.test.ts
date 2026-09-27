import { describe, expect, it } from "vitest";
import {
  smoothWaveformBarHeights,
  waveformBarHeights,
} from "./FloatingPill.js";

describe("FloatingPill waveform", () => {
  it("keeps digital silence at the minimum bar height", () => {
    const silence = new Uint8Array(256).fill(128);

    expect(waveformBarHeights(silence, 28)).toEqual(new Array(32).fill(4));
  });

  it("turns microphone samples into varied, visible bars", () => {
    const samples = new Uint8Array(256).fill(128);
    for (let bar = 0; bar < 32; bar += 1) {
      samples[bar * 8] = 128 + Math.min(100, bar * 3);
    }

    const heights = waveformBarHeights(samples, 28);

    expect(heights).toHaveLength(32);
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
});
