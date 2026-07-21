# Payroll & DTR

Staff clock in and out on `/dtr`; the owner turns those punches into semi-monthly payslips on `/payroll`. The design center is the same as the rest of the app, applied twice over: **hours, holiday and pay math live ONLY in SQL** (`dtr_hours()`, `v_dtr_days`, `payslip_recompute` — none of them has a TS twin), and **payslips snapshot every amount** the way contracts do, so a later rate change, punch correction, or config change never rewrites a slip that has already been issued. Pay data itself lives in `employee_rates`, never in `profiles` — `profiles` is readable by every active user, and staff must not see each other's rates. Migrations: 0005–0008 and 0010 (DTR), 0009 (payslips), 0026 (meal allowance + 13th month). For the table/view/RPC catalog see [../database.md](../database.md); for who can reach which route see [../roles-and-permissions.md](../roles-and-permissions.md); for the labor-law reasoning see [../business-rules-legal.md](../business-rules-legal.md).

## Clocking in and out

The clock card on `/dtr` calls the `clock_in` / `clock_out` RPCs. The rules they enforce:

- **One block per employee per day** (`unique (profile_id, work_date)`). A second `clock_in` raises "Already clocked in today"; there is no morning/afternoon split. The block is `time_in` → `time_out` with the lunch hour deducted arithmetically (below), mirroring the old DTR sheet.
- **Manila time, truncated to the minute.** `work_date` is `ph_today()` and the punch time is `now() at time zone 'Asia/Manila'` — the client's clock is never consulted.
- **No overnight shifts.** `time_out > time_in` is a CHECK on the same date; if one ever happens the owner splits it across two days by hand.
- A row with `time_out` still null is a **missed punch**: `v_dtr_days` yields null hours/pay for it, `v_dtr_month` counts it in `open_records`, and `payslip_recompute` refuses to compute a slip over the period ("Missing clock-out on Jul 03 — fix the punches first") until it is corrected.

Staff see only their own month on `/dtr`; the owner can switch employee (`?employee=`) and browse any month. `/print/dtr/[profileId]` renders the printable DTR sheet.

## Correction requests — the only edit path for staff

Staff cannot edit punches, ever — there are no insert/update policies on `time_records`, and keeping clock times trustworthy is the point of the module. The edit paths are:

- **Staff** file a correction request (`request_time_correction`): a past-or-today date, requested in/out times, and a **mandatory reason**. One pending request per person per day (partial unique index). They can cancel their own pending request (`cancel_time_correction`).
- **Owner** resolves it (`resolve_time_correction`): approving upserts the requested times into `time_records` (creating the day if it never existed) with the reason stored as the record's note; rejecting just closes the request. The owner can also edit or delete any record directly (`upsert_time_record`, `delete_time_record`) from the month grid.

This flow is also the sanctioned answer for legitimate **field work**: a collector on deliveries outside the geofence cannot punch, so they file a correction request for that day instead — the geofence error message says exactly that.

## Geofence (0010)

Punches are accepted only near the store, if the owner says so:

- `dtr_locations` holds circles (`lat`/`lng`/`radius_m`, 25–5000 m, default 150). **Enforcement is ON iff at least one active row exists — an empty or all-inactive table is the kill switch.** The owner manages rows in `/dtr/settings` (direct RLS writes, same pattern as holidays).
- The rule, in `check_dtr_geofence`: the punch must be within `radius_m + slack` of the **nearest** active location, where `slack = min(max(GPS accuracy, 0), 100 m)`. The slack forgives honest phones with poor GPS; capping it at 100 m stops a huge fake "accuracy" from widening the fence. Distance is haversine (`distance_m()`, sphere R = 6371 km — good to ~0.5%, irrelevant at fence scale).
- When the fence is on, a punch with no coordinates is refused with an "allow location access" message; a punch outside it is refused with the measured distance and a pointer to the correction-request flow.
- Coordinates ride along on `time_records` (`in_lat`/`in_lng`/`in_accuracy_m` and the `out_*` trio) as an **audit trail** — null for owner-entered records and pre-geofence punches.
- **Honesty note:** the coordinates come from the browser Geolocation API and are client-supplied. A determined user can spoof them. This is a deterrent and an audit trail, not cryptographic proof of presence.

Two implementation details worth knowing: `check_dtr_geofence` has EXECUTE revoked from the API roles so the fence cannot be probed directly (the punch RPCs run as the function owner), and 0010 **dropped** the zero-arg `clock_in()`/`clock_out()` before recreating them with optional `p_lat`/`p_lng`/`p_accuracy_m` — `create or replace` with a new signature would have created an overload and made PostgREST `rpc("clock_in")` ambiguous (the same gotcha later hit `log_collection` in 0021).

## Hours and holiday math

`dtr_hours(p_in, p_out)` is the only place hours exist: the span minus its overlap with the fixed **12:00–13:00 lunch hour**, rounded to 2 decimals. An afternoon-only shift loses nothing; a shift starting 12:30 loses only 30 minutes. The function reproduces the old Google Sheet exactly (8:01–17:03 → 8.03, 10:09–17:00 → 5.85, …) and those cases are the goldens in `scripts/verify-dtr.ts` (see [../testing.md](../testing.md)).

`v_dtr_days` is the per-day ledger the whole module reads. It has two kinds of rows:

1. **Real punches**, with `hours_worked` from `dtr_hours()`, the day's holiday (if any), the multiplier, and `day_pay = hours × rate × multiplier` (null when no rate is set — surfaced as `rate_missing` in `v_dtr_month`).
2. **Synthetic rows** for **unworked past regular holidays** — no `record_id`, `hours_worked = 0`, `is_unworked_holiday = true`, `day_pay = 8 × rate`. The `hours_worked = 0` on these rows is load-bearing for the 13th-month base (below).

The holiday pay rules (DOLE, plus one house rule):

| Situation | Pay |
|---|---|
| Worked a **regular** holiday | hours × rate × **2.00** |
| Worked a **special** (non-working) day | hours × rate × **1.30** |
| Did **not** work a regular holiday, **Mon–Fri** | 8 h × rate (one day's pay) |
| Did not work a regular holiday, **Sat/Sun** | nothing (0006 — the store's rest days; nobody would have worked) |
| Did not work a special day | nothing |

Unworked-holiday rows are generated only from an employee's **first recorded day onward** (no free pay for holidays before they joined) and only up to today, and never when a real record exists for that date. Worked-holiday multipliers apply on any day of the week — the weekday-only rule is for the unworked fallback alone.

`holidays` is seeded 2025 (0008, per Proclamation 727 — Analyn's imported history starts October 2025) and 2026–2030 (0005, computed — fixed dates, last-Monday-of-August National Heroes Day, and Holy Week from the Meeus/anonymous Gregorian Easter algorithm in `easter_date()`). Proclaimed moveable dates — Eid'l Fitr, Eid'l Adha (regular), Chinese New Year (special) — are added each year by the owner in `/dtr/settings` via direct RLS.

## Rates, contributions, meal allowance

`employee_rates` (PK `id` → `profiles`, named `id` so `audit_row_changes()` works unmodified) carries everything money-per-person: `hourly_rate`, the six government-contribution columns (`philhealth_ee/er`, `sss_ee/er`, `pagibig_ee/er` — fixed monthly peso amounts, not computed from tables), and `meal_allowance_per_day` (0026). Each user can read their own row, the owner all rows; writes go only through the owner-only setters `set_hourly_rate`, `set_contributions`, `set_meal_allowance` (kept separate from `set_contributions` deliberately — its six positional args are already awkward to extend). All three are edited in `/dtr/settings`. Setting a rate is the prerequisite for everything: `set_contributions`/`set_meal_allowance` refuse until the `employee_rates` row exists, and `payslip_recompute` refuses without one.

## Payslips (0009, extended by 0026)

Semi-monthly periods: **1–15** and **16–end of month** (`period_start` day must be 1 or 16, CHECK-enforced; `create_payslip` computes the end and refuses a period that isn't finished yet). One slip per employee per period start.

**Everything on a slip is a snapshot**, set by the internal `payslip_recompute` and never recomputed by the UI:

- `dtr_hours`, `dtr_pay`, `days_worked`, `hourly_rate` — summed from `v_dtr_days` over the period. `dtr_pay` already includes holiday premiums and unworked weekday regular holidays.
- `basic_pay` (0026) — `sum(hours_worked × hourly_rate)`, the ×1.00 portion only; recorded for the 13th-month base, never itself paid out (see below).
- `meal_allowance` (0026) — `days_worked × meal_allowance_per_day`. `days_worked` is `count(record_id)`, which **ignores the synthetic holiday rows: an unworked holiday earns no meal allowance** — there was no meal.
- The six contribution columns — copied from `employee_rates` on a **16–end slip, zero on a 1–15 slip**. The EE share joins `total_deductions`; the ER share is recorded for the owner's books but deducted from nothing.
- `extra_income` / `extra_deductions` — free-form jsonb lines (`[{"label": …, "amount": …}]`), validated by the immutable `payslip_lines_valid` CHECK (non-empty label, positive 2-decimal amount). Edited only while draft, via `update_payslip_lines`.
- `total_income = dtr_pay + meal_allowance + extra income`, `total_deductions = EE contributions + extra deductions`, `net_pay` = the difference.

Recompute happens at **create, refresh, line-edit, and finalize** — a final slip always matches the DTR at the moment of finalizing. It hard-fails if any punch in the period is missing a clock-out or the employee has no rate.

**Lifecycle: `draft` → `final`, and back via reopen — finals are never deleted.** Drafts are the owner's workspace: staff RLS (`payslips_select`) shows an employee only their **own final** slips; a draft is invisible to its subject. `finalize_payslip` recomputes and stamps `finalized_by/at`; a wrong final is `reopen_payslip`-ed back to draft, refreshed, and finalized again. `delete_payslip` works on drafts only. Every mutation is an owner-only RPC (`create_payslip`, `update_payslip_lines`, `refresh_payslip`, `finalize_payslip`, `reopen_payslip`, `delete_payslip`); updates are audited by `audit_row_changes`. `/print/payslip/[id]` renders the A4 slip.

## 13th-month pay (0026)

13th-month pay is 1/12 of **basic salary** earned in the calendar year — and the IRR excludes allowances, COLA, overtime, premium, night differential and holiday pay from "basic". That makes `dtr_pay` the wrong base: it bakes in the ×2.00/×1.30 multipliers and the 8-hour unworked-holiday payment. On a real test period, 40% of `dtr_pay` would have been wrongly included.

The right base falls out of one expression with no special-casing:

```
basic_pay = sum(hours_worked × hourly_rate)
```

The premium portion disappears because the multiplier is simply not applied, and the unworked-holiday pay disappears because those synthetic `v_dtr_days` rows carry `hours_worked = 0`. This is why that 0 in the frozen view is load-bearing.

Two deliberate decisions, both documented in the migration:

- **Policy call:** unworked regular-holiday pay is *excluded* from the base — the DOLE exclusion list read straight, the defensible position for an hourly-paid employee. The law permits *including* it where company policy treats it as basic; if E & J ever decides that, change the `basic_pay` expression in `payslip_recompute` and tell the employees in writing. Do not change it by accident.
- **Sum from slips, not from DTR.** `v_thirteenth_month` sums `basic_pay` from **final payslips only** (a draft is not yet a fact), bucketed by `period_end` year, and computes `entitlement = basic_earned / 12` minus payments to date. Summing snapshots means the entitlement stays correct years later even after rate changes; 0026 backfilled `basic_pay` on pre-existing slips using each slip's *own* snapshotted rate for the same reason.

Payouts are explicit rows in `thirteenth_month_payments` written by the owner-only `record_13th_month_payment` — recorded as facts rather than inferred from a magic label in `extra_income`. Staff can read their own payment rows. The report lives at `/payroll/13th-month`, the one payroll route with a hard owner redirect (`/payroll` itself has no gate — RLS already scopes staff to their own finals).

## Verifying changes

`npx tsx scripts/verify-dtr.ts` asserts the SQL against goldens: `dtr_hours()` vs values from the original Sheet (including the mid-lunch edge cases and the null-clock-out case), `easter_date()` vs known Easters 2026–2030, holiday-seed spot checks, and `distance_m()` haversine cases. Run it after touching any DTR SQL. There is deliberately no TS mirror of any of this math to keep in sync — the view is the only truth. See [../testing.md](../testing.md).
