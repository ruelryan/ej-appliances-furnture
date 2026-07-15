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
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
        Admin
      </h1>

      {/* Users */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
          Users
        </h2>
        <div className="mb-4 space-y-2">
          {(users ?? []).map((u) => (
            <div
              key={u.id}
              className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-slate-800"
            >
              <div>
                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                  {u.full_name}
                </span>
                <span
                  className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    u.role === "owner"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                      : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300"
                  }`}
                >
                  {u.role.toUpperCase()}
                </span>
                {!u.active && (
                  <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 dark:bg-red-900 dark:text-red-200">
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
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-1 text-sm font-bold text-slate-700 dark:text-slate-300">
          Data exports
        </h2>
        <p className="mb-3 text-xs text-slate-400">
          CSV downloads — open directly in Excel or Google Sheets. Do a full
          export weekly as an offline backup.
        </p>
        <div className="flex flex-wrap gap-2">
          {exports.map((e) => (
            <a
              key={e.href}
              href={e.href}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              ⬇️ {e.label}
            </a>
          ))}
        </div>
      </section>

      {/* Audit log */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-3 text-sm font-bold text-slate-700 dark:text-slate-300">
          Recent changes (audit log)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500 dark:border-slate-700">
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
                <tr key={a.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-slate-400">
                    {new Date(a.changed_at).toLocaleString("en-PH", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                  <td className="py-1.5 pr-3">{userName(a.changed_by)}</td>
                  <td className="py-1.5 pr-3">{a.table_name}</td>
                  <td className="py-1.5 pr-3 font-medium">{a.field}</td>
                  <td className="max-w-40 truncate py-1.5 pr-3 text-slate-400">
                    {a.old_value ?? "—"}
                  </td>
                  <td className="max-w-40 truncate py-1.5">{a.new_value ?? "—"}</td>
                </tr>
              ))}
              {(audit ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
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
