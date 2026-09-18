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
  if (typeof value !== "string" || value.length === 0) return null;
  // Allowlist: must match Rust manifest is_safe_slug
  // (lowercase/digit start, then lowercase/digit/./_/- , max 100)
  if (value.length > 100) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return null;
  return value;
}

function sanitizeHotkey(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PREFS.hotkey;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 48) return DEFAULT_PREFS.hotkey;
  if (!/^[A-Za-z0-9+_ -]+$/.test(trimmed)) return DEFAULT_PREFS.hotkey;
  const hasAlnum = /[A-Za-z0-9]/.test(trimmed);
  if (!hasAlnum) return DEFAULT_PREFS.hotkey;
  return trimmed;
}

function sanitizeTheme(value: unknown): Prefs["theme"] {
  return value === "light" || value === "dark" ? value : "dark";
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw, (key, val) => {
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        return undefined;
      }
      return val as unknown;
    }) as T;
  } catch {
    return null;
  }
}

function buildPrefs(saved: Partial<Prefs> | null | undefined): Prefs {
  // Never spread untrusted objects (prototype pollution). Pick only known
  // keys through sanitizers.
  if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
  return {
    hotkey: sanitizeHotkey(saved.hotkey),
    theme: sanitizeTheme(saved.theme),
    mode: sanitizeMode(saved.mode),
    activeModelId: sanitizeModelId(saved.activeModelId),
  };
}

export async function loadPrefs(): Promise<Prefs> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Partial<Prefs>>("prefs");
      if (saved && typeof saved === "object" && saved !== null) {
        const merged = buildPrefs(saved);
        // Mirror to localStorage so secondary webviews that hit the
        // __TAURI_INTERNALS__ race still read fresh prefs (prefs are not sensitive).
        try {
          localStorage.setItem("algorith-voice-prefs", JSON.stringify(merged));
        } catch {}
        return merged;
      }
    } catch {
      // Fall through to localStorage.
    }
  }
  try {
    const raw = localStorage.getItem("algorith-voice-prefs");
    if (raw) {
      const saved = safeJsonParse<Partial<Prefs>>(raw);
      if (saved && typeof saved === "object") {
        return buildPrefs(saved);
      }
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
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<boolean>("onboarded");
      if (typeof saved === "boolean") return saved;
    } catch {
      // Fall through to localStorage mirror.
    }
  }
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
  if (isTauri()) {
    try {
      const store = await load(KEY);
      await store.set("onboarded", true);
      await store.save();
    } catch {
      // Non-fatal.
    }
  }
}
