"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayslip } from "./actions";
import { btnPrimary } from "@/components/ui";

// Semi-monthly periods that can be paid, most recent first (display list only
// — SQL validates and derives the real period bounds).
//
// The period IN PROGRESS is offered too, marked as such. It used to be hidden
// because create_payslip refused it, but the common case is a last duty that
// falls before the month end — Analyn works Mon–Thu, so her August ended on
// the 27th — and waiting until the 31st to hand her a payslip helped nobody.
// 0034 allows any period that has STARTED; the warning at finalize explains
// what an in-progress slip does and does not capture.
function completedPeriods(todayISO: string, count: number) {
  const out: Array<{ start: string; label: string; inProgress?: boolean }> = [];
  let y = Number(todayISO.slice(0, 4));
  let m = Number(todayISO.slice(5, 7));
  const day = Number(todayISO.slice(8, 10));
  const lastDay = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
  // The current half counts as offerable: 1st–15th is half 1, 16th on is half 2.
  let half = day >= 16 ? 2 : 1;
  // Which half is still running right now — that one gets the label.
  const liveY = y, liveM = m, liveHalf = half;

  while (out.length < count) {
    if (half === 0) {
      m--;
      if (m === 0) {
        m = 12;
        y--;
      }
      half = 2;
      continue;
    }
    const mm = String(m).padStart(2, "0");
    const start = half === 2 ? `${y}-${mm}-16` : `${y}-${mm}-01`;
    const month = new Date(y, m - 1, 1).toLocaleDateString("en-PH", {
      month: "long",
    });
    const label =
      half === 2
        ? `${month} 16–${lastDay(y, m)}, ${y}`
        : `${month} 1–15, ${y}`;
    const inProgress = y === liveY && m === liveM && half === liveHalf
      && !(half === 2 ? day >= lastDay(y, m) : day >= 15);
    out.push({ start, label: inProgress ? `${label} (in progress)` : label, inProgress });
    half--;
  }
  return out;
}

export function NewPayslipForm({
  employees,
  todayISO,
}: {
  employees: Array<{ id: string; full_name: string }>;
  todayISO: string;
}) {
  const router = useRouter();
  const periods = completedPeriods(todayISO, 8);
  const [employee, setEmployee] = useState(employees[0]?.id ?? "");
  const [period, setPeriod] = useState(periods[0]?.start ?? "");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function create() {
    setError("");
    startTransition(async () => {
      const res = await createPayslip(employee, period);
      if (res.error) setError(res.error);
      else router.push(`/payroll/${res.id}`);
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <select
          value={employee}
          onChange={(e) => setEmployee(e.target.value)}
          className="min-w-40 flex-1 rounded-card border border-line bg-white px-3 py-2.5 text-base"
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          className="min-w-40 flex-1 rounded-card border border-line bg-white px-3 py-2.5 text-base"
        >
          {periods.map((p) => (
            <option key={p.start} value={p.start}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={create}
          disabled={pending || !employee || !period}
          className={btnPrimary}
        >
          {pending ? "Creating…" : "Create payslip"}
        </button>
      </div>
      {error && (
        <p className="mt-2 rounded-card bg-danger-bg px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
