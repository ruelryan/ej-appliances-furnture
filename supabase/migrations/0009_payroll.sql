-- Semi-monthly payroll payslips, computed from the DTR.
--
-- Periods are 1–15 and 16–end of month. Income = DTR pay for the period
-- (v_dtr_days.day_pay already includes holiday premiums and unworked
-- weekday regular holidays) plus free-form extra income lines. Government
-- contributions (fixed monthly per-employee amounts on employee_rates) are
-- deducted only on the 16–end slip; EE share is deducted, ER share is
-- recorded for the owner's books. Payslips SNAPSHOT all amounts (same
-- philosophy as create_contract) — later DTR/config changes never alter an
-- existing slip. Status: draft (owner workspace) → final (visible to the
-- employee). Wrong final slip: reopen → refresh → finalize.

-- ──────────────────────────────────────────────────────────────
-- Monthly contribution config (employee_rates already has the right
-- RLS, audit trigger, and owner-only write path)
-- ──────────────────────────────────────────────────────────────
alter table public.employee_rates
  add column philhealth_ee numeric(8,2) not null default 0 check (philhealth_ee >= 0),
  add column philhealth_er numeric(8,2) not null default 0 check (philhealth_er >= 0),
  add column sss_ee        numeric(8,2) not null default 0 check (sss_ee >= 0),
  add column sss_er        numeric(8,2) not null default 0 check (sss_er >= 0),
  add column pagibig_ee    numeric(8,2) not null default 0 check (pagibig_ee >= 0),
  add column pagibig_er    numeric(8,2) not null default 0 check (pagibig_er >= 0);

-- ──────────────────────────────────────────────────────────────
-- Extra-line helpers (immutable so CHECK constraints can use them)
-- Lines look like: [{"label": "Out-of-office duty", "amount": 1000}]
-- ──────────────────────────────────────────────────────────────
create or replace function public.payslip_lines_valid(p jsonb)
returns boolean
language sql immutable
as $$
  select jsonb_typeof(p) = 'array' and not exists (
    select 1 from jsonb_array_elements(p) e
    where jsonb_typeof(e) <> 'object'
       or coalesce(trim(e->>'label'), '') = ''
       or (e->>'amount') is null
       or not ((e->>'amount') ~ '^[0-9]+(\.[0-9]{1,2})?$')
       or (e->>'amount')::numeric <= 0
  );
$$;

create or replace function public.payslip_lines_total(p jsonb)
returns numeric
language sql immutable
as $$
  select coalesce(sum((e->>'amount')::numeric), 0)
  from jsonb_array_elements(p) e;
$$;

-- ──────────────────────────────────────────────────────────────
-- Payslips
-- ──────────────────────────────────────────────────────────────
create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (status in ('draft', 'final')),
  -- DTR snapshot (set by payslip_recompute)
  dtr_hours numeric(7,2) not null default 0,
  dtr_pay numeric(12,2) not null default 0,
  days_worked int not null default 0,
  hourly_rate numeric(8,2) not null default 0,
  -- free-form lines
  extra_income jsonb not null default '[]'
    check (public.payslip_lines_valid(extra_income)),
  extra_deductions jsonb not null default '[]'
    check (public.payslip_lines_valid(extra_deductions)),
  -- contribution snapshot (all zero on 1–15 slips)
  philhealth_ee numeric(8,2) not null default 0,
  philhealth_er numeric(8,2) not null default 0,
  sss_ee numeric(8,2) not null default 0,
  sss_er numeric(8,2) not null default 0,
  pagibig_ee numeric(8,2) not null default 0,
  pagibig_er numeric(8,2) not null default 0,
  -- totals (snapshotted; the UI never recomputes)
  total_income numeric(12,2) not null default 0,
  total_deductions numeric(12,2) not null default 0,
  net_pay numeric(12,2) not null default 0,
  finalized_by uuid references public.profiles (id),
  finalized_at timestamptz,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, period_start),
  constraint valid_period_start check (extract(day from period_start) in (1, 16)),
  constraint period_end_after_start check (period_end > period_start)
);

drop trigger if exists touch_payslips on public.payslips;
create trigger touch_payslips before update on public.payslips
  for each row execute function public.touch_updated_at();
drop trigger if exists audit_payslips on public.payslips;
create trigger audit_payslips after update on public.payslips
  for each row execute function public.audit_row_changes();

-- ──────────────────────────────────────────────────────────────
-- Write entry points
-- ──────────────────────────────────────────────────────────────
create or replace function public.set_contributions(
  p_profile_id uuid,
  p_philhealth_ee numeric, p_philhealth_er numeric,
  p_sss_ee numeric, p_sss_er numeric,
  p_pagibig_ee numeric, p_pagibig_er numeric
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can set contributions';
  end if;

  update public.employee_rates
  set philhealth_ee = coalesce(p_philhealth_ee, 0),
      philhealth_er = coalesce(p_philhealth_er, 0),
      sss_ee        = coalesce(p_sss_ee, 0),
      sss_er        = coalesce(p_sss_er, 0),
      pagibig_ee    = coalesce(p_pagibig_ee, 0),
      pagibig_er    = coalesce(p_pagibig_er, 0)
  where id = p_profile_id;

  if not found then
    raise exception 'Set the hourly rate first';
  end if;
end;
$$;

-- Internal: recompute a slip's DTR snapshot, contributions, and totals.
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
  v_days int;
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
         count(record_id)
  into v_hours, v_pay, v_days
  from public.v_dtr_days
  where profile_id = v_slip.profile_id
    and work_date between v_slip.period_start and v_slip.period_end;

  update public.payslips
  set dtr_hours = v_hours,
      dtr_pay = v_pay,
      days_worked = v_days,
      hourly_rate = v_rate.hourly_rate,
      -- contributions only on the 16–end slip
      philhealth_ee = case when extract(day from v_slip.period_start) = 16 then v_rate.philhealth_ee else 0 end,
      philhealth_er = case when extract(day from v_slip.period_start) = 16 then v_rate.philhealth_er else 0 end,
      sss_ee        = case when extract(day from v_slip.period_start) = 16 then v_rate.sss_ee else 0 end,
      sss_er        = case when extract(day from v_slip.period_start) = 16 then v_rate.sss_er else 0 end,
      pagibig_ee    = case when extract(day from v_slip.period_start) = 16 then v_rate.pagibig_ee else 0 end,
      pagibig_er    = case when extract(day from v_slip.period_start) = 16 then v_rate.pagibig_er else 0 end,
      total_income = round(v_pay + public.payslip_lines_total(extra_income), 2),
      total_deductions = round(
        case when extract(day from v_slip.period_start) = 16
             then v_rate.philhealth_ee + v_rate.sss_ee + v_rate.pagibig_ee
             else 0 end
        + public.payslip_lines_total(extra_deductions), 2),
      net_pay = round(
        v_pay + public.payslip_lines_total(extra_income)
        - (case when extract(day from v_slip.period_start) = 16
                then v_rate.philhealth_ee + v_rate.sss_ee + v_rate.pagibig_ee
                else 0 end
           + public.payslip_lines_total(extra_deductions)), 2)
  where id = p_id;
end;
$$;

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

  if v_end > public.ph_today() then
    raise exception 'Period is not finished yet';
  end if;

  insert into public.payslips (profile_id, period_start, period_end, created_by)
  values (p_profile_id, p_period_start, v_end, auth.uid())
  returning * into v_row;

  perform public.payslip_recompute(v_row.id);
  select * into v_row from public.payslips where id = v_row.id;
  return v_row;
exception when unique_violation then
  raise exception 'A payslip for this period already exists';
end;
$$;

create or replace function public.update_payslip_lines(
  p_id uuid,
  p_extra_income jsonb,
  p_extra_deductions jsonb
)
returns public.payslips
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.payslips;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can edit payslips';
  end if;

  update public.payslips
  set extra_income = coalesce(p_extra_income, '[]'::jsonb),
      extra_deductions = coalesce(p_extra_deductions, '[]'::jsonb)
  where id = p_id and status = 'draft';

  if not found then
    raise exception 'Payslip not found or already finalized — reopen it first';
  end if;

  perform public.payslip_recompute(p_id);
  select * into v_row from public.payslips where id = p_id;
  return v_row;
end;
$$;

-- Re-pull DTR + contribution amounts into a draft (after punch corrections
-- or contribution changes).
create or replace function public.refresh_payslip(p_id uuid)
returns public.payslips
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.payslips;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can refresh payslips';
  end if;

  select * into v_row from public.payslips where id = p_id;
  if not found then
    raise exception 'Payslip not found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Payslip is finalized — reopen it first';
  end if;

  perform public.payslip_recompute(p_id);
  select * into v_row from public.payslips where id = p_id;
  return v_row;
end;
$$;

create or replace function public.finalize_payslip(p_id uuid)
returns public.payslips
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.payslips;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can finalize payslips';
  end if;

  select * into v_row from public.payslips where id = p_id for update;
  if not found then
    raise exception 'Payslip not found';
  end if;
  if v_row.status <> 'draft' then
    raise exception 'Payslip is already finalized';
  end if;

  -- final slip always matches the DTR at this moment
  perform public.payslip_recompute(p_id);

  update public.payslips
  set status = 'final', finalized_by = auth.uid(), finalized_at = now()
  where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.reopen_payslip(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reopen payslips';
  end if;

  update public.payslips
  set status = 'draft', finalized_by = null, finalized_at = null
  where id = p_id and status = 'final';

  if not found then
    raise exception 'Payslip not found or not finalized';
  end if;
end;
$$;

create or replace function public.delete_payslip(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can delete payslips';
  end if;

  delete from public.payslips where id = p_id and status = 'draft';

  if not found then
    raise exception 'Payslip not found or finalized (reopen it first)';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────
alter table public.payslips enable row level security;

-- owner reads all; staff read their own FINAL slips only (drafts are the
-- owner's workspace); writes only via the functions above
create policy payslips_select on public.payslips
  for select using (
    public.is_active_user()
    and (public.is_owner() or (profile_id = auth.uid() and status = 'final'))
  );
