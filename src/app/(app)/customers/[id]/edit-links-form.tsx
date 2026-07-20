"use client";

import { useActionState, useState } from "react";
import { setCustomerLinks } from "../actions";
import { btnPrimary, btnSecondary, input, label } from "@/components/ui";

export function EditLinksForm({
  customerId,
  messengerUrl,
  collectionGcUrl,
}: {
  customerId: string;
  messengerUrl: string | null;
  collectionGcUrl: string | null;
}) {
  const [open, setOpen] = useState(false);

  const [state, action, pending] = useActionState(
    async (_prev: { error?: string }, fd: FormData) => {
      const res = await setCustomerLinks(customerId, {
        messengerUrl: String(fd.get("messenger_url") ?? "").trim(),
        collectionGcUrl: String(fd.get("collection_gc_url") ?? "").trim(),
      });
      if (!res.error) setOpen(false);
      return res;
    },
    {}
  );

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={btnSecondary}>
        Edit links
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-card border border-line bg-white p-4">
      <div>
        <label className={label} htmlFor="messenger_url">
          Personal Messenger
        </label>
        <input
          id="messenger_url"
          name="messenger_url"
          defaultValue={messengerUrl ?? ""}
          placeholder="The customer's own Facebook/Messenger link"
          className={input}
        />
      </div>
      <div>
        <label className={label} htmlFor="collection_gc_url">
          Collection group chat
        </label>
        <input
          id="collection_gc_url"
          name="collection_gc_url"
          defaultValue={collectionGcUrl ?? ""}
          placeholder="Group chat with owner, admin, collector and customer"
          className={input}
        />
        <p className="mt-1 text-xs text-muted">
          This is the link collectors see on their worklist.
        </p>
      </div>
      {state.error && <p className="text-sm text-danger">{state.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={btnPrimary}>
          {pending ? "Saving…" : "Save links"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={btnSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}
