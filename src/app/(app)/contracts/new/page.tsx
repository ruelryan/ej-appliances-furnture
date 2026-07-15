import { ContractForm } from "./contract-form";

export default function NewContractPage() {
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        New Contract
      </h1>
      <ContractForm />
    </div>
  );
}
