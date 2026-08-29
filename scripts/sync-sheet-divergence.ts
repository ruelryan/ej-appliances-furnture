/**
 * One-off reconciliation: fold the Google Sheet's post-cutover divergence
 * back into the app database.
 *
 *   npx tsx scripts/sync-sheet-divergence.ts            # dry run (rolls back)
 *   npx tsx scripts/sync-sheet-divergence.ts --apply    # commits
 *
 * Background. The Sheet kept being used after the 2026-07-20 cutover, so two
 * systems minted IDs independently. This script re-derives the divergence from
 * the workbook every run (it trusts no precomputed file) and applies it:
 *
 *   1. contract 2026160 in the app is the Sheet's 2026163 — renumber it. The
 *      app's counter was 3 behind, so it reused numbers the Sheet had spent.
 *   2. create the contracts the Sheet has and the app does not
 *   3. record the payments the Sheet has and the app does not
 *   4. fix the two records where the two systems disagree (Sheet wins)
 *   5. carry over delivery status and the owner's contract closures
 *   6. leave id_counters above every number now in use
 *
 * Payment numbers are NOT carried over. From PAY5939 the same PAY#### means a
 * different payment in each system, and payments.payment_no is unique — reusing
 * the Sheet's numbers would collide with real rows. Imported payments get fresh
 * numbers from the counter, so app payment numbers no longer track the Sheet's.
 *
 * Everything runs inside ONE transaction against the real RPCs, impersonating
 * the owner, so compute_terms, the counters, the delivery trigger and the 0032
 * payment caps all behave exactly as they do for a user in the browser. A dry
 * run does the identical work and then rolls back, which is why it is a real
 * test and not a guess.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import pg, { Client } from "pg";
import dotenv from "dotenv";
import * as XLSX from "xlsx";

dotenv.config({ path: ".env.local" });

// Hand back `date` columns as the raw 'YYYY-MM-DD' string. node-postgres otherwise
// builds a JS Date in the local zone, which both shifts the day and breaks every
// string comparison against the Sheet — the bug that made this script think all
// 6,009 payments were missing.
pg.types.setTypeParser(1082, (v) => v);

const APPLY = process.argv.includes("--apply");

const DATA_DIR =
  process.env.EANDJ_DATA_DIR ?? path.join(os.homedir(), "Documents", "eandj-data");
const BOOK =
  process.argv.find((a) => a.endsWith(".xlsx")) ??
  path.join(DATA_DIR, "eandj-sheet-2026-08-20.xlsx");

/** The owner whose identity the RPCs run under. Ruel Ryan Rosal. */
const ACTING_USER = "99fbe929-87e4-46b7-82c5-5ef7e55dd838";

/** The app number that collided, and the Sheet number it should carry. */
const RENUMBER = { from: "2026160", to: "2026163" };

/**
 * Cash prices the Sheet is missing, supplied by the owner. A contract with no
 * price cannot be created — compute_terms would make the whole schedule zero —
 * so without an entry here the row is skipped and reported instead.
 * 30120: ₱14,900, confirmed by Ryan 2026-08-20.
 */
const PRICE_OVERRIDES: Record<string, number> = { "30120": 14900 };

/** Sheet "Delivery Status" → deliveries.status */
const DELIVERY_MAP: Record<string, string> = {
  Delivered: "delivered",
  "Out for Delivery": "in_stock",
  "To order": "to_order",
  "Ordered from supplier": "ordered",
  Cancelled: "cancelled",
  Pending: "pending",
};

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_PASSWORD in .env.local");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

const REGIONS = [
  "ap-south-1", "ap-southeast-1", "ap-southeast-2", "ap-northeast-1",
  "ap-northeast-2", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
  "eu-west-1", "eu-west-2", "eu-west-3", "eu-central-1", "eu-central-2",
  "eu-north-1", "ca-central-1", "sa-east-1",
];
const CANDIDATES = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  ...REGIONS.flatMap((r) => [
    { host: `aws-1-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
    { host: `aws-0-${r}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  ]),
];

async function connect(): Promise<Client> {
  const errors: string[] = [];
  for (const c of CANDIDATES) {
    const client = new Client({
      host: c.host, port: c.port, user: c.user, password,
      database: "postgres", ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${c.host}\n`);
      return client;
    } catch (e) {
      errors.push(`${c.host}: ${(e as Error).message}`);
    }
  }
  console.error("Could not connect:\n  " + errors.join("\n  "));
  process.exit(1);
}

// ── helpers ──────────────────────────────────────────────────────────────
/** Excel serial → ISO date. Excel's epoch is 1899-12-30 (its 1900 leap bug). */
const ser = (n: unknown): string | null =>
  n == null || n === "" ? null
    : new Date(Date.UTC(1899, 11, 30) + Number(n) * 86_400_000).toISOString().slice(0, 10);
/** Compare people's names without punctuation/case/diacritic noise. */
const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z]/g, "");
const txt = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s === "" || s === "null" ? null : s;
};
const money = (n: unknown) => Number(Number(n).toFixed(2));
const peso = (n: number) => "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Row = Record<string, unknown>;
function tab(wb: XLSX.WorkBook, name: string, headerRow: number) {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], {
    header: 1, raw: true, defval: null,
  });
  const head = raw[headerRow] as unknown[];
  const idx = Object.fromEntries(head.map((h, i) => [String(h).trim(), i]));
  const rows: Row[] = [];
  for (let i = headerRow + 1; i < raw.length; i++) {
    const r = raw[i];
    if (!r) continue;
    const o: Row = {};
    for (const [k, i2] of Object.entries(idx)) o[k] = r[i2 as number];
    rows.push(o);
  }
  return { rows, idx };
}

async function main() {
  if (!fs.existsSync(BOOK)) {
    console.error(`Workbook not found: ${BOOK}`);
    process.exit(1);
  }
  console.log(`Sheet : ${BOOK}`);
  console.log(`Mode  : ${APPLY ? "APPLY (will COMMIT)" : "DRY RUN (will ROLLBACK)"}\n`);

  const wb = XLSX.readFile(BOOK);
  const sc = tab(wb, "Contracts Database", 1).rows
    .filter((r) => r["Contract ID"] != null)
    .map((r) => ({
      no: String(r["Contract ID"]).trim(),
      date: ser(r["Date"]),
      name: txt(r["Customer name"]),
      phone: txt(r["Contact number"]),
      fb: txt(r["FB link"]),
      address: txt(r["Address"]),
      item: txt(r["Item Description"]),
      itemType: txt(r["Item Type"]),
      qty: Number(r["Quantity"] ?? 1) || 1,
      cash:
        r["Cash Price"] != null ? money(r["Cash Price"])
          : PRICE_OVERRIDES[String(r["Contract ID"]).trim()] ?? null,
      agent: txt(r["Sales Agent"]),
      notes: txt(r["Notes"]),
      delivery: txt(r["Delivery Status"]),
      payStatus: txt(r["Payment Status"]),
      term: r["Current Term"] == null ? null : Number(r["Current Term"]),
    }));
  const sp = tab(wb, "Payments Database", 0).rows
    .filter((r) => r["Payment ID"] != null)
    .map((r) => ({
      payNo: String(r["Payment ID"]).trim(),
      date: ser(r["Date"]),
      name: txt(r["Customer's Name"]),
      amount: money(r["Amount Paid"]),
      contractNo: txt(r["Contract no."]),
      receiptNo: txt(r["Receipt no."]),
      receiptType: txt(r["Receipt Type"]),
      ref: txt(r["Reference no."]),
    }));

  const client = await connect();
  const q = async <T = Row>(sql: string, params: unknown[] = []) =>
    (await client.query(sql, params)).rows as T[];

  // ── read the app side ──────────────────────────────────────────────────
  const dbC = await q<{ id: string; contract_no: string; contract_date: string;
    customer_id: string; cash_price: string; payment_status: string }>(
    `select id, contract_no, contract_date, customer_id, cash_price, payment_status
       from contracts order by contract_no`);
  const dbP = await q<{ id: string; payment_no: string; contract_id: string;
    payment_date: string; amount: string; voided_at: string | null }>(
    `select id, payment_no, contract_id, payment_date, amount, voided_at
       from payments order by payment_no`);
  const dbCust = await q<{ id: string; display_name: string }>(
    `select id, display_name from customers`);

  const noById = new Map(dbC.map((c) => [c.id, c.contract_no]));
  const idByNo = new Map(dbC.map((c) => [c.contract_no, c.id]));
  const custByName = new Map<string, string>();
  for (const c of dbCust) if (!custByName.has(norm(c.display_name))) custByName.set(norm(c.display_name), c.id);

  console.log(`App : ${dbC.length} contracts, ${dbP.length} payments, ${dbCust.length} customers`);
  console.log(`Sheet: ${sc.length} contracts, ${sp.length} payments\n`);

  // ── is the renumber still owed? ────────────────────────────────────────
  // This must be decided before anything else reads contract numbers, and it
  // must be idempotent: once done, RENUMBER.from is a DIFFERENT, real contract
  // (the Sheet's own 2026160), and renaming it again would destroy it. The
  // presence of RENUMBER.to is the proof the work is finished.
  const renumberDone = dbC.some((c) => c.contract_no === RENUMBER.to);
  const ren = renumberDone ? undefined : dbC.find((c) => c.contract_no === RENUMBER.from);

  // ── work out what is missing ───────────────────────────────────────────
  // While the renumber is still owed, the app's RENUMBER.from row stands for
  // RENUMBER.to; afterwards every number already means what it says.
  const asSheet = (n: string | undefined) =>
    ren && n === RENUMBER.from ? RENUMBER.to : n;
  const appNos = new Set(dbC.map((c) => asSheet(c.contract_no)!));
  const missingContracts = sc
    .filter((c) => !appNos.has(c.no))
    .filter((c) => c.cash != null)          // 30120 has no price — skipped, reported below
    .sort((a, b) => a.no.localeCompare(b.no));
  const skippedNoPrice = sc.filter((c) => !appNos.has(c.no) && c.cash == null);

  // Payments are matched on what they are, not on PAY#### — the numbers diverged.
  const key = (c: string | null | undefined, d: string | null, a: number) =>
    `${c}|${d}|${a.toFixed(2)}`;
  const appPayCount = new Map<string, number>();
  for (const p of dbP) {
    const k = key(asSheet(noById.get(p.contract_id)), p.payment_date, money(p.amount));
    appPayCount.set(k, (appPayCount.get(k) ?? 0) + 1);
  }
  const missingPayments: typeof sp = [];
  const seen = new Map<string, number>();
  for (const p of sp) {
    const k = key(p.contractNo, p.date, p.amount);
    const used = seen.get(k) ?? 0;
    if (used < (appPayCount.get(k) ?? 0)) seen.set(k, used + 1);
    else missingPayments.push(p);
  }
  // The two the owner ruled on: the Sheet is right.
  type Conflict = {
    contractNo: string;
    match: { amount: number; date: string };   // how the app holds it now
    set: { amount?: number; payment_date?: string };
    why: string;
  };
  const CONFLICTS: Conflict[] = [
    { contractNo: "2025181", match: { amount: 7000, date: "2026-07-29" }, set: { payment_date: "2026-07-27" },
      why: "Sheet dates this payment 07-27" },
    { contractNo: "165", match: { amount: 1695, date: "2026-08-12" }, set: { amount: 1800 },
      why: "Sheet records ₱1,800, app has ₱1,695" },
  ];
  // Look for the fixed state first. Once applied the "before" values are gone, and
  // a second run must recognise its own work rather than report the row missing.
  const conflictTargets = CONFLICTS.map((c) => {
    const mine = (p: (typeof dbP)[number]) =>
      noById.get(p.contract_id) === c.contractNo && !p.voided_at;
    const want = {
      amount: c.set.amount ?? c.match.amount,
      date: c.set.payment_date ?? c.match.date,
    };
    const already = dbP.find(
      (p) => mine(p) && money(p.amount) === want.amount && p.payment_date === want.date);
    const row = already ? undefined
      : dbP.find((p) => mine(p) &&
          money(p.amount) === c.match.amount && p.payment_date === c.match.date);
    return { ...c, row, already };
  });
  // The app already holds a row for each conflict; do not import the Sheet's copy too.
  const conflictKeys = new Set(CONFLICTS.map((c) =>
    key(c.contractNo, c.set.payment_date ?? c.match.date, c.set.amount ?? c.match.amount)));
  const toImport = missingPayments.filter((p) => !conflictKeys.has(key(p.contractNo, p.date, p.amount)));

  // ── report ─────────────────────────────────────────────────────────────
  const line = (s = "") => console.log(s);
  line("─".repeat(72));
  line(`1. RENUMBER   ${RENUMBER.from} → ${RENUMBER.to}`);
  if (!ren) line(`   already done — ${RENUMBER.to} exists`);
  else line(`   ${ren.contract_date}  ${dbCust.find((x) => x.id === ren.customer_id)?.display_name}  ${peso(Number(ren.cash_price))}`);

  line();
  line(`2. CREATE     ${missingContracts.length} contracts`);
  for (const c of missingContracts)
    line(`   ${c.no}  ${c.date}  ${String(c.name).padEnd(26).slice(0, 26)}  ${c.term}mo  ${peso(c.cash!).padStart(12)}  ${c.delivery}${c.payStatus === "Close" ? "  [close]" : ""}`);
  for (const c of skippedNoPrice)
    line(`   SKIP ${c.no}  ${c.date}  ${c.name} — no cash price in the Sheet`);

  line();
  const tot = toImport.reduce((t, p) => t + p.amount, 0);
  line(`3. PAYMENTS   ${toImport.length} to record, ${peso(tot)}`);
  for (const p of toImport)
    line(`   ${p.date}  contract ${String(p.contractNo).padEnd(8)} ${peso(p.amount).padStart(12)}  OR ${p.receiptNo ?? "-"}   (was ${p.payNo} in the Sheet)`);

  line();
  line(`4. CONFLICTS  ${conflictTargets.length}`);
  for (const c of conflictTargets)
    line(`   contract ${c.contractNo}: ${
      c.already ? `already applied (${c.already.payment_no})`
        : c.row ? c.row.payment_no : "NOT FOUND"} — ${c.why}`);

  line("─".repeat(72));
  line();

  if (!ren && missingContracts.length === 0 && toImport.length === 0) {
    line("Nothing to do.");
    await client.end();
    return;
  }

  // ── apply ──────────────────────────────────────────────────────────────
  await client.query("begin");
  // Transaction-local: every RPC below sees auth.uid() = ACTING_USER.
  await client.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [ACTING_USER]);

  const done = { renamed: 0, customers: 0, contracts: 0, payments: 0, conflicts: 0, deliveries: 0, closed: 0 };

  try {
    // 1. renumber
    if (ren) {
      const r = await q(`update contracts set contract_no = $1
                          where contract_no = $2 returning id`, [RENUMBER.to, RENUMBER.from]);
      if (r.length !== 1) throw new Error(`renumber touched ${r.length} rows`);
      done.renamed = 1;
      idByNo.set(RENUMBER.to, r[0].id as string);
      idByNo.delete(RENUMBER.from);
    }

    // 2. contracts (ascending, so the counter walks forward naturally)
    for (const c of missingContracts) {
      // find or create the customer
      let custId = custByName.get(norm(c.name));
      if (!custId) {
        const comma = String(c.name).indexOf(",");
        const last = comma < 0 ? String(c.name).trim() : String(c.name).slice(0, comma).trim();
        const first = comma < 0 ? "" : String(c.name).slice(comma + 1).trim();
        const ins = await q<{ id: string }>(
          `insert into customers (last_name, first_name, phones, messenger_url, address)
           values ($1, $2, $3, $4, $5) returning id`,
          [last, first || "-", c.phone ? [c.phone] : [], c.fb, c.address]);
        custId = ins[0].id;
        custByName.set(norm(c.name), custId);
        done.customers++;
      }

      // create_contract always mints <year of contract_date><3 digits> from
      // id_counters. Where the Sheet number has that shape we aim the counter and
      // land on it exactly — the UPDATE also locks the counter row for the rest of
      // the transaction, so nothing can slip in between. Where it does not (30120
      // and friends, legacy numbers predating the scheme) we let it mint a natural
      // number, rename, and put that year's counter back so we leave no gap.
      const year = c.date!.slice(0, 4);
      const scope = `contract:${year}`;
      const native = new RegExp(`^${year}\\d{3}$`).test(c.no);
      const counterBefore = await q<{ last_value: number }>(
        `select last_value from id_counters where scope = $1`, [scope]);

      if (native) {
        await client.query(
          `update id_counters set last_value = $1 where scope = $2`,
          [Number(c.no.slice(4)) - 1, scope]);
      }

      const made = await q<{ contract_no: string; id: string }>(
        `select id, contract_no from create_contract(
            $1::uuid, $2::date, $3::text, $4::text, $5::int, $6::numeric,
            $7::int, $8::text, $9::text)`,
        [custId, c.date, c.item, c.itemType, c.qty, c.cash, c.term, c.agent, c.notes]);

      if (native) {
        if (made[0].contract_no !== c.no)
          throw new Error(`expected ${c.no}, create_contract gave ${made[0].contract_no}`);
      } else {
        const r = await q(`update contracts set contract_no = $1 where id = $2 returning id`,
          [c.no, made[0].id]);
        if (r.length !== 1) throw new Error(`rename to ${c.no} touched ${r.length} rows`);
        if (counterBefore.length) {
          await client.query(`update id_counters set last_value = $1 where scope = $2`,
            [counterBefore[0].last_value, scope]);
        } else {
          // we created this scope purely to mint a number we then threw away
          await client.query(`delete from id_counters where scope = $1`, [scope]);
        }
      }
      idByNo.set(c.no, made[0].id);
      done.contracts++;

      // delivery: the after-insert trigger already made a 'pending' row
      const want = DELIVERY_MAP[c.delivery ?? "Pending"] ?? "pending";
      if (want !== "pending") {
        const del = await q<{ id: string }>(
          `select id from deliveries where contract_id = $1`, [made[0].id]);
        if (del.length) {
          if (want === "delivered") {
            await client.query(`select mark_delivered($1::uuid, $2::text)`,
              [del[0].id, "Imported from the Sheet on cutover reconciliation"]);
          } else if (want === "in_stock" || want === "to_order") {
            await client.query(`select set_delivery_availability($1::uuid, $2::boolean)`,
              [del[0].id, want === "in_stock"]);
          } else if (want === "cancelled") {
            // no RPC sets 'cancelled' — the app cannot reach this state
            await client.query(`update deliveries set status = 'cancelled' where id = $1`, [del[0].id]);
          }
          done.deliveries++;
        }
      }
    }

    // leave the counter above every 2026 number now in use
    const maxSeq = Math.max(
      ...[...idByNo.keys()].filter((n) => /^2026\d{3}$/.test(n)).map((n) => Number(n.slice(4))));
    await client.query(
      `update id_counters set last_value = $1 where scope = 'contract:2026'`, [maxSeq]);

    // 3. payments — before any contract is closed (0032 refuses a closed one)
    for (const p of toImport) {
      const cid = idByNo.get(p.contractNo!);
      if (!cid) throw new Error(`payment ${p.payNo}: no contract ${p.contractNo} in the app`);
      await client.query(
        `select record_payment($1::uuid, $2::date, $3::numeric, $4::text, $5::text, $6::text)`,
        [cid, p.date, p.amount, p.receiptNo, p.receiptType?.trim() ?? null, p.ref]);
      done.payments++;
    }

    // 4. conflicts — direct updates, caught by the audit_payments trigger
    for (const c of conflictTargets) {
      if (c.already) continue;
      if (!c.row) throw new Error(`conflict on contract ${c.contractNo}: target payment not found`);
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(c.set)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
      vals.push(c.row.id);
      const r = await q(`update payments set ${sets.join(", ")} where id = $${vals.length} returning id`, vals);
      if (r.length !== 1) throw new Error(`conflict update touched ${r.length} rows`);
      done.conflicts++;
    }

    // 5. closures the owner made in the Sheet
    for (const c of missingContracts.filter((x) => x.payStatus === "Close")) {
      await client.query(`select close_contract($1::uuid)`, [idByNo.get(c.no)]);
      done.closed++;
    }

    // ── verify before deciding to commit ─────────────────────────────────
    const [{ n: cCount }] = await q<{ n: string }>(`select count(*)::text n from contracts`);
    const [{ n: pCount }] = await q<{ n: string }>(`select count(*)::text n from payments`);
    const [{ n: dupe }] = await q<{ n: string }>(
      `select count(*)::text n from (select contract_no from contracts
         group by contract_no having count(*) > 1) x`);
    const [{ v: ctr }] = await q<{ v: string }>(
      `select last_value::text v from id_counters where scope = 'contract:2026'`);

    line("Applied:");
    line(`   renumbered   ${done.renamed}`);
    line(`   customers    ${done.customers} new`);
    line(`   contracts    ${done.contracts}`);
    line(`   payments     ${done.payments}`);
    line(`   conflicts    ${done.conflicts}`);
    line(`   deliveries   ${done.deliveries}`);
    line(`   closed       ${done.closed}`);
    line();
    line(`   contracts now ${cCount} (was ${dbC.length})`);
    line(`   payments  now ${pCount} (was ${dbP.length})`);
    line(`   duplicate contract numbers: ${dupe}`);
    line(`   contract:2026 counter → ${ctr}  (next sale is 2026${String(Number(ctr) + 1).padStart(3, "0")})`);
    line();

    if (dupe !== "0") throw new Error("duplicate contract numbers after the run — refusing to commit");

    if (APPLY) {
      await client.query("commit");
      line("✅ COMMITTED.");
    } else {
      await client.query("rollback");
      line("↩️  DRY RUN — rolled back, nothing changed. Re-run with --apply to commit.");
    }
  } catch (e) {
    await client.query("rollback");
    console.error("\n❌ Rolled back. Nothing was changed.");
    console.error((e as Error).message);
    await client.end();
    process.exit(1);
  }

  await client.end();
}

main();
