import { notFound, redirect } from "next/navigation";
import { createClient, getProfile, canPostPayments } from "@/lib/supabase/server";
import { buildDemandLetterBody, type ContractFinancials } from "@/lib/messages";
import { fmtDate, phTodayISO } from "@/lib/format";
import { formatAddress } from "@/lib/maps";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

export default async function DemandLetterPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // This is a formal legal document on company letterhead, and serving one is
  // an owner decision — the SOP treats it as the point of no return. Without
  // this gate any authenticated user, a collector included, could print and
  // serve demands at will. RLS scopes which CONTRACTS you can see; it does not
  // scope which DOCUMENTS you may generate.
  const profile = await getProfile();
  if (!profile || !canPostPayments(profile.role)) redirect("/");

  const supabase = await createClient();

  const { data: c } = await supabase
    .from("v_contract_financials")
    .select("*")
    .eq("id", id)
    .single();

  if (!c) notFound();

  // Always the formal letter, even if printed before the account reaches
  // the demand tier — printing it is an explicit human decision.
  const message = buildDemandLetterBody(
    c as ContractFinancials & { contract_no: string }
  );

  return (
    <div className="text-[13px] leading-relaxed">
      <PrintControls filename={`demand-letter-${c.contract_no}`} />
      <Letterhead />
      <div className="mb-1 text-right text-xs">Date: {fmtDate(phTodayISO())}</div>
      <div className="mb-4 text-xs">Address: {formatAddress(c)}</div>
      <div className="whitespace-pre-wrap">{message}</div>
      <SignatureBlocks />
    </div>
  );
}
