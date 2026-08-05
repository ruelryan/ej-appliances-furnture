/**
 * Helpers for building PostgREST filter strings safely.
 *
 * `.eq()` / `.ilike()` are safe on their own — supabase-js sends those values
 * as URL-encoded parameters. `.or()` is different: the whole string is parsed
 * as PostgREST's filter GRAMMAR, where `,` separates conditions, `.` separates
 * column.operator.value, and parentheses group. Interpolating raw user input
 * into it lets the caller inject their own conditions — a query for
 * `x,payment_status.eq.closed` becomes an extra filter rather than a search
 * term.
 *
 * PostgREST accepts a double-quoted value to carry reserved characters
 * literally, with backslash escaping inside. Quoting is the fix.
 */

/**
 * Quote a value for use inside an `.or()` / `.and()` filter string.
 * Returns the value WITH its surrounding double quotes.
 */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Quote a `%term%` ILIKE pattern for use inside an `.or()` filter string.
 * The `%` wildcards stay meaningful; only the grammar characters are neutered.
 */
export function quoteIlikePattern(term: string): string {
  return quoteFilterValue(`%${term}%`);
}
