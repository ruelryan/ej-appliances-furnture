import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDate, fmtDateShort } from "@/lib/format";
import { formatAddress } from "@/lib/maps";
import { termLabel } from "@/lib/amortization";
import { Letterhead } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function CustomerCardPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: c } = await supabase
    .from("v_contract_financials")
    .select("*")
    .eq("id", id)
    .single();

  if (!c) notFound();

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("contract_id", id)
    .is("voided_at", null)
    .order("payment_date", { ascending: true });

  const left: Array<[string, string]> = [
    ["Name", c.display_name],
    ["Contact", (c.phones ?? []).join(" / ") || "—"],
    ["Address", formatAddress(c) || "—"],
            ["Landmark", c.landmark || "—"],
    ["Sales agent", c.sales_agent ?? "—"],
    ["Item", c.item_description],
  ];
  const right: Array<[string, string]> = [
    ["Contract no.", c.contract_no],
    ["Contract date", fmtDateShort(c.contract_date)],
    ["Term", termLabel(c.term_months)],
    ["Payment status", c.payment_status === "open" ? "Open" : "Closed"],
    ["Months elapsed", String(c.months_elapsed)],
  ];

  return (
    <div className="text-sm">
      <PrintControls filename={`customer-card-${c.contract_no}`} />
      <Letterhead />
      <h1 className="mb-4 text-center text-base font-semibold">CUSTOMER CARD</h1>

      <div className="mb-4 grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
        {[...left, ...right].map(([k, v]) => (
          <div key={k} className="flex justify-between border-b border-line py-1">
            <span className="text-muted">{k}</span>
            <span className="text-right font-medium">{v}</span>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2 rounded border border-line p-2 text-center text-xs">
        <div>
          <div className="text-muted">Total price</div>
          <div className="font-semibold">{peso(c.total_price)}</div>
        </div>
        <div>
          <div className="text-muted">Monthly</div>
          <div className="font-semibold">{peso(c.monthly_amortization)}</div>
        </div>
        <div>
          <div className="text-muted">Total paid</div>
          <div className="font-semibold">{peso(c.total_paid)}</div>
        </div>
        <div>
          <div className="text-muted">Balance</div>
          <div className="font-semibold">{peso(c.remaining_balance)}</div>
        </div>
      </div>

      <h2 className="mb-1 text-xs font-semibold">PAYMENT HISTORY</h2>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-muted text-left">
            <th className="py-1">Date</th>
            <th className="py-1">OR#</th>
            <th className="py-1">Payment ID</th>
            <th className="py-1 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {(payments ?? []).map((p) => (
            <tr key={p.id} className="border-b border-line">
              <td className="py-1">{fmtDateShort(p.payment_date)}</td>
              <td className="py-1">{p.receipt_no ?? "—"}</td>
              <td className="py-1 font-mono">{p.payment_no}</td>
              <td className="py-1 text-right">{peso(p.amount)}</td>
            </tr>
          ))}
          {(payments ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-center text-muted">
                No payments yet
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-4 text-right text-[10px] text-muted">
        Printed {fmtDate(new Date())}
      </div>
    </div>
  );
}
