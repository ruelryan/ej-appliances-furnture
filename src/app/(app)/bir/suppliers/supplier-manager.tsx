"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Dialog } from "@/components/dialog";
import {
  btnPrimary,
  btnSecondary,
  btnSecondarySm,
  input,
  label,
} from "@/components/ui";
import { upsertBirSupplier } from "../actions";

export interface SupplierRow {
  id: string;
  name: string;
  address: string | null;
  tin: string | null;
  vat_registered: boolean;
  bir_name: string | null;
  active: boolean;
}

export function SupplierManager({
  mode,
  row,
}: {
  mode: "create" | "edit";
  row?: SupplierRow;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const [name, setName] = useState(row?.name ?? "");
  const [birName, setBirName] = useState(row?.bir_name ?? "");
  const [address, setAddress] = useState(row?.address ?? "");
  const [tin, setTin] = useState(row?.tin ?? "");
  const [vat, setVat] = useState(row?.vat_registered ?? false);

  function save() {
    setError("");
    if (!name.trim()) return setError("A supplier name is required.");
    // Not a hard block: the TIN is often missing from the receipt itself, and
    // refusing the row would only push it back into the spreadsheet.
    startTransition(async () => {
      const res = await upsertBirSupplier({
        id: row?.id ?? null,
        name,
        address,
        tin,
        vatRegistered: vat,
        birName,
      });
      if (res.error) setError(res.error);
      else {
        setOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError("");
          setOpen(true);
        }}
        className={mode === "create" ? btnPrimary : btnSecondarySm}
      >
        {mode === "create" ? "Add supplier" : "Edit"}
      </button>

      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={mode === "create" ? "Add a supplier" : "Edit supplier"}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(false)}
              className={btnSecondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className={btnPrimary}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}

          <div>
            <label className={label}>Name</label>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="RL APPLIANCE, INC."
            />
          </div>

          <div>
            <label className={label}>Registered name (if different)</label>
            <input
              className={input}
              value={birName}
              onChange={(e) => setBirName(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              What the BIR knows them as, when it differs from the name on the
              signboard. The journal uses this one.
            </p>
          </div>

          <div>
            <label className={label}>Address</label>
            <input
              className={input}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Zone V, Sogod, Southern Leyte"
            />
          </div>

          <div>
            <label className={label}>TIN / VAT reg. no.</label>
            <input
              className={`${input} font-mono`}
              value={tin}
              onChange={(e) => setTin(e.target.value)}
              placeholder="005-459-648-004"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={vat}
              onChange={(e) => setVat(e.target.checked)}
              className="h-4 w-4"
            />
            VAT-registered — input tax may be claimed
          </label>
        </div>
      </Dialog>
    </>
  );
}
