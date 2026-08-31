-- ──────────────────────────────────────────────────────────────
-- 0042: an invoice number is not unique, and the data says so
--
-- 0041 put a unique index on (branch, invoice_no), on the reasonable-sounding
-- assumption that a number in a BIR-registered booklet is spent once. The
-- historical import disproved it within hours: 28 numbers in the Contracts
-- Database are used by two contracts each, in two different and both
-- legitimate ways.
--
-- ONE INVOICE, TWO CONTRACTS. Jamila, Lorna on 2023-11-20 has OR 2507 against
-- both a Fujidenzo cooking range (19,900) and a TCL aircon (29,600). Same
-- customer, same day, one receipt, two contracts because the app models one
-- item per contract. Montanes, Allen Joy is the same shape on 2023-09-12.
--
-- BOOKLETS RECYCLE. Furniture OR 69 is Celeste in October 2023 and Ples in
-- September 2025. The old booklets carry short numbers (65, 69, 70, 71) that
-- start again when a new one is issued, so the same digits two years apart are
-- two different invoices. 399 of the 429 declared sales use those short
-- numbers; only 30 use the long 2024 series (230140005451…).
--
-- So uniqueness of the invoice number is not an invariant of this business,
-- and a constraint the real history violates is a constraint that blocks
-- legitimate work. It is dropped.
--
-- What IS invariant, and stays: ONE BOOKING PER CONTRACT. A contract is
-- declared once or not at all. That is the rule that actually prevents
-- declaring the same sale twice, and it is untouched.
--
-- A repeated number is still worth seeing — it is the shape of a typo as well
-- as of a two-item sale — so it becomes a visible warning on the page and in
-- the importer's report rather than a refusal from the database.
-- ──────────────────────────────────────────────────────────────

drop index if exists public.bir_sales_invoice_per_branch;

-- Kept non-unique: the sales page and the importer both look numbers up to
-- warn about repeats, and the export orders by them.
create index if not exists bir_sales_invoice_idx
  on public.bir_sales_entries (branch, invoice_no);

comment on column public.bir_sales_entries.invoice_no is
  'The number typed from the BIR-registered booklet. NOT unique, deliberately: '
  'one receipt can cover two contracts (same customer, same day, two items), '
  'and short booklet numbers recycle when a new booklet is issued. The invariant '
  'is one booking per contract, held by bir_sales_one_per_contract. A repeat is '
  'surfaced as a warning, not refused. See 0042.';

-- book_sale no longer needs to translate that unique violation. Same body
-- otherwise; the argument list is unchanged, so this replaces rather than
-- overloads (an overload is what makes PostgREST resolve rpc() ambiguously).
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
    -- Only one unique index remains, and it is the invariant that matters.
    raise exception 'That contract is already in the sales book';
end;
$$;
