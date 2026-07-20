import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { btnSecondary, input } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; letter?: string; page?: string }>;
}) {
  const { q = "", letter = "", page: pageParam = "1" } = await searchParams;
  const supabase = await createClient();

  const term = q.trim();
  const activeLetter =
    !term && LETTERS.includes(letter.toUpperCase()) ? letter.toUpperCase() : "";
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1);

  let query = supabase
    .from("customers")
    .select("id, display_name, phones, address, contracts(count)")
    .order("display_name");

  if (term) {
    query = query.ilike("display_name", `%${term}%`);
  } else if (activeLetter) {
    query = query.ilike("display_name", `${activeLetter}%`);
  }

  // Fetch one extra row to know whether a next page exists.
  const from = (page - 1) * PAGE_SIZE;
  const { data: rows } = await query.range(from, from + PAGE_SIZE);

  const customers = (rows ?? []).slice(0, PAGE_SIZE);
  const hasNext = (rows ?? []).length > PAGE_SIZE;
  const hasPrev = page > 1;

  const pageHref = (p: number) =>
    `/customers?${new URLSearchParams({
      ...(activeLetter ? { letter: activeLetter } : {}),
      ...(p > 1 ? { page: String(p) } : {}),
    }).toString()}`;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">
        Customers
      </h1>

      <form className="flex gap-2" action="/customers" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className={input}
        />
        <button type="submit" className={btnSecondary}>
          Search
        </button>
      </form>

      {/* A–Z phonebook chips */}
      <div className="flex flex-wrap gap-1.5">
        <Link
          href="/customers"
          className={`rounded-full px-3 py-2 text-xs font-semibold ${
            !activeLetter
              ? "bg-brand text-white"
              : "border border-line bg-white text-ink hover:bg-surface"
          }`}
        >
          All
        </Link>
        {LETTERS.map((l) => (
          <Link
            key={l}
            href={`/customers?letter=${l}`}
            className={`rounded-full px-3 py-2 text-xs font-semibold ${
              activeLetter === l
                ? "bg-brand text-white"
                : "border border-line bg-white text-ink hover:bg-surface"
            }`}
          >
            {l}
          </Link>
        ))}
      </div>

      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
        {customers.map((c) => {
          const count =
            (c.contracts as unknown as { count: number }[])?.[0]?.count ?? 0;
          const meta = [
            `${count} contract${count === 1 ? "" : "s"}`,
            (c.phones ?? []).join(" / ") || null,
            c.address || null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Link
              key={c.id}
              href={`/customers/${c.id}`}
              className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-surface"
            >
              <div className="min-w-0">
                <div className="font-display font-semibold text-ink">
                  {c.display_name}
                </div>
                <div className="mt-0.5 truncate text-sm text-muted">{meta}</div>
              </div>
              <span className="shrink-0 text-muted">›</span>
            </Link>
          );
        })}
        {customers.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            No customers found.
          </p>
        )}
      </div>

      {(hasPrev || hasNext) && !term && (
        <div className="flex items-center justify-center gap-3">
          {hasPrev ? (
            <Link href={pageHref(page - 1)} className={btnSecondary}>
              ‹ Prev
            </Link>
          ) : (
            <span className={`${btnSecondary} pointer-events-none opacity-40`}>
              ‹ Prev
            </span>
          )}
          <span className="text-xs text-muted">Page {page}</span>
          {hasNext ? (
            <Link href={pageHref(page + 1)} className={btnSecondary}>
              Next ›
            </Link>
          ) : (
            <span className={`${btnSecondary} pointer-events-none opacity-40`}>
              Next ›
            </span>
          )}
        </div>
      )}
    </div>
  );
}
