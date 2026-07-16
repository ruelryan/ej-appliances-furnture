import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDate } from "@/lib/format";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  const supabase = await createClient();

  const { data: p } = await supabase
    .from("payments")
    .select("*, contracts(contract_no, item_description, customers(display_name, address))")
    .eq("id", paymentId)
    .single();

  if (!p) notFound();

  const contract = p.contracts as unknown as {
    contract_no: string;
    item_description: string;
    customers: { display_name: string; address: string | null };
  };

  const rows: Array<[string, string]> = [
    ["Payment ID", p.payment_no],
    ["Date", fmtDate(p.payment_date)],
    ["Received from", contract.customers.display_name],
    ["Contract no.", contract.contract_no],
    ["Item", contract.item_description],
    ["Receipt type", p.receipt_type ?? "—"],
    ["Receipt no. (OR#)", p.receipt_no ?? "—"],
    ...(p.reference_no ? [["Reference no.", p.reference_no] as [string, string]] : []),
  ];

  return (
    <div className="text-sm">
      <PrintControls filename={`receipt-${p.payment_no}`} />
      <Letterhead />
      <h1 className="mb-4 text-center text-base font-semibold">
        PAYMENT ACKNOWLEDGMENT
      </h1>

      <table className="w-full">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-line">
              <td className="py-1.5 pr-4 text-muted">{k}</td>
              <td className="py-1.5 text-right font-medium">{v}</td>
            </tr>
          ))}
          <tr>
            <td className="py-3 pr-4 font-semibold">Amount paid</td>
            <td className="py-3 text-right text-lg font-semibold">{peso(p.amount)}</td>
          </tr>
        </tbody>
      </table>

      {p.voided_at && (
        <div className="mt-4 border-2 border-danger p-2 text-center font-semibold text-danger">
          VOIDED
        </div>
      )}

      <SignatureBlocks left="Received by" right="Customer signature" />
    </div>
  );
}
