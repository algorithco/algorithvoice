import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

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
        "bg-white text-black border border-black/10 rounded-[6px]",
        "dark:bg-black dark:text-white dark:border-white/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium border border-black/10 rounded-[2px] dark:border-white/10">
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="mt-1 text-sm opacity-60">{hint}</p> : null}
    </div>
  );
}
