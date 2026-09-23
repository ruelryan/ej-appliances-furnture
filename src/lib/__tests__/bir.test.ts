import { describe, expect, it } from "vitest";
import {
  BIR_BRANCHES,
  BIR_SALE_TYPES,
  BIR_SPLIT_CASES,
  type LedgerEntry,
  birSplit,
  branchForItemType,
  branchInfo,
  buildLedgerRows,
  ledgerTotals,
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

  it("covers every quarter boundary, including leap-year Q1", () => {
    expect(quarterRange("2026-Q2")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterRange("2026-Q3")).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(quarterRange("2024-Q1")).toEqual({ start: "2024-01-01", end: "2024-03-31" });
  });

  it("labels a quarter readably and a month as-is", () => {
    // The header prints this, so a quarter must not read "2026-Q3".
    expect(resolvePeriod("2026-Q3", "2026-08-31").label).toBe("2026 Q3");
    expect(resolvePeriod("2026-08", "2026-08-31").label).toBe("2026-08");
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

/**
 * The ledger is the paper book's layout, and the thing that makes it the paper
 * book rather than a list is the line for a day that had no sale. These cases
 * pin that, plus the two ways a date can go wrong: an entry outside the period
 * leaking in, and a day shifting by one because a Date was built in the
 * machine's local zone.
 */
describe("buildLedgerRows", () => {
  const entry = (over: Partial<LedgerEntry> & { sales_date: string }): LedgerEntry => ({
    id: over.sales_date + (over.invoice_no ?? ""),
    contract_id: null,
    invoice_no: "230140005451",
    customer_name_snapshot: "Diez, Mitch",
    customer_address_snapshot: "Cantamuac, Malitbog, Southern Leyte",
    item_snapshot: "Haier Washing Machine with Dryer",
    vatable_sales: 10428.57,
    vat_output_tax: 1251.43,
    gross_snapshot: 11680,
    quantity: 1,
    sale_type: "Private",
    branch: "appliances",
    ...over,
  });

  it("emits one row per calendar day when nothing was sold", () => {
    const rows = buildLedgerRows([], "2026-09-01", "2026-09-30");
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.kind === "none")).toBe(true);
    expect(rows[0].date).toBe("2026-09-01");
    expect(rows[29].date).toBe("2026-09-30");
  });

  it("puts a sale on its day and leaves the quiet days in place", () => {
    const rows = buildLedgerRows([entry({ sales_date: "2026-09-02" })], "2026-09-01", "2026-09-03");
    expect(rows.map((r) => r.kind)).toEqual(["none", "entry", "none"]);
    expect(rows.map((r) => r.date)).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
  });

  it("lists several sales under one day, dated on the first line only", () => {
    const rows = buildLedgerRows(
      [
        entry({ sales_date: "2026-09-02", invoice_no: "5451" }),
        entry({ sales_date: "2026-09-02", invoice_no: "5452" }),
      ],
      "2026-09-02",
      "2026-09-02"
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.first)).toEqual([true, false]);
  });

  it("ignores an entry dated outside the period", () => {
    const rows = buildLedgerRows(
      [entry({ sales_date: "2026-08-31" }), entry({ sales_date: "2026-10-01" })],
      "2026-09-01",
      "2026-09-02"
    );
    expect(rows.every((r) => r.kind === "none")).toBe(true);
  });

  it("steps across a month and a year boundary without losing or shifting a day", () => {
    expect(buildLedgerRows([], "2026-01-31", "2026-02-01").map((r) => r.date)).toEqual([
      "2026-01-31",
      "2026-02-01",
    ]);
    expect(buildLedgerRows([], "2025-12-31", "2026-01-01").map((r) => r.date)).toEqual([
      "2025-12-31",
      "2026-01-01",
    ]);
    // 2024 was a leap year; the book has a Feb 29 line.
    expect(buildLedgerRows([], "2024-02-28", "2024-03-01")).toHaveLength(3);
  });

  it("foots the columns, with CASH carrying the whole invoice", () => {
    const totals = ledgerTotals([
      entry({ sales_date: "2026-09-02" }),
      entry({
        sales_date: "2026-09-03",
        vatable_sales: 6160.71,
        vat_output_tax: 739.29,
        gross_snapshot: 6900,
      }),
    ]);
    expect(totals.vatable).toBe(16589.28);
    expect(totals.output).toBe(1990.72);
    expect(totals.gross).toBe(18580);
    expect(totals.cash).toBe(totals.gross);
    expect(totals.vatable + totals.output).toBe(totals.gross);
  });

  it("spells the two sale types as the book does", () => {
    expect(BIR_SALE_TYPES).toEqual(["Private", "Government"]);
  });
});
