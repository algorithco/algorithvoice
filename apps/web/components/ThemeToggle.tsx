"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

// Two-state toggle (dark default). Stroke icons, current color only.
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className="h-9 w-9" aria-hidden />;

  const dark = theme !== "light";
  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="rounded-control p-2 text-gray-500 transition-colors duration-150 ease-app hover:text-black focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--av-focus-ring) dark:hover:text-white"
    >
      {dark ? (
        <Sun size={18} strokeWidth={1.5} />
      ) : (
        <Moon size={18} strokeWidth={1.5} />
      )}
    </button>
  );
}
