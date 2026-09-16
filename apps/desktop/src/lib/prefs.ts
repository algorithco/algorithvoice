import { load } from "@tauri-apps/plugin-store";
import type { Prefs } from "../components/SettingsView.js";
import { isTauri } from "./session.js";

const KEY = "prefs.json";

export const DEFAULT_PREFS: Prefs = {
  hotkey: "Ctrl+Space",
  mode: "cloud",
  theme: "dark",
};

export async function loadPrefs(): Promise<Prefs> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Prefs>("prefs");
      if (saved) {
        const merged = { ...DEFAULT_PREFS, ...saved };
        // Local offline transcription isn't available yet — migrate old
        // prefs forward instead of stranding users on a dead mode.
        if (merged.mode !== "cloud") merged.mode = "cloud";
        return merged;
      }
    } catch {
      // Fall through to localStorage.
    }
  }
  try {
    const raw = localStorage.getItem("algorith-voice-prefs");
    if (raw) {
      const merged = { ...DEFAULT_PREFS, ...JSON.parse(raw) };
      if (merged.mode !== "cloud") merged.mode = "cloud";
      return merged;
    }
  } catch {
    // Ignore corrupt prefs.
  }
  return DEFAULT_PREFS;
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  try {
    localStorage.setItem("algorith-voice-prefs", JSON.stringify(prefs));
  } catch {
    // Storage unavailable.
  }
  if (isTauri()) {
    try {
      const store = await load(KEY);
      await store.set("prefs", prefs);
      await store.save();
    } catch {
      // Non-fatal.
    }
  }
}

export async function loadOnboarded(): Promise<boolean> {
  try {
    return localStorage.getItem("algorith-voice-onboarded") === "1";
  } catch {
    return true;
  }
}

export async function saveOnboarded(): Promise<void> {
  try {
    localStorage.setItem("algorith-voice-onboarded", "1");
  } catch {
    // Ignore.
  }
}
