"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/alert";
import { Dialog } from "@/components/dialog";
import { btnDanger, btnSecondary } from "@/components/ui";
import { peso } from "@/lib/format";
import { closeContract, reopenContract } from "../actions";

/**
 * Closing an account, and undoing it.
 *
 * Until 0038 there was no button for this anywhere in the app — the only path
 * was a `payment_status` dropdown buried on the owner-only edit form, which
 * wrote the column directly and skipped close_contract's guards entirely. That
 * dropdown is gone; this is the one way.
 *
 * The balance is stated in the confirmation rather than blocking on it.
 * Closing with money still owed is legitimate (a settlement, a write-off, a
 * repossession) and 0032 allows it on purpose — but v_contract_financials lets
 * payment_status win the cascade, so the contract will then read "Fully paid"
 * whatever is left. Someone doing that should have seen the number first.
 */
export function CloseControl({
  contractId,
  paymentStatus,
  remainingBalance,
  canClose,
  isOwner,
}: {
  contractId: string;
  paymentStatus: string;
  remainingBalance: number;
  canClose: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<null | "close" | "reopen">(null);
  const [error, setError] = useState("");
  const [busy, startTransition] = useTransition();

  const isClosed = paymentStatus === "closed";
  const owes = Number(remainingBalance) > 0;

  // Nothing to offer: an admin looking at a contract someone already closed.
  if (isClosed && !isOwner) return null;
  if (!isClosed && !canClose) return null;

  function run(action: "close" | "reopen") {
    setError("");
    startTransition(async () => {
      const res =
        action === "close"
          ? await closeContract(contractId)
          : await reopenContract(contractId);
      if (res?.error) setError(res.error);
      else {
        setConfirming(null);
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(isClosed ? "reopen" : "close")}
        className={isClosed ? btnSecondary : owes ? btnDanger : btnSecondary}
      >
        {isClosed ? "Reopen account" : "Close account"}
      </button>

      <Dialog
        open={confirming !== null}
        onClose={() => !busy && setConfirming(null)}
        title={confirming === "reopen" ? "Reopen this account?" : "Close this account?"}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(null)}
              className={btnSecondary}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(confirming === "reopen" ? "reopen" : "close")}
              className={confirming === "close" && owes ? btnDanger : btnSecondary}
            >
              {busy
                ? "Saving…"
                : confirming === "reopen"
                  ? "Reopen account"
                  : "Close account"}
            </button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-ink">
          {error && <Alert tone="danger">{error}</Alert>}

          {confirming === "reopen" ? (
            <p>
              The account goes back to <span className="font-semibold">Open</span>{" "}
              and payments can be recorded against it again.
            </p>
          ) : owes ? (
            <>
              <Alert tone="warning" title="This account still owes money.">
                <p className="mt-1">
                  Balance outstanding:{" "}
                  <span className="font-semibold tabular-nums">
                    {peso(remainingBalance)}
                  </span>
                </p>
              </Alert>
              <p>
                Closing it writes that amount off. The contract will read{" "}
                <span className="font-semibold">Fully paid</span> from now on,
                and no further payment can be recorded against it.
              </p>
              <p className="text-xs text-muted">
                Only do this for a settlement, a write-off, or a repossession.
                If the customer is simply behind, leave it open. Only an owner
                can undo this.
              </p>
            </>
          ) : (
            <>
              <p>
                This contract is paid in full. Closing it takes it off the
                collections worklist and stops any further payment being
                recorded against it.
              </p>
              <p className="text-xs text-muted">
                Only an owner can reopen a closed account.
              </p>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
