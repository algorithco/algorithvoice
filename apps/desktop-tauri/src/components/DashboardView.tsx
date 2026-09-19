import { useEffect, useState } from "react";
import {
  getHistoryStats,
  type HistoryEntry,
  listHistory,
} from "../lib/history.js";
import { ensureFloatingPill } from "../lib/ptt.js";
import { CirclePlus } from "./animate-ui/icons/circle-plus.js";
import { ClipboardList } from "./animate-ui/icons/clipboard-list.js";

type Props = {
  hotkey: string;
  email?: string | null;
  onNavigate: (view: "dashboard" | "dictate" | "history" | "settings") => void;
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      const secs = Number(iso);
      if (!Number.isNaN(secs))
        return new Date(secs * 1000).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      return iso.slice(0, 16);
    }
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday)
      return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (isYesterday)
      return `Yesterday, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    return (
      d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      `, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    );
  } catch {
    return iso.slice(0, 16);
  }
}

export function DashboardView({ hotkey, email, onNavigate }: Props) {
  const [stats, setStats] = useState<{
    total: number;
    today: number;
    total_words: number;
    today_words: number;
  } | null>(null);
  const [recent, setRecent] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    void Promise.all([getHistoryStats(), listHistory(5)]).then(([s, r]) => {
      if (!mounted) return;
      setStats(s);
      setRecent(r);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const handleStart = async () => {
    try {
      await ensureFloatingPill();
    } catch {
      onNavigate("dictate");
    }
  };

  const avgWords =
    !loading && stats && stats.total > 0
      ? Math.round(stats.total_words / stats.total)
      : 0;

  return (
    <div className="mx-auto w-full max-w-[1100px] p-8 lg:p-10 2xl:max-w-[1280px]">
      {/* Header — status lives here so the hero holds the only CTA */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-black md:text-4xl dark:text-white 2xl:text-[44px]">
            {greeting()}
            {email ? `, ${email.split("@")[0]}` : ""}
          </h1>
          <p className="mt-2 text-sm text-gray-500 lg:text-[15px]">
            Your voice workspace
          </p>
        </div>
        <div className="inline-flex h-10 shrink-0 items-center gap-2.5 rounded-full border border-gray-200 bg-white px-5 text-sm text-gray-500 dark:border-white/10 dark:bg-black">
          <span className="size-2 rounded-full bg-black dark:bg-white" />
          <span className="font-medium text-black dark:text-white">Ready</span>
          <span className="text-gray-300 dark:text-white/20">•</span>
          <span className="font-mono text-[13px]">{hotkey}</span>
          <span className="text-gray-300 dark:text-white/20">•</span>
          <span>Cloud</span>
        </div>
      </div>

      {/* Main dictation card */}
      <div className="relative mt-8 overflow-hidden rounded-2xl border border-gray-200 bg-white p-8 dark:border-white/10 dark:bg-black md:p-10">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[720px] -translate-x-1/2 rounded-full bg-black/5 blur-[80px] dark:bg-white/5" />
        <div className="relative flex flex-col items-center text-center">
          <div className="grid size-20 place-items-center rounded-full border border-gray-300 bg-gray-100 dark:border-white/20 dark:bg-white/5">
            <div className="size-3 rounded-full bg-black dark:bg-white" />
          </div>
          <p className="mt-4 text-sm font-medium text-black dark:text-white">
            Ready to listen
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Hold{" "}
            <span className="rounded bg-black/5 px-2 py-0.5 font-mono text-black dark:bg-white/10 dark:text-white">
              {hotkey}
            </span>{" "}
            to dictate
          </p>
          <button
            type="button"
            onClick={handleStart}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-black px-8 text-sm font-semibold text-white transition-all hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85"
          >
            <CirclePlus size={16} animateOnHover />
            Start Dictation
          </button>
          <p className="mt-3 text-xs text-gray-500">
            Works in any app • Release to paste
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-black/20 dark:border-white/10 dark:bg-black dark:hover:border-white/20">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100 dark:via-white/30" />
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Dictations today
          </p>
          <p className="mt-2 text-2xl font-semibold text-black lg:text-3xl dark:text-white">
            {loading ? "—" : (stats?.today ?? 0)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {loading
              ? " "
              : stats && stats.today > 0
                ? `${stats.today_words} words today`
                : "No dictations yet"}
          </p>
        </div>
        <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-black/20 dark:border-white/10 dark:bg-black dark:hover:border-white/20">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/30 to-transparent opacity-0 transition-opacity group-hover:opacity-100 dark:via-white/30" />
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Total words
          </p>
          <p className="mt-2 text-2xl font-semibold text-black lg:text-3xl dark:text-white">
            {loading ? "—" : (stats?.total_words ?? 0).toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {loading ? " " : `${stats?.total ?? 0} dictations total`}
          </p>
        </div>
        <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white p-5 transition-colors hover:border-black/20 dark:border-white/10 dark:bg-black dark:hover:border-white/20">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-black/30 to-transparent opacity-100 dark:via-white/30" />
          <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-gray-500">
            <span className="size-2 rounded-full bg-black dark:bg-white" /> Avg
            per dictation
          </p>
          <p className="mt-2 text-2xl font-semibold text-black lg:text-3xl dark:text-white">
            {loading ? "—" : avgWords.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {loading || !stats || stats.total === 0
              ? "No data yet"
              : "words per dictation"}
          </p>
        </div>
      </div>

      {/* Recent + Quick actions */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.7fr_1fr]">
        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-black">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-black dark:text-white">
              <span className="size-1.5 rounded-full bg-black dark:bg-white" />{" "}
              Recent activity
            </h2>
            <button
              type="button"
              onClick={() => onNavigate("history")}
              className="text-xs text-gray-500 hover:text-black dark:hover:text-white"
            >
              View all →
            </button>
          </div>
          {loading ? (
            <p className="mt-6 text-sm text-gray-500">Loading…</p>
          ) : recent.length === 0 ? (
            <div className="mt-8 flex flex-col items-center py-8 text-center">
              <div className="grid size-10 place-items-center rounded-full border border-gray-200 text-gray-500 dark:border-white/10">
                <ClipboardList size={20} animateOnHover />
              </div>
              <p className="mt-3 text-sm font-medium text-black dark:text-white">
                No dictations yet
              </p>
              <p className="mt-1 max-w-[320px] text-sm text-gray-500">
                Your recent transcriptions will appear here. Hold {hotkey} to
                start.
              </p>
            </div>
          ) : (
            <div className="mt-4 divide-y divide-gray-200 dark:divide-white/10">
              {recent.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() =>
                    void navigator.clipboard
                      ?.writeText(e.transcript)
                      .catch(() => {})
                  }
                  className="flex w-full flex-col gap-1 py-4 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                >
                  <p className="line-clamp-2 font-mono text-sm text-black dark:text-white">
                    {e.transcript}
                  </p>
                  <p className="text-xs text-gray-500">
                    {formatTime(e.created_at)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-6 dark:border-white/10 dark:bg-black">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-black dark:text-white">
            <span className="size-1.5 rounded-full bg-black dark:bg-white" />{" "}
            How it works
          </h2>
          <ol className="mt-4 flex flex-col gap-4">
            <li className="flex items-start gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black font-mono text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                1
              </span>
              <div>
                <p className="text-sm font-medium text-black dark:text-white">
                  Hold {hotkey}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Press and hold anywhere to start listening
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black font-mono text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                2
              </span>
              <div>
                <p className="text-sm font-medium text-black dark:text-white">
                  Speak naturally
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Your voice is transcribed in real time
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-black font-mono text-[11px] font-semibold text-white dark:bg-white dark:text-black">
                3
              </span>
              <div>
                <p className="text-sm font-medium text-black dark:text-white">
                  Release to paste
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  Text lands in the focused app automatically
                </p>
              </div>
            </li>
          </ol>
          <button
            type="button"
            onClick={() => onNavigate("dictate")}
            className="mt-5 text-xs text-gray-500 hover:text-black dark:hover:text-white"
          >
            Open Dictate view →
          </button>
        </div>
      </div>
    </div>
  );
}
