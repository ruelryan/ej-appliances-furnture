import Link from "next/link";
import { redirect } from "next/navigation";
import { canSeeBir, createClient, getProfile } from "@/lib/supabase/server";
import { peso, phTodayISO } from "@/lib/format";
import { BIR_BRANCHES, BIR_REGISTERED_ADDRESS, resolvePeriod } from "@/lib/bir";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { Alert } from "@/components/alert";
import { EmptyState } from "@/components/empty-state";
import { btnSecondary, pageStack, theadRow, td, tdNum } from "@/components/ui";
import { PeriodPicker } from "./period-picker";
import { latestPeriodWithData } from "./latest-period";

export const dynamic = "force-dynamic";

export default async function BirPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const { period } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!canSeeBir(profile.role)) redirect("/");

  const supabase = await createClient();
  // With no ?period= the landing month is the newest one that HAS records, not
  // the calendar month — which was empty and read as a broken page.
  const autoPeriod = period ? null : await latestPeriodWithData(supabase, "both");
  const range = resolvePeriod(period ?? autoPeriod ?? undefined, phTodayISO());
  const shownPeriod = period ?? autoPeriod ?? range.label;

  // Every query branches on `error` before `data`. A dropped connection here
  // would otherwise render a confident "input tax ₱0.00", and a zero that
  // means "we could not ask" is worse than no number at all.
  const [{ data: rows, error }, { data: salesRows, error: salesErr }] =
    await Promise.all([
      supabase
        .from("bir_expenses")
        .select("category, branch, gross_vat, gross_non_vat, vatable_purchases, vat_input_tax, total")
        .is("voided_at", null)
        .gte("expense_date", range.start)
        .lte("expense_date", range.end)
        .order("expense_date"),
      supabase
        .from("bir_sales_entries")
        .select("branch, gross_snapshot, vatable_sales, vat_output_tax")
        .is("cancelled_at", null)
        .gte("sales_date", range.start)
        .lte("sales_date", range.end)
        .order("sales_date"),
    ]);

  if (error || salesErr) {
    return (
      <div className={pageStack}>
        <Header period={range.label} />
        <Alert tone="danger" title="Could not load the books.">
          {error?.message ?? salesErr?.message}
        </Alert>
      </div>
    );
  }

  const list = rows ?? [];
  const sum = (k: keyof (typeof list)[number]) =>
    list.reduce((t, r) => t + Number(r[k] ?? 0), 0);

  const vatable = sum("vatable_purchases");
  const inputTax = sum("vat_input_tax");
  const nonVat = sum("gross_non_vat");
  const total = sum("total");

  const sales = salesRows ?? [];
  const salesTotal = sales.reduce((t, r) => t + Number(r.gross_snapshot ?? 0), 0);
  const outputTax = sales.reduce((t, r) => t + Number(r.vat_output_tax ?? 0), 0);

  const byCategory = new Map<string, number>();
  for (const r of list) {
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + Number(r.total ?? 0));
  }
  const categories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className={pageStack}>
      <Header period={range.label} />
      <PeriodPicker value={shownPeriod} />
      {autoPeriod && (
        <p className="text-xs text-muted">
          Showing {range.label}, the most recent period with records. Use the
          picker for another month or quarter.
        </p>
      )}


      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Vatable purchases"
          value={peso(vatable)}
          sub="Net of the 12% input tax"
        />
        <StatTile
          label="Input tax"
          value={peso(inputTax)}
          sub="Creditable against output VAT"
          tone="positive"
        />
        <StatTile
          label="Sales booked"
          value={peso(salesTotal)}
          sub={`${sales.length} entr${sales.length === 1 ? "y" : "ies"} · ${peso(outputTax)} output tax`}
          href={`/bir/sales?period=${encodeURIComponent(shownPeriod)}`}
        />
        <StatTile
          label="Total expenses"
          value={peso(total)}
          sub={`${list.length} document${list.length === 1 ? "" : "s"} · ${peso(nonVat)} non-VAT`}
          href={`/bir/expenses?period=${encodeURIComponent(shownPeriod)}`}
        />
      </div>

      <SectionCard
        title="By registration"
        sub="Two registrations on one base TIN, filed separately. Overhead — utilities, salaries — is paid by Appliances."
      >
        <table className="w-full text-sm">
          <thead>
            <tr className={theadRow}>
              <th className={td}>Book</th>
              <th className={td}>TIN</th>
              <th className={tdNum}>Sales booked</th>
              <th className={tdNum}>Output tax</th>
              <th className={tdNum}>Input tax</th>
              <th className={tdNum}>Net VAT</th>
            </tr>
          </thead>
          <tbody>
            {BIR_BRANCHES.map((b) => {
              const mine = list.filter((r) => r.branch === b.value);
              const mySales = sales.filter((r) => r.branch === b.value);
              const i = mine.reduce((a, r) => a + Number(r.vat_input_tax ?? 0), 0);
              const s = mySales.reduce((a, r) => a + Number(r.gross_snapshot ?? 0), 0);
              const o = mySales.reduce((a, r) => a + Number(r.vat_output_tax ?? 0), 0);
              const net = o - i;
              return (
                <tr key={b.value} className="border-b border-line last:border-0">
                  <td className={td}>
                    {b.label}
                    <span className="block text-micro text-muted">
                      {b.registeredName}
                    </span>
                  </td>
                  <td className={`${td} font-mono text-xs`}>{b.tin}</td>
                  <td className={tdNum}>
                    <Link
                      href={`/bir/sales?period=${encodeURIComponent(shownPeriod)}&branch=${b.value}`}
                      className="hover:underline"
                    >
                      {peso(s)}
                    </Link>
                  </td>
                  <td className={tdNum}>{peso(o)}</td>
                  <td className={tdNum}>
                    <Link
                      href={`/bir/expenses?period=${encodeURIComponent(shownPeriod)}&branch=${b.value}`}
                      className="hover:underline"
                    >
                      {peso(i)}
                    </Link>
                  </td>
                  <td className={`${tdNum} font-semibold`}>{peso(net)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Net VAT is output tax on sales booked in this period less input tax on
          expenses recorded in it — the shape of a 2550Q line, not the return
          itself. Registered address: {BIR_REGISTERED_ADDRESS}
        </p>
      </SectionCard>

      <SectionCard
        title="By category"
        sub={`${range.start} to ${range.end}`}
        action={
          <Link
            href={`/api/export/bir-expenses?period=${encodeURIComponent(shownPeriod)}`}
            className={btnSecondary}
            prefetch={false}
          >
            Export CSV
          </Link>
        }
      >
        {categories.length === 0 ? (
          <EmptyState
            title="No expenses recorded for this period"
            hint="Add the supplier documents as they come in, then export the month for the bookkeeper."
            action={
              <Link href="/bir/expenses" className={btnSecondary}>
                Go to the purchase journal
              </Link>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className={theadRow}>
                <th className={td}>Category</th>
                <th className={tdNum}>Total</th>
                <th className={tdNum}>Share</th>
              </tr>
            </thead>
            <tbody>
              {categories.map(([name, amount]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className={td}>{name}</td>
                  <td className={tdNum}>{peso(amount)}</td>
                  <td className={tdNum}>
                    {total > 0 ? `${((amount / total) * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SectionCard>
    </div>
  );
}

function Header({ period }: { period: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">BIR books</h1>
        <p className="text-xs text-muted">
          Subsidiary purchase journal — {period}
        </p>
      </div>
      <div className="flex gap-2">
        <Link href="/bir/sales" className={btnSecondary}>
          Sales book
        </Link>
        <Link href="/bir/expenses" className={btnSecondary}>
          Expenses
        </Link>
        <Link href="/bir/suppliers" className={btnSecondary}>
          Suppliers
        </Link>
      </div>
    </div>
  );
}
