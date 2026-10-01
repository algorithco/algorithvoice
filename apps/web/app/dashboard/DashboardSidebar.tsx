"use client";

import { Logo } from "@algorith-voice/ui";
import Link from "next/link";

import {
  ActivityIcon,
  BillingIcon,
  DevicesIcon,
  DocsIcon,
  DownloadIcon,
  OverviewIcon,
  PricingIcon,
  SettingsIcon,
  UsageIcon,
} from "./icons";
import { SECTION_LINKS, type SectionId } from "./nav";

const SECTION_ICONS = [
  OverviewIcon,
  UsageIcon,
  ActivityIcon,
  DevicesIcon,
  BillingIcon,
] as const;

const RESOURCE_LINKS = [
  { href: "/download", label: "Download desktop", Icon: DownloadIcon },
  { href: "/docs", label: "Docs", Icon: DocsIcon },
  { href: "/pricing#upgrade", label: "Pricing", Icon: PricingIcon },
] as const;

// shadcn-style sidebar on this project's tokens: full labels at ~248px,
// icon-only rail at 64px on desktop (toggle), slide-over drawer below lg.
export function DashboardSidebar({
  active,
  collapsed,
  mobileOpen,
  dateLabel,
  onCloseDrawer,
}: {
  active: SectionId;
  collapsed: boolean;
  mobileOpen: boolean;
  dateLabel: string;
  onCloseDrawer: () => void;
}) {
  const rail = collapsed;
  return (
    <>
      {/* Drawer scrim — mobile/tablet only */}
      <div
        aria-hidden="true"
        onClick={onCloseDrawer}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity duration-200 lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        aria-label="Dashboard sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-line bg-canvas transition-transform duration-200 ease-out lg:static lg:z-auto lg:translate-x-0 lg:transition-[width] lg:duration-200 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } ${rail ? "lg:w-16" : "lg:w-[248px]"}`}
      >
        {/* Brand row — aligns with the 60px header */}
        <div
          className={`flex h-[60px] shrink-0 items-center gap-2.5 border-b border-line px-4 ${
            rail ? "lg:justify-center lg:px-0" : ""
          }`}
        >
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5"
            aria-label="Algorith Voice home"
            onClick={onCloseDrawer}
          >
            <Logo className="h-4 w-auto shrink-0 text-ink" />
            <span
              className={`truncate text-[15px] leading-6 font-semibold tracking-[-0.01em] ${
                rail ? "lg:hidden" : ""
              }`}
            >
              Algorith Voice
            </span>
          </Link>
        </div>

        {/* Nav — comfortable rows, clear active state, grouped */}
        <nav
          aria-label="Dashboard sections"
          className={`min-h-0 flex-1 overflow-y-auto px-3 py-5 ${
            rail ? "lg:px-2.5" : ""
          }`}
        >
          <p
            className={`px-2 font-mono text-xs font-medium uppercase tracking-wide text-faint ${
              rail ? "lg:hidden" : ""
            }`}
          >
            Workspace
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {SECTION_LINKS.map((l, i) => {
              const Icon = SECTION_ICONS[i];
              const isActive = active === l.id;
              return (
                <li key={l.id}>
                  <a
                    href={l.href}
                    title={l.label}
                    aria-current={isActive ? "true" : undefined}
                    onClick={onCloseDrawer}
                    className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                      rail ? "lg:justify-center lg:px-0" : ""
                    } ${
                      isActive
                        ? "bg-raised font-medium text-ink ring-1 ring-line"
                        : "text-sub hover:bg-raised/60 hover:text-ink"
                    }`}
                  >
                    <Icon className="size-5" />
                    <span
                      className={`min-w-0 flex-1 truncate ${
                        rail ? "lg:hidden" : ""
                      }`}
                    >
                      {l.label}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>

          <p
            className={`mt-6 px-2 font-mono text-xs font-medium uppercase tracking-wide text-faint ${
              rail ? "lg:hidden" : ""
            }`}
          >
            Resources
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {RESOURCE_LINKS.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link
                  href={href as never}
                  title={label}
                  onClick={onCloseDrawer}
                  className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-sub transition-colors hover:bg-raised/60 hover:text-ink ${
                    rail ? "lg:justify-center lg:px-0" : ""
                  }`}
                >
                  <Icon className="size-5" />
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      rail ? "lg:hidden" : ""
                    }`}
                  >
                    {label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* Footer — minimal by design: one muted status line + plain
            nav-style links. No colored boxes stacked here. */}
        <div
          className={`shrink-0 border-t border-line px-3 py-4 ${
            rail ? "lg:px-2.5" : ""
          }`}
        >
          <p
            className={`flex min-h-[32px] items-center gap-2 truncate px-2 font-mono text-xs text-faint ${
              rail ? "lg:justify-center lg:px-0" : ""
            }`}
            title={`API healthy · ${dateLabel} · Local models 6 · Offline ready`}
          >
            <span
              className="size-2 shrink-0 rounded-full bg-emerald-500"
              aria-hidden="true"
            />
            <span className={`truncate ${rail ? "lg:hidden" : ""}`}>
              API healthy · {dateLabel}
            </span>
          </p>
          {/* biome-ignore lint/a11y/useValidAnchor: in-page anchor — plain <a> is correct (no-JS fallback, middle-click) */}
          <a
            href="#billing"
            title="Settings"
            onClick={onCloseDrawer}
            className={`mt-1 flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-sub transition-colors hover:bg-raised/60 hover:text-ink ${
              rail ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <SettingsIcon className="size-5" />
            <span
              className={`min-w-0 flex-1 truncate ${rail ? "lg:hidden" : ""}`}
            >
              Settings
            </span>
          </a>
          <Link
            href="/docs"
            title="Docs"
            onClick={onCloseDrawer}
            className={`flex min-h-[40px] items-center gap-3 rounded-xl px-3 py-2 text-sm text-sub transition-colors hover:bg-raised/60 hover:text-ink ${
              rail ? "lg:hidden" : ""
            }`}
          >
            <DocsIcon className="size-5" />
            <span className="min-w-0 flex-1 truncate">Docs</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
