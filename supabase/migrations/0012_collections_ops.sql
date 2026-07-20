-- E & J — Collector operations
-- Collectors work an assigned, priority-ordered worklist and LOG collections
-- (they never post payments). Owner/admin post logged collections into real
-- payments via record_payment. Cash advances are tracked issue → close.
-- Accountability = daily report + remittance reconcile (no per-visit GPS).

-- ──────────────────────────────────────────────────────────────
-- 1. Assignment priority (collector_id / agent_id added in 0011)
-- ──────────────────────────────────────────────────────────────
alter table public.contracts
  add column if not exists collection_priority smallint;  -- 1 = highest; null = unranked

-- ──────────────────────────────────────────────────────────────
-- 2. Collection entries — the collector's daily log + bridge to posting.
--    A row here is NOT a payment until owner/admin posts it.
-- ──────────────────────────────────────────────────────────────
create table public.collection_entries (
  id uuid primary key default gen_random_uuid(),
  entry_no text unique not null,                 -- 'CE####' from id_counters
  contract_id uuid not null references public.contracts (id),
  collector_id uuid not null references public.profiles (id),
  work_date date not null,                       -- Manila local
  amount numeric(12,2) not null default 0 check (amount >= 0),
  method text check (method in ('cash', 'online')),
  reference_no text,                             -- GCash ref / online confirmation
  disposition text not null default 'collected' check (disposition in (
    'collected', 'promised', 'not_available', 'refused'
  )),
  status text not null default 'pending' check (status in (
    'pending', 'posted', 'cancelled'
  )),
  payment_id uuid references public.payments (id),  -- set when posted
  note text,
  created_at timestamptz not null default now(),
  posted_by uuid references public.profiles (id),
  posted_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz
);

create index collection_entries_collector_day
  on public.collection_entries (collector_id, work_date);
create index collection_entries_contract on public.collection_entries (contract_id);
create index collection_entries_status on public.collection_entries (status);

-- ──────────────────────────────────────────────────────────────
-- 3. Cash advances (gasoline / collection expenses) + their receipts
-- ──────────────────────────────────────────────────────────────
create table public.cash_advances (
  id uuid primary key default gen_random_uuid(),
  advance_no text unique not null,               -- 'CA####'
  collector_id uuid not null references public.profiles (id),
  amount numeric(12,2) not null check (amount > 0),
  purpose text,
  -- requested (by collector) → open (owner/admin approves/issues) → closed
  -- (receipts reconciled); declined = owner rejected a request.
  status text not null default 'requested' check (status in (
    'requested', 'open', 'closed', 'declined'
  )),
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id),
  issued_at timestamptz,
  closed_by uuid references public.profiles (id),
  closed_at timestamptz,
  decline_reason text
);

create index cash_advances_collector on public.cash_advances (collector_id);
create index cash_advances_status on public.cash_advances (status);

create table public.cash_advance_expenses (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.cash_advances (id) on delete cascade,
  description text not null,
  amount numeric(12,2) not null check (amount > 0),
  receipt_ref text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index cash_advance_expenses_advance on public.cash_advance_expenses (advance_id);

-- ──────────────────────────────────────────────────────────────
-- 4. Views (security_invoker → inherit caller RLS)
-- ──────────────────────────────────────────────────────────────

-- Financials + assignment. v_contract_financials froze its column list at
-- creation (select c.*), so it does NOT expose collector_id / agent_id /
-- collection_priority; join contracts to bring those in. security_invoker
-- means a collector sees only their own contracts (contracts RLS), so
-- "open" already means "assigned to me" for them.
create or replace view public.v_contract_collections
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

-- Per-collector per-day roll-up: the daily report + remittance basis.
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
  coalesce(sum(e.amount) filter (where e.status = 'posted'), 0) as posted_total,
  coalesce(sum(e.amount) filter (where e.status = 'pending' and e.disposition = 'collected'), 0) as pending_total
from public.collection_entries e
left join public.profiles p on p.id = e.collector_id
group by e.collector_id, p.full_name, e.work_date;

-- ──────────────────────────────────────────────────────────────
-- 5. RPCs (SECURITY DEFINER, role-guarded, id_counters IDs)
-- ──────────────────────────────────────────────────────────────

-- Owner/admin assigns (or reassigns/unassigns) a collector + priority.
create or replace function public.assign_collector(
  p_contract_id uuid,
  p_collector_id uuid,
  p_priority smallint default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can assign collectors';
  end if;

  if p_collector_id is not null and not exists (
    select 1 from public.profiles
    where id = p_collector_id and role = 'collector' and active
  ) then
    raise exception 'Assignee must be an active collector';
  end if;

  update public.contracts
  set collector_id = p_collector_id,
      collection_priority = p_priority
  where id = p_contract_id;

  if not found then
    raise exception 'Contract not found';
  end if;
end;
$$;

-- Collector logs a collection/visit outcome for a contract assigned to them.
-- This is the collector's ONLY write into the money flow — not a payment.
create or replace function public.log_collection(
  p_contract_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_disposition text default 'collected',
  p_note text default null
)
returns public.collection_entries
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.collection_entries;
begin
  if not public.is_collector() then
    raise exception 'Only a collector can log collections';
  end if;

  if not exists (
    select 1 from public.contracts
    where id = p_contract_id and collector_id = auth.uid()
  ) then
    raise exception 'This contract is not assigned to you';
  end if;

  if p_disposition = 'collected' then
    if coalesce(p_amount, 0) <= 0 then
      raise exception 'A collected entry needs an amount greater than zero';
    end if;
    if p_method is null or p_method not in ('cash', 'online') then
      raise exception 'Collected entry needs method cash or online';
    end if;
    if p_method = 'online' and coalesce(trim(p_reference), '') = '' then
      raise exception 'Online collection needs a reference number';
    end if;
  end if;

  v_n := public.next_counter('collection_entry');

  insert into public.collection_entries (
    entry_no, contract_id, collector_id, work_date,
    amount, method, reference_no, disposition, note
  ) values (
    'CE' || lpad(v_n::text, 4, '0'),
    p_contract_id, auth.uid(), public.ph_today(),
    case when p_disposition = 'collected' then p_amount else 0 end,
    case when p_disposition = 'collected' then p_method else null end,
    nullif(trim(coalesce(p_reference, '')), ''),
    p_disposition,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Owner/admin posts a pending 'collected' entry into a real payment.
create or replace function public.post_collection_entry(
  p_entry_id uuid,
  p_receipt_no text,
  p_receipt_type text
)
returns public.payments
language plpgsql
security definer set search_path = public
as $$
declare
  v_entry public.collection_entries;
  v_payment public.payments;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can post payments';
  end if;

  select * into v_entry from public.collection_entries where id = p_entry_id;
  if not found then
    raise exception 'Collection entry not found';
  end if;
  if v_entry.status <> 'pending' then
    raise exception 'Entry is not pending';
  end if;
  if v_entry.disposition <> 'collected' or v_entry.amount <= 0 then
    raise exception 'Only a collected entry with an amount can be posted';
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
  where id = p_entry_id;

  return v_payment;
end;
$$;

-- Cancel a pending entry (owner/admin any; collector own).
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
  select * into v_entry from public.collection_entries where id = p_entry_id;
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
  where id = p_entry_id;
end;
$$;

-- Collector asks for a cash advance (gasoline / collection expenses).
create or replace function public.request_cash_advance(
  p_amount numeric,
  p_purpose text default null
)
returns public.cash_advances
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.cash_advances;
begin
  if not public.is_collector() then
    raise exception 'Only a collector can request a cash advance';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Advance amount must be greater than zero';
  end if;

  v_n := public.next_counter('cash_advance');

  insert into public.cash_advances (
    advance_no, collector_id, amount, purpose, status, requested_by
  ) values (
    'CA' || lpad(v_n::text, 4, '0'),
    auth.uid(), p_amount, nullif(trim(coalesce(p_purpose, '')), ''),
    'requested', auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Owner/admin issues an advance directly to a collector (skips the request).
create or replace function public.issue_cash_advance(
  p_collector_id uuid,
  p_amount numeric,
  p_purpose text default null
)
returns public.cash_advances
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.cash_advances;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can issue cash advances';
  end if;
  if not exists (
    select 1 from public.profiles
    where id = p_collector_id and role = 'collector' and active
  ) then
    raise exception 'Cash advances go to an active collector';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'Advance amount must be greater than zero';
  end if;

  v_n := public.next_counter('cash_advance');

  insert into public.cash_advances (
    advance_no, collector_id, amount, purpose, status,
    requested_by, issued_by, issued_at
  ) values (
    'CA' || lpad(v_n::text, 4, '0'),
    p_collector_id, p_amount, nullif(trim(coalesce(p_purpose, '')), ''), 'open',
    p_collector_id, auth.uid(), now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- Owner/admin approves a pending request (requested → open).
create or replace function public.approve_cash_advance(p_advance_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can approve cash advances';
  end if;

  update public.cash_advances
  set status = 'open', issued_by = auth.uid(), issued_at = now()
  where id = p_advance_id and status = 'requested';

  if not found then
    raise exception 'Request not found or already handled';
  end if;
end;
$$;

-- Owner/admin declines a pending request (requested → declined).
create or replace function public.decline_cash_advance(
  p_advance_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can decline cash advances';
  end if;

  update public.cash_advances
  set status = 'declined',
      decline_reason = nullif(trim(coalesce(p_reason, '')), ''),
      closed_by = auth.uid(), closed_at = now()
  where id = p_advance_id and status = 'requested';

  if not found then
    raise exception 'Request not found or already handled';
  end if;
end;
$$;

-- Collector (own) or owner/admin records a receipt against an open advance.
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
  select * into v_adv from public.cash_advances where id = p_advance_id;
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

-- Owner/admin closes an advance (after receipts + returned cash reconcile).
create or replace function public.close_cash_advance(p_advance_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can close cash advances';
  end if;

  update public.cash_advances
  set status = 'closed', closed_by = auth.uid(), closed_at = now()
  where id = p_advance_id and status = 'open';

  if not found then
    raise exception 'Advance not found or already closed';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 6. Row Level Security (reads only; all writes via the RPCs above)
-- ──────────────────────────────────────────────────────────────
alter table public.collection_entries enable row level security;
alter table public.cash_advances enable row level security;
alter table public.cash_advance_expenses enable row level security;

-- collection_entries: owner/admin all; collector own
create policy collection_entries_select on public.collection_entries
  for select using (
    public.is_active_user() and (
      public.can_post_payments() or collector_id = auth.uid()
    )
  );

-- cash_advances: owner/admin all; collector own
create policy cash_advances_select on public.cash_advances
  for select using (
    public.is_active_user() and (
      public.can_post_payments() or collector_id = auth.uid()
    )
  );

-- cash_advance_expenses: owner/admin all; collector own (via advance)
create policy cash_advance_expenses_select on public.cash_advance_expenses
  for select using (
    public.is_active_user() and (
      public.can_post_payments() or exists (
        select 1 from public.cash_advances a
        where a.id = cash_advance_expenses.advance_id
          and a.collector_id = auth.uid()
      )
    )
  );
