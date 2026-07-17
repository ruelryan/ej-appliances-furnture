"use client";

import { useState, useTransition } from "react";
import { updateContract } from "../../actions";
import { COLLECTION_STATUSES, ITEM_TYPES } from "@/lib/messages";
import { btnPrimaryHero, input, label } from "@/components/ui";

interface Contract {
  id: string;
  contract_date: string;
  item_description: string;
  item_type: string | null;
  quantity: number;
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
        payment_status: String(fd.get("payment_status")),
        collection_status: String(fd.get("collection_status") ?? "") || null,
      });
      if (res?.error) setError(res.error);
    });
  }

  return (
    <form action={submit} className="space-y-3 rounded-card border border-line bg-white p-4">
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
          <select name="item_type" defaultValue={contract.item_type ?? ""} className={input}>
            <option value="">— none —</option>
            {ITEM_TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
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
        <p className="rounded-card bg-danger-bg px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={btnPrimaryHero}
      >
        {pending ? "Saving…" : "Save Changes"}
      </button>
    </form>
  );
}
