import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

// Exact spec: 1px border, 4px radius, 8px/12px padding, flat surface background.
// Focus: 2px solid text color + focus ring. No colored glow.
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "av-body w-full rounded-control border border-gray-200 bg-white px-3 py-2 text-black",
        "placeholder:text-gray-300 transition-colors duration-150 ease-app",
        "focus:border-2 focus:border-black focus:outline-2 focus:outline-offset-2 focus:outline-(--av-focus-ring)",
        "dark:border-gray-800 dark:bg-black dark:text-white",
        "dark:focus:border-white",
        className,
      )}
      {...props}
    />
  );
}
