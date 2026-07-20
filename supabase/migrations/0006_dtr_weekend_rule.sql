-- DTR weekend rule (Ryan, 2026-07-16): an UNWORKED regular holiday only
-- pays the 8-hour day when it falls on a weekday (Mon–Fri). Saturdays and
-- Sundays are the store's rest days — nobody would have worked, so no pay.
-- Worked holidays are unaffected: ×2.00 / ×1.30 apply on any day of week.
--
-- Replaces v_dtr_days from 0005 with one added condition in the
-- unworked_regular CTE (dow not in Sat/Sun). v_dtr_month is unchanged.

create or replace view public.v_dtr_days
with (security_invoker = true)
as
with rec as (
  select t.*, public.dtr_hours(t.time_in, t.time_out) as hours_worked
  from public.time_records t
),
unworked_regular as (
  select p.id as profile_id, h.holiday_date as work_date
  from public.profiles p
  join public.holidays h on h.type = 'regular'
  where h.holiday_date <= public.ph_today()
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
