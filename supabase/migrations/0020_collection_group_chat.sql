-- E & J — Collection group chat link (second Messenger link per customer)
--
-- Two different Messenger links exist per customer and until now they shared
-- one column:
--   * messenger_url      — the customer's own Facebook/Messenger profile,
--                          captured when the contract is made. Sheet tab
--                          "Contracts Database", column "FB link".
--   * collection_gc_url  — a group chat (owner + admin + collector + customer)
--                          created by the ADMIN after the contract exists, used
--                          to communicate collection updates. Sheet tab
--                          "Collection", column "Messenger Collection GC".
--
-- The importer used to write the group chat link into messenger_url only when
-- the personal link was empty, so one of the two was always lost. Splitting the
-- column fixes that; scripts/migrate/import.ts fills both on the next reload.

alter table public.customers add column if not exists collection_gc_url text;

-- ──────────────────────────────────────────────────────────────
-- v_contract_financials — expose the new column
-- ──────────────────────────────────────────────────────────────
-- The view enumerates customer columns explicitly, so a new one is invisible
-- until the view is re-declared. It is appended LAST on purpose: `create or
-- replace view` may add trailing columns but may not reorder existing ones, and
-- dropping this view would cascade into v_contract_collections, v_delivery_board
-- (0014) and v_contract_dp (0013).
--
-- CRITICAL: the contracts columns are listed out by hand rather than `c.*`.
-- 0002 wrote `select c.*`, which Postgres froze to the 19 columns that existed
-- in 0001. contracts has since grown to 24 (collector_id, agent_id,
-- collection_priority, product_id, sale_type). Re-declaring with `c.*` would
-- splice those five into the middle of the view and shift display_name out of
-- position — `create or replace` then fails with "cannot change name of view
-- column display_name to collector_id". Enumerating freezes it honestly and
-- keeps this view's shape byte-identical to what the app already reads.
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
  -- expected = downpayment + monthly × min(months elapsed, term)
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
  -- fractional months since last payment (Apps Script used days / 30.44)
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
  cu.collection_gc_url
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join pay p on p.contract_id = c.id;

-- ──────────────────────────────────────────────────────────────
-- v_contract_collections — must be DROPPED, not replaced
-- ──────────────────────────────────────────────────────────────
-- It selects `f.*`, which Postgres expanded to a fixed column list when the
-- view was created — it will not inherit collection_gc_url on its own. The new
-- column lands mid-list rather than at the end, so `create or replace` would
-- fail on the reorder. Nothing else in SQL depends on this view (only two
-- reads in src/app/(app)/collections/page.tsx), so dropping is safe.
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

-- ──────────────────────────────────────────────────────────────
-- set_customer_links — the missing customer write path
-- ──────────────────────────────────────────────────────────────
-- customers has no update RPC and no edit screen anywhere; messenger_url could
-- only ever be set once, at customer creation. The admin needs to paste the
-- group chat link AFTER the contract exists, so this is owner/admin only —
-- collectors must not be able to repoint the chat they are chased on.
-- Pass null to leave a link unchanged; pass '' to clear it.
create or replace function public.set_customer_links(
  p_customer_id uuid,
  p_messenger_url text default null,
  p_collection_gc_url text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can edit customer links';
  end if;

  update public.customers
  set messenger_url = case
        when p_messenger_url is null then messenger_url
        else nullif(trim(p_messenger_url), '')
      end,
      collection_gc_url = case
        when p_collection_gc_url is null then collection_gc_url
        else nullif(trim(p_collection_gc_url), '')
      end,
      updated_at = now()
  where id = p_customer_id;

  if not found then
    raise exception 'Customer not found';
  end if;
end;
$$;
