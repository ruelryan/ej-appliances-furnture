-- E & J — Collection & cash-custody integrity
--
-- The financial-integrity half of the audit whose access-control half shipped
-- as 0029. 0029's header listed these as deliberately deferred because they
-- change behaviour; this is that migration.
--
-- The theme is the same defect repeated: a SELECT, a check in plpgsql, then an
-- UPDATE — three statements where the database only guarantees one. Under READ
-- COMMITTED two callers both pass the check. cancel_remittance (0030) was
-- written correctly and its comment says so; the older RPCs never got the same
-- treatment. Every fix below is either a row lock, a predicate moved into the
-- UPDATE, or a real constraint.
--
-- Nothing here touches business math: no view that feeds compute_terms, no
-- money column, no amortization rule. The overpayment cap — the one genuine
-- behaviour change — ships separately as 0032.

-- ──────────────────────────────────────────────────────────────
-- 1. One payment, one entry — as a constraint, not a comment
-- ──────────────────────────────────────────────────────────────
-- link_collection_payment (0030) claims this invariant and enforces it with an
-- unlocked SELECT followed by an UPDATE on a different row. Two concurrent
-- links to the same payment both read "not taken" and both commit, so one
-- payment closes two entries and the cash looks accounted for twice.
--
-- The RPC keeps its pre-check for a readable error message; this index is what
-- actually holds the line.
do $$
declare
  v_dupes int;
begin
  select count(*) into v_dupes from (
    select payment_id
    from public.collection_entries
    where payment_id is not null
    group by payment_id
    having count(*) > 1
  ) d;

  if v_dupes > 0 then
    raise exception
      'Cannot add the unique index: % payment(s) are already linked to more than one collection entry. Resolve them first with: select payment_id, count(*) from public.collection_entries where payment_id is not null group by 1 having count(*) > 1;',
      v_dupes;
  end if;
end $$;

create unique index if not exists collection_entries_payment_id_uniq
  on public.collection_entries (payment_id)
  where payment_id is not null;

-- ──────────────────────────────────────────────────────────────
-- 2. post_collection_entry — the known double-post race
-- ──────────────────────────────────────────────────────────────
-- The old body read the entry with a bare SELECT, checked status in plpgsql,
-- called record_payment (which INSERTS), then updated the entry with no status
-- predicate. A double-submitted dialog or a retried Server Action produced TWO
-- payments for one bag of cash, and the entry pointed at whichever UPDATE
-- landed second. The customer's balance was understated until someone noticed.
--
-- Two changes:
--
--   FOR UPDATE takes a row lock before the check. A second caller blocks on
--   the lock, and under READ COMMITTED re-reads the row when the first commits
--   — seeing status='posted' and raising. This is the actual fix.
--
--   The final UPDATE carries `and status = 'pending'` and raises if it matched
--   nothing. Belt and braces: if the entry moved by any path we did not
--   anticipate, the exception rolls back the payment record_payment just
--   inserted, rather than leaving money behind pointing at nothing.
--
-- p_force is the second half. v_entry_payment_candidates already knows when an
-- entry is almost certainly a payment the admin recorded on the Contracts tab
-- — the two paths both call record_payment, so doing both creates two payments
-- for one collection. That warning lived only in React state, which is
-- advisory: the browser holds the anon key and can call the RPC directly, and
-- the dialog's own "post anyway" button stayed enabled. Now the refusal is in
-- SQL and the caller must say force explicitly.
--
-- Argument list changes, so the old function must be DROPPED first — `create
-- or replace` with a different signature creates an overload and makes
-- PostgREST rpc() resolution ambiguous (see 0010 and 0021).
drop function if exists public.post_collection_entry(uuid, text, text);

create or replace function public.post_collection_entry(
  p_entry_id uuid,
  p_receipt_no text,
  p_receipt_type text,
  p_force boolean default false
)
returns public.payments
language plpgsql
security definer set search_path = public
as $$
declare
  v_entry public.collection_entries;
  v_payment public.payments;
  v_dupe text;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can post payments';
  end if;

  select * into v_entry
  from public.collection_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Collection entry not found';
  end if;
  if v_entry.status <> 'pending' then
    raise exception 'Entry is not pending';
  end if;
  if v_entry.disposition <> 'collected' or v_entry.amount <= 0 then
    raise exception 'Only a collected entry with an amount can be posted';
  end if;

  if not coalesce(p_force, false) then
    select payment_no into v_dupe
    from public.v_entry_payment_candidates
    where entry_id = p_entry_id
    limit 1;

    if v_dupe is not null then
      raise exception
        'Payment % already matches this collection (same contract, same amount, within a week). Link the entry to it instead of posting a second payment.',
        v_dupe;
    end if;
  end if;

  v_payment := public.record_payment(
    v_entry.contract_id,
    v_entry.work_date,
    v_entry.amount,
    p_receipt_no,
    p_receipt_type,
    v_entry.reference_no
  );

  update public.collection_entries
  set status = 'posted',
      payment_id = v_payment.id,
      posted_by = auth.uid(),
      posted_at = now()
  where id = p_entry_id
    and status = 'pending';

  if not found then
    raise exception 'Entry changed while posting — nothing was written';
  end if;

  return v_payment;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. link_collection_payment — compare the money
-- ──────────────────────────────────────────────────────────────
-- The old body checked that the payment was on the same contract and not
-- voided, and nothing else. All the strictness lived in
-- v_entry_payment_candidates, which is only the UI's suggestion engine — the
-- RPC accepted any (entry, payment) pair on one contract. A 10,000 entry could
-- be closed against a 500 payment: the entry leaves the to-post queue, the
-- customer is credited 500, and 9,500 of collected cash is never posted, with
-- no artifact anywhere saying so.
--
-- The matching rule now lives in the function, mirroring the view: exact
-- amount, within seven days. The entry is locked FOR UPDATE so a concurrent
-- post cannot overwrite the link (the old post_collection_entry UPDATE had no
-- status predicate, which freed the payment to be linked a second time).
create or replace function public.link_collection_payment(
  p_entry_id uuid,
  p_payment_id uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_entry public.collection_entries;
  v_contract uuid;
  v_voided timestamptz;
  v_amount numeric;
  v_paid_on date;
  v_taken uuid;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can link a payment';
  end if;

  select contract_id, voided_at, amount, payment_date
    into v_contract, v_voided, v_amount, v_paid_on
  from public.payments where id = p_payment_id;
  if v_contract is null then
    raise exception 'Payment not found';
  end if;
  if v_voided is not null then
    raise exception 'That payment is voided';
  end if;

  -- Readable error for the ordinary case. The unique index added in section 1
  -- is what makes the invariant hold under concurrency.
  select id into v_taken
  from public.collection_entries where payment_id = p_payment_id;
  if v_taken is not null then
    raise exception 'That payment is already linked to another entry';
  end if;

  select * into v_entry
  from public.collection_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Collection entry not found';
  end if;
  if v_entry.status <> 'pending' or v_entry.disposition <> 'collected' then
    raise exception 'Only a pending collected entry can be linked';
  end if;
  if v_entry.contract_id <> v_contract then
    raise exception 'That payment is on a different contract';
  end if;
  if v_amount <> v_entry.amount then
    raise exception
      'Amounts differ — the entry is % and the payment is %. Linking them would leave the difference uncollected.',
      to_char(v_entry.amount, 'FM999,999,990.00'),
      to_char(v_amount, 'FM999,999,990.00');
  end if;
  if v_paid_on < v_entry.work_date - 7 or v_paid_on > v_entry.work_date + 7 then
    raise exception
      'The payment is dated % and the visit was %— more than a week apart, so these are probably not the same money.',
      v_paid_on, v_entry.work_date;
  end if;

  update public.collection_entries
  set status = 'posted',
      payment_id = p_payment_id,
      posted_by = auth.uid(),
      posted_at = now()
  where id = p_entry_id
    and status = 'pending';

  if not found then
    raise exception 'Entry changed while linking — nothing was written';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 4. unlink_collection_payment — make void round-trip
-- ──────────────────────────────────────────────────────────────
-- Voiding a payment that came from a collection entry left the entry stranded:
-- status='posted' pointing at a dead payment. It did not return to the to-post
-- queue (which selects status='pending'), could not be cancelled
-- (cancel_collection_entry takes pending only), and there was no unlink. The
-- customer's balance was correctly restored, the collector was still charged
-- for the cash, and the collection itself fell out of every worklist —
-- recoverable only by unvoiding or direct DB surgery.
--
-- The same gap made a mis-link permanently uncorrectable, which mattered more
-- once 0030 introduced linking. And it made 0030's own documented remedy
-- impossible: "if the cash never existed, cancel the ENTRY" only works while
-- the entry is still pending, so after posting the only way to zero a bogus
-- cash_on_hand was to record a remittance that never happened — falsifying the
-- ledger that exists to prove hand-over.
--
-- Admin may unlink when the payment is already voided (routine cleanup after
-- the owner voids). Unlinking a LIVE payment is owner-only: it decides the
-- money and the collection are not the same event, which is a judgement call,
-- not bookkeeping.
create or replace function public.unlink_collection_payment(
  p_entry_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_entry public.collection_entries;
  v_voided timestamptz;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can unlink a payment';
  end if;

  select * into v_entry
  from public.collection_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Collection entry not found';
  end if;
  if v_entry.status <> 'posted' or v_entry.payment_id is null then
    raise exception 'Only a posted entry linked to a payment can be unlinked';
  end if;

  select voided_at into v_voided
  from public.payments where id = v_entry.payment_id;

  if v_voided is null and not public.is_owner() then
    raise exception
      'That payment is still live — only the owner can separate a collection from a payment that has not been voided';
  end if;

  update public.collection_entries
  set status = 'pending',
      payment_id = null,
      posted_by = null,
      posted_at = null,
      note = case
        when nullif(trim(coalesce(p_reason, '')), '') is null then note
        else trim(both ' ' from coalesce(note, '') || ' [unlinked: ' || trim(p_reason) || ']')
      end
  where id = p_entry_id
    and status = 'posted';

  if not found then
    raise exception 'Entry changed while unlinking — nothing was written';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. cancel_collection_entry — same race, same shape
-- ──────────────────────────────────────────────────────────────
-- Read-then-write like the others: a concurrent cancel and post both passed
-- their checks. Collector self-cancel is KEPT deliberately (a mis-keyed amount
-- in the field should be fixable by the person who made it); section 7 makes
-- the act visible instead of silent.
create or replace function public.cancel_collection_entry(
  p_entry_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_entry public.collection_entries;
begin
  select * into v_entry
  from public.collection_entries
  where id = p_entry_id
  for update;

  if not found then
    raise exception 'Collection entry not found';
  end if;
  if v_entry.status <> 'pending' then
    raise exception 'Only a pending entry can be cancelled';
  end if;
  if not (
    public.can_post_payments()
    or (public.is_collector() and v_entry.collector_id = auth.uid())
  ) then
    raise exception 'Not authorized';
  end if;

  update public.collection_entries
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = now(),
      note = case
        when nullif(trim(coalesce(p_reason, '')), '') is null then note
        else trim(both ' ' from coalesce(note, '') || ' [cancelled: ' || trim(p_reason) || ']')
      end
  where id = p_entry_id
    and status = 'pending';

  if not found then
    raise exception 'Entry changed while cancelling — nothing was written';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. mark_commission_paid / add_advance_expense — the same shape again
-- ──────────────────────────────────────────────────────────────
-- mark_commission_paid checked `paid_at is null` in plpgsql and then updated
-- without it: two clicks could both mark a payout. The check moves into the
-- UPDATE.
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
  where id = p_commission_id
    and paid_at is null;

  if not found then
    raise exception 'Commission was paid by someone else a moment ago';
  end if;
end;
$$;

-- add_advance_expense read the advance without a lock, so a receipt could be
-- inserted against an advance that close_cash_advance closed mid-call.
create or replace function public.add_advance_expense(
  p_advance_id uuid,
  p_description text,
  p_amount numeric,
  p_receipt_ref text default null
)
returns public.cash_advance_expenses
language plpgsql
security definer set search_path = public
as $$
declare
  v_adv public.cash_advances;
  v_row public.cash_advance_expenses;
begin
  select * into v_adv
  from public.cash_advances
  where id = p_advance_id
  for update;

  if not found then
    raise exception 'Cash advance not found';
  end if;
  if v_adv.status <> 'open' then
    raise exception 'This advance is already closed';
  end if;
  if not (
    public.can_post_payments()
    or (public.is_collector() and v_adv.collector_id = auth.uid())
  ) then
    raise exception 'Not authorized';
  end if;
  if coalesce(trim(coalesce(p_description, '')), '') = '' then
    raise exception 'Expense needs a description';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Expense amount must be greater than zero';
  end if;

  insert into public.cash_advance_expenses (
    advance_id, description, amount, receipt_ref, created_by
  ) values (
    p_advance_id, trim(p_description), p_amount,
    nullif(trim(coalesce(p_receipt_ref, '')), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 7. Audit the cash tables
-- ──────────────────────────────────────────────────────────────
-- audit_row_changes has been attached to contracts, payments and customers
-- since 0001, and to the DTR/payroll tables since 0005-0009. The collection
-- and cash-custody tables were never covered — so cancelling an entry,
-- cancelling a remittance, or reopening an advance left no independent trace.
--
-- That gap is what makes the cancel path dangerous rather than merely
-- reversible: a collector can log a collection, hand the customer a booklet
-- receipt, and cancel the entry, and v_collector_remittance drops cancelled
-- rows from cash_collected — so their cash_on_hand returns to its prior value
-- with nothing anywhere recording that it moved. The decision was to keep
-- self-cancel and make it visible: this section records it, section 8 shows it.
--
-- audit_row_changes is used unmodified — it is `after update`, and every event
-- of interest here (cancel, close, unlink) IS an update. It keys on a uuid `id`
-- column, which all four tables have.
drop trigger if exists audit_collection_entries on public.collection_entries;
create trigger audit_collection_entries after update on public.collection_entries
  for each row execute function public.audit_row_changes();

drop trigger if exists audit_remittances on public.remittances;
create trigger audit_remittances after update on public.remittances
  for each row execute function public.audit_row_changes();

drop trigger if exists audit_cash_advances on public.cash_advances;
create trigger audit_cash_advances after update on public.cash_advances
  for each row execute function public.audit_row_changes();

drop trigger if exists audit_cash_advance_expenses on public.cash_advance_expenses;
create trigger audit_cash_advance_expenses after update on public.cash_advance_expenses
  for each row execute function public.audit_row_changes();

-- ──────────────────────────────────────────────────────────────
-- 8. Show cancelled cash on the reports
-- ──────────────────────────────────────────────────────────────
-- New columns are APPENDED, never inserted mid-list: `create or replace view`
-- cannot rename or reorder existing columns, and these two views are read by
-- name elsewhere.
--
-- posted_total also gains `disposition = 'collected'`. It is currently correct
-- only by accident — log_collection forces amount to 0 for every other
-- disposition — so the filter asserts an invariant the view was relying on
-- without stating. It deliberately does NOT gain a method filter: posted means
-- turned into a payment, and a GCash collection posts exactly like a cash one.
create or replace view public.v_collector_day
with (security_invoker = true)
as
select
  e.collector_id,
  p.full_name as collector_name,
  e.work_date,
  count(*) filter (where e.status <> 'cancelled') as entries,
  count(*) filter (where e.disposition = 'collected' and e.status <> 'cancelled') as collected_count,
  count(*) filter (where e.disposition = 'promised' and e.status <> 'cancelled') as promised_count,
  count(*) filter (where e.disposition = 'not_available' and e.status <> 'cancelled') as not_available_count,
  count(*) filter (where e.disposition = 'refused' and e.status <> 'cancelled') as refused_count,
  coalesce(sum(e.amount) filter (where e.method = 'cash' and e.status <> 'cancelled'), 0) as cash_total,
  coalesce(sum(e.amount) filter (where e.method = 'online' and e.status <> 'cancelled'), 0) as online_total,
  coalesce(sum(e.amount) filter (where e.status = 'posted' and e.disposition = 'collected'), 0) as posted_total,
  coalesce(sum(e.amount) filter (where e.status = 'pending' and e.disposition = 'collected'), 0) as pending_total,
  coalesce(sum(e.amount) filter (
    where e.status = 'cancelled' and e.disposition = 'collected' and e.method = 'cash'
  ), 0) as cancelled_cash,
  count(*) filter (where e.status = 'cancelled' and e.disposition = 'collected') as cancelled_count
from public.collection_entries e
left join public.profiles p on p.id = e.collector_id
group by e.collector_id, p.full_name, e.work_date;

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
  coalesce(sum(e.amount) filter (where e.status = 'posted' and e.disposition = 'collected'), 0) as posted_total,
  coalesce(sum(e.amount) filter (
    where e.status = 'cancelled' and e.disposition = 'collected' and e.method = 'cash'
  ), 0) as cancelled_cash,
  count(*) filter (where e.status = 'cancelled' and e.disposition = 'collected') as cancelled_count
from public.collection_entries e
left join public.profiles p on p.id = e.collector_id
group by e.collector_id, p.full_name, 3;

-- ──────────────────────────────────────────────────────────────
-- 9. A role change must not delete an outstanding cash liability
-- ──────────────────────────────────────────────────────────────
-- v_collector_remittance ended `where p.role = 'collector'`, and
-- record_remittance rejected anyone whose role was not collector. 0030
-- deliberately handled DEACTIVATION ("a deactivated collector must still be
-- able to hand in their last bag of cash") but not a role CHANGE. Promote a
-- collector to admin and their row vanishes from the balances table and from
-- "Cash with collectors", and no remittance can ever be recorded against them
-- — the field cash they are still holding simply stops being tracked.
--
-- Anyone who has ever collected keeps their row until the ledger is settled.
-- The second half of the predicate is untouched and remains load-bearing:
-- profiles_select is a bare is_active_user(), so without it a collector would
-- see a row per colleague (with amounts hidden by their own RLS, which reads
-- as a genuine zero — worse than not showing them at all).
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
where (
    p.role = 'collector'
    or c.collector_id is not null
    or r.collector_id is not null
  )
  and (public.can_post_payments() or p.id = auth.uid());

-- record_remittance: same reasoning. A former collector still holding cash
-- must be able to hand it in.
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
  -- hand in their last bag of cash. And a former collector — someone whose
  -- role has since changed — keeps the right for as long as they have
  -- uncancelled collections on the books.
  select role into v_role from public.profiles where id = p_collector_id;
  if v_role is null then
    raise exception 'Collector not found';
  end if;
  if v_role <> 'collector' and not exists (
    select 1 from public.collection_entries
    where collector_id = p_collector_id
      and disposition = 'collected'
      and status <> 'cancelled'
  ) then
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
-- 10. Tasks: a deactivated user must not keep writing
-- ──────────────────────────────────────────────────────────────
-- Every other guard in the schema requires an active profile. These three
-- compared auth.uid() directly, so a deactivated user holding a still-valid JWT
-- kept commenting on and re-statusing tasks they created or were assigned —
-- and could not read the result back, because task_comments_select DOES check
-- active. A silent one-way channel out of a disabled account.
create or replace function public.can_see_task(p_task_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select public.is_active_user() and exists (
    select 1 from public.tasks t
    where t.id = p_task_id and (
      public.is_owner()
      or t.created_by = auth.uid()
      or t.assignee_id = auth.uid()
      or t.assignee_role = public.my_role()
    )
  );
$$;

create or replace function public.set_task_status(p_task_id uuid, p_status text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;
  -- owner, creator, assigned person, or a member of the assigned team
  if not (
    public.is_active_user() and (
      public.is_owner()
      or v_task.created_by = auth.uid()
      or v_task.assignee_id = auth.uid()
      or v_task.assignee_role = public.my_role()
    )
  ) then
    raise exception 'Not authorized';
  end if;
  if p_status not in ('open', 'in_progress', 'done', 'cancelled') then
    raise exception 'Invalid status';
  end if;

  update public.tasks
  set status = p_status,
      completed_at = case when p_status = 'done' then now() else null end,
      completed_by = case when p_status = 'done' then auth.uid() else null end
  where id = p_task_id;
end;
$$;

create or replace function public.reassign_task(
  p_task_id uuid,
  p_assignee_id uuid,
  p_assignee_role text
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;
  if not (
    public.is_active_user()
    and (public.is_owner() or v_task.created_by = auth.uid())
  ) then
    raise exception 'Only the owner or the task creator can reassign';
  end if;
  if (p_assignee_id is not null) = (p_assignee_role is not null) then
    raise exception 'Assign to exactly one of a person or a team';
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles where id = p_assignee_id and active
  ) then
    raise exception 'Assignee is not an active user';
  end if;

  update public.tasks
  set assignee_id = p_assignee_id, assignee_role = p_assignee_role
  where id = p_task_id;
end;
$$;
