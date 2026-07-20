import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { periodLabel, peso, phTodayISO } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";
import { NewPayslipForm } from "./new-payslip-form";
import type { Payslip } from "./types";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  const [slipsRes, profilesRes] = await Promise.all([
    supabase
      .from("payslips")
      .select("*")
      .order("period_start", { ascending: false })
      .limit(50),
    isOwner
      ? supabase
          .from("profiles")
          .select("id, full_name")
          .eq("active", true)
          .order("full_name")
      : Promise.resolve({ data: null }),
  ]);

  const slips = (slipsRes.data ?? []) as Payslip[];
  const employees = (profilesRes.data ?? []) as Array<{
    id: string;
    full_name: string;
  }>;
  const nameById = new Map(employees.map((e) => [e.id, e.full_name]));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-ink">Payroll</h1>
        </div>
        {isOwner && (
          <Link
            href="/payroll/13th-month"
            className="rounded-card border border-line bg-white px-3 py-2 text-sm font-semibold text-ink hover:bg-surface"
          >
            13th month
          </Link>
        )}
      </div>

      {isOwner && (
        <SectionCard
          title="New payslip"
          sub="Income comes from the DTR for the period; government contributions are deducted on the 16–end payslip."
        >
          <NewPayslipForm employees={employees} todayISO={phTodayISO()} />
        </SectionCard>
      )}

      <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
        {slips.map((s) => (
          <Link
            key={s.id}
            href={`/payroll/${s.id}`}
            className="flex items-center justify-between gap-2 p-4 hover:bg-surface"
          >
            <div className="min-w-0">
              <div className="font-semibold text-ink">
                {isOwner ? `${nameById.get(s.profile_id) ?? "—"} · ` : ""}
                {periodLabel(s.period_start, s.period_end)}
              </div>
              <div className="text-xs text-muted">
                {Number(s.dtr_hours).toFixed(2)} hrs · {s.days_worked} day(s)
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  s.status === "final"
                    ? "bg-positive/10 text-positive-dark"
                    : "bg-warning-bg text-warning"
                }`}
              >
                {s.status === "final" ? "Final" : "Draft"}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {peso(s.net_pay)}
              </span>
            </div>
          </Link>
        ))}
        {slips.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            {isOwner
              ? "No payslips yet — create the first one above."
              : "No payslips yet."}
          </p>
        )}
      </div>
    </div>
  );
}
