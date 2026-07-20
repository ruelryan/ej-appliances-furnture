-- E & J — Structured addresses, collector GPS tagging
--
-- Addresses were one free-text field, captured only at customer creation, with
-- no edit path anywhere. That makes it impossible to group a collector's day by
-- area, and "Purok 2, Bogo" tells a new collector nothing about where the house
-- actually is.
--
-- Addresses are now province / municipality / barangay (validated against the
-- reference table) plus free-text street-or-purok and a landmark. The original
-- free text is KEPT in customers.address — it is the audit trail for the
-- backfill and the fallback for anything that could not be parsed.
--
-- gps_url also stays. It holds opaque Google Maps links of unknown form that
-- arrived from the Sheet under four different column aliases; they cannot be
-- parsed into coordinates reliably, so real lat/lng lives alongside rather than
-- replacing it.

-- ──────────────────────────────────────────────────────────────
-- Reference data: the delivery coverage area
-- ──────────────────────────────────────────────────────────────
-- Seeded from the Sheet's "Delivery Locations" tab by
-- scripts/import-locations.ts — 2,003 barangays across 61 municipalities in
-- Southern Leyte and Leyte.
create table if not exists public.ph_locations (
  id uuid primary key default gen_random_uuid(),
  province text not null,
  municipality text not null,
  barangay text not null,
  unique (province, municipality, barangay)
);

create index if not exists ph_locations_muni
  on public.ph_locations (province, municipality);

alter table public.ph_locations enable row level security;

create policy ph_locations_select on public.ph_locations
  for select using (public.is_active_user());
create policy ph_locations_write on public.ph_locations
  for all using (public.is_owner()) with check (public.is_owner());

-- ──────────────────────────────────────────────────────────────
-- Customer address + coordinates
-- ──────────────────────────────────────────────────────────────
alter table public.customers
  add column if not exists province text,
  add column if not exists municipality text,
  add column if not exists barangay text,
  add column if not exists street_purok text,
  add column if not exists landmark text,
  -- double precision + range checks, matching the 0010 geofence conventions
  add column if not exists lat double precision check (lat between -90 and 90),
  add column if not exists lng double precision check (lng between -180 and 180),
  add column if not exists gps_accuracy_m double precision,
  add column if not exists gps_tagged_by uuid references public.profiles (id),
  add column if not exists gps_tagged_at timestamptz;

comment on column public.customers.address is
  'The address as originally given, free text. Kept as the audit trail for the '
  'structured fields and the fallback when parsing failed.';
comment on column public.customers.landmark is
  'How to actually find the house — "beside the blue water station". Usually '
  'filled in by the collector who just found it.';

-- Grouping the collector worklist by area.
create index if not exists customers_area
  on public.customers (province, municipality, barangay);

-- ──────────────────────────────────────────────────────────────
-- set_customer_address — owner/admin
-- ──────────────────────────────────────────────────────────────
-- Validates the triple against ph_locations so a typo cannot invent a barangay
-- and quietly split one area into two on the worklist.
create or replace function public.set_customer_address(
  p_customer_id uuid,
  p_province text,
  p_municipality text,
  p_barangay text,
  p_street_purok text default null,
  p_landmark text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can edit a customer address';
  end if;

  if coalesce(trim(p_province), '') = '' or coalesce(trim(p_municipality), '') = ''
     or coalesce(trim(p_barangay), '') = '' then
    raise exception 'Province, municipality and barangay are all required';
  end if;

  if not exists (
    select 1 from public.ph_locations
    where province = trim(p_province)
      and municipality = trim(p_municipality)
      and barangay = trim(p_barangay)
  ) then
    raise exception '% is not a barangay of %, %',
      trim(p_barangay), trim(p_municipality), trim(p_province);
  end if;

  update public.customers
  set province = trim(p_province),
      municipality = trim(p_municipality),
      barangay = trim(p_barangay),
      street_purok = nullif(trim(coalesce(p_street_purok, '')), ''),
      landmark = nullif(trim(coalesce(p_landmark, '')), ''),
      updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- tag_customer_gps — COLLECTOR, owner or admin
-- ──────────────────────────────────────────────────────────────
-- Deliberately wider than set_customer_links (owner/admin). The only person
-- ever standing at the customer's door is the collector; gating this to the
-- office would put it out of reach of the one person who can do it. A collector
-- may tag only a customer they have a contract assigned for, mirroring
-- log_collection's assignment guard.
--
-- Coordinates are client-supplied and therefore spoofable — this is a
-- convenience and an audit trail, not proof of presence. Hence tagged_by/at.
create or replace function public.tag_customer_gps(
  p_customer_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_lat is null or p_lng is null then
    raise exception 'No location reading — allow location access and try again';
  end if;
  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location reading — please try again';
  end if;

  if not (public.can_post_payments() or public.is_collector()) then
    raise exception 'Not authorized to tag a location';
  end if;

  if public.is_collector() and not public.can_post_payments() then
    if not exists (
      select 1 from public.contracts c
      where c.customer_id = p_customer_id and c.collector_id = auth.uid()
    ) then
      raise exception 'This customer is not on your worklist';
    end if;
  end if;

  update public.customers
  set lat = p_lat,
      lng = p_lng,
      gps_accuracy_m = least(greatest(coalesce(p_accuracy_m, 0), 0), 1000),
      gps_tagged_by = auth.uid(),
      gps_tagged_at = now(),
      updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- set_customer_landmark — same reasoning as GPS
-- ──────────────────────────────────────────────────────────────
create or replace function public.set_customer_landmark(
  p_customer_id uuid,
  p_landmark text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not (public.can_post_payments() or public.is_collector()) then
    raise exception 'Not authorized';
  end if;

  if public.is_collector() and not public.can_post_payments() then
    if not exists (
      select 1 from public.contracts c
      where c.customer_id = p_customer_id and c.collector_id = auth.uid()
    ) then
      raise exception 'This customer is not on your worklist';
    end if;
  end if;

  update public.customers
  set landmark = nullif(trim(coalesce(p_landmark, '')), ''),
      updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- Views — same trap as 0020
-- ──────────────────────────────────────────────────────────────
-- v_contract_financials enumerates its columns, so new ones are invisible until
-- it is re-declared. They are appended LAST so `create or replace` succeeds;
-- the contracts columns are still listed by hand rather than `c.*`, because
-- that star was frozen to the 19 columns of 0001 and re-expanding it would
-- splice in five newer columns and shift everything after it.
create or replace view public.v_contract_financials
with (security_invoker = true)
as
with pay as (
  select
    contract_id,
    coalesce(sum(amount), 0) as total_paid,
    max(payment_date) as last_payment_date,
    count(*) as payment_count
  from public.payments
  where voided_at is null
  group by contract_id
)
select
  c.id,
  c.contract_no,
  c.customer_id,
  c.contract_date,
  c.item_description,
  c.item_type,
  c.quantity,
  c.cash_price,
  c.term_months,
  c.total_price,
  c.downpayment,
  c.monthly_amortization,
  c.sales_agent,
  c.delivery_status,
  c.payment_status,
  c.collection_status,
  c.created_by,
  c.created_at,
  c.updated_at,
  cu.display_name,
  cu.first_name,
  cu.last_name,
  cu.phones,
  cu.messenger_url,
  cu.gps_url,
  cu.address,
  public.months_elapsed_ph(c.contract_date) as months_elapsed,
  coalesce(p.total_paid, 0) as total_paid,
  p.last_payment_date,
  coalesce(p.payment_count, 0) as payment_count,
  round(
    c.downpayment
    + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months),
    2
  ) as expected_to_date,
  greatest(
    round(
      c.downpayment
      + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months)
      - coalesce(p.total_paid, 0),
      2
    ),
    0
  ) as overdue_amount,
  round(c.total_price - coalesce(p.total_paid, 0), 2) as remaining_balance,
  case
    when p.last_payment_date is null then null
    else round((public.ph_today() - p.last_payment_date) / 30.44, 2)
  end as months_since_last_payment,
  case
    when c.payment_status = 'closed' then 'closed'
    when round(c.total_price - coalesce(p.total_paid, 0), 2) <= 0 then 'on_track'
    when c.downpayment
         + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months)
         - coalesce(p.total_paid, 0) <= 0.009 then 'on_track'
    when p.last_payment_date is not null
         and (public.ph_today() - p.last_payment_date) / 30.44 >= 3 then 'demand'
    else 'overdue'
  end as followup_tier,
  cu.collection_gc_url,
  cu.province,
  cu.municipality,
  cu.barangay,
  cu.street_purok,
  cu.landmark,
  cu.lat,
  cu.lng
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join pay p on p.contract_id = c.id;

-- Must be dropped: it is `select f.*`, the star was expanded at creation, and
-- the new columns land mid-list so a replace would fail on the reorder.
drop view if exists public.v_contract_collections;

create view public.v_contract_collections
with (security_invoker = true)
as
select
  f.*,
  c.collector_id,
  c.agent_id,
  c.collection_priority,
  p.full_name as collector_name
from public.v_contract_financials f
join public.contracts c on c.id = f.id
left join public.profiles p on p.id = c.collector_id;
