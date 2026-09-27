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
  const [query, setQuery] = useState("");
  const [copyError, setCopyError] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const filtered = entries.filter((entry) =>
    entry.transcript
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

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

  const handleCopy = async (entry: HistoryEntry) => {
    setCopyError(false);
    setCopied(null);
    try {
      await navigator.clipboard.writeText(entry.transcript);
      setCopied(entry.id);
    } catch {
      setCopyError(true);
    }
  };

  const handleDelete = async (id: string) => {
    await deleteHistory(id);
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  if (loading) {
    return (
      <div className="desktop-page">
        <h1 className="av-display">History</h1>
        <p className="av-small mt-4 text-gray-500">Loading…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="desktop-page">
        <h1 className="av-display">History</h1>
        <EmptyState
          title="Nothing dictated yet"
          hint="Hold the hotkey and speak. Your recent transcriptions will appear here."
        />
      </div>
    );
  }

  return (
    <div className="desktop-page">
      <h1 className="av-display">History</h1>
      <p className="av-body mt-2 text-gray-500">
        Stored only on this device. {entries.length} dictations.
      </p>
      <label className="mt-6 block text-sm font-medium">
        Search history
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a word or phrase…"
          className="mt-2 h-11 w-full border border-gray-200 bg-transparent px-4 text-sm dark:border-white/10"
        />
      </label>
      <div className="mt-4 overflow-hidden border border-gray-200 dark:border-white/10">
        {filtered.length ? (
          <HistoryList entries={filtered} onCopy={handleCopy} />
        ) : (
          <EmptyState
            title="No matching dictations"
            hint="Try another word or clear the search."
          />
        )}
      </div>
      <output className="av-small mt-2 block min-h-5 text-gray-500">
        {copyError
          ? "Couldn’t copy. Select the text and copy it manually."
          : copied
            ? "Copied to clipboard."
            : `${filtered.length} shown`}
      </output>
      <div className="mt-6 flex flex-wrap gap-2">
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
        <span className="text-gray-200 dark:text-white/20">·</span>
        <button
          type="button"
          onClick={() => {
            setConfirmClear(true);
          }}
          className="av-small text-gray-500 hover:text-black dark:hover:text-white"
        >
          Clear all
        </button>
      </div>
      {confirmClear ? (
        <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-sm">
            Delete all dictations from this device? This cannot be undone.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmClear(false)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm dark:border-white/10"
            >
              Keep history
            </button>
            <button
              type="button"
              onClick={() => {
                void clearHistory().then(() => {
                  setEntries([]);
                  setConfirmClear(false);
                });
              }}
              className="rounded-lg bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
            >
              Delete all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
