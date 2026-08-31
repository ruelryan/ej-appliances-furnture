import Link from "next/link";
import { redirect } from "next/navigation";
import {
  canPostPayments,
  canSeeBir,
  createClient,
  getProfile,
} from "@/lib/supabase/server";
import { SectionCard } from "@/components/section-card";
import { Alert } from "@/components/alert";
import { EmptyState } from "@/components/empty-state";
import { btnSecondary, pageStack, theadRow, td } from "@/components/ui";
import { SupplierManager, type SupplierRow } from "./supplier-manager";

export const dynamic = "force-dynamic";

export default async function BirSuppliersPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!canSeeBir(profile.role)) redirect("/");

  const canManage = canPostPayments(profile.role); // mirrors can_manage_bir()
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, address, tin, vat_registered, bir_name, active")
    .order("name");

  if (error) {
    return (
      <div className={pageStack}>
        <Header />
        <Alert tone="danger" title="Could not load suppliers.">
          {error.message}
        </Alert>
      </div>
    );
  }

  const rows = (data ?? []) as SupplierRow[];
  const missingTin = rows.filter((s) => s.vat_registered && !s.tin);

  return (
    <div className={pageStack}>
      <Header />

      {canManage && (
        <div>
          <SupplierManager mode="create" />
        </div>
      )}

      {missingTin.length > 0 && (
        <Alert tone="warning" title="Missing TIN on a VAT-registered supplier">
          {missingTin.length} supplier{missingTin.length === 1 ? " is" : "s are"}{" "}
          marked VAT-registered but {missingTin.length === 1 ? "has" : "have"} no
          TIN. The purchase journal needs it in the VAT REG NO. column:{" "}
          {missingTin.map((s) => s.name).join(", ")}.
        </Alert>
      )}

      <SectionCard
        title="Suppliers"
        sub="Shared with the delivery module — the same vendors you order stock from."
      >
        {rows.length === 0 ? (
          <EmptyState
            title="No suppliers yet"
            hint="Add the vendors that issue you invoices, with their TIN and whether they are VAT-registered."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead>
                <tr className={theadRow}>
                  <th className={td}>Name</th>
                  <th className={td}>TIN</th>
                  <th className={td}>VAT</th>
                  <th className={td}>Address</th>
                  {canManage && <th className={td}></th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    className={`border-b border-line last:border-0 ${s.active ? "" : "opacity-50"}`}
                  >
                    <td className={td}>
                      {s.name}
                      {s.bir_name && s.bir_name !== s.name && (
                        <span className="block text-micro text-muted">
                          BIR: {s.bir_name}
                        </span>
                      )}
                    </td>
                    <td className={`${td} font-mono text-xs`}>{s.tin ?? "—"}</td>
                    <td className={td}>
                      {s.vat_registered ? (
                        <span className="rounded-full bg-positive/10 px-2 py-0.5 text-micro font-semibold text-positive">
                          VAT
                        </span>
                      ) : (
                        <span className="text-micro text-muted">Non-VAT</span>
                      )}
                    </td>
                    <td className={`${td} text-xs text-muted`}>{s.address ?? "—"}</td>
                    {canManage && (
                      <td className={td}>
                        <SupplierManager mode="edit" row={s} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function Header() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">Suppliers</h1>
        <p className="text-xs text-muted">TIN and VAT registration for the purchase journal</p>
      </div>
      <div className="flex gap-2">
        <Link href="/bir" className={btnSecondary}>
          Summary
        </Link>
        <Link href="/bir/expenses" className={btnSecondary}>
          Expenses
        </Link>
      </div>
    </div>
  );
}
