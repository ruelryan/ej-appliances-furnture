import { ContractForm } from "./contract-form";
import { BackLink } from "@/components/back-link";

export default function NewContractPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
        <BackLink /> New Contract
      </h1>
      <ContractForm />
    </div>
  );
}
