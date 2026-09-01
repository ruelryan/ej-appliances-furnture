/**
 * Does the app's sales book agree with the Sales Journal we actually filed?
 *
 *   npx tsx scripts/verify-bir-sales.ts --file <journal.xlsx | drive-download.json>
 *
 * Read-only. Never writes. Worth running before each quarterly filing, which is
 * why it lives here rather than being a throwaway.
 *
 * The workbook is "E & J Sales and Purchase Journal", whose tabs
 * "Sales - Appliances" and "Sales - Furniture" are the Summary List of Sales
 * for the two VAT registrations. Accepts either an .xlsx saved from
 * File > Download > Microsoft Excel, or a Drive download_file_content JSON —
 * the same two shapes scripts/extract-tabs.ts takes.
 *
 * ── Two things that will bite whoever edits this ──────────────
 *
 * 1. Invoice numbers MUST be read with `raw: true`. The 2024 series numbers are
 *    twelve digits (230140005451) and Excel formats them for display as
 *    "2.3014E+11" — with raw:false the digits are simply gone.
 *
 * 2. The comparison key is (branch, invoice_no), NOT invoice_no alone. Each
 *    registration has its own booklet, and 0042 removed the unique index after
 *    finding that short booklet numbers recycle and one receipt can cover two
 *    contracts.
 */
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > -1 ? process.argv[fileArg + 1] : "";
if (!FILE) {
  console.error("Usage: npx tsx scripts/verify-bir-sales.ts --file <journal.xlsx | drive-download.json>");
  process.exit(1);
}

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

/** The sales book begins when the store became VAT-registered. */
const VAT_START = "2024-01-01";

const TABS: Array<[tab: string, branch: string]> = [
  ["Sales - Appliances", "appliances"],
  ["Sales - Furniture", "furniture"],
];

interface JournalRow {
  branch: string;
  invoice: string;
  name: string;
  total: number;
  date: string;
}

const money = (v: unknown): number =>
  Number(String(v ?? "0").replace(/[, ₱]/g, "")) || 0;

const peso = (n: number) => n.toLocaleString("en-PH", { minimumFractionDigits: 2 });

function loadWorkbook(src: string): XLSX.WorkBook {
  if (src.toLowerCase().endsWith(".json") || src.toLowerCase().endsWith(".txt")) {
    const payload = JSON.parse(fs.readFileSync(src, "utf8"));
    return XLSX.read(Buffer.from(payload.content, "base64"), { type: "buffer" });
  }
  return XLSX.readFile(src);
}

function readJournal(wb: XLSX.WorkBook): JournalRow[] {
  const out: JournalRow[] = [];
  for (const [tab, branch] of TABS) {
    const sheet = wb.Sheets[tab];
    if (!sheet) {
      console.error(`⚠ tab "${tab}" not found — tabs are: ${wb.SheetNames.join(" | ")}`);
      continue;
    }
    // raw:true — see the header note about 2.3014E+11.
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1, raw: true, defval: "",
    });
    const hi = rows.findIndex((r) => r.some((c) => /INVOICE NUMBERS/i.test(String(c))));
    if (hi < 0) continue;
    const ix: Record<string, number> = {};
    (rows[hi] as unknown[]).forEach((c, i) => {
      const k = String(c).trim();
      if (k && !(k in ix)) ix[k] = i;
    });

    for (const r of rows.slice(hi + 1)) {
      const inv = r[ix["INVOICE NUMBERS"]];
      if (inv === "" || inv === undefined || inv === null) continue;
      out.push({
        branch,
        invoice: String(inv).trim(),
        name: String(r[ix["NAME"]] ?? "").trim(),
        total: money(r[ix["TOTAL INVOICE AMOUNT"]]),
        date: String(r[ix["DATE"]] ?? "").trim(),
      });
    }
  }
  return out;
}

async function main() {
  console.log(`${path.basename(FILE)}\n`);
  const journal = readJournal(loadWorkbook(FILE));

  const entries: {
    contract_id: string | null; sales_date: string; invoice_no: string; branch: string;
    gross_snapshot: number; customer_name_snapshot: string;
  }[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await db
      .from("bir_sales_entries")
      .select("contract_id, sales_date, invoice_no, branch, gross_snapshot, customer_name_snapshot")
      .is("cancelled_at", null)
      .order("id")
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    entries.push(...((data ?? []) as typeof entries));
    if (!data || data.length < 1000) break;
  }

  const live = entries.filter((e) => e.sales_date >= VAT_START);
  const key = (b: string, i: string) => `${b}|${i}`;

  // GROUPED, not a plain Map keyed by invoice. One receipt can cover two
  // contracts (0042), and the app then holds one entry PER CONTRACT under that
  // number while the journal has a single row for the combined invoice. Keeping
  // only one entry per key reported five false disagreements on the first run —
  // Asialink invoice 26 is 16,500 + 29,000 = 45,500, exactly what the journal
  // says.
  const appByKey = new Map<string, typeof live>();
  for (const e of live) {
    const k = key(e.branch, e.invoice_no);
    const list = appByKey.get(k);
    if (list) list.push(e);
    else appByKey.set(k, [e]);
  }
  const appTotal = (k: string) =>
    (appByKey.get(k) ?? []).reduce((t, e) => t + Number(e.gross_snapshot), 0);
  const journalByKey = new Map(journal.map((j) => [key(j.branch, j.invoice), j]));

  console.log("                                   count            value");
  console.log(`journal rows (declared)      : ${String(journal.length).padStart(5)}  ${peso(journal.reduce((t, j) => t + j.total, 0)).padStart(15)}`);
  console.log(`app entries from ${VAT_START} : ${String(live.length).padStart(5)}  ${peso(live.reduce((t, e) => t + Number(e.gross_snapshot), 0)).padStart(15)}`);
  if (entries.length !== live.length) {
    console.log(`(${entries.length - live.length} live entries are dated before ${VAT_START} — they should not exist)`);
  }

  const missing = journal.filter((j) => !appByKey.has(key(j.branch, j.invoice)));
  const extra = live.filter((e) => !journalByKey.has(key(e.branch, e.invoice_no)));

  const mismatched: string[] = [];
  for (const j of journal) {
    const k = key(j.branch, j.invoice);
    const group = appByKey.get(k);
    if (!group) continue;
    const total = appTotal(k);
    if (Math.abs(total - j.total) > 0.01) {
      const parts = group.length > 1 ? ` (${group.length} contracts)` : "";
      mismatched.push(
        `  ${j.branch.padEnd(11)} inv ${j.invoice.padEnd(14)} ${j.name.slice(0, 22).padEnd(22)} journal ${peso(j.total).padStart(12)}  app ${peso(total).padStart(12)}${parts}`
      );
    }
  }

  const section = (title: string, lines: string[], n = 10) => {
    console.log(`\n${title}: ${lines.length}`);
    lines.slice(0, n).forEach((l) => console.log(l));
    if (lines.length > n) console.log(`  … and ${lines.length - n} more`);
  };

  section(
    "IN THE JOURNAL BUT NOT IN THE APP",
    missing.map((j) =>
      `  ${j.branch.padEnd(11)} inv ${j.invoice.padEnd(14)} ${j.name.slice(0, 24).padEnd(24)} ${peso(j.total).padStart(12)}`
    )
  );
  section(
    "IN THE APP BUT NOT IN THE JOURNAL",
    extra.map((e) =>
      `  ${e.branch.padEnd(11)} inv ${String(e.invoice_no).padEnd(14)} ${String(e.customer_name_snapshot).slice(0, 24).padEnd(24)} ${peso(Number(e.gross_snapshot)).padStart(12)}  ${e.sales_date}`
    )
  );
  section("AMOUNT DISAGREES", mismatched);

  // Only a delivered item is a sale (0044). book_sale enforces it now, but
  // anything declared before that guard existed can still be sitting here, and
  // a sale declared for an item that was never delivered is the one case that
  // would need putting right with the BIR.
  const undelivered: string[] = [];
  {
    const ids = live.map((e) => e.contract_id).filter(Boolean) as string[];
    const status = new Map<string, string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await db
        .from("v_bir_sales_register")
        .select("contract_id, delivery_status")
        .in("contract_id", ids.slice(i, i + 200));
      (data ?? []).forEach((r) =>
        status.set(String(r.contract_id), String(r.delivery_status ?? "not recorded"))
      );
    }
    for (const e of live) {
      if (!e.contract_id) continue; // a standalone entry has no delivery to check
      const st = status.get(e.contract_id);
      if (st && st !== "delivered") {
        undelivered.push(
          `  ${e.branch.padEnd(11)} inv ${String(e.invoice_no).padEnd(14)} ${String(e.customer_name_snapshot).slice(0, 24).padEnd(24)} ${peso(Number(e.gross_snapshot)).padStart(12)}  ${e.sales_date}  delivery=${st}`
        );
      }
    }
  }
  section("DECLARED BUT NOT DELIVERED", undelivered);

  const clean = !missing.length && !extra.length && !mismatched.length && !undelivered.length;
  console.log(
    clean
      ? "\n✅ The app's sales book and the filed journal agree."
      : "\n⚠ Differences above. Each one is a judgement for the office — nothing here writes."
  );
}

main().catch((e) => {
  console.error(`\n❌ ${e.message ?? e}`);
  process.exit(1);
});
