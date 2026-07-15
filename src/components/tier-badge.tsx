const STYLES: Record<string, { label: string; cls: string }> = {
  on_track: {
    label: "On track",
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  },
  overdue: {
    label: "Overdue",
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  },
  demand: {
    label: "Demand",
    cls: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  },
  closed: {
    label: "Closed",
    cls: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  },
};

export function TierBadge({ tier }: { tier: string }) {
  const s = STYLES[tier] ?? STYLES.on_track;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.cls}`}
    >
      {s.label}
    </span>
  );
}
