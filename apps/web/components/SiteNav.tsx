"use client";

import { Logo } from "@algorith-voice/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import GooeyNav from "./GooeyNav";
import { ShinyButton } from "./ShinyButton";

// V5 nav: wordmark, links, primary CTA — now with scroll-driven floating pill + GooeyNav for nav items (not Download).
const PUBLIC_ITEMS = [
  { href: "/docs", label: "Docs" },
  { href: "/languages", label: "Languages" },
  { href: "/pricing", label: "Pricing" },
] as const;

// Server-known session wins (no flash). Otherwise the nav self-detects via
// GET /api/auth/me on mount — every page renders its own <SiteNav />, so the
// check re-runs on each navigation and never goes stale (login/logout).
export function SiteNav({ signedIn }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const [detected, setDetected] = useState<boolean | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const ticking = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      if (ticking.current) return;
      ticking.current = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        // 56px threshold inside 40–80px range — premium, not twitchy
        const next = y > 56;
        setIsScrolled((prev) => (prev !== next ? next : prev));
        ticking.current = false;
      });
    };
    // Initial check
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  useEffect(() => {
    if (signedIn !== undefined) return;
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => {
        if (!cancelled) setDetected(r.ok);
      })
      .catch(() => {
        if (!cancelled) setDetected(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  const isAuthed = signedIn ?? detected ?? false;
  const NAV_ITEMS = [
    ...PUBLIC_ITEMS,
    isAuthed
      ? { href: "/dashboard", label: "Dashboard" }
      : { href: "/login", label: "Log in" },
  ];
  // Close the mobile menu on route change or Escape.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname is intentionally the only dep — re-runs to close the menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // Desktop keeps the floating pill; mobile uses a compact bar + dropdown.
  const showCompact = isScrolled;

  const activeIndex = (() => {
    const p = pathname ?? "";
    const idx = NAV_ITEMS.findIndex(
      (it) => p === it.href || p.startsWith(it.href),
    );
    return idx >= 0 ? idx : 0;
  })();

  const isActive = (href: string) => {
    const p = pathname ?? "";
    return p === href || (href !== "/" && p.startsWith(href));
  };

  return (
    <header
      className={[
        "sticky top-0 z-40 flex w-full justify-center",
        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
        showCompact ? "py-3" : "py-2",
        "pointer-events-none",
      ].join(" ")}
    >
      <div
        className={[
          "pointer-events-auto relative flex w-full items-center justify-between border bg-canvas/85 backdrop-blur",
          "will-change-transform",
          "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          showCompact
            ? "mx-3 h-[56px] max-w-[960px] rounded-2xl border-line px-3 shadow-[0_4px_24px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.06)] sm:px-4 md:mx-4 md:rounded-[20px] md:px-6"
            : "mx-3 h-16 max-w-[1200px] rounded-xl border-line px-3 shadow-none sm:px-4 md:mx-4 md:px-6 lg:px-8",
        ].join(" ")}
      >
        <Link
          href="/"
          className="flex min-w-0 shrink-0 items-center gap-2"
          aria-label="Algorith Voice home"
          onClick={() => setMenuOpen(false)}
        >
          <Logo className="h-4 w-auto shrink-0 text-ink" />
          <span className="truncate text-[15px] leading-6 font-semibold tracking-[-0.01em]">
            Algorith Voice
          </span>
          <span className="hidden text-[13px] leading-6 font-normal whitespace-nowrap text-sub min-[420px]:inline">
            by Algorithco
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2 md:gap-4">
          <div className="hidden md:block">
            <GooeyNav
              items={[...NAV_ITEMS].map((it) => ({
                href: it.href,
                label: it.label,
              }))}
              initialActiveIndex={activeIndex}
            />
          </div>
          <div className="hidden md:block">
            <ShinyButton href="/download" className="ml-1 shrink-0 md:ml-2">
              Download
            </ShinyButton>
          </div>
          {/* Mobile hamburger — 44px touch target */}
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink md:hidden"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? (
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-5 w-5"
              >
                <title>Close menu</title>
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            ) : (
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="h-5 w-5"
              >
                <title>Open menu</title>
                <line x1="4" x2="20" y1="6" y2="6" />
                <line x1="4" x2="20" y1="12" y2="12" />
                <line x1="4" x2="20" y1="18" y2="18" />
              </svg>
            )}
          </button>
        </div>
        {/* Mobile dropdown panel */}
        {menuOpen ? (
          <nav
            aria-label="Mobile"
            className="absolute inset-x-0 top-full mt-2 rounded-2xl border border-line bg-canvas p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)] md:hidden"
          >
            <ul className="flex flex-col">
              {NAV_ITEMS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href as never}
                    aria-current={isActive(l.href) ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                    className={[
                      "flex min-h-[44px] items-center rounded-xl px-4 text-[15px] font-medium",
                      isActive(l.href) ? "bg-raised text-ink" : "text-sub",
                    ].join(" ")}
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
            <ShinyButton href="/download" className="mt-2 w-full">
              Download
            </ShinyButton>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
