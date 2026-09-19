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
    <div className="flex items-center gap-0">
      {steps.map((i) => (
        <div key={i} className="flex items-center">
          <div
            className={`h-2.5 w-2.5 rounded-full transition-colors ${
              i === current
                ? "bg-white"
                : i < current
                  ? "bg-white/60"
                  : "bg-white/15"
            }`}
          />
          {i < last ? (
            <div
              className={`h-px w-[54px] transition-colors md:w-[72px] ${i < current ? "bg-white/30" : "bg-white/10"}`}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
