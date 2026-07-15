import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { btnSecondary, input } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select("id, display_name, phones, address, contracts(count)")
    .order("display_name")
    .limit(100);

  if (q.trim()) {
    query = query.ilike("display_name", `%${q.trim()}%`);
  }

  const { data: customers } = await query;

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

      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
        {(customers ?? []).map((c) => {
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
        {customers?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            No customers found.
          </p>
        )}
      </div>
    </div>
  );
}
