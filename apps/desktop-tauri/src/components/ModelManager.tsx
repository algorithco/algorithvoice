import type {
  DownloadProgress,
  LocalModel,
  ModelStatusInfo,
} from "@algorith-voice/shared-types";
import { Button, Input } from "@algorith-voice/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cancelDownload,
  deleteModel,
  downloadModel,
  getHardwareInfo,
  getModelCompatibilities,
  getModelStatus,
  getTranscriptionStatus,
  type HardwareInfo,
  listAvailableModels,
  type ModelCompatibility,
  onDownloadProgress,
  onModelLoadProgress,
  onModelStatusChanged,
  selectActiveModel,
  verifyModel,
  type WorkerStatus,
} from "../lib/localModels.js";
import { isTauri } from "../lib/session/env.js";
import type { Prefs } from "./SettingsView.js";

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string" && o.message) return o.message;
    if (typeof o.errorMessage === "string" && o.errorMessage)
      return o.errorMessage;
    if (typeof o.error === "string" && o.error) return o.error;
    if (typeof o.code === "string" && typeof o.message === "string")
      return o.message;
    try {
      const s = JSON.stringify(o);
      if (s && s !== "{}" && s !== "null") return s;
    } catch {}
  }
  return String(e);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(u === 0 ? 0 : u === 3 ? 2 : 1)} ${units[u]}`;
}

function formatSpeed(bps: number): string {
  if (bps <= 0) return "—";
  return `${formatBytes(Math.round(bps))}/s`;
}

function formatEta(sec?: number): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m ${s}s`;
}

function totalBytesOf(model: LocalModel): number {
  return model.files.reduce((a, f) => a + f.sizeBytes, 0);
}

function statusLabel(s: ModelStatusInfo["status"]): string {
  switch (s) {
    case "ready":
      return "Ready";
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "not-downloaded":
      return "Not downloaded";
    case "error":
      return "Error";
    default:
      return s;
  }
}

function statusTone(s: ModelStatusInfo["status"]): string {
  switch (s) {
    case "ready":
      return "bg-black text-white dark:bg-white dark:text-black";
    case "downloading":
      return "bg-blue-600 text-white dark:bg-blue-500 dark:text-white motion-safe:animate-pulse";
    case "verifying":
      return "bg-amber-500 text-black";
    case "error":
      return "bg-red-600 text-white";
    default:
      return "bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-300";
  }
}

export function ModelManager({
  prefs,
  onPrefs,
}: {
  prefs: Prefs;
  onPrefs: (p: Prefs) => void;
}) {
  const [models, setModels] = useState<LocalModel[] | null>(null);
  const [statusMap, setStatusMap] = useState<Record<string, ModelStatusInfo>>(
    {},
  );
  const [progressMap, setProgressMap] = useState<
    Record<string, DownloadProgress>
  >({});
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [compatMap, setCompatMap] = useState<
    Record<string, ModelCompatibility>
  >({});
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [loadStage, setLoadStage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hardwareError, setHardwareError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [langFilter, setLangFilter] = useState("all");

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const list = await listAvailableModels();
      setModels(list);
      const entries = await Promise.all(
        list.map(async (m) => {
          try {
            const s = await getModelStatus(m.id);
            return [m.id, s] as const;
          } catch {
            return null;
          }
        }),
      );
      const next: Record<string, ModelStatusInfo> = {};
      for (const e of entries) if (e) next[e[0]] = e[1];
      setStatusMap(next);
      try {
        const hw = await getHardwareInfo();
        setHardware(hw);
        setHardwareError(null);
      } catch (e) {
        setHardwareError(getErrorMessage(e));
        console.warn("algorith-voice: getHardwareInfo failed", e);
      }
      try {
        const comp = await getModelCompatibilities();
        const cmap: Record<string, ModelCompatibility> = {};
        for (const c of comp) cmap[c.id] = c;
        setCompatMap(cmap);
      } catch (e) {
        console.warn("algorith-voice: getModelCompatibilities failed", e);
      }
      try {
        const ws = await getTranscriptionStatus();
        setWorkerStatus(ws);
      } catch (e) {
        console.warn("algorith-voice: getTranscriptionStatus failed", e);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!isTauri()) return;
    let un1: (() => void) | undefined;
    let un2: (() => void) | undefined;
    let un3: (() => void) | undefined;
    void onDownloadProgress((p) => {
      setProgressMap((m) => ({ ...m, [p.id]: p }));
    }).then((u) => {
      un1 = u;
    });
    void onModelStatusChanged((s) => {
      setStatusMap((m) => ({ ...m, [s.id]: s }));
      // clear progress when terminal
      if (
        s.status === "ready" ||
        s.status === "error" ||
        s.status === "not-downloaded"
      ) {
        setProgressMap((m) => {
          const n = { ...m };
          delete n[s.id];
          return n;
        });
        if (s.status === "ready") setBusyId(null);
      }
      // keep worker status roughly in sync
      void getTranscriptionStatus()
        .then(setWorkerStatus)
        .catch(() => {});
    }).then((u) => {
      un2 = u;
    });
    void onModelLoadProgress((p) => {
      setLoadStage(p.stage);
      if (p.stage === "ready") setTimeout(() => setLoadStage(null), 800);
    }).then((u) => {
      un3 = u;
    });
    return () => {
      un1?.();
      un2?.();
      un3?.();
    };
  }, []);

  const activeId = prefs.activeModelId;

  // Auto-select a ready model when none is active — fixes "No local model
  // selected" after a fresh download or when switching to Local mode with a
  // ready model already on disk. Respects compatibility and avoids loops.
  useEffect(() => {
    if (!isTauri() || !models || prefs.activeModelId) return;
    const readyEntry = Object.entries(statusMap).find(
      ([, s]) => s.status === "ready",
    );
    if (!readyEntry) return;
    const [readyId] = readyEntry;
    const level = compatMap[readyId]?.level;
    if (level === "unsupported") return;
    if (busyId) return;
    let cancelled = false;
    void (async () => {
      try {
        setBusyId(readyId);
        setLoadStage("resolving-files");
        const s = await selectActiveModel(readyId);
        if (cancelled) return;
        setStatusMap((m) => ({ ...m, [readyId]: s }));
        onPrefs({ ...prefs, activeModelId: readyId });
        setNotice(`Auto-selected ${readyId} for local mode.`);
        const ws = await getTranscriptionStatus().catch(() => null);
        if (ws && !cancelled) setWorkerStatus(ws);
      } catch (e) {
        if (!cancelled) setError(getErrorMessage(e));
      } finally {
        if (!cancelled) {
          setBusyId(null);
          setLoadStage(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [models, statusMap, compatMap, prefs, onPrefs, busyId]);

  const hardwareSummary = useMemo(() => {
    if (!hardware) return null;
    const ramGb = (hardware.totalRamBytes / 1_000_000_000).toFixed(1);
    const availGb = (hardware.availableRamBytes / 1_000_000_000).toFixed(1);
    const gpu = hardware.gpu?.name ?? hardware.gpu?.vendor ?? "none";
    const vram = hardware.gpu?.totalVramBytes
      ? ` • ${formatBytes(hardware.gpu.totalVramBytes)} VRAM`
      : "";
    return `${hardware.cpuModel ?? hardware.arch} • ${hardware.cpuCoresLogical} threads • ${ramGb} GB RAM (${availGb} GB avail) • GPU ${gpu}${vram}`;
  }, [hardware]);

  const handleDownload = async (id: string) => {
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      const s = await downloadModel(id);
      setStatusMap((m) => ({ ...m, [id]: s }));
    } catch (e) {
      setError(getErrorMessage(e));
      setBusyId(null);
    }
  };

  const handleCancel = async (id: string) => {
    setBusyId(id);
    try {
      const s = await cancelDownload(id);
      setStatusMap((m) => ({ ...m, [id]: s }));
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete ${id}? This removes all downloaded files.`)) return;
    setBusyId(id);
    setError(null);
    try {
      const s = await deleteModel(id);
      setStatusMap((m) => ({ ...m, [id]: s }));
      if (activeId === id) {
        const next = { ...prefs, activeModelId: null };
        onPrefs(next);
        setNotice(
          `Deleted active model ${id} — local mode now has no model. Pick another or switch to Cloud in Settings.`,
        );
      } else {
        setNotice(`Deleted ${id}.`);
      }
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleVerify = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const s = await verifyModel(id);
      setStatusMap((m) => ({ ...m, [id]: s }));
      setNotice(
        s.status === "ready"
          ? `Verified ${id}.`
          : `Verify failed: ${s.errorMessage ?? s.errorCode}`,
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const handleSelect = async (id: string) => {
    setBusyId(id);
    setError(null);
    setLoadStage("resolving-files");
    try {
      const s = await selectActiveModel(id);
      setStatusMap((m) => ({ ...m, [id]: s }));
      onPrefs({ ...prefs, activeModelId: id });
      setNotice(`Active model: ${id} (on-device)`);
      const ws = await getTranscriptionStatus().catch(() => null);
      if (ws) setWorkerStatus(ws);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
      setLoadStage(null);
    }
  };

  // NOTE: these memos must stay above the early returns below. Hooks must
  // run unconditionally on every render — when `models` flips null → loaded,
  // any hook placed after `if (!models) return` would change the hook count
  // between renders and crash React (#310).
  const allLanguages = useMemo(() => {
    const s = new Set<string>();
    for (const m of models ?? []) for (const l of m.languages) s.add(l);
    return ["all", ...Array.from(s).sort()];
  }, [models]);

  const filteredModels = useMemo(() => {
    if (!models) return [];
    const q = query.trim().toLowerCase();
    const langLower = langFilter.toLowerCase();
    return models.filter((m) => {
      if (
        langFilter !== "all" &&
        !m.languages.some((l) => l.toLowerCase() === langLower)
      )
        return false;
      if (!q) return true;
      const hay =
        `${m.id} ${m.name} ${m.engine} ${m.quantization} ${m.languages.join(" ")} ${m.license}`.toLowerCase();
      return hay.includes(q);
    });
  }, [models, query, langFilter]);

  if (!isTauri()) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-6 text-sm text-gray-500 dark:border-white/15">
        Model manager is available in the desktop app. Open the app to download
        and manage on-device models.
      </div>
    );
  }

  if (!models) {
    return <p className="text-sm text-gray-500">Loading model catalog…</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Hardware + active status */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Hardware
        </p>
        <p className="mt-1 text-xs leading-relaxed text-gray-700 dark:text-gray-300">
          {hardwareError
            ? `Hardware detection failed — ${hardwareError}`
            : (hardwareSummary ?? "Detecting hardware…")}
        </p>
        {hardwareError ? (
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-2 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400"
          >
            Retry
          </button>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-white/15 dark:bg-black">
            Active: {activeId ?? "none"}
          </span>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-white/15 dark:bg-black">
            Worker: {workerStatus?.lifecycle ?? "unknown"}
            {workerStatus?.modelId ? ` • ${workerStatus.modelId}` : ""}
            {loadStage ? ` • ${loadStage}` : ""}
          </span>
          <span className="rounded-full border border-gray-200 bg-white px-3 py-1 dark:border-white/15 dark:bg-black">
            Runtime:{" "}
            {hardware?.supportedRuntimes.join(", ") ?? "sherpa-onnx-cpu"}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Audio stays on this device in local mode — no uploads.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-white/10 dark:bg-black dark:text-gray-300">
          {notice}
        </div>
      ) : null}

      {/* Catalog filter for 6-model catalog */}
      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-black">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Input
            placeholder="Search 6 models (id, name, language)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="sm:max-w-[320px]"
          />
          <label className="flex items-center gap-2 text-xs text-gray-500">
            Language
            <select
              value={langFilter}
              onChange={(e) => setLangFilter(e.target.value)}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-white/15 dark:bg-black"
            >
              {allLanguages.map((l) => (
                <option key={l} value={l}>
                  {l === "all" ? "All languages" : l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Showing {filteredModels.length} of {models.length} models • Parakeet
          25 langs • Whisper family 99 langs • Qwen 5 langs • Distil EN-only
        </p>
      </div>

      <div className="grid gap-4">
        {filteredModels.length === 0 ? (
          <p className="text-sm text-gray-500">No models match your filter.</p>
        ) : (
          filteredModels.map((m) => {
            const status = statusMap[m.id];
            const progress = progressMap[m.id];
            const isActive = activeId === m.id;
            const total = totalBytesOf(m);
            const compat = compatMap[m.id];
            const level = compat?.level ?? null;
            const isUnsupported = level === "unsupported";
            const levelBadge =
              level === "unsupported"
                ? "Not compatible"
                : level === "barely-compatible"
                  ? "May be slow"
                  : level === "compatible"
                    ? "Compatible"
                    : level === "recommended"
                      ? "Recommended"
                      : null;
            const compatReasons = compat?.reasons?.join(" • ") ?? null;
            const compatWarning =
              level === "unsupported"
                ? (compatReasons ?? "Not compatible with this device")
                : level === "barely-compatible"
                  ? (compatReasons ?? null)
                  : null;

            const pct =
              status?.status === "downloading" && progress
                ? progress.totalBytes > 0
                  ? Math.round(
                      (progress.downloadedBytes / progress.totalBytes) * 100,
                    )
                  : null
                : status?.status === "downloading"
                  ? total > 0
                    ? Math.round((status.downloadedBytes / total) * 100)
                    : null
                  : null;

            const busy = busyId === m.id;

            return (
              <div
                key={m.id}
                className={`rounded-xl border p-5 transition-colors ${isActive ? "border-black bg-white dark:border-white dark:bg-black" : "border-gray-200 bg-white dark:border-white/10 dark:bg-black"}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-black dark:text-white">
                        {m.name}
                      </h3>
                      <span className="rounded bg-black px-2 py-0.5 text-xs font-mono text-white dark:bg-white dark:text-black">
                        v{m.version}
                      </span>
                      {isActive ? (
                        <span className="rounded-full bg-black px-2 py-0.5 text-xs text-white dark:bg-white dark:text-black">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 font-mono text-xs text-gray-500">
                      {m.id} • {m.engine} • {m.quantization} •{" "}
                      {m.languages.length} languages
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5">
                    {levelBadge ? (
                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          level === "unsupported"
                            ? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
                            : level === "barely-compatible"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                              : level === "recommended"
                                ? "bg-black text-white dark:bg-white dark:text-black"
                                : "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300"
                        }`}
                      >
                        {levelBadge}
                      </span>
                    ) : null}
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${status ? statusTone(status.status) : "bg-gray-100 text-gray-500"}`}
                    >
                      {status ? statusLabel(status.status) : "…"}
                    </span>
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span>
                    {formatBytes(total)} • {m.files.length} files
                  </span>
                  <span>• {m.license}</span>
                  <span>
                    • RAM {m.minRamGb}→{m.recommendedRamGb} GB
                  </span>
                  {m.minVramGb > 0 ? (
                    <span>
                      • VRAM {m.minVramGb}→{m.recommendedVramGb} GB
                    </span>
                  ) : null}
                </div>

                {/* languages preview */}
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500">
                  {m.languages.slice(0, 20).join(", ")}
                  {m.languages.length > 20
                    ? ` +${m.languages.length - 20} more`
                    : ""}
                </p>

                <p className="mt-2 text-xs italic text-gray-500">
                  {m.attribution}
                </p>

                {compatWarning ? (
                  <p
                    className={`mt-3 rounded-lg px-3 py-2 text-xs ${
                      level === "unsupported"
                        ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
                        : "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    }`}
                  >
                    {compatWarning}
                  </p>
                ) : compatReasons && level !== "unsupported" ? (
                  <p className="mt-2 text-xs text-gray-500">{compatReasons}</p>
                ) : null}

                {status?.status === "error" && status.errorMessage ? (
                  <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                    {status.errorCode ? `${status.errorCode}: ` : ""}
                    {status.errorMessage}
                  </p>
                ) : null}

                {/* Progress */}
                {status?.status === "downloading" ? (
                  <div className="mt-4">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                      <div
                        className="h-full bg-black transition-all dark:bg-white"
                        style={{ width: pct != null ? `${pct}%` : "12%" }}
                      />
                    </div>
                    <div className="mt-2 flex justify-between text-xs text-gray-500">
                      <span>
                        {progress
                          ? formatBytes(progress.downloadedBytes)
                          : status
                            ? formatBytes(status.downloadedBytes)
                            : "—"}{" "}
                        /{" "}
                        {progress?.totalBytes
                          ? formatBytes(progress.totalBytes)
                          : formatBytes(total)}{" "}
                        {pct != null ? `• ${pct}%` : "• —"}
                      </span>
                      <span>
                        {progress
                          ? `${formatSpeed(progress.bytesPerSecond)} • ETA ${formatEta(progress.etaSeconds)}`
                          : "starting…"}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Actions */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {(!status || status.status === "not-downloaded") && (
                    <Button
                      size="sm"
                      onClick={() => void handleDownload(m.id)}
                      disabled={busy || isUnsupported}
                      title={
                        isUnsupported
                          ? (compatReasons ?? "Not compatible")
                          : undefined
                      }
                    >
                      {isUnsupported
                        ? "Not compatible"
                        : busy
                          ? "Starting…"
                          : `Download • ${formatBytes(total)}`}
                    </Button>
                  )}
                  {status?.status === "downloading" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleCancel(m.id)}
                      disabled={busy}
                    >
                      Cancel
                    </Button>
                  )}
                  {status?.status === "ready" && (
                    <>
                      <Button
                        size="sm"
                        variant={isActive ? "secondary" : "primary"}
                        onClick={() => void handleSelect(m.id)}
                        disabled={busy || isUnsupported}
                        title={
                          isUnsupported
                            ? (compatReasons ?? "Not compatible")
                            : undefined
                        }
                      >
                        {isUnsupported
                          ? "Not compatible"
                          : isActive
                            ? "Selected"
                            : "Use this model"}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleVerify(m.id)}
                        disabled={busy}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleDelete(m.id)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                  {status?.status === "error" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => void handleDownload(m.id)}
                        disabled={busy}
                      >
                        Retry download
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleVerify(m.id)}
                        disabled={busy}
                      >
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleDelete(m.id)}
                        disabled={busy}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                  {status?.status === "verifying" && (
                    <span className="inline-flex items-center rounded-full border border-gray-200 px-3 py-2 text-xs dark:border-white/15">
                      Verifying…
                    </span>
                  )}
                </div>

                {/* File list (collapsed) */}
                <details className="mt-4">
                  <summary className="cursor-pointer text-xs text-gray-500">
                    Files ({m.files.length})
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-xs font-mono text-gray-500">
                    {m.files.map((f) => (
                      <li key={f.filename}>
                        {f.filename} • {formatBytes(f.sizeBytes)}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            );
          })
        )}
      </div>

      <p className="text-xs text-gray-500">
        On first use, download one model (Parakeet is default). Subsequent
        transcriptions reuse the installed files — no re-download. Use Verify to
        re-hash after disk errors.
      </p>
    </div>
  );
}
