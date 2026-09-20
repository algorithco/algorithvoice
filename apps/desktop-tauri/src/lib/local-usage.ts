import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./session/env.js";

export type LocalUsagePeriod = "today" | "7d" | "30d" | "all";

export interface LocalModelUsage {
  model_id: string;
  engine: string;
  sessions: number;
  audio_seconds: number;
  text_words: number;
}

export interface LocalUsageSummary {
  sessions: number;
  audio_seconds: number;
  text_chars: number;
  text_words: number;
  by_model: LocalModelUsage[];
}

export const EMPTY_LOCAL_USAGE: LocalUsageSummary = {
  sessions: 0,
  audio_seconds: 0,
  text_chars: 0,
  text_words: 0,
  by_model: [],
};

export const LOCAL_USAGE_PERIODS: LocalUsagePeriod[] = [
  "today",
  "7d",
  "30d",
  "all",
];

export function isLocalUsagePeriod(value: unknown): value is LocalUsagePeriod {
  return (
    typeof value === "string" &&
    (LOCAL_USAGE_PERIODS as string[]).includes(value)
  );
}

function isValidSummary(raw: unknown): raw is LocalUsageSummary {
  if (!raw || typeof raw !== "object") return false;
  const s = raw as Record<string, unknown>;
  return (
    typeof s.sessions === "number" &&
    typeof s.audio_seconds === "number" &&
    typeof s.text_chars === "number" &&
    typeof s.text_words === "number" &&
    Array.isArray(s.by_model) &&
    (s.by_model as unknown[]).every((m) => {
      if (!m || typeof m !== "object") return false;
      const row = m as Record<string, unknown>;
      return (
        typeof row.model_id === "string" &&
        typeof row.engine === "string" &&
        typeof row.sessions === "number" &&
        typeof row.audio_seconds === "number" &&
        typeof row.text_words === "number"
      );
    })
  );
}

export async function getLocalUsageSummary(
  period: LocalUsagePeriod,
): Promise<LocalUsageSummary> {
  // Browser preview and denied capabilities fall back to zeros — the ledger
  // is a local SQLite table that only exists in the desktop shell.
  if (!isTauri()) return EMPTY_LOCAL_USAGE;
  try {
    const summary = await invoke<unknown>("local_usage_summary", { period });
    return isValidSummary(summary) ? summary : EMPTY_LOCAL_USAGE;
  } catch {
    return EMPTY_LOCAL_USAGE;
  }
}

export async function clearLocalUsage(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    const deleted = await invoke<number>("local_usage_clear");
    return typeof deleted === "number" && deleted >= 0 ? deleted : 0;
  } catch {
    return 0;
  }
}

/** Human duration for audio totals: 45 → "45s", 150 → "2m 30s", 7500 → "2h 5m". */
export function formatAudioDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return "0s";
  const total = Math.floor(totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
