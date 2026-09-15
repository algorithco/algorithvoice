import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "h-10 w-full px-3 text-sm bg-white text-black border border-black/10 rounded-[4px]",
        "placeholder:text-black/40 focus:outline-none focus:border-black/40",
        "dark:bg-black dark:text-white dark:border-white/10 dark:placeholder:text-white/40 dark:focus:border-white/40",
        "transition-colors duration-150",
        className,
      )}
      {...props}
    />
  );
}
