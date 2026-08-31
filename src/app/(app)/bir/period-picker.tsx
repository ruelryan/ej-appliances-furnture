"use client";

import { useRouter, usePathname } from "next/navigation";
import { select } from "@/components/ui";

/**
 * Month or quarter, as one list.
 *
 * A GET-style navigation rather than a server action: middleware refuses every
 * non-GET while "View as" is active, and the owner previewing the bookkeeper is
 * exactly the person most likely to be poking at this page.
 */
function options(): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();

  for (let i = 0; i < 24; i++) {
    const d = new Date(Date.UTC(y, m - i, 1));
    const value = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({
      value,
      label: d.toLocaleDateString("en-PH", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  for (let yr = y; yr >= y - 2; yr--) {
    for (let q = 4; q >= 1; q--) {
      out.push({ value: `${yr}-Q${q}`, label: `${yr} Quarter ${q}` });
    }
  }
  return out;
}

export function PeriodPicker({ value }: { value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const list = options();
  const known = list.some((o) => o.value === value);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="bir-period" className="text-sm text-muted">
        Period
      </label>
      <select
        id="bir-period"
        className={`${select} max-w-64`}
        value={known ? value : list[0].value}
        onChange={(e) =>
          router.push(`${pathname}?period=${encodeURIComponent(e.target.value)}`)
        }
      >
        {list.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}
