/**
 * One-off correction: contract 2026190 (Salan, Ryan) was written up on the
 * 6-month schedule when the price agreed with the customer was the
 * good-as-cash price.
 *
 *   npx tsx scripts/fix-contract-2026190-term.ts            # dry run (rolls back)
 *   npx tsx scripts/fix-contract-2026190-term.ts --apply    # commits
 *
 * What happened. Elvira agreed 6 months to pay at the cash price, P23,900.
 * The app has no such term -- 4/5 months are good-as-cash, 6 months carries
 * +30% -- so the sale was entered as 6 months and computed P29,277.50, which
 * is P5,377.50 more than the customer was told. The customer queried it.
 *
 * Ryan's decision (2026-08-29): honour the agreed TOTAL and move the contract
 * to the 5-month good-as-cash schedule. The customer pays P23,900 as promised,
 * over 5 months at P3,585.00 rather than the 6 months they were told.
 *
 * Why correct in place rather than void and recreate. The contract already has
 * a payment (PAY6074, P4,000, receipt 1839) and a completed delivery
 * (DEL01543). Recreating would mint a new contract number, orphan the receipt
 * the customer is holding, and re-open a delivery that has already happened.
 * Only three columns are wrong. cash_price and downpayment are untouched --
 * they are identical on both schedules, which is what keeps the commission
 * basis and v_contract_dp correct (see 0022).
 *
 * This is NOT a reprice. propose_reprice/confirm_reprice escalate a contract UP
 * the ladder (4/5 -> 6 -> 12) against a signed amendment; there is nothing to
 * escalate and nothing to sign here. It is a data-entry correction, so it goes
 * through the same guard escape hatch those RPCs use and is recorded as a note.
 *
 * The new figures come from compute_terms() itself rather than being typed in,
 * so the arithmetic is the app's, not this script's. The audit trigger on
 * contracts records the three column changes on its own; impersonating the
 * owner is what attributes them to a real person.
 */
import pg, { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

// Raw 'YYYY-MM-DD' for date columns; node-postgres otherwise builds a JS Date
// in the local zone and shifts the day.
pg.types.setTypeParser(1082, (v) => v);

const APPLY = process.argv.includes("--apply");

const CONTRACT_NO = "2026190";
const NEW_TERM = 5;

/** The owner the correction is recorded against. Ruel Ryan Rosal. */
const ACTING_USER = "99fbe929-87e4-46b7-82c5-5ef7e55dd838";

/** Refuse to touch anything that is not the contract as we found it. */
const EXPECTED = { term_months: 6, cash_price: 23900, total_price: 29277.5 };

const NOTE =
  "Term corrected from 6 months to 5 months (good as cash) on 2026-08-29. " +
  "The price agreed with the customer by Elvira Rosal was the cash price, " +
  "P23,900.00, payable over 6 months. The app has no 6-month good-as-cash " +
  "term, so the sale was entered on the 6-month schedule and computed " +
  "P29,277.50 -- P5,377.50 more than agreed. Corrected to honour the agreed " +
  "total; cash price and downpayment are unchanged. Monthly is now P3,585.00 " +
  "over 5 months. Approved by Ruel Ryan Rosal.";

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

const peso = (n: number | string) =>
  "P" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const db = await connect();
  await db.query("begin");
  try {
    await db.query(
      `select set_config('request.jwt.claims',
                         json_build_object('sub', $1::text, 'role', 'authenticated')::text,
                         true)`,
      [ACTING_USER]
    );

    const { rows: found } = await db.query(
      `select id, contract_no, term_months, cash_price, total_price,
              downpayment, monthly_amortization, payment_status
         from public.contracts where contract_no = $1`,
      [CONTRACT_NO]
    );
    if (found.length !== 1) throw new Error(`Expected exactly one ${CONTRACT_NO}, found ${found.length}`);
    const c = found[0];

    console.log(`Contract ${c.contract_no} — before`);
    console.log(`  term                 ${c.term_months} months`);
    console.log(`  cash price           ${peso(c.cash_price)}`);
    console.log(`  total price          ${peso(c.total_price)}`);
    console.log(`  downpayment          ${peso(c.downpayment)}`);
    console.log(`  monthly              ${peso(c.monthly_amortization)}`);
    console.log(`  status               ${c.payment_status}\n`);

    if (Number(c.term_months) === NEW_TERM) {
      console.log("Already on the 5-month schedule — nothing to do.");
      await db.query("rollback");
      return;
    }
    if (
      Number(c.term_months) !== EXPECTED.term_months ||
      Number(c.cash_price) !== EXPECTED.cash_price ||
      Number(c.total_price) !== EXPECTED.total_price
    ) {
      throw new Error(
        `Contract is not in the state this correction was written for ` +
          `(expected ${JSON.stringify(EXPECTED)}). Refusing to touch it.`
      );
    }

    // The app's own arithmetic, not a number typed into this script.
    const { rows: t } = await db.query(
      `select * from public.compute_terms($1::numeric, $2::int)`,
      [c.cash_price, NEW_TERM]
    );
    const terms = t[0];

    if (Number(terms.downpayment) !== Number(c.downpayment)) {
      throw new Error(
        `compute_terms would move the downpayment ${peso(c.downpayment)} -> ` +
          `${peso(terms.downpayment)}; that would break the commission basis. Aborting.`
      );
    }

    await db.query(`select set_config('app.allow_terms_change', 'on', true)`);
    const { rowCount } = await db.query(
      `update public.contracts
          set term_months = $2,
              total_price = $3,
              monthly_amortization = $4,
              updated_at = now()
        where id = $1 and term_months = $5`,
      [c.id, NEW_TERM, terms.total_price, terms.monthly_amortization, EXPECTED.term_months]
    );
    await db.query(`select set_config('app.allow_terms_change', 'off', true)`);
    if (rowCount !== 1) throw new Error(`Expected to update 1 row, updated ${rowCount}`);

    await db.query(
      `insert into public.contract_notes (contract_id, body, created_by) values ($1, $2, $3)`,
      [c.id, NOTE, ACTING_USER]
    );

    const { rows: after } = await db.query(
      `select term_months, cash_price, total_price, downpayment, monthly_amortization
         from public.contracts where id = $1`,
      [c.id]
    );
    const a = after[0];
    console.log(`Contract ${c.contract_no} — after`);
    console.log(`  term                 ${a.term_months} months`);
    console.log(`  cash price           ${peso(a.cash_price)}   (unchanged)`);
    console.log(`  total price          ${peso(a.total_price)}   was ${peso(c.total_price)}`);
    console.log(`  downpayment          ${peso(a.downpayment)}   (unchanged)`);
    console.log(`  monthly              ${peso(a.monthly_amortization)}   was ${peso(c.monthly_amortization)}`);

    const { rows: fin } = await db.query(
      `select total_paid, expected_to_date, overdue_amount, remaining_balance, payment_status
         from public.v_contract_financials where id = $1`,
      [c.id]
    );
    const f = fin[0];
    console.log(`\nAccount now reads`);
    console.log(`  total paid           ${peso(f.total_paid)}`);
    console.log(`  expected to date     ${peso(f.expected_to_date)}`);
    console.log(`  overdue              ${peso(f.overdue_amount)}`);
    console.log(`  remaining balance    ${peso(f.remaining_balance)}   was ${peso(Number(c.total_price) - Number(f.total_paid))}`);
    console.log(`  status               ${f.payment_status}`);

    const { rows: audit } = await db.query(
      `select field, old_value, new_value from public.audit_log
        where table_name = 'contracts' and record_id = $1
        order by id desc limit 5`,
      [c.id]
    );
    console.log(`\nAudit rows written: ${audit.length ? "" : "(none)"}`);
    for (const r of audit) console.log(`  ${r.field}: ${r.old_value} -> ${r.new_value}`);

    if (APPLY) {
      await db.query("commit");
      console.log("\n✅ Committed.");
    } else {
      await db.query("rollback");
      console.log("\n🔁 Dry run — rolled back. Re-run with --apply to commit.");
    }
  } catch (e) {
    await db.query("rollback");
    console.error("\n❌ Rolled back:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
