"use client";

import { cn } from "../lib/cn.js";

export interface SidebarItem {
  id: string;
  label: string;
}

// Sidebar: 220px fixed, flat text labels, 40px rows.
// Active = filled background block (gray-900 dark / gray-200 light). No accent bar.
export function Sidebar({
  items,
  active,
  onSelect,
}: {
  items: SidebarItem[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <nav
      className="flex w-[220px] shrink-0 flex-col gap-1 p-3"
      aria-label="Primary"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onSelect(item.id)}
          aria-current={item.id === active ? "page" : undefined}
          className={cn(
            "av-body h-10 rounded-control px-3 text-left transition-colors duration-150 ease-app",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--av-focus-ring)",
            item.id === active
              ? "bg-gray-200 text-black dark:bg-gray-900 dark:text-white"
              : "text-gray-500 hover:text-black dark:hover:text-white",
          )}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
