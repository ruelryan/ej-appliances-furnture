-- ──────────────────────────────────────────────────────────────
-- 0041: the sales book
--
-- The other half of the BIR module. 0039 brought in the purchase journal;
-- this is the Summary List of Sales that has lived in a spreadsheet, where a
-- contract is picked by hand each working day and copied across.
--
-- Three decisions from Ryan shape it, and none of them is mine to change:
--
-- 1. A sale is booked at the CASH PRICE, as if sold for cash — contracts
--    .cash_price, not total_price. On 4/5-month Good-as-Cash terms the two are
--    identical; they diverge only at 6 months (cash x 1.225) and 12 months
--    (cash x 1.375). It is also the safer column for a filed book, because a
--    term reprice moves total_price but never cash_price (0022) — so a reprice
--    cannot restate a month that has already been declared.
--
-- 2. Each registration has its OWN BIR-registered invoice booklet, so invoice
--    numbers are per-branch sequences, not one shared run.
--
-- 3. The invoice number is ALWAYS TYPED from the paper in front of you. The
--    app neither mints nor suggests it. That is deliberate: id_counters
--    knowing nothing about numbers issued outside it is exactly how contract
--    2026160 collided with a number the Sheet had already spent.
--
-- What the app DOES do is refuse to lose track. Every contract appears in the
-- register as booked or not yet booked, and the period view shows declared
-- against actual. Selection stays a human decision; the consequence of it
-- stops being invisible.
-- ──────────────────────────────────────────────────────────────

create table if not exists public.bir_sales_entries (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  invoice_no text not null,
  -- The date written in the sales book, which is NOT always the contract date:
  -- the book is worked through on working days, and the Sheet shows entries
  -- carrying the day they were recorded.
  sales_date date not null,
  branch text not null check (branch in ('appliances', 'furniture')),

  -- Everything below is SNAPSHOTTED at booking, like every other money record
  -- in this schema. A customer rename, an address correction or a term reprice
  -- must never rewrite a return that has been filed.
  gross_snapshot numeric(12,2) not null,
  vatable_sales numeric(12,2) not null,
  vat_output_tax numeric(12,2) not null,
  customer_name_snapshot text not null,
  customer_address_snapshot text,
  item_snapshot text,

  period_key text not null,
  note text,
  booked_by uuid references public.profiles (id),
  booked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancel_reason text
);

comment on table public.bir_sales_entries is
  'BIR Summary List of Sales, one row per contract entered in the sales book. '
  'Booked at cash_price, never total_price. Cancelled, never deleted. A '
  'contract with no row here is a sale that has not been declared — the '
  'register shows those rather than letting them disappear.';

-- One live booking per contract. Partial so a cancelled mis-entry does not
-- block the corrected one.
create unique index if not exists bir_sales_one_per_contract
  on public.bir_sales_entries (contract_id)
  where cancelled_at is null;

-- An invoice number is unique within its own booklet. A collision is a
-- double-entry, and a constraint is the only thing that can hold an invariant
-- across two rows — a pre-check cannot (the 0031 lesson).
create unique index if not exists bir_sales_invoice_per_branch
  on public.bir_sales_entries (branch, invoice_no)
  where cancelled_at is null;

create index if not exists bir_sales_date_idx on public.bir_sales_entries (sales_date desc);
create index if not exists bir_sales_period_idx on public.bir_sales_entries (period_key);
create index if not exists bir_sales_branch_idx on public.bir_sales_entries (branch);

alter table public.bir_sales_entries enable row level security;

create policy bir_sales_select on public.bir_sales_entries
  for select using (public.can_see_bir());
create policy bir_sales_insert on public.bir_sales_entries
  for insert with check (public.can_manage_bir());
create policy bir_sales_update on public.bir_sales_entries
  for update using (public.can_manage_bir());
-- No delete policy. Cancelling is the only way out.

create trigger bir_sales_touch
  before update on public.bir_sales_entries
  for each row execute function public.touch_updated_at();

create trigger bir_sales_audit
  after update on public.bir_sales_entries
  for each row execute function public.audit_row_changes();

-- ── The register ──────────────────────────────────────────────
-- Every contract, with its booking if it has one. Columns are enumerated by
-- hand rather than `c.*`: a `select c.*` view freezes the column list at
-- creation and then fails to be replaced when the table gains a column, which
-- has bitten this schema in 0020, 0023 and 0028.
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
  (e.id is not null)          as booked
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join public.bir_sales_entries e
  on e.contract_id = c.id and e.cancelled_at is null;

comment on view public.v_bir_sales_register is
  'Every contract, booked or not. The point of the module: an unbooked sale '
  'is visible rather than absent. `branch` is derived from contracts.item_type '
  '(0003 constrains it to Appliances/Furniture, and all 1,544 rows carry one), '
  'so no one tags a sale by hand.';

-- ── Booking ───────────────────────────────────────────────────
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

  -- The same 12% split as the purchase side, from the one definition rather
  -- than a second copy. bir_split's second column is named input_tax because
  -- purchases came first; on a sale that same figure IS the output tax. One
  -- arithmetic, two names, and reusing it is what keeps the two books
  -- consistent to the centavo.
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
$$;

create or replace function public.cancel_sale_entry(p_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can cancel a sales entry';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to cancel a sales entry';
  end if;

  -- Predicate in the WHERE, never a read-then-check-then-write.
  update public.bir_sales_entries
  set cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
  where id = p_id
    and cancelled_at is null;

  if not found then
    raise exception 'Sales entry not found or already cancelled';
  end if;
end;
$$;

revoke execute on function public.book_sale(uuid, text, date, text) from public, anon;
revoke execute on function public.cancel_sale_entry(uuid, text) from public, anon;
grant execute on function public.book_sale(uuid, text, date, text) to authenticated;
grant execute on function public.cancel_sale_entry(uuid, text) to authenticated;
