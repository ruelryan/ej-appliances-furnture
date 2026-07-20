import { createClient } from "@/lib/supabase/server";
import { ContractForm } from "./contract-form";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

// "Juan Dela Cruz" → { firstName: "Juan Dela", lastName: "Cruz" }
function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: full.trim(), lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

export default async function NewContractPage({
  searchParams,
}: {
  searchParams: Promise<{ leadId?: string }>;
}) {
  const { leadId } = await searchParams;
  const supabase = await createClient();

  const [{ data: agents }, { data: products }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name")
      .eq("role", "sales_agent")
      .eq("active", true)
      .order("full_name"),
    supabase
      .from("products")
      .select("id, name, category, price")
      .eq("active", true)
      .order("name"),
  ]);

  let prefill: React.ComponentProps<typeof ContractForm>["prefill"];
  if (leadId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("status", "new")
      .single();
    if (lead) {
      const { firstName, lastName } = splitName(lead.customer_name ?? "");
      prefill = {
        leadId: lead.id,
        firstName,
        lastName,
        phone: lead.phone ?? "",
        address: lead.address ?? "",
        messengerUrl: lead.messenger_url ?? "",
        itemDescription: lead.item_description ?? "",
        itemType: lead.item_type ?? "",
        cashPrice: lead.estimated_price != null ? String(lead.estimated_price) : "",
        agentId: lead.agent_id ?? "",
      };
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <BackLink /> New Contract
      </h1>
      {prefill && (
        <p className="rounded-card bg-brand/10 px-3 py-2 text-sm text-brand">
          Converting lead — review the pre-filled details before saving.
        </p>
      )}
      <ContractForm agents={agents ?? []} products={products ?? []} prefill={prefill} />
    </div>
  );
}
