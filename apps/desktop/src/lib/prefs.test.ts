// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFS, loadPrefs, savePrefs } from "./prefs.js";

beforeEach(() => {
  window.localStorage.clear();
});

describe("prefs mode validation (shared-types is truth)", () => {
  it("defaults to cloud with no stored prefs", async () => {
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.mode).toBe("cloud");
    expect(DEFAULT_PREFS.activeModelId).toBeNull();
  });

  it("preserves local and byok modes", async () => {
    await savePrefs({ ...DEFAULT_PREFS, mode: "local" });
    expect((await loadPrefs()).mode).toBe("local");
    await savePrefs({ ...DEFAULT_PREFS, mode: "byok" });
    expect((await loadPrefs()).mode).toBe("byok");
  });

  it("falls back to cloud for unknown modes, keeps the rest", async () => {
    window.localStorage.setItem(
      "algorith-voice-prefs",
      JSON.stringify({ ...DEFAULT_PREFS, mode: "quantum" }),
    );
    const prefs = await loadPrefs();
    expect(prefs.mode).toBe("cloud");
    expect(prefs.hotkey).toBe(DEFAULT_PREFS.hotkey);
  });

  it("persists activeModelId and sanitizes empties", async () => {
    await savePrefs({
      ...DEFAULT_PREFS,
      activeModelId: "parakeet-tdt-0.6b-v3",
    });
    expect((await loadPrefs()).activeModelId).toBe("parakeet-tdt-0.6b-v3");
    window.localStorage.setItem(
      "algorith-voice-prefs",
      JSON.stringify({ ...DEFAULT_PREFS, activeModelId: "" }),
    );
    expect((await loadPrefs()).activeModelId).toBeNull();
  });

  it("falls back to defaults on corrupt storage", async () => {
    window.localStorage.setItem("algorith-voice-prefs", "{oops");
    expect(await loadPrefs()).toEqual(DEFAULT_PREFS);
  });
});
