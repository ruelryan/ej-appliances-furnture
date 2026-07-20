import { redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { peso, phTodayISO } from "@/lib/format";
import { SectionCard } from "@/components/section-card";
import { StatTile } from "@/components/stat-tile";
import { BackLink } from "@/components/back-link";
import { theadRow } from "@/components/ui";
import { RecordPaymentForm } from "./record-payment-form";

export const dynamic = "force-dynamic";

interface Row {
  profile_id: string;
  full_name: string;
  year: number;
  slips: number;
  basic_earned: string | number;
  entitlement: string | number;
  paid_amount: string | number;
  balance: string | number;
  last_paid: string | null;
}

export default async function ThirteenthMonthPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "owner") redirect("/");

  const { year: yearParam } = await searchParams;
  const year = Number(yearParam) || new Date(phTodayISO()).getFullYear();

  const supabase = await createClient();
  const { data } = await supabase
    .from("v_thirteenth_month")
    .select("*")
    .eq("year", year)
    .order("full_name");

  const rows = (data ?? []) as Row[];
  const totalEntitlement = rows.reduce((s, r) => s + Number(r.entitlement), 0);
  const totalPaid = rows.reduce((s, r) => s + Number(r.paid_amount), 0);
  const outstanding = totalEntitlement - totalPaid;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-ink">
          <BackLink /> 13th-month pay {year}
        </h1>
        <p className="mt-1 text-sm text-muted">
          One twelfth of basic salary earned this year. Due in full by 24
          December.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Total due" value={peso(totalEntitlement)} />
        <StatTile label="Paid" value={peso(totalPaid)} />
        <StatTile
          label="Still owed"
          value={peso(outstanding)}
          alert={outstanding > 0}
        />
      </div>

      <SectionCard
        title="By employee"
        sub="Basic salary excludes the meal allowance, holiday premiums and unworked-holiday pay — only finalised payslips count."
      >
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            No finalised payslips for {year} yet, so there is nothing to
            compute from.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className={theadRow}>
                  <th className="py-1.5 pr-3 text-left">Employee</th>
                  <th className="py-1.5 pr-3 text-right">Basic earned</th>
                  <th className="py-1.5 pr-3 text-right">Entitlement</th>
                  <th className="py-1.5 pr-3 text-right">Paid</th>
                  <th className="py-1.5 pr-3 text-right">Balance</th>
                  <th className="py-1.5 text-right">Record</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.profile_id} className="border-b border-line">
                    <td className="py-2 pr-3 font-medium text-ink">
                      {r.full_name}
                      <span className="block text-xs font-normal text-muted">
                        {r.slips} finalised payslip(s)
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-right">{peso(r.basic_earned)}</td>
                    <td className="py-2 pr-3 text-right font-semibold">
                      {peso(r.entitlement)}
                    </td>
                    <td className="py-2 pr-3 text-right">{peso(r.paid_amount)}</td>
                    <td
                      className={`py-2 pr-3 text-right font-semibold ${
                        Number(r.balance) > 0 ? "text-danger" : "text-positive"
                      }`}
                    >
                      {peso(r.balance)}
                    </td>
                    <td className="py-2 text-right">
                      <RecordPaymentForm
                        profileId={r.profile_id}
                        name={r.full_name}
                        year={r.year}
                        suggested={Number(r.balance)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <p className="text-xs text-muted">
        Basic salary is the ×1.00 portion of DTR pay — hours worked × hourly
        rate. Holiday premiums, unworked-holiday pay and the meal allowance are
        excluded, which is what the DOLE rules require. Drafts are ignored:
        only a finalised payslip is a fact.
      </p>
    </div>
  );
}
