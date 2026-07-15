-- Restore a mistakenly voided payment (owner only, mirrors void_payment).
create or replace function public.unvoid_payment(p_payment_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_owner() then
    raise exception 'Only the owner can restore payments';
  end if;

  update public.payments
  set voided_at = null, voided_by = null, void_reason = null
  where id = p_payment_id and voided_at is not null;

  if not found then
    raise exception 'Payment not found or not voided';
  end if;
end;
$$;
