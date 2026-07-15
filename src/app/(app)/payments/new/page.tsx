import { createClient } from "@/lib/supabase/server";
import { PaymentForm } from "./payment-form";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string }>;
}) {
  const { contract } = await searchParams;

  let preselected = null;
  if (contract) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("v_contract_financials")
      .select(
        "id, contract_no, display_name, item_description, remaining_balance, monthly_amortization, payment_status"
      )
      .eq("id", contract)
      .single();
    preselected = data;
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold text-navy">
        Record Payment
      </h1>
      <PaymentForm preselected={preselected} />
    </div>
  );
}
