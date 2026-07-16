"use client";

import { useState, useTransition } from "react";
import { clockIn, clockOut, type PunchCoords } from "./actions";
import { fmtHours, fmtTime } from "@/lib/format";
import { btnPrimaryHero } from "@/components/ui";

// Never rejects — resolves all-nulls on denial/timeout/missing API.
// The server is the sole geofence enforcer; it tells the user what's wrong.
function getPosition(): Promise<PunchCoords> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ lat: null, lng: null, accuracy: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      () => resolve({ lat: null, lng: null, accuracy: null }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  });
}

// Today's row from v_dtr_days (null when not yet clocked in).
export function ClockCard({
  today,
  geofenceOn,
}: {
  today: {
    time_in: string;
    time_out: string | null;
    hours_worked: string | number | null;
  } | null;
  geofenceOn: boolean;
}) {
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = pending || locating;

  async function run(action: (coords: PunchCoords) => Promise<{ error?: string }>) {
    setError("");
    let coords: PunchCoords = { lat: null, lng: null, accuracy: null };
    if (geofenceOn) {
      setLocating(true);
      coords = await getPosition();
      setLocating(false);
    }
    startTransition(async () => {
      const res = await action(coords);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="rounded-card border border-line bg-white p-4">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Today
      </div>

      {!today && (
        <button
          type="button"
          onClick={() => run(clockIn)}
          disabled={busy}
          className={btnPrimaryHero}
        >
          {locating ? "Getting location…" : pending ? "Clocking in…" : "Clock In"}
        </button>
      )}

      {today && !today.time_out && (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            Clocked in at{" "}
            <span className="font-semibold">{fmtTime(today.time_in)}</span>
          </p>
          <button
            type="button"
            onClick={() => run(clockOut)}
            disabled={busy}
            className="w-full rounded-card bg-positive py-3 text-base font-semibold text-white transition hover:bg-positive-dark disabled:opacity-50"
          >
            {locating ? "Getting location…" : pending ? "Clocking out…" : "Clock Out"}
          </button>
        </div>
      )}

      {today && today.time_out && (
        <p className="text-sm text-ink">
          <span className="font-semibold">{fmtTime(today.time_in)}</span>
          {" – "}
          <span className="font-semibold">{fmtTime(today.time_out)}</span>
          {" · "}
          <span className="font-semibold tabular-nums">
            {fmtHours(today.hours_worked)}
          </span>{" "}
          hrs today
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
