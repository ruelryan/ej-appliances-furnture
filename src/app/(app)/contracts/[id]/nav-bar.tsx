"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export const NAV_SORTS = [
  { key: "name", label: "A–Z by name" },
  { key: "lastpaid", label: "Longest since payment" },
  { key: "overdue", label: "Most overdue ₱" },
] as const;

export function ContractNavBar({
  prevId,
  nextId,
  sort,
  position,
  total,
}: {
  prevId: string | null;
  nextId: string | null;
  sort: string;
  position: number | null;
  total: number;
}) {
  const router = useRouter();

  const arrow = (id: string | null, symbol: string, title: string) =>
    id ? (
      <Link
        href={`/contracts/${id}?nav=${sort}`}
        title={title}
        className="rounded-card border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface"
      >
        {symbol}
      </Link>
    ) : (
      <span className="rounded-card bg-surface px-4 py-2.5 text-sm font-semibold text-muted/60">
        {symbol}
      </span>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-white p-3">
      {arrow(prevId, "◀", "Previous open contract")}
      {arrow(nextId, "▶", "Next open contract")}
      <select
        value={sort}
        onChange={(e) =>
          router.replace(`?nav=${e.target.value}`, { scroll: false })
        }
        className="rounded-card border border-line px-2 py-2.5 text-base"
        aria-label="Browse order"
      >
        {NAV_SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="ml-auto text-xs text-muted">
        {position !== null
          ? `${position} of ${total} open`
          : `${total} open contracts`}
      </span>
    </div>
  );
}
