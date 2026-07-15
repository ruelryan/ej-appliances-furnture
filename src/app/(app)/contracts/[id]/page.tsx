import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { computeTerms, TERM_OPTIONS, termLabel } from "@/lib/amortization";
import { buildFollowupMessage, type ContractFinancials } from "@/lib/messages";
import { TierBadge } from "@/components/tier-badge";
import { CopyButton } from "@/components/copy-button";
import { NoteForm } from "./note-form";
import { StatusForm } from "./status-form";
import { ContractNavBar } from "./nav-bar";

export const dynamic = "force-dynamic";

interface NavRow {
  id: string;
  display_name: string;
  contract_no: string;
  last_payment_date: string | null;
  overdue_amount: number;
}

function sortNavRows(rows: NavRow[], sort: string): NavRow[] {
  const byName = (a: NavRow, b: NavRow) =>
    a.display_name.localeCompare(b.display_name) ||
    a.contract_no.localeCompare(b.contract_no);

  if (sort === "lastpaid") {
    // never-paid first, then oldest last-payment first
    return [...rows].sort(
      (a, b) =>
        (a.last_payment_date ?? "").localeCompare(b.last_payment_date ?? "") ||
        byName(a, b)
    );
  }
  if (sort === "overdue") {
    return [...rows].sort(
      (a, b) => b.overdue_amount - a.overdue_amount || byName(a, b)
    );
  }
  return [...rows].sort(byName);
}

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ nav?: string }>;
}) {
  const { id } = await params;
  const { nav } = await searchParams;
  const sort = ["name", "lastpaid", "overdue"].includes(nav ?? "")
    ? (nav as string)
    : "name";
  const supabase = await createClient();
  const profile = await getProfile();
  const isOwner = profile?.role === "owner";

  const { data: c } = await supabase
    .from("v_contract_financials")
    .select("*")
    .eq("id", id)
    .single();

  if (!c) notFound();

  const [{ data: payments }, { data: notes }, { data: navRows }] =
    await Promise.all([
      supabase
        .from("payments")
        .select("*")
        .eq("contract_id", id)
        .order("payment_date", { ascending: true }),
      supabase
        .from("contract_notes")
        .select("*")
        .eq("contract_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("v_contract_financials")
        .select("id, display_name, contract_no, last_payment_date, overdue_amount")
        .eq("payment_status", "open")
        .limit(1000),
    ]);

  const message = buildFollowupMessage(c as ContractFinancials);

  // prev/next through open contracts in the chosen order
  const ordered = sortNavRows((navRows ?? []) as NavRow[], sort);
  const navIndex = ordered.findIndex((r) => r.id === c.id);
  const prevId = navIndex > 0 ? ordered[navIndex - 1].id : null;
  const nextId =
    navIndex !== -1 && navIndex < ordered.length - 1
      ? ordered[navIndex + 1].id
      : navIndex === -1 && ordered.length > 0
        ? ordered[0].id // current contract is closed — ▶ jumps into the open list
        : null;

  // amortization schedule: downpayment first, then the monthlies
  const schedule: number[] = [
    Number(c.downpayment),
    ...Array.from({ length: c.term_months }, () => Number(c.monthly_amortization)),
  ];
  const activePayments = (payments ?? []).filter((p) => !p.voided_at);
  const scheduleRows = Math.max(activePayments.length, schedule.length);

  const infoRows: Array<[string, React.ReactNode]> = [
    ["Contract no.", <span key="cn" className="font-mono">{c.contract_no}</span>],
    ["Date", fmtDateShort(c.contract_date)],
    ["Item", `${c.item_description}${c.quantity > 1 ? ` ×${c.quantity}` : ""}`],
    ["Item type", c.item_type ?? "—"],
    ["Sales agent", c.sales_agent ?? "—"],
    ["Contact", (c.phones ?? []).join(" / ") || "—"],
    ["Address", c.address ?? "—"],
  ];

  const moneyRows: Array<[string, string, boolean?]> = [
    ["Cash price", peso(c.cash_price)],
    ["Term", `${termLabel(c.term_months)}`],
    ["Total price", peso(c.total_price)],
    ["Downpayment (25%)", peso(c.downpayment)],
    ["Monthly", peso(c.monthly_amortization)],
    ["Months elapsed", String(c.months_elapsed)],
    ["Total paid", peso(c.total_paid)],
    ["Expected by now", peso(c.expected_to_date)],
    ["Past due", peso(c.overdue_amount), Number(c.overdue_amount) > 0],
    ["Remaining balance", peso(c.remaining_balance)],
  ];

  return (
    <div className="space-y-5">
      <ContractNavBar
        prevId={prevId}
        nextId={nextId}
        sort={sort}
        position={navIndex === -1 ? null : navIndex + 1}
        total={ordered.length}
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            <Link
              href={`/customers/${c.customer_id}`}
              className="hover:underline"
            >
              {c.display_name}
            </Link>
          </h1>
          <div className="mt-1 flex items-center gap-2">
            <TierBadge tier={c.followup_tier} />
            <span className="text-xs text-slate-500">
              {c.payment_status === "open" ? "Open" : "Closed"} ·{" "}
              {c.delivery_status}
              {c.collection_status ? ` · ${c.collection_status}` : ""}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/payments/new?contract=${c.id}`}
            className="rounded-lg bg-sky-800 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700"
          >
            💵 Payment
          </Link>
          {isOwner && (
            <Link
              href={`/contracts/${c.id}/edit`}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Contract info */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
            Contract
          </h2>
          <dl className="space-y-1.5 text-sm">
            {infoRows.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="shrink-0 text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="text-right text-slate-900 dark:text-slate-100">{v}</dd>
              </div>
            ))}
            {c.messenger_url && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Messenger</dt>
                <dd>
                  <a
                    href={c.messenger_url}
                    target="_blank"
                    className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    💬 Open chat
                  </a>
                </dd>
              </div>
            )}
            {c.gps_url && (
              <div className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">Location</dt>
                <dd>
                  <a
                    href={c.gps_url}
                    target="_blank"
                    className="font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    📍 Open map
                  </a>
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* Money */}
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
            Account
          </h2>
          <dl className="space-y-1.5 text-sm">
            {moneyRows.map(([k, v, alert]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-slate-500 dark:text-slate-400">{k}</dt>
                <dd
                  className={`text-right font-medium ${
                    alert
                      ? "font-bold text-red-600 dark:text-red-400"
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                >
                  {v}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* Term comparison — the contract's term highlighted, others what-if */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-1 text-sm font-bold text-slate-700 dark:text-slate-300">
          Terms
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          Grayed rows show what this contract would look like on the other
          terms — useful when renegotiating.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="py-1.5 pr-3">Term</th>
                <th className="py-1.5 pr-3 text-right">Price</th>
                <th className="py-1.5 pr-3 text-right">Monthly</th>
                <th className="py-1.5 pr-3 text-right">Balance</th>
                <th className="py-1.5 text-right">Balance to Date</th>
              </tr>
            </thead>
            <tbody>
              {TERM_OPTIONS.map((t) => {
                const terms = computeTerms(Number(c.cash_price), t);
                const cappedMonths = Math.min(c.months_elapsed, t);
                const balance = terms.totalPrice - Number(c.total_paid);
                const balanceToDate =
                  terms.downpayment +
                  terms.monthlyAmortization * cappedMonths -
                  Number(c.total_paid);
                const active = t === c.term_months;
                return (
                  <tr
                    key={t}
                    className={`border-b border-slate-100 dark:border-slate-800 ${
                      active
                        ? "font-bold text-emerald-700 dark:text-emerald-400"
                        : "text-slate-400 dark:text-slate-500"
                    }`}
                  >
                    <td className="py-1.5 pr-3">{termLabel(t)}</td>
                    <td className="py-1.5 pr-3 text-right">{peso(terms.totalPrice)}</td>
                    <td className="py-1.5 pr-3 text-right">
                      {peso(terms.monthlyAmortization)}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{peso(balance)}</td>
                    <td className="py-1.5 text-right">
                      {balanceToDate < 0
                        ? `(${peso(Math.abs(balanceToDate)).slice(1)})`
                        : peso(balanceToDate)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Status update (staff-allowed) */}
      <StatusForm
        contractId={c.id}
        collectionStatus={c.collection_status}
        deliveryStatus={c.delivery_status}
      />

      {/* Payment history */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
          Payments ({(payments ?? []).filter((p) => !p.voided_at).length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-700">
                <th className="py-1.5 pr-3">Date</th>
                <th className="py-1.5 pr-3">OR#</th>
                <th className="py-1.5 pr-3 text-right">Amount Paid</th>
                <th className="py-1.5 pr-3">Payment ID</th>
                <th className="py-1.5 pr-3 text-right">Scheduled</th>
                <th className="py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: scheduleRows }, (_, i) => {
                const p = activePayments[i];
                return (
                  <tr
                    key={p?.id ?? `sched-${i}`}
                    className="border-b border-slate-100 dark:border-slate-800"
                  >
                    <td className="py-1.5 pr-3">
                      {p ? fmtDateShort(p.payment_date) : ""}
                    </td>
                    <td className="py-1.5 pr-3">{p ? (p.receipt_no ?? "—") : ""}</td>
                    <td className="py-1.5 pr-3 text-right font-medium">
                      {p ? peso(p.amount) : ""}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs">
                      {p ? p.payment_no : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-right text-slate-400">
                      {schedule[i] !== undefined ? peso(schedule[i]) : ""}
                    </td>
                    <td className="py-1.5 text-right">
                      {p && (
                        <Link
                          href={`/print/receipt/${p.id}`}
                          className="text-xs text-sky-700 hover:underline dark:text-sky-300"
                        >
                          🖨️
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-400">
            Scheduled column: downpayment first, then the monthly amortization —
            compare line by line against what was actually paid.
          </p>
        </div>
        {(payments ?? []).some((p) => p.voided_at) && (
          <div className="mt-3 border-t border-slate-200 pt-2 dark:border-slate-700">
            <div className="mb-1 text-xs font-semibold text-slate-500">Voided</div>
            {(payments ?? [])
              .filter((p) => p.voided_at)
              .map((p) => (
                <div
                  key={p.id}
                  className="text-xs text-slate-400 line-through"
                >
                  {fmtDateShort(p.payment_date)} · {p.payment_no} · {peso(p.amount)}
                  {p.void_reason ? ` — ${p.void_reason}` : ""}
                </div>
              ))}
          </div>
        )}
      </section>

      {/* Follow-up message */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700 dark:text-slate-300">
            Follow-up message
          </h2>
          <div className="flex gap-2">
            <CopyButton text={message} />
            {c.followup_tier === "demand" && (
              <Link
                href={`/print/demand-letter/${c.id}`}
                className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600"
              >
                📄 Demand letter
              </Link>
            )}
          </div>
        </div>
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {message}
        </pre>
      </section>

      {/* Notes */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
          Notes
        </h2>
        <div className="space-y-2">
          {(notes ?? []).map((n) => (
            <div
              key={n.id}
              className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800"
            >
              <div className="mb-1 text-[11px] text-slate-400">
                {new Date(n.created_at).toLocaleString("en-PH", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </div>
              <div className="whitespace-pre-wrap text-slate-700 dark:text-slate-300">
                {n.body}
              </div>
            </div>
          ))}
          {(notes ?? []).length === 0 && (
            <p className="text-sm text-slate-500">No notes yet.</p>
          )}
        </div>
        <NoteForm contractId={c.id} />
      </section>

      {/* Print links */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link
          href={`/print/contract/${c.id}`}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          🖨️ Contract
        </Link>
        <Link
          href={`/print/customer-card/${c.id}`}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          🖨️ Customer card
        </Link>
      </div>
    </div>
  );
}
