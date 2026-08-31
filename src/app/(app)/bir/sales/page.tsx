import Link from "next/link";
import { redirect } from "next/navigation";
import {
  canPostPayments,
  canSeeBir,
  createClient,
  getProfile,
} from "@/lib/supabase/server";
import { peso, fmtDateShort, phTodayISO } from "@/lib/format";
import { BIR_BRANCHES, branchInfo, resolvePeriod } from "@/lib/bir";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { Alert } from "@/components/alert";
import { EmptyState } from "@/components/empty-state";
import { btnSecondary, pageStack, theadRow, td, tdNum } from "@/components/ui";
import { PeriodPicker } from "../period-picker";
import { BookSale, CancelBooking, type RegisterRow } from "./book-sale";

export const dynamic = "force-dynamic";

const SELECT =
  "contract_id, contract_no, contract_date, customer_name, customer_address, item_description, item_type, cash_price, total_price, term_months, branch, booked, entry_id, invoice_no, sales_date, gross_snapshot";

export default async function BirSalesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; branch?: string; show?: string }>;
}) {
  const { period, branch, show } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!canSeeBir(profile.role)) redirect("/");

  const canManage = canPostPayments(profile.role); // mirrors can_manage_bir()
  const supabase = await createClient();
  const range = resolvePeriod(period, phTodayISO());
  const scoped = BIR_BRANCHES.some((b) => b.value === branch);
  const today = phTodayISO();

  // ── The bookkeeper sees the book, and only the book ────────
  //
  // What has NOT been declared is internal (Ryan, 2026-08-31): it is the
  // office's working queue, not something the bookkeeper is given. So their
  // page reads bir_sales_entries — the entries actually filed — and never the
  // register, which is every contract booked or not.
  //
  // This is not UI hiding. RLS already enforces it: v_bir_sales_register is
  // security_invoker and joins contracts, which 0039 walls the bookkeeper out
  // of, so the view returns them zero rows no matter what this page asks for.
  // That was in fact a bug — their page showed nothing at all — and reading the
  // entries table fixes it and answers the requirement with one change.
  //
  // It works because every column the book needs was SNAPSHOTTED at booking:
  // customer, address, item, amount. The bookkeeper never needs contracts.
  if (!canManage) {
    let q = supabase
      .from("bir_sales_entries")
      .select(
        "id, sales_date, invoice_no, branch, gross_snapshot, vat_output_tax, customer_name_snapshot, item_snapshot"
      )
      .is("cancelled_at", null)
      .gte("sales_date", range.start)
      .lte("sales_date", range.end)
      .order("sales_date")
      .order("id");
    if (scoped) q = q.eq("branch", branch!);

    const { data, error } = await q;
    if (error) {
      return (
        <div className={pageStack}>
          <Header period={range.label} />
          <Alert tone="danger" title="Could not load the sales book.">
            {error.message}
          </Alert>
        </div>
      );
    }
    const entries = (data ?? []) as {
      id: string; sales_date: string; invoice_no: string; branch: string;
      gross_snapshot: number; vat_output_tax: number;
      customer_name_snapshot: string; item_snapshot: string | null;
    }[];
    const total = entries.reduce((t, r) => t + Number(r.gross_snapshot ?? 0), 0);
    const output = entries.reduce((t, r) => t + Number(r.vat_output_tax ?? 0), 0);

    return (
      <div className={pageStack}>
        <Header period={range.label} />
        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker value={period ?? range.label} />
          <BranchTabs period={period ?? range.label} active={branch ?? "all"} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatTile
            label="Sales in the book"
            value={peso(total)}
            sub={`${entries.length} entr${entries.length === 1 ? "y" : "ies"}`}
          />
          <StatTile label="Output VAT" value={peso(output)} sub="12% of the invoiced amount" />
        </div>

        <SectionCard
          title="In the book"
          sub={`${range.start} to ${range.end}`}
          action={
            <Link
              href={`/api/export/bir-sales?period=${encodeURIComponent(period ?? range.label)}&branch=${branch ?? "all"}`}
              className={btnSecondary}
              prefetch={false}
            >
              Export CSV
            </Link>
          }
        >
          {entries.length === 0 ? (
            <EmptyState
              title="No entries for this period"
              hint="Nothing has been entered in the sales book for these dates."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-150 text-sm">
                <thead>
                  <tr className={theadRow}>
                    <th className={td}>Date</th>
                    <th className={td}>Invoice no.</th>
                    <th className={td}>Customer</th>
                    <th className={td}>Item</th>
                    <th className={td}>Book</th>
                    <th className={tdNum}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className={td}>{fmtDateShort(r.sales_date)}</td>
                      <td className={`${td} font-mono text-xs`}>{r.invoice_no}</td>
                      <td className={td}>{r.customer_name_snapshot}</td>
                      <td className={`${td} text-xs text-muted`}>{r.item_snapshot}</td>
                      <td className={`${td} text-xs`}>{branchInfo(r.branch).label}</td>
                      <td className={tdNum}>{peso(r.gross_snapshot)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold">
                    <td className={td} colSpan={5}>Total</td>
                    <td className={tdNum}>{peso(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </SectionCard>
      </div>
    );
  }

  // ── Owner and admin: the register, including what is not declared ──
  //
  // Two questions, two queries, because they are bounded differently.
  //
  // "What did we DECLARE this period" is bounded by sales_date — the date the
  // entry was written in the book. "What did we SELL this period" is bounded by
  // contract_date. They are not the same set: a sale made in July can be booked
  // in August, which is precisely the drift that makes the gap worth showing.
  let bookedQ = supabase
    .from("v_bir_sales_register")
    .select(SELECT)
    .eq("booked", true)
    .gte("sales_date", range.start)
    .lte("sales_date", range.end)
    .order("sales_date")
    .order("contract_no");

  let soldQ = supabase
    .from("v_bir_sales_register")
    .select(SELECT)
    .gte("contract_date", range.start)
    .lte("contract_date", range.end)
    .order("contract_date")
    .order("contract_no");

  if (scoped) {
    bookedQ = bookedQ.eq("branch", branch!);
    soldQ = soldQ.eq("branch", branch!);
  }

  const [{ data: bookedData, error: bookedErr }, { data: soldData, error: soldErr }] =
    await Promise.all([bookedQ, soldQ]);

  if (bookedErr || soldErr) {
    return (
      <div className={pageStack}>
        <Header period={range.label} />
        <Alert tone="danger" title="Could not load the sales register.">
          {bookedErr?.message ?? soldErr?.message}
        </Alert>
      </div>
    );
  }

  const booked = (bookedData ?? []) as RegisterRow[];
  const sold = (soldData ?? []) as RegisterRow[];
  const unbooked = sold.filter((r) => !r.booked);

  const declared = booked.reduce((t, r) => t + Number(r.gross_snapshot ?? 0), 0);
  const actual = sold.reduce((t, r) => t + Number(r.cash_price ?? 0), 0);
  const notBooked = unbooked.reduce((t, r) => t + Number(r.cash_price ?? 0), 0);
  const outputDeclared = declared - Math.round((declared / 1.12) * 100) / 100;
  const outputIfAll = actual - Math.round((actual / 1.12) * 100) / 100;

  const showAll = show === "all";
  const queue = showAll ? unbooked : unbooked.slice(0, 50);

  return (
    <div className={pageStack}>
      <Header period={range.label} />
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={period ?? range.label} />
        <BranchTabs period={period ?? range.label} active={branch ?? "all"} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Sold this period"
          value={peso(actual)}
          sub={`${sold.length} contract${sold.length === 1 ? "" : "s"}, at cash price`}
        />
        <StatTile
          label="Booked this period"
          value={peso(declared)}
          sub={`${booked.length} entr${booked.length === 1 ? "y" : "ies"} in the book`}
          tone="positive"
        />
        <StatTile
          label="Not yet booked"
          value={peso(notBooked)}
          sub={`${unbooked.length} sale${unbooked.length === 1 ? "" : "s"} from this period`}
          tone={notBooked > 0 ? "alert" : "default"}
        />
        <StatTile
          label="Output VAT booked"
          value={peso(outputDeclared)}
          sub={`${peso(outputIfAll)} if everything were booked`}
        />
      </div>

      {/* The two figures answer different questions and are deliberately not
          netted into one. Booked counts by the date written in the book; sold
          counts by contract date. */}
      <p className="text-xs text-muted">
        Booked counts entries dated in this period. Sold counts contracts dated
        in this period. A sale made in one month and booked in the next appears
        in both columns, in different periods — which is why the two are shown
        side by side rather than subtracted.
      </p>

      <SectionCard
        title="Not yet in the book"
        sub={
          unbooked.length === 0
            ? "Every sale from this period is booked."
            : `${unbooked.length} sale${unbooked.length === 1 ? "" : "s"} dated in this period with no entry`
        }
        action={
          unbooked.length > 50 && !showAll ? (
            <Link
              href={`/bir/sales?period=${encodeURIComponent(period ?? range.label)}&branch=${branch ?? "all"}&show=all`}
              className={btnSecondary}
            >
              Show all {unbooked.length}
            </Link>
          ) : undefined
        }
      >
        {unbooked.length === 0 ? (
          <EmptyState
            title="Nothing outstanding for this period"
            hint="Every contract dated in this period has an entry in the sales book."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={td}>Contract</th>
                  <th className={td}>Date</th>
                  <th className={td}>Customer</th>
                  <th className={td}>Item</th>
                  <th className={td}>Book</th>
                  <th className={tdNum}>Cash price</th>
                  {canManage && <th className={td}></th>}
                </tr>
              </thead>
              <tbody>
                {queue.map((r) => (
                  <tr key={r.contract_id} className="border-b border-line last:border-0">
                    <td className={`${td} font-mono text-xs`}>
                      <Link href={`/contracts/${r.contract_id}`} className="hover:underline">
                        {r.contract_no}
                      </Link>
                    </td>
                    <td className={td}>{fmtDateShort(r.contract_date)}</td>
                    <td className={td}>{r.customer_name}</td>
                    <td className={`${td} text-xs text-muted`}>{r.item_description}</td>
                    <td className={`${td} text-xs`}>{branchInfo(r.branch).label}</td>
                    <td className={tdNum}>{peso(r.cash_price)}</td>
                    {canManage && (
                      <td className={td}>
                        <BookSale row={r} defaultDate={today} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!showAll && unbooked.length > queue.length && (
              <p className="pt-2 text-xs text-muted">
                Showing {queue.length} of {unbooked.length}.
              </p>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="In the book"
        sub={`${booked.length} entr${booked.length === 1 ? "y" : "ies"} dated in this period`}
        action={
          <Link
            href={`/api/export/bir-sales?period=${encodeURIComponent(period ?? range.label)}&branch=${branch ?? "all"}`}
            className={btnSecondary}
            prefetch={false}
          >
            Export CSV
          </Link>
        }
      >
        {booked.length === 0 ? (
          <EmptyState
            title="No entries for this period"
            hint="Book a sale from the list above; it will appear here with its invoice number."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={td}>Date</th>
                  <th className={td}>Invoice no.</th>
                  <th className={td}>Customer</th>
                  <th className={td}>Contract</th>
                  <th className={td}>Book</th>
                  <th className={tdNum}>Amount</th>
                  {canManage && <th className={td}></th>}
                </tr>
              </thead>
              <tbody>
                {booked.map((r) => (
                  <tr key={r.entry_id} className="border-b border-line last:border-0">
                    <td className={td}>{fmtDateShort(r.sales_date!)}</td>
                    <td className={`${td} font-mono text-xs`}>{r.invoice_no}</td>
                    <td className={td}>{r.customer_name}</td>
                    <td className={`${td} font-mono text-xs`}>
                      <Link href={`/contracts/${r.contract_id}`} className="hover:underline">
                        {r.contract_no}
                      </Link>
                    </td>
                    <td className={`${td} text-xs`}>{branchInfo(r.branch).label}</td>
                    <td className={tdNum}>{peso(r.gross_snapshot)}</td>
                    {canManage && (
                      <td className={td}>
                        <CancelBooking row={r} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <td className={td} colSpan={5}>
                    Declared this period
                  </td>
                  <td className={tdNum}>{peso(declared)}</td>
                  {canManage && <td className={td}></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** One tab per registration, plus All. Plain links: a GET keeps working while
 *  "View as" is active, which refuses every non-GET. */
function BranchTabs({ period, active }: { period: string; active: string }) {
  const tabs = [
    { value: "all", label: "All", tin: "" },
    ...BIR_BRANCHES.map((b) => ({ value: b.value, label: b.label, tin: b.tin })),
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          href={`/bir/sales?period=${encodeURIComponent(period)}&branch=${t.value}`}
          title={t.tin}
          className={
            t.value === active
              ? "rounded-card bg-brand px-3 py-1.5 text-xs font-semibold text-white"
              : "rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface"
          }
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function Header({ period }: { period: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">Sales book</h1>
        <p className="text-xs text-muted">Summary list of sales — {period}</p>
      </div>
      <div className="flex gap-2">
        <Link href="/bir" className={btnSecondary}>
          Summary
        </Link>
        <Link href="/bir/expenses" className={btnSecondary}>
          Expenses
        </Link>
      </div>
    </div>
  );
}
