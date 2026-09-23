/**
 * One-off: mark the six government sales in the BIR sales book.
 *
 * 0045 added `sale_type` with a default of 'Private', which is right for
 * nearly every row and wrong for six. A government buyer withholds VAT, so the
 * type is not cosmetic — it changes how the sale is treated in the return.
 *
 * The six were found by searching the live book for school / LGU buyers and
 * ruled government by Ryan on 2026-09-23. They are pinned here by
 * (sales_date, invoice_no, branch) rather than by a name pattern: a pattern
 * re-run next year would sweep up rows nobody has ruled on.
 *
 * Quantity is passed back UNCHANGED. `update_sale_entry_details` takes both
 * columns together, and this script has no opinion about counts.
 *
 * Why `pg` and not the service-role client: the RPC is guarded by
 * `can_manage_bir()`, which reads `auth.uid()`. A service-role script has no
 * JWT user, so the guard would refuse it — and going around the RPC by writing
 * the table directly would skip the very checks this fix should be subject to.
 * Instead the transaction impersonates the owner, exactly as
 * sync-sheet-divergence.ts does, and the RPC runs as it does in the browser.
 *
 *   npx tsx scripts/fix-bir-government-sales.ts            # dry run, rolls back
 *   npx tsx scripts/fix-bir-government-sales.ts --apply    # commits
 */
import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

const OWNER_EMAIL = "ruelryanrosal@gmail.com";

/** Ruled government by Ryan, 2026-09-23. */
const GOVERNMENT_SALES: { salesDate: string; invoiceNo: string; branch: string; who: string }[] = [
  { salesDate: "2024-03-06", invoiceNo: "1", branch: "appliances", who: "Inopacan National High School" },
  { salesDate: "2024-11-18", invoiceNo: "58", branch: "appliances", who: "Nahulid Elementary School" },
  { salesDate: "2026-03-19", invoiceNo: "96", branch: "furniture", who: "Union Elementary School" },
  { salesDate: "2026-03-23", invoiceNo: "97", branch: "furniture", who: "Union Elementary School" },
  { salesDate: "2026-08-17", invoiceNo: "126", branch: "furniture", who: "Camang Elementary School" },
  { salesDate: "2024-12-12", invoiceNo: "32", branch: "furniture", who: "LGU - San Ricardo" },
];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url || !password) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_PASSWORD in .env.local");
  process.exit(1);
}
const ref = new URL(url).hostname.split(".")[0];

const CANDIDATES = [
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  { host: "aws-1-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
  { host: "aws-0-ap-south-1.pooler.supabase.com", port: 5432, user: `postgres.${ref}` },
];

async function connect(): Promise<Client> {
  const errors: string[] = [];
  for (const c of CANDIDATES) {
    const client = new Client({
      host: c.host,
      port: c.port,
      user: c.user,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      console.log(`Connected via ${c.host}`);
      return client;
    } catch (e) {
      errors.push(`${c.host}: ${(e as Error).message}`);
    }
  }
  console.error("Could not connect:\n  " + errors.join("\n  "));
  process.exit(1);
}

async function main() {
  const client = await connect();

  const owner = await client.query(
    `select id from auth.users where email = $1`,
    [OWNER_EMAIL]
  );
  if (owner.rowCount !== 1) {
    console.error(`Expected exactly one account for ${OWNER_EMAIL}, found ${owner.rowCount}`);
    process.exit(1);
  }
  const ownerId = owner.rows[0].id as string;

  await client.query("begin");
  await client.query("set local lock_timeout = '5s'");
  await client.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [ownerId]
  );

  let changed = 0;
  let skipped = 0;
  try {
    for (const g of GOVERNMENT_SALES) {
      const row = await client.query(
        `select id, customer_name_snapshot, gross_snapshot, quantity, sale_type
           from public.bir_sales_entries
          where sales_date = $1 and invoice_no = $2 and branch = $3
            and cancelled_at is null`,
        [g.salesDate, g.invoiceNo, g.branch]
      );

      if (row.rowCount !== 1) {
        console.log(
          `  ?  ${g.salesDate}  inv ${g.invoiceNo} [${g.branch}]  ${g.who} — ${row.rowCount} matching rows, skipped`
        );
        skipped++;
        continue;
      }

      const r = row.rows[0];
      if (r.sale_type === "Government") {
        console.log(`  =  ${g.salesDate}  inv ${g.invoiceNo}  ${r.customer_name_snapshot} — already Government`);
        skipped++;
        continue;
      }

      await client.query(`select public.update_sale_entry_details($1, $2, $3)`, [
        r.id,
        "Government",
        r.quantity,
      ]);
      console.log(
        `  ->  ${g.salesDate}  inv ${String(g.invoiceNo).padEnd(4)} ${String(
          r.customer_name_snapshot
        ).slice(0, 32).padEnd(34)} ${String(r.gross_snapshot).padStart(12)}  Private -> Government (qty ${r.quantity} kept)`
      );
      changed++;
    }

    const after = await client.query(
      `select count(*) filter (where sale_type = 'Government') as gov,
              count(*) filter (where sale_type = 'Private') as priv,
              sum(gross_snapshot) filter (where sale_type = 'Government')::numeric(14,2) as gov_gross
         from public.bir_sales_entries where cancelled_at is null`
    );
    console.log(`\nAfter: ${after.rows[0].gov} Government (₱${after.rows[0].gov_gross}), ${after.rows[0].priv} Private`);
    console.log(`Changed ${changed}, skipped ${skipped}.`);

    if (APPLY) {
      await client.query("commit");
      console.log("✅ committed");
    } else {
      await client.query("rollback");
      console.log("↩️  dry run — rolled back. Re-run with --apply to commit.");
    }
  } catch (e) {
    await client.query("rollback");
    console.error("❌ rolled back:", (e as Error).message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
