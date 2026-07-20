// Soft status pills: tinted background, saturated text, fully round.
const STYLES: Record<string, { label: string; cls: string }> = {
  on_track: {
    label: "On track",
    cls: "bg-positive/10 text-positive",
  },
  overdue: {
    label: "Overdue",
    cls: "bg-warning-bg text-warning",
  },
  demand: {
    label: "Demand",
    cls: "bg-danger-bg text-danger",
  },
  closed: {
    label: "Closed",
    cls: "bg-surface text-muted",
  },
};

export function TierBadge({ tier }: { tier: string }) {
  const s = STYLES[tier] ?? STYLES.on_track;
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
