-- E & J — DTR (Daily Time Record) + Philippine holidays.
--
-- One time block per employee per day (mirrors the old DTR sheet), Manila
-- local times. Hours math lives ONLY here (dtr_hours), verified by
-- scripts/verify-dtr.ts against values from the original Google Sheet.
-- Overnight shifts are not supported (time_out must be after time_in on the
-- same date); the owner splits one across two days if it ever happens.

-- ──────────────────────────────────────────────────────────────
-- Tables
-- ──────────────────────────────────────────────────────────────
create table public.time_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  work_date date not null,
  time_in time not null,
  time_out time,                 -- null = still clocked in / missed punch
  note text,                     -- owner's correction note
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, work_date),
  constraint time_out_after_in check (time_out is null or time_out > time_in)
);

-- Philippine holidays. Regular = double pay when worked, one day's pay when
-- not worked. Special (non-working) = +30% when worked, no pay when not.
create table public.holidays (
  holiday_date date primary key,
  name text not null,
  type text not null check (type in ('regular', 'special'))
);

-- Rates live outside profiles so staff can't read each other's pay
-- (profiles is readable by every active user). PK column is named "id" so
-- audit_row_changes() works unmodified.
create table public.employee_rates (
  id uuid primary key references public.profiles (id) on delete cascade,
  hourly_rate numeric(8,2) not null check (hourly_rate > 0),
  updated_at timestamptz not null default now()
);

drop trigger if exists touch_time_records on public.time_records;
create trigger touch_time_records before update on public.time_records
  for each row execute function public.touch_updated_at();
drop trigger if exists touch_employee_rates on public.employee_rates;
create trigger touch_employee_rates before update on public.employee_rates
  for each row execute function public.touch_updated_at();

drop trigger if exists audit_time_records on public.time_records;
create trigger audit_time_records after update on public.time_records
  for each row execute function public.audit_row_changes();
drop trigger if exists audit_employee_rates on public.employee_rates;
create trigger audit_employee_rates after update on public.employee_rates
  for each row execute function public.audit_row_changes();

-- ──────────────────────────────────────────────────────────────
-- Hours math (the only place it exists — no TS twin)
-- ──────────────────────────────────────────────────────────────
-- Hours worked = span minus its overlap with the 12:00–13:00 lunch hour.
-- Reproduces the old sheet exactly: 8:01–17:03→8.03, 10:09–17:00→5.85,
-- 13:39–17:01→3.37 (afternoon-only shift, no deduction).
create or replace function public.dtr_hours(p_in time, p_out time)
returns numeric
language sql immutable
as $$
  select case when p_out is null then null else
    round((extract(epoch from
      (p_out - p_in)
      - greatest(interval '0',
          least(p_out, time '13:00') - greatest(p_in, time '12:00'))
    ) / 3600.0)::numeric, 2)
  end;
$$;

-- Gregorian Easter (anonymous/Meeus algorithm), for Holy Week holidays.
create or replace function public.easter_date(p_year int)
returns date
language plpgsql immutable
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_year,
                   (h + l - 7 * m + 114) / 31,
                   ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Holiday seed, 2026–2030
-- ──────────────────────────────────────────────────────────────
-- Fixed-date and computable holidays only. Proclaimed moveable holidays —
-- Eid'l Fitr / Eid'l Adha (regular), Chinese New Year (special) — plus any
-- yearly proclamation changes are added/edited by the owner in DTR settings.
do $$
declare
  y int;
begin
  for y in select generate_series(2026, 2030) loop
    insert into public.holidays (holiday_date, name, type) values
      (make_date(y, 1, 1),   'New Year''s Day',            'regular'),
      (make_date(y, 4, 9),   'Araw ng Kagitingan',         'regular'),
      (make_date(y, 5, 1),   'Labor Day',                  'regular'),
      (make_date(y, 6, 12),  'Independence Day',           'regular'),
      (make_date(y, 11, 30), 'Bonifacio Day',              'regular'),
      (make_date(y, 12, 25), 'Christmas Day',              'regular'),
      (make_date(y, 12, 30), 'Rizal Day',                  'regular'),
      -- last Monday of August
      (make_date(y, 8, 31)
         - ((extract(dow from make_date(y, 8, 31))::int - 1 + 7) % 7),
                             'National Heroes Day',        'regular'),
      (public.easter_date(y) - 3, 'Maundy Thursday',       'regular'),
      (public.easter_date(y) - 2, 'Good Friday',           'regular'),
      (public.easter_date(y) - 1, 'Black Saturday',        'special'),
      (make_date(y, 2, 25),  'EDSA People Power Anniversary', 'special'),
      (make_date(y, 8, 21),  'Ninoy Aquino Day',           'special'),
      (make_date(y, 11, 1),  'All Saints'' Day',           'special'),
      (make_date(y, 12, 8),  'Feast of the Immaculate Conception', 'special'),
      (make_date(y, 12, 31), 'Last Day of the Year',       'special')
    on conflict (holiday_date) do nothing;
  end loop;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Write entry points
-- ──────────────────────────────────────────────────────────────
create or replace function public.clock_in()
returns public.time_records
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_records;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  insert into public.time_records (profile_id, work_date, time_in, created_by)
  values (
    auth.uid(),
    public.ph_today(),
    date_trunc('minute', now() at time zone 'Asia/Manila')::time,
    auth.uid()
  )
  returning * into v_row;

  return v_row;
exception when unique_violation then
  raise exception 'Already clocked in today';
end;
$$;

create or replace function public.clock_out()
returns public.time_records
language plpgsql
security definer set search_path = public
as $$
declare
  v_out time := date_trunc('minute', now() at time zone 'Asia/Manila')::time;
  v_row public.time_records;
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  select * into v_row from public.time_records
  where profile_id = auth.uid()
    and work_date = public.ph_today()
    and time_out is null;

  if not found then
    raise exception 'Not clocked in today (or already clocked out)';
  end if;

  if v_out <= v_row.time_in then
    raise exception 'Clock out must be after clock in — wait a minute and try again';
  end if;

  update public.time_records
  set time_out = v_out
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- Owner correction/entry: fixes missed punches or adds a forgotten day.
create or replace function public.upsert_time_record(
  p_profile_id uuid,
  p_work_date date,
  p_time_in time,
  p_time_out time default null,
  p_note text default null
)
returns public.time_records
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.time_records;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can edit time records';
  end if;

  if p_time_out is not null and p_time_out <= p_time_in then
    raise exception 'Time out must be after time in';
  end if;

  insert into public.time_records (profile_id, work_date, time_in, time_out, note, created_by)
  values (
    p_profile_id, p_work_date, p_time_in, p_time_out,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  )
  on conflict (profile_id, work_date) do update
  set time_in = excluded.time_in,
      time_out = excluded.time_out,
      note = excluded.note
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.delete_time_record(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete time records';
  end if;

  delete from public.time_records where id = p_id;

  if not found then
    raise exception 'Time record not found';
  end if;
end;
$$;

create or replace function public.set_hourly_rate(p_profile_id uuid, p_rate numeric)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can set rates';
  end if;

  if p_rate is null or p_rate <= 0 then
    raise exception 'Rate must be greater than zero';
  end if;

  insert into public.employee_rates (id, hourly_rate)
  values (p_profile_id, p_rate)
  on conflict (id) do update set hourly_rate = excluded.hourly_rate;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────
alter table public.time_records enable row level security;
alter table public.holidays enable row level security;
alter table public.employee_rates enable row level security;

-- time_records: staff read their own, owner reads all; writes only via the
-- security definer functions above (no insert/update/delete policies)
create policy time_records_select on public.time_records
  for select using (
    public.is_active_user() and (profile_id = auth.uid() or public.is_owner())
  );

-- holidays: reference data — everyone reads, owner edits directly
create policy holidays_select on public.holidays
  for select using (public.is_active_user());
create policy holidays_insert on public.holidays
  for insert with check (public.is_owner());
create policy holidays_update on public.holidays
  for update using (public.is_owner());
create policy holidays_delete on public.holidays
  for delete using (public.is_owner());

-- employee_rates: each user may read their own rate, owner reads all;
-- writes only via set_hourly_rate()
create policy employee_rates_select on public.employee_rates
  for select using (
    public.is_active_user() and (id = auth.uid() or public.is_owner())
  );

-- ──────────────────────────────────────────────────────────────
-- Views (invoker rights — the RLS above scopes staff to themselves)
-- ──────────────────────────────────────────────────────────────
-- Per-day rows: every time record, plus synthetic rows for UNWORKED past
-- regular holidays (DOLE: one day's pay = 8h × rate), counted only from an
-- employee's first recorded day onward. Special days unworked pay nothing.
-- A record with a missing time_out yields null hours/pay (owner fixes it);
-- the unworked-holiday fallback does NOT apply when a record exists.
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

create or replace view public.v_dtr_month
with (security_invoker = true)
as
select
  profile_id,
  date_trunc('month', work_date)::date as month,
  count(record_id) as days_worked,
  count(*) filter (where record_id is not null and time_out is null)
    as open_records,
  coalesce(sum(hours_worked), 0) as total_hours,
  sum(day_pay) as total_pay,     -- null when no rate is set
  bool_or(hourly_rate is null) as rate_missing
from public.v_dtr_days
group by 1, 2;
