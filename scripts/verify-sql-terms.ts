/**
 * Verifies the SQL compute_terms() function against the same golden fixture
 * that tests lib/amortization.ts — run after applying migrations:
 *
 *   npx tsx scripts/verify-sql-terms.ts
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { GOLDEN_CASES } from "../src/lib/amortization";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  let failed = 0;

  for (const c of GOLDEN_CASES) {
    const { data, error } = await db.rpc("compute_terms", {
      p_cash_price: c.cashPrice,
      p_term_months: c.termMonths,
    });

    if (error) {
      console.error(`❌ ₱${c.cashPrice} @ ${c.termMonths}mo — RPC error: ${error.message}`);
      failed++;
      continue;
    }

    const row = Array.isArray(data) ? data[0] : data;
    const got = {
      totalPrice: Number(row.total_price),
      downpayment: Number(row.downpayment),
      monthlyAmortization: Number(row.monthly_amortization),
    };

    const ok =
      got.totalPrice === c.expected.totalPrice &&
      got.downpayment === c.expected.downpayment &&
      got.monthlyAmortization === c.expected.monthlyAmortization;

    if (ok) {
      console.log(`✅ ₱${c.cashPrice} @ ${c.termMonths}mo`);
    } else {
      failed++;
      console.error(
        `❌ ₱${c.cashPrice} @ ${c.termMonths}mo\n   SQL: ${JSON.stringify(got)}\n   TS : ${JSON.stringify(c.expected)}`
      );
    }
  }

  console.log(failed === 0 ? "\nAll SQL term computations match the TypeScript fixture." : `\n${failed} mismatch(es) — SQL and TS must be brought back in sync.`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
