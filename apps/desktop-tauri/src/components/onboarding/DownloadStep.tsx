import type {
  DownloadProgress,
  ModelStatusInfo,
} from "@algorith-voice/shared-types";
import { Button } from "@algorith-voice/ui";
import { formatBytes, formatEta, formatSpeed } from "./format.js";
import { StepProgress } from "./StepProgress.js";

function percent(
  progress: DownloadProgress | null,
  status: ModelStatusInfo | null,
): number | null {
  if (progress && progress.totalBytes > 0) {
    return Math.min(
      100,
      Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
    );
  }
  if (status && status.totalBytes > 0) {
    return Math.min(
      100,
      Math.round((status.downloadedBytes / status.totalBytes) * 100),
    );
  }
  return null;
}

/** Blocking download view inside onboarding step 2 (Model). The dashboard
 *  stays unreachable until the model is downloaded, verified, and selected —
 *  there is no path past this screen except finishing, cancelling back to
 *  the model list, or switching to Cloud. */
export function DownloadStep({
  modelName,
  progress,
  status,
  error,
  busy,
  onCancel,
  onRetry,
  onUseCloud,
}: {
  modelName: string;
  progress: DownloadProgress | null;
  status: ModelStatusInfo | null;
  error: string | null;
  busy?: boolean;
  onCancel: () => void;
  onRetry: () => void;
  onUseCloud: () => void;
}) {
  const pct = percent(progress, status);
  const verifying = status?.status === "verifying";
  const downloaded = progress?.downloadedBytes ?? status?.downloadedBytes ?? 0;
  const total = progress?.totalBytes || status?.totalBytes || 0;

  if (error) {
    return (
      <>
        <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
          Downloading {modelName} failed.
        </p>
        <p className="mt-3 max-w-[560px] text-sm text-amber-300">{error}</p>
        <p className="mt-2 max-w-[560px] text-xs text-white/60">
          Partial files are kept, so retrying resumes where it stopped.
        </p>
        <div className="mt-6 flex w-full justify-center gap-3">
          <Button
            onClick={onRetry}
            disabled={!!busy}
            className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
          >
            {busy ? "Retrying…" : "Retry download"}
          </Button>
        </div>
        <button
          type="button"
          onClick={onUseCloud}
          disabled={!!busy}
          className="mt-3 text-xs text-white/60 hover:text-white/70 disabled:opacity-40"
        >
          Use Cloud instead
        </button>
        <div className="h-12" />
        <StepProgress current={2} total={4} />
      </>
    );
  }

  return (
    <>
      <p className="max-w-[560px] text-[16px] leading-relaxed text-white/50 md:text-[17px]">
        {verifying ? `Verifying ${modelName}…` : `Downloading ${modelName}…`}
      </p>
      <p className="mt-2 max-w-[560px] text-xs leading-relaxed text-white/60">
        {verifying
          ? "Checking every file against its signature before setup."
          : "Large download — keep the app open. You only do this once."}
      </p>
      <div className="h-6" />
      <div className="w-full" aria-live="polite">
        <div className="h-2 w-full overflow-hidden rounded bg-white/10">
          {pct == null ? (
            <div
              className="h-full w-1/3 bg-white/70"
              style={{ animation: "shimmer 1.2s ease-in-out infinite" }}
            />
          ) : (
            <div
              className="h-full bg-white transition-[width]"
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-white/60">
          <span>
            {formatBytes(downloaded)}
            {total > 0 ? ` / ${formatBytes(total)}` : ""}
          </span>
          <span>{pct == null ? "starting…" : `${pct}%`}</span>
        </div>
        {!verifying && progress ? (
          <p className="mt-1 font-mono text-[11px] text-white/60">
            {formatSpeed(progress.bytesPerSecond)} • ETA{" "}
            {formatEta(progress.etaSeconds)}
          </p>
        ) : null}
      </div>
      <div className="mt-6 flex w-full justify-center gap-3">
        <Button
          onClick={onCancel}
          disabled={!!busy}
          className="h-[54px] w-[200px] rounded-xl bg-white text-[15px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
        >
          {busy ? "Cancelling…" : "Cancel"}
        </Button>
      </div>
      <button
        type="button"
        onClick={onUseCloud}
        disabled={!!busy}
        className="mt-3 text-xs text-white/60 hover:text-white/70 disabled:opacity-40"
      >
        Use Cloud instead
      </button>
      <div className="h-12" />
      <StepProgress current={2} total={4} />
    </>
  );
}
