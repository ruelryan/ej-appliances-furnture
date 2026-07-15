import { describe, expect, it } from "vitest";
import { computeTerms, GOLDEN_CASES, monthsElapsed } from "../amortization";

describe("computeTerms (golden fixture, shared with SQL)", () => {
  for (const c of GOLDEN_CASES) {
    it(`₱${c.cashPrice} @ ${c.termMonths} months`, () => {
      expect(computeTerms(c.cashPrice, c.termMonths)).toEqual(c.expected);
    });
  }

  it("rejects unsupported terms", () => {
    expect(() => computeTerms(10000, 7)).toThrow();
  });
});

describe("monthsElapsed (day-of-month aware)", () => {
  const d = (s: string) => new Date(s + "T00:00:00");

  it("same day is 0", () => {
    expect(monthsElapsed(d("2026-07-15"), d("2026-07-15"))).toBe(0);
  });

  it("one calendar month, day reached", () => {
    expect(monthsElapsed(d("2026-06-15"), d("2026-07-15"))).toBe(1);
  });

  it("one calendar month, day NOT reached yet", () => {
    expect(monthsElapsed(d("2026-06-20"), d("2026-07-15"))).toBe(0);
  });

  it("contract on the 31st, checked on the 30th of a later month", () => {
    expect(monthsElapsed(d("2026-01-31"), d("2026-04-30"))).toBe(2);
  });

  it("year boundary", () => {
    expect(monthsElapsed(d("2025-11-10"), d("2026-02-10"))).toBe(3);
  });

  it("never negative", () => {
    expect(monthsElapsed(d("2026-08-01"), d("2026-07-15"))).toBe(0);
  });
});
