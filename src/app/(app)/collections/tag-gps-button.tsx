"use client";

import { useState, useTransition } from "react";
import { tagCustomerGps } from "../customers/actions";

type Result =
  | { ok: true; lat: number; lng: number; accuracy: number | null }
  | { ok: false; reason: "unsupported" | "denied" | "unavailable" | "timeout" };

/**
 * Deliberately NOT the DTR clock-card's getPosition(). That one folds denial,
 * timeout and a missing API all into nulls, which is fine there because the
 * server produces the error message. Here there is no server voice — a silent
 * no-op would look like success — so each failure is distinguished and shown.
 */
function getPosition(): Promise<Result> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ ok: false, reason: "unsupported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          ok: true,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? null,
        }),
      (err) =>
        resolve({
          ok: false,
          reason:
            err.code === err.PERMISSION_DENIED
              ? "denied"
              : err.code === err.TIMEOUT
                ? "timeout"
                : "unavailable",
        }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
    );
  });
}

const MESSAGES: Record<string, string> = {
  unsupported: "This phone can't share a location.",
  denied: "Location is blocked. Allow it for this site in your browser settings, then try again.",
  unavailable: "Couldn't get a location fix. Try stepping outside.",
  timeout: "Location took too long. Try again with a clearer view of the sky.",
};

export function TagGpsButton({
  customerId,
  hasPin,
}: {
  customerId: string;
  hasPin: boolean;
}) {
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [busy, startTransition] = useTransition();
  const [locating, setLocating] = useState(false);

  async function tag() {
    setError("");
    setStatus("");
    setLocating(true);
    const pos = await getPosition();
    setLocating(false);

    if (!pos.ok) {
      setError(MESSAGES[pos.reason]);
      return;
    }
    // A 500 m fix is worse than useless for finding a house — it would send the
    // next collector to the wrong end of the barangay.
    if (pos.accuracy !== null && pos.accuracy > 200) {
      setError(`Signal too weak (±${Math.round(pos.accuracy)} m). Move to open sky and retry.`);
      return;
    }
    startTransition(async () => {
      const res = await tagCustomerGps(customerId, pos);
      if (res.error) setError(res.error);
      else setStatus(`Saved${pos.accuracy ? ` (±${Math.round(pos.accuracy)} m)` : ""}`);
    });
  }

  const working = busy || locating;

  return (
    <>
      <button
        type="button"
        onClick={tag}
        disabled={working}
        className="rounded-card border border-line bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
      >
        {locating ? "Getting location…" : busy ? "Saving…" : hasPin ? "Update pin" : "Tag GPS"}
      </button>
      {status && <span className="text-xs font-medium text-positive">{status}</span>}
      {error && <span className="text-xs text-danger">{error}</span>}
    </>
  );
}
