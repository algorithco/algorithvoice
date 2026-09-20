// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  clearLocalUsage,
  EMPTY_LOCAL_USAGE,
  formatAudioDuration,
  getLocalUsageSummary,
  isLocalUsagePeriod,
} from "./local-usage.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

const VALID_SUMMARY = {
  sessions: 3,
  audio_seconds: 100.5,
  text_chars: 830,
  text_words: 170,
  by_model: [
    {
      model_id: "parakeet-tdt-0.6b-v3",
      engine: "sherpa-onnx",
      sessions: 2,
      audio_seconds: 90,
      text_words: 150,
    },
  ],
};

beforeEach(() => {
  mockInvoke.mockReset();
  // @ts-expect-error - cleanup
  delete window.__TAURI__;
  // @ts-expect-error - cleanup
  delete window.__TAURI_INTERNALS__;
});

describe("isLocalUsagePeriod", () => {
  it("accepts the four known periods and rejects the rest", () => {
    expect(isLocalUsagePeriod("today")).toBe(true);
    expect(isLocalUsagePeriod("7d")).toBe(true);
    expect(isLocalUsagePeriod("30d")).toBe(true);
    expect(isLocalUsagePeriod("all")).toBe(true);
    expect(isLocalUsagePeriod("fortnight")).toBe(false);
    expect(isLocalUsagePeriod("")).toBe(false);
    expect(isLocalUsagePeriod(null)).toBe(false);
    expect(isLocalUsagePeriod(undefined)).toBe(false);
  });
});

describe("getLocalUsageSummary", () => {
  it("returns zeros in browser preview without invoking", async () => {
    expect(await getLocalUsageSummary("30d")).toEqual(EMPTY_LOCAL_USAGE);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("passes the period through to the command", async () => {
    // @ts-expect-error - simulate desktop shell
    window.__TAURI__ = {};
    mockInvoke.mockResolvedValue(VALID_SUMMARY);
    expect(await getLocalUsageSummary("7d")).toEqual(VALID_SUMMARY);
    expect(mockInvoke).toHaveBeenCalledWith("local_usage_summary", {
      period: "7d",
    });
  });

  it("falls back to zeros on invoke failure or malformed payload", async () => {
    // @ts-expect-error - simulate desktop shell
    window.__TAURI__ = {};
    mockInvoke.mockRejectedValue(new Error("denied"));
    expect(await getLocalUsageSummary("all")).toEqual(EMPTY_LOCAL_USAGE);
    mockInvoke.mockResolvedValue({ sessions: "three" });
    expect(await getLocalUsageSummary("all")).toEqual(EMPTY_LOCAL_USAGE);
  });
});

describe("clearLocalUsage", () => {
  it("returns 0 in browser preview without invoking", async () => {
    expect(await clearLocalUsage()).toBe(0);
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns the deleted count from the command", async () => {
    // @ts-expect-error - simulate desktop shell
    window.__TAURI__ = {};
    mockInvoke.mockResolvedValue(7);
    expect(await clearLocalUsage()).toBe(7);
    expect(mockInvoke).toHaveBeenCalledWith("local_usage_clear");
  });
});

describe("formatAudioDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatAudioDuration(0)).toBe("0s");
    expect(formatAudioDuration(-5)).toBe("0s");
    expect(formatAudioDuration(NaN)).toBe("0s");
    expect(formatAudioDuration(45)).toBe("45s");
    expect(formatAudioDuration(150)).toBe("2m 30s");
    expect(formatAudioDuration(7500)).toBe("2h 5m");
  });
});
