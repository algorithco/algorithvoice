"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CloseIcon, CollapseIcon, ExpandIcon, MenuIcon } from "./icons";
import { sectionLabel } from "./nav";

// Slim sticky header for the content area (shadcn dashboard pattern):
// toggle + breadcrumb left, plan/actions/avatar right. On mobile it shrinks
// to toggle + section name + avatar only.
export function DashboardHeader({
  active,
  collapsed,
  mobileOpen,
  email,
  name,
  planLabel,
  status,
  isPro,
  logoutSlot,
  onToggle,
}: {
  active: string;
  collapsed: boolean;
  mobileOpen: boolean;
  email: string;
  name: string | null;
  planLabel: string;
  status: string;
  isPro: boolean;
  logoutSlot: React.ReactNode;
  onToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const initial = (email.trim()[0] ?? "•").toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className="z-30 flex h-[60px] shrink-0 items-center gap-1.5 border-b border-line bg-canvas/90 px-3 backdrop-blur sm:gap-2 sm:px-4">
      <button
        type="button"
        onClick={onToggle}
        aria-label={
          mobileOpen ? "Close menu" : collapsed ? "Expand sidebar" : "Menu"
        }
        aria-expanded={mobileOpen}
        className="grid size-11 shrink-0 place-items-center rounded-xl text-sub transition-colors hover:bg-raised hover:text-ink"
      >
        {/* Mobile/tablet glyph */}
        <span className="lg:hidden">
          {mobileOpen ? (
            <CloseIcon className="size-5" />
          ) : (
            <MenuIcon className="size-5" />
          )}
        </span>
        {/* Desktop glyph reflects the rail state */}
        <span className="hidden lg:block">
          {collapsed ? (
            <ExpandIcon className="size-5" />
          ) : (
            <CollapseIcon className="size-5" />
          )}
        </span>
      </button>

      {/* Breadcrumb — full on sm+, current section only on mobile */}
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-2 font-mono text-xs"
      >
        <span className="hidden shrink-0 items-center gap-2 text-faint sm:inline-flex">
          <span className="size-1.5 bg-ink" aria-hidden="true" /> Dashboard
        </span>
        <span className="hidden text-line sm:inline" aria-hidden="true">
          /
        </span>
        <span className="truncate font-medium text-sub">
          {sectionLabel(active)}
        </span>
      </nav>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span
          className={`hidden rounded-full border px-2.5 py-1 font-mono text-[11px] font-medium tracking-wide md:inline-flex ${
            isPro
              ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-300"
              : "border-line bg-surface text-faint"
          }`}
        >
          {planLabel} · {status}
        </span>
        <Link
          href="/docs"
          className="hidden min-h-[40px] items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-raised md:inline-flex"
        >
          Docs
        </Link>
        {isPro ? (
          <span className="hidden min-h-[40px] items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 font-mono text-xs font-medium text-emerald-300 md:inline-flex">
            ● Pro active
          </span>
        ) : (
          <Link
            href="/pricing#upgrade"
            className="hidden min-h-[40px] items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-4 text-sm font-medium text-amber-300 hover:bg-amber-500/15 md:inline-flex"
          >
            Upgrade to Pro →
          </Link>
        )}

        {/* User menu — account links + hold-to-confirm logout (no card). */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account menu for ${email}`}
            title={email}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface font-mono text-xs font-semibold text-sub transition-colors hover:bg-raised hover:text-ink"
          >
            {initial}
          </button>
          {menuOpen ? (
            <>
              <button
                type="button"
                aria-hidden="true"
                tabIndex={-1}
                onClick={() => setMenuOpen(false)}
                className="fixed inset-0 z-40 cursor-default"
              />
              <nav
                aria-label="Account"
                className="absolute top-[calc(100%+8px)] right-0 z-50 w-64 rounded-2xl border border-line bg-surface p-2 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
              >
                <div className="min-w-0 px-3 pt-2 pb-3">
                  <p
                    className="truncate text-sm font-semibold text-ink"
                    title={name ?? email}
                  >
                    {name ?? email}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-faint">
                    {name ? `${email} · ` : ""}
                    {planLabel} plan
                  </p>
                </div>
                {/* biome-ignore lint/a11y/useValidAnchor: in-page anchor — plain <a> is correct (no-JS fallback, middle-click) */}
                <a
                  href="#billing"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[40px] items-center rounded-xl px-3 text-sm text-sub transition-colors hover:bg-raised hover:text-ink"
                >
                  Account & billing
                </a>
                <Link
                  href="/docs"
                  onClick={() => setMenuOpen(false)}
                  className="flex min-h-[40px] items-center rounded-xl px-3 text-sm text-sub transition-colors hover:bg-raised hover:text-ink"
                >
                  Docs
                </Link>
                <hr className="mx-3 my-2 border-line" />
                <div className="px-1 pb-1">{logoutSlot}</div>
                <p className="px-3 pt-1 pb-2 text-center font-mono text-[11px] leading-4 text-faint">
                  Hold 1.4s to confirm — red means destructive
                </p>
              </nav>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
