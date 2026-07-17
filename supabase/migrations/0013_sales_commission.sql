-- E & J — Sales agents & commission
-- Agent becomes first-class: assign an agent to a contract, accrue a 10%
-- commission on cash_price that becomes payable once the customer pays the
-- full downpayment, track payouts, and run a lead pipeline (agent submits →
-- admin converts). agent_id / RLS scaffolding was added in 0011.

-- ──────────────────────────────────────────────────────────────
-- 1. Downpayment-paid signal (money/time-critical → SQL only).
--    v_contract_financials can't be re-created cleanly (its frozen c.* would
--    reorder columns), so this is a separate view.
-- ──────────────────────────────────────────────────────────────
create or replace view public.v_contract_dp
with (security_invoker = true)
as
with running as (
  select
    p.contract_id,
    p.payment_date,
    sum(p.amount) over (
      partition by p.contract_id
      order by p.payment_date, p.payment_no
      rows between unbounded preceding and current row
    ) as cumulative
  from public.payments p
  where p.voided_at is null
),
crossed as (
  select r.contract_id, min(r.payment_date) as dp_paid_date
  from running r
  join public.contracts c on c.id = r.contract_id
  where r.cumulative >= c.downpayment
  group by r.contract_id
),
totals as (
  select contract_id, sum(amount) as total_paid
  from public.payments
  where voided_at is null
  group by contract_id
)
select
  c.id as contract_id,
  coalesce(t.total_paid, 0) as total_paid,
  (coalesce(t.total_paid, 0) >= c.downpayment) as dp_paid,
  x.dp_paid_date
from public.contracts c
left join totals t on t.contract_id = c.id
left join crossed x on x.contract_id = c.id;

-- ──────────────────────────────────────────────────────────────
-- 2. Commissions — one per contract, amounts snapshotted.
-- ──────────────────────────────────────────────────────────────
create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  commission_no text unique not null,             -- 'COM####'
  contract_id uuid not null unique references public.contracts (id),
  agent_id uuid not null references public.profiles (id),
  base_amount numeric(12,2) not null,             -- snapshot of cash_price
  rate numeric(5,4) not null default 0.10,
  commission_amount numeric(12,2) not null,       -- snapshot round(base*rate,2)
  paid_at timestamptz,
  paid_by uuid references public.profiles (id),
  paid_reference text,
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id)
);

create index commissions_agent on public.commissions (agent_id);
create index commissions_contract on public.commissions (contract_id);

-- ──────────────────────────────────────────────────────────────
-- 3. Leads — agent submits, admin converts to a contract.
-- ──────────────────────────────────────────────────────────────
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_no text unique not null,                   -- 'LEAD####'
  agent_id uuid not null references public.profiles (id),
  customer_name text not null,
  phone text,
  address text,
  messenger_url text,
  item_description text not null,
  item_type text,
  estimated_price numeric(12,2),
  note text,
  status text not null default 'new' check (status in ('new', 'converted', 'rejected')),
  contract_id uuid references public.contracts (id),
  reject_reason text,
  created_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id),
  resolved_at timestamptz
);

create index leads_agent on public.leads (agent_id);
create index leads_status on public.leads (status);

-- ──────────────────────────────────────────────────────────────
-- 4. v_commissions — commission + contract + dp signal + names, with a
--    derived status (pending → earned → paid; voided).
-- ──────────────────────────────────────────────────────────────
create or replace view public.v_commissions
with (security_invoker = true)
as
select
  cm.*,
  c.contract_no,
  c.cash_price,
  c.payment_status,
  cu.display_name as customer_name,
  ag.full_name as agent_name,
  coalesce(dp.dp_paid, false) as dp_paid,
  dp.dp_paid_date,
  case
    when cm.voided_at is not null then 'voided'
    when cm.paid_at is not null then 'paid'
    when coalesce(dp.dp_paid, false) then 'earned'
    else 'pending'
  end as status
from public.commissions cm
join public.contracts c on c.id = cm.contract_id
join public.customers cu on cu.id = c.customer_id
left join public.profiles ag on ag.id = cm.agent_id
left join public.v_contract_dp dp on dp.contract_id = cm.contract_id;

-- ──────────────────────────────────────────────────────────────
-- 5. create_contract — add p_agent_id + inline commission.
--    Must DROP the 9-arg version first (a defaulted 10th arg would create an
--    overload → PostgREST ambiguity).
-- ──────────────────────────────────────────────────────────────
drop function if exists public.create_contract(uuid, date, text, text, int, numeric, int, text, text);

create or replace function public.create_contract(
  p_customer_id uuid,
  p_contract_date date,
  p_item_description text,
  p_item_type text,
  p_quantity int,
  p_cash_price numeric,
  p_term_months int,
  p_sales_agent text,
  p_note text default null,
  p_agent_id uuid default null
)
returns public.contracts
language plpgsql
security definer set search_path = public
as $$
declare
  v_year text := to_char(p_contract_date, 'YYYY');
  v_n int;
  v_terms record;
  v_row public.contracts;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can create contracts';
  end if;
  if p_agent_id is not null and not exists (
    select 1 from public.profiles where id = p_agent_id and role = 'sales_agent' and active
  ) then
    raise exception 'Sales agent must be an active sales_agent user';
  end if;

  v_n := public.next_counter('contract:' || v_year);
  select * into v_terms from public.compute_terms(p_cash_price, p_term_months);

  insert into public.contracts (
    contract_no, customer_id, contract_date, item_description, item_type,
    quantity, cash_price, term_months, total_price, downpayment,
    monthly_amortization, sales_agent, agent_id, created_by
  ) values (
    v_year || lpad(v_n::text, 3, '0'),
    p_customer_id, p_contract_date, p_item_description, p_item_type,
    p_quantity, p_cash_price, p_term_months,
    v_terms.total_price, v_terms.downpayment, v_terms.monthly_amortization,
    p_sales_agent, p_agent_id, auth.uid()
  )
  returning * into v_row;

  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.contract_notes (contract_id, body, created_by)
    values (v_row.id, trim(p_note), auth.uid());
  end if;

  if p_agent_id is not null then
    insert into public.commissions (
      commission_no, contract_id, agent_id, base_amount, rate, commission_amount, created_by
    ) values (
      'COM' || lpad(public.next_counter('commission')::text, 4, '0'),
      v_row.id, p_agent_id, v_row.cash_price, 0.10,
      round(v_row.cash_price * 0.10, 2), auth.uid()
    );
  end if;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. RPCs
-- ──────────────────────────────────────────────────────────────

-- Assign / reassign / clear the agent on an existing contract; keep the
-- commission in sync.
create or replace function public.set_contract_agent(
  p_contract_id uuid,
  p_agent_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_contract public.contracts;
  v_com public.commissions;
  v_agent_name text;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can set the sales agent';
  end if;
  if p_agent_id is not null and not exists (
    select 1 from public.profiles where id = p_agent_id and role = 'sales_agent' and active
  ) then
    raise exception 'Assignee must be an active sales agent';
  end if;

  select * into v_contract from public.contracts where id = p_contract_id;
  if not found then
    raise exception 'Contract not found';
  end if;

  if p_agent_id is not null then
    select full_name into v_agent_name from public.profiles where id = p_agent_id;
  end if;

  update public.contracts
  set agent_id = p_agent_id,
      sales_agent = coalesce(v_agent_name, sales_agent)
  where id = p_contract_id;

  select * into v_com from public.commissions where contract_id = p_contract_id;

  if p_agent_id is null then
    if found then
      if v_com.paid_at is not null then
        raise exception 'Cannot clear the agent: commission already paid';
      end if;
      delete from public.commissions where contract_id = p_contract_id;
    end if;
  else
    if not found then
      insert into public.commissions (
        commission_no, contract_id, agent_id, base_amount, rate, commission_amount, created_by
      ) values (
        'COM' || lpad(public.next_counter('commission')::text, 4, '0'),
        p_contract_id, p_agent_id, v_contract.cash_price, 0.10,
        round(v_contract.cash_price * 0.10, 2), auth.uid()
      );
    else
      if v_com.paid_at is not null and v_com.agent_id <> p_agent_id then
        raise exception 'Cannot reassign: commission already paid to another agent';
      end if;
      update public.commissions set agent_id = p_agent_id where contract_id = p_contract_id;
    end if;
  end if;
end;
$$;

-- Mark an earned commission as paid out.
create or replace function public.mark_commission_paid(
  p_commission_id uuid,
  p_reference text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_com public.commissions;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can pay commissions';
  end if;

  select * into v_com from public.commissions where id = p_commission_id;
  if not found then
    raise exception 'Commission not found';
  end if;
  if v_com.voided_at is not null then
    raise exception 'Commission is voided';
  end if;
  if v_com.paid_at is not null then
    raise exception 'Commission already paid';
  end if;
  if not coalesce((select dp_paid from public.v_contract_dp where contract_id = v_com.contract_id), false) then
    raise exception 'Not earned yet — customer has not fully paid the downpayment';
  end if;

  update public.commissions
  set paid_at = now(), paid_by = auth.uid(),
      paid_reference = nullif(trim(coalesce(p_reference, '')), '')
  where id = p_commission_id;
end;
$$;

-- Reverse a payout mark (correction).
create or replace function public.unmark_commission_paid(p_commission_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reverse a commission payout';
  end if;

  update public.commissions
  set paid_at = null, paid_by = null, paid_reference = null
  where id = p_commission_id and paid_at is not null;

  if not found then
    raise exception 'Commission not found or not paid';
  end if;
end;
$$;

-- Void a commission (cancelled deal).
create or replace function public.void_commission(p_commission_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can void commissions';
  end if;

  update public.commissions
  set voided_at = now(), voided_by = auth.uid(),
      void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_commission_id and voided_at is null;

  if not found then
    raise exception 'Commission not found or already voided';
  end if;
end;
$$;

-- Agent submits a lead.
create or replace function public.submit_lead(
  p_customer_name text,
  p_phone text,
  p_address text,
  p_messenger_url text,
  p_item_description text,
  p_item_type text,
  p_estimated_price numeric,
  p_note text
)
returns public.leads
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.leads;
begin
  if not public.is_sales_agent() then
    raise exception 'Only a sales agent can submit leads';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'Customer name is required';
  end if;
  if coalesce(trim(p_item_description), '') = '' then
    raise exception 'Item description is required';
  end if;

  v_n := public.next_counter('lead');

  insert into public.leads (
    lead_no, agent_id, customer_name, phone, address, messenger_url,
    item_description, item_type, estimated_price, note
  ) values (
    'LEAD' || lpad(v_n::text, 4, '0'),
    auth.uid(), trim(p_customer_name),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_address, '')), ''),
    nullif(trim(coalesce(p_messenger_url, '')), ''),
    trim(p_item_description),
    nullif(trim(coalesce(p_item_type, '')), ''),
    p_estimated_price,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Owner/admin rejects a lead.
create or replace function public.reject_lead(p_lead_id uuid, p_reason text default null)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can reject leads';
  end if;

  update public.leads
  set status = 'rejected',
      reject_reason = nullif(trim(coalesce(p_reason, '')), ''),
      resolved_by = auth.uid(), resolved_at = now()
  where id = p_lead_id and status = 'new';

  if not found then
    raise exception 'Lead not found or already handled';
  end if;
end;
$$;

-- Owner/admin links a lead to the contract created from it.
create or replace function public.mark_lead_converted(p_lead_id uuid, p_contract_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can convert leads';
  end if;

  update public.leads
  set status = 'converted', contract_id = p_contract_id,
      resolved_by = auth.uid(), resolved_at = now()
  where id = p_lead_id and status = 'new';

  if not found then
    raise exception 'Lead not found or already handled';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 7. RLS
-- ──────────────────────────────────────────────────────────────
alter table public.commissions enable row level security;
alter table public.leads enable row level security;

create policy commissions_select on public.commissions
  for select using (
    public.is_active_user() and (public.can_post_payments() or agent_id = auth.uid())
  );

create policy leads_select on public.leads
  for select using (
    public.is_active_user() and (public.can_post_payments() or agent_id = auth.uid())
  );

-- Tighten PII: a sales_agent may read only customers / notes tied to a
-- contract they own. Employees (not sales_agent) keep full read.
drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers
  for select using (
    public.is_active_user() and (
      not public.is_sales_agent()
      or exists (
        select 1 from public.contracts c
        where c.customer_id = customers.id and c.agent_id = auth.uid()
      )
    )
  );

drop policy if exists notes_select on public.contract_notes;
create policy notes_select on public.contract_notes
  for select using (
    public.is_active_user() and (
      not public.is_sales_agent()
      or exists (
        select 1 from public.contracts c
        where c.id = contract_notes.contract_id and c.agent_id = auth.uid()
      )
    )
  );
