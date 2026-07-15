// Term/amortization math for E & J installment contracts.
// MUST stay in sync with compute_terms() in supabase/migrations/0001_schema.sql.
// Both implementations are tested against GOLDEN_CASES below.

export const TERM_OPTIONS = [4, 5, 6, 12] as const;
export type TermMonths = (typeof TERM_OPTIONS)[number];

export interface Terms {
  totalPrice: number;
  downpayment: number;
  monthlyAmortization: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function termLabel(termMonths: number): string {
  if (termMonths === 4) return "Good as Cash (4 months)";
  if (termMonths === 5) return "Good as Cash (5 months)";
  return `${termMonths} Months`;
}

export function computeTerms(cashPrice: number, termMonths: number): Terms {
  const downpayment = round2(cashPrice * 0.25);

  let totalPrice: number;
  if (termMonths === 4 || termMonths === 5) {
    totalPrice = cashPrice; // "Good as Cash"
  } else if (termMonths === 6) {
    totalPrice = round2(cashPrice * 1.3 * 0.75 + cashPrice * 0.25);
  } else if (termMonths === 12) {
    totalPrice = round2(cashPrice * 1.5 * 0.75 + cashPrice * 0.25);
  } else {
    throw new Error(`Unsupported term: ${termMonths} months`);
  }

  return {
    totalPrice,
    downpayment,
    monthlyAmortization: round2((totalPrice - downpayment) / termMonths),
  };
}

// Whole months between two dates, decremented when the day-of-month
// hasn't been reached yet (mirrors months_elapsed_ph in SQL).
export function monthsElapsed(from: Date, today: Date): number {
  let m =
    (today.getFullYear() - from.getFullYear()) * 12 +
    (today.getMonth() - from.getMonth());
  if (today.getDate() < from.getDate()) m--;
  return Math.max(0, m);
}

// Golden fixture — the same cases are asserted against the SQL function
// in scripts/verify-sql-terms.ts. Do not change without changing both.
export const GOLDEN_CASES: Array<{
  cashPrice: number;
  termMonths: number;
  expected: Terms;
}> = [
  // 23,900 across all four terms (matches the sheet's Customer Card table)
  { cashPrice: 23900, termMonths: 4, expected: { totalPrice: 23900, downpayment: 5975, monthlyAmortization: 4481.25 } },
  { cashPrice: 23900, termMonths: 5, expected: { totalPrice: 23900, downpayment: 5975, monthlyAmortization: 3585 } },
  { cashPrice: 23900, termMonths: 6, expected: { totalPrice: 29277.5, downpayment: 5975, monthlyAmortization: 3883.75 } },
  { cashPrice: 23900, termMonths: 12, expected: { totalPrice: 32862.5, downpayment: 5975, monthlyAmortization: 2240.63 } },
  // rounding edge: price not divisible cleanly
  { cashPrice: 15990, termMonths: 4, expected: { totalPrice: 15990, downpayment: 3997.5, monthlyAmortization: 2998.13 } },
  { cashPrice: 7900, termMonths: 6, expected: { totalPrice: 9677.5, downpayment: 1975, monthlyAmortization: 1283.75 } },
  { cashPrice: 12900, termMonths: 12, expected: { totalPrice: 17737.5, downpayment: 3225, monthlyAmortization: 1209.38 } },
  // odd centavo-producing price
  { cashPrice: 9999, termMonths: 12, expected: { totalPrice: 13748.63, downpayment: 2499.75, monthlyAmortization: 937.41 } },
];
