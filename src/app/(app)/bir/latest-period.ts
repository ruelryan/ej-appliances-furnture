import "server-only";
import type { createClient } from "@/lib/supabase/server";

/**
 * The most recent month that actually holds records.
 *
 * Opening /bir with no `?period=` used to default to the current month, which
 * is the obvious choice and the wrong one. On 2026-08-31 the newest expense in
 * the book was 2026-06-30 — the bookkeeper's workbook has no Q3 tab yet — so
 * the first thing anyone saw on clicking BIR was a page of zeroes, and it read
 * as the module being broken rather than as an empty month. Picking another
 * month made the figures appear, which made it look stranger still.
 *
 * A period is only meaningful once something has been recorded in it, so the
 * landing period is the newest one that has. The caller says which book it
 * cares about, and tells the reader when the jump happened — silently showing
 * June while the calendar says August would trade one confusion for another.
 *
 * Returns "YYYY-MM", or null when the book is empty and the current month is
 * as good an answer as any.
 */
export async function latestPeriodWithData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  source: "expenses" | "sales" | "both"
): Promise<string | null> {
  const dates: string[] = [];

  if (source !== "sales") {
    const { data } = await supabase
      .from("bir_expenses")
      .select("expense_date")
      .is("voided_at", null)
      .order("expense_date", { ascending: false })
      .limit(1);
    if (data?.[0]?.expense_date) dates.push(String(data[0].expense_date));
  }

  if (source !== "expenses") {
    const { data } = await supabase
      .from("bir_sales_entries")
      .select("sales_date")
      .is("cancelled_at", null)
      .order("sales_date", { ascending: false })
      .limit(1);
    if (data?.[0]?.sales_date) dates.push(String(data[0].sales_date));
  }

  if (!dates.length) return null;
  dates.sort();

  // For ONE book, the newest date is the answer.
  //
  // For BOTH, it is the EARLIER of the two newest — the lagging book decides.
  // Taking the later one guarantees only that *a* book has records, and the
  // summary shows both: on 2026-08-31 sales ran to 25 August while expenses
  // stopped at 30 June (no Q3 tab in the workbook yet), so "newest" landed on
  // August, where the expense tiles were zero and Net VAT read as output tax
  // with nothing subtracted. Flattering, and not what anyone would file.
  return (source === "both" ? dates[0] : dates.at(-1)!).slice(0, 7);
}
