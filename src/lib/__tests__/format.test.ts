import { describe, expect, it } from "vitest";
import { fmtHours, fmtTime, monthLabel } from "../format";

describe("fmtTime", () => {
  it("formats Postgres time strings as 12-hour", () => {
    expect(fmtTime("08:01:00")).toBe("8:01 AM");
    expect(fmtTime("17:03:00")).toBe("5:03 PM");
    expect(fmtTime("12:00:00")).toBe("12:00 PM");
    expect(fmtTime("00:15:00")).toBe("12:15 AM");
    expect(fmtTime("13:39")).toBe("1:39 PM");
  });

  it("returns an em dash for missing values", () => {
    expect(fmtTime(null)).toBe("—");
    expect(fmtTime(undefined)).toBe("—");
    expect(fmtTime("")).toBe("—");
  });
});

describe("fmtHours", () => {
  it("formats to two decimals", () => {
    expect(fmtHours(8.03)).toBe("8.03");
    expect(fmtHours("5.85")).toBe("5.85");
    expect(fmtHours(6)).toBe("6.00");
    expect(fmtHours(0)).toBe("0.00");
  });

  it("returns an em dash for missing values", () => {
    expect(fmtHours(null)).toBe("—");
    expect(fmtHours(undefined)).toBe("—");
  });
});

describe("monthLabel", () => {
  it("expands YYYY-MM to a month name", () => {
    expect(monthLabel("2026-07")).toBe("July 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
  });
});
