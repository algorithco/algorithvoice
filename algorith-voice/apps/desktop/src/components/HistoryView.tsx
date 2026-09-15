import { EmptyState, type HistoryEntry, HistoryList } from "@algorith-voice/ui";
import { useState } from "react";

const DEMO: HistoryEntry[] = [
  {
    id: "1",
    createdAt: "09:41",
    transcript: "Refactor the auth middleware to use refresh rotation.",
  },
  {
    id: "2",
    createdAt: "09:12",
    transcript: "Add a database index on usage_records user id.",
  },
  {
    id: "3",
    createdAt: "08:57",
    transcript: "Draft the release notes for version zero point two.",
  },
];

// Local SQLite history lands here in Phase 3. Rows follow the exact spec:
// 48px, 1px dividers, mono truncated text, hover copy action.
export function HistoryView() {
  const [entries] = useState<HistoryEntry[]>(DEMO);
  const [copied, setCopied] = useState<string | null>(null);

  if (entries.length === 0) {
    return (
      <div className="p-8">
        <h1 className="av-display">History</h1>
        <EmptyState
          title="Nothing dictated yet"
          hint="Hold the hotkey and speak."
        />
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="av-display">History</h1>
      <p className="av-body mt-2 text-gray-500">Stored only on this device.</p>
      <div className="mt-6 border border-gray-200 dark:border-gray-800">
        <HistoryList
          entries={entries}
          onCopy={(entry) => {
            void navigator.clipboard
              ?.writeText(entry.transcript)
              .catch(() => {});
            setCopied(entry.id);
            window.setTimeout(() => setCopied(null), 1200);
          }}
        />
      </div>
      {copied ? (
        <p className="av-small mt-2 text-gray-500">Copied to clipboard.</p>
      ) : null}
    </div>
  );
}
