import { WaveformGlyph } from "@algorith-voice/ui";
import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

// Nav: wordmark left, links + CTA right. Single row, no decoration.
const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteNav() {
  return (
    <header className="border-b border-gray-200 dark:border-gray-800">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 md:px-16">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="Algorith Voice home"
        >
          <WaveformGlyph className="text-black dark:text-white" />
          <span className="av-body font-semibold">Algorith Voice</span>
        </Link>
        <nav className="flex items-center gap-6" aria-label="Site">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="av-body hidden text-gray-500 transition-colors duration-150 ease-app hover:text-black sm:inline dark:hover:text-white"
            >
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
          <Link
            href="/download"
            className="av-body rounded-control bg-black px-4 py-2.5 text-white transition-opacity duration-150 ease-app hover:opacity-85 dark:bg-white dark:text-black"
          >
            Download
          </Link>
        </nav>
      </div>
    </header>
  );
}
