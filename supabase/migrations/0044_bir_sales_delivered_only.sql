-- ──────────────────────────────────────────────────────────────
-- 0044: only a delivered item counts as a sale
--
-- Ryan asked what happens to the record when a contract is closed because the
-- sale was cancelled, then answered it himself (2026-09-01): "only the items
-- verified as delivered will be counted on sales."
--
-- That rule is better than the alternatives and it settles the tax question:
--
--   A CANCELLED sale is never delivered, so it never enters the book at all.
--   Nothing to reverse, no credit note, no amended return.
--
--   A DELIVERED sale that later goes bad is a different thing. The sale
--   happened and stays declared; the unpaid balance is bad debt, which is an
--   income-tax matter rather than a VAT reversal.
--
-- Note what this does NOT key on: payment_status. Closing a contract means both
-- "paid off" and "written off" here — 389 closed contracts still carry a
-- balance, 44 of them declared — so it says nothing about whether a sale
-- happened. The DELIVERY is what expresses cancellation.
--
-- deliveries.status has been the source of truth since 0014; the legacy
-- contracts.delivery_status text is a trigger-derived label and is not used.
-- ──────────────────────────────────────────────────────────────

-- ── 1. The register carries the delivery status ───────────────
-- Appended at the END of the column list. `create or replace` on a view fails
-- with "cannot change name of view column" if a column is spliced into the
-- middle — the trap that bit 0020, 0023 and 0028.
--
-- Joined LATERAL rather than plainly: deliveries has no unique constraint on
-- contract_id, and a duplicate row would otherwise multiply register rows.
-- Every contract has exactly one today; this makes that not matter.
--
-- The view is security_invoker and now reads deliveries, whose select policy
-- wants an operational role. That is fine — only owner and admin read the
-- register, because /bir/sales gives the bookkeeper bir_sales_entries instead
-- (0039 walls them out of contracts anyway) — but it does narrow who this view
-- works for, so it is worth saying out loud.
create or replace view public.v_bir_sales_register
with (security_invoker = true)
as
select
  c.id                        as contract_id,
  c.contract_no,
  c.contract_date,
  c.item_description,
  c.item_type,
  c.cash_price,
  c.total_price,
  c.term_months,
  c.payment_status,
  cu.display_name             as customer_name,
  coalesce(
    nullif(concat_ws(', ',
      nullif(btrim(coalesce(cu.street_purok, '')), ''),
      nullif(btrim(coalesce(cu.barangay, '')), ''),
      nullif(btrim(coalesce(cu.municipality, '')), ''),
      nullif(btrim(coalesce(cu.province, '')), '')
    ), ''),
    cu.address
  )                           as customer_address,
  case c.item_type
    when 'Appliances' then 'appliances'
    when 'Furniture'  then 'furniture'
    else 'appliances'
  end                         as branch,
  e.id                        as entry_id,
  e.invoice_no,
  e.sales_date,
  e.gross_snapshot,
  e.vatable_sales,
  e.vat_output_tax,
  e.period_key,
  (e.id is not null)          as booked,
  d.status                    as delivery_status
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join public.bir_sales_entries e
  on e.contract_id = c.id and e.cancelled_at is null
left join lateral (
  select dd.status from public.deliveries dd
  where dd.contract_id = c.id
  order by dd.created_at desc
  limit 1
) d on true;

comment on view public.v_bir_sales_register is
  'Every contract, booked or not. The point of the module: an unbooked sale is '
  'visible rather than absent. `branch` is derived from contracts.item_type. '
  '`delivery_status` comes from deliveries (0014, the source of truth) — only a '
  'delivered item may be declared, because a cancelled sale is one that was '
  'never delivered. See 0044.';

-- ── 2. book_sale refuses an undelivered contract ──────────────
-- The RPC is the control; the page only makes it convenient. Same body as 0042
-- with one guard added, and the same argument list, so this replaces rather
-- than overloads (an overload is what makes PostgREST resolve rpc()
-- ambiguously).
--
-- book_standalone_sale is deliberately untouched: it has no contract to check,
-- and the LGU sale it exists for was delivered two years ago.
create or replace function public.book_sale(
  p_contract_id uuid,
  p_invoice_no text,
  p_sales_date date,
  p_note text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_c record;
  v_branch text;
  v_vatable numeric;
  v_output numeric;
  v_invoice text;
  v_delivery text;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can enter a sale in the book';
  end if;

  v_invoice := nullif(btrim(coalesce(p_invoice_no, '')), '');
  if v_invoice is null then
    raise exception 'The invoice number from the booklet is required';
  end if;

  -- Base tables, NOT v_contract_financials: that view is security_invoker and
  -- would re-enter RLS from inside a definer function.
  select c.id, c.cash_price, c.item_type, c.item_description,
         cu.display_name,
         coalesce(
           nullif(concat_ws(', ',
             nullif(btrim(coalesce(cu.street_purok, '')), ''),
             nullif(btrim(coalesce(cu.barangay, '')), ''),
             nullif(btrim(coalesce(cu.municipality, '')), ''),
             nullif(btrim(coalesce(cu.province, '')), '')
           ), ''),
           cu.address
         ) as addr
    into v_c
  from public.contracts c
  join public.customers cu on cu.id = c.customer_id
  where c.id = p_contract_id;

  if not found then
    raise exception 'Contract not found';
  end if;

  -- Only a delivered item is a sale. A cancelled one never gets here.
  select dd.status into v_delivery
  from public.deliveries dd
  where dd.contract_id = p_contract_id
  order by dd.created_at desc
  limit 1;

  if coalesce(v_delivery, 'missing') <> 'delivered' then
    raise exception
      'This item is not delivered yet (delivery is %). Only delivered items are declared as sales.',
      coalesce(v_delivery, 'not recorded');
  end if;

  v_branch := case v_c.item_type
                when 'Furniture' then 'furniture'
                else 'appliances'
              end;

  select vatable, input_tax into v_vatable, v_output
  from public.bir_split(v_c.cash_price);

  insert into public.bir_sales_entries (
    contract_id, invoice_no, sales_date, branch,
    gross_snapshot, vatable_sales, vat_output_tax,
    customer_name_snapshot, customer_address_snapshot, item_snapshot,
    period_key, note, booked_by
  ) values (
    p_contract_id, v_invoice, p_sales_date, v_branch,
    v_c.cash_price, v_vatable, v_output,
    v_c.display_name, v_c.addr, v_c.item_description,
    to_char(p_sales_date, 'FMMMYYYY'), nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'That contract is already in the sales book';
end;
$$;

comment on function public.book_sale(uuid, text, date, text) is
  'Owner or admin. Enters a contract in the sales book at its cash_price. '
  'Refuses a contract whose delivery is not `delivered` (0044): a cancelled '
  'sale is one that was never delivered, so it never enters the book and needs '
  'no credit note.';
