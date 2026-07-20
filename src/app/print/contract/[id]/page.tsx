import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDate } from "@/lib/format";
import { formatAddress } from "@/lib/maps";
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

  const [{ data: c }, { data: orig }] = await Promise.all([
    supabase.from("v_contract_financials").select("*").eq("id", id).single(),
    supabase.from("v_contract_original_terms").select("*").eq("contract_id", id).maybeSingle(),
  ]);

  if (!c) notFound();

  // This page is force-dynamic, so it renders whatever the row says NOW. After a
  // repricing that would print the new figures above the original date and the
  // customer's signature — asserting they agreed to numbers they never saw. The
  // contract always shows what was SIGNED; amendments are noted separately and
  // carry their own signed document.
  const term = orig?.orig_term_months ?? c.term_months;
  const total = orig?.orig_total_price ?? c.total_price;
  const monthly = orig?.orig_monthly_amortization ?? c.monthly_amortization;
  const amended = orig?.was_amended === true;

  // Truth in Lending Act (RA 3765) s.4 requires the amount financed, the finance
  // charge in pesos, and that charge as a simple annual rate, disclosed in
  // writing before the sale.
  const financed = Number(c.cash_price) - Number(c.downpayment);
  const financeCharge = Number(total) - Number(c.cash_price);
  const annualRate =
    financed > 0 && term > 0
      ? (financeCharge / financed) * (12 / term) * 100
      : 0;

  return (
    <div className="text-[13px] leading-relaxed">
      <PrintControls filename={`contract-${c.contract_no}`} />
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
              ["Address", formatAddress(c) || "—"],
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
              <td className="py-0.5 text-right font-medium">{termLabel(term)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-muted">Total contract price</td>
              <td className="py-0.5 text-right font-medium">{peso(total)}</td>
            </tr>
            <tr>
              <td className="py-0.5 text-muted">Downpayment (25%)</td>
              <td className="py-0.5 text-right font-medium">{peso(c.downpayment)}</td>
            </tr>
            <tr>
              <td className="py-0.5 font-semibold">Monthly amortization</td>
              <td className="py-0.5 text-right font-semibold">
                {peso(monthly)} × {term} months
              </td>
            </tr>
          </tbody>
        </table>
        {amended && (
          <p className="mt-2 border-t border-line pt-2 text-[10px]">
            These are the terms as originally signed. This contract was
            subsequently amended — see Amendment{" "}
            <strong>{orig?.first_amendment_no}</strong>
            {orig?.first_amendment_date
              ? ` dated ${fmtDate(orig.first_amendment_date)}`
              : ""}
            , which is a separate signed document.
          </p>
        )}
      </div>

      {term > 0 && (
        <div className="mb-4 rounded border border-muted p-3">
          <div className="mb-2 text-xs font-semibold">
            DISCLOSURE OF FINANCE CHARGE (R.A. 3765)
          </div>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="py-0.5 text-muted">Cash price</td>
                <td className="py-0.5 text-right font-medium">{peso(c.cash_price)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-muted">Less downpayment</td>
                <td className="py-0.5 text-right font-medium">{peso(c.downpayment)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-muted">Amount financed</td>
                <td className="py-0.5 text-right font-medium">{peso(financed)}</td>
              </tr>
              <tr>
                <td className="py-0.5 text-muted">Finance charge</td>
                <td className="py-0.5 text-right font-medium">{peso(financeCharge)}</td>
              </tr>
              <tr>
                <td className="py-0.5 font-semibold">Simple annual rate</td>
                <td className="py-0.5 text-right font-semibold">
                  {annualRate.toFixed(2)}%
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1.5 text-[10px] text-muted">
            No other charges are collected in connection with this sale.
          </p>
        </div>
      )}

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
        {(term === 4 || term === 5) && (
          <li>
            <strong>Good as Cash condition.</strong> The total contract price above
            is a discounted price, offered on the condition that the account is
            fully paid within the {term}-month term. Should the term lapse with a
            balance still outstanding, the discount ceases to apply and the
            standard {6}-month price of{" "}
            <strong>{peso(Number(c.cash_price) * 1.225)}</strong> shall govern,
            with the payments already made credited in full. Should the 6-month
            term likewise lapse with a balance outstanding, the 12-month price of{" "}
            <strong>{peso(Number(c.cash_price) * 1.375)}</strong> shall govern.
            Any such change takes effect only upon a written amendment signed by
            both parties. The customer may at any time settle the balance at the
            original discounted price stated above, and the discount shall then be
            restored in full.
          </li>
        )}
      </ol>

      <SignatureBlocks left="Customer — Signature Over Printed Name" right={`${COMPANY.name} — Authorized Representative`} />
    </div>
  );
}
