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
        className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600"
      >
        {symbol}
      </Link>
    ) : (
      <span className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-bold text-slate-400 dark:bg-slate-800 dark:text-slate-600">
        {symbol}
      </span>
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      {arrow(prevId, "◀", "Previous open contract")}
      {arrow(nextId, "▶", "Next open contract")}
      <select
        value={sort}
        onChange={(e) =>
          router.replace(`?nav=${e.target.value}`, { scroll: false })
        }
        className="rounded-lg border border-slate-300 px-2 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        aria-label="Browse order"
      >
        {NAV_SORTS.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
      <span className="ml-auto text-xs text-slate-400">
        {position !== null
          ? `${position} of ${total} open`
          : `${total} open contracts`}
      </span>
    </div>
  );
}
