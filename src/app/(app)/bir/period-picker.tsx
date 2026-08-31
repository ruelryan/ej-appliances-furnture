"use client";

import { useRouter, usePathname } from "next/navigation";
import { select } from "@/components/ui";

/**
 * Month or quarter, chosen explicitly.
 *
 * This was one flat dropdown of 24 months with the quarters appended below,
 * which meant the quarterly view existed but nobody could find it. VAT is filed
 * quarterly (2550Q since TRAIN removed the monthly 2550M), so the quarter is
 * not a secondary view — it is the one that matches a return. The month is what
 * the bookkeeper receives.
 *
 * Navigation is a GET, not a server action: middleware refuses every non-GET
 * while "View as" is active, and the owner previewing the bookkeeper is exactly
 * the person most likely to be looking at this.
 */
function monthOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({
      value: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
      label: d.toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  return out;
}

function quarterOptions(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  const y = now.getUTCFullYear();
  const currentQ = Math.floor(now.getUTCMonth() / 3) + 1;
  const MONTHS = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"];
  for (let yr = y; yr >= y - 4; yr--) {
    for (let q = 4; q >= 1; q--) {
      if (yr === y && q > currentQ) continue;
      out.push({ value: `${yr}-Q${q}`, label: `${yr} Q${q} · ${MONTHS[q - 1]}` });
    }
  }
  return out;
}

const isQuarter = (v: string) => /^\d{4}-Q[1-4]$/.test(v);

export function PeriodPicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();

  const quarterly = isQuarter(value);
  const months = monthOptions();
  const quarters = quarterOptions();
  const list = quarterly ? quarters : months;
  const known = list.some((o) => o.value === value);
  const current = known ? value : list[0].value;

  const go = (period: string) =>
    router.push(`${pathname}?period=${encodeURIComponent(period)}`);

  const tab = (active: boolean) =>
    active
      ? "rounded-card bg-brand px-3 py-2 text-xs font-semibold text-white"
      : "rounded-card border border-line bg-white px-3 py-2 text-xs font-semibold text-ink hover:bg-surface";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          className={tab(!quarterly)}
          aria-pressed={!quarterly}
          // Switching type jumps to the newest period of that type rather than
          // trying to map August onto Q3 — the mapping is ambiguous in the other
          // direction and a wrong guess silently changes which figures you read.
          onClick={() => !quarterly || go(months[0].value)}
        >
          Monthly
        </button>
        <button
          type="button"
          className={tab(quarterly)}
          aria-pressed={quarterly}
          onClick={() => quarterly || go(quarters[0].value)}
        >
          Quarterly
        </button>
      </div>

      <select
        id="bir-period"
        aria-label={quarterly ? "Quarter" : "Month"}
        className={`${select} max-w-56`}
        value={current}
        onChange={(e) => go(e.target.value)}
      >
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {quarterly && (
        <span className="text-xs text-muted">The period a 2550Q covers</span>
      )}
    </div>
  );
}
