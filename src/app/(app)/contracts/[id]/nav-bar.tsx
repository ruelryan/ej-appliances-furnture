"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { input } from "@/components/ui";

export const NAV_SORTS = [
  { key: "name", label: "A–Z by name" },
  { key: "lastpaid", label: "Longest since payment" },
  { key: "overdue", label: "Most overdue ₱" },
] as const;

export function ContractNavBar({
  contractId,
  prevId,
  nextId,
  sort,
  position,
  total,
  find,
}: {
  contractId: string;
  prevId: string | null;
  nextId: string | null;
  sort: string;
  position: number | null;
  total: number;
  find: string;
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
    <div className="space-y-2 rounded-card border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
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

      {/*
        A plain GET form, not a typeahead calling a server action. Two reasons:
        a server action is a POST, and middleware refuses every non-GET while
        "View as" is active — so a POST search would break for the owner
        previewing another role. And the arrows above only walk OPEN contracts,
        capped at 1000 rows, so a client-side filter over that list could not
        find a closed account or anything past the cap. This searches the whole
        book, server-side, using the same escaped .or() as /contracts.
      */}
      <form action={`/contracts/${contractId}`} method="get" className="flex gap-2">
        <input type="hidden" name="nav" value={sort} />
        <input
          type="search"
          name="find"
          defaultValue={find}
          placeholder="Jump to another contract — name, no., or item…"
          aria-label="Search contracts"
          className={input}
        />
        <button
          type="submit"
          className="shrink-0 rounded-card border border-line bg-white px-4 text-sm font-semibold text-ink hover:bg-surface"
        >
          Search
        </button>
      </form>
    </div>
  );
}
