"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import "./ShinyButton.css";

interface ShinyButtonProps {
  children: ReactNode;
  /** When set, renders a Next.js Link (e.g. navbar Download). Otherwise a <button>. */
  href?: string;
  onClick?: () => void;
  className?: string;
}

export function ShinyButton({
  children,
  href,
  onClick,
  className = "",
}: ShinyButtonProps) {
  const cls = `shiny-cta shiny-cta--nav ${className}`.trim();
  if (href) {
    return (
      <Link href={href as never} className={cls}>
        <span>{children}</span>
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick}>
      <span>{children}</span>
    </button>
  );
}
