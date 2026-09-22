import { Button } from "@algorith-voice/ui";
import { useEffect, useState } from "react";
import {
  clearLocalUsage,
  EMPTY_LOCAL_USAGE,
  formatAudioDuration,
  getLocalUsageSummary,
  isLocalUsagePeriod,
  LOCAL_USAGE_PERIODS,
  type LocalUsagePeriod,
  type LocalUsageSummary,
} from "../lib/local-usage.js";

const PERIOD_LABELS: Record<LocalUsagePeriod, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  all: "All time",
};

/** On-device STT usage, read from the local SQLite ledger. SSR-safe: renders
 *  zeros until the effect loads real numbers (no Tauri runtime under SSR). */
export function LocalUsageSection() {
  const [period, setPeriod] = useState<LocalUsagePeriod>("30d");
  const [summary, setSummary] = useState<LocalUsageSummary>(EMPTY_LOCAL_USAGE);
  const [clearing, setClearing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setNotice(null);
    void getLocalUsageSummary(period).then((s) => {
      if (live) setSummary(s);
    });
    return () => {
      live = false;
    };
  }, [period]);

  const handleClear = async () => {
    if (
      !window.confirm(
        "Delete all local AI usage records? This cannot be undone.",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      const deleted = await clearLocalUsage();
      setSummary(await getLocalUsageSummary(period));
      setNotice(
        deleted === 1 ? "Cleared 1 record." : `Cleared ${deleted} records.`,
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-black">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-black dark:text-white">
        Local usage
      </h2>
      <p className="mt-2 text-xs text-gray-500">
        On-device transcription on this computer — audio in, text out. Counted
        locally, never uploaded.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {LOCAL_USAGE_PERIODS.map((p) => (
          <Button
            key={p}
            variant={period === p ? "primary" : "secondary"}
            onClick={() => {
              if (isLocalUsagePeriod(p)) setPeriod(p);
            }}
          >
            {PERIOD_LABELS[p]}
          </Button>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <dt className="text-xs text-gray-500">Sessions</dt>
          <dd className="mt-1 text-lg font-semibold text-black dark:text-white">
            {summary.sessions}
          </dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <dt className="text-xs text-gray-500">Audio in</dt>
          <dd className="mt-1 text-lg font-semibold text-black dark:text-white">
            {formatAudioDuration(summary.audio_seconds)}
          </dd>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
          <dt className="text-xs text-gray-500">Text out</dt>
          <dd className="mt-1 text-lg font-semibold text-black dark:text-white">
            {summary.text_words} words
          </dd>
        </div>
      </dl>
      {summary.by_model.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {summary.by_model.map((m) => (
            <li
              key={`${m.model_id} ${m.engine}`}
              className="flex flex-col gap-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm sm:flex-row sm:items-center sm:justify-between dark:border-white/10 dark:bg-white/[0.03]"
            >
              <span className="min-w-0 break-words font-mono text-xs text-black dark:text-white">
                {m.model_id}
              </span>
              <span className="shrink-0 text-xs text-gray-500">
                {m.sessions} sessions • {formatAudioDuration(m.audio_seconds)} •{" "}
                {m.text_words} words
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-xs text-gray-500">
          No on-device transcriptions in this period yet.
        </p>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={clearing || summary.sessions === 0}
          onClick={() => void handleClear()}
        >
          {clearing ? "Clearing…" : "Clear records"}
        </Button>
        {notice ? (
          <span className="text-xs text-gray-500">{notice}</span>
        ) : null}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-gray-500">
        Speech models have no LLM tokens, so usage is shown as audio and words.
        Only counts are stored — never audio, never transcript text — and they
        never leave this device.
      </p>
    </section>
  );
}
