"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ── Term repricing (Good-as-Cash lapse) ──────────────────────
// Two steps on purpose. propose_reprice only drafts the amendment; the
// contract's pricing does not move until confirm_reprice records that the
// customer signed it. Eligibility is re-checked in SQL, so these wrappers
// cannot widen the rule.
export async function proposeReprice(
  contractId: string,
  newTerm: number,
  reason: string
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("propose_reprice", {
    p_contract_id: contractId,
    p_new_term: newTerm,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function confirmReprice(repricingId: string, signedDate: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_reprice", {
    p_repricing_id: repricingId,
    p_signed_date: signedDate,
  });
  if (error) return { error: error.message };
  revalidatePath("/contracts");
  return {};
}

export async function revertReprice(contractId: string, reason: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("revert_reprice", {
    p_contract_id: contractId,
    p_reason: reason || null,
  });
  if (error) return { error: error.message };
  revalidatePath(`/contracts/${contractId}`);
  return {};
}

export async function addNote(contractId: string, formData: FormData) {
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("contract_notes").insert({
    contract_id: contractId,
    body,
    created_by: user?.id,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/contracts/${contractId}`);
}

export async function updateStatus(contractId: string, formData: FormData) {
  const collection = String(formData.get("collection_status") ?? "");
  const delivery = String(formData.get("delivery_status") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_contract_status", {
    p_contract_id: contractId,
    p_collection_status: collection || null,
    p_delivery_status: delivery || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/collections");
}

export interface CreateContractInput {
  customerId?: string;
  newCustomer?: {
    lastName: string;
    firstName: string;
    phones: string[];
    province: string;
    municipality: string;
    barangay: string;
    streetPurok: string;
    landmark: string;
    messengerUrl: string;
  };
  contractDate: string;
  itemDescription: string;
  itemType: string;
  quantity: number;
  cashPrice: number;
  termMonths: number;
  saleType?: "installment" | "cash";
  salesAgent: string;
  agentId?: string;
  productId?: string;
  leadId?: string;
  note: string;
}

export async function createContract(input: CreateContractInput) {
  const supabase = await createClient();

  let customerId = input.customerId;

  if (!customerId) {
    const nc = input.newCustomer;
    if (!nc?.lastName || !nc?.firstName) {
      return { error: "Customer name is required (Last name, First name)." };
    }
    // `address` is still written, composed from the structured parts, so every
    // existing reader — print pages, CSV export, the demand letter — keeps
    // working unchanged while the structured columns become the source of truth.
    const composed = [nc.streetPurok, nc.barangay, nc.municipality, nc.province]
      .map((p) => (p ?? "").trim())
      .filter(Boolean)
      .join(", ");

    const { data: cust, error: custErr } = await supabase
      .from("customers")
      .insert({
        last_name: nc.lastName,
        first_name: nc.firstName,
        phones: nc.phones,
        address: composed || null,
        province: nc.province || null,
        municipality: nc.municipality || null,
        barangay: nc.barangay || null,
        street_purok: nc.streetPurok || null,
        landmark: nc.landmark || null,
        messenger_url: nc.messengerUrl || null,
      })
      .select("id")
      .single();
    if (custErr) return { error: custErr.message };
    customerId = cust.id;
  }

  const { data, error } = await supabase.rpc("create_contract", {
    p_customer_id: customerId,
    p_contract_date: input.contractDate,
    p_item_description: input.itemDescription,
    p_item_type: input.itemType || null,
    p_quantity: input.quantity,
    p_cash_price: input.cashPrice,
    p_term_months: input.saleType === "cash" ? 0 : input.termMonths,
    p_sales_agent: input.salesAgent || null,
    p_note: input.note || null,
    p_agent_id: input.agentId || null,
    p_product_id: input.productId || null,
    p_sale_type: input.saleType ?? "installment",
  });

  if (error) return { error: error.message };

  // If this contract came from a lead, mark it converted before redirecting.
  if (input.leadId) {
    await supabase.rpc("mark_lead_converted", {
      p_lead_id: input.leadId,
      p_contract_id: data.id,
    });
    revalidatePath("/leads");
  }

  revalidatePath("/contracts");
  redirect(`/contracts/${data.id}`);
}

// Assign / reassign / clear the sales agent on a contract (owner/admin).
// Keeps the commission row in sync via the set_contract_agent RPC.
export async function setContractAgent(
  contractId: string,
  agentId: string | null
) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_contract_agent", {
    p_contract_id: contractId,
    p_agent_id: agentId,
  });
  if (error) return { error: error.message };
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath("/commissions");
  return {};
}

export async function updateContract(
  contractId: string,
  fields: {
    contract_date: string;
    item_description: string;
    item_type: string | null;
    quantity: number;
    payment_status: string;
    collection_status: string | null;
  }
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contracts")
    .update(fields)
    .eq("id", contractId);

  if (error) return { error: error.message };

  revalidatePath(`/contracts/${contractId}`);
  redirect(`/contracts/${contractId}`);
}
