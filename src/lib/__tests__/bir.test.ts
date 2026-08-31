import { describe, expect, it } from "vitest";
import {
  BIR_BRANCHES,
  BIR_SPLIT_CASES,
  birSplit,
  branchForItemType,
  branchInfo,
  monthRange,
  orCannotClaimInputTax,
  periodKey,
  quarterRange,
  resolvePeriod,
} from "../bir";

/**
 * The golden cases are real rows lifted from the Expenses tab of the General
 * workbook. They exist for the same reason GOLDEN_CASES does in
 * amortization.ts: this TS split is a mirror of SQL `bir_split()` (0039), and a
 * mirror that is not tested is a mirror that has already drifted.
 */
describe("birSplit", () => {
  it.each(BIR_SPLIT_CASES)(
    "splits $gross into $vatable + $inputTax",
    ({ gross, vatable, inputTax }) => {
      const got = birSplit(gross);
      expect(got.vatable).toBe(vatable);
      expect(got.inputTax).toBe(inputTax);
    }
  );

  it("always foots: vatable + input tax === gross", () => {
    for (const { gross } of BIR_SPLIT_CASES) {
      const { vatable, inputTax } = birSplit(gross);
      expect(Math.round((vatable + inputTax) * 100) / 100).toBe(gross);
    }
  });

  it("foots for arbitrary centavo amounts too", () => {
    for (let cents = 1; cents <= 5000; cents += 7) {
      const gross = cents / 100;
      const { vatable, inputTax } = birSplit(gross);
      expect(Math.round((vatable + inputTax) * 100) / 100).toBe(gross);
    }
  });
});

describe("periodKey", () => {
  // The sheet writes July 2021 as "72021", not "072021".
  it("drops the leading zero on single-digit months", () => {
    expect(periodKey("2021-07-15")).toBe("72021");
    expect(periodKey("2021-08-02")).toBe("82021");
  });
  it("keeps two digits for October to December", () => {
    expect(periodKey("2021-12-31")).toBe("122021");
  });
});

describe("period ranges", () => {
  it("covers a whole month", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2024-02")).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    expect(monthRange("2026-08")).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });

  it("covers a whole quarter", () => {
    expect(quarterRange("2026-Q1")).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterRange("2026-Q4")).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("falls back to the current month for junk input", () => {
    expect(resolvePeriod(undefined, "2026-08-31").start).toBe("2026-08-01");
    expect(resolvePeriod("nonsense", "2026-08-31").start).toBe("2026-08-01");
    expect(resolvePeriod("2026-Q3", "2026-08-31").start).toBe("2026-07-01");
  });
});

describe("orCannotClaimInputTax", () => {
  // RR 7-2024: an OR issued after 2024-12-31 is supplementary and cannot
  // support an input-tax claim.
  it("flags an OR after the cutoff that claims input tax", () => {
    expect(orCannotClaimInputTax("official_receipt", "2025-01-02", 500)).toBe(true);
  });
  it("does not flag an OR before the cutoff", () => {
    expect(orCannotClaimInputTax("official_receipt", "2024-12-31", 500)).toBe(false);
  });
  it("does not flag an OR that claims no input tax", () => {
    expect(orCannotClaimInputTax("official_receipt", "2026-01-02", 0)).toBe(false);
  });
  it("does not flag a sales invoice", () => {
    expect(orCannotClaimInputTax("sales_invoice", "2026-01-02", 500)).toBe(false);
  });
});

describe("the two VAT registrations", () => {
  // E & J files 437-961-107-00000 (Appliances) and -00001 (Furniture)
  // separately. A wrong TIN on a book is a misfiled return.
  it("carries the real TINs", () => {
    expect(branchInfo("appliances").tin).toBe("437-961-107-00000");
    expect(branchInfo("furniture").tin).toBe("437-961-107-00001");
  });

  // 0040 removed the third "shared" bucket: overhead is paid by Appliances,
  // so an unrecognised value lands there rather than in a book that files
  // no return.
  it("falls back to Appliances for anything unrecognised", () => {
    expect(branchInfo("nonsense").value).toBe("appliances");
    expect(branchInfo("").value).toBe("appliances");
    expect(branchInfo("shared").value).toBe("appliances");
  });

  it("offers exactly the two registrations", () => {
    expect(BIR_BRANCHES.map((b) => b.value)).toEqual(["appliances", "furniture"]);
  });

  it("maps contracts.item_type onto the registrations", () => {
    // item_type is constrained to exactly these two values by 0003.
    expect(branchForItemType("Appliances")).toBe("appliances");
    expect(branchForItemType("Furniture")).toBe("furniture");
    expect(branchForItemType(null)).toBe("appliances");
  });

  it("keeps every branch value distinct and lowercase", () => {
    const values = BIR_BRANCHES.map((b) => b.value);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v).toBe(v.toLowerCase());
  });
});
