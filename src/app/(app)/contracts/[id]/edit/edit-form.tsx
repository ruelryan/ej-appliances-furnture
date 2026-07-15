"use client";

import { useState, useTransition } from "react";
import { updateContract } from "../../actions";
import { COLLECTION_STATUSES, DELIVERY_STATUSES } from "@/lib/messages";

interface Contract {
  id: string;
  contract_date: string;
  item_description: string;
  item_type: string | null;
  quantity: number;
  sales_agent: string | null;
  delivery_status: string;
  payment_status: string;
  collection_status: string | null;
}

export function EditForm({ contract }: { contract: Contract }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    setError("");
    startTransition(async () => {
      const res = await updateContract(contract.id, {
        contract_date: String(fd.get("contract_date")),
        item_description: String(fd.get("item_description") ?? "").trim(),
        item_type: String(fd.get("item_type") ?? "").trim() || null,
        quantity: Number(fd.get("quantity")),
        sales_agent: String(fd.get("sales_agent") ?? "").trim() || null,
        delivery_status: String(fd.get("delivery_status")),
        payment_status: String(fd.get("payment_status")),
        collection_status: String(fd.get("collection_status") ?? "") || null,
      });
      if (res?.error) setError(res.error);
    });
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  const label =
    "mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300";

  return (
    <form action={submit} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <label className={label}>Item description</label>
        <input
          name="item_description"
          defaultValue={contract.item_description}
          required
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Item type</label>
          <input name="item_type" defaultValue={contract.item_type ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Quantity</label>
          <input
            name="quantity"
            type="number"
            min="1"
            step="1"
            defaultValue={contract.quantity}
            required
            className={input}
          />
        </div>
        <div>
          <label className={label}>Contract date</label>
          <input
            name="contract_date"
            type="date"
            defaultValue={contract.contract_date}
            required
            className={input}
          />
        </div>
        <div>
          <label className={label}>Sales agent</label>
          <input name="sales_agent" defaultValue={contract.sales_agent ?? ""} className={input} />
        </div>
        <div>
          <label className={label}>Delivery status</label>
          <select name="delivery_status" defaultValue={contract.delivery_status} className={input}>
            {DELIVERY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Payment status</label>
          <select name="payment_status" defaultValue={contract.payment_status} className={input}>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className={label}>Collection status</label>
          <select
            name="collection_status"
            defaultValue={contract.collection_status ?? ""}
            className={input}
          >
            <option value="">— none —</option>
            {COLLECTION_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-sky-800 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
