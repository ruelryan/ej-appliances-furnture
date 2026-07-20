/**
 * Parses existing free-text customer addresses into province / municipality /
 * barangay / street-purok, matching against public.ph_locations.
 *
 *   npx tsx scripts/backfill-addresses.ts           # dry run + report
 *   npx tsx scripts/backfill-addresses.ts --apply
 *
 * customers.address is never modified — it stays as the address-as-given, both
 * as the audit trail for this parse and as the fallback for anything that could
 * not be resolved.
 *
 * A municipality-only match NEVER guesses a barangay. Those are listed in the
 * report for a human to finish, because inventing one would silently split an
 * area in two on the collector's worklist.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const OUT_DIR = "C:/Users/ryan/Documents/eandj-data";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

// ── matching helpers ─────────────────────────────────────────
const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Levenshtein, capped — we only care about "within 2". */
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Whole-word exact containment. */
function findExact(hay: string, needle: string): number | null {
  const n = norm(needle);
  if (!n) return null;
  let from = 0;
  for (;;) {
    const idx = hay.indexOf(n, from);
    if (idx < 0) return null;
    const before = idx === 0 || hay[idx - 1] === " ";
    const after = idx + n.length === hay.length || hay[idx + n.length] === " ";
    if (before && after) return idx;
    from = idx + 1;
  }
}

/**
 * Many barangays differ only by a trailing designator — "Bobon A" / "Bobon B",
 * "Bangcas A" / "Bangcas B", "San Isidro Norte" / "Sur". Those are one edit
 * apart and are DIFFERENT PLACES, so fuzzy matching must never bridge them.
 * Leaving such a row unresolved is far better than filing a customer in the
 * wrong barangay.
 */
function designatorClash(a: string, b: string): boolean {
  const ta = a.split(" ");
  const tb = b.split(" ");
  const lastA = ta[ta.length - 1];
  const lastB = tb[tb.length - 1];
  if (lastA === lastB) return false;
  const isDesignator = (t: string) =>
    t.length <= 2 || ["norte", "sur", "este", "oeste", "proper", "poblacion"].includes(t);
  // differ in the final token, and either side's final token is a designator
  if (ta.slice(0, -1).join(" ") === tb.slice(0, -1).join(" ")) return true;
  return isDesignator(lastA) || isDesignator(lastB);
}

/** Near-spelling match — abbreviation expansions like "Sto. Niño" → "Santo Niño". */
function findFuzzy(hay: string, needle: string): number | null {
  const n = norm(needle);
  if (!n || n.length < 5) return null;   // too short to fuzz safely
  const words = hay.split(" ");
  const span = n.split(" ").length;
  for (let i = 0; i + span <= words.length; i++) {
    const window = words.slice(i, i + span).join(" ");
    if (window.length < 4) continue;
    if (designatorClash(window, n)) continue;
    const d = editDistance(window, n, 3);
    if (d <= (n.length >= 8 ? 2 : 1)) return hay.indexOf(window);
  }
  return null;
}

interface Loc { province: string; municipality: string; barangay: string }

async function main() {
  const locs: Loc[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("ph_locations")
      .select("province, municipality, barangay")
      .order("province")
      .order("municipality")
      .order("barangay")
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    locs.push(...(data as Loc[]));
    if (data.length < 1000) break;
  }
  if (!locs.length) {
    console.error("ph_locations is empty — run scripts/import-locations.ts first.");
    process.exit(1);
  }

  const municipalities = [...new Set(locs.map((l) => l.municipality))]
    .sort((a, b) => b.length - a.length); // longest first: "San Francisco" before "San Juan"
  const bgysByMuni = new Map<string, Loc[]>();
  for (const l of locs) {
    if (!bgysByMuni.has(l.municipality)) bgysByMuni.set(l.municipality, []);
    bgysByMuni.get(l.municipality)!.push(l);
  }

  const customers: Array<{ id: string; display_name: string; address: string | null }> = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("customers")
      .select("id, display_name, address")
      .order("display_name")   // stable order — .range() without it can skip/repeat rows
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    customers.push(...(data as typeof customers));
    if (data.length < 1000) break;
  }

  const full: Array<Record<string, string>> = [];
  const muniOnly: Array<Record<string, string>> = [];
  const unresolved: Array<Record<string, string>> = [];
  const updates: Array<{ id: string; province: string; municipality: string; barangay: string | null; street_purok: string | null }> = [];

  for (const c of customers) {
    const raw = String(c.address ?? "").trim();
    if (!raw) { unresolved.push({ name: c.display_name, address: "(blank)" }); continue; }
    const hay = norm(raw);

    // Score EVERY municipality that appears, with the best barangay each one
    // yields, then take the highest-scoring pair. Taking the first municipality
    // hit is wrong: "Alejos, Bato, Leyte" matches the municipality *Leyte*
    // before Bato, and then fuzzes "bato"→"Baco" as a barangay. Scoring lets
    // (Bato + exact Alejos) beat (Leyte + fuzzy Baco).
    type Cand = {
      muni: string; muniAt: number; muniFuzzy: boolean;
      bgy: Loc | null; bgyAt: number; bgyFuzzy: boolean; score: number;
    };
    const cands: Cand[] = [];
    for (const m of municipalities) {
      let at = findExact(hay, m);
      let fuzzy = false;
      if (at === null) { at = findFuzzy(hay, m); fuzzy = at !== null; }
      if (at === null) continue;

      // Barangay search is scoped to this municipality — "Poblacion" and
      // "Santo Niño" exist in most of them, so an unscoped match would attach
      // the customer to the wrong town entirely.
      let bgy: Loc | null = null, bgyAt = -1, bgyFuzzy = false, bgyExactLen = -1;
      for (const l of bgysByMuni.get(m)!) {
        const ex = findExact(hay, l.barangay);
        if (ex !== null) {
          if (l.barangay.length > bgyExactLen) { bgy = l; bgyAt = ex; bgyFuzzy = false; bgyExactLen = l.barangay.length; }
        }
      }
      if (!bgy) {
        let bestLen = -1;
        for (const l of bgysByMuni.get(m)!) {
          const fz = findFuzzy(hay, l.barangay);
          if (fz !== null && l.barangay.length > bestLen) { bgy = l; bgyAt = fz; bgyFuzzy = true; bestLen = l.barangay.length; }
        }
      }

      // exact muni + exact bgy (4) > exact+fuzzy (3) > fuzzy+exact (2) > fuzzy+fuzzy (1) > muni alone (0)
      const score = bgy ? (fuzzy ? (bgyFuzzy ? 1 : 2) : (bgyFuzzy ? 3 : 4)) : (fuzzy ? -1 : 0);
      cands.push({ muni: m, muniAt: at, muniFuzzy: fuzzy, bgy, bgyAt, bgyFuzzy, score });
    }

    cands.sort((a, b) => b.score - a.score || b.muni.length - a.muni.length);
    const best = cands[0] ?? null;
    const muni = best ? best.muni : null;
    const muniHit = best ? { at: best.muniAt, fuzzy: best.muniFuzzy } : null;
    const bgy = best?.bgy ?? null;
    const bgyHit = best?.bgy ? { at: best.bgyAt, fuzzy: best.bgyFuzzy } : null;

    if (muni && bgy) {
      // street/purok = whatever precedes the earlier of the two place mentions
      const cut = Math.min(bgyHit!.at, muniHit!.at);
      const street = raw.slice(0, Math.max(0, cut)).replace(/[,\s]+$/, "").trim();
      full.push({
        name: c.display_name, address: raw,
        parsed: `${street ? street + " · " : ""}${bgy.barangay}, ${muni}, ${bgy.province}`,
        fuzzy: bgyHit!.fuzzy || muniHit!.fuzzy ? "yes" : "",
      });
      updates.push({
        id: c.id, province: bgy.province, municipality: muni, barangay: bgy.barangay,
        street_purok: street || null,
      });
    } else if (muni) {
      const province = bgysByMuni.get(muni)![0].province;
      const street = raw.slice(0, Math.max(0, muniHit!.at)).replace(/[,\s]+$/, "").trim();
      muniOnly.push({ name: c.display_name, address: raw, municipality: `${muni}, ${province}` });
      updates.push({ id: c.id, province, municipality: muni, barangay: null, street_purok: street || null });
    } else {
      unresolved.push({ name: c.display_name, address: raw });
    }
  }

  const pct = (n: number) => `${Math.round((n / customers.length) * 100)}%`;
  console.log(`customers: ${customers.length}`);
  console.log(`  barangay + municipality: ${full.length} (${pct(full.length)})`);
  console.log(`  municipality only:       ${muniOnly.length} (${pct(muniOnly.length)})`);
  console.log(`  unresolved:              ${unresolved.length} (${pct(unresolved.length)})`);
  console.log(`  of the full matches, ${full.filter((f) => f.fuzzy).length} needed fuzzy spelling`);

  const report = [
    `# Address backfill ${APPLY ? "APPLIED" : "DRY RUN"}`,
    ``,
    `- Customers: ${customers.length}`,
    `- Barangay + municipality resolved: ${full.length} (${pct(full.length)})`,
    `- Municipality only — barangay left NULL for a human: ${muniOnly.length} (${pct(muniOnly.length)})`,
    `- Unresolved: ${unresolved.length}`,
    ``,
    `## Municipality only (${muniOnly.length}) — pick the barangay by hand`,
    ...muniOnly.map((m) => `- **${m.name}** — "${m.address}" → ${m.municipality}`),
    ``,
    `## Unresolved (${unresolved.length})`,
    ...(unresolved.length ? unresolved.map((u) => `- **${u.name}** — "${u.address}"`) : ["- none"]),
    ``,
    `## Fuzzy-matched (${full.filter((f) => f.fuzzy).length}) — spelling differed, verify these`,
    ...full.filter((f) => f.fuzzy).map((f) => `- **${f.name}** — "${f.address}" → ${f.parsed}`),
    ``,
  ].join("\n");
  const reportPath = path.join(OUT_DIR, "address-backfill-report.md");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`\nReport: ${reportPath}`);

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  let ok = 0, failed = 0;
  for (const u of updates) {
    const { id, ...fields } = u;
    const { error } = await db.from("customers").update(fields).eq("id", id);
    if (error) { failed++; if (failed <= 5) console.error(`  ${id}: ${error.message}`); }
    else if (++ok % 250 === 0) console.log(`  ${ok}/${updates.length}…`);
  }
  console.log(`\nUpdated ${ok}. Failed ${failed}.`);
}

main();
