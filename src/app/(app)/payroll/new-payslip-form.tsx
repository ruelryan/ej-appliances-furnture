"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPayslip } from "./actions";
import { btnPrimary } from "@/components/ui";

// Completed semi-monthly periods, most recent first (display list only —
// SQL validates and derives the real period bounds).
function completedPeriods(todayISO: string, count: number) {
  const out: Array<{ start: string; label: string }> = [];
  let y = Number(todayISO.slice(0, 4));
  let m = Number(todayISO.slice(5, 7));
  const day = Number(todayISO.slice(8, 10));
  // which halves are complete this month?
  let half = day >= 31 ? 2 : day >= 15 ? 1 : 0; // 2nd half only complete at month end
  const lastDay = (yy: number, mm: number) => new Date(yy, mm, 0).getDate();
  if (day >= lastDay(y, m)) half = 2;

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
    out.push({ start, label });
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
