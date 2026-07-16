"use client";

import { useRef, useState, useTransition } from "react";
import {
  addDtrLocation,
  deleteDtrLocation,
  setDtrLocationActive,
} from "../actions";

export function LocationForm() {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [pending, startTransition] = useTransition();

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Location is not available in this browser.");
      return;
    }
    setError("");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const form = ref.current;
        if (form) {
          (form.elements.namedItem("lat") as HTMLInputElement).value =
            pos.coords.latitude.toFixed(6);
          (form.elements.namedItem("lng") as HTMLInputElement).value =
            pos.coords.longitude.toFixed(6);
        }
        setLocating(false);
      },
      () => {
        setError(
          "Could not get your location — allow location access, or enter the coordinates manually."
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    );
  }

  return (
    <form
      ref={ref}
      action={(fd) => {
        setError("");
        const lat = Number(fd.get("lat"));
        const lng = Number(fd.get("lng"));
        const radiusM = Number(fd.get("radius") || 150);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          setError("Enter valid latitude and longitude numbers.");
          return;
        }
        startTransition(async () => {
          const res = await addDtrLocation({
            name: String(fd.get("name") ?? ""),
            lat,
            lng,
            radiusM,
          });
          if (res.error) setError(res.error);
          else ref.current?.reset();
        });
      }}
      className="space-y-2"
    >
      <div className="flex flex-wrap gap-2">
        <input
          name="name"
          required
          placeholder="e.g. Store"
          className="min-w-32 flex-1 rounded-card border border-line px-3 py-2 text-base"
        />
        <input
          name="lat"
          required
          inputMode="decimal"
          placeholder="Latitude"
          className="w-36 rounded-card border border-line px-3 py-2 text-base"
        />
        <input
          name="lng"
          required
          inputMode="decimal"
          placeholder="Longitude"
          className="w-36 rounded-card border border-line px-3 py-2 text-base"
        />
        <input
          name="radius"
          inputMode="numeric"
          placeholder="Radius (m)"
          defaultValue="150"
          className="w-28 rounded-card border border-line px-3 py-2 text-base"
        />
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface disabled:opacity-50"
        >
          {locating ? "Locating…" : "Use my location"}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-card bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-40"
        >
          {pending ? "…" : "Add"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}

export function LocationActiveToggle({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await setDtrLocationActive(id, !active);
          if (res.error) alert("Could not update location: " + res.error);
        })
      }
      className="rounded-card border border-line px-2 py-1 text-xs font-semibold text-ink hover:bg-surface disabled:opacity-50"
    >
      {pending ? "…" : active ? "Turn off" : "Turn on"}
    </button>
  );
}

export function DeleteLocationButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!window.confirm(`Remove location "${name}"?`)) return;
    startTransition(async () => {
      const res = await deleteDtrLocation(id);
      if (res.error) alert("Could not remove location: " + res.error);
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="rounded-card border border-danger/40 px-2 py-1 text-xs font-semibold text-danger hover:bg-danger-bg disabled:opacity-50"
    >
      {pending ? "…" : "Remove"}
    </button>
  );
}
