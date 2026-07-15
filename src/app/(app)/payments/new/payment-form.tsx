"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPayment, searchContracts } from "../actions";
import { peso, phTodayISO } from "@/lib/format";

interface ContractHit {
  id: string;
  contract_no: string;
  display_name: string;
  item_description: string;
  remaining_balance: number;
  monthly_amortization: number;
  payment_status: string;
}

export function PaymentForm({
  preselected,
}: {
  preselected: ContractHit | null;
}) {
  const router = useRouter();
  const [contract, setContract] = useState<ContractHit | null>(preselected);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ContractHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (!term.trim() || contract) {
      setHits([]);
      return;
    }
    setSearching(true);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await searchContracts(term);
      setHits(res as ContractHit[]);
      setSearching(false);
    }, 300);
  }, [term, contract]);

  function submit(fd: FormData) {
    if (!contract) {
      setError("Select a contract first.");
      return;
    }
    const amount = Number(fd.get("amount"));
    if (!(amount > 0)) {
      setError("Amount must be greater than 0.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await recordPayment({
        contractId: contract.id,
        paymentDate: String(fd.get("payment_date")),
        amount,
        receiptNo: String(fd.get("receipt_no") ?? ""),
        receiptType: String(fd.get("receipt_type") ?? ""),
        referenceNo: String(fd.get("reference_no") ?? ""),
      });
      if ("error" in res && res.error) {
        setError(res.error);
      } else if ("paymentId" in res) {
        router.push(`/print/receipt/${res.paymentId}`);
      }
    });
  }

  return (
    <form action={submit} className="space-y-4">
      {/* Contract picker */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
          Contract
        </label>
        {contract ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {contract.display_name}
              </div>
              <div className="text-xs text-slate-500">
                #{contract.contract_no} · {contract.item_description}
              </div>
              <div className="mt-1 text-xs">
                Balance:{" "}
                <span className="font-semibold">
                  {peso(contract.remaining_balance)}
                </span>{" "}
                · Monthly: {peso(contract.monthly_amortization)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setContract(null);
                setTerm("");
              }}
              className="text-xs text-sky-700 hover:underline dark:text-sky-300"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="relative">
            <input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search name or contract no.…"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {(hits.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {searching && (
                  <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
                )}
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setContract(h)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-700"
                  >
                    <span className="font-semibold">{h.display_name}</span>{" "}
                    <span className="text-xs text-slate-400">
                      #{h.contract_no} · {peso(h.remaining_balance)} bal
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment fields */}
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Amount (₱)
            </label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              inputMode="decimal"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Date
            </label>
            <input
              name="payment_date"
              type="date"
              required
              defaultValue={phTodayISO()}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Receipt type
            </label>
            <select
              name="receipt_type"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            >
              <option>Collection Receipt</option>
              <option>Official Receipt</option>
              <option>Acknowledgment Receipt</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Receipt no. (OR#)
            </label>
            <input
              name="receipt_no"
              required
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Reference no. <span className="text-slate-400">(optional, e.g. GCash)</span>
          </label>
          <input
            name="reference_no"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !contract}
        className="w-full rounded-xl bg-sky-800 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {pending ? "Recording…" : "Record Payment"}
      </button>
    </form>
  );
}
