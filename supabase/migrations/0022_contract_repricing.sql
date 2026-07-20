-- E & J — Term repricing (Good-as-Cash lapse)
--
-- 4 and 5 month terms are "Good as Cash": the total equals the cash price. That
-- discount exists to reward fast payment. A customer who takes a year to pay a
-- four-month contract has had a twelve-month loan at a four-month price.
--
-- LEGAL SHAPE (this is why the flow is two-step, not one):
-- Civil Code Art. 1308 — a contract binds both parties and its compliance cannot
-- be left to the will of one of them. A clause letting the seller revise the
-- price at its discretion is prima facie void, and notice does not cure it. So
-- repricing is NOT "the admin decides". It is a conditional discount lapsing on
-- an objective event the CUSTOMER controls: the Good-as-Cash period elapsed and
-- a balance remains. That test is enforced here in SQL rather than in the UI, so
-- the objectivity is real and not merely described.
--
-- The 1,509 contracts already signed contain no such clause, so for them the
-- lapse cannot apply unilaterally at all. Hence: propose -> customer signs an
-- amendment -> confirm. The contract's money columns do not move until a human
-- records that signature.
--
-- INVARIANT: cash_price NEVER changes. downpayment is 25% of cash_price and so
-- is term-invariant. That is what keeps commissions (10% of cash_price, snapshot)
-- and v_contract_dp.dp_paid correct through a reprice. Breaking it would silently
-- un-earn commissions.

create table if not exists public.contract_repricings (
  id uuid primary key default gen_random_uuid(),
  amendment_no text not null unique,
  contract_id uuid not null references public.contracts (id) on delete cascade,

  from_term int not null,
  from_total numeric(12,2) not null,
  from_monthly numeric(12,2) not null,
  to_term int not null,
  to_total numeric(12,2) not null,
  to_monthly numeric(12,2) not null,

  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'signed', 'reverted', 'cancelled')),
  signed_date date,

  proposed_by uuid references public.profiles (id),
  proposed_at timestamptz not null default now(),
  confirmed_by uuid references public.profiles (id),
  confirmed_at timestamptz,
  reverted_at timestamptz
);

create index if not exists contract_repricings_contract
  on public.contract_repricings (contract_id, proposed_at desc);

-- Only one proposal may be outstanding per contract at a time.
create unique index if not exists contract_repricings_one_pending
  on public.contract_repricings (contract_id)
  where status = 'pending';

comment on table public.contract_repricings is
  'Amendment history. Also the source of truth for the ORIGINALLY SIGNED terms — '
  'the printed contract must show those, not the current row, or it would assert '
  'the customer agreed to figures they never saw.';

alter table public.contract_repricings enable row level security;

create policy repricings_select on public.contract_repricings
  for select using (public.is_active_user());

-- ──────────────────────────────────────────────────────────────
-- Guard: the money columns become genuinely RPC-only
-- ──────────────────────────────────────────────────────────────
-- The claim that "price and term are locked after creation" was enforced by
-- nothing: RLS grants the owner a blanket UPDATE on contracts with no column
-- restriction, so total_price could be PATCHed straight through PostgREST. This
-- closes that while opening the controlled path below.
create or replace function public.guard_contract_money_columns()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.allow_terms_change', true), '') = 'on' then
    return new;
  end if;

  if new.cash_price is distinct from old.cash_price
     or new.total_price is distinct from old.total_price
     or new.downpayment is distinct from old.downpayment
     or new.monthly_amortization is distinct from old.monthly_amortization
     or new.term_months is distinct from old.term_months then
    raise exception
      'Contract pricing is changed only through confirm_reprice / revert_reprice';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_contract_money on public.contracts;
create trigger guard_contract_money
  before update on public.contracts
  for each row execute function public.guard_contract_money_columns();

-- ──────────────────────────────────────────────────────────────
-- 1. Propose — creates the amendment to be signed. Contract untouched.
-- ──────────────────────────────────────────────────────────────
create or replace function public.propose_reprice(
  p_contract_id uuid,
  p_new_term int,
  p_reason text default null
)
returns public.contract_repricings
language plpgsql
security definer set search_path = public
as $$
declare
  v_c public.contracts;
  v_terms record;
  v_elapsed int;
  v_paid numeric;
  v_row public.contract_repricings;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can propose a repricing';
  end if;

  select * into v_c from public.contracts where id = p_contract_id;
  if not found then
    raise exception 'Contract not found';
  end if;

  if v_c.sale_type = 'cash' then
    raise exception 'A cash sale has no term to reprice';
  end if;
  if v_c.payment_status = 'closed' then
    raise exception 'This contract is already closed';
  end if;

  -- Escalation only, and only along the published ladder.
  if not (
    (v_c.term_months in (4, 5) and p_new_term = 6)
    or (v_c.term_months = 6 and p_new_term = 12)
  ) then
    raise exception
      'Repricing goes 4/5 months to 6, or 6 to 12. % to % is not allowed',
      v_c.term_months, p_new_term;
  end if;

  -- The objective trigger. Both legs are the customer's own performance, which
  -- is what keeps this out of Art. 1308's potestative prohibition.
  v_elapsed := public.months_elapsed_ph(v_c.contract_date);
  if v_elapsed < v_c.term_months then
    raise exception
      'The % month term has not elapsed yet (% months so far)',
      v_c.term_months, v_elapsed;
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments where contract_id = p_contract_id and voided_at is null;

  if v_paid >= v_c.total_price then
    raise exception 'This contract is fully paid — nothing to reprice';
  end if;

  select * into v_terms from public.compute_terms(v_c.cash_price, p_new_term);

  insert into public.contract_repricings (
    amendment_no, contract_id,
    from_term, from_total, from_monthly,
    to_term, to_total, to_monthly,
    reason, proposed_by
  ) values (
    'AMD' || lpad(public.next_counter('repricing')::text, 4, '0'),
    p_contract_id,
    v_c.term_months, v_c.total_price, v_c.monthly_amortization,
    p_new_term, v_terms.total_price, v_terms.monthly_amortization,
    nullif(trim(coalesce(p_reason, '')), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. Confirm — only after the customer has signed the amendment
-- ──────────────────────────────────────────────────────────────
create or replace function public.confirm_reprice(
  p_repricing_id uuid,
  p_signed_date date default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_r public.contract_repricings;
  v_date date;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can confirm a repricing';
  end if;

  select * into v_r from public.contract_repricings where id = p_repricing_id;
  if not found then
    raise exception 'Amendment not found';
  end if;
  if v_r.status <> 'pending' then
    raise exception 'This amendment is already %', v_r.status;
  end if;

  v_date := coalesce(p_signed_date, public.ph_today());
  if v_date > public.ph_today() then
    raise exception 'The signed date cannot be in the future';
  end if;

  perform set_config('app.allow_terms_change', 'on', true);

  update public.contracts
  set term_months = v_r.to_term,
      total_price = v_r.to_total,
      monthly_amortization = v_r.to_monthly
  where id = v_r.contract_id;

  perform set_config('app.allow_terms_change', 'off', true);

  update public.contract_repricings
  set status = 'signed',
      signed_date = v_date,
      confirmed_by = auth.uid(),
      confirmed_at = now()
  where id = p_repricing_id;

  -- Human-readable trail beside the field-level audit_log rows the contracts
  -- trigger writes automatically.
  insert into public.contract_notes (contract_id, body, created_by)
  values (
    v_r.contract_id,
    'Amendment ' || v_r.amendment_no || ' signed ' || v_date || ': term ' ||
    v_r.from_term || ' to ' || v_r.to_term || ' months, total ' ||
    v_r.from_total || ' to ' || v_r.to_total || '.' ||
    coalesce(' Reason: ' || v_r.reason, ''),
    auth.uid()
  );
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 3. Revert — the catch-up right
-- ──────────────────────────────────────────────────────────────
-- A customer who settles the original total gets the original price back. This
-- is the de-escalation element: a one-way ratchet is the asymmetry that draws
-- scrutiny, and discretion running only in the customer's favour is always safe.
create or replace function public.revert_reprice(
  p_contract_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_first public.contract_repricings;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can revert a repricing';
  end if;

  -- The FIRST signed amendment holds the originally agreed figures.
  select * into v_first
  from public.contract_repricings
  where contract_id = p_contract_id and status = 'signed'
  order by proposed_at asc
  limit 1;

  if not found then
    raise exception 'This contract has no signed repricing to revert';
  end if;

  perform set_config('app.allow_terms_change', 'on', true);

  update public.contracts
  set term_months = v_first.from_term,
      total_price = v_first.from_total,
      monthly_amortization = v_first.from_monthly
  where id = p_contract_id;

  perform set_config('app.allow_terms_change', 'off', true);

  update public.contract_repricings
  set status = 'reverted', reverted_at = now()
  where contract_id = p_contract_id and status = 'signed';

  insert into public.contract_notes (contract_id, body, created_by)
  values (
    p_contract_id,
    'Repricing reverted to the original ' || v_first.from_term ||
    '-month terms (total ' || v_first.from_total || ').' ||
    coalesce(' Reason: ' || p_reason, ''),
    auth.uid()
  );
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- v_contract_original_terms — what the customer actually signed
-- ──────────────────────────────────────────────────────────────
-- The printed contract is force-dynamic and renders the live row, so after a
-- reprice it would show new figures above the original date and signature block.
-- The print page reads this instead.
create or replace view public.v_contract_original_terms
with (security_invoker = true)
as
select
  c.id as contract_id,
  coalesce(f.from_term, c.term_months) as orig_term_months,
  coalesce(f.from_total, c.total_price) as orig_total_price,
  coalesce(f.from_monthly, c.monthly_amortization) as orig_monthly_amortization,
  (f.id is not null) as was_amended,
  f.amendment_no as first_amendment_no,
  f.signed_date as first_amendment_date
from public.contracts c
left join lateral (
  select r.* from public.contract_repricings r
  where r.contract_id = c.id and r.status in ('signed', 'reverted')
  order by r.proposed_at asc
  limit 1
) f on true;
