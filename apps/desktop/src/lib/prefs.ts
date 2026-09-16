import { sttModeSchema } from "@algorith-voice/shared-types";
import { load } from "@tauri-apps/plugin-store";
import type { Prefs } from "../components/SettingsView.js";
import { isTauri } from "./session.js";

const KEY = "prefs.json";

export const DEFAULT_PREFS: Prefs = {
  hotkey: "Ctrl+Space",
  mode: "cloud",
  theme: "dark",
  activeModelId: null,
};

function sanitizeMode(value: unknown): Prefs["mode"] {
  const parsed = sttModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "cloud";
}

function sanitizeModelId(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function loadPrefs(): Promise<Prefs> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Prefs>("prefs");
      if (saved) {
        return {
          ...DEFAULT_PREFS,
          ...saved,
          // Shared-types schema is the single source of truth for modes:
          // unknown values fall back to cloud, valid ones (local/byok)
          // are preserved as-is.
          mode: sanitizeMode((saved as Partial<Prefs>).mode),
          activeModelId: sanitizeModelId(
            (saved as Partial<Prefs>).activeModelId,
          ),
        };
      }
    } catch {
      // Fall through to localStorage.
    }
  }
  try {
    const raw = localStorage.getItem("algorith-voice-prefs");
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Prefs>;
      return {
        ...DEFAULT_PREFS,
        ...saved,
        mode: sanitizeMode(saved.mode),
        activeModelId: sanitizeModelId(saved.activeModelId),
      };
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
