-- E & J — Overpayment cap and closed-contract guard
--
-- The last of the financial-integrity findings 0029 deferred, and the only one
-- that changes what staff can do. It ships alone for that reason.
--
-- record_payment was a role check, a counter, and an INSERT. It never looked at
-- the contract: a closed contract still accepted payments, and there was no
-- ceiling at all, so a mistyped amount drove remaining_balance negative. The
-- views then read that as settled — followup_tier treats <= 0 as 'on_track'
-- and collection_situation as 'Fully paid' — so the account quietly left every
-- worklist. A fat-fingered extra zero looked exactly like a customer who had
-- finished paying.
--
-- The cap is deliberately NOT exact. A final payment routinely comes in a
-- little over: the customer rounds up, or a collector adds a few pesos rather
-- than make change in the field. Refusing those would push staff into
-- workarounds worse than the problem. OVERPAY_TOLERANCE is the width of that
-- allowance -- large enough for rounding and goodwill, far too small to hide a
-- misplaced digit, which is the error actually worth catching.

-- ──────────────────────────────────────────────────────────────
-- 1. record_payment: refuse closed contracts and real overpayments
-- ──────────────────────────────────────────────────────────────
-- The balance is computed from the tables directly rather than read from
-- v_contract_financials. That view is security_invoker, so reading it from
-- inside a SECURITY DEFINER function re-enters RLS under whichever role is
-- current — a dependency this function does not need. contracts.total_price
-- minus the unvoided payments is the same number the view computes, and it is
-- the number the customer owes.
--
-- Cash sales are safe by construction: sale_type='cash' is modelled as
-- term_months=0 with downpayment = total = cash_price (0016), so the single
-- payment equals total_price exactly and lands inside the allowance.
create or replace function public.record_payment(
  p_contract_id uuid,
  p_payment_date date,
  p_amount numeric,
  p_receipt_no text,
  p_receipt_type text,
  p_reference_no text default null
)
returns public.payments
language plpgsql
security definer set search_path = public
as $$
declare
  -- Pesos of headroom above the outstanding balance. Rounding and goodwill,
  -- not a missing digit.
  c_overpay_tolerance constant numeric := 100;
  v_n int;
  v_total numeric;
  v_status text;
  v_paid numeric;
  v_balance numeric;
  v_row public.payments;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can post payments';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;

  select total_price, payment_status into v_total, v_status
  from public.contracts where id = p_contract_id;
  if v_total is null then
    raise exception 'Contract not found';
  end if;
  -- There is no reopen_contract RPC; the owner reopens by setting the status
  -- back to open on the contract's Edit page, which writes the column directly
  -- (owner-only by RLS). Name that path rather than a button that does not
  -- exist.
  if v_status = 'closed' then
    raise exception
      'This contract is closed, so payments cannot be recorded against it. The owner can reopen it on the contract Edit page.';
  end if;

  select coalesce(sum(amount), 0) into v_paid
  from public.payments
  where contract_id = p_contract_id
    and voided_at is null;

  v_balance := round(v_total - v_paid, 2);

  if p_amount > v_balance + c_overpay_tolerance then
    raise exception
      'That is more than this contract still owes. Balance is %, payment is %. Check the amount — if the overpayment is deliberate, record it up to the balance and note the rest.',
      to_char(v_balance, 'FM999,999,990.00'),
      to_char(p_amount, 'FM999,999,990.00');
  end if;

  v_n := public.next_counter('payment');

  insert into public.payments (
    payment_no, contract_id, payment_date, amount,
    receipt_no, receipt_type, reference_no, recorded_by
  ) values (
    'PAY' || lpad(v_n::text, 4, '0'),
    p_contract_id, p_payment_date, p_amount,
    nullif(trim(p_receipt_no), ''), nullif(trim(p_receipt_type), ''),
    nullif(trim(coalesce(p_reference_no, '')), ''), auth.uid()
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 2. close_contract: stop failing silently
-- ──────────────────────────────────────────────────────────────
-- The old body was a bare UPDATE with no WHERE guard beyond the id, so closing
-- a contract that does not exist, or one already closed, reported success and
-- did nothing. That mattered more once section 1 made 'closed' a state that
-- blocks payments.
--
-- Closing with a balance outstanding stays allowed on purpose: a write-off, a
-- settlement, or a repossession under the Recto Law all end a contract with
-- money still on the books. This only makes the outcome honest.
create or replace function public.close_contract(p_contract_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can close contracts';
  end if;

  update public.contracts
  set payment_status = 'closed'
  where id = p_contract_id
    and payment_status = 'open';

  if not found then
    raise exception 'Contract not found or already closed';
  end if;
end;
$$;
