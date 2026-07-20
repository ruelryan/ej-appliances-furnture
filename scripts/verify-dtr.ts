/**
 * Verifies the SQL DTR math and holiday seed after applying migration 0005:
 *
 *   npx tsx scripts/verify-dtr.ts
 *
 * - dtr_hours() against values taken from the original DTR Google Sheet
 * - easter_date() against the known Gregorian Easter dates
 * - holiday seed spot checks (types + computed dates)
 * - distance_m() haversine goldens (0010 geofence)
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

let failed = 0;

function check(label: string, got: unknown, want: unknown) {
  if (got === want) {
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.error(`❌ ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
}

function checkClose(label: string, got: number, want: number, tol: number) {
  if (Math.abs(got - want) <= tol) {
    console.log(`✅ ${label}`);
  } else {
    failed++;
    console.error(`❌ ${label} — got ${got}, want ${want} ±${tol}`);
  }
}

// Hours cases from the real sheet (July 2026, Analyn) plus lunch-window edges.
const HOURS_CASES: Array<{ in: string; out: string | null; want: number | null }> = [
  { in: "08:01", out: "17:03", want: 8.03 },
  { in: "10:09", out: "17:00", want: 5.85 },
  { in: "13:39", out: "17:01", want: 3.37 },
  { in: "10:06", out: "17:07", want: 6.02 },
  { in: "10:19", out: "17:19", want: 6.0 },
  { in: "08:39", out: "17:08", want: 7.48 },
  { in: "12:30", out: "17:00", want: 4.0 },  // starts mid-lunch: only 30 min deducted
  { in: "09:00", out: "12:30", want: 3.0 },  // ends mid-lunch: only 30 min deducted
  { in: "09:00", out: null, want: null },    // missing clock-out
];

const EASTER: Record<number, string> = {
  2026: "2026-04-05",
  2027: "2027-03-28",
  2028: "2028-04-16",
  2029: "2029-04-01",
  2030: "2030-04-21",
};

async function main() {
  for (const c of HOURS_CASES) {
    const { data, error } = await db.rpc("dtr_hours", { p_in: c.in, p_out: c.out });
    if (error) {
      failed++;
      console.error(`❌ dtr_hours(${c.in}, ${c.out}) — RPC error: ${error.message}`);
      continue;
    }
    check(
      `dtr_hours(${c.in}, ${c.out ?? "null"}) = ${c.want ?? "null"}`,
      data === null ? null : Number(data),
      c.want
    );
  }

  for (const [year, want] of Object.entries(EASTER)) {
    const { data, error } = await db.rpc("easter_date", { p_year: Number(year) });
    if (error) {
      failed++;
      console.error(`❌ easter_date(${year}) — RPC error: ${error.message}`);
      continue;
    }
    check(`easter_date(${year}) = ${want}`, data, want);
  }

  // Seed spot checks
  const SEED_CASES: Array<{ date: string; name: string; type: string }> = [
    { date: "2026-01-01", name: "New Year's Day", type: "regular" },
    { date: "2026-08-21", name: "Ninoy Aquino Day", type: "special" },
    { date: "2026-08-31", name: "National Heroes Day", type: "regular" }, // last Mon of Aug 2026
    { date: "2026-04-03", name: "Good Friday", type: "regular" },         // Easter 2026-04-05 − 2
    { date: "2026-04-04", name: "Black Saturday", type: "special" },
    { date: "2030-12-30", name: "Rizal Day", type: "regular" },           // last seeded year
  ];

  for (const s of SEED_CASES) {
    const { data, error } = await db
      .from("holidays")
      .select("name, type")
      .eq("holiday_date", s.date)
      .maybeSingle();
    if (error) {
      failed++;
      console.error(`❌ holidays ${s.date} — query error: ${error.message}`);
      continue;
    }
    check(`holiday ${s.date} = ${s.name} (${s.type})`, data ? `${data.name}|${data.type}` : "missing", `${s.name}|${s.type}`);
  }

  // Scoped to the 2026–2030 seed — 0008 added 2025 separately and the
  // owner adds proclaimed dates over time.
  const { count } = await db
    .from("holidays")
    .select("*", { count: "exact", head: true })
    .gte("holiday_date", "2026-01-01")
    .lte("holiday_date", "2030-12-31");
  check("2026–2030 seeded holiday count ≥ 80 (16 × 5 years)", (count ?? 0) >= 80, true);

  // distance_m() goldens (0010 geofence). One degree of latitude on the
  // R=6371 km sphere = pi/180 × 6,371,000 = 111,194.93 m.
  const DIST_CASES: Array<{
    label: string;
    args: { lat1: number; lng1: number; lat2: number; lng2: number };
    want: number;
    tol: number;
  }> = [
    {
      label: "distance_m: identical points = 0",
      args: { lat1: 10.25, lng1: 125.03, lat2: 10.25, lng2: 125.03 },
      want: 0,
      tol: 0.001,
    },
    {
      label: "distance_m: 1° latitude = 111,194.93 m",
      args: { lat1: 0, lng1: 0, lat2: 1, lng2: 0 },
      want: 111194.93,
      tol: 1,
    },
    {
      label: "distance_m: 1° longitude at equator = 111,194.93 m",
      args: { lat1: 0, lng1: 0, lat2: 0, lng2: 1 },
      want: 111194.93,
      tol: 1,
    },
    {
      label: "distance_m: half great circle = 20,015,086.8 m",
      args: { lat1: 0, lng1: 0, lat2: 0, lng2: 180 },
      want: 20015086.8,
      tol: 10,
    },
  ];

  for (const d of DIST_CASES) {
    const { data, error } = await db.rpc("distance_m", d.args);
    if (error) {
      failed++;
      console.error(`❌ ${d.label} — RPC error: ${error.message}`);
      continue;
    }
    checkClose(d.label, Number(data), d.want, d.tol);
  }

  // symmetry: A→B equals B→A (Tomas Oppus ↔ Maasin-ish coordinates)
  const fwd = await db.rpc("distance_m", { lat1: 10.2447, lng1: 125.0064, lat2: 10.1335, lng2: 124.8442 });
  const rev = await db.rpc("distance_m", { lat1: 10.1335, lng1: 124.8442, lat2: 10.2447, lng2: 125.0064 });
  if (fwd.error || rev.error) {
    failed++;
    console.error(`❌ distance_m symmetry — RPC error: ${fwd.error?.message ?? rev.error?.message}`);
  } else {
    checkClose("distance_m: symmetric A→B = B→A", Number(fwd.data), Number(rev.data), 0.001);
  }

  console.log(
    failed === 0
      ? "\nAll DTR SQL checks pass."
      : `\n${failed} check(s) failed.`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main();
