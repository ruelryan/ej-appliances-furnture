import { notFound, redirect } from "next/navigation";
import { createClient, getProfile, canPostPayments } from "@/lib/supabase/server";
import { peso, fmtDate, phTodayISO } from "@/lib/format";
import { termLabel } from "@/lib/amortization";
import { COMPANY } from "@/lib/messages";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

// The document the customer signs to move from the Good-as-Cash price onto the
// 6- or 12-month schedule. This signature is what makes the change lawful: the
// existing contracts contain no repricing clause, and under Art. 1308 a price
// cannot be revised by one party alone — notice does not cure it.
export default async function AmendmentPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const profile = await getProfile();
  if (!profile || !canPostPayments(profile.role)) redirect("/");

  const supabase = await createClient();

  const { data: r } = await supabase
    .from("contract_repricings")
    .select("*")
    .eq("id", id)
    .single();
  if (!r) notFound();

  const { data: c } = await supabase
    .from("v_contract_financials")
    .select("*")
    .eq("id", r.contract_id)
    .single();
  if (!c) notFound();

  const increase = Number(r.to_total) - Number(r.from_total);

  return (
    <div className="text-[13px] leading-relaxed">
      <PrintControls filename={`amendment-${r.amendment_no}`} />
      <Letterhead />
      <h1 className="mb-1 text-center text-base font-semibold">
        AMENDMENT TO INSTALLMENT SALES CONTRACT
      </h1>
      <p className="mb-4 text-center text-xs text-muted">
        Amendment no. {r.amendment_no}
      </p>

      <div className="mb-3 flex justify-between text-xs">
        <span>
          Contract no.: <strong className="font-mono">{c.contract_no}</strong>
        </span>
        <span>Date: {fmtDate(phTodayISO())}</span>
      </div>

      <p className="mb-3">
        This Amendment is entered into between <strong>{COMPANY.name}</strong> (the
        dealer) and <strong>{c.display_name}</strong> (the customer), amending the
        Installment Sales Contract no. {c.contract_no} dated{" "}
        {fmtDate(c.contract_date)} covering{" "}
        <strong>{c.item_description}</strong>.
      </p>

      <div className="mb-2 text-xs font-semibold">WHY THIS AMENDMENT</div>
      <p className="mb-3 text-[11px]">
        The original price was a <strong>Good as Cash</strong> price — a discount
        offered on the condition that the account be settled within the{" "}
        {r.from_term}-month term. That term has elapsed and a balance remains
        outstanding, so the parties agree to place the account on the{" "}
        {r.to_term}-month schedule. All payments already made are credited in
        full.
        {r.reason ? ` Note: ${r.reason}` : ""}
      </p>

      <div className="mb-4 rounded border border-muted p-3">
        <div className="mb-2 text-xs font-semibold">REVISED TERMS</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-1 text-left font-medium">&nbsp;</th>
              <th className="py-1 text-right font-medium">Original</th>
              <th className="py-1 text-right font-medium">Revised</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="py-1 text-muted">Term</td>
              <td className="py-1 text-right">{termLabel(r.from_term)}</td>
              <td className="py-1 text-right font-medium">{termLabel(r.to_term)}</td>
            </tr>
            <tr className="border-b border-line">
              <td className="py-1 text-muted">Total contract price</td>
              <td className="py-1 text-right">{peso(r.from_total)}</td>
              <td className="py-1 text-right font-medium">{peso(r.to_total)}</td>
            </tr>
            <tr className="border-b border-line">
              <td className="py-1 text-muted">Monthly amortization</td>
              <td className="py-1 text-right">{peso(r.from_monthly)}</td>
              <td className="py-1 text-right font-medium">{peso(r.to_monthly)}</td>
            </tr>
            <tr className="border-b border-line">
              <td className="py-1 text-muted">Cash price (unchanged)</td>
              <td className="py-1 text-right">{peso(c.cash_price)}</td>
              <td className="py-1 text-right">{peso(c.cash_price)}</td>
            </tr>
            <tr className="border-b border-line">
              <td className="py-1 text-muted">Downpayment (unchanged)</td>
              <td className="py-1 text-right">{peso(c.downpayment)}</td>
              <td className="py-1 text-right">{peso(c.downpayment)}</td>
            </tr>
            <tr>
              <td className="py-1 font-semibold">Increase in total price</td>
              <td className="py-1"></td>
              <td className="py-1 text-right font-semibold">{peso(increase)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 border-t border-line pt-2 text-[11px]">
          Paid to date: <strong>{peso(c.total_paid)}</strong> · Balance under the
          revised price: <strong>{peso(Number(r.to_total) - Number(c.total_paid))}</strong>
        </p>
      </div>

      <div className="mb-2 text-xs font-semibold">CONDITIONS</div>
      <ol className="mb-4 list-decimal space-y-1.5 pl-5 text-[11px]">
        <li>
          All payments made under the original contract are credited in full
          against the revised total contract price.
        </li>
        <li>
          The cash price and the downpayment are unchanged. Only the term, the
          total contract price and the monthly amortization are revised.
        </li>
        <li>
          <strong>Right to the original price.</strong> The customer may at any
          time settle the balance computed at the <em>original</em> total contract
          price of {peso(r.from_total)}. On doing so this Amendment is cancelled,
          the original price stands, and the increase above is waived in full.
        </li>
        <li>
          All other terms and conditions of the original contract remain in force.
        </li>
        <li>
          This Amendment takes effect only upon signature by both parties below.
        </li>
      </ol>

      <p className="mb-4 text-[11px]">
        The customer confirms that the contents of this Amendment were explained in
        a language they understand, and that they sign it freely and voluntarily.
      </p>

      <SignatureBlocks
        left="Customer — Signature Over Printed Name"
        right={`${COMPANY.name} — Authorized Representative`}
      />
    </div>
  );
}
