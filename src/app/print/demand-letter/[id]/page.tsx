import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { buildFollowupMessage, type ContractFinancials } from "@/lib/messages";
import { fmtDate, phTodayISO } from "@/lib/format";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function DemandLetterPage({
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

  // The demand letter always uses the formal (tier-3) template, even if
  // printed early — printing it is an explicit human decision.
  const message = buildFollowupMessage({
    ...(c as ContractFinancials),
    followup_tier: "demand",
  });

  return (
    <div className="text-[13px] leading-relaxed">
      <PrintControls />
      <Letterhead />
      <div className="mb-1 text-right text-xs">Date: {fmtDate(phTodayISO())}</div>
      <div className="mb-4 text-xs">Address: {c.address ?? ""}</div>
      <div className="whitespace-pre-wrap">{message}</div>
      <SignatureBlocks />
    </div>
  );
}
