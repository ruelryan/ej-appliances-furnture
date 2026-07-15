// Pills in the reference app's style: solid color, white text, fully round.
const STYLES: Record<string, { label: string; cls: string }> = {
  on_track: {
    label: "On track",
    cls: "bg-teal text-white",
  },
  overdue: {
    label: "Overdue",
    cls: "bg-[#eda100] text-white",
  },
  demand: {
    label: "Demand",
    cls: "bg-danger text-white",
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
