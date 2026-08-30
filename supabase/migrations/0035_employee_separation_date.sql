-- ──────────────────────────────────────────────────────────────
-- 0035: record when an employee leaves, and stop accruing on that date
--
-- Roger Dasal left on 2026-08-24. Computing his final payslip produced ₱450
-- more than his hours justify — 8 hours × ₱56.25 for National Heroes Day on
-- 2026-08-31, a week after he had gone.
--
-- The cause is not 0034. The unworked-regular-holiday rule has a START bound
-- (`h.holiday_date >= the employee's first punch`) and no END bound at all:
--
--     join public.profiles p on ...
--     where h.holiday_date <= p_upto
--       and not exists (select 1 from time_records where ... )
--
-- so any profile that ever clocked in keeps earning 8 hours on every future
-- regular weekday holiday, forever. Roger would have accrued that ₱450 when
-- the 31st arrived regardless of 0034, then ₱450 again at every holiday after
-- it. The app simply had no way to say that someone has left — which held up
-- only while nobody had.
--
-- `separated_on` is that missing fact. It lives on employee_rates rather than
-- profiles because it is employment data, alongside the rate, the meal
-- allowance and the contributions, and because employee_rates is owner-only:
-- when someone left is not information their colleagues need.
--
-- Bounding by a date rather than by `profiles.active` is deliberate. Using the
-- active flag would erase the holidays a departed employee was legitimately
-- paid for from their own DTR history, because the flag carries no date and
-- would apply retroactively to every past holiday. A separation date keeps the
-- history intact and stops only what comes after it.
-- ──────────────────────────────────────────────────────────────

alter table public.employee_rates
  add column if not exists separated_on date;

comment on column public.employee_rates.separated_on is
  'Last day of employment. NULL means still employed. Bounds the synthetic '
  'unworked-holiday rows in dtr_days() so a departed employee stops accruing '
  'holiday pay; their history before this date is untouched. Does NOT block '
  'login — deactivate the profile on /admin for that.';

-- ── Setter, matching set_contributions / set_meal_allowance ───────────────
create or replace function public.set_separation_date(
  p_profile_id uuid,
  p_date date
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_first date;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can set a separation date';
  end if;

  -- A separation before the first day worked would silently void every
  -- holiday the person was paid for, so refuse it rather than accept a typo.
  if p_date is not null then
    select min(work_date) into v_first
    from public.time_records where profile_id = p_profile_id;
    if v_first is not null and p_date < v_first then
      raise exception 'Separation date % is before their first day worked (%)', p_date, v_first;
    end if;
  end if;

  update public.employee_rates set separated_on = p_date, updated_at = now()
  where id = p_profile_id;
  if not found then
    raise exception 'No rate row for this employee';
  end if;
end;
$$;

revoke execute on function public.set_separation_date(uuid, date) from public, anon;
grant execute on function public.set_separation_date(uuid, date) to authenticated;

-- ── dtr_days: stop the synthetic holiday rows at the separation date ──────
-- Identical to 0034 apart from the added bound in the unworked_regular CTE.
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
  left join public.employee_rates er0 on er0.id = p.id
  where h.holiday_date <= p_upto
    -- weekdays only: 0 = Sunday, 6 = Saturday
    and extract(dow from h.holiday_date)::int not in (0, 6)
    and h.holiday_date >= (
      select min(t0.work_date) from public.time_records t0
      where t0.profile_id = p.id
    )
    -- and nothing after their last day. NULL = still employed.
    and (er0.separated_on is null or h.holiday_date <= er0.separated_on)
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
  'employee_rates.separated_on bounds them again, so a departed employee stops '
  'accruing holiday pay on their last day. v_dtr_days calls this at ph_today() '
  '(what has happened); payslip_recompute calls it at the slip period_end '
  '(what the period owes).';

-- Roger Dasal, last day 2026-08-24 (Ryan, 2026-08-30). Recorded here rather
-- than by hand so the reason travels with the change.
update public.employee_rates
set separated_on = '2026-08-24', updated_at = now()
where id = 'b9a388c7-b960-475d-8eae-d7d264ba282c'
  and separated_on is null;
