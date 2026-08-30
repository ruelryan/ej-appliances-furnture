import { notFound, redirect } from "next/navigation";
import { createClient, getProfile } from "@/lib/supabase/server";
import { fmtDateShort, fmtHours, monthLabel, periodLabel, peso } from "@/lib/format";
import { holidayLinesOf } from "@/lib/payslip-lines";
import { Letterhead, SignatureBlocks } from "../../letterhead";
import { PrintControls } from "../../print-controls";

export const dynamic = "force-dynamic";

type PayslipLine = { label: string; amount: number };

export default async function PrintPayslipPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // /print/* renders outside the authenticated shell and print/layout.tsx has
  // no auth of its own, so each page carries its own gate. RLS decides WHICH
  // rows come back (payslips_select: the owner, or your own final slips); this
  // is what stops a deactivated account with a still-valid cookie from
  // rendering at all, since getProfile returns null unless active.
  const profile = await getProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();

  const { data: slip } = await supabase
    .from("payslips")
    // payslips has several FKs to profiles — name the employee one
    .select("*, profiles!profile_id(full_name)")
    .eq("id", id)
    .maybeSingle();
  if (!slip) notFound();

  const employeeName =
    (slip.profiles as unknown as { full_name: string })?.full_name ?? "—";
  const extraIncome = slip.extra_income as PayslipLine[];
  const holidayLines = holidayLinesOf(slip.holiday_lines);
  const extraDeductions = slip.extra_deductions as PayslipLine[];
  const contributions = [
    { name: "PhilHealth", ee: slip.philhealth_ee, er: slip.philhealth_er },
    { name: "SSS", ee: slip.sss_ee, er: slip.sss_er },
    { name: "Pag-IBIG", ee: slip.pagibig_ee, er: slip.pagibig_er },
  ].filter((c) => Number(c.ee) > 0 || Number(c.er) > 0);

  return (
    <div className="text-sm">
      <PrintControls
        filename={`payslip-${employeeName.replace(/\W+/g, "-")}-${slip.period_start}`}
      />
      <Letterhead />
      <h1 className="mb-1 text-center text-base font-semibold">PAYSLIP</h1>
      <div className="mb-4 text-center text-xs">
        <span className="font-semibold">{employeeName}</span> ·{" "}
        {periodLabel(slip.period_start, slip.period_end)}
      </div>

      {slip.status === "draft" && (
        <div className="mb-4 border-2 border-warning p-2 text-center text-xs font-semibold text-warning">
          DRAFT — NOT FINAL
        </div>
      )}

      <table className="w-full text-xs">
        <tbody>
          <tr className="border-b-2 border-ink">
            <td colSpan={2} className="py-1 font-semibold">
              INCOME
            </td>
          </tr>
          {/* Regular time and holidays are itemised separately — on the copy
              the employee keeps, "why is this month different" should be
              readable off the page. basic_pay + the holiday amounts reconcile
              to dtr_pay exactly (0036). */}
          <tr className="border-b border-line">
            <td className="py-1.5 pr-4">
              Regular pay — {fmtHours(slip.dtr_hours)} hrs ×{" "}
              {peso(slip.hourly_rate)}/hr ({slip.days_worked} days)
            </td>
            <td className="py-1.5 text-right tabular-nums">
              {peso(slip.basic_pay)}
            </td>
          </tr>
          {holidayLines.map((h, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1.5 pr-4">
                {h.worked ? "Holiday premium" : "Holiday pay"} — {h.name}
                {" ("}
                {fmtDateShort(h.date)}
                {h.worked ? `, ${fmtHours(h.hours)} hrs worked` : ", not worked"}
                {")"}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {peso(h.amount)}
              </td>
            </tr>
          ))}
          {Number(slip.meal_allowance) > 0 && (
            <tr className="border-b border-line">
              <td className="py-1.5 pr-4">
                Meal allowance — {slip.days_worked} day(s) worked
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {peso(slip.meal_allowance)}
              </td>
            </tr>
          )}
          {extraIncome.map((l, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1.5 pr-4">{l.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {peso(l.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-b border-line font-semibold">
            <td className="py-1.5 pr-4">TOTAL INCOME</td>
            <td className="py-1.5 text-right tabular-nums">
              {peso(slip.total_income)}
            </td>
          </tr>

          <tr className="border-b-2 border-ink">
            <td colSpan={2} className="py-1 pt-3 font-semibold">
              DEDUCTIONS
              {contributions.length > 0 &&
                ` — ${monthLabel(slip.period_start.slice(0, 7))} contributions`}
            </td>
          </tr>
          {contributions.map((c) => (
            <tr key={c.name} className="border-b border-line">
              <td className="py-1.5 pr-4">
                {c.name} (EE {peso(c.ee)} · ER {peso(c.er)})
              </td>
              <td className="py-1.5 text-right tabular-nums">{peso(c.ee)}</td>
            </tr>
          ))}
          {extraDeductions.map((l, i) => (
            <tr key={i} className="border-b border-line">
              <td className="py-1.5 pr-4">{l.label}</td>
              <td className="py-1.5 text-right tabular-nums">
                {peso(l.amount)}
              </td>
            </tr>
          ))}
          {contributions.length === 0 && extraDeductions.length === 0 && (
            <tr className="border-b border-line">
              <td colSpan={2} className="py-1.5 text-muted">
                None
              </td>
            </tr>
          )}
          <tr className="border-b border-line font-semibold">
            <td className="py-1.5 pr-4">TOTAL DEDUCTIONS</td>
            <td className="py-1.5 text-right tabular-nums">
              {peso(slip.total_deductions)}
            </td>
          </tr>

          <tr>
            <td className="py-3 pr-4 font-semibold">NET SALARY</td>
            <td className="py-3 text-right text-lg font-semibold tabular-nums">
              {peso(slip.net_pay)}
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-2 text-[10px] text-muted">
        Regular pay is hours worked at the plain hourly rate. Holiday lines are
        the extra above that rate — an unworked regular holiday pays 8 hours,
        and a worked one adds its premium on top of the hours already counted
        as regular pay. Holiday pay and meal allowance are not part of basic
        salary for 13th-month purposes; meal allowance is paid per day actually
        worked. ER amounts are the employer&apos;s contribution shares, shown
        for record purposes only.
      </p>

      <SignatureBlocks left={employeeName} right="Owner / Manager" />
    </div>
  );
}
