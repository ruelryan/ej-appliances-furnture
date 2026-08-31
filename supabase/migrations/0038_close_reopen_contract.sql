-- ──────────────────────────────────────────────────────────────
-- 0038: let the office close a paid-off account, and undo a mistake
--
-- close_contract has existed since 0001 and was hardened in 0032, but nothing
-- in the app has ever called it — `grep -rn close_contract src/` returns
-- nothing. There is no button. The only way an account has ever been closed is
-- a hand-written UPDATE, which is how 2026167 and 2026182 came to read "Fully
-- paid" with a balance still on them (see the Sheet reconciliation notes).
--
-- Two changes, both decided by Ryan on 2026-08-31.
--
-- 1. close_contract moves from is_owner() to can_post_payments(), so Analyn
--    can close too. She is the one recording the payments, so she is the one
--    who sees an account reach zero; making every paid-off contract wait for
--    an owner to log in is what left the button unbuilt for a year.
--
--    This DOES hand the write-off to an admin. Closing with a balance
--    outstanding stays legal here — 0032 allowed it deliberately, because a
--    settlement, a write-off and a repossession under the Recto Law all end a
--    contract with money still on the books — and the business rules make
--    writing off bad debt an owner escalation. That tension was put to Ryan
--    explicitly and he chose the simpler permission. The controls that remain
--    are the audit trigger on contracts (0001:186) and the fact that the UI
--    states the exact balance being written off before it will proceed.
--
-- 2. reopen_contract is new, and owner-only. Closing became a one-way door in
--    0032, where record_payment started refusing a closed contract: a mis-click
--    left an account that could take no further payments and no way back
--    except editing the database by hand. The asymmetry is on purpose —
--    closing is routine bookkeeping, reversing someone else's close is not.
--
-- Both write through the predicate rather than reading first, per the house
-- rule in CLAUDE.md: SELECT → check → UPDATE lets two callers both pass under
-- READ COMMITTED. The status is in the WHERE clause and `not found` raises.
-- ──────────────────────────────────────────────────────────────

-- ── 1. close_contract: owner OR admin ─────────────────────────
create or replace function public.close_contract(p_contract_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  -- widened from is_owner() in 0038; see the header for why, and for what it
  -- costs. can_post_payments() is owner + admin, and checks `active`.
  if not public.can_post_payments() then
    raise exception 'Only the owner or an admin can close contracts';
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

-- ── 2. reopen_contract: owner only ────────────────────────────
create or replace function public.reopen_contract(p_contract_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can reopen a contract';
  end if;

  update public.contracts
  set payment_status = 'open'
  where id = p_contract_id
    and payment_status = 'closed';

  if not found then
    raise exception 'Contract not found or already open';
  end if;
end;
$$;

-- EXECUTE is granted to PUBLIC by default (the 0029 lesson), so a new SECURITY
-- DEFINER function is reachable by anyone holding the anon key out of the
-- browser bundle. is_owner() already returns false for anon — auth.uid() is
-- null, so no profiles row matches — but defence in depth is one line.
revoke execute on function public.reopen_contract(uuid) from public, anon;
grant execute on function public.reopen_contract(uuid) to authenticated;

comment on function public.close_contract(uuid) is
  'Owner or admin. Marks a contract closed; record_payment then refuses it '
  '(0032). Closing with a balance outstanding is allowed on purpose — a '
  'write-off, a settlement or a repossession all end a contract with money '
  'still owed. Note that v_contract_financials lets payment_status win the '
  'cascade, so a closed contract reads as "Fully paid" whatever the balance.';

comment on function public.reopen_contract(uuid) is
  'Owner only. Reverses close_contract so payments can be recorded again. '
  'Deliberately narrower than closing: closing is routine bookkeeping, '
  'reversing it is not.';
