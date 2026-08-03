-- E & J — Collector remittances, and reconciling entries to payments
--
-- Two problems, one module.
--
-- ── 1. There was no record of money being handed in ──────────────────────────
-- collection_entries records what a collector COLLECTED. Nothing anywhere
-- recorded what they REMITTED. docs/modules/collections.md describes the
-- reconcile as a paper ritual ("remit everything by 4:30 PM"), and the app's
-- only stand-in was v_collector_day.pending_total — which answers a different
-- question entirely (what the admin has not posted yet), and drops to zero the
-- moment the admin posts, whether or not a peso ever changed hands.
--
-- The model here is a running balance, because the cadence is deliberately
-- flexible — one hand-over may cover several days:
--
--     cash_on_hand = cash collected − remitted
--
-- Three properties of that formula are deliberate:
--
--   * Entry STATUS is irrelevant. Posting is a ledger act at the office desk;
--     the cash is in the collector's bag until they hand it over. Both pending
--     and posted entries count. This is what keeps the balance correct under
--     the house workflow, where entries often stay pending forever (see 2).
--   * ONLINE entries contribute zero, by the method='cash' filter. A GCash
--     payment goes straight to the owner's number and never passes through the
--     collector's hands, so it is real collection performance but nothing to
--     remit. log_collection (0021) forces method non-null on collected
--     entries, so this filter cannot silently drop a row.
--   * A VOIDED payment does not refund custody. The collector still took the
--     cash; voiding is a ledger correction. If the void is because the cash
--     never existed, cancel the ENTRY (cancel_collection_entry, 0012) — that
--     is what removes it from the balance.
--
-- No backfill. Opening balances are deliberately NOT seeded: an automatic
-- "settled on paper" row would record a hand-over the app never witnessed.
-- Every collector starts showing their full collection history as cash on
-- hand, and the owner records the real hand-over once. Small and true beats
-- instant and assumed.
--
-- ── 2. Two posting paths, no link between them ───────────────────────────────
-- post_collection_entry (0012) calls record_payment, exactly as the Contracts
-- tab does. They are the same act. But the admin's habit is the Contracts tab,
-- so the collector's entry is left behind as a ghost in the "To post" queue
-- while the payment exists independently — the money is banked correctly and
-- the customer's balance is right, but nothing joins the two.
--
-- That is a live hazard: pressing "Post payment" on such an entry creates a
-- SECOND payment for the same cash. link_collection_payment below closes the
-- entry against the payment that already exists, creating nothing, and
-- v_entry_payment_candidates surfaces the matches so the admin is warned
-- instead of surprised.
--
-- Nothing here changes business math: no view, no money column, no
-- amortization rule is touched.

-- ──────────────────────────────────────────────────────────────
-- 1. remittances
-- ──────────────────────────────────────────────────────────────
create table if not exists public.remittances (
  id uuid primary key default gen_random_uuid(),
  remit_no text unique not null,
  collector_id uuid not null references public.profiles (id),
  amount numeric(12,2) not null check (amount > 0),
  remitted_on date not null,
  received_by uuid references public.profiles (id),
  note text,
  created_at timestamptz not null default now(),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text
);

comment on table public.remittances is
  'One row per hand-over of field cash to the office. Deliberately NOT linked '
  'to individual collection_entries: the cadence is flexible, so a single '
  'remittance may settle parts of several days. Reconciliation happens at the '
  'day grain via v_collector_day plus the collector''s receipt booklet.';

comment on column public.remittances.received_by is
  'The owner/admin who physically received the cash. Nullable only so that a '
  'future data-repair migration can write a row without a JWT.';

create index if not exists remittances_collector_date
  on public.remittances (collector_id, remitted_on);

alter table public.remittances enable row level security;

-- Same shape as collection_entries: owner/admin see everything, a collector
-- sees only their own. Dropped first so the migration stays re-runnable —
-- Postgres has no `create policy if not exists`.
drop policy if exists remittances_select on public.remittances;
create policy remittances_select on public.remittances
  for select using (
    public.is_active_user()
    and (public.can_post_payments() or collector_id = auth.uid())
  );

-- No insert/update/delete policies: writes go only through the RPCs below.

-- ──────────────────────────────────────────────────────────────
-- 2. record_remittance
-- ──────────────────────────────────────────────────────────────
-- Owner/admin only — the person who physically receives the cash is the person
-- who records it, the same trust boundary as posting a payment.
--
-- Deliberately NOT capped against the computed cash_on_hand. Entries are
-- sometimes logged late (a collector writing up the day back at the office),
-- and a hard cap would block a legitimate hand-over at the counter. The UI
-- shows the live balance beside the form instead — a soft guard the admin can
-- read and override.
create or replace function public.record_remittance(
  p_collector_id uuid,
  p_amount numeric,
  p_remitted_on date default null,
  p_note text default null
)
returns public.remittances
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
  v_on date;
  v_n int;
  v_row public.remittances;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can record a remittance';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Amount must be greater than zero';
  end if;

  -- role, not is_collector(): a deactivated collector must still be able to
  -- hand in their last bag of cash.
  select role into v_role from public.profiles where id = p_collector_id;
  if v_role is null then
    raise exception 'Collector not found';
  end if;
  if v_role <> 'collector' then
    raise exception 'Remittances can only be recorded against a collector';
  end if;

  v_on := coalesce(p_remitted_on, public.ph_today());
  if v_on > public.ph_today() then
    raise exception 'A remittance cannot be dated in the future';
  end if;

  v_n := public.next_counter('remittance');

  insert into public.remittances
    (remit_no, collector_id, amount, remitted_on, received_by, note)
  values (
    'RMT' || lpad(v_n::text, 4, '0'),
    p_collector_id, p_amount, v_on, auth.uid(),
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. cancel_remittance
-- ──────────────────────────────────────────────────────────────
-- Owner-only, mirroring void_payment rather than cancel_collection_entry:
-- un-declaring cash the office has already acknowledged receiving is the more
-- dangerous direction. Money rows are never deleted — correct a wrong amount
-- by cancelling and recording again.
--
-- The single conditional UPDATE is the point: `where ... and cancelled_at is
-- null` makes the check and the write one atomic statement, so two concurrent
-- cancels cannot both succeed. Do NOT refactor this into select-then-update —
-- that is the shape that gave post_collection_entry its known double-post race
-- (see the 0029 header).
create or replace function public.cancel_remittance(
  p_remittance_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can cancel a remittance';
  end if;

  update public.remittances
  set cancelled_by = auth.uid(),
      cancelled_at = now(),
      cancel_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_remittance_id
    and cancelled_at is null;

  if not found then
    raise exception 'Remittance not found or already cancelled';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. link_collection_payment
-- ──────────────────────────────────────────────────────────────
-- Closes a collector's entry against a payment the admin already recorded on
-- the Contracts tab. Creates NOTHING — it only records that these two rows are
-- the same money, which is what stops the entry from being posted a second
-- time.
--
-- Same atomic conditional-update shape as cancel_remittance: the status check
-- and the write are one statement, so the entry cannot be linked twice or
-- linked and posted concurrently.
create or replace function public.link_collection_payment(
  p_entry_id uuid,
  p_payment_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_contract uuid;
  v_voided timestamptz;
  v_taken uuid;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can link a payment';
  end if;

  select contract_id, voided_at into v_contract, v_voided
  from public.payments where id = p_payment_id;
  if v_contract is null then
    raise exception 'Payment not found';
  end if;
  if v_voided is not null then
    raise exception 'That payment is voided';
  end if;

  -- One payment, one entry. Without this a single payment could be used to
  -- close several entries and the cash would look accounted for twice.
  select id into v_taken
  from public.collection_entries where payment_id = p_payment_id;
  if v_taken is not null then
    raise exception 'That payment is already linked to another entry';
  end if;

  update public.collection_entries
  set status = 'posted',
      payment_id = p_payment_id,
      posted_by = auth.uid(),
      posted_at = now()
  where id = p_entry_id
    and status = 'pending'
    and disposition = 'collected'
    and contract_id = v_contract;

  if not found then
    raise exception
      'Entry not found, not pending, or that payment is on a different contract';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. v_collector_remittance — the running position, one row per collector
-- ──────────────────────────────────────────────────────────────
-- The trailing predicate on the outer query is load-bearing. profiles_select
-- (0001) is a bare is_active_user(), so a collector can read every profile
-- row; without the filter this view would hand them a row per colleague. Their
-- RLS on collection_entries/remittances hides the AMOUNTS, so those rows would
-- read as genuine zeroes — worse than not showing them at all.
create or replace view public.v_collector_remittance
with (security_invoker = true)
as
with collected as (
  select
    collector_id,
    coalesce(sum(amount) filter (where method = 'cash'), 0) as cash_collected,
    coalesce(sum(amount) filter (where method = 'online'), 0) as online_collected,
    max(work_date) as last_entry_on
  from public.collection_entries
  where disposition = 'collected'
    and status <> 'cancelled'
  group by collector_id
),
remitted as (
  select
    collector_id,
    coalesce(sum(amount), 0) as remitted_total,
    max(remitted_on) as last_remitted_on
  from public.remittances
  where cancelled_at is null
  group by collector_id
)
select
  p.id                                                as collector_id,
  p.full_name                                         as collector_name,
  p.active,
  coalesce(c.cash_collected, 0)                       as cash_collected,
  coalesce(c.online_collected, 0)                     as online_collected,
  coalesce(c.cash_collected, 0)
    + coalesce(c.online_collected, 0)                 as total_collected,
  coalesce(r.remitted_total, 0)                       as remitted_total,
  coalesce(c.cash_collected, 0)
    - coalesce(r.remitted_total, 0)                   as cash_on_hand,
  c.last_entry_on,
  r.last_remitted_on
from public.profiles p
left join collected c on c.collector_id = p.id
left join remitted r on r.collector_id = p.id
where p.role = 'collector'
  and (public.can_post_payments() or p.id = auth.uid());

-- ──────────────────────────────────────────────────────────────
-- 6. v_collector_month — history
-- ──────────────────────────────────────────────────────────────
-- v_collector_day answers "what happened on this date". This answers "how has
-- this collector been doing", which nothing did before.
--
-- Entries only, no remittance column, on purpose: under a flexible cadence a
-- remittance does not belong to the month of the entries it settles, so
-- bucketing them together would manufacture a shortfall in one month and a
-- surplus in the next. The remittance history IS the ledger.
create or replace view public.v_collector_month
with (security_invoker = true)
as
select
  e.collector_id,
  p.full_name as collector_name,
  date_trunc('month', e.work_date)::date as month,
  count(*) filter (where e.status <> 'cancelled') as entries,
  count(*) filter (where e.disposition = 'collected' and e.status <> 'cancelled') as collected_count,
  count(*) filter (where e.disposition = 'promised' and e.status <> 'cancelled') as promised_count,
  coalesce(sum(e.amount) filter (where e.method = 'cash' and e.status <> 'cancelled'), 0) as cash_total,
  coalesce(sum(e.amount) filter (where e.method = 'online' and e.status <> 'cancelled'), 0) as online_total,
  coalesce(sum(e.amount) filter (where e.status = 'posted'), 0) as posted_total
from public.collection_entries e
left join public.profiles p on p.id = e.collector_id
group by e.collector_id, p.full_name, 3;

-- ──────────────────────────────────────────────────────────────
-- 7. v_entry_payment_candidates — the ghost detector
-- ──────────────────────────────────────────────────────────────
-- A pending collected entry that almost certainly IS the payment the admin
-- already recorded by hand. Feeds both the "link" action and the warning on
-- the post dialog.
--
-- Matching is deliberately strict — exact amount, same contract, within a week
-- — because a false positive here invites the admin to close an entry against
-- somebody else's money. A missed match costs nothing: the entry simply stays
-- in the queue.
create or replace view public.v_entry_payment_candidates
with (security_invoker = true)
as
select
  e.id           as entry_id,
  p.id           as payment_id,
  p.payment_no,
  p.payment_date,
  p.amount,
  p.receipt_no
from public.collection_entries e
join public.payments p
  on p.contract_id = e.contract_id
 and p.amount = e.amount
 and p.payment_date between e.work_date - 7 and e.work_date + 7
where e.status = 'pending'
  and e.disposition = 'collected'
  and p.voided_at is null
  and not exists (
    select 1 from public.collection_entries e2 where e2.payment_id = p.id
  );

-- ──────────────────────────────────────────────────────────────
-- 8. Keep the RMT series repairable after a re-import
-- ──────────────────────────────────────────────────────────────
-- scripts/migrate/import.ts wipes id_counters, and 0025 repairs the series
-- that existed when it was written — neither knows about 'remittance'. The
-- importer's list is updated in the same commit; this block is the other half,
-- so re-running 0030 is a complete remedy the way re-running 0025 is. A no-op
-- on a fresh install (the table is empty, so it seeds 0), and greatest() never
-- moves a live counter backwards.
insert into public.id_counters (scope, last_value)
select 'remittance',
       coalesce(max(substring(remit_no from '[0-9]+$')::int), 0)
from public.remittances
on conflict (scope) do update
  set last_value = greatest(public.id_counters.last_value, excluded.last_value);
