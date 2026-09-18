import { sttModeSchema } from "@algorith-voice/shared-types";
import { load } from "@tauri-apps/plugin-store";
import type { Prefs } from "../components/SettingsView.js";
import { isTauri } from "./session/env.js";

const KEY = "prefs.json";

export const DEFAULT_PREFS: Prefs = {
  hotkey: "Ctrl+Space",
  mode: "cloud",
  theme: "dark",
  activeModelId: null,
};

export function sanitizeMode(value: unknown): Prefs["mode"] {
  const parsed = sttModeSchema.safeParse(value);
  return parsed.success ? parsed.data : "cloud";
}

export function sanitizeModelId(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  // Allowlist: must match Rust manifest is_safe_slug
  // (lowercase/digit start, then lowercase/digit/./_/- , max 100)
  if (value.length > 100) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(value)) return null;
  return value;
}

export function sanitizeHotkey(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_PREFS.hotkey;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 48) return DEFAULT_PREFS.hotkey;
  if (!/^[A-Za-z0-9+_ -]+$/.test(trimmed)) return DEFAULT_PREFS.hotkey;
  const hasAlnum = /[A-Za-z0-9]/.test(trimmed);
  if (!hasAlnum) return DEFAULT_PREFS.hotkey;
  return trimmed;
}

export function sanitizeTheme(value: unknown): Prefs["theme"] {
  return value === "light" || value === "dark" ? value : "dark";
}

export function safeJsonParse<T>(raw: string): T | null {
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

export function buildPrefs(saved: Partial<Prefs> | null | undefined): Prefs {
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

function readLocalPrefs(): Prefs | null {
  try {
    const raw = localStorage.getItem("algorith-voice-prefs");
    if (!raw) return null;
    const saved = safeJsonParse<Partial<Prefs>>(raw);
    if (saved && typeof saved === "object") return buildPrefs(saved);
  } catch {
    // Ignore corrupt prefs.
  }
  return null;
}

function writeLocalPrefs(prefs: Prefs): void {
  try {
    localStorage.setItem("algorith-voice-prefs", JSON.stringify(prefs));
  } catch {
    // Storage unavailable.
  }
}

// Single source of truth:
// - Tauri shell: plugin-store (prefs.json) is authoritative. localStorage is
//   NEVER written in Tauri (avoids dual-persistence divergence); it is only
//   read once as a one-time migration when the store is empty.
// - Browser preview: localStorage is the only store.
export async function loadPrefs(): Promise<Prefs> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Partial<Prefs>>("prefs");
      if (saved && typeof saved === "object" && saved !== null) {
        return buildPrefs(saved);
      }
      // One-time migration: adopt a pre-existing browser mirror, then persist
      // it as the canonical store value so later loads don't diverge.
      const legacy = readLocalPrefs();
      if (legacy) {
        try {
          await store.set("prefs", legacy);
          await store.save();
        } catch {
          // Best-effort migration; canonical read still succeeds below.
        }
        return legacy;
      }
    } catch {
      // Fall through to defaults — surface via save verification instead of
      // silently diverging mirrors.
    }
    return DEFAULT_PREFS;
  }
  return readLocalPrefs() ?? DEFAULT_PREFS;
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  const canonical = buildPrefs(prefs);
  if (isTauri()) {
    const store = await load(KEY);
    await store.set("prefs", canonical);
    await store.save();
    // Write-verification: read back and fail loudly so the UI can surface it
    // instead of silently diverging.
    const roundtrip = await store.get<Partial<Prefs>>("prefs");
    const verified = roundtrip ? buildPrefs(roundtrip) : null;
    if (
      !verified ||
      verified.hotkey !== canonical.hotkey ||
      verified.theme !== canonical.theme ||
      verified.mode !== canonical.mode ||
      verified.activeModelId !== canonical.activeModelId
    ) {
      throw new Error("prefs store verification failed after write");
    }
    return;
  }
  writeLocalPrefs(canonical);
}

export async function loadOnboarded(): Promise<boolean> {
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<boolean>("onboarded");
      if (typeof saved === "boolean") return saved;
    } catch {
      // Fall through to defaults.
    }
    // No localStorage mirror in Tauri: a missing store value means "not yet
    // onboarded" is unknown — default to true only for browser preview safety?
    // Keep legacy behavior (true) only outside Tauri; in Tauri default false
    // would force onboarding on every fresh install, which is correct.
    // Preserve existing default (true) to avoid behavior change; migration
    // runs on first saveOnboarded.
    try {
      return localStorage.getItem("algorith-voice-onboarded") === "1";
    } catch {
      return true;
    }
  }
  try {
    return localStorage.getItem("algorith-voice-onboarded") === "1";
  } catch {
    return true;
  }
}

export async function saveOnboarded(): Promise<void> {
  if (isTauri()) {
    const store = await load(KEY);
    await store.set("onboarded", true);
    await store.save();
    return;
  }
  try {
    localStorage.setItem("algorith-voice-onboarded", "1");
  } catch {
    // Ignore.
  }
}
