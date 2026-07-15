"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createContract } from "../actions";
import { searchCustomers } from "./customer-actions";
import { computeTerms, TERM_OPTIONS, termLabel } from "@/lib/amortization";
import { peso, phTodayISO } from "@/lib/format";

interface CustomerHit {
  id: string;
  display_name: string;
  phones: string[];
  address: string | null;
  messenger_url: string | null;
}

const ITEM_TYPES = ["Appliances", "Furniture", "Foam/Bed", "Others"];

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
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Customer
          </label>
          <button
            type="button"
            onClick={() => {
              setNewCustomerMode(!newCustomerMode);
              setCustomer(null);
              setTerm("");
            }}
            className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
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
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              name="first_name"
              placeholder="First name"
              required
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              name="phone"
              placeholder="Phone (09…) — use / for two"
              className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              name="address"
              placeholder="Full address"
              required
              className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <input
              name="messenger_url"
              placeholder="Facebook/Messenger link (optional)"
              className="col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
        ) : customer ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                {customer.display_name}
              </div>
              <div className="text-xs text-slate-500">
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
              placeholder="Search existing customer…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            {hits.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                {hits.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setCustomer(h)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-sky-50 dark:hover:bg-slate-700"
                  >
                    <span className="font-semibold">{h.display_name}</span>
                    <span className="ml-1 text-xs text-slate-400">
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
      <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Item description
          </label>
          <input
            name="item_description"
            placeholder="e.g. Sharp Refrigerator 6 cu ft"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Item type
          </label>
          <select
            name="item_type"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Quantity
          </label>
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue="1"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
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
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Term
          </label>
          <select
            value={termMonths}
            onChange={(e) => setTermMonths(Number(e.target.value))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          >
            {TERM_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {termLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Contract date
          </label>
          <input
            name="contract_date"
            type="date"
            required
            defaultValue={phTodayISO()}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Sales agent
          </label>
          <input
            name="sales_agent"
            required
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
        <div className="col-span-2">
          <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">
            Notes <span className="text-slate-400">(optional)</span>
          </label>
          <input
            name="note"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
        </div>
      </div>

      {/* Live amortization preview */}
      {preview && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm dark:border-sky-900 dark:bg-sky-950">
          <div className="mb-2 font-bold text-sky-900 dark:text-sky-200">
            {termLabel(termMonths)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-sky-700 dark:text-sky-400">Total price</div>
              <div className="font-bold text-sky-900 dark:text-sky-100">
                {peso(preview.totalPrice)}
              </div>
            </div>
            <div>
              <div className="text-xs text-sky-700 dark:text-sky-400">
                Downpayment (25%)
              </div>
              <div className="font-bold text-sky-900 dark:text-sky-100">
                {peso(preview.downpayment)}
              </div>
            </div>
            <div>
              <div className="text-xs text-sky-700 dark:text-sky-400">Monthly</div>
              <div className="font-bold text-sky-900 dark:text-sky-100">
                {peso(preview.monthlyAmortization)}
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-emerald-700 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
      >
        {pending ? "Creating…" : "Create Contract"}
      </button>
    </form>
  );
}
