import { cn } from "../lib/cn.js";

export type OverlayState = "listening" | "transcribing";

// Recording overlay: small, borderless indicator — never a fullscreen takeover.
// 3-bar glyph animates with mic amplitude; on release a single bar spins.
// Vanishes the moment text is injected.
const BARS = [0.45, 1, 0.65];

export function RecordingOverlay({
  state,
  amplitude = 1,
}: {
  state: OverlayState;
  amplitude?: number;
}) {
  return (
    <output className="inline-flex items-center gap-3 bg-black px-4 py-3 text-white dark:bg-white dark:text-black">
      {state === "listening" ? (
        <span className="flex h-4 items-center gap-1" aria-hidden>
          {BARS.map((base, i) => (
            <span
              key={base}
              className="av-pulse w-1 origin-center rounded-full bg-current animate-av-pulse-bar"
              style={{
                height: `${Math.round(16 * Math.min(1, base * amplitude))}px`,
                animationDelay: `${i * 150}ms`,
              }}
            />
          ))}
        </span>
      ) : (
        <span
          aria-hidden
          className="av-spinner block h-4 w-1 rounded-full bg-current animate-av-spin-bar"
        />
      )}
      <span className="av-small">
        {state === "listening" ? "Listening" : "Transcribing"}
      </span>
    </output>
  );
}

export function WaveformGlyph({ className }: { className?: string }) {
  return (
    <span className={cn("flex h-4 items-center gap-1", className)} aria-hidden>
      {BARS.map((h) => (
        <span
          key={h}
          className="w-1 rounded-full bg-current"
          style={{ height: `${Math.round(16 * h)}px` }}
        />
      ))}
    </span>
  );
}
