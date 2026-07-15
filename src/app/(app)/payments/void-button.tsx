"use client";

import { useTransition } from "react";
import { voidPayment } from "./actions";

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    const reason = window.prompt(
      "Void this payment? It will no longer count toward the balance.\n\nReason:"
    );
    if (reason === null) return;
    startTransition(async () => {
      const res = await voidPayment(paymentId, reason.trim() || "(no reason given)");
      if (res.error) alert("Could not void payment: " + res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-lg border border-red-300 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
    >
      {pending ? "…" : "Void"}
    </button>
  );
}
