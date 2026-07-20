"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createContract } from "../actions";
import { searchCustomers } from "./customer-actions";
import { computeTerms, TERM_OPTIONS, termLabel } from "@/lib/amortization";
import { peso, phTodayISO } from "@/lib/format";
import { ITEM_TYPES } from "@/lib/messages";
import { btnPrimaryHero, input, label } from "@/components/ui";
import { AddressFields, type LocationTree } from "@/components/address-fields";

interface CustomerHit {
  id: string;
  display_name: string;
  phones: string[];
  address: string | null;
  messenger_url: string | null;
}

interface Agent {
  id: string;
  full_name: string;
}

interface Product {
  id: string;
  name: string;
  category: string | null;
  price: number | string | null;
}

interface Prefill {
  leadId: string;
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  messengerUrl: string;
  itemDescription: string;
  itemType: string;
  cashPrice: string;
  agentId: string;
}

export function ContractForm({
  agents,
  products,
  prefill,
  locationTree,
}: {
  agents: Agent[];
  products: Product[];
  prefill?: Prefill;
  locationTree: LocationTree;
}) {
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [newCustomerMode, setNewCustomerMode] = useState(!!prefill);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [cashPrice, setCashPrice] = useState(prefill?.cashPrice ?? "");
  const [productId, setProductId] = useState("");
  const [saleType, setSaleType] = useState<"installment" | "cash">("installment");
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
    if (!(price > 0) || saleType === "cash") return null;
    try {
      return computeTerms(price, termMonths);
    } catch {
      return null;
    }
  }, [cashPrice, termMonths, saleType]);

  function submit(fd: FormData) {
    setError("");
    const price = Number(fd.get("cash_price"));
    if (!(price > 0)) return setError("Cash price must be greater than 0.");
    const qty = Number(fd.get("quantity"));
    if (!Number.isInteger(qty) || qty < 1)
      return setError("Quantity must be a whole number of at least 1.");

    const agentId = String(fd.get("agent_id") ?? "");
    const agentName = agents.find((a) => a.id === agentId)?.full_name ?? "";

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
            province: String(fd.get("province") ?? "").trim(),
            municipality: String(fd.get("municipality") ?? "").trim(),
            barangay: String(fd.get("barangay") ?? "").trim(),
            streetPurok: String(fd.get("street_purok") ?? "").trim(),
            landmark: String(fd.get("landmark") ?? "").trim(),
            messengerUrl: String(fd.get("messenger_url") ?? "").trim(),
          }
        : undefined,
      contractDate: String(fd.get("contract_date")),
      itemDescription: String(fd.get("item_description") ?? "").trim(),
      itemType: String(fd.get("item_type") ?? ""),
      quantity: qty,
      cashPrice: price,
      termMonths,
      saleType,
      salesAgent: agentName,
      agentId: agentId || undefined,
      productId: productId || undefined,
      leadId: prefill?.leadId,
      note: String(fd.get("note") ?? "").trim(),
    };

    if (!input.customerId && !newCustomerMode)
      return setError("Select a customer or add a new one.");
    if (!input.itemDescription) return setError("Item description is required.");

    startTransition(async () => {
      const res = await createContract(input);
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form action={submit} className="space-y-4">
      {/* Customer */}
      <div className="rounded-card border border-line bg-white p-4">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-ink">
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
              defaultValue={prefill?.lastName ?? ""}
              required
              className={input}
            />
            <input
              name="first_name"
              placeholder="First name"
              defaultValue={prefill?.firstName ?? ""}
              required
              className={input}
            />
            <input
              name="phone"
              placeholder="Phone (09…) — use / for two"
              defaultValue={prefill?.phone ?? ""}
              className={`col-span-2 ${input}`}
            />
            {/* Structured from here on. The old single free-text field is what
                left 1,127 addresses needing a parser to make sense of them. */}
            {prefill?.address && (
              <p className="col-span-2 rounded-card bg-surface px-3 py-2 text-xs text-muted">
                Address from the lead: <strong className="text-ink">{prefill.address}</strong>
                {" — "}pick the matching barangay below.
              </p>
            )}
            <AddressFields tree={locationTree} />
            {/* Personal profile only. The collection group chat is created by
                the admin after the contract exists — added on the customer page. */}
            <input
              name="messenger_url"
              placeholder="Customer's personal Facebook/Messenger link (optional)"
              defaultValue={prefill?.messengerUrl ?? ""}
              className={`col-span-2 ${input}`}
            />
          </div>
        ) : customer ? (
          <div className="flex items-start justify-between">
            <div>
              <div className="font-semibold text-ink">
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
              className={input}
            />
            {hits.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-line bg-white shadow-lg">
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
      <div className="grid grid-cols-2 gap-3 rounded-card border border-line bg-white p-4">
        <div className="col-span-2">
          <label className={label}>Sale type</label>
          <div className="grid grid-cols-2 gap-2">
            {(["installment", "cash"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setSaleType(t)}
                className={`rounded-card border px-3 py-2 text-sm font-semibold capitalize ${
                  saleType === t
                    ? "border-brand bg-brand/10 text-brand"
                    : "border-line bg-white text-ink hover:bg-surface"
                }`}
              >
                {t === "cash" ? "Cash sale" : "Installment"}
              </button>
            ))}
          </div>
        </div>
        {products.length > 0 && (
          <div className="col-span-2">
            <label className={label}>
              Product <span className="text-muted">(optional — links stock)</span>
            </label>
            <select
              value={productId}
              onChange={(e) => {
                const id = e.target.value;
                setProductId(id);
                const p = products.find((x) => x.id === id);
                if (p) {
                  const descEl = document.querySelector<HTMLInputElement>('input[name="item_description"]');
                  if (descEl) descEl.value = p.name;
                  const typeEl = document.querySelector<HTMLSelectElement>('select[name="item_type"]');
                  if (typeEl && p.category) typeEl.value = p.category;
                  if (p.price != null) setCashPrice(String(p.price));
                }
              }}
              className={input}
            >
              <option value="">— Not from catalog —</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.category ? ` (${p.category})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="col-span-2">
          <label className={label}>
            Item description
          </label>
          <input
            name="item_description"
            placeholder="e.g. Sharp Refrigerator 6 cu ft"
            defaultValue={prefill?.itemDescription ?? ""}
            required
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            Item type
          </label>
          <select
            name="item_type"
            defaultValue={prefill?.itemType || undefined}
            className={input}
          >
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>
            Quantity
          </label>
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue="1"
            required
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            {saleType === "cash" ? "Cash amount (₱)" : "Cash price (₱)"}
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
            className={input}
          />
        </div>
        {saleType === "installment" && (
          <div>
            <label className={label}>
              Term
            </label>
            <select
              value={termMonths}
              onChange={(e) => setTermMonths(Number(e.target.value))}
              className={input}
            >
              {TERM_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {termLabel(t)}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={label}>
            Contract date
          </label>
          <input
            name="contract_date"
            type="date"
            required
            defaultValue={phTodayISO()}
            className={input}
          />
        </div>
        <div>
          <label className={label}>
            Sales agent
          </label>
          <select
            name="agent_id"
            defaultValue={prefill?.agentId ?? ""}
            className={input}
          >
            <option value="">Office Sales (no agent)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="col-span-2">
          <label className={label}>
            Notes <span className="text-muted">(optional)</span>
          </label>
          <input
            name="note"
            className={input}
          />
        </div>
      </div>

      {/* Live amortization preview */}
      {preview && (
        <div className="rounded-card border border-line bg-surface p-4 text-sm">
          <div className="mb-2 font-semibold text-ink">
            {termLabel(termMonths)}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="text-xs text-muted">Total price</div>
              <div className="font-semibold text-ink">
                {peso(preview.totalPrice)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">
                Downpayment (25%)
              </div>
              <div className="font-semibold text-ink">
                {peso(preview.downpayment)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Monthly</div>
              <div className="font-semibold text-ink">
                {peso(preview.monthlyAmortization)}
              </div>
            </div>
          </div>
        </div>
      )}

      {saleType === "cash" && Number(cashPrice) > 0 && (
        <div className="rounded-card border border-line bg-surface p-4 text-sm">
          <span className="text-muted">Amount due (paid in full — no schedule): </span>
          <span className="font-semibold text-ink">{peso(Number(cashPrice))}</span>
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
        className={btnPrimaryHero}
      >
        {pending ? "Creating…" : "Create Contract"}
      </button>
    </form>
  );
}
