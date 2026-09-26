// Primary usage focal point: a ~116px donut gauge carrying the same
// numbers the KPI card showed (pct / usageLabel / remaining), at a larger
// typographic weight than the secondary stat tiles around it.
export function UsageGauge({
  pct,
  headline,
  subline,
  warning,
}: {
  pct: number;
  headline: string;
  subline: string;
  warning: boolean;
}) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-7">
      <div
        className="relative grid shrink-0 place-items-center"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`Cloud usage ${pct} percent`}
      >
        <svg
          width={132}
          height={132}
          viewBox="0 0 132 132"
          className="size-[116px]"
          role="img"
        >
          <title>{`Cloud usage ${pct}%`}</title>
          <circle
            cx={66}
            cy={66}
            r={R}
            fill="none"
            strokeWidth={12}
            style={{ stroke: "var(--v5-border)" }}
          />
          <circle
            cx={66}
            cy={66}
            r={R}
            fill="none"
            strokeWidth={12}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform="rotate(-90 66 66)"
            className={warning ? "stroke-amber-400" : "stroke-white"}
            style={{ transition: "stroke-dashoffset 500ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="font-mono text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">
              {headline}
            </p>
            <p className="mt-1 font-mono text-[11px] text-faint">used</p>
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <p className="font-mono text-xs font-medium uppercase tracking-wide text-faint">
          Cloud usage
        </p>
        <p className="mt-2 font-mono text-base font-medium leading-6 text-ink">
          {subline}
        </p>
        <p className="mt-1 font-mono text-xs leading-5 text-faint">
          {warning
            ? "Over 80% — Pro unlocks unlimited cloud."
            : "Healthy pace — local mode saves cloud minutes."}
        </p>
      </div>
    </div>
  );
}
