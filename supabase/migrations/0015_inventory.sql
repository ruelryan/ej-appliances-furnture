-- E & J — Inventory (Phase 3b)
-- Product catalog with on-hand counts + an audit ledger. Stock decrements when
-- a delivery fulfilled from office stock (in_stock + product) is delivered.
-- Drop-shipped supplier orders never touch office stock.

-- ──────────────────────────────────────────────────────────────
-- 1. Products (all writes via RPC so on_hand stays logged)
-- ──────────────────────────────────────────────────────────────
create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,                      -- 'PRD####'
  name text not null,
  category text,
  on_hand int not null default 0,
  default_cost numeric(12,2),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index products_active on public.products (active);

-- 2. Stock movement ledger
create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id),
  delta int not null,
  reason text not null check (reason in ('restock', 'delivery', 'adjust')),
  delivery_id uuid references public.deliveries (id),
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index stock_movements_product on public.stock_movements (product_id);

-- 3. Links (opt-in; history stays free-text)
alter table public.contracts
  add column if not exists product_id uuid references public.products (id);
alter table public.deliveries
  add column if not exists product_id uuid references public.products (id);

-- ──────────────────────────────────────────────────────────────
-- 4. Recreate enqueue_delivery so it copies the contract's product_id
-- ──────────────────────────────────────────────────────────────
create or replace function public.enqueue_delivery()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.deliveries (delivery_no, contract_id, status, product_id)
  values ('DEL' || lpad(public.next_counter('delivery')::text, 5, '0'), new.id, 'pending', new.product_id);
  return new;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. Recreate create_contract with a trailing p_product_id
-- ──────────────────────────────────────────────────────────────
drop function if exists public.create_contract(uuid, date, text, text, int, numeric, int, text, text, uuid);

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
  p_agent_id uuid default null,
  p_product_id uuid default null
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
    monthly_amortization, sales_agent, agent_id, product_id, created_by
  ) values (
    v_year || lpad(v_n::text, 3, '0'),
    p_customer_id, p_contract_date, p_item_description, p_item_type,
    p_quantity, p_cash_price, p_term_months,
    v_terms.total_price, v_terms.downpayment, v_terms.monthly_amortization,
    p_sales_agent, p_agent_id, p_product_id, auth.uid()
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
-- 6. Product / stock RPCs
-- ──────────────────────────────────────────────────────────────
create or replace function public.create_product(
  p_name text,
  p_category text default null,
  p_default_cost numeric default null
)
returns public.products
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.products;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can add products';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Product name is required';
  end if;

  insert into public.products (sku, name, category, default_cost)
  values (
    'PRD' || lpad(public.next_counter('product')::text, 4, '0'),
    trim(p_name),
    nullif(trim(coalesce(p_category, '')), ''),
    p_default_cost
  )
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.update_product(
  p_id uuid,
  p_name text,
  p_category text,
  p_active boolean
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;

  update public.products
  set name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
      category = nullif(trim(coalesce(p_category, '')), ''),
      active = coalesce(p_active, active)
  where id = p_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;

create or replace function public.restock_product(
  p_id uuid,
  p_qty int,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;
  if coalesce(p_qty, 0) <= 0 then
    raise exception 'Restock quantity must be greater than zero';
  end if;

  update public.products set on_hand = on_hand + p_qty where id = p_id;
  if not found then
    raise exception 'Product not found';
  end if;

  insert into public.stock_movements (product_id, delta, reason, note, created_by)
  values (p_id, p_qty, 'restock', nullif(trim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;

create or replace function public.adjust_stock(
  p_id uuid,
  p_delta int,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_on_hand int;
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;

  select on_hand into v_on_hand from public.products where id = p_id;
  if not found then
    raise exception 'Product not found';
  end if;
  if v_on_hand + p_delta < 0 then
    raise exception 'Adjustment would make on-hand negative';
  end if;

  update public.products set on_hand = on_hand + p_delta where id = p_id;

  insert into public.stock_movements (product_id, delta, reason, note, created_by)
  values (p_id, p_delta, 'adjust', nullif(trim(coalesce(p_note, '')), ''), auth.uid());
end;
$$;

create or replace function public.set_delivery_product(
  p_delivery_id uuid,
  p_product_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not (public.is_delivery() or public.can_post_payments()) then
    raise exception 'Not authorized';
  end if;

  update public.deliveries
  set product_id = p_product_id
  where id = p_delivery_id and status <> 'delivered';

  if not found then
    raise exception 'Delivery not found or already delivered';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 7. Recreate mark_delivered to decrement stock when fulfilled from office
-- ──────────────────────────────────────────────────────────────
create or replace function public.mark_delivered(
  p_delivery_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_product uuid;
  v_qty int;
begin
  if not (public.is_delivery() or public.can_post_payments()) then
    raise exception 'Not authorized';
  end if;

  select d.status, d.product_id, c.quantity
    into v_status, v_product, v_qty
  from public.deliveries d
  join public.contracts c on c.id = d.contract_id
  where d.id = p_delivery_id;

  if not found then
    raise exception 'Delivery not found';
  end if;
  if v_status = 'delivered' then
    raise exception 'Already delivered';
  end if;

  -- Only stock fulfilled from the office (in_stock + a linked product) moves.
  if v_status = 'in_stock' and v_product is not null then
    update public.products set on_hand = on_hand - v_qty where id = v_product;
    insert into public.stock_movements (product_id, delta, reason, delivery_id, created_by)
    values (v_product, -v_qty, 'delivery', p_delivery_id, auth.uid());
  end if;

  update public.deliveries
  set status = 'delivered',
      delivered_at = public.ph_today(),
      delivered_by = auth.uid(),
      delivery_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_delivery_id;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 8. RLS
-- ──────────────────────────────────────────────────────────────
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

-- products: catalog readable to all active users; writes via RPC only
create policy products_select on public.products
  for select using (public.is_active_user());

-- stock ledger: owner/admin audit; writes via RPC only
create policy stock_movements_select on public.stock_movements
  for select using (public.can_post_payments());
