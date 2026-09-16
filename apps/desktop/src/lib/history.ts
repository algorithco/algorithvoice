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

export async function saveHistory(
  transcript: string,
): Promise<HistoryEntry | null> {
  const t = transcript.trim();
  if (!t) return null;
  try {
    const entry = await tauri<HistoryEntry>("history_save", { transcript: t });
    // also keep localStorage fallback for browser preview
    try {
      const raw = localStorage.getItem("algorith-voice-history");
      const arr = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
      arr.unshift(entry);
      localStorage.setItem(
        "algorith-voice-history",
        JSON.stringify(arr.slice(0, 200)),
      );
    } catch {}
    return entry;
  } catch {
    // browser preview fallback: localStorage only
    try {
      const entry: HistoryEntry = {
        id: Math.random().toString(36).slice(2),
        created_at: new Date().toISOString(),
        transcript: t,
      };
      const raw = localStorage.getItem("algorith-voice-history");
      const arr = raw ? (JSON.parse(raw) as HistoryEntry[]) : [];
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
  try {
    const list = await tauri<HistoryEntry[]>("history_list", { limit });
    return list;
  } catch {
    try {
      const raw = localStorage.getItem("algorith-voice-history");
      if (!raw) return [];
      const arr = JSON.parse(raw) as HistoryEntry[];
      return arr.slice(0, limit);
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
  try {
    await tauri("history_delete", { id });
  } catch {}
  try {
    const raw = localStorage.getItem("algorith-voice-history");
    if (!raw) return;
    const arr = JSON.parse(raw) as HistoryEntry[];
    const next = arr.filter((e) => e.id !== id);
    localStorage.setItem("algorith-voice-history", JSON.stringify(next));
  } catch {}
}

export async function clearHistory(): Promise<void> {
  try {
    await tauri("history_clear");
  } catch {}
  try {
    localStorage.removeItem("algorith-voice-history");
  } catch {}
}
