-- ──────────────────────────────────────────────────────────────
-- 0034: run payroll before the period ends, without losing holiday pay
--
-- Ryan needs Analyn's 16–31 August slip on the 30th: her last duty was Thursday
-- the 27th (she works Mon–Thu) and she is on leave for the 31st, so from her
-- side the period is already over. Two things stood in the way.
--
-- 1. create_payslip refused outright — `if v_end > ph_today()` (0009:225).
--
-- 2. More dangerously, simply lifting that guard would have UNDERPAID her.
--    v_dtr_days only emits the synthetic unworked-regular-holiday row for days
--    that have already arrived (`h.holiday_date <= ph_today()`, 0006:20), and
--    31 August 2026 is National Heroes Day — a regular holiday, on a Monday,
--    one of her normal working days. She has been paid 8h (₱600) for every
--    past regular holiday. A slip built on the 30th would have carried ₱0 for
--    it, and would have under-snapshotted basic_pay too, permanently
--    understating her 13th-month base unless someone noticed and reopened it.
--
-- The fix separates two questions that were sharing one bound:
--
--   "what has happened so far"     → the DTR screens, bound by ph_today()
--   "what does this period owe"    → payroll, bound by the period's own end
--
-- dtr_days(p_upto) is the single definition; v_dtr_days is now a thin wrapper
-- at ph_today() so /dtr, /print/dtr, the month grid and v_dtr_month are
-- behaviourally unchanged, and payslip_recompute calls it at period_end. The
-- holiday rule is NOT duplicated — a second copy would drift, which is exactly
-- how a taxonomy mismatch broke contract creation earlier the same day.
-- ──────────────────────────────────────────────────────────────

-- ── 1. The day rows, with the horizon as a parameter ──────────────────────
-- Body lifted verbatim from the 0006 view except for the bound on line marked
-- below. Column types match v_dtr_days exactly (checked against pg_attribute)
-- so the view can be replaced in place rather than dropped — and if they ever
-- stop matching, `create or replace view` fails loudly instead of silently
-- changing a column's type under v_dtr_month.
create or replace function public.dtr_days(p_upto date)
returns table (
  profile_id uuid,
  work_date date,
  record_id uuid,
  time_in time without time zone,
  time_out time without time zone,
  note text,
  hours_worked numeric,
  holiday_name text,
  holiday_type text,
  multiplier numeric,
  hourly_rate numeric,
  day_pay numeric,
  is_unworked_holiday boolean
)
language sql
stable
security invoker
set search_path = public
as $$
with rec as (
  select t.*, public.dtr_hours(t.time_in, t.time_out) as hours_worked
  from public.time_records t
),
unworked_regular as (
  select p.id as profile_id, h.holiday_date as work_date
  from public.profiles p
  join public.holidays h on h.type = 'regular'
  -- THE ONE CHANGE: the horizon is now the caller's, not always today.
  where h.holiday_date <= p_upto
    -- weekdays only: 0 = Sunday, 6 = Saturday
    and extract(dow from h.holiday_date)::int not in (0, 6)
    and h.holiday_date >= (
      select min(t0.work_date) from public.time_records t0
      where t0.profile_id = p.id
    )
    and not exists (
      select 1 from public.time_records t
      where t.profile_id = p.id and t.work_date = h.holiday_date
    )
)
select
  r.profile_id,
  r.work_date,
  r.id as record_id,
  r.time_in,
  r.time_out,
  r.note,
  r.hours_worked,
  h.name as holiday_name,
  h.type as holiday_type,
  case h.type when 'regular' then 2.00 when 'special' then 1.30 else 1.00 end
    as multiplier,
  er.hourly_rate,
  case when er.hourly_rate is null then null
       else round(
         r.hours_worked * er.hourly_rate
         * case h.type when 'regular' then 2.00 when 'special' then 1.30 else 1.00 end,
         2)
  end as day_pay,
  false as is_unworked_holiday
from rec r
left join public.holidays h on h.holiday_date = r.work_date
left join public.employee_rates er on er.id = r.profile_id
union all
select
  u.profile_id,
  u.work_date,
  null, null, null, null,
  0::numeric,
  h.name,
  h.type,
  1.00,
  er.hourly_rate,
  case when er.hourly_rate is null then null
       else round(8 * er.hourly_rate, 2) end,
  true
from unworked_regular u
join public.holidays h on h.holiday_date = u.work_date
left join public.employee_rates er on er.id = u.profile_id;
$$;

comment on function public.dtr_days(date) is
  'Per-day DTR rows up to a horizon. p_upto bounds the SYNTHETIC '
  'unworked-regular-holiday rows only; real punches are never filtered by it. '
  'v_dtr_days calls this at ph_today() (what has happened); payslip_recompute '
  'calls it at the slip period_end (what the period owes), which is what lets '
  'payroll run before a period closes without dropping a holiday inside it.';

-- security invoker: the function must see exactly what the caller may see,
-- like the view it replaces. Without this it would run as owner and leak every
-- employee's punches to any signed-in user.
revoke execute on function public.dtr_days(date) from public;
grant execute on function public.dtr_days(date) to authenticated;

-- ── 2. v_dtr_days becomes the "as of today" wrapper ───────────────────────
-- Columns enumerated by hand, never `select *` — the house frozen-view rule.
-- hourly_rate is cast back to numeric(8,2) because `returns table` drops the
-- type modifier, and changing a column's type would make this replace fail.
create or replace view public.v_dtr_days
with (security_invoker = true)
as
select
  profile_id,
  work_date,
  record_id,
  time_in,
  time_out,
  note,
  hours_worked,
  holiday_name,
  holiday_type,
  multiplier,
  hourly_rate::numeric(8,2) as hourly_rate,
  day_pay,
  is_unworked_holiday
from public.dtr_days(public.ph_today());

-- ── 3. Payroll asks for the whole period it is paying ─────────────────────
-- Identical to 0026 apart from the source: v_dtr_days → dtr_days(period_end).
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
         -- That is what keeps an early slip's 13th-month base correct even
         -- though its income now includes the holiday.
         coalesce(sum(d.hours_worked * d.hourly_rate), 0),
         count(d.record_id)
  into v_hours, v_pay, v_basic, v_days
  -- period_end, not ph_today(): a holiday inside this period is owed whether
  -- or not the day has arrived by the time payroll is run.
  from public.dtr_days(v_slip.period_end) d
  where d.profile_id = v_slip.profile_id
    and d.work_date between v_slip.period_start and v_slip.period_end;

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

-- 0029 revoked this from clients; a replace does not restore grants, but state
-- it again so the intent survives a future reader.
revoke execute on function public.payslip_recompute(uuid) from public, anon, authenticated;

-- ── 4. Allow the period that has started but not yet closed ───────────────
-- The old guard refused any period whose end was in the future. That is too
-- strong: it also refuses a period where nothing can still change, which is
-- the normal case when the last duty falls before the month end. The rule that
-- actually matters is that a period cannot be paid before it has BEGUN.
--
-- An in-progress slip is a forecast, and the app says so at the point of
-- finalizing. The existing reopen → refresh → finalize path corrects it if
-- someone works after the slip was cut; payslip_recompute also still refuses
-- to run while a punch is open.
create or replace function public.create_payslip(
  p_profile_id uuid,
  p_period_start date
)
returns public.payslips
language plpgsql
security definer set search_path = public
as $$
declare
  v_end date;
  v_row public.payslips;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can create payslips';
  end if;

  if extract(day from p_period_start) = 1 then
    v_end := p_period_start + 14;
  elsif extract(day from p_period_start) = 16 then
    v_end := (date_trunc('month', p_period_start) + interval '1 month' - interval '1 day')::date;
  else
    raise exception 'Period must start on the 1st or the 16th';
  end if;

  if p_period_start > public.ph_today() then
    raise exception 'That period has not started yet';
  end if;

  insert into public.payslips (profile_id, period_start, period_end, created_by)
  values (p_profile_id, p_period_start, v_end, auth.uid())
  returning * into v_row;

  perform public.payslip_recompute(v_row.id);
  select * into v_row from public.payslips where id = v_row.id;
  return v_row;
exception
  when unique_violation then
    raise exception 'A payslip for this period already exists';
end;
$$;
