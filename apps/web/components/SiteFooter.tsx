import { Logo } from "@algorith-voice/ui";
import Link from "next/link";

// V5 footer: brand + link columns + bottom meta row.
const COLS = [
  {
    title: "Product",
    links: [
      { href: "/download", label: "Download" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/design-system", label: "Design system" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="overflow-hidden border-t border-line">
      <div className="mx-auto max-w-[1200px] px-6 py-16 md:px-16">
        <div className="grid gap-12 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <span className="flex items-center gap-2">
              <Logo className="h-4 w-auto text-ink" />
              <span className="text-[15px] leading-6 font-semibold">
                Algorith Voice
              </span>
            </span>
            <p className="t-body mt-4 max-w-[36ch] text-sub">
              Push-to-talk dictation for people who talk to agents.
            </p>
          </div>
          {COLS.map((c) => (
            <nav key={c.title} aria-label={c.title}>
              <p className="t-cap text-faint">{c.title}</p>
              <ul className="mt-2 flex flex-col">
                {c.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="t-body inline-flex min-h-[44px] items-center text-sub transition-colors duration-150 ease-app hover:text-ink"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 flex border-t border-line pt-6">
          <span className="t-body text-faint">© 2026 Algorithco</span>
        </div>
      </div>
      {/* Oversized watermark signature: cropped at the bottom edge, subtle. */}
      <div aria-hidden className="pointer-events-none relative select-none">
        <p className="-mb-[0.18em] text-center text-[13.5vw] leading-[0.8] font-bold tracking-[-0.03em] whitespace-nowrap text-ink uppercase opacity-[0.06]">
          Algorithco
        </p>
      </div>
    </footer>
  );
}
