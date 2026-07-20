"use client";

import { useActionState, useState } from "react";
import { AddressFields, type LocationTree } from "@/components/address-fields";
import { btnPrimary, btnSecondary } from "@/components/ui";
import { setCustomerAddress } from "../actions";

/**
 * First-ever way to edit a customer address in the app. Until now an address
 * could only be set at customer creation, which is why 110 customers came out
 * of the Sheet backfill with a municipality but no barangay and nobody could
 * finish them.
 */
export function EditAddressForm({
  customerId,
  tree,
  current,
}: {
  customerId: string;
  tree: LocationTree;
  current: {
    province: string | null;
    municipality: string | null;
    barangay: string | null;
    street_purok: string | null;
    landmark: string | null;
  };
}) {
  const [open, setOpen] = useState(false);

  const [state, action, pending] = useActionState(
    async (_prev: { error?: string }, fd: FormData) => {
      const res = await setCustomerAddress(customerId, {
        province: String(fd.get("province") ?? "").trim(),
        municipality: String(fd.get("municipality") ?? "").trim(),
        barangay: String(fd.get("barangay") ?? "").trim(),
        streetPurok: String(fd.get("street_purok") ?? "").trim(),
        landmark: String(fd.get("landmark") ?? "").trim(),
      });
      if (!res.error) setOpen(false);
      return res;
    },
    {}
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        {current.barangay ? "Edit address" : "Complete address"}
      </button>
    );
  }

  return (
    <form action={action} className="rounded-card border border-line bg-white p-4">
      {!current.barangay && (
        <p className="mb-3 rounded-card bg-warning-bg px-3 py-2 text-xs text-warning">
          This address has a municipality but no barangay — it could not be
          matched automatically. Pick the barangay so the collector&rsquo;s
          worklist groups it correctly.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <AddressFields tree={tree} defaults={current} />
      </div>
      {state.error && (
        <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {state.error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save address"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
