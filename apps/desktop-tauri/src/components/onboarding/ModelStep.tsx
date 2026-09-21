import type { LocalModel } from "@algorith-voice/shared-types";
import { Button } from "@algorith-voice/ui";
import { useMemo } from "react";
import type {
  HardwareInfo,
  ModelCompatibility,
} from "../../lib/localModels.js";
import { formatBytes } from "./format.js";
import { StepProgress } from "./StepProgress.js";

export function ModelStep({
  hardware,
  models,
  compat,
  error,
  pickedId,
  busy,
  onPick,
  onContinue,
  onSkip,
}: {
  hardware: HardwareInfo | null;
  models: LocalModel[] | null;
  compat: Record<string, ModelCompatibility> | null;
  error: string | null;
  pickedId: string | null;
  busy?: boolean;
  onPick: (id: string) => void;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const recommendedId = useMemo(() => {
    if (!models || models.length === 0) return null;
    if (compat) {
      const pick = (lvl: string) =>
        models
          .filter((m) => compat[m.id]?.level === lvl)
          .sort(
            (a, b) =>
              a.files.reduce((s, f) => s + f.sizeBytes, 0) -
              b.files.reduce((s, f) => s + f.sizeBytes, 0),
          )[0]?.id ?? null;
      return (
        pick("recommended") ??
        pick("compatible") ??
        pick("barely-compatible") ??
        null
      );
    }
    const ramGb = hardware ? hardware.totalRamBytes / 1_000_000_000 : 8;
    let rec = "parakeet-tdt-0.6b-v3";
    if (ramGb < 4) rec = "whisper-small";
    else if (ramGb >= 16) rec = "qwen3-asr-1.7b";
    else if (ramGb >= 8) rec = "whisper-large-v3-turbo";
    return models.some((m) => m.id === rec) ? rec : models[0].id;
  }, [hardware, models, compat]);

  const hardwareLine = useMemo(() => {
    if (!hardware) return "Detecting system…";
    const ram = (hardware.totalRamBytes / 1_000_000_000).toFixed(1);
    const avail = (hardware.availableRamBytes / 1_000_000_000).toFixed(1);
    const gpu = hardware.gpu?.name ?? hardware.gpu?.vendor ?? "no GPU";
    const vram = hardware.gpu?.totalVramBytes
      ? ` • ${formatBytes(hardware.gpu.totalVramBytes)} VRAM`
      : "";
    return `${hardware.os} ${hardware.arch} • ${hardware.cpuModel ?? "CPU"} • ${ram} GB RAM (${avail} avail) • ${gpu}${vram}`;
  }, [hardware]);

  if (error) {
    return (
      <>
        <p className="max-w-[560px] text-sm text-amber-300">{error}</p>
        <div className="h-6" />
        <Button
          onClick={onSkip}
          className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90"
        >
          Skip for now
        </Button>
        <div className="h-12" />
        <StepProgress current={2} total={4} />
      </>
    );
  }

  if (!models) {
    return (
      <>
        <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50">
          Loading models…
        </p>
        <div className="h-12" />
        <StepProgress current={2} total={4} />
      </>
    );
  }

  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        Which model will you use? We recommend one based on your system.
      </p>
      <p className="mt-2 max-w-[560px] text-xs leading-relaxed text-white/30">
        {hardwareLine}
      </p>
      <div className="h-6" />
      <div
        role="radiogroup"
        aria-label="Select a model"
        className="max-h-[32vh] sm:max-h-\[42vh\] w-full space-y-2 overflow-auto rounded-lg border border-white/10 bg-white/[0.04] p-2 text-left"
      >
        {models.map((m) => {
          const total = m.files.reduce((a, f) => a + f.sizeBytes, 0);
          const isPicked = pickedId === m.id;
          const isRec = m.id === recommendedId;
          const c = compat?.[m.id];
          const level = c?.level ?? null;
          const blocked = level === "unsupported";
          const levelLabel =
            level === "unsupported"
              ? "Not compatible"
              : level === "barely-compatible"
                ? "May be slow"
                : level === "compatible"
                  ? "Compatible"
                  : level === "recommended"
                    ? "Recommended"
                    : null;
          const reasons = c?.reasons?.slice(0, 1).join(" ") ?? "";
          return (
            // biome-ignore lint/a11y/useAriaPropsSupportedByRole: radiogroup pattern — button with aria-checked is intentional
            <button
              key={m.id}
              type="button"
              aria-checked={isPicked}
              aria-disabled={blocked}
              disabled={blocked}
              onClick={() => {
                if (!blocked) onPick(m.id);
              }}
              className={`flex w-full flex-col rounded-md border px-3 py-2.5 text-left transition-colors ${
                isPicked
                  ? "border-white bg-white text-black"
                  : "border-white/10 bg-transparent text-white hover:bg-white/[0.06]"
              } ${blocked ? "opacity-40 cursor-not-allowed" : ""}`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="text-[13px] font-medium leading-tight">
                  {m.name}
                </span>
                <span className="flex items-center gap-1.5">
                  {isRec ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${isPicked ? "bg-black text-white" : "bg-white text-black"}`}
                    >
                      Recommended
                    </span>
                  ) : null}
                  {levelLabel ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        level === "unsupported"
                          ? isPicked
                            ? "bg-red-600 text-white"
                            : "bg-red-500/20 text-red-300"
                          : level === "barely-compatible"
                            ? isPicked
                              ? "bg-amber-600 text-white"
                              : "bg-amber-500/20 text-amber-300"
                            : isPicked
                              ? "bg-black/10 text-black"
                              : "bg-white/10 text-white/70"
                      }`}
                    >
                      {levelLabel}
                    </span>
                  ) : null}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${isPicked ? "bg-black/10 text-black" : "bg-white/10 text-white/70"}`}
                  >
                    v{m.version}
                  </span>
                </span>
              </span>
              <span
                className={`mt-1 font-mono text-[11px] ${isPicked ? "text-black/60" : "text-white/40"}`}
              >
                {m.id} • {m.engine} • {formatBytes(total)} •{" "}
                {m.languages.length} langs • {m.license}
              </span>
              <span
                className={`mt-0.5 text-[11px] ${isPicked ? "text-black/50" : "text-white/40"}`}
              >
                RAM {m.minRamGb}→{m.recommendedRamGb} GB
                {m.minVramGb > 0
                  ? ` • VRAM ${m.minVramGb}→${m.recommendedVramGb} GB`
                  : ""}{" "}
                {reasons ? `• ${reasons}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 max-w-[560px] text-xs text-white/60">
        Verified against your system (RAM, GPU, disk). Unsupported models are
        disabled. You can change or download later in Settings → Local.
      </p>
      {error ? (
        <p className="mt-3 max-w-[560px] text-sm text-amber-300">{error}</p>
      ) : null}
      <div className="mt-6 flex w-full justify-center gap-3">
        <Button
          onClick={onContinue}
          disabled={
            !pickedId ||
            busy ||
            (pickedId ? compat?.[pickedId]?.level === "unsupported" : false)
          }
          className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
        >
          {busy ? "Preparing…" : "Continue"}
        </Button>
      </div>
      <button
        type="button"
        onClick={onSkip}
        disabled={!!busy}
        className="mt-3 text-xs text-white/40 hover:text-white/70 disabled:opacity-40"
      >
        Not now — use Cloud
      </button>
      <div className="h-12" />
      <StepProgress current={2} total={4} />
    </>
  );
}
