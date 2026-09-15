import { cn } from "../lib/cn.js";

// Brand mark: 4 sharp vertical bars, current color only.
// Proportions measured from the source artwork — bar heights
// [0.46, 1.0, 0.75, 0.39] of the tallest bar, equal widths/gaps,
// vertically centered, square corners (radius 0, never rounded).
// Static brand use only — the live recording pulse stays on WaveformGlyph.
const BARS = [
  { x: 0, y: 15, h: 26 },
  { x: 20, y: 0, h: 56 },
  { x: 40, y: 7, h: 42 },
  { x: 60, y: 17, h: 22 },
];

export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 72 56"
      role="img"
      aria-label="Algorith Voice logo"
      focusable="false"
      fill="currentColor"
      className={cn("block", className)}
    >
      {BARS.map((b) => (
        <rect key={b.x} x={b.x} y={b.y} width={12} height={b.h} />
      ))}
    </svg>
  );
}
