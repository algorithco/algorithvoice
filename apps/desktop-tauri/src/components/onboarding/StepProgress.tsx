export function StepProgress({
  current,
  total = 3,
}: {
  current: number;
  total?: number;
}) {
  const steps = total === 4 ? [0, 1, 2, 3] : [0, 1, 2];
  const last = steps.length - 1;
  return (
    <ol className="flex items-center gap-0" aria-label="Onboarding progress">
      {steps.map((i) => (
        <li
          key={i}
          className="flex items-center"
          aria-current={i === current ? "step" : undefined}
        >
          <div
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              i === current
                ? "bg-white"
                : i < current
                  ? "bg-white/60"
                  : "bg-white/15"
            }`}
            aria-hidden="true"
          />
          {i < last ? (
            <div
              className={`h-px w-[54px] transition-colors md:w-[72px] ${i < current ? "bg-white/30" : "bg-white/10"}`}
              aria-hidden="true"
            />
          ) : null}
        </li>
      ))}
    </ol>
  );
}
