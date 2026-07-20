import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, fmtDateShort } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { SubmitLeadForm } from "./submit-lead-form";
import { RejectButton } from "./reject-button";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  new: "bg-warning-bg text-warning",
  converted: "bg-positive/10 text-positive",
  rejected: "bg-danger-bg text-danger",
};

export default async function LeadsPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const role = profile.role;
  const canManage = role === "owner" || role === "admin" || role === "staff";
  const isAgent = role === "sales_agent";
  if (!canManage && !isAgent) redirect("/");

  const supabase = await createClient();
  // RLS scopes agents to their own leads.
  const { data: leads } = await supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false });

  const all = leads ?? [];
  const newLeads = all.filter((l) => l.status === "new");
  const resolved = all.filter((l) => l.status !== "new");

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-ink">Leads</h1>

      {isAgent && (
        <SectionCard title="Submit a lead" sub="Send a customer's details to the office.">
          <SubmitLeadForm />
        </SectionCard>
      )}

      <SectionCard title={canManage ? "New leads" : "My leads"}>
        {(isAgent ? all : newLeads).length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            {isAgent ? "No leads submitted yet." : "No new leads to review."}
          </p>
        ) : (
          <div className="space-y-2">
            {(isAgent ? all : newLeads).map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">
                      {l.customer_name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        STATUS_STYLE[l.status]
                      }`}
                    >
                      {l.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="truncate text-xs text-muted">
                    #{l.lead_no} · {l.item_description}
                    {l.estimated_price != null ? ` · ${peso(l.estimated_price)}` : ""}
                    {l.phone ? ` · ${l.phone}` : ""} · {fmtDateShort(l.created_at)}
                  </div>
                </div>
                {canManage && l.status === "new" && (
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/contracts/new?leadId=${l.id}`}
                      className="rounded-card bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-dark"
                    >
                      Convert
                    </Link>
                    <RejectButton leadId={l.id} />
                  </div>
                )}
                {l.status === "converted" && l.contract_id && (
                  <Link
                    href={`/contracts/${l.contract_id}`}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    View contract
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {canManage && resolved.length > 0 && (
        <SectionCard title="Resolved leads">
          <div className="space-y-2">
            {resolved.map((l) => (
              <div
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <span className="font-medium text-ink">{l.customer_name}</span>
                  <span className="ml-2 text-xs text-muted">
                    #{l.lead_no} · {l.item_description}
                    {l.reject_reason ? ` · ${l.reject_reason}` : ""}
                  </span>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    STATUS_STYLE[l.status]
                  }`}
                >
                  {l.status.toUpperCase()}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
