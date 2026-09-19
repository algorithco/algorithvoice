import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./env.js";

export type TrayState = "idle" | "recording" | "processing";

async function tauri<T>(
  cmd: string,
  args?: Record<string, unknown>,
  fallback?: T,
): Promise<T> {
  if (!isTauri()) {
    if (fallback !== undefined) return fallback;
    throw new Error("not in Tauri shell");
  }
  return invoke<T>(cmd, args);
}

export async function setTrayState(state: TrayState): Promise<void> {
  try {
    await tauri("set_tray_state", { state });
  } catch {
    // Browser preview: tray doesn't exist.
  }
}

export async function openSettingsWindow(): Promise<void> {
  await tauri("open_settings");
}
