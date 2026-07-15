import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDate } from "@/lib/format";
import { termLabel } from "@/lib/amortization";
import { COMPANY } from "@/lib/messages";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function ContractPrintPage({
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

  return (
    <div className="text-[13px] leading-relaxed">
      <PrintControls />
      <Letterhead />
      <h1 className="mb-4 text-center text-base font-semibold">
        INSTALLMENT SALES CONTRACT
      </h1>

      <div className="mb-3 flex justify-between text-xs">
        <span>
          Contract no.: <strong className="font-mono">{c.contract_no}</strong>
        </span>
        <span>Date: {fmtDate(c.contract_date)}</span>
      </div>

      <table className="mb-4 w-full text-xs">
        <tbody>
          {(
            [
              ["Customer", c.display_name],
              ["Contact number", (c.phones ?? []).join(" / ") || "—"],
              ["Address", c.address ?? "—"],
              ["Item", `${c.item_description}${c.quantity > 1 ? ` ×${c.quantity}` : ""}`],
              ["Item type", c.item_type ?? "—"],
              ["Sales agent", c.sales_agent ?? "—"],
            ] as Array<[string, string]>
          ).map(([k, v]) => (
            <tr key={k} className="border-b border-line">
              <td className="w-1/3 py-1.5 text-muted">{k}</td>
              <td className="py-1.5 font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mb-4 rounded border border-muted p-3">
        <div className="mb-2 text-xs font-semibold">PAYMENT TERMS</div>
        <table className="w-full text-xs">
          <tbody>
            <tr>
              <td className="py-0.5 text-muted">Cash price</td>
              <td className="py-0.5 text-right font-medium">{peso(c.cash_price)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-muted">Term</td>
              <td className="py-0.5 text-right font-medium">{termLabel(c.term_months)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-muted">Total contract price</td>
              <td className="py-0.5 text-right font-medium">{peso(c.total_price)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-muted">Downpayment (25%)</td>
              <td className="py-0.5 text-right font-medium">{peso(c.downpayment)}</td>
            </tr>
            <tr>
              <td className="py-0.5 font-semibold">Monthly amortization</td>
              <td className="py-0.5 text-right font-semibold">
                {peso(c.monthly_amortization)} × {c.term_months} months
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mb-2 text-xs font-semibold">TERMS AND CONDITIONS</div>
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[11px]">
        <li>
          The customer agrees to pay the downpayment upon signing and the
          monthly amortization every month thereafter until the total contract
          price is fully paid.
        </li>
        <li>
          Ownership of the item remains with {COMPANY.name} until the total
          contract price is fully paid.
        </li>
        <li>
          In the event that the customer fails to make payments for a period of
          three (3) consecutive months following the last received payment, the
          dealer is hereby entitled to demand full payment of the outstanding
          balance. Failure to comply with this demand within a reasonable
          timeframe, as determined by the dealer, shall grant the dealer the
          right to repossess the product without further notice. The customer
          shall be responsible for all costs associated with the repossession,
          including but not limited to, transportation, storage, and any legal
          fees incurred by the dealer.
        </li>
        <li>
          Payments may be made in person or via the dealer&apos;s official GCash
          account ({COMPANY.gcashName}, {COMPANY.gcashNumber}). Always request a
          receipt or reference number for every payment.
        </li>
      </ol>

      <SignatureBlocks left="Customer — Signature Over Printed Name" right={`${COMPANY.name} — Authorized Representative`} />
    </div>
  );
}
