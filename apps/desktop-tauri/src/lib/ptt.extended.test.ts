// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  blobToBase64,
  encodeWavPCM16,
  hasGroqKey,
  LOCAL_SAMPLE_RATE,
  pickSupportedMimeType,
  setGroqApiKey,
} from "./ptt.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

describe("pickSupportedMimeType", () => {
  it("returns undefined when MediaRecorder is missing", () => {
    const orig = (globalThis as Record<string, unknown>).MediaRecorder;
    delete (globalThis as Record<string, unknown>).MediaRecorder;
    expect(pickSupportedMimeType()).toBeUndefined();
    (globalThis as Record<string, unknown>).MediaRecorder = orig;
  });

  it("picks first supported candidate", () => {
    (globalThis as Record<string, unknown>).MediaRecorder = {
      isTypeSupported: (m: string) => m === "audio/webm",
    };
    expect(pickSupportedMimeType()).toBe("audio/webm");
    (globalThis as Record<string, unknown>).MediaRecorder = {
      isTypeSupported: () => false,
    };
    expect(pickSupportedMimeType()).toBeUndefined();
    delete (globalThis as Record<string, unknown>).MediaRecorder;
  });
});

describe("blobToBase64", () => {
  it("strips data-url prefix", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const b64 = await blobToBase64(blob);
    expect(b64).toBe(btoa("hello"));
  });
});

describe("encodeWavPCM16 edge cases", () => {
  it("handles empty samples", async () => {
    const blob = encodeWavPCM16(new Float32Array([]), LOCAL_SAMPLE_RATE);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(40, true)).toBe(0);
  });
});

describe("groq key path (keyring, never localStorage)", () => {
  it("forwards set/has to Tauri commands", async () => {
    // @ts-expect-error - test flag
    window.__TAURI__ = {};
    mockInvoke.mockResolvedValue(undefined);
    await setGroqApiKey("sk-test");
    expect(mockInvoke).toHaveBeenCalledWith("set_groq_api_key", {
      apiKey: "sk-test",
    });
    mockInvoke.mockResolvedValue(true);
    await expect(hasGroqKey()).resolves.toBe(true);
    expect(window.localStorage.getItem("groq-api-key")).toBeNull();
    // @ts-expect-error - cleanup
    delete window.__TAURI__;
  });

  it("hasGroqKey falls back to false outside Tauri", async () => {
    // @ts-expect-error - cleanup
    delete window.__TAURI__;
    // @ts-expect-error - cleanup
    delete window.__TAURI_INTERNALS__;
    await expect(hasGroqKey()).resolves.toBe(false);
  });
});
