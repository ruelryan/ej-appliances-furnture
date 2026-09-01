"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContractSearch } from "./contract-search";

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
        Matches appear as you type, from GET /api/contracts/search — a route
        handler rather than a server action, because an action is a POST and
        middleware refuses every non-GET while "View as" is active.

        The form around it is kept on purpose: pressing Enter with nothing
        highlighted submits and the page renders the same search server-side,
        which is the path with JavaScript off. It costs one element.

        Either way the search covers the WHOLE book. The arrows above walk only
        OPEN contracts, capped at 1000 rows, so a client-side filter over that
        list could not find a closed account or anything past the cap.
      */}
      <form action={`/contracts/${contractId}`} method="get" className="flex gap-2">
        <input type="hidden" name="nav" value={sort} />
        <ContractSearch contractId={contractId} sort={sort} find={find} />
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
