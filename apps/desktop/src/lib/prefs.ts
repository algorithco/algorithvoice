import { load } from "@tauri-apps/plugin-store";
import type { Prefs } from "../components/SettingsView.js";
import { isTauri } from "./session.js";

const KEY = "prefs.json";

export const DEFAULT_PREFS: Prefs = {
  hotkey: "Ctrl+Space",
  mode: "local",
  vadThreshold: 0.5,
  theme: "dark",
};

export async function loadPrefs(): Promise<Prefs> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Prefs>("prefs");
      if (saved) return { ...DEFAULT_PREFS, ...saved };
    } catch {
      // Fall through to localStorage.
    }
  }
  try {
    const raw = localStorage.getItem("algorith-voice-prefs");
    if (raw) return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
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
