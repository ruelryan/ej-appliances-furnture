// Thin progress bar + percent: rounded track, brand fill, percent below.
export function PaidProgress({
  paid,
  total,
  className = "",
}: {
  paid: number;
  total: number;
  className?: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  return (
    <div className={className}>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-xs font-semibold text-brand">
        {pct}% paid
      </div>
    </div>
  );
}
