-- E & J — Meal allowance and 13th-month pay
--
-- Both surfaced by hiring a collector on a contract that grants a daily meal
-- allowance and (as the law requires) 13th-month pay. Neither existed.
--
-- ── WHY basic_pay IS NOT dtr_pay ─────────────────────────────────────────────
-- 13th-month pay is 1/12 of BASIC salary earned in the calendar year. The IRR
-- defines basic salary as earnings for services rendered but EXCLUDING
-- allowances, COLA, overtime, premium, night differential and holiday pay.
--
-- payslips.dtr_pay is the wrong number: v_dtr_days.day_pay already applies the
-- holiday multipliers (worked regular holiday x2.00, special x1.30) and the
-- 8-hour unworked-regular-holiday payment. Using it would OVERPAY the 13th
-- month.
--
-- v_dtr_days exposes hours_worked, multiplier and hourly_rate separately, so
-- the basic portion is simply:
--
--     basic = sum(hours_worked * hourly_rate)
--
-- The x1.00 portion only. And because the synthetic unworked-holiday rows carry
-- hours_worked = 0, that single expression drops the premium AND the holiday
-- pay with no special-casing and no change to the frozen view.
--
-- POLICY CALL, deliberately visible: unworked regular-holiday pay is excluded
-- from the base. That is the DOLE exclusion list read straight, and the
-- defensible position for a daily/hourly-paid employee. The law permits
-- INCLUDING it where company policy treats it as basic — if E & J ever decides
-- that, change the basic_pay expression in payslip_recompute below and say so
-- in writing to the employees. Do not change it by accident.

alter table public.employee_rates
  add column if not exists meal_allowance_per_day numeric(8,2) not null default 0
    check (meal_allowance_per_day >= 0);

comment on column public.employee_rates.meal_allowance_per_day is
  'Supplement paid per day actually worked, on top of the wage. NOT part of '
  'basic salary, so it is excluded from the 13th-month base — which is exactly '
  'how the employment contract describes it.';

alter table public.payslips
  add column if not exists basic_pay numeric(12,2) not null default 0,
  add column if not exists meal_allowance numeric(12,2) not null default 0;

comment on column public.payslips.basic_pay is
  'The 13th-month-eligible portion: hours worked x hourly rate, excluding '
  'holiday premiums and unworked-holiday pay. Snapshotted like every other '
  'payslip amount so a later rate change never rewrites a finalised slip.';

-- ──────────────────────────────────────────────────────────────
-- set_meal_allowance
-- ──────────────────────────────────────────────────────────────
-- Owner-only, mirroring set_hourly_rate. Deliberately NOT folded into
-- set_contributions: that takes six positional arguments and adding a seventh
-- would mean touching the RPC, the action, the type, the FIELDS array and the
-- form payload.
create or replace function public.set_meal_allowance(
  p_profile_id uuid,
  p_amount numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can set the meal allowance';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'Meal allowance cannot be negative';
  end if;

  update public.employee_rates
  set meal_allowance_per_day = p_amount
  where id = p_profile_id;

  if not found then
    raise exception 'Set the hourly rate first';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- payslip_recompute — now also basic_pay and meal_allowance
-- ──────────────────────────────────────────────────────────────
-- Everything else is unchanged from 0009. The allowance joins total_income and
-- net_pay; basic_pay is recorded but never itself paid out — it exists so the
-- 13th-month base can be summed from finalised slips rather than recomputed
-- from DTR years later, when rates may have changed.
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

  select coalesce(sum(hours_worked), 0),
         coalesce(sum(day_pay), 0),
         -- basic = the x1.00 portion. Synthetic unworked-holiday rows have
         -- hours_worked = 0, so they contribute nothing here by construction.
         coalesce(sum(hours_worked * hourly_rate), 0),
         count(record_id)
  into v_hours, v_pay, v_basic, v_days
  from public.v_dtr_days
  where profile_id = v_slip.profile_id
    and work_date between v_slip.period_start and v_slip.period_end;

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

-- ──────────────────────────────────────────────────────────────
-- 13th-month pay
-- ──────────────────────────────────────────────────────────────
create table if not exists public.thirteenth_month_payments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  year int not null check (year between 2020 and 2100),
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index if not exists thirteenth_month_profile_year
  on public.thirteenth_month_payments (profile_id, year);

alter table public.thirteenth_month_payments enable row level security;

-- Same shape as payslips: the owner sees everything, staff see only their own.
-- Dropped first so this migration stays re-runnable — Postgres has no
-- `create policy if not exists`.
drop policy if exists thirteenth_select_owner on public.thirteenth_month_payments;
create policy thirteenth_select_owner on public.thirteenth_month_payments
  for select using (public.is_owner() or profile_id = auth.uid());

-- Entitlement per employee per calendar year, from FINAL payslips only —
-- a draft is not yet a fact. Bucketed by period_end so a slip is counted in
-- the year it was earned.
create or replace view public.v_thirteenth_month
with (security_invoker = true)
as
with earned as (
  select
    s.profile_id,
    extract(year from s.period_end)::int as year,
    sum(s.basic_pay) as basic_earned,
    count(*) as slips
  from public.payslips s
  where s.status = 'final'
  group by 1, 2
),
paid as (
  select profile_id, year, sum(amount) as paid_amount, max(paid_on) as last_paid
  from public.thirteenth_month_payments
  group by 1, 2
)
select
  e.profile_id,
  p.full_name,
  e.year,
  e.slips,
  round(e.basic_earned, 2) as basic_earned,
  round(e.basic_earned / 12.0, 2) as entitlement,
  round(coalesce(x.paid_amount, 0), 2) as paid_amount,
  round(e.basic_earned / 12.0 - coalesce(x.paid_amount, 0), 2) as balance,
  x.last_paid
from earned e
join public.profiles p on p.id = e.profile_id
left join paid x on x.profile_id = e.profile_id and x.year = e.year;

create or replace function public.record_13th_month_payment(
  p_profile_id uuid,
  p_year int,
  p_amount numeric,
  p_paid_on date default null,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can record a 13th-month payment';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  insert into public.thirteenth_month_payments
    (profile_id, year, amount, paid_on, note, created_by)
  values (
    p_profile_id, p_year, p_amount,
    coalesce(p_paid_on, public.ph_today()),
    nullif(trim(coalesce(p_note, '')), ''),
    auth.uid()
  );
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Backfill basic_pay on payslips that predate this migration
-- ──────────────────────────────────────────────────────────────
-- Without this, an already-finalised slip carries basic_pay = 0 and its whole
-- basic salary is invisible to the 13th-month calculation — the one existing
-- slip would have understated the entitlement by its full value.
--
-- Uses the payslip's OWN snapshotted hourly_rate, not the live rate in
-- employee_rates: the slip is a historical record and must not shift if the
-- rate has changed since. Only touches rows still at 0, so it is idempotent
-- and never revises a slip already computed correctly. net_pay and every other
-- amount are deliberately left alone — basic_pay only feeds the 13th-month
-- base and no money moves.
update public.payslips s
set basic_pay = round(coalesce((
      select sum(d.hours_worked) from public.v_dtr_days d
      where d.profile_id = s.profile_id
        and d.work_date between s.period_start and s.period_end
    ), 0) * s.hourly_rate, 2)
where s.basic_pay = 0
  and s.hourly_rate > 0;
