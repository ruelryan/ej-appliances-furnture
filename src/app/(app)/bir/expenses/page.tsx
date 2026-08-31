import Link from "next/link";
import { redirect } from "next/navigation";
import {
  canPostPayments,
  canSeeBir,
  createClient,
  getProfile,
} from "@/lib/supabase/server";
import { peso, fmtDateShort, phTodayISO } from "@/lib/format";
import {
  BIR_BRANCHES,
  branchInfo,
  resolvePeriod,
  orCannotClaimInputTax,
} from "@/lib/bir";
import { SectionCard } from "@/components/section-card";
import { Alert } from "@/components/alert";
import { EmptyState } from "@/components/empty-state";
import { btnSecondary, pageStack, theadRow, td, tdNum } from "@/components/ui";
import { PeriodPicker } from "../period-picker";
import { latestPeriodWithData } from "../latest-period";
import { ExpenseManager, type ExpenseRow, type SupplierOption } from "./expense-manager";

export const dynamic = "force-dynamic";

export default async function BirExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; category?: string; branch?: string }>;
}) {
  const { period, category, branch } = await searchParams;
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!canSeeBir(profile.role)) redirect("/");

  const canManage = canPostPayments(profile.role); // mirrors can_manage_bir()
  const supabase = await createClient();
  const autoPeriod = period ? null : await latestPeriodWithData(supabase, "expenses");
  const range = resolvePeriod(period ?? autoPeriod ?? undefined, phTodayISO());
  const shownPeriod = period ?? autoPeriod ?? range.label;

  let query = supabase
    .from("bir_expenses")
    .select(
      "id, expense_date, supplier_id, supplier_name_snapshot, doc_type, doc_no, gross_vat, gross_non_vat, vatable_purchases, vat_input_tax, total, category, branch, note, voided_at, void_reason"
    )
    .gte("expense_date", range.start)
    .lte("expense_date", range.end)
    .order("expense_date", { ascending: true })
    .order("id", { ascending: true });

  if (category) query = query.eq("category", category);
  if (branch && branch !== "all") query = query.eq("branch", branch);

  const [{ data: rows, error }, { data: sup, error: supError }] = await Promise.all([
    query,
    supabase
      .from("suppliers")
      .select("id, name, address, tin, vat_registered, bir_name")
      .eq("active", true)
      .order("name"),
  ]);

  if (error || supError) {
    return (
      <div className={pageStack}>
        <Header period={range.label} />
        <Alert tone="danger" title="Could not load the purchase journal.">
          {error?.message ?? supError?.message}
        </Alert>
      </div>
    );
  }

  const list = (rows ?? []) as ExpenseRow[];
  const suppliers = (sup ?? []) as SupplierOption[];
  const live = list.filter((r) => !r.voided_at);

  const totals = live.reduce(
    (t, r) => ({
      vatable: t.vatable + Number(r.vatable_purchases ?? 0),
      input: t.input + Number(r.vat_input_tax ?? 0),
      nonVat: t.nonVat + Number(r.gross_non_vat ?? 0),
      total: t.total + Number(r.total ?? 0),
    }),
    { vatable: 0, input: 0, nonVat: 0, total: 0 }
  );

  // RR 7-2024: an OR issued after 2024-12-31 is a supplementary document and
  // cannot support an input-tax claim. Surface it on the list, not only in the
  // form, because most of these rows will arrive by import later.
  const flagged = live.filter((r) =>
    orCannotClaimInputTax(r.doc_type, r.expense_date, Number(r.gross_vat ?? 0))
  );

  return (
    <div className={pageStack}>
      <Header period={range.label} />
      <div className="flex flex-wrap items-center gap-3">
        <PeriodPicker value={shownPeriod} />
        <BranchTabs period={shownPeriod} active={branch ?? "all"} />
        {canManage && (
          <ExpenseManager
            mode="create"
            suppliers={suppliers}
            defaultDate={range.end > phTodayISO() ? phTodayISO() : range.end}
          />
        )}
      </div>

      {flagged.length > 0 && (
        <Alert tone="warning" title="Input tax claimed on an official receipt">
          {flagged.length} document{flagged.length === 1 ? "" : "s"} in this
          period claim input VAT on an official receipt dated after 31 Dec 2024.
          Since RR 7-2024 an OR is a supplementary document and cannot support
          an input-tax claim — the sales invoice can. Worth checking with your
          bookkeeper before filing.
        </Alert>
      )}

      <SectionCard
        title="Purchase journal"
        sub={`${range.start} to ${range.end} · ${live.length} document${live.length === 1 ? "" : "s"}`}
        action={
          <Link
            href={`/api/export/bir-expenses?period=${encodeURIComponent(shownPeriod)}&branch=${branch ?? "all"}`}
            className={btnSecondary}
            prefetch={false}
          >
            Export CSV
          </Link>
        }
      >
        {list.length === 0 ? (
          <EmptyState
            title="Nothing recorded for this period"
            hint="Add each supplier document as it comes in — date, invoice number, TIN and the amount."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-200 text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={td}>Date</th>
                  <th className={td}>Supplier</th>
                  <th className={td}>Doc no.</th>
                  <th className={tdNum}>Vatable</th>
                  <th className={tdNum}>Input tax</th>
                  <th className={tdNum}>Non-VAT</th>
                  <th className={tdNum}>Total</th>
                  <th className={td}>Category</th>
                  <th className={td}>Book</th>
                  {canManage && <th className={td}></th>}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => (
                  <tr
                    key={r.id}
                    className={`border-b border-line last:border-0 ${r.voided_at ? "opacity-50" : ""}`}
                  >
                    <td className={td}>{fmtDateShort(r.expense_date)}</td>
                    <td className={td}>
                      <span className={r.voided_at ? "line-through" : ""}>
                        {r.supplier_name_snapshot}
                      </span>
                      {r.voided_at && (
                        <span className="ml-2 text-micro text-danger">
                          VOID — {r.void_reason}
                        </span>
                      )}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{r.doc_no ?? "—"}</td>
                    <td className={tdNum}>{peso(r.vatable_purchases)}</td>
                    <td className={tdNum}>{peso(r.vat_input_tax)}</td>
                    <td className={tdNum}>{peso(r.gross_non_vat)}</td>
                    <td className={tdNum}>{peso(r.total)}</td>
                    <td className={`${td} text-xs text-muted`}>{r.category}</td>
                    <td className={`${td} text-xs`}>
                      <span title={branchInfo(r.branch).tin}>
                        {branchInfo(r.branch).label}
                      </span>
                    </td>
                    {canManage && (
                      <td className={td}>
                        {!r.voided_at && (
                          <ExpenseManager
                            mode="edit"
                            row={r}
                            suppliers={suppliers}
                            defaultDate={r.expense_date}
                          />
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line font-semibold">
                  <td className={td} colSpan={3}>
                    Total (excluding voided)
                  </td>
                  <td className={tdNum}>{peso(totals.vatable)}</td>
                  <td className={tdNum}>{peso(totals.input)}</td>
                  <td className={tdNum}>{peso(totals.nonVat)}</td>
                  <td className={tdNum}>{peso(totals.total)}</td>
                  <td className={td} colSpan={canManage ? 3 : 2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

/** One tab per VAT registration, plus All. Plain links, not a client
 *  component: it is a filter, and a GET keeps working while "View as" is
 *  active. */
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
          href={`/bir/expenses?period=${encodeURIComponent(period)}&branch=${t.value}`}
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
        <h1 className="text-xl font-semibold text-ink">Expenses</h1>
        <p className="text-xs text-muted">Subsidiary purchase journal — {period}</p>
      </div>
      <div className="flex gap-2">
        <Link href="/bir" className={btnSecondary}>
          Summary
        </Link>
        <Link href="/bir/suppliers" className={btnSecondary}>
          Suppliers
        </Link>
      </div>
    </div>
  );
}
