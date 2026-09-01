import { NextResponse } from "next/server";
import { createClient, getProfile } from "@/lib/supabase/server";
import { quoteIlikePattern } from "@/lib/supabase/filters";

export const dynamic = "force-dynamic";

/**
 * Typeahead for the jump-to-contract box on the contract page.
 *
 * A GET route handler rather than a server action, and that is the whole
 * reason it exists: a server action is a POST, and `middleware.ts` refuses
 * every non-GET while "View as" is active. A POST-backed typeahead would work
 * for everyone except the owner previewing another role — who is exactly the
 * person most likely to be poking at it.
 *
 * It uses the request's own session (`createClient`, anon key + cookie), never
 * the service role, so **RLS does the scoping**: a collector sees the contracts
 * assigned to them, a sales agent their own deals, a bookkeeper nothing at all.
 * There is deliberately no role check here beyond "is signed in" — adding one
 * would only risk disagreeing with the policies that already decide this.
 *
 * The `.or()` argument is PostgREST filter grammar, so the term is quoted:
 * an unescaped comma would start a condition of its own (0029, filters.ts).
 */
const LIMIT = 8;

export async function GET(request: Request) {
  const profile = await getProfile();
  if (!profile) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const term = (new URL(request.url).searchParams.get("q") ?? "").trim();
  // One character matches most of the book and helps nobody.
  if (term.length < 2) return NextResponse.json({ results: [] });

  const supabase = await createClient();
  const pattern = quoteIlikePattern(term);

  const { data, error } = await supabase
    .from("v_contract_financials")
    .select(
      "id, contract_no, display_name, item_description, payment_status, remaining_balance, contract_date"
    )
    .or(
      `contract_no.ilike.${pattern},display_name.ilike.${pattern},item_description.ilike.${pattern}`
    )
    .order("contract_date", { ascending: false })
    .limit(LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ results: data ?? [] });
}
