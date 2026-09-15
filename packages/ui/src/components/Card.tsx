import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

// Cards/panels: 8px radius, 1px border, tone-shift surface. No shadows in-app.
export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-gray-200 bg-near-white text-black",
        "dark:border-gray-800 dark:bg-near-black dark:text-white",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="av-small inline-flex items-center rounded-control border border-gray-200 px-2 py-0.5 dark:border-gray-800">
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="av-body font-semibold">{title}</p>
      {hint ? <p className="av-small mt-1 text-gray-500">{hint}</p> : null}
    </div>
  );
}
