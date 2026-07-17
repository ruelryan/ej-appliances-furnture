-- E & J — Deliveries & suppliers (Phase 3a)
-- One delivery record per contract, auto-enqueued on every new sale. Full
-- supplier tracking (cost + invoice lag). Replaces the free-text
-- contracts.delivery_status (left in place but no longer the source of truth).

-- ──────────────────────────────────────────────────────────────
-- 1. Suppliers (reference table; owner/admin manage directly via RLS)
-- ──────────────────────────────────────────────────────────────
create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  address text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ──────────────────────────────────────────────────────────────
-- 2. Deliveries — one per contract
-- ──────────────────────────────────────────────────────────────
create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_no text unique not null,                 -- 'DEL#####'
  contract_id uuid not null unique references public.contracts (id) on delete cascade,
  status text not null default 'pending' check (status in (
    'pending', 'in_stock', 'to_order', 'ordered', 'delivered', 'cancelled'
  )),
  supplier_id uuid references public.suppliers (id),
  supplier_cost numeric(12,2),
  ordered_at date,
  paid_at date,
  invoice_received_at date,
  invoice_ref text,
  delivered_at date,
  delivered_by uuid references public.profiles (id),
  delivery_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index deliveries_status on public.deliveries (status);
create index deliveries_supplier on public.deliveries (supplier_id);

create trigger touch_deliveries before update on public.deliveries
  for each row execute function public.touch_updated_at();

-- Keep the legacy contracts.delivery_status text in sync with the delivery
-- record so existing displays and the CSV export keep working. The record is
-- the source of truth; this column is now derived, never edited by hand.
create or replace function public.sync_contract_delivery_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update public.contracts
  set delivery_status = case new.status
    when 'pending' then 'Pending'
    when 'in_stock' then 'Out for Delivery'
    when 'to_order' then 'To order'
    when 'ordered' then 'Ordered from supplier'
    when 'delivered' then 'Delivered'
    when 'cancelled' then 'Cancelled'
    else new.status
  end
  where id = new.contract_id;
  return new;
end;
$$;

create trigger deliveries_sync_status
  after insert or update of status on public.deliveries
  for each row execute function public.sync_contract_delivery_status();

-- ──────────────────────────────────────────────────────────────
-- 3. Backfill: every existing contract gets a delivered record.
--    Generate sequential DEL numbers, then point the counter past them.
-- ──────────────────────────────────────────────────────────────
insert into public.deliveries (delivery_no, contract_id, status, delivered_at)
select
  'DEL' || lpad((row_number() over (order by contract_date, contract_no))::text, 5, '0'),
  id, 'delivered', contract_date
from public.contracts;

insert into public.id_counters (scope, last_value)
values ('delivery', (select count(*) from public.deliveries))
on conflict (scope) do update set last_value = excluded.last_value;

-- ──────────────────────────────────────────────────────────────
-- 4. Auto-enqueue a pending delivery on every new contract
--    (runs after backfill so it only affects future inserts).
-- ──────────────────────────────────────────────────────────────
create or replace function public.enqueue_delivery()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.deliveries (delivery_no, contract_id, status)
  values ('DEL' || lpad(public.next_counter('delivery')::text, 5, '0'), new.id, 'pending');
  return new;
end;
$$;

create trigger contracts_enqueue_delivery after insert on public.contracts
  for each row execute function public.enqueue_delivery();

-- ──────────────────────────────────────────────────────────────
-- 5. Write RPCs (SECURITY DEFINER, role-guarded)
-- ──────────────────────────────────────────────────────────────

-- Delivery team (or office) records whether the item is in the office.
create or replace function public.set_delivery_availability(
  p_delivery_id uuid,
  p_in_stock boolean
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
  set status = case when p_in_stock then 'in_stock' else 'to_order' end
  where id = p_delivery_id and status in ('pending', 'in_stock', 'to_order');

  if not found then
    raise exception 'Delivery not found or already ordered/delivered';
  end if;
end;
$$;

-- Office records a supplier purchase (cost is office-only).
create or replace function public.record_supplier_order(
  p_delivery_id uuid,
  p_supplier_id uuid,
  p_cost numeric,
  p_ordered_at date default null,
  p_paid_at date default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can record supplier orders';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers where id = p_supplier_id
  ) then
    raise exception 'Supplier not found';
  end if;

  update public.deliveries
  set supplier_id = p_supplier_id,
      supplier_cost = p_cost,
      ordered_at = coalesce(p_ordered_at, public.ph_today()),
      paid_at = p_paid_at,
      status = 'ordered'
  where id = p_delivery_id and status <> 'delivered';

  if not found then
    raise exception 'Delivery not found or already delivered';
  end if;
end;
$$;

-- Office records the supplier's invoice once it arrives.
create or replace function public.record_supplier_invoice(
  p_delivery_id uuid,
  p_invoice_ref text,
  p_received_at date default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can record invoices';
  end if;

  update public.deliveries
  set invoice_ref = nullif(trim(coalesce(p_invoice_ref, '')), ''),
      invoice_received_at = coalesce(p_received_at, public.ph_today())
  where id = p_delivery_id;

  if not found then
    raise exception 'Delivery not found';
  end if;
end;
$$;

-- Delivery team (or office) marks the item delivered to the customer.
create or replace function public.mark_delivered(
  p_delivery_id uuid,
  p_note text default null
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
  set status = 'delivered',
      delivered_at = public.ph_today(),
      delivered_by = auth.uid(),
      delivery_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_delivery_id and status <> 'delivered';

  if not found then
    raise exception 'Delivery not found or already delivered';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. View for the queue UI
-- ──────────────────────────────────────────────────────────────
create or replace view public.v_deliveries
with (security_invoker = true)
as
select
  d.*,
  c.contract_no,
  c.item_description,
  c.item_type,
  c.quantity,
  c.contract_date,
  c.cash_price,
  cu.display_name as customer_name,
  cu.address as customer_address,
  cu.phones,
  cu.gps_url,
  s.name as supplier_name,
  case
    when d.status = 'ordered' and d.invoice_received_at is null and d.ordered_at is not null
    then (public.ph_today() - d.ordered_at)
    else null
  end as days_awaiting_invoice
from public.deliveries d
join public.contracts c on c.id = d.contract_id
join public.customers cu on cu.id = c.customer_id
left join public.suppliers s on s.id = d.supplier_id;

-- ──────────────────────────────────────────────────────────────
-- 7. RLS
-- ──────────────────────────────────────────────────────────────
alter table public.deliveries enable row level security;
alter table public.suppliers enable row level security;

-- deliveries: owner/admin/delivery all; collector/agent only their contracts'
create policy deliveries_select on public.deliveries
  for select using (
    public.is_active_user() and (
      public.can_post_payments()
      or public.is_delivery()
      or exists (
        select 1 from public.contracts c
        where c.id = deliveries.contract_id and (
          (public.is_collector() and c.collector_id = auth.uid())
          or (public.is_sales_agent() and c.agent_id = auth.uid())
        )
      )
    )
  );

-- suppliers: everyone reads; owner/admin manage
create policy suppliers_select on public.suppliers
  for select using (public.is_active_user());
create policy suppliers_insert on public.suppliers
  for insert with check (public.can_post_payments());
create policy suppliers_update on public.suppliers
  for update using (public.can_post_payments());
create policy suppliers_delete on public.suppliers
  for delete using (public.is_owner());
