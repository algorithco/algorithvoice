import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

// Exact spec: 4px radius, Body 14/20, 10px vertical / 16px horizontal padding.
// Primary hover: opacity 0.85 only. Secondary hover: gray-200 / gray-800 fill.
const buttonVariants = cva(
  "av-body inline-flex cursor-pointer items-center justify-center rounded-control transition-opacity duration-150 ease-app disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--av-focus-ring)",
  {
    variants: {
      variant: {
        primary:
          "bg-black text-white hover:opacity-85 dark:bg-white dark:text-black",
        secondary:
          "border border-gray-200 bg-transparent text-black hover:bg-gray-200 dark:border-gray-800 dark:text-white dark:hover:bg-gray-800",
        ghost:
          "bg-transparent text-gray-500 hover:text-black dark:hover:text-white",
      },
      size: {
        sm: "px-3 py-2",
        md: "px-4 py-2.5",
        lg: "px-6 py-3",
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
