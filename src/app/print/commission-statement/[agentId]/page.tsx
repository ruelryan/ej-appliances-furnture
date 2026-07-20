import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function CommissionStatementPage({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  const supabase = await createClient();

  const { data: agent } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", agentId)
    .maybeSingle();

  // RLS: an agent can only read their own rows; owner/admin read all.
  const { data: rows } = await supabase
    .from("v_commissions")
    .select("*")
    .eq("agent_id", agentId)
    .order("created_at", { ascending: false });

  const all = rows ?? [];
  if (!agent && all.length === 0) notFound();

  const earned = all.filter((r) => r.status === "earned");
  const paid = all.filter((r) => r.status === "paid");
  const pending = all.filter((r) => r.status === "pending");
  const total = (list: typeof all) =>
    list.reduce((a, r) => a + Number(r.commission_amount), 0);

  const agentName = agent?.full_name ?? "—";

  const Section = ({
    title,
    list,
    showDate,
  }: {
    title: string;
    list: typeof all;
    showDate?: "dp" | "paid";
  }) => (
    <>
      <tr className="border-b-2 border-ink">
        <td colSpan={3} className="py-1 pt-3 font-semibold">
          {title} — {peso(total(list))}
        </td>
      </tr>
      {list.length === 0 ? (
        <tr className="border-b border-line">
          <td colSpan={3} className="py-1.5 text-muted">
            None
          </td>
        </tr>
      ) : (
        list.map((r) => (
          <tr key={r.id} className="border-b border-line">
            <td className="py-1.5 pr-4">
              #{r.contract_no} · {r.customer_name}
            </td>
            <td className="py-1.5 pr-4 text-muted">
              {showDate === "dp" && r.dp_paid_date
                ? `DP paid ${fmtDateShort(r.dp_paid_date)}`
                : showDate === "paid" && r.paid_at
                  ? `Paid ${fmtDateShort(r.paid_at)}${r.paid_reference ? ` · ${r.paid_reference}` : ""}`
                  : ""}
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {peso(r.commission_amount)}
            </td>
          </tr>
        ))
      )}
    </>
  );

  return (
    <div className="text-sm">
      <PrintControls
        filename={`commission-statement-${agentName.replace(/\W+/g, "-")}`}
      />
      <Letterhead />
      <h1 className="mb-1 text-center text-base font-semibold">
        COMMISSION STATEMENT
      </h1>
      <div className="mb-4 text-center text-xs">
        <span className="font-semibold">{agentName}</span> · Sales agent
      </div>

      <table className="w-full text-xs">
        <tbody>
          <Section title="PAYABLE (earned)" list={earned} showDate="dp" />
          <Section title="ALREADY PAID" list={paid} showDate="paid" />
          <Section title="PENDING (downpayment not complete)" list={pending} />
          <tr>
            <td colSpan={2} className="py-3 font-semibold">
              TOTAL PAYABLE NOW
            </td>
            <td className="py-3 text-right text-lg font-semibold tabular-nums">
              {peso(total(earned))}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[10px] text-muted">
        Commission is 10% of each contract&apos;s cash price, payable once the
        customer has paid the full downpayment.
      </p>

      <SignatureBlocks left={agentName} right="Owner / Manager" />
    </div>
  );
}
