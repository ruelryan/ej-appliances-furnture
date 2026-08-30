-- ──────────────────────────────────────────────────────────────
-- 0036: show holiday pay as its own line on the payslip
--
-- Analyn's 16–31 August slip reads "DTR pay ₱4,135.50" as a single figure.
-- ₱600 of that is National Heroes Day. She cannot see that, and neither can
-- anyone checking the slip later — which matters most for exactly the payslips
-- where a holiday is the reason the amount changed.
--
-- The breakdown is SNAPSHOTTED like every other payslip amount rather than
-- recomputed at render time. A finalised slip must not change when a rate is
-- edited or a holiday is corrected months later; that is the whole reason
-- payslips carry frozen numbers instead of reading the DTR live.
--
-- The arithmetic is chosen so the lines reconcile exactly:
--
--     basic_pay  +  sum(holiday_lines.amount)  =  dtr_pay
--
-- so each holiday line carries the PREMIUM above the plain hourly rate, not
-- the gross for the day. A worked regular holiday at ×2.00 contributes its
-- ordinary hours to basic_pay and the extra 100% here; an unworked one has
-- zero hours, so its whole 8-hour payment lands here. Both add up.
-- ──────────────────────────────────────────────────────────────

alter table public.payslips
  add column if not exists holiday_lines jsonb not null default '[]'::jsonb;

comment on column public.payslips.holiday_lines is
  'Snapshot of the holiday portion of dtr_pay, one entry per holiday in the '
  'period: {date, name, type, hours, worked, amount}. `amount` is the premium '
  'ABOVE the plain hourly rate, so basic_pay + sum(amount) = dtr_pay exactly. '
  'Empty on slips finalised before 0036 — those had no holiday pay at all, so '
  'nothing is missing.';

create or replace function public.payslip_recompute(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_slip public.payslips;
  v_rate public.employee_rates;
  v_open text;
  v_hours numeric;
  v_pay numeric;
  v_basic numeric;
  v_days int;
  v_meal numeric;
  v_ee numeric;
  v_extra_in numeric;
  v_extra_out numeric;
  v_holidays jsonb;
begin
  select * into v_slip from public.payslips where id = p_id for update;
  if not found then
    raise exception 'Payslip not found';
  end if;

  select string_agg(to_char(work_date, 'Mon DD'), ', ' order by work_date)
  into v_open
  from public.time_records
  where profile_id = v_slip.profile_id
    and work_date between v_slip.period_start and v_slip.period_end
    and time_out is null;
  if v_open is not null then
    raise exception 'Missing clock-out on % — fix the punches first', v_open;
  end if;

  select * into v_rate from public.employee_rates where id = v_slip.profile_id;
  if not found then
    raise exception 'No hourly rate set for this employee';
  end if;

  select coalesce(sum(d.hours_worked), 0),
         coalesce(sum(d.day_pay), 0),
         -- basic = the x1.00 portion. Synthetic unworked-holiday rows have
         -- hours_worked = 0, so they contribute nothing here by construction.
         --
         -- Rounded PER DAY, matching how day_pay is built. Summing raw and
         -- rounding once left basic a centavo under dtr_pay on Roger's slip
         -- (465.1875 + 568.125 + 337.5 rounds to 1370.81, while the per-day
         -- day_pay figures sum to 1370.82) — which would leave the payslip
         -- lines failing to add up to their own total by a centavo.
         coalesce(sum(round(d.hours_worked * d.hourly_rate, 2)), 0),
         count(d.record_id)
  into v_hours, v_pay, v_basic, v_days
  -- period_end, not ph_today(): a holiday inside this period is owed whether
  -- or not the day has arrived by the time payroll is run.
  from public.dtr_days(v_slip.period_end) d
  where d.profile_id = v_slip.profile_id
    and d.work_date between v_slip.period_start and v_slip.period_end;

  -- The holiday portion, itemised. Same source and same window as the sums
  -- above, so it cannot disagree with them.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'date', d.work_date,
               'name', d.holiday_name,
               'type', d.holiday_type,
               'hours', d.hours_worked,
               'worked', not d.is_unworked_holiday,
               -- The premium above plain time, with the subtrahend rounded the
               -- same way basic_pay rounds it so the lines reconcile exactly.
               'amount', round(coalesce(d.day_pay, 0)
                               - round(coalesce(d.hours_worked * d.hourly_rate, 0), 2), 2)
             ) order by d.work_date
           ), '[]'::jsonb)
  into v_holidays
  from public.dtr_days(v_slip.period_end) d
  where d.profile_id = v_slip.profile_id
    and d.work_date between v_slip.period_start and v_slip.period_end
    and d.holiday_name is not null
    -- A holiday that paid nothing extra is not worth a line.
    and round(coalesce(d.day_pay, 0)
              - round(coalesce(d.hours_worked * d.hourly_rate, 0), 2), 2) <> 0;

  -- Per day ACTUALLY worked: count(record_id) ignores the synthetic holiday
  -- rows, so an unworked holiday earns no meal allowance. Correct — there was
  -- no meal.
  v_meal := round(v_days * coalesce(v_rate.meal_allowance_per_day, 0), 2);

  -- Employee-share contributions land on the 16–end slip only.
  v_ee := case when extract(day from v_slip.period_start) = 16
               then v_rate.philhealth_ee + v_rate.sss_ee + v_rate.pagibig_ee
               else 0 end;

  v_extra_in := public.payslip_lines_total(v_slip.extra_income);
  v_extra_out := public.payslip_lines_total(v_slip.extra_deductions);

  update public.payslips
  set dtr_hours = v_hours,
      dtr_pay = v_pay,
      basic_pay = round(v_basic, 2),
      holiday_lines = v_holidays,
      meal_allowance = v_meal,
      days_worked = v_days,
      hourly_rate = v_rate.hourly_rate,
      philhealth_ee = case when extract(day from v_slip.period_start) = 16 then v_rate.philhealth_ee else 0 end,
      philhealth_er = case when extract(day from v_slip.period_start) = 16 then v_rate.philhealth_er else 0 end,
      sss_ee        = case when extract(day from v_slip.period_start) = 16 then v_rate.sss_ee else 0 end,
      sss_er        = case when extract(day from v_slip.period_start) = 16 then v_rate.sss_er else 0 end,
      pagibig_ee    = case when extract(day from v_slip.period_start) = 16 then v_rate.pagibig_ee else 0 end,
      pagibig_er    = case when extract(day from v_slip.period_start) = 16 then v_rate.pagibig_er else 0 end,
      total_income = round(v_pay + v_meal + v_extra_in, 2),
      total_deductions = round(v_ee + v_extra_out, 2),
      net_pay = round(v_pay + v_meal + v_extra_in - v_ee - v_extra_out, 2)
  where id = p_id;
end;
$$;

revoke execute on function public.payslip_recompute(uuid) from public, anon, authenticated;
