import { Logo } from "@algorith-voice/ui";
import Link from "next/link";

// V5 nav: wordmark, links, primary CTA, theme toggle.
const LINKS = [
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/download", label: "Download" },
  { href: "/dashboard", label: "Dashboard" },
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6 md:px-16">
        <Link
          href="/"
          className="flex items-center gap-2"
          aria-label="Algorith Voice home"
        >
          <Logo className="h-4 w-auto text-ink" />
          <span className="text-[15px] leading-6 font-semibold tracking-[-0.01em]">
            Algorith Voice
          </span>
          <span className="hidden text-[13px] leading-6 font-normal text-sub sm:inline">
            by Algorithco
          </span>
        </Link>
        <nav className="flex items-center gap-6" aria-label="Site">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="hidden text-[15px] leading-6 font-medium text-sub transition-colors duration-150 ease-app hover:text-ink sm:inline"
            >
              {l.label}
            </Link>
          ))}
          <Link
            href={"/login" as never}
            className="hidden text-[15px] leading-6 font-medium text-sub hover:text-ink sm:inline"
          >
            Log in
          </Link>
          <Link href="/download" className="btn btn-primary">
            Download
          </Link>
        </nav>
      </div>
    </header>
  );
}
