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
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        Customers
      </h1>

      <form className="flex gap-2" action="/customers" method="get">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search by name…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
        >
          Search
        </button>
      </form>

      <div className="space-y-2">
        {(customers ?? []).map((c) => (
          <Link
            key={c.id}
            href={`/customers/${c.id}`}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 hover:border-sky-400 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-600"
          >
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {c.display_name}
              </div>
              <div className="truncate text-xs text-slate-500">
                {(c.phones ?? []).join(" / ") || "no phone"}
                {c.address ? ` · ${c.address}` : ""}
              </div>
            </div>
            <div className="shrink-0 text-xs text-slate-400">
              {(c.contracts as unknown as { count: number }[])?.[0]?.count ?? 0}{" "}
              contract(s)
            </div>
          </Link>
        ))}
        {customers?.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">
            No customers found.
          </p>
        )}
      </div>
    </div>
  );
}
