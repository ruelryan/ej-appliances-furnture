import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { CreateUserForm } from "./create-user-form";
import { ToggleActiveButton } from "./toggle-active-button";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const profile = await getProfile();
  if (profile?.role !== "owner") redirect("/");

  const supabase = await createClient();

  const [{ data: users }, { data: audit }] = await Promise.all([
    supabase.from("profiles").select("*").order("created_at"),
    supabase
      .from("audit_log")
      .select("*")
      .order("changed_at", { ascending: false })
      .limit(50),
  ]);

  const userName = (id: string | null) =>
    users?.find((u) => u.id === id)?.full_name ?? "system";

  const exports = [
    { href: "/api/export/contracts", label: "Contracts" },
    { href: "/api/export/payments", label: "Payments" },
    { href: "/api/export/aging", label: "Aging report" },
    { href: "/api/export/customers", label: "Customers" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-navy">
        Admin
      </h1>

      {/* Users */}
      <section className="rounded-card border border-surface bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy">
          Users
        </h2>
        <div className="mb-4 space-y-2">
          {(users ?? []).map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-card bg-surface px-3 py-2"
            >
              <div>
                <span className="text-sm font-medium text-navy">
                  {u.full_name}
                </span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    u.role === "owner"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-surface text-navy"
                  }`}
                >
                  {u.role.toUpperCase()}
                </span>
                {!u.active && (
                  <span className="ml-2 rounded bg-danger-bg px-1.5 py-0.5 text-[10px] font-bold text-danger">
                    DEACTIVATED
                  </span>
                )}
              </div>
              {u.id !== profile.id && (
                <ToggleActiveButton userId={u.id} active={u.active} />
              )}
            </div>
          ))}
        </div>
        <CreateUserForm />
      </section>

      {/* Exports */}
      <section className="rounded-card border border-surface bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-navy">
          Data exports
        </h2>
        <p className="mb-3 text-xs text-muted">
          CSV downloads — open directly in Excel or Google Sheets. Do a full
          export weekly as an offline backup.
        </p>
        <div className="flex flex-wrap gap-2">
          {exports.map((e) => (
            <a
              key={e.href}
              href={e.href}
              className="rounded-card border border-surface px-3 py-1.5 text-sm font-medium text-navy hover:bg-surface"
            >
              ⬇️ {e.label}
            </a>
          ))}
        </div>
      </section>

      {/* Audit log */}
      <section className="rounded-card border border-surface bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-navy">
          Recent changes (audit log)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface text-left text-muted">
                <th className="py-1.5 pr-3">When</th>
                <th className="py-1.5 pr-3">Who</th>
                <th className="py-1.5 pr-3">Table</th>
                <th className="py-1.5 pr-3">Field</th>
                <th className="py-1.5 pr-3">Old</th>
                <th className="py-1.5">New</th>
              </tr>
            </thead>
            <tbody>
              {(audit ?? []).map((a) => (
                <tr key={a.id} className="border-b border-surface">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-muted">
                    {new Date(a.changed_at).toLocaleString("en-PH", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-1.5 pr-3">{userName(a.changed_by)}</td>
                  <td className="py-1.5 pr-3">{a.table_name}</td>
                  <td className="py-1.5 pr-3 font-medium">{a.field}</td>
                  <td className="max-w-40 truncate py-1.5 pr-3 text-muted">
                    {a.old_value ?? "—"}
                  </td>
                  <td className="max-w-40 truncate py-1.5">{a.new_value ?? "—"}</td>
                </tr>
              ))}
              {(audit ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-muted">
                    No changes recorded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
