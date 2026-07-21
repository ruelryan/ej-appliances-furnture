/**
 * Shared helpers for the E2E suite.
 *
 * The service client BYPASSES RLS — use it only for fixture lookups and
 * verification queries inside specs, never to mutate real data. All test
 * records carry the E2E_PREFIX so cleanup-test-data.ts can find them.
 */
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const E2E_PREFIX = "E2E TEST";

export type RoleName = "owner" | "admin" | "collector" | "sales_agent" | "delivery";

/** Storage-state file for a role, for `test.use({ storageState: authState("owner") })`. */
export function authState(role: RoleName): string {
  return path.join(__dirname, ".auth", `${role}.json`);
}

let service: SupabaseClient | null = null;

/** Service-role Supabase client (RLS bypass) for lookups/assertions. */
export function serviceClient(): SupabaseClient {
  if (!service) {
    service = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return service;
}

/** UUID of a test account, from .env.e2e. */
export function testUserId(key: "OWNER" | "ADMIN" | "COLLECTOR" | "AGENT" | "DELIVERY"): string {
  const id = process.env[`E2E_${key}_ID`];
  if (!id) throw new Error(`E2E_${key}_ID missing from .env.e2e`);
  return id;
}

/** Highest audit_log id right now — used to prove the read-only suite wrote nothing. */
export async function auditHighWater(): Promise<number> {
  const { data, error } = await serviceClient()
    .from("audit_log")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return data?.[0]?.id ?? 0;
}
