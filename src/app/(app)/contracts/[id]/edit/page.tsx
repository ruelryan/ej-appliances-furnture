import { notFound, redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { EditForm } from "./edit-form";
import { BackLink } from "@/components/back-link";

export const dynamic = "force-dynamic";

export default async function EditContractPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  if (profile?.role !== "owner") redirect(`/contracts/${id}`);

  const supabase = await createClient();
  const { data: contract } = await supabase
    .from("contracts")
    .select("*, customers(display_name)")
    .eq("id", id)
    .single();

  if (!contract) notFound();

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-navy">
        <BackLink /> Edit Contract #{contract.contract_no}
      </h1>
      <p className="text-sm text-muted">
        {(contract.customers as unknown as { display_name: string })?.display_name}
        {" — "}every change is recorded in the audit log. Price and term are
        locked after creation; void the contract and create a new one if those
        are wrong.
      </p>
      <EditForm contract={contract} />
    </div>
  );
}
