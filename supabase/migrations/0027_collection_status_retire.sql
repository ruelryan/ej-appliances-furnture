-- E & J — Retire the hand-typed collection_status; derive it, split out repossession
--
-- contracts.collection_status was a hand-typed text label that NOTHING read as
-- logic, that the collector could not even see, and that was blank on 1,443 of
-- 1,511 contracts. Its vocabulary overlapped what the app already computes:
--   "Paid" / "Collect in-person"  -> already payment_status / followup_tier
--   "Asked for extension"          -> already a `promised` entry with a date
--   the "Pull-out" stages          -> a real repossession pipeline, kept below
--
-- delivery_status (0014) is the precedent: a hand-typed status made derived.
-- Here the derived value is a read-only `collection_situation` expression on
-- v_contract_financials, and the one genuinely-manual part — repossession — is
-- rescued into an explicit owner-only stage.

-- ── 1. The repossession stage (the only manual status left) ─────────────────
alter table public.contracts
  add column if not exists repossession_stage text not null default 'none'
    check (repossession_stage in
      ('none', 'letter_prepared', 'letter_sent', 'for_pullout', 'repossessed'));

comment on column public.contracts.repossession_stage is
  'Owner-only escalation after collection fails. Set via set_repossession_stage. '
  'Repossession is an owner decision under the Recto Law, and taking the item '
  'back cancels the sale — so this is deliberately not auto-advanced by printing '
  'the demand letter.';

-- Migrate the only non-redundant collection_status values across, before the
-- column is dropped. Everything else becomes 'none' — it is now auto-derived.
update public.contracts
set repossession_stage = case collection_status
  when 'Pull-out letter prepared' then 'letter_prepared'
  when 'Pull-out letter sent'     then 'letter_sent'
  when 'Item for pull-out'        then 'for_pullout'
  else 'none'
end
where collection_status is not null;

-- ── 2. Drop the whole dependent chain, then the column ──────────────────────
-- create-or-replace cannot remove a column from a view's output, so
-- v_contract_financials must be dropped. FOUR views depend on it —
-- v_contract_collections plus three analytics views (v_aging, v_dashboard_stats,
-- v_top_customers) — so all four are dropped first and recreated below. The
-- three analytics views never referenced collection_status; they are restored
-- byte-for-byte from their live definitions.
drop view if exists public.v_contract_collections;
drop view if exists public.v_aging;
drop view if exists public.v_dashboard_stats;
drop view if exists public.v_top_customers;
drop view if exists public.v_contract_financials;

alter table public.contracts drop column if exists collection_status;

drop function if exists public.update_contract_status(uuid, text, text);

-- ── 3. Recreate v_contract_financials — collection_status gone, situation added
create view public.v_contract_financials
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
  cu.lng,
  c.repossession_stage,
  -- Derived collection situation. Replaces the hand-typed collection_status:
  -- computed from the same money/date inputs as followup_tier plus the latest
  -- non-cancelled visit, so it is never stale. Repossession dominates when set.
  case
    when c.repossession_stage = 'letter_prepared' then 'Repossession — demand letter prepared'
    when c.repossession_stage = 'letter_sent'     then 'Repossession — demand letter served'
    when c.repossession_stage = 'for_pullout'     then 'Repossession — item for pull-out'
    when c.repossession_stage = 'repossessed'     then 'Repossessed'
    when c.payment_status = 'closed' then 'Fully paid'
    when round(c.total_price - coalesce(p.total_paid, 0), 2) <= 0 then 'Fully paid'
    when c.downpayment
         + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months)
         - coalesce(p.total_paid, 0) <= 0.009 then 'On track'
    when le.disposition = 'promised' and le.promised_date is not null
         and le.promised_date >= public.ph_today()
      then 'Promised to pay ' || to_char(le.promised_date, 'Mon DD')
    when le.disposition = 'promised' and le.promised_date is not null
      then 'Promised ' || to_char(le.promised_date, 'Mon DD') || ' — now overdue'
    when le.disposition = 'not_available'
      then 'Not reached (last tried ' || to_char(le.work_date, 'Mon DD') || ')'
    when le.disposition = 'refused'
      then 'Refused (' || to_char(le.work_date, 'Mon DD') || ')'
    when le.disposition = 'collected'
      then 'Part-paid, still behind (last ' || to_char(le.work_date, 'Mon DD') || ')'
    else 'Overdue — no visit logged'
  end as collection_situation
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join pay p on p.contract_id = c.id
-- the latest visit that still counts (cancelled entries excluded)
left join lateral (
  select e.disposition, e.work_date, e.promised_date
  from public.collection_entries e
  where e.contract_id = c.id and e.status <> 'cancelled'
  order by e.work_date desc, e.created_at desc
  limit 1
) le on true;

-- ── 4. Recreate the dependents ──────────────────────────────────────────────
-- v_contract_collections (unchanged shape, inherits the new columns via f.*).
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

-- The three analytics views, restored verbatim from their live definitions.
-- None referenced collection_status.
create view public.v_aging
with (security_invoker = true)
as
select
  case
    when overdue_amount <= 0 then 'current'
    when overdue_amount <= monthly_amortization then '1 month'
    when overdue_amount <= monthly_amortization * 2 then '2 months'
    else '3+ months'
  end as bucket,
  count(*) as contract_count,
  sum(overdue_amount) as overdue_total,
  sum(remaining_balance) as balance_total
from public.v_contract_financials
where payment_status = 'open'
group by 1;

create view public.v_dashboard_stats
with (security_invoker = true)
as
select
  (select count(*) from public.contracts where payment_status = 'open') as open_contracts,
  (select coalesce(sum(remaining_balance), 0) from public.v_contract_financials
     where payment_status = 'open') as outstanding_balance,
  (select coalesce(sum(overdue_amount), 0) from public.v_contract_financials
     where payment_status = 'open') as total_overdue,
  (select count(*) from public.v_contract_financials
     where payment_status = 'open' and followup_tier = 'demand') as demand_tier_count,
  (select count(*) from public.v_contract_financials
     where payment_status = 'open' and followup_tier = 'overdue') as overdue_tier_count,
  (select coalesce(sum(amount), 0) from public.payments
     where voided_at is null
       and date_trunc('month', payment_date) = date_trunc('month', public.ph_today()))
     as collected_this_month;

create view public.v_top_customers
with (security_invoker = true)
as
select
  cu.id as customer_id,
  cu.display_name,
  count(c.id) as contract_count,
  sum(c.total_price) as lifetime_value,
  sum(case when c.payment_status = 'open' then f.remaining_balance else 0 end) as current_balance
from public.customers cu
join public.contracts c on c.customer_id = cu.id
join public.v_contract_financials f on f.id = c.id
group by cu.id, cu.display_name
order by sum(c.total_price) desc;

-- ── 5. set_repossession_stage — owner only ──────────────────────────────────
create or replace function public.set_repossession_stage(
  p_contract_id uuid,
  p_stage text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can change the repossession stage';
  end if;
  if p_stage not in ('none', 'letter_prepared', 'letter_sent', 'for_pullout', 'repossessed') then
    raise exception 'Invalid repossession stage: %', p_stage;
  end if;

  update public.contracts set repossession_stage = p_stage where id = p_contract_id;
  if not found then
    raise exception 'Contract not found';
  end if;
end;
$$;
