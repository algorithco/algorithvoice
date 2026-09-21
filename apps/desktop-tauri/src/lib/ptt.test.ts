import { describe, expect, it } from "vitest";
import { encodeWavPCM16, LOCAL_SAMPLE_RATE } from "./ptt.js";

describe("encodeWavPCM16", () => {
  it("writes a parseable PCM-16 mono WAV that round-trips samples", async () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const blob = encodeWavPCM16(samples, LOCAL_SAMPLE_RATE);
    expect(blob.type).toBe("audio/wav");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(
        ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
      );
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(LOCAL_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);

    // Sample values survive the int16 round-trip (LSB tolerance).
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBeGreaterThan(16000);
    expect(view.getInt16(48, true)).toBeLessThan(-16000);
  });

  it("clamps out-of-range input instead of wrapping", async () => {
    const blob = encodeWavPCM16(new Float32Array([2, -2]), 16000);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
