-- ──────────────────────────────────────────────────────────────
-- 0043: a declared sale that maps to no single contract
--
-- 0041 made bir_sales_entries.contract_id NOT NULL, on the reasonable rule
-- that a sale in the book is a sale in the app. The reconciliation found the
-- exception.
--
-- Furniture invoice 32, 2024-12-12, LGU - San Ricardo, ₱312,333.65. The app
-- holds that same real transaction as TWO contracts — 30240 (₱284,040, 18
-- office tables with chairs) and 30241 (₱64,380, 6 long benches), ₱348,420
-- together. One invoice, two contracts, and an amount matching neither of them
-- nor their sum.
--
-- The alternative was to invent a third contract for ₱312,333.65 so the entry
-- had something to point at. Ryan rejected that, correctly: it would have
-- double-counted ₱312,333.65 of real sales, raised a phantom ₱312k receivable
-- that the collections screens would chase, and enqueued a delivery for
-- furniture that was delivered two years ago. A tax record should not be able
-- to conjure operational work.
--
-- So contract_id becomes nullable, and a standalone entry carries its own
-- customer, address, item and amount — all of which the table already
-- snapshots, precisely so a filed return never depends on live data.
--
-- The one-booking-per-contract index is unaffected: Postgres treats NULLs as
-- distinct in a unique index, so any number of standalone entries coexist while
-- a real contract still cannot be booked twice.
-- ──────────────────────────────────────────────────────────────

alter table public.bir_sales_entries
  alter column contract_id drop not null;

comment on column public.bir_sales_entries.contract_id is
  'The contract this declared sale belongs to. NULLABLE since 0043: an invoice '
  'can cover several contracts at an amount matching none of them (the LGU - '
  'San Ricardo sale), and inventing a contract to satisfy the foreign key would '
  'double-count sales and raise a receivable that does not exist. A null here '
  'means the entry stands on its own snapshots.';

-- ── Booking a sale with no contract behind it ─────────────────
-- Deliberately a SEPARATE function rather than nullable arguments on
-- book_sale. book_sale's whole value is that it derives the amount, the branch
-- and the customer FROM the contract so a caller cannot get them wrong; this
-- one must accept all of them, and blurring the two would weaken the guarantee
-- on the common path for the sake of the rare one.
create or replace function public.book_standalone_sale(
  p_invoice_no text,
  p_sales_date date,
  p_branch text,
  p_gross numeric,
  p_customer_name text,
  p_customer_address text default null,
  p_item text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_vatable numeric;
  v_output numeric;
  v_invoice text;
  v_name text;
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

  if p_branch not in ('appliances', 'furniture') then
    raise exception 'Branch must be appliances or furniture';
  end if;

  if coalesce(p_gross, 0) <= 0 then
    raise exception 'The invoice amount must be greater than zero';
  end if;

  -- The same split as every other figure in this module, from the one
  -- definition rather than a second copy.
  select vatable, input_tax into v_vatable, v_output
  from public.bir_split(p_gross);

  insert into public.bir_sales_entries (
    contract_id, invoice_no, sales_date, branch,
    gross_snapshot, vatable_sales, vat_output_tax,
    customer_name_snapshot, customer_address_snapshot, item_snapshot,
    period_key, note, booked_by
  ) values (
    null, v_invoice, p_sales_date, p_branch,
    p_gross, v_vatable, v_output,
    v_name,
    nullif(btrim(coalesce(p_customer_address, '')), ''),
    nullif(btrim(coalesce(p_item, '')), ''),
    to_char(p_sales_date, 'FMMMYYYY'),
    nullif(btrim(coalesce(p_note, '')), ''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.book_standalone_sale(text, date, text, numeric, text, text, text, text) from public, anon;
grant execute on function public.book_standalone_sale(text, date, text, numeric, text, text, text, text) to authenticated;

comment on function public.book_standalone_sale(text, date, text, numeric, text, text, text, text) is
  'Records a declared sale that maps to no single contract. Everything is '
  'supplied by the caller because there is no contract to read it from — which '
  'is exactly why book_sale, where the contract IS the source of truth, stays '
  'separate.';
