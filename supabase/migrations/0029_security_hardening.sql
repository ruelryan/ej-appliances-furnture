-- E & J — Security hardening
--
-- Closes access-control gaps found in a full audit of 0001–0028. Nothing here
-- changes business math: no view, no money column, no amortization rule is
-- touched. Every change either narrows who may write a row or takes an
-- internal function off the public API surface.
--
-- The financial-integrity findings from the same audit (overpayment caps,
-- the post_collection_entry double-post race, close_contract, repricing
-- re-validation) are deliberately NOT here — they change business behaviour
-- and need decisions first. They are scheduled for a separate migration.

-- ──────────────────────────────────────────────────────────────
-- 1. customers: writes become owner/admin-only
-- ──────────────────────────────────────────────────────────────
-- 0001 shipped customers_insert/customers_update as bare is_active_user() and
-- no later migration narrowed them — 0013 tightened only customers_select. The
-- effect was that every RPC written to control customer edits could be walked
-- straight around with a direct PostgREST PATCH:
--
--   set_customer_links   (0020) — owner/admin only, and its comment says
--                                 "collectors must not be able to repoint the
--                                 chat they are chased on". They could.
--   set_customer_address (0023) — owner/admin only + ph_locations validation.
--   tag_customer_gps     (0023) — collector allowed, but only on their own
--                                 worklist.
--   set_customer_landmark(0023) — same worklist scoping.
--
-- Worse, UPDATE policies are evaluated independently of SELECT policies, so a
-- sales_agent could write rows 0013 explicitly forbids them to read.
--
-- Those four RPCs are all SECURITY DEFINER, so they run as the table owner and
-- bypass RLS entirely — narrowing the table policy does not disturb them. The
-- collector keeps exactly the access the RPCs grant, and loses the back door.
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers
  for insert with check (public.can_post_payments());

-- WITH CHECK as well as USING: without it, a permitted caller could still move
-- a row into a state the policy would not have allowed them to create.
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers
  for update using (public.can_post_payments())
  with check (public.can_post_payments());

-- ──────────────────────────────────────────────────────────────
-- 2. Take internal SECURITY DEFINER helpers off the PostgREST surface
-- ──────────────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on every new function, and until now this
-- schema revoked exactly one (check_dtr_geofence, 0010). Both functions below
-- are called only from inside other SECURITY DEFINER functions, which run as
-- the function owner and therefore always retain execute — revoking client
-- access cannot break them. (The import scripts also call next_counter, but
-- they connect directly as the database owner, not through PostgREST.)

-- payslip_recompute re-derives dtr_pay, basic_pay, meal_allowance and net_pay
-- from LIVE rates. It has no role check and no draft check, while every RPC
-- that wraps it (create_payslip, refresh_payslip, finalize_payslip) is
-- owner-gated and draft-gated. An employee may legitimately read their own
-- finalised payslip's id (payslips_select, 0009), so leaving this callable let
-- them recompute a snapshot that is supposed to be immutable — and, because
-- v_thirteenth_month sums basic_pay from final slips only, inflate the
-- 13th-month base with it. It is never called from application code.
revoke execute on function public.payslip_recompute(uuid)
  from public, anon, authenticated;

-- next_counter mutates id_counters, which has RLS on and deliberately no
-- policies. Leaving the definer function callable meant any client could burn
-- the PAY#### series in a loop, producing gaps in the official receipt
-- sequence that read as deleted payments.
revoke execute on function public.next_counter(text, int)
  from public, anon, authenticated;

-- ──────────────────────────────────────────────────────────────
-- 3. Product lookups: honour the RLS they were bypassing
-- ──────────────────────────────────────────────────────────────
-- These two are genuinely called from the app by signed-in users, so they
-- cannot simply be revoked. Both are SECURITY DEFINER with no auth check,
-- which bypassed the is_active_user() policy on products (0015) and returned
-- price, on_hand and storage_path to any caller holding the public anon key.
-- Adding the guard to the WHERE clause keeps them as plain SQL functions and
-- returns no rows rather than raising — the typeahead simply finds nothing.
--
-- Argument lists are unchanged, so `create or replace` is safe here; changing
-- them would create an overload and make rpc() resolution ambiguous.

create or replace function public.search_products(p_query text)
returns table (
  id uuid,
  sku text,
  name text,
  category text,
  price numeric,
  on_hand int,
  review_status text,
  storage_path text,
  score real
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.sku, p.name, p.category, p.price, p.on_hand, p.review_status,
    (select ph.storage_path from public.product_photos ph
      where ph.product_id = p.id order by ph.sort_order, ph.created_at limit 1),
    greatest(
      word_similarity(p_query, p.name),
      -- a literal substring is a strong signal trigrams can undervalue
      case when p.name ilike '%' || p_query || '%' then 0.7 else 0 end,
      case when coalesce(p.category, '') ilike '%' || p_query || '%' then 0.25 else 0 end
    )::real as score
  from public.products p
  where public.is_active_user()
    and p.active
    and (
      word_similarity(p_query, p.name) >= 0.45
      or p.name ilike '%' || p_query || '%'
      or coalesce(p.category, '') ilike '%' || p_query || '%'
    )
  order by score desc, p.name
  limit 12;
$$;

create or replace function public.find_duplicate_candidates(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  name text,
  category text,
  price numeric,
  on_hand int,
  storage_path text,
  dhash bit(64),
  name_score real
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.sku, p.name, p.category, p.price, p.on_hand,
    (select ph.storage_path from public.product_photos ph
      where ph.product_id = p.id order by ph.sort_order, ph.created_at limit 1),
    (select ph.dhash from public.product_photos ph
      where ph.product_id = p.id and ph.dhash is not null
      order by ph.sort_order, ph.created_at limit 1),
    similarity(p.name, (select name from public.products where id = p_product_id))::real
  from public.products p
  where public.is_active_user()
    and p.id <> p_product_id
    and p.active
    and p.review_status = 'approved'
  order by similarity(p.name, (select name from public.products where id = p_product_id)) desc
  limit 8;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. New accounts are inert until the owner activates them
-- ──────────────────────────────────────────────────────────────
-- 0001 declared `role text not null default 'staff'` and 0011 migrated the
-- existing rows without ever changing the column default. handle_new_user
-- fires on every auth.users insert, so any account created outside /admin
-- landed as an ACTIVE profile — and because 'staff' is not a sales_agent,
-- customers_select handed it the entire customer book.
--
-- Whether that was reachable from the internet depended on the Supabase
-- dashboard's email-signup setting, which is not in version control. Rather
-- than depend on a dashboard toggle staying off, the trigger now creates
-- profiles INACTIVE: is_active_user() is false, so an unexpected signup can
-- read nothing at all. The owner activates deliberately in /admin.
--
-- createUser in src/app/(app)/admin/actions.ts is updated in the same commit
-- to set active = true explicitly, since it previously relied on this default.
alter table public.profiles alter column role set default 'collector';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, active)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'collector',  -- least privilege; the owner sets the real role in /admin
    false         -- inert until activated
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. Smaller read/write scoping gaps
-- ──────────────────────────────────────────────────────────────

-- contract_repricings held commercial terms (old/new price, term, monthly) for
-- every contract behind a blanket is_active_user(), re-exposing precisely what
-- 0011 and 0013 went to the trouble of scoping on contracts and payments.
-- Mirrors contracts_select, minus delivery — fulfilment never needs price
-- history.
drop policy if exists repricings_select on public.contract_repricings;
create policy repricings_select on public.contract_repricings
  for select using (
    public.is_active_user() and (
      public.can_post_payments()
      or exists (
        select 1 from public.contracts c
        where c.id = contract_repricings.contract_id and (
          (public.is_collector()   and c.collector_id = auth.uid())
          or (public.is_sales_agent() and c.agent_id  = auth.uid())
        )
      )
    )
  );

-- A note could be attached to any contract id, including contracts the caller
-- is not allowed to read — a sales_agent blocked from reading notes by 0013
-- could still write into any thread. The contracts subquery is itself
-- RLS-filtered, so this resolves to "contracts you can see".
drop policy if exists notes_insert on public.contract_notes;
create policy notes_insert on public.contract_notes
  for insert with check (
    public.is_active_user()
    and created_by = auth.uid()
    and exists (
      select 1 from public.contracts c where c.id = contract_notes.contract_id
    )
  );

-- Every other policy in the schema requires an ACTIVE profile; this one did
-- not, so a just-deactivated user with a still-valid JWT kept reading.
drop policy if exists thirteenth_select_owner on public.thirteenth_month_payments;
create policy thirteenth_select_owner on public.thirteenth_month_payments
  for select using (
    public.is_active_user()
    and (public.is_owner() or profile_id = auth.uid())
  );
