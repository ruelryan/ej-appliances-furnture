// The itemised holiday portion of a payslip, snapshotted on
// payslips.holiday_lines by payslip_recompute (migration 0036).
//
// `amount` is the premium ABOVE the plain hourly rate, never the gross for the
// day, so that basic_pay + sum(amount) = dtr_pay exactly. A worked regular
// holiday contributes its ordinary hours to basic_pay and only the extra 100%
// here; an unworked one has no hours, so its whole 8-hour payment lands here.
export type HolidayLine = {
  date: string;
  name: string;
  type: "regular" | "special";
  hours: number;
  worked: boolean;
  amount: number;
};

/** Reads the jsonb column defensively — slips finalised before 0036 have []. */
export function holidayLinesOf(value: unknown): HolidayLine[] {
  return Array.isArray(value) ? (value as HolidayLine[]) : [];
}
