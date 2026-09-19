// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPrefs,
  DEFAULT_PREFS,
  loadPrefs,
  safeJsonParse,
  sanitizeHotkey,
  sanitizeModelId,
  savePrefs,
} from "./prefs.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("prefs sanitizers", () => {
  it("sanitizes hotkeys to defaults on garbage", () => {
    expect(sanitizeHotkey("")).toBe(DEFAULT_PREFS.hotkey);
    expect(sanitizeHotkey("!!!")).toBe(DEFAULT_PREFS.hotkey);
    expect(sanitizeHotkey("a".repeat(49))).toBe(DEFAULT_PREFS.hotkey);
    expect(sanitizeHotkey("Ctrl+Space")).toBe("Ctrl+Space");
  });

  it("sanitizes model ids against Rust slug allowlist", () => {
    expect(sanitizeModelId("")).toBeNull();
    expect(sanitizeModelId("Bad Slug!")).toBeNull();
    expect(sanitizeModelId("../evil")).toBeNull();
    expect(sanitizeModelId("parakeet-tdt-0.6b-v3")).toBe(
      "parakeet-tdt-0.6b-v3",
    );
  });

  it("strips __proto__/constructor/prototype keys", () => {
    const raw = `{"hotkey":"Ctrl+Space","__proto__":{"polluted":true}}`;
    const parsed = safeJsonParse<Record<string, unknown>>(raw);
    expect(parsed).not.toBeNull();
    expect((parsed as Record<string, unknown>).polluted).toBeUndefined();
    expect(JSON.stringify(parsed)).not.toContain("polluted");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("buildPrefs never spreads untrusted objects", () => {
    const evil = JSON.parse(
      `{"hotkey":"Alt+Space","mode":"local","theme":"light","activeModelId":"whisper-small","extra":"nope","__proto__":{"x":1}}`,
    );
    const built = buildPrefs(evil);
    expect(built).toEqual({
      hotkey: "Alt+Space",
      theme: "light",
      mode: "local",
      activeModelId: "whisper-small",
    });
    expect("extra" in built).toBe(false);
  });
});

describe("prefs single source of truth (browser preview)", () => {
  it("round-trips via localStorage when not in Tauri", async () => {
    await savePrefs({ ...DEFAULT_PREFS, mode: "local" });
    expect((await loadPrefs()).mode).toBe("local");
  });

  it("falls back to defaults on corrupt storage", async () => {
    window.localStorage.setItem("algorith-voice-prefs", "{oops");
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
