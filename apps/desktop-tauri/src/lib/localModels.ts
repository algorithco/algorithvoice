import type {
  DownloadProgress,
  LocalModel,
  ModelStatusInfo,
} from "@algorith-voice/shared-types";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "./session/env.js";

// Typed wrappers for the local-model Tauri commands (local_asr). Every
// function below calls a real backend command — no stubs. Shapes mirror
// packages/shared-types where a schema exists; the rest match the Rust
// structs field-for-field (both sides are camelCase).

export interface InstalledModel {
  id: string;
  name: string;
  version: string;
  totalBytes: number;
  installedAt: string;
}

export type WorkerLifecycle =
  | "unloaded"
  | "loading"
  | "ready"
  | "transcribing"
  | "failed";

export interface WorkerStatus {
  lifecycle: WorkerLifecycle;
  modelId?: string | null;
  failure?: string | null;
  /** Execution provider of the loaded engine ("cpu"/"cuda"), if any. */
  provider?: string | null;
  /** Effective language of the loaded engine (null = auto-detect), if any. */
  language?: string | null;
}

export interface HardwareInfo {
  os: string;
  arch: string;
  cpuModel?: string | null;
  cpuCoresPhysical?: number | null;
  cpuCoresLogical: number;
  totalRamBytes: number;
  availableRamBytes: number;
  gpu?: {
    vendor: string;
    name?: string | null;
    totalVramBytes?: number | null;
  } | null;
  supportedRuntimes: string[];
}

export type CompatibilityLevel =
  | "unsupported"
  | "barely-compatible"
  | "compatible"
  | "recommended";

export interface ModelCompatibility {
  id: string;
  level: CompatibilityLevel;
  reasons: string[];
}

export type LoadStage = "resolving-files" | "creating-engine" | "ready";

export interface LoadProgress {
  id: string;
  stage: LoadStage;
}

function requireTauri(): void {
  if (!isTauri()) {
    throw new Error("local models need the desktop app shell");
  }
}

export async function listAvailableModels(): Promise<LocalModel[]> {
  requireTauri();
  return invoke<LocalModel[]>("list_available_models");
}

export async function getModelStatus(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("get_model_status", { id });
}

export async function getInstalledModels(): Promise<InstalledModel[]> {
  requireTauri();
  return invoke<InstalledModel[]>("get_installed_models");
}

export async function downloadModel(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("download_model", { id });
}

export async function cancelDownload(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("cancel_download", { id });
}

export async function deleteModel(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("delete_model", { id });
}

export async function verifyModel(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("verify_model", { id });
}

export async function selectActiveModel(id: string): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("select_active_model", { id });
}

export async function startInferenceWorker(
  id: string,
): Promise<ModelStatusInfo> {
  requireTauri();
  return invoke<ModelStatusInfo>("start_inference_worker", { id });
}

export async function stopInferenceWorker(): Promise<WorkerStatus> {
  requireTauri();
  return invoke<WorkerStatus>("stop_inference_worker");
}

export async function getTranscriptionStatus(): Promise<WorkerStatus> {
  requireTauri();
  return invoke<WorkerStatus>("get_transcription_status");
}

export async function getHardwareInfo(): Promise<HardwareInfo> {
  requireTauri();
  return invoke<HardwareInfo>("get_hardware_info");
}

export async function getModelCompatibilities(): Promise<ModelCompatibility[]> {
  requireTauri();
  return invoke<ModelCompatibility[]>("get_model_compatibilities");
}

export function onDownloadProgress(
  handler: (progress: DownloadProgress) => void,
): Promise<() => void> {
  return listen<DownloadProgress>("model-download-progress", (event) =>
    handler(event.payload),
  ).then((unlisten) => unlisten);
}

export function onModelStatusChanged(
  handler: (status: ModelStatusInfo) => void,
): Promise<() => void> {
  return listen<ModelStatusInfo>("model-status-changed", (event) =>
    handler(event.payload),
  ).then((unlisten) => unlisten);
}

export function onModelLoadProgress(
  handler: (progress: LoadProgress) => void,
): Promise<() => void> {
  return listen<LoadProgress>("model-load-progress", (event) =>
    handler(event.payload),
  ).then((unlisten) => unlisten);
}
