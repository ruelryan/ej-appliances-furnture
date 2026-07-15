/**
 * One-time migration: Google Sheets CSV exports → Supabase Postgres.
 *
 * Usage:
 *   npx tsx scripts/migrate/import.ts --dir <folder-with-csvs>            # dry run: report only
 *   npx tsx scripts/migrate/import.ts --dir <folder-with-csvs> --load     # truncate + load + reconcile
 *
 * Expected files in --dir (export each Sheet tab as CSV):
 *   contracts.csv   (Contracts Database tab)
 *   payments.csv    (Payments Database tab)
 *   collection.csv  (Collection tab — optional)
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Idempotent: --load wipes and reloads the business tables, so it can be
 * rerun on a fresh export at cutover.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

// ── CLI args ─────────────────────────────────────────────────
const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
if (dirIdx === -1 || !args[dirIdx + 1]) {
  console.error("Usage: npx tsx scripts/migrate/import.ts --dir <folder> [--load]");
  process.exit(1);
}
const DIR = args[dirIdx + 1];
const DO_LOAD = args.includes("--load");

dotenv.config({ path: ".env.local" });

// ── Helpers ──────────────────────────────────────────────────
const issues: string[] = [];
const warn = (msg: string) => issues.push(msg);

function readCsv(name: string, required: boolean): string[][] {
  const p = path.join(DIR, name);
  if (!fs.existsSync(p)) {
    if (required) {
      console.error(`Missing required file: ${p}`);
      process.exit(1);
    }
    return [];
  }
  return parse(fs.readFileSync(p, "utf8"), {
    relax_column_count: true,
    skip_empty_lines: false,
  }) as string[][];
}

const normHeader = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Find the header row and build a name→index map using alias lists. */
function mapColumns(
  rows: string[][],
  aliases: Record<string, string[]>,
  anchorField: string
): { headerRow: number; cols: Record<string, number> } {
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const normed = rows[r].map(normHeader);
    const anchorHit = aliases[anchorField].some((a) => normed.includes(normHeader(a)));
    if (!anchorHit) continue;

    const cols: Record<string, number> = {};
    for (const [field, names] of Object.entries(aliases)) {
      for (const n of names) {
        const idx = normed.indexOf(normHeader(n));
        if (idx !== -1) {
          cols[field] = idx;
          break;
        }
      }
    }
    return { headerRow: r, cols };
  }
  console.error(`Could not find a header row containing any of: ${aliases[anchorField].join(", ")}`);
  process.exit(1);
}

const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();

function parseDate(raw: string, context: string): string | null {
  const s = clean(raw);
  if (!s) return null;

  // "Dec 12, 2024" / "December 12, 2024"
  let m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
    const mi = months.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi !== -1) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  // "7/1/2026" or "6/3/25" — Google Sheets US locale: month/day/year
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const [, mm, dd, yy] = m;
    if (Number(mm) > 12) {
      warn(`${context}: date "${s}" has month > 12 — check day/month order`);
      return null;
    }
    const yyyy = yy.length === 4 ? yy : Number(yy) < 50 ? `20${yy}` : `19${yy}`;
    return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  // already ISO
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  warn(`${context}: unparseable date "${s}"`);
  return null;
}

function parseMoney(raw: string, context: string): number | null {
  const s = clean(raw).replace(/[₱,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (isNaN(n)) {
    warn(`${context}: unparseable amount "${raw}"`);
    return null;
  }
  return n;
}

function splitName(raw: string, context: string): { last: string; first: string } | null {
  const s = clean(raw);
  if (!s) return null;
  const comma = s.indexOf(",");
  if (comma === -1) {
    warn(`${context}: name "${s}" is not in "Last, First" format — imported as last name only`);
    return { last: s, first: "" };
  }
  return { last: clean(s.slice(0, comma)), first: clean(s.slice(comma + 1)) };
}

function splitPhones(raw: string): string[] {
  return clean(raw)
    .split(/[\/,&]| {2,}/)
    .map((p) => p.replace(/[^\d+]/g, ""))
    .filter(Boolean)
    .map((p) => {
      if (/^9\d{9}$/.test(p)) return "0" + p;         // 9XX… → 09XX…
      if (/^639\d{9}$/.test(p)) return "0" + p.slice(2); // 639… → 09…
      return p;
    });
}

const normName = (s: string) => clean(s).toLowerCase().replace(/[^a-z0-9]/g, "");

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
  return dp[a.length][b.length];
}

// ── Parse: Contracts ─────────────────────────────────────────
interface RawContract {
  contractNo: string;
  date: string | null;
  name: string;
  contact: string;
  fb: string;
  address: string;
  item: string;
  itemType: string;
  quantity: number;
  cashPrice: number | null;
  agent: string;
  notes: string;
  deliveryStatus: string;
  paymentStatus: "open" | "closed";
  term: number;
}

const contractRows = readCsv("contracts.csv", true);
const cMap = mapColumns(
  contractRows,
  {
    contractNo: ["Contract ID", "Contract No", "Contract Number"],
    date: ["Date", "Contract Date"],
    name: ["Customer name", "Customer", "Name"],
    contact: ["Contact number", "Contact", "Contact No"],
    fb: ["FB link", "Facebook", "Messenger", "FB"],
    address: ["Address"],
    item: ["Item Description", "Item"],
    itemType: ["Item Type"],
    quantity: ["Quantity", "Qty"],
    cashPrice: ["Cash Price", "Price", "Total Price"],
    agent: ["Sales Agent", "Agent"],
    notes: ["Notes"],
    deliveryStatus: ["Delivery Status"],
    paymentStatus: ["Payment Status"],
    term: ["Current Term", "Term"],
  },
  "contractNo"
);

const contracts: RawContract[] = [];
const seenContractNos = new Set<string>();

for (let r = cMap.headerRow + 1; r < contractRows.length; r++) {
  const row = contractRows[r];
  const get = (f: string) => (cMap.cols[f] !== undefined ? clean(row[cMap.cols[f]]) : "");

  const contractNo = get("contractNo");
  if (!contractNo) continue; // blank row

  const ctx = `contracts row ${r + 1} (#${contractNo})`;
  if (seenContractNos.has(contractNo)) {
    warn(`${ctx}: DUPLICATE contract number — second occurrence skipped`);
    continue;
  }
  seenContractNos.add(contractNo);

  const term = Number(get("term")) || 0;
  if (![4, 5, 6, 12].includes(term)) {
    warn(`${ctx}: unusual term "${get("term")}" — imported as-is but check it`);
  }

  const rawStatus = get("paymentStatus").toLowerCase();
  const paymentStatus: "open" | "closed" =
    rawStatus.startsWith("clos") || rawStatus === "close" ? "closed" : "open";

  const qty = Number(get("quantity")) || 1;

  contracts.push({
    contractNo,
    date: parseDate(get("date"), ctx),
    name: get("name"),
    contact: get("contact"),
    fb: get("fb"),
    address: get("address"),
    item: get("item"),
    itemType: get("itemType"),
    quantity: qty >= 1 ? Math.round(qty) : 1,
    cashPrice: parseMoney(get("cashPrice"), ctx),
    agent: get("agent"),
    notes: cMap.cols.notes !== undefined ? String(row[cMap.cols.notes] ?? "").trim() : "",
    deliveryStatus: get("deliveryStatus") || "Out for Delivery",
    paymentStatus,
    term: [4, 5, 6, 12].includes(term) ? term : 4,
  });

  if (!contracts.at(-1)!.date) warn(`${ctx}: missing/invalid contract date`);
  if (!contracts.at(-1)!.cashPrice) warn(`${ctx}: missing/invalid cash price`);
  if (!contracts.at(-1)!.item) warn(`${ctx}: missing item description`);
}

// ── Parse: Payments ──────────────────────────────────────────
interface RawPayment {
  paymentNo: string;
  date: string | null;
  amount: number | null;
  contractNo: string;
  receiptNo: string;
  receiptType: string;
  referenceNo: string;
}

const paymentRows = readCsv("payments.csv", true);
const pMap = mapColumns(
  paymentRows,
  {
    paymentNo: ["Payment ID", "Payment No"],
    date: ["Date", "Payment Date"],
    customer: ["Customer Name", "Received from", "Customer"],
    amount: ["Amount", "Amount Paid"],
    contractNo: ["Contract ID", "Customer Card Number", "Contract No", "Card Number"],
    receiptNo: ["Receipt No", "Collection Receipt no.", "OR#", "Receipt Number"],
    receiptType: ["Receipt Type"],
    referenceNo: ["Reference No", "Reference no."],
  },
  "paymentNo"
);

const payments: RawPayment[] = [];
const seenPaymentNos = new Set<string>();

for (let r = pMap.headerRow + 1; r < paymentRows.length; r++) {
  const row = paymentRows[r];
  const get = (f: string) => (pMap.cols[f] !== undefined ? clean(row[pMap.cols[f]]) : "");

  const paymentNo = get("paymentNo");
  if (!paymentNo) continue;

  const ctx = `payments row ${r + 1} (${paymentNo})`;
  if (seenPaymentNos.has(paymentNo)) {
    warn(`${ctx}: DUPLICATE payment ID — second occurrence skipped`);
    continue;
  }
  seenPaymentNos.add(paymentNo);

  payments.push({
    paymentNo,
    date: parseDate(get("date"), ctx),
    amount: parseMoney(get("amount"), ctx),
    contractNo: get("contractNo"),
    receiptNo: get("receiptNo"),
    receiptType: get("receiptType"),
    referenceNo: get("referenceNo"),
  });

  if (!payments.at(-1)!.date) warn(`${ctx}: missing/invalid date`);
  if (!payments.at(-1)!.amount) warn(`${ctx}: missing/invalid amount`);
}

const orphanPayments = payments.filter(
  (p) => p.contractNo && !seenContractNos.has(p.contractNo)
);
for (const p of orphanPayments) {
  warn(`payment ${p.paymentNo}: contract "${p.contractNo}" not found — will be SKIPPED on load`);
}

// ── Parse: Collection (optional) ─────────────────────────────
interface RawCollection {
  contractNo: string;
  messenger: string;
  gmap: string;
  status: string;
}

const collectionRows = readCsv("collection.csv", false);
const collections: RawCollection[] = [];
if (collectionRows.length) {
  const kMap = mapColumns(
    collectionRows,
    {
      contractNo: ["Customer Card no.", "Customer Card Number", "Contract No", "Contract ID", "Contract Number", "Contract"],
      name: ["Customer Name", "Name", "Customer"],
      messenger: ["Messenger Collection GC", "Messenger", "Messenger Link", "GC"],
      gmap: ["Google Map GPS", "GPS", "Map", "Gmap"],
      status: ["Status", "Collection Status"],
    },
    "contractNo"
  );
  for (let r = kMap.headerRow + 1; r < collectionRows.length; r++) {
    const row = collectionRows[r];
    const get = (f: string) => (kMap.cols[f] !== undefined ? clean(row[kMap.cols[f]]) : "");
    const contractNo = get("contractNo");
    if (!contractNo) continue;
    collections.push({
      contractNo,
      messenger: get("messenger"),
      gmap: get("gmap"),
      status: get("status"),
    });
  }
}

const VALID_COLLECTION_STATUSES = new Set([
  "Paid", "Asked for extension", "Collect in-person",
  "Pull-out letter prepared", "Pull-out letter sent", "Item for pull-out",
]);

// ── Customer dedupe ──────────────────────────────────────────
interface Customer {
  key: string;
  last: string;
  first: string;
  phones: string[];
  address: string;
  messenger: string;
  gps: string;
}

const customersByKey = new Map<string, Customer>();
const contractCustomerKey = new Map<string, string>(); // contractNo → customer key

for (const c of contracts) {
  const parts = splitName(c.name, `contract #${c.contractNo}`);
  if (!parts) {
    warn(`contract #${c.contractNo}: MISSING customer name — will be skipped on load`);
    continue;
  }
  const key = normName(c.name);
  let cust = customersByKey.get(key);
  if (!cust) {
    cust = { key, last: parts.last, first: parts.first, phones: [], address: "", messenger: "", gps: "" };
    customersByKey.set(key, cust);
  }
  // enrich with the latest non-empty values (later contracts win)
  const phones = splitPhones(c.contact);
  for (const p of phones) if (!cust.phones.includes(p)) cust.phones.push(p);
  if (c.address) cust.address = c.address;
  if (c.fb) cust.messenger = c.fb;
  contractCustomerKey.set(c.contractNo, key);
}

// Collection sheet enriches customers via their contract
for (const k of collections) {
  const key = contractCustomerKey.get(k.contractNo);
  if (!key) {
    if (k.contractNo) warn(`collection row for contract "${k.contractNo}": contract not found`);
    continue;
  }
  const cust = customersByKey.get(key)!;
  if (k.messenger && !cust.messenger) cust.messenger = k.messenger;
  if (k.gmap && !cust.gps) cust.gps = k.gmap;
}

// Near-duplicate review file (never auto-merged)
const custList = [...customersByKey.values()];
const nearDuplicates: string[] = [];
for (let i = 0; i < custList.length; i++) {
  for (let j = i + 1; j < custList.length; j++) {
    const a = custList[i], b = custList[j];
    const dist = editDistance(a.key, b.key);
    const samePhone = a.phones.some((p) => b.phones.includes(p));
    if ((dist > 0 && dist <= 2) || (samePhone && a.key !== b.key)) {
      nearDuplicates.push(
        `"${a.last}, ${a.first}" ↔ "${b.last}, ${b.first}"` +
          (samePhone ? " (SAME PHONE)" : ` (name distance ${dist})`)
      );
    }
  }
}

// ── Notes splitting ──────────────────────────────────────────
function splitNotes(notes: string): Array<{ at: string | null; body: string }> {
  if (!notes.trim()) return [];
  const pattern = /\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\]\s*/g;
  const parts: Array<{ at: string | null; body: string }> = [];
  let lastIndex = 0;
  let lastStamp: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(notes))) {
    const chunk = notes.slice(lastIndex, m.index).trim();
    if (chunk) parts.push({ at: lastStamp, body: chunk });
    lastStamp = m[1];
    lastIndex = pattern.lastIndex;
  }
  const tail = notes.slice(lastIndex).trim();
  if (tail) parts.push({ at: lastStamp, body: tail });
  return parts;
}

// ── Report ───────────────────────────────────────────────────
const totalPayments = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
const totalCashPrice = contracts.reduce((s, c) => s + (c.cashPrice ?? 0), 0);

const report = [
  `# Migration ${DO_LOAD ? "LOAD" : "DRY RUN"} report`,
  ``,
  `## Totals (compare these against the Google Sheet before trusting the load)`,
  `- Contracts parsed: ${contracts.length}`,
  `- Unique customers after exact-name dedupe: ${customersByKey.size}`,
  `- Payments parsed: ${payments.length}`,
  `- Sum of payment amounts: ₱${totalPayments.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
  `- Sum of contract cash prices: ₱${totalCashPrice.toLocaleString("en-PH", { minimumFractionDigits: 2 })}`,
  `- Orphan payments (contract not found): ${orphanPayments.length}`,
  `- Collection rows matched: ${collections.length}`,
  ``,
  `## Possible duplicate customers (REVIEW BY HAND — not auto-merged)`,
  ...(nearDuplicates.length ? nearDuplicates.map((d) => `- ${d}`) : ["- none found"]),
  ``,
  `## Issues (${issues.length})`,
  ...(issues.length ? issues.map((i) => `- ${i}`) : ["- none"]),
  ``,
].join("\n");

fs.writeFileSync(path.join(DIR, "migration-report.md"), report, "utf8");
console.log(report);
console.log(`\nReport saved to ${path.join(DIR, "migration-report.md")}`);

if (!DO_LOAD) {
  console.log("\nDry run only. Review the report, then rerun with --load to import.");
  process.exit(0);
}

// ── Load ─────────────────────────────────────────────────────
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  console.log("\nWiping existing business data (idempotent reload)…");
  for (const table of ["contract_notes", "payments", "contracts", "customers"]) {
    const { error } = await db.from(table).delete().not("id", "is", null);
    if (error) {
      console.error(`Failed to clear ${table}: ${error.message}`);
      process.exit(1);
    }
  }
  {
    const { error } = await db.from("id_counters").delete().neq("scope", "");
    if (error) {
      console.error(`Failed to clear id_counters: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`Inserting ${customersByKey.size} customers…`);
  const keyToId = new Map<string, string>();
  const custRows = [...customersByKey.values()];
  for (let i = 0; i < custRows.length; i += 200) {
    const batch = custRows.slice(i, i + 200);
    const { data, error } = await db
      .from("customers")
      .insert(
        batch.map((c) => ({
          last_name: c.last,
          first_name: c.first,
          phones: c.phones,
          address: c.address || null,
          messenger_url: c.messenger || null,
          gps_url: c.gps || null,
        }))
      )
      .select("id, display_name");
    if (error) throw new Error("customers insert: " + error.message);
    data!.forEach((row, idx) => keyToId.set(batch[idx].key, row.id));
  }

  console.log(`Inserting ${contracts.length} contracts…`);
  const contractNoToId = new Map<string, string>();
  const loadable = contracts.filter(
    (c) => contractCustomerKey.has(c.contractNo) && c.date && c.cashPrice
  );
  const skipped = contracts.length - loadable.length;
  if (skipped > 0)
    console.warn(`  Skipping ${skipped} contract(s) with missing name/date/price — see report`);

  const collectionByContract = new Map(collections.map((k) => [k.contractNo, k]));

  for (let i = 0; i < loadable.length; i += 200) {
    const batch = loadable.slice(i, i + 200);
    const { data, error } = await db
      .from("contracts")
      .insert(
        batch.map((c) => {
          // snapshot terms exactly as the app would compute them
          const dp = Math.round(c.cashPrice! * 25) / 100;
          let total = c.cashPrice!;
          if (c.term === 6) total = Math.round(c.cashPrice! * (1.3 * 0.75 + 0.25) * 100) / 100;
          if (c.term === 12) total = Math.round(c.cashPrice! * (1.5 * 0.75 + 0.25) * 100) / 100;
          const monthly = Math.round(((total - dp) / c.term) * 100) / 100;

          const kol = collectionByContract.get(c.contractNo);
          const status =
            kol && VALID_COLLECTION_STATUSES.has(kol.status) ? kol.status : null;

          return {
            contract_no: c.contractNo,
            customer_id: keyToId.get(contractCustomerKey.get(c.contractNo)!),
            contract_date: c.date,
            item_description: c.item || "(not specified)",
            item_type: c.itemType || null,
            quantity: c.quantity,
            cash_price: c.cashPrice,
            term_months: c.term,
            total_price: total,
            downpayment: dp,
            monthly_amortization: monthly,
            sales_agent: c.agent || null,
            delivery_status: c.deliveryStatus,
            payment_status: c.paymentStatus,
            collection_status: status,
          };
        })
      )
      .select("id, contract_no");
    if (error) throw new Error("contracts insert: " + error.message);
    data!.forEach((row) => contractNoToId.set(row.contract_no, row.id));
  }

  const loadablePayments = payments.filter(
    (p) => contractNoToId.has(p.contractNo) && p.date && p.amount
  );
  console.log(
    `Inserting ${loadablePayments.length} payments (${payments.length - loadablePayments.length} skipped)…`
  );
  for (let i = 0; i < loadablePayments.length; i += 200) {
    const batch = loadablePayments.slice(i, i + 200);
    const { error } = await db.from("payments").insert(
      batch.map((p) => ({
        payment_no: p.paymentNo,
        contract_id: contractNoToId.get(p.contractNo),
        payment_date: p.date,
        amount: p.amount,
        receipt_no: p.receiptNo || null,
        receipt_type: p.receiptType || null,
        reference_no: p.referenceNo || null,
      }))
    );
    if (error) throw new Error("payments insert: " + error.message);
  }

  console.log("Inserting notes…");
  const noteRows: Array<{ contract_id: string; body: string; created_at: string }> = [];
  for (const c of loadable) {
    const cid = contractNoToId.get(c.contractNo);
    if (!cid) continue;
    for (const n of splitNotes(c.notes)) {
      // batch inserts null out missing keys (no column default), so always
      // set created_at — untimestamped notes fall back to the contract date
      const at = n.at
        ? new Date(n.at.replace(" ", "T") + ":00+08:00")
        : new Date(c.date + "T00:00:00+08:00");
      noteRows.push({ contract_id: cid, body: n.body, created_at: at.toISOString() });
    }
  }
  for (let i = 0; i < noteRows.length; i += 200) {
    const { error } = await db.from("contract_notes").insert(noteRows.slice(i, i + 200));
    if (error) throw new Error("notes insert: " + error.message);
  }

  console.log("Seeding ID counters…");
  const counterRows: Array<{ scope: string; last_value: number }> = [];
  const byYear = new Map<string, number>();
  for (const no of contractNoToId.keys()) {
    // Only YYYY### style IDs seed counters; legacy plain-number IDs (1, 2, …)
    // from the early Sheet era don't participate in new-ID generation.
    const m = no.match(/^(20\d{2})(\d{3,})$/);
    if (!m) continue;
    byYear.set(m[1], Math.max(byYear.get(m[1]) ?? 0, Number(m[2])));
  }
  for (const [year, max] of byYear) counterRows.push({ scope: `contract:${year}`, last_value: max });
  const maxPay = Math.max(
    0,
    ...loadablePayments.map((p) => Number(p.paymentNo.replace(/^PAY/i, "")) || 0)
  );
  counterRows.push({ scope: "payment", last_value: maxPay });
  {
    const { error } = await db.from("id_counters").insert(counterRows);
    if (error) throw new Error("id_counters insert: " + error.message);
  }

  // ── Reconcile ──────────────────────────────────────────────
  console.log("\nReconciling…");
  const { count: dbContracts } = await db.from("contracts").select("*", { count: "exact", head: true });
  const { count: dbPayments } = await db.from("payments").select("*", { count: "exact", head: true });
  // PostgREST caps responses at 1000 rows — paginate to sum every payment
  let dbPaymentSum = 0;
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await db
      .from("payments")
      .select("amount")
      .range(from, from + 999);
    if (error) throw new Error("reconcile paging: " + error.message);
    for (const r of page ?? []) dbPaymentSum += Number(r.amount);
    if (!page || page.length < 1000) break;
  }

  const checks = [
    ["Contracts in DB", dbContracts, loadable.length],
    ["Payments in DB", dbPayments, loadablePayments.length],
    [
      "Payment sum in DB",
      Math.round(dbPaymentSum * 100) / 100,
      Math.round(loadablePayments.reduce((s, p) => s + p.amount!, 0) * 100) / 100,
    ],
  ] as const;

  let ok = true;
  for (const [label, actual, expected] of checks) {
    const pass = actual === expected;
    if (!pass) ok = false;
    console.log(`  ${pass ? "✅" : "❌"} ${label}: ${actual} (expected ${expected})`);
  }

  console.log(
    ok
      ? "\n✅ Load complete and reconciled. Spot-check 10-15 contracts in the app against the Sheet."
      : "\n❌ RECONCILIATION FAILED — do not use this data. Investigate before retrying."
  );
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\nLoad failed:", e.message);
  process.exit(1);
});
