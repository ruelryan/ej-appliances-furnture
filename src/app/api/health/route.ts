import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// Unauthenticated keep-alive ping — a scheduled job hits this daily so the
// Supabase free-tier project never pauses for inactivity. Returns no data.
export async function GET() {
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await supabase
    .from("customers")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  return NextResponse.json({
    ok: !error,
    at: new Date().toISOString(),
  });
}
