import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtHours, monthLabel, periodLabel, peso } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { BackLink } from "@/components/back-link";
import { btnSecondary } from "@/components/ui";
import { LineEditor } from "./line-editor";
import { SlipActions } from "./slip-actions";
import type { Payslip } from "../types";

export const dynamic = "force-dynamic";

export default async function PayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await getProfile();
  if (!profile) redirect("/login");
  const isOwner = profile.role === "owner";
  const supabase = await createClient();

  const { data } = await supabase
    .from("payslips")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound(); // staff hitting a draft URL lands here via RLS
  const slip = data as Payslip;

  const { data: employee } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", slip.profile_id)
    .single();

  const contributions = [
    { name: "PhilHealth", ee: slip.philhealth_ee, er: slip.philhealth_er },
    { name: "SSS", ee: slip.sss_ee, er: slip.sss_er },
    { name: "Pag-IBIG", ee: slip.pagibig_ee, er: slip.pagibig_er },
  ].filter((c) => Number(c.ee) > 0 || Number(c.er) > 0);
  const negative = Number(slip.net_pay) < 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BackLink />
          <h1 className="text-xl font-semibold text-ink">
            {employee?.full_name ?? "—"}
          </h1>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              slip.status === "final"
                ? "bg-positive/10 text-positive-dark"
                : "bg-warning-bg text-warning"
            }`}
          >
            {slip.status === "final" ? "Final" : "Draft"}
          </span>
        </div>
        <Link href={`/print/payslip/${slip.id}`} className={btnSecondary}>
          Print / JPG
        </Link>
      </div>
      <p className="text-sm text-muted">
        {periodLabel(slip.period_start, slip.period_end)}
      </p>

      <SectionCard title="Income">
        <div className="divide-y divide-line text-sm">
          <div className="flex items-center justify-between py-2">
            <span className="text-ink">
              DTR pay — {fmtHours(slip.dtr_hours)} hrs ×{" "}
              {peso(slip.hourly_rate)}/hr
              <span className="block text-xs text-muted">
                {slip.days_worked} day(s) · holiday premiums included
              </span>
            </span>
            <span className="tabular-nums text-ink">{peso(slip.dtr_pay)}</span>
          </div>
          {slip.extra_income.map((l, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <span className="text-ink">{l.label}</span>
              <span className="tabular-nums text-ink">{peso(l.amount)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between py-2 font-semibold text-ink">
            <span>TOTAL INCOME</span>
            <span className="tabular-nums">{peso(slip.total_income)}</span>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="Deductions"
        sub={
          contributions.length > 0
            ? `${monthLabel(slip.period_start.slice(0, 7))} contributions — EE share deducted; ER share is the employer's, shown for records.`
            : "No government contributions on this payslip (they come out of the 16–end slip)."
        }
      >
        <div className="divide-y divide-line text-sm">
          {contributions.map((c) => (
            <div key={c.name} className="flex items-center justify-between py-2">
              <span className="text-ink">
                {c.name}
                <span className="ml-1 text-xs text-muted">
                  (EE {peso(c.ee)} · ER {peso(c.er)})
                </span>
              </span>
              <span className="tabular-nums text-ink">{peso(c.ee)}</span>
            </div>
          ))}
          {slip.extra_deductions.map((l, i) => (
            <div key={i} className="flex items-center justify-between py-2">
              <span className="text-ink">{l.label}</span>
              <span className="tabular-nums text-ink">{peso(l.amount)}</span>
            </div>
          ))}
          {contributions.length === 0 &&
            slip.extra_deductions.length === 0 && (
              <p className="py-2 text-sm text-muted">No deductions.</p>
            )}
          <div className="flex items-center justify-between py-2 font-semibold text-ink">
            <span>TOTAL DEDUCTIONS</span>
            <span className="tabular-nums">{peso(slip.total_deductions)}</span>
          </div>
        </div>
      </SectionCard>

      <div
        className={`flex items-center justify-between rounded-card border p-4 ${
          negative ? "border-danger/40 bg-danger-bg" : "border-line bg-white"
        }`}
      >
        <span className="font-semibold text-ink">NET SALARY</span>
        <span
          className={`text-lg font-semibold tabular-nums ${
            negative ? "text-danger" : "text-ink"
          }`}
        >
          {peso(slip.net_pay)}
        </span>
      </div>

      {isOwner && slip.status === "draft" && (
        <SectionCard
          title="Adjustments"
          sub="Add one-off income (out-of-office duty, allowance) or deductions (cash advance). Totals recompute on save."
        >
          <LineEditor
            slipId={slip.id}
            extraIncome={slip.extra_income}
            extraDeductions={slip.extra_deductions}
          />
        </SectionCard>
      )}

      {isOwner && <SlipActions slipId={slip.id} status={slip.status} />}
    </div>
  );
}
