"use client";

import { useMemo, useState } from "react";
import { input, label } from "@/components/ui";

/** province -> municipality -> barangays. Built server-side from ph_locations. */
export type LocationTree = Record<string, Record<string, string[]>>;

/**
 * Province → municipality → barangay, cascading. The whole tree ships with the
 * page (~2,100 names, a few KB gzipped) rather than round-tripping per select:
 * a collector or admin on a phone in Southern Leyte gets instant filtering and
 * no spinner between each step.
 */
export function AddressFields({
  tree,
  defaults,
  required = true,
}: {
  tree: LocationTree;
  defaults?: {
    province?: string | null;
    municipality?: string | null;
    barangay?: string | null;
    street_purok?: string | null;
    landmark?: string | null;
  };
  required?: boolean;
}) {
  const provinces = useMemo(() => Object.keys(tree).sort(), [tree]);
  const [province, setProvince] = useState(defaults?.province ?? "");
  const [municipality, setMunicipality] = useState(defaults?.municipality ?? "");
  const [barangay, setBarangay] = useState(defaults?.barangay ?? "");

  const municipalities = useMemo(
    () => (province && tree[province] ? Object.keys(tree[province]).sort() : []),
    [tree, province]
  );
  const barangays = useMemo(
    () =>
      province && municipality && tree[province]?.[municipality]
        ? [...tree[province][municipality]].sort()
        : [],
    [tree, province, municipality]
  );

  return (
    <>
      <div>
        <label className={label} htmlFor="province">Province</label>
        <select
          id="province"
          name="province"
          value={province}
          required={required}
          onChange={(e) => {
            setProvince(e.target.value);
            setMunicipality("");   // a stale municipality would not exist here
            setBarangay("");
          }}
          className={input}
        >
          <option value="">Select province…</option>
          {provinces.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="municipality">Municipality / City</label>
        <select
          id="municipality"
          name="municipality"
          value={municipality}
          required={required}
          disabled={!province}
          onChange={(e) => {
            setMunicipality(e.target.value);
            setBarangay("");
          }}
          className={`${input} disabled:bg-surface disabled:text-muted`}
        >
          <option value="">{province ? "Select municipality…" : "Pick a province first"}</option>
          {municipalities.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="barangay">Barangay</label>
        <select
          id="barangay"
          name="barangay"
          value={barangay}
          required={required}
          disabled={!municipality}
          onChange={(e) => setBarangay(e.target.value)}
          className={`${input} disabled:bg-surface disabled:text-muted`}
        >
          <option value="">{municipality ? "Select barangay…" : "Pick a municipality first"}</option>
          {barangays.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </div>

      <div>
        <label className={label} htmlFor="street_purok">Street / Purok</label>
        <input
          id="street_purok"
          name="street_purok"
          defaultValue={defaults?.street_purok ?? ""}
          placeholder="e.g. Purok 2, Rizal St."
          className={input}
        />
      </div>

      <div className="col-span-2">
        <label className={label} htmlFor="landmark">Landmark</label>
        <input
          id="landmark"
          name="landmark"
          defaultValue={defaults?.landmark ?? ""}
          placeholder="How to find the house — e.g. beside the blue water station"
          className={input}
        />
        <p className="mt-1 text-xs text-muted">
          Optional, but it saves the delivery crew and the collector a phone call.
        </p>
      </div>
    </>
  );
}
