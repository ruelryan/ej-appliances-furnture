-- E & J — Role expansion (owner/staff → five business roles)
-- Adds admin, collector, sales_agent, delivery alongside owner.
-- 'staff' is kept in the CHECK during transition; existing staff are
-- migrated to 'admin' (they can post payments today, admin preserves that).
-- A later migration drops 'staff' once no rows use it.

-- ──────────────────────────────────────────────────────────────
-- 1. Widen the role CHECK
-- ──────────────────────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('owner', 'admin', 'collector', 'sales_agent', 'delivery', 'staff'));

-- 2. Migrate existing staff → admin (preserves current payment-posting ability)
update public.profiles set role = 'admin' where role = 'staff';

-- ──────────────────────────────────────────────────────────────
-- 3. Role-check helpers (mirror is_owner(): security definer, stable)
-- ──────────────────────────────────────────────────────────────

-- owner OR admin — the only roles allowed to post payments / create contracts
create or replace function public.can_post_payments()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin') and active
  );
$$;

create or replace function public.is_collector()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'collector' and active
  );
$$;

create or replace function public.is_sales_agent()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'sales_agent' and active
  );
$$;

create or replace function public.is_delivery()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'delivery' and active
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. Assignment dimension on contracts
--    (sales_agent text column stays for historical data; these FKs are new)
-- ──────────────────────────────────────────────────────────────
alter table public.contracts
  add column if not exists collector_id uuid references public.profiles (id),
  add column if not exists agent_id     uuid references public.profiles (id);

create index if not exists contracts_collector_id on public.contracts (collector_id);
create index if not exists contracts_agent_id on public.contracts (agent_id);

-- ──────────────────────────────────────────────────────────────
-- 5. Tighten write-path guards
--    (this is where "collectors cannot post payments" is enforced)
-- ──────────────────────────────────────────────────────────────

-- record_payment: was is_active_user() → now owner/admin only
create or replace function public.record_payment(
  p_contract_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_receipt_no text,
  p_receipt_type text,
  p_reference_no text default null
)
returns public.payments
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.payments;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can post payments';
  end if;

  v_n := public.next_counter('payment');

  insert into public.payments (
    payment_no, contract_id, payment_date, amount,
    receipt_no, receipt_type, reference_no, recorded_by
  ) values (
    'PAY' || lpad(v_n::text, 4, '0'),
    p_contract_id, p_payment_date, p_amount,
    nullif(trim(p_receipt_no), ''), nullif(trim(p_receipt_type), ''),
    nullif(trim(coalesce(p_reference_no, '')), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- create_contract: was is_active_user() → now owner/admin only
create or replace function public.create_contract(
  p_customer_id uuid,
  p_contract_date date,
  p_item_description text,
  p_item_type text,
  p_quantity int,
  p_cash_price numeric,
  p_term_months int,
  p_sales_agent text,
  p_note text default null
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

  v_n := public.next_counter('contract:' || v_year);
  select * into v_terms from public.compute_terms(p_cash_price, p_term_months);

  insert into public.contracts (
    contract_no, customer_id, contract_date, item_description, item_type,
    quantity, cash_price, term_months, total_price, downpayment,
    monthly_amortization, sales_agent, created_by
  ) values (
    v_year || lpad(v_n::text, 3, '0'),
    p_customer_id, p_contract_date, p_item_description, p_item_type,
    p_quantity, p_cash_price, p_term_months,
    v_terms.total_price, v_terms.downpayment, v_terms.monthly_amortization,
    p_sales_agent, auth.uid()
  )
  returning * into v_row;

  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.contract_notes (contract_id, body, created_by)
    values (v_row.id, trim(p_note), auth.uid());
  end if;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. Role-aware read scoping
--    contracts_select was a blanket is_active_user(); replace it so
--    collectors see only assigned contracts and sales agents see only
--    their own. Same policy rescopes v_contract_financials (security_invoker).
--    Owner + admin keep full visibility; delivery sees all (needs fulfilment).
-- ──────────────────────────────────────────────────────────────
drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select using (
    public.is_active_user() and (
      public.can_post_payments()
      or public.is_delivery()
      or (public.is_collector()   and collector_id = auth.uid())
      or (public.is_sales_agent() and agent_id     = auth.uid())
    )
  );

-- payments: same scoping so restricted roles can't read every payment.
-- Owner/admin see all; collector/agent see payments on contracts they own.
drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    public.is_active_user() and (
      public.can_post_payments()
      or exists (
        select 1 from public.contracts c
        where c.id = payments.contract_id and (
          (public.is_collector()   and c.collector_id = auth.uid())
          or (public.is_sales_agent() and c.agent_id  = auth.uid())
        )
      )
    )
  );
