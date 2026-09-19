// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  clearHistory,
  deleteHistory,
  getHistoryStats,
  listHistory,
  safeParseHistory,
  saveHistory,
} from "./history.js";

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  mockInvoke.mockReset();
  // @ts-expect-error - cleanup
  delete window.__TAURI__;
  // @ts-expect-error - cleanup
  delete window.__TAURI_INTERNALS__;
});

describe("safeParseHistory shape guard", () => {
  it("drops malformed entries and prototype keys", () => {
    const raw = JSON.stringify([
      { id: "a", created_at: "2026-01-01T00:00:00Z", transcript: "hi" },
      { id: "b", transcript: "missing date" },
      { id: "x".repeat(200), created_at: "t", transcript: "too-long-id" },
      { id: "c", created_at: "t", transcript: "x".repeat(100_001) },
      "__proto__",
    ]);
    const out = safeParseHistory(raw);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("returns [] on corrupt json / non-array", () => {
    expect(safeParseHistory("{oops")).toEqual([]);
    expect(safeParseHistory(JSON.stringify({ not: "array" }))).toEqual([]);
    expect(safeParseHistory(null)).toEqual([]);
  });
});

describe("history validation", () => {
  it("saveHistory rejects empty and oversize without invoking", async () => {
    expect(await saveHistory("   ")).toBeNull();
    expect(await saveHistory("x".repeat(100_001))).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("saveHistory falls back to localStorage in browser (capped at 200)", async () => {
    mockInvoke.mockRejectedValue(new Error("no tauri"));
    const entry = await saveHistory("hello");
    expect(entry?.transcript).toBe("hello");
    expect(await listHistory(10)).toHaveLength(1);
  });

  it("listHistory clamps limit and falls back to cache", async () => {
    mockInvoke.mockRejectedValue(new Error("no tauri"));
    expect(await listHistory(0)).toEqual([]);
    expect(await listHistory(10_000)).toEqual([]);
  });

  it("getHistoryStats computes from cache in browser", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "history_stats") throw new Error("no tauri");
      if (cmd === "history_list") throw new Error("no tauri");
      throw new Error("no tauri");
    });
    const stats = await getHistoryStats();
    expect(stats.total).toBe(0);
  });

  it("deleteHistory validates id shape", async () => {
    await deleteHistory("");
    await deleteHistory("x".repeat(129));
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("clearHistory clears local keys in browser", async () => {
    mockInvoke.mockRejectedValue(new Error("no tauri"));
    window.localStorage.setItem("algorith-voice-history", "[]");
    await clearHistory();
    expect(window.localStorage.getItem("algorith-voice-history")).toBeNull();
  });
});
