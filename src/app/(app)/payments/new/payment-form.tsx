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
      <div className="rounded-card border border-surface bg-white p-4">
        <label className="mb-1 block text-sm font-medium text-navy">
          Contract
        </label>
        {contract ? (
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-semibold text-navy">
                {contract.display_name}
              </div>
              <div className="text-xs text-muted">
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
              className="text-xs text-brand hover:underline"
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
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            />
            {(hits.length > 0 || searching) && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-surface bg-white shadow-lg">
                {searching && (
                  <div className="px-3 py-2 text-xs text-muted">Searching…</div>
                )}
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setContract(h)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
                  >
                    <span className="font-semibold">{h.display_name}</span>{" "}
                    <span className="text-xs text-muted">
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
      <div className="space-y-3 rounded-card border border-surface bg-white p-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-navy">
              Amount (₱)
            </label>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              inputMode="decimal"
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy">
              Date
            </label>
            <input
              name="payment_date"
              type="date"
              required
              defaultValue={phTodayISO()}
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy">
              Receipt type
            </label>
            <select
              name="receipt_type"
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            >
              <option>Collection Receipt</option>
              <option>Official Receipt</option>
              <option>Acknowledgment Receipt</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-navy">
              Receipt no. (OR#)
            </label>
            <input
              name="receipt_no"
              required
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Reference no. <span className="text-muted">(optional, e.g. GCash)</span>
          </label>
          <input
            name="reference_no"
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !contract}
        className="w-full rounded-card bg-brand py-3 text-base font-bold text-white shadow-[0_2px_8px_rgba(244,77,85,0.3)] hover:bg-brand-dark disabled:opacity-50 disabled:shadow-none"
      >
        {pending ? "Recording…" : "Record Payment"}
      </button>
    </form>
  );
}
