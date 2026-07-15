"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createContract } from "../actions";
import { searchCustomers } from "./customer-actions";
import { computeTerms, TERM_OPTIONS, termLabel } from "@/lib/amortization";
import { peso, phTodayISO } from "@/lib/format";
import { ITEM_TYPES } from "@/lib/messages";

interface CustomerHit {
  id: string;
  display_name: string;
  phones: string[];
  address: string | null;
  messenger_url: string | null;
}

export function ContractForm() {
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [cashPrice, setCashPrice] = useState("");
  const [termMonths, setTermMonths] = useState(4);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    if (term.trim().length < 2 || customer || newCustomerMode) {
      setHits([]);
      return;
    }
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setHits((await searchCustomers(term)) as CustomerHit[]);
    }, 300);
  }, [term, customer, newCustomerMode]);

  const preview = useMemo(() => {
    const price = Number(cashPrice);
    if (!(price > 0)) return null;
    try {
      return computeTerms(price, termMonths);
    } catch {
      return null;
    }
  }, [cashPrice, termMonths]);

  function submit(fd: FormData) {
    setError("");
    const price = Number(fd.get("cash_price"));
    if (!(price > 0)) return setError("Cash price must be greater than 0.");
    const qty = Number(fd.get("quantity"));
    if (!Number.isInteger(qty) || qty < 1)
      return setError("Quantity must be a whole number of at least 1.");

    const input = {
      customerId: customer?.id,
      newCustomer: newCustomerMode
        ? {
            lastName: String(fd.get("last_name") ?? "").trim(),
            firstName: String(fd.get("first_name") ?? "").trim(),
            phones: String(fd.get("phone") ?? "")
              .split("/")
              .map((s) => s.trim())
              .filter(Boolean),
            address: String(fd.get("address") ?? "").trim(),
            messengerUrl: String(fd.get("messenger_url") ?? "").trim(),
          }
        : undefined,
      contractDate: String(fd.get("contract_date")),
      itemDescription: String(fd.get("item_description") ?? "").trim(),
      itemType: String(fd.get("item_type") ?? ""),
      quantity: qty,
      cashPrice: price,
      termMonths,
      salesAgent: String(fd.get("sales_agent") ?? "").trim(),
      note: String(fd.get("note") ?? "").trim(),
    };

    if (!input.customerId && !newCustomerMode)
      return setError("Select a customer or add a new one.");
    if (!input.itemDescription) return setError("Item description is required.");
    if (!input.salesAgent) return setError("Sales agent is required.");

    startTransition(async () => {
      const res = await createContract(input);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form action={submit} className="space-y-4">
      {/* Customer */}
      <div className="rounded-card border border-surface bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-navy">
            Customer
          </label>
          <button
            type="button"
            onClick={() => {
              setNewCustomerMode(!newCustomerMode);
              setCustomer(null);
              setTerm("");
            }}
            className="text-xs font-medium text-brand hover:underline"
          >
            {newCustomerMode ? "← Search existing" : "+ New customer"}
          </button>
        </div>

        {newCustomerMode ? (
          <div className="grid grid-cols-2 gap-3">
            <input
              name="last_name"
              placeholder="Last name"
              required
              className="rounded-card border border-surface px-3 py-2.5 text-base"
            />
            <input
              name="first_name"
              placeholder="First name"
              required
              className="rounded-card border border-surface px-3 py-2.5 text-base"
            />
            <input
              name="phone"
              placeholder="Phone (09…) — use / for two"
              className="col-span-2 rounded-card border border-surface px-3 py-2.5 text-base"
            />
            <input
              name="address"
              placeholder="Full address"
              required
              className="col-span-2 rounded-card border border-surface px-3 py-2.5 text-base"
            />
            <input
              name="messenger_url"
              placeholder="Facebook/Messenger link (optional)"
              className="col-span-2 rounded-card border border-surface px-3 py-2.5 text-base"
            />
          </div>
        ) : customer ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-navy">
                {customer.display_name}
              </div>
              <div className="text-xs text-muted">
                {(customer.phones ?? []).join(" / ")}
                {customer.address ? ` · ${customer.address}` : ""}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setCustomer(null);
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
              placeholder="Search existing customer…"
              className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
            />
            {hits.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-surface bg-white shadow-lg">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setCustomer(h)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-surface"
                  >
                    <span className="font-semibold">{h.display_name}</span>
                    <span className="ml-1 text-xs text-muted">
                      {(h.phones ?? []).join(" / ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Item */}
      <div className="grid grid-cols-2 gap-3 rounded-card border border-surface bg-white p-4">
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium text-navy">
            Item description
          </label>
          <input
            name="item_description"
            placeholder="e.g. Sharp Refrigerator 6 cu ft"
            required
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Item type
          </label>
          <select
            name="item_type"
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          >
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Quantity
          </label>
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue="1"
            required
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Cash price (₱)
          </label>
          <input
            name="cash_price"
            type="number"
            step="0.01"
            min="0.01"
            required
            inputMode="decimal"
            value={cashPrice}
            onChange={(e) => setCashPrice(e.target.value)}
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Term
          </label>
          <select
            value={termMonths}
            onChange={(e) => setTermMonths(Number(e.target.value))}
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          >
            {TERM_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Contract date
          </label>
          <input
            name="contract_date"
            type="date"
            required
            defaultValue={phTodayISO()}
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-navy">
            Sales agent
          </label>
          <input
            name="sales_agent"
            required
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium text-navy">
            Notes <span className="text-muted">(optional)</span>
          </label>
          <input
            name="note"
            className="w-full rounded-card border border-surface px-3 py-2.5 text-base"
          />
        </div>
      </div>

      {/* Live amortization preview */}
      {preview && (
        <div className="rounded-card border border-surface bg-surface p-4 text-sm">
          <div className="mb-2 font-bold text-navy">
            {termLabel(termMonths)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-brand">Total price</div>
              <div className="font-bold text-navy">
                {peso(preview.totalPrice)}
              </div>
            </div>
            <div>
              <div className="text-xs text-brand">
                Downpayment (25%)
              </div>
              <div className="font-bold text-navy">
                {peso(preview.downpayment)}
              </div>
            </div>
            <div>
              <div className="text-xs text-brand">Monthly</div>
              <div className="font-bold text-navy">
                {peso(preview.monthlyAmortization)}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-card bg-brand py-3 text-base font-bold text-white shadow-[0_2px_8px_rgba(244,77,85,0.3)] hover:bg-brand-dark disabled:opacity-50 disabled:shadow-none"
      >
        {pending ? "Creating…" : "Create Contract"}
      </button>
    </form>
  );
}
