"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { peso } from "@/lib/format";

// Chart tokens come from globals.css (validated palette; dark values swap
// automatically via the CSS custom properties).
const C1 = "var(--chart-1)";
const C2 = "var(--chart-2)";
const GRID = "var(--chart-grid)";
const AXIS = "var(--chart-axis)";

const monthLabel = (m: string) =>
  new Date(m + (m.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-PH", {
    month: "short",
    year: "2-digit",
  });

const compactPeso = (v: number) =>
  "₱" + Intl.NumberFormat("en-PH", { notation: "compact" }).format(v);

const axisTick = { fontSize: 11, fill: AXIS };

function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-card border border-line bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-ink">
        {label}
      </div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-1.5 text-ink">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: p.color }}
          />
          {p.name}: <span className="font-medium">{peso(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function MonthlyBars({
  data,
}: {
  data: Array<{ month: string; contract_value_total: number; contract_count: number }>;
}) {
  const rows = data.map((d) => ({
    label: monthLabel(d.month),
    "Contract value": Number(d.contract_value_total),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} tickFormatter={compactPeso} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(137,135,129,0.08)" }} />
        <Bar dataKey="Contract value" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CollectionsVsExpected({
  data,
}: {
  data: Array<{ month: string; expected: number; collected: number }>;
}) {
  const rows = data.map((d) => ({
    label: monthLabel(d.month),
    Expected: Number(d.expected),
    Collected: Number(d.collected),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} tickFormatter={compactPeso} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(137,135,129,0.08)" }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Expected" fill={C1} radius={[4, 4, 0, 0]} maxBarSize={18} />
        <Bar dataKey="Collected" fill={C2} radius={[4, 4, 0, 0]} maxBarSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CashflowLine({
  data,
}: {
  data: Array<{ month: string; collected: number }>;
}) {
  const rows = data.map((d) => ({
    label: monthLabel(d.month),
    Collected: Number(d.collected),
  }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} tickFormatter={compactPeso} tickLine={false} axisLine={false} width={52} />
        <Tooltip content={<MoneyTooltip />} />
        <Line
          type="monotone"
          dataKey="Collected"
          stroke={C1}
          strokeWidth={2}
          dot={{ r: 3, fill: C1 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Aging buckets carry state, so they use the reserved status palette —
// each bar is labeled on the axis, never color alone.
const AGING_ORDER = ["current", "1 month", "2 months", "3+ months"];
const AGING_COLOR: Record<string, string> = {
  current: "var(--status-good)",
  "1 month": "var(--status-warning)",
  "2 months": "var(--status-serious)",
  "3+ months": "var(--status-critical)",
};

export function AgingChart({
  data,
}: {
  data: Array<{ bucket: string; contract_count: number; overdue_total: number }>;
}) {
  const rows = AGING_ORDER.map((b) => {
    const r = data.find((d) => d.bucket === b);
    return {
      label: b,
      Contracts: Number(r?.contract_count ?? 0),
      overdue: Number(r?.overdue_total ?? 0),
    };
  });
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={rows} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={axisTick} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
        <Tooltip
          cursor={{ fill: "rgba(137,135,129,0.08)" }}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as { Contracts: number; overdue: number };
            return (
              <div className="rounded-card border border-line bg-white px-3 py-2 text-xs shadow-md">
                <div className="font-semibold text-ink">{label}</div>
                <div className="text-ink">
                  {row.Contracts} contract(s)
                </div>
                <div className="text-ink">
                  Past due: <span className="font-medium">{peso(row.overdue)}</span>
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="Contracts" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {rows.map((r) => (
            <Cell key={r.label} fill={AGING_COLOR[r.label]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AgentBars({
  data,
}: {
  data: Array<{ name: string; value: number; count: number }>;
}) {
  const height = Math.max(120, data.length * 34);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 8, left: 4, bottom: 0 }}
      >
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={axisTick} tickFormatter={compactPeso} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          tick={{ ...axisTick, fill: "currentColor" }}
          width={110}
          tickLine={false}
          axisLine={{ stroke: GRID }}
        />
        <Tooltip
          cursor={{ fill: "rgba(137,135,129,0.08)" }}
          content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0].payload as { name: string; value: number; count: number };
            return (
              <div className="rounded-card border border-line bg-white px-3 py-2 text-xs shadow-md">
                <div className="font-semibold text-ink">{row.name}</div>
                <div className="text-ink">
                  {peso(row.value)} · {row.count} contract(s)
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" name="Contract value" fill={C1} radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
