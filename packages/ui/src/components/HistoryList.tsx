"use client";

import { Copy } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface HistoryEntry {
  id: string;
  createdAt: string;
  transcript: string;
}

// History: flat rows, 1px dividers (not cards), 48px rows.
// Timestamp Small/gray-500, text Mono truncated 1 line, hover reveals copy action right.
export function HistoryList({
  entries,
  onCopy,
}: {
  entries: HistoryEntry[];
  onCopy: (entry: HistoryEntry) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <ul className="divide-y divide-gray-200 dark:divide-gray-800">
      {entries.map((entry) => (
        <li key={entry.id} className="group flex h-12 items-center gap-4 px-3">
          <span className="av-small w-24 shrink-0 text-gray-500">
            {entry.createdAt}
          </span>
          <span className="av-mono min-w-0 flex-1 truncate">
            {entry.transcript}
          </span>
          <button
            type="button"
            onClick={() => onCopy(entry)}
            aria-label="Copy transcript"
            className={cn(
              "rounded-control p-2 text-gray-500 opacity-0 transition-opacity duration-150 ease-app",
              "hover:text-black focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100",
              "dark:hover:text-white",
              "[@media(hover:none)]:opacity-100",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--av-focus-ring)",
            )}
          >
            <Copy size={16} strokeWidth={1.5} />
          </button>
        </li>
      ))}
    </ul>
  );
}
