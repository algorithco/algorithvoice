import { EmptyState, type HistoryEntry, HistoryList } from "@algorith-voice/ui";
import { useEffect, useState } from "react";
import { clearHistory, deleteHistory, listHistory } from "../lib/history.js";

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      // fallback for secs string
      const secs = Number(iso);
      if (!Number.isNaN(secs)) {
        const d2 = new Date(secs * 1000);
        return d2.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return iso.slice(0, 5);
    }
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(0, 5);
  }
}

export function HistoryView() {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listHistory(100)
      .then((list) => {
        const mapped: HistoryEntry[] = list.map((e) => ({
          id: e.id,
          createdAt: formatTime(e.created_at),
          transcript: e.transcript,
        }));
        setEntries(mapped);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCopy = (entry: HistoryEntry) => {
    void navigator.clipboard?.writeText(entry.transcript).catch(() => {});
    setCopied(entry.id);
    window.setTimeout(() => setCopied(null), 1200);
  };

  const handleDelete = async (id: string) => {
    await deleteHistory(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (loading) {
    return (
      <div className="p-8">
        <h1 className="av-display">History</h1>
        <p className="av-small mt-4 text-gray-500">Loading…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="p-8">
        <h1 className="av-display">History</h1>
        <EmptyState
          title="Nothing dictated yet"
          hint="Hold the hotkey and speak. Your recent transcriptions will appear here."
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="av-display">History</h1>
      <p className="av-body mt-2 text-gray-500">
        Stored only on this device. {entries.length} dictations.
      </p>
      <div className="mt-6 border border-gray-200 dark:border-gray-800">
        <HistoryList entries={entries} onCopy={handleCopy} />
      </div>
      {copied ? (
        <p className="av-small mt-2 text-gray-500">Copied to clipboard.</p>
      ) : null}
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={() => {
            if (entries.length === 0) return;
            const first = entries[0];
            if (first) void handleDelete(first.id);
          }}
          className="av-small text-gray-500 hover:text-black dark:hover:text-white"
        >
          Delete most recent
        </button>
        <span className="text-gray-200 dark:text-gray-800">·</span>
        <button
          type="button"
          onClick={() => {
            void clearHistory().then(() => setEntries([]));
          }}
          className="av-small text-gray-500 hover:text-black dark:hover:text-white"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
