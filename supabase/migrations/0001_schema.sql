-- E & J Appliances Furniture — core schema
-- Run via Supabase SQL editor or `supabase db push`.

create extension if not exists pg_trgm;

-- ──────────────────────────────────────────────────────────────
-- Profiles (mirrors auth.users; holds role)
-- ──────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'staff' check (role in ('owner', 'staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row when a user is created
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_owner()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner' and active
  );
$$;

create or replace function public.is_active_user()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- Customers
-- ──────────────────────────────────────────────────────────────
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  last_name text not null,
  first_name text not null,
  display_name text generated always as (last_name || ', ' || first_name) stored,
  phones text[] not null default '{}',
  messenger_url text,
  gps_url text,
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index customers_display_name_trgm on public.customers
  using gin (display_name gin_trgm_ops);
create index customers_display_name_lower on public.customers (lower(display_name));

-- ──────────────────────────────────────────────────────────────
-- Contracts
-- ──────────────────────────────────────────────────────────────
create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  contract_no text unique not null,
  customer_id uuid not null references public.customers (id),
  contract_date date not null,
  item_description text not null,
  item_type text,
  quantity int not null default 1 check (quantity > 0),
  cash_price numeric(12,2) not null check (cash_price > 0),
  term_months int not null check (term_months in (4, 5, 6, 12)),
  -- snapshotted by create_contract(); never recomputed after creation
  total_price numeric(12,2) not null,
  downpayment numeric(12,2) not null,
  monthly_amortization numeric(12,2) not null,
  sales_agent text,
  delivery_status text not null default 'Out for Delivery',
  payment_status text not null default 'open' check (payment_status in ('open', 'closed')),
  collection_status text check (collection_status in (
    'Paid', 'Asked for extension', 'Collect in-person',
    'Pull-out letter prepared', 'Pull-out letter sent', 'Item for pull-out'
  )),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contracts_customer_id on public.contracts (customer_id);
create index contracts_payment_status on public.contracts (payment_status);
create index contracts_contract_date on public.contracts (contract_date);
create index contracts_item_description_trgm on public.contracts
  using gin (item_description gin_trgm_ops);

-- ──────────────────────────────────────────────────────────────
-- Payments (void, never delete)
-- ──────────────────────────────────────────────────────────────
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  payment_no text unique not null,
  contract_id uuid not null references public.contracts (id),
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  receipt_no text,
  receipt_type text,
  reference_no text,
  recorded_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text
);

create index payments_contract_id on public.payments (contract_id);
create index payments_payment_date on public.payments (payment_date);

-- ──────────────────────────────────────────────────────────────
-- Contract notes (replaces timestamped text appends in the Sheet)
-- ──────────────────────────────────────────────────────────────
create table public.contract_notes (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete cascade,
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index contract_notes_contract_id on public.contract_notes (contract_id);

-- ──────────────────────────────────────────────────────────────
-- Audit log (replaces the "Change logs" sheet; written by triggers)
-- ──────────────────────────────────────────────────────────────
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id uuid not null,
  field text not null,
  old_value text,
  new_value text,
  changed_by uuid,
  changed_at timestamptz not null default now()
);

create index audit_log_record on public.audit_log (table_name, record_id);
create index audit_log_changed_at on public.audit_log (changed_at);

create or replace function public.audit_row_changes()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  k text;
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
begin
  for k in select jsonb_object_keys(new_j) loop
    if k in ('updated_at', 'created_at') then continue; end if;
    if old_j->k is distinct from new_j->k then
      insert into public.audit_log (table_name, record_id, field, old_value, new_value, changed_by)
      values (tg_table_name, (new_j->>'id')::uuid, k, old_j->>k, new_j->>k, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;

create trigger audit_contracts after update on public.contracts
  for each row execute function public.audit_row_changes();
create trigger audit_payments after update on public.payments
  for each row execute function public.audit_row_changes();
create trigger audit_customers after update on public.customers
  for each row execute function public.audit_row_changes();

-- keep updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger touch_contracts before update on public.contracts
  for each row execute function public.touch_updated_at();
create trigger touch_customers before update on public.customers
  for each row execute function public.touch_updated_at();

-- ──────────────────────────────────────────────────────────────
-- Race-free ID counters
-- ──────────────────────────────────────────────────────────────
create table public.id_counters (
  scope text primary key,        -- 'contract:2026', 'payment'
  last_value int not null
);

create or replace function public.next_counter(p_scope text, p_start int default 0)
returns int
language plpgsql
security definer set search_path = public
as $$
declare
  v int;
begin
  insert into public.id_counters (scope, last_value)
  values (p_scope, p_start)
  on conflict (scope) do nothing;

  update public.id_counters
  set last_value = last_value + 1
  where scope = p_scope
  returning last_value into v;

  return v;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Business math: term computation (mirrors lib/amortization.ts —
-- keep the two in sync; both are tested against the same fixture)
-- ──────────────────────────────────────────────────────────────
create or replace function public.compute_terms(p_cash_price numeric, p_term_months int)
returns table (total_price numeric, downpayment numeric, monthly_amortization numeric)
language plpgsql immutable
as $$
declare
  v_total numeric;
  v_dp numeric;
begin
  v_dp := round(p_cash_price * 0.25, 2);

  if p_term_months in (4, 5) then
    v_total := p_cash_price;                                    -- "Good as Cash"
  elsif p_term_months = 6 then
    v_total := round(p_cash_price * 1.3 * 0.75 + p_cash_price * 0.25, 2);
  elsif p_term_months = 12 then
    v_total := round(p_cash_price * 1.5 * 0.75 + p_cash_price * 0.25, 2);
  else
    raise exception 'Unsupported term: % months', p_term_months;
  end if;

  return query select
    v_total,
    v_dp,
    round((v_total - v_dp) / p_term_months, 2);
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Write entry points (the app never fabricates IDs)
-- ──────────────────────────────────────────────────────────────
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
  if not public.is_active_user() then
    raise exception 'Not authorized';
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
  if not public.is_active_user() then
    raise exception 'Not authorized';
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

create or replace function public.void_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can void payments';
  end if;

  update public.payments
  set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_payment_id and voided_at is null;

  if not found then
    raise exception 'Payment not found or already voided';
  end if;
end;
$$;

-- Staff may update ONLY these two status fields (owner edits everything else)
create or replace function public.update_contract_status(
  p_contract_id uuid,
  p_collection_status text default null,
  p_delivery_status text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'Not authorized';
  end if;

  update public.contracts
  set collection_status = coalesce(p_collection_status, collection_status),
      delivery_status   = coalesce(p_delivery_status, delivery_status)
  where id = p_contract_id;

  if not found then
    raise exception 'Contract not found';
  end if;
end;
$$;

create or replace function public.close_contract(p_contract_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can close contracts';
  end if;
  update public.contracts set payment_status = 'closed' where id = p_contract_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Row Level Security
-- ──────────────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.contracts enable row level security;
alter table public.payments enable row level security;
alter table public.contract_notes enable row level security;
alter table public.audit_log enable row level security;
alter table public.id_counters enable row level security;

-- profiles: users see all active profiles (names on payments etc.); owner manages
create policy profiles_select on public.profiles
  for select using (public.is_active_user());
create policy profiles_update_owner on public.profiles
  for update using (public.is_owner());

-- customers: read + insert/update for active users, delete owner-only
create policy customers_select on public.customers
  for select using (public.is_active_user());
create policy customers_insert on public.customers
  for insert with check (public.is_active_user());
create policy customers_update on public.customers
  for update using (public.is_active_user());
create policy customers_delete on public.customers
  for delete using (public.is_owner());

-- contracts: read for active users; writes only via functions (security definer)
-- or direct UPDATE by owner (edit page)
create policy contracts_select on public.contracts
  for select using (public.is_active_user());
create policy contracts_update_owner on public.contracts
  for update using (public.is_owner());
create policy contracts_delete_owner on public.contracts
  for delete using (public.is_owner());

-- payments: read for active users; no direct insert/update/delete
-- (record_payment / void_payment are security definer)
create policy payments_select on public.payments
  for select using (public.is_active_user());

-- notes: read + insert for active users; edit/delete owner-only
create policy notes_select on public.contract_notes
  for select using (public.is_active_user());
create policy notes_insert on public.contract_notes
  for insert with check (public.is_active_user() and created_by = auth.uid());
create policy notes_update_owner on public.contract_notes
  for update using (public.is_owner());
create policy notes_delete_owner on public.contract_notes
  for delete using (public.is_owner());

-- audit log: owner reads; nobody writes directly (triggers are security definer)
create policy audit_select_owner on public.audit_log
  for select using (public.is_owner());

-- id_counters: no direct access (functions are security definer)
