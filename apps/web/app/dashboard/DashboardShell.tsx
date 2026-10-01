"use client";

import { useCallback, useEffect, useState } from "react";

import { DashboardHeader } from "./DashboardHeader";
import { DashboardSidebar } from "./DashboardSidebar";
import { SECTION_LINKS, type SectionId } from "./nav";

// App shell (shadcn dashboard structure on this project's tokens):
// collapsible sidebar + sticky header stay fixed; only <main> scrolls.
// Desktop (lg+): persistent sidebar, full width or icon rail via toggle.
// Below lg: sidebar is a slide-over drawer opened from the header.
export function DashboardShell({
  email,
  name,
  planLabel,
  status,
  isPro,
  dateLabel,
  logoutSlot,
  children,
}: {
  email: string;
  name: string | null;
  planLabel: string;
  status: string;
  isPro: boolean;
  dateLabel: string;
  logoutSlot: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState<SectionId>("overview");

  // Scroll-spy: highlight the section currently in view (single-page
  // anchor nav, so there is no route change to key off).
  useEffect(() => {
    const els = SECTION_LINKS.map((l) => document.getElementById(l.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (!els.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id as SectionId);
        }
      },
      { rootMargin: "-30% 0px -60% 0px", threshold: 0 },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  // One toggle, two behaviors: rail on desktop, drawer below lg.
  const toggleSidebar = useCallback(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((v) => !v);
    } else {
      setMobileOpen(true);
    }
  }, []);

  const closeDrawer = useCallback(() => setMobileOpen(false), []);

  // Escape closes the drawer; a resize to desktop clears its state.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-ink">
      <DashboardSidebar
        active={active}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        dateLabel={dateLabel}
        onCloseDrawer={closeDrawer}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <DashboardHeader
          active={active}
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          email={email}
          name={name}
          planLabel={planLabel}
          status={status}
          isPro={isPro}
          logoutSlot={logoutSlot}
          onToggle={toggleSidebar}
        />
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
