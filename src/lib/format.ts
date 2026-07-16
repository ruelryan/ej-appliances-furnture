// Peso and date formatting for the PH locale.

export function peso(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return (
    "₱" +
    v.toLocaleString("en-PH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "N/A";
  const date = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (isNaN(date.getTime())) return "N/A";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function fmtDateShort(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Today's date string (YYYY-MM-DD) in Asia/Manila regardless of server TZ.
export function phTodayISO(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
  }).format(new Date());
}

// Postgres time ("08:01:00") → "8:01 AM".
export function fmtTime(t: string | null | undefined): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return "—";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtHours(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const v = Number(n);
  return isNaN(v) ? "—" : v.toFixed(2);
}

// "2026-07" → "July 2026"
export function monthLabel(month: string): string {
  const d = new Date(month + "-01T00:00:00");
  if (isNaN(d.getTime())) return month;
  return d.toLocaleDateString("en-PH", { month: "long", year: "numeric" });
}

// ("2026-06-16", "2026-06-30") → "June 16–30, 2026"
export function periodLabel(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (isNaN(s.getTime()) || isNaN(e.getTime())) return `${start} – ${end}`;
  const month = s.toLocaleDateString("en-PH", { month: "long" });
  return `${month} ${s.getDate()}–${e.getDate()}, ${s.getFullYear()}`;
}
