import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

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
      <h1 className="text-xl font-bold text-navy">
        Customers
      </h1>

      <form className="flex gap-2" action="/customers" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className="w-full rounded-card border border-surface px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark"
        >
          Search
        </button>
      </form>

      <div className="space-y-2">
        {(customers ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/customers/${c.id}`}
            className="flex items-center justify-between rounded-card border border-surface bg-white p-4 hover:border-brand"
          >
            <div className="min-w-0">
              <div className="font-semibold text-navy">
                {c.display_name}
              </div>
              <div className="truncate text-xs text-muted">
                {(c.phones ?? []).join(" / ") || "no phone"}
                {c.address ? ` · ${c.address}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted">
              {(c.contracts as unknown as { count: number }[])?.[0]?.count ?? 0}{" "}
              contract(s)
            </div>
          </Link>
        ))}
        {customers?.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            No customers found.
          </p>
        )}
      </div>
    </div>
  );
}
