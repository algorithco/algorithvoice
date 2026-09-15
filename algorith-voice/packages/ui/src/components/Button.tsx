import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

// Monochrome only: black/white + opacity. No accent colors.
const buttonVariants = cva(
  "inline-flex items-center justify-center font-medium transition-colors duration-150 rounded-[4px] disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        primary:
          "bg-black text-white hover:opacity-85 dark:bg-white dark:text-black",
        secondary:
          "bg-transparent text-black border border-black/10 hover:bg-black/5 dark:text-white dark:border-white/10 dark:hover:bg-white/5",
        ghost:
          "bg-transparent text-black/60 hover:text-black dark:text-white/60 dark:hover:text-white",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
