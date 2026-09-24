import { sttModeSchema } from "@algorith-voice/shared-types";
import { load } from "@tauri-apps/plugin-store";
import type { Prefs } from "../components/SettingsView.js";
import { isTauri } from "./session/env.js";

const KEY = "prefs.json";

export const DEFAULT_PREFS: Prefs = {
  hotkey: "Ctrl+Space",
  mode: "cloud",
  theme: "dark",
  language: "auto",
  activeModelId: null,
};

/**
 * Race a promise against a deadline, resolving to `fallback` on timeout
 * OR rejection. Boot-path IPC (plugin-store) must never hang first paint:
 * use this around every load the splash gate depends on.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

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
  if (trimmed.length === 0 || trimmed.length > 32) return DEFAULT_PREFS.hotkey;
  if (!/^[A-Za-z0-9+_ -]+$/.test(trimmed)) return DEFAULT_PREFS.hotkey;
  if (
    trimmed.includes("++") ||
    trimmed.startsWith("+") ||
    trimmed.endsWith("+")
  )
    return DEFAULT_PREFS.hotkey;
  const lower = trimmed.toLowerCase();
  const blocked = [
    "alt+f4",
    "ctrl+alt+del",
    "ctrl+alt+delete",
    "super+l",
    "meta+l",
    "ctrl+q",
    "alt+tab",
    "super+d",
  ];
  if (blocked.some((b) => lower === b)) return DEFAULT_PREFS.hotkey;
  const hasModifier = [
    "ctrl",
    "alt",
    "shift",
    "super",
    "meta",
    "command",
    "cmd",
  ].some((m) => lower.includes(m));
  if (!hasModifier || !lower.includes("+")) return DEFAULT_PREFS.hotkey;
  const hasAlnum = /[A-Za-z0-9]/.test(trimmed);
  if (!hasAlnum) return DEFAULT_PREFS.hotkey;
  return trimmed;
}

export function sanitizeTheme(value: unknown): Prefs["theme"] {
  return value === "light" || value === "dark" ? value : "dark";
}

export function sanitizeLanguage(value: unknown): string {
  if (value === "auto") return "auto";
  if (typeof value !== "string") return "auto";
  const normalized = value.trim().toLowerCase().split("-")[0];
  return /^[a-z]{2,3}$/.test(normalized) ? normalized : "auto";
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
  if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
  // Filter __proto__ at object level before picking (Tauri IPC JSON has no reviver)
  const filtered = filterProtoKeys(saved);
  return {
    hotkey: sanitizeHotkey(filtered.hotkey),
    theme: sanitizeTheme(filtered.theme),
    mode: sanitizeMode(filtered.mode),
    language: sanitizeLanguage(filtered.language),
    activeModelId: sanitizeModelId(filtered.activeModelId),
  };
}

function filterProtoKeys<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    out[k] = v;
  }
  return out as T;
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
export async function loadPrefs(opts?: {
  allowMigration?: boolean;
}): Promise<Prefs> {
  const allowMigration = opts?.allowMigration ?? true;
  if (isTauri()) {
    try {
      const store = await load(KEY);
      const saved = await store.get<Partial<Prefs>>("prefs");
      if (saved && typeof saved === "object" && saved !== null) {
        // IPC JSON has no reviver — filter before build
        const filtered = filterProtoKeys(saved as Record<string, unknown>);
        return buildPrefs(filtered as Partial<Prefs>);
      }
      if (allowMigration) {
        const legacy = readLocalPrefs();
        if (legacy) {
          try {
            await store.set("prefs", legacy);
            await store.save();
          } catch {
            // Best-effort migration; canonical read still succeeds below.
            // Pill window has no store:allow-set, so this will fail there — ignore.
          }
          return legacy;
        }
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
      verified.language !== canonical.language ||
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
      // store unavailable — treat as not onboarded (force wizard), not true
      return false;
    }
    // In Tauri, missing value means not onboarded — do not fall back to localStorage
    return false;
  }
  try {
    return localStorage.getItem("algorith-voice-onboarded") === "1";
  } catch {
    return false;
  }
}

export async function saveOnboarded(): Promise<void> {
  if (isTauri()) {
    const store = await load(KEY);
    await store.set("onboarded", true);
    await store.save();
    const roundtrip = await store.get<boolean>("onboarded");
    if (roundtrip !== true)
      throw new Error("onboarded store verification failed");
    return;
  }
  try {
    localStorage.setItem("algorith-voice-onboarded", "1");
  } catch {
    // Ignore.
  }
}
