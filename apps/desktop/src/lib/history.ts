import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./session.js";

export interface HistoryEntry {
  id: string;
  created_at: string;
  transcript: string;
}

export interface HistoryStats {
  total: number;
  today: number;
  total_words: number;
  today_words: number;
}

async function tauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  if (!isTauri()) {
    if (fallback !== undefined) return fallback;
    throw new Error("not in Tauri");
  }
  return invoke<T>(cmd, args);
}

function safeParseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw, (k, v) => {
      if (k === "__proto__" || k === "constructor" || k === "prototype")
        return undefined;
      return v as unknown;
    }) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Validate entries shape to avoid polluted objects
    return (parsed as HistoryEntry[]).filter(
      (e) =>
        e &&
        typeof e.id === "string" &&
        typeof e.created_at === "string" &&
        typeof e.transcript === "string" &&
        e.id.length < 128 &&
        e.transcript.length < 100_000,
    );
  } catch {
    return [];
  }
}

export async function saveHistory(
  transcript: string,
): Promise<HistoryEntry | null> {
  const t = transcript.trim();
  if (!t) return null;
  if (t.length > 100_000) return null; // DoS guard
  try {
    const entry = await tauri<HistoryEntry>("history_save", { transcript: t });
    // Do NOT mirror to localStorage when running in Tauri — transcripts are
    // sensitive (medical/legal) and already persisted encrypted via SQLite.
    // Only keep localStorage fallback for browser preview (isTauri === false).
    if (!isTauri()) {
      try {
        const arr = safeParseHistory(
          localStorage.getItem("algorith-voice-history"),
        );
        arr.unshift(entry);
        localStorage.setItem(
          "algorith-voice-history",
          JSON.stringify(arr.slice(0, 200)),
        );
      } catch {}
    }
    return entry;
  } catch {
    // browser preview fallback: localStorage only
    if (isTauri()) return null;
    try {
      const entry: HistoryEntry = {
        id: Math.random().toString(36).slice(2),
        created_at: new Date().toISOString(),
        transcript: t,
      };
      const arr = safeParseHistory(
        localStorage.getItem("algorith-voice-history"),
      );
      arr.unshift(entry);
      localStorage.setItem(
        "algorith-voice-history",
        JSON.stringify(arr.slice(0, 200)),
      );
      return entry;
    } catch {
      return null;
    }
  }
}

export async function listHistory(limit = 100): Promise<HistoryEntry[]> {
  const safeLimit = Math.max(1, Math.min(500, limit | 0));
  try {
    const list = await tauri<HistoryEntry[]>("history_list", {
      limit: safeLimit,
    });
    return list;
  } catch {
    if (isTauri()) return [];
    try {
      const arr = safeParseHistory(
        localStorage.getItem("algorith-voice-history"),
      );
      return arr.slice(0, safeLimit);
    } catch {
      return [];
    }
  }
}

export async function getHistoryStats(): Promise<HistoryStats> {
  try {
    const s = await tauri<HistoryStats>("history_stats");
    return s;
  } catch {
    try {
      const list = await listHistory(500);
      const todayStr = new Date().toISOString().slice(0, 10);
      let today = 0;
      let todayWords = 0;
      let totalWords = 0;
      for (const e of list) {
        const w = e.transcript.trim().split(/\s+/).filter(Boolean).length;
        totalWords += w;
        if (e.created_at.slice(0, 10) === todayStr) {
          today += 1;
          todayWords += w;
        }
      }
      return {
        total: list.length,
        today,
        total_words: totalWords,
        today_words: todayWords,
      };
    } catch {
      return { total: 0, today: 0, total_words: 0, today_words: 0 };
    }
  }
}

export async function deleteHistory(id: string): Promise<void> {
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return;
  try {
    await tauri("history_delete", { id });
  } catch {}
  if (isTauri()) return;
  try {
    const arr = safeParseHistory(
      localStorage.getItem("algorith-voice-history"),
    );
    const next = arr.filter((e) => e.id !== id);
    localStorage.setItem("algorith-voice-history", JSON.stringify(next));
  } catch {}
}

export async function clearHistory(): Promise<void> {
  try {
    await tauri("history_clear");
  } catch {}
  if (isTauri()) {
    // Also clear any legacy plaintext copy if present
    try {
      localStorage.removeItem("algorith-voice-history");
      localStorage.removeItem("algorith-voice-last-transcript");
    } catch {}
    return;
  }
  try {
    localStorage.removeItem("algorith-voice-history");
    localStorage.removeItem("algorith-voice-last-transcript");
  } catch {}
}
