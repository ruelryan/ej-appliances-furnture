-- ──────────────────────────────────────────────────────────────
-- 0045: the two columns the paper book has and the table did not
--
-- The office checks the app against the bookkeeper's "Sales - Appliances" tab
-- line by line, so /bir/sales now renders the journal's own column order. Of
-- its twenty columns, six are blank in every row ever written (F, VAT REG.
-- NO., EXEMPTED, ZERO-RATED, LOCAL, SERVICE) and two were not recorded
-- anywhere in the app:
--
--   QUANTITY       — always 1 in the book so far, but a sale of two of the
--                    same item is an ordinary thing and guessing 1 would put a
--                    wrong figure in a filed return.
--   TYPE OF SALES  — Private or Government. A government buyer withholds VAT,
--                    so this is not cosmetic. The book has one: Inopacan
--                    National High School, 2024-03-06, 28,300.
--
-- Both are SNAPSHOTS, like every other figure on this table. Neither is
-- derived from the contract, because neither is knowable from it.
--
-- The TERMS columns need no storage: every row of the book puts the whole
-- invoice under CASH and leaves ACCOUNT empty — the bookkeeper's instruction
-- is to treat all sales as cash (Ryan, 2026-09-23) even though most are
-- installment contracts. That convention lives in the ledger's rendering and
-- in `ledgerTotals`, not in a column, so changing it can never disagree with
-- what has already been filed.
-- ──────────────────────────────────────────────────────────────

alter table public.bir_sales_entries
  add column if not exists quantity integer not null default 1,
  add column if not exists sale_type text not null default 'Private';

do $mig$
begin
  alter table public.bir_sales_entries
    add constraint bir_sales_quantity_positive check (quantity > 0);
exception when duplicate_object then null;
end $mig$;

do $mig$
begin
  alter table public.bir_sales_entries
    add constraint bir_sales_type_known check (sale_type in ('Private', 'Government'));
exception when duplicate_object then null;
end $mig$;

comment on column public.bir_sales_entries.quantity is
  'QUANTITY, from the paper book. Snapshotted: the contract carries a free-text '
  'item description and no count, so this cannot be derived.';

comment on column public.bir_sales_entries.sale_type is
  'TYPE OF SALES, from the paper book: Private or Government. A government '
  'buyer withholds VAT, so a guessed Private is a wrong figure in a filed '
  'return, not a cosmetic default.';

-- ── Booking, with the two new fields ──────────────────────────
-- DROP first, never `create or replace`. A changed argument list makes an
-- OVERLOAD rather than a replacement, and PostgREST then resolves rpc() calls
-- ambiguously — the 0010 and 0021 lesson.
--
-- Both new arguments carry defaults and p_note keeps its position, so the
-- four-argument call in the currently deployed code still resolves to this
-- function. That is what makes it safe to apply this migration BEFORE the code
-- that uses it, which is the required order here: Vercel deploys main by
-- itself, so a push can reach production before its migration does.
drop function if exists public.book_sale(uuid, text, date, text);

create function public.book_sale(
  p_contract_id uuid,
  p_invoice_no text,
  p_sales_date date,
  p_note text default null,
  p_sale_type text default 'Private',
  p_quantity integer default 1
)
returns uuid
language plpgsql
security definer set search_path = public
as $fn$
declare
  v_id uuid;
  v_c record;
  v_branch text;
  v_vatable numeric;
  v_output numeric;
  v_invoice text;
  v_type text;
  v_qty integer;
  v_delivery text;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can enter a sale in the book';
  end if;

  v_invoice := nullif(btrim(coalesce(p_invoice_no, '')), '');
  if v_invoice is null then
    raise exception 'The invoice number from the booklet is required';
  end if;

  v_type := coalesce(nullif(btrim(coalesce(p_sale_type, '')), ''), 'Private');
  if v_type not in ('Private', 'Government') then
    raise exception 'Type of sales must be Private or Government';
  end if;

  v_qty := coalesce(p_quantity, 1);
  if v_qty < 1 then
    raise exception 'Quantity must be at least 1';
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

  -- Only a delivered item is a sale (0044). Re-stated verbatim because this
  -- function is being recreated, not replaced: the drop would otherwise take
  -- the guard with it. `order by … limit 1` rather than a bare select —
  -- deliveries has no unique constraint on contract_id, so a duplicate row
  -- would raise "more than one row returned" instead of booking.
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

  -- The same 12% split as the purchase side, from the one definition rather
  -- than a second copy.
  select vatable, input_tax into v_vatable, v_output
  from public.bir_split(v_c.cash_price);

  insert into public.bir_sales_entries (
    contract_id, invoice_no, sales_date, branch,
    gross_snapshot, vatable_sales, vat_output_tax,
    customer_name_snapshot, customer_address_snapshot, item_snapshot,
    quantity, sale_type,
    period_key, note, booked_by
  ) values (
    p_contract_id, v_invoice, p_sales_date, v_branch,
    v_c.cash_price, v_vatable, v_output,
    v_c.display_name, v_c.addr, v_c.item_description,
    v_qty, v_type,
    to_char(p_sales_date, 'FMMMYYYY'), nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
exception
  -- The unique indexes are the real guard; translate them into something a
  -- person can act on rather than a raw constraint name.
  when unique_violation then
    if sqlerrm like '%bir_sales_one_per_contract%' then
      raise exception 'That contract is already in the sales book';
    elsif sqlerrm like '%bir_sales_invoice_per_branch%' then
      raise exception 'Invoice % is already used in the % book', v_invoice, v_branch;
    else
      raise;
    end if;
end;
$fn$;

drop function if exists public.book_standalone_sale(text, date, text, numeric, text, text, text, text);

create function public.book_standalone_sale(
  p_invoice_no text,
  p_sales_date date,
  p_branch text,
  p_gross numeric,
  p_customer_name text,
  p_customer_address text default null,
  p_item text default null,
  p_note text default null,
  p_sale_type text default 'Private',
  p_quantity integer default 1
)
returns uuid
language plpgsql
security definer set search_path = public
as $fn$
declare
  v_id uuid;
  v_vatable numeric;
  v_output numeric;
  v_invoice text;
  v_name text;
  v_branch text;
  v_type text;
  v_qty integer;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can enter a sale in the book';
  end if;

  v_invoice := nullif(btrim(coalesce(p_invoice_no, '')), '');
  if v_invoice is null then
    raise exception 'The invoice number from the booklet is required';
  end if;

  v_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  if v_name is null then
    raise exception 'A customer name is required';
  end if;

  if coalesce(p_gross, 0) <= 0 then
    raise exception 'The invoice amount is required';
  end if;

  v_branch := case p_branch when 'furniture' then 'furniture' else 'appliances' end;

  v_type := coalesce(nullif(btrim(coalesce(p_sale_type, '')), ''), 'Private');
  if v_type not in ('Private', 'Government') then
    raise exception 'Type of sales must be Private or Government';
  end if;

  v_qty := coalesce(p_quantity, 1);
  if v_qty < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  select vatable, input_tax into v_vatable, v_output
  from public.bir_split(p_gross);

  insert into public.bir_sales_entries (
    contract_id, invoice_no, sales_date, branch,
    gross_snapshot, vatable_sales, vat_output_tax,
    customer_name_snapshot, customer_address_snapshot, item_snapshot,
    quantity, sale_type,
    period_key, note, booked_by
  ) values (
    null, v_invoice, p_sales_date, v_branch,
    p_gross, v_vatable, v_output,
    v_name, nullif(btrim(coalesce(p_customer_address, '')), ''),
            nullif(btrim(coalesce(p_item, '')), ''),
    v_qty, v_type,
    to_char(p_sales_date, 'FMMMYYYY'), nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    if sqlerrm like '%bir_sales_invoice_per_branch%' then
      raise exception 'Invoice % is already used in the % book', v_invoice, v_branch;
    else
      raise;
    end if;
end;
$fn$;

-- ── Correcting the two typed fields ───────────────────────────
-- Without this the only way to fix a wrong Type of sales is to cancel the
-- entry and book it again. On an entry that has already been filed that is
-- worse than an edit: it moves booked_at, and the audit trail then reads as a
-- re-declaration of the sale rather than a correction of one field. Nothing
-- that affects an amount is editable here — the money columns stay derived
-- from the contract at booking, which is the property 0041 exists to protect.
create or replace function public.update_sale_entry_details(
  p_id uuid,
  p_sale_type text,
  p_quantity integer
)
returns void
language plpgsql
security definer set search_path = public
as $fn$
declare
  v_type text;
  v_qty integer;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can correct a sales entry';
  end if;

  v_type := coalesce(nullif(btrim(coalesce(p_sale_type, '')), ''), 'Private');
  if v_type not in ('Private', 'Government') then
    raise exception 'Type of sales must be Private or Government';
  end if;

  v_qty := coalesce(p_quantity, 1);
  if v_qty < 1 then
    raise exception 'Quantity must be at least 1';
  end if;

  -- Predicate in the WHERE, never read-then-check-then-write (the 0031 rule).
  update public.bir_sales_entries
  set sale_type = v_type, quantity = v_qty
  where id = p_id
    and cancelled_at is null;

  if not found then
    raise exception 'Sales entry not found or already cancelled';
  end if;
end;
$fn$;

comment on function public.book_sale(uuid, text, date, text, text, integer) is
  'Owner or admin. Enters a contract in the sales book at its cash_price. '
  'Refuses a contract whose delivery is not `delivered` (0044). Since 0045 it '
  'also snapshots QUANTITY and TYPE OF SALES, the two paper-book columns the '
  'contract cannot supply.';

comment on function public.update_sale_entry_details(uuid, text, integer) is
  'Owner or admin. Corrects the two TYPED columns of a live sales entry — '
  'quantity and Private/Government — and nothing else. Amounts are never '
  'editable: they are derived from the contract at booking.';

revoke execute on function public.book_sale(uuid, text, date, text, text, integer) from public, anon;
revoke execute on function public.book_standalone_sale(text, date, text, numeric, text, text, text, text, text, integer) from public, anon;
revoke execute on function public.update_sale_entry_details(uuid, text, integer) from public, anon;
grant execute on function public.book_sale(uuid, text, date, text, text, integer) to authenticated;
grant execute on function public.book_standalone_sale(text, date, text, numeric, text, text, text, text, text, integer) to authenticated;
grant execute on function public.update_sale_entry_details(uuid, text, integer) to authenticated;
