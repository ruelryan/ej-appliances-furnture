-- ──────────────────────────────────────────────────────────────
-- 0039: the BIR books, and a bookkeeper who can see only those
--
-- E & J is VAT-registered and keeps its tax books in Google Sheets: a monthly
-- Subsidiary Purchase Journal sent to the bookkeeper, and a Sales Journal built
-- by hand. Nothing in the app knows they exist, so they drift from the database
-- the same way the old Sheet did before the 2026-07 cutover. This migration
-- brings the EXPENSE side in and adds the role that reads it.
--
-- ── The dangerous part is not the new table, it is the new role ──
--
-- is_active_user() (0001:46) is ROLE-BLIND: `where id = auth.uid() and active`.
-- It backs SIXTY policies. A `bookkeeper` profile would therefore have been
-- handed read access to contracts, customers, payments and products the instant
-- the account was switched on — the exact opposite of what the role is for.
--
-- The fix changes the one function rather than sixty policies, because sixty
-- edits is sixty chances to miss one. `is_active_user()` now means "an active
-- user who is not a bookkeeper". No existing policy was ever written with a
-- bookkeeper in mind, so nothing changes for the other five roles.
--
-- TWO policies must then be widened by hand, and both are load-bearing:
--
--   profiles_select  (0001:427) — reads through is_active_user(), so without
--     this a bookkeeper cannot read their OWN profile row. getProfile() would
--     return null and middleware would bounce them to /login forever: the
--     account would be unusable, not merely restricted.
--   suppliers_select (0014:278) — the purchase journal is a list of supplier
--     documents. A bookkeeper who cannot see suppliers cannot read the book.
--
-- If a future role should also be walled off, add it to is_active_user() and
-- re-check exactly these two policies.
-- ──────────────────────────────────────────────────────────────

-- ── 1. The role ───────────────────────────────────────────────
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('owner', 'admin', 'collector', 'sales_agent', 'delivery', 'staff', 'bookkeeper'));

-- tasks deliberately does NOT gain 'bookkeeper'. tasks_select (0017:227) runs
-- through is_active_user(), which this migration excludes the role from, so a
-- task assigned to that team would be invisible to the only people meant to
-- act on it. Widening tasks is a decision for the day someone needs it.

-- ── 2. Confinement ────────────────────────────────────────────
-- Same shape as before plus one predicate. Deliberately NOT renamed: renaming
-- would mean touching all sixty call sites, which is the risk this avoids.
create or replace function public.is_active_user()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role <> 'bookkeeper'
  );
$$;

comment on function public.is_active_user() is
  'An active user who is NOT a bookkeeper. That exclusion is what confines the '
  'bookkeeper role to the BIR module: this function backs ~60 policies and is '
  'otherwise role-blind. See 0039. profiles_select and suppliers_select are '
  'widened alongside it - a bookkeeper still needs their own profile row and '
  'the supplier list.';

create or replace function public.is_bookkeeper()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'bookkeeper' and active
  );
$$;

-- Read the BIR books: owner, admin, bookkeeper.
create or replace function public.can_see_bir()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active
      and role in ('owner', 'admin', 'bookkeeper')
  );
$$;

-- Write them: owner and admin only. The bookkeeper receives the book, they do
-- not keep it - that is Ryan's and Analyn's job (decided 2026-08-31).
create or replace function public.can_manage_bir()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and role in ('owner', 'admin')
  );
$$;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (public.is_active_user() or id = auth.uid());

drop policy if exists suppliers_select on public.suppliers;
create policy suppliers_select on public.suppliers
  for select using (public.is_active_user() or public.can_see_bir());

-- ── 3. Suppliers gain their BIR identity ──────────────────────
-- Extended rather than duplicated: the purchase journal names the same vendors
-- the delivery module already orders from (RL Appliance, DES Marketing), and a
-- second supplier list would drift from the first.
alter table public.suppliers
  add column if not exists tin text,
  add column if not exists vat_registered boolean not null default false,
  add column if not exists bir_name text;

comment on column public.suppliers.tin is
  'VAT REG NO./TIN as printed on the supplier document. Free text on purpose - '
  'the real values in the sheet run 12, 14 and 17 characters.';
comment on column public.suppliers.vat_registered is
  'Whether input tax may be claimed against this supplier at all.';
comment on column public.suppliers.bir_name is
  'Registered name when it differs from the trading name we know them by.';

-- ── 4. The purchase journal ───────────────────────────────────
create table if not exists public.bir_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null,
  supplier_id uuid references public.suppliers (id),
  -- Frozen like every other money record here: a supplier rename must not
  -- rewrite a book that has already been filed.
  supplier_name_snapshot text not null,
  doc_type text not null check (doc_type in ('sales_invoice', 'official_receipt', 'none')),
  doc_no text,
  gross_vat numeric(12,2) not null default 0 check (gross_vat >= 0),
  gross_non_vat numeric(12,2) not null default 0 check (gross_non_vat >= 0),
  vatable_purchases numeric(12,2) not null default 0,
  vat_input_tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  category text not null check (category in (
    'ASSET', 'AMORTIZATION', 'BAD DEBTS', 'CHARITABLE AND OTHERS',
    'COST OF SALES', 'DEPRECIATION', 'ENTERTAINMENT AND AMUSEMENT',
    'MAINTENANCE EXPENSES', 'MEALS AND REPRESENTATION', 'MISCELLANEOUS',
    'OFFICE EQUIPMENT', 'OFFICE SUPPLIES', 'OFFICIAL RECEIPTS',
    'PROFESSIONAL FEE', 'PURCHASES', 'RENTALS',
    'SALARIES WAGES AND ALLOWANCE', 'SSS GSIS PHILHEALTH',
    'TAXES AND LICENSES (2551/2550)', 'TRANSPORTATION AND TRAVEL',
    'UTILITIES LIGHTS AND WATER'
  )),
  -- E & J holds TWO VAT registrations on one base TIN: 437-961-107-00000
  -- (E & J Appliances Store) and -00001 (E & J Furniture Store). They file
  -- separately, so input tax has to be attributable. The sales side already
  -- splits this way -- the Sales Journal keeps Appliances and Furniture as
  -- separate monthly columns, and contracts.item_type carries the same two
  -- values (0003). 'shared' is for overhead that belongs to neither on its own
  -- (salaries, fuel, utilities); allocating it is a judgement for the
  -- bookkeeper, so the app records the fact and does not invent a split.
  branch text not null default 'shared'
    check (branch in ('appliances', 'furniture', 'shared')),
  period_key text not null,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references public.profiles (id),
  void_reason text,
  constraint bir_expenses_has_amount check (gross_vat > 0 or gross_non_vat > 0)
);

comment on table public.bir_expenses is
  'BIR Subsidiary Purchase Journal, one row per supplier document. Voided, '
  'never deleted - same rule as payments. The sheet this replaces is the '
  'Expenses tab of the General workbook; OFFICE SUPPLES there is spelled '
  'OFFICE SUPPLIES here, which any importer must map.';

comment on column public.bir_expenses.period_key is
  'MMYYYY with no leading zero (July 2021 -> "72021"), matching the sheet so '
  'the export drops straight into the workbook. Derived from expense_date by '
  'the RPCs, never set by hand.';

create index if not exists bir_expenses_date_idx on public.bir_expenses (expense_date desc);
create index if not exists bir_expenses_period_idx on public.bir_expenses (period_key);
create index if not exists bir_expenses_supplier_idx on public.bir_expenses (supplier_id);
create index if not exists bir_expenses_category_idx on public.bir_expenses (category);
create index if not exists bir_expenses_branch_idx on public.bir_expenses (branch);

alter table public.bir_expenses enable row level security;

create policy bir_expenses_select on public.bir_expenses
  for select using (public.can_see_bir());
create policy bir_expenses_insert on public.bir_expenses
  for insert with check (public.can_manage_bir());
create policy bir_expenses_update on public.bir_expenses
  for update using (public.can_manage_bir());
-- No delete policy at all. Voiding is the only way out.

create trigger bir_expenses_touch
  before update on public.bir_expenses
  for each row execute function public.touch_updated_at();

-- after update only, like every other audit trigger here: the INSERT is not
-- audited, so a row that is created and then voided leaves ONE entry.
create trigger bir_expenses_audit
  after update on public.bir_expenses
  for each row execute function public.audit_row_changes();

-- ── 5. Write paths ────────────────────────────────────────────
-- The VAT split lives here and nowhere else, mirroring the rule that put
-- compute_terms() in one place. It reproduces the sheet to the centavo:
-- 2,015.10 gross -> 1,799.20 vatable + 215.90 input tax.
create or replace function public.bir_split(p_gross_vat numeric)
returns table (vatable numeric, input_tax numeric)
language sql immutable
as $$
  select round(p_gross_vat / 1.12, 2),
         p_gross_vat - round(p_gross_vat / 1.12, 2);
$$;

create or replace function public.record_bir_expense(
  p_expense_date date,
  p_supplier_id uuid,
  p_supplier_name text,
  p_doc_type text,
  p_doc_no text,
  p_gross_vat numeric,
  p_gross_non_vat numeric,
  p_category text,
  p_branch text default 'shared',
  p_note text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_vatable numeric;
  v_input numeric;
  v_name text;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can record BIR expenses';
  end if;

  select vatable, input_tax into v_vatable, v_input
  from public.bir_split(coalesce(p_gross_vat, 0));

  -- Snapshot the name we were given, or the supplier's current one.
  v_name := nullif(btrim(coalesce(p_supplier_name, '')), '');
  if v_name is null and p_supplier_id is not null then
    select coalesce(bir_name, name) into v_name
    from public.suppliers where id = p_supplier_id;
  end if;
  if v_name is null then
    raise exception 'A supplier name is required';
  end if;

  insert into public.bir_expenses (
    expense_date, supplier_id, supplier_name_snapshot, doc_type, doc_no,
    gross_vat, gross_non_vat, vatable_purchases, vat_input_tax, total,
    category, branch, period_key, note, created_by
  ) values (
    p_expense_date, p_supplier_id, v_name, p_doc_type,
    nullif(btrim(coalesce(p_doc_no, '')), ''),
    coalesce(p_gross_vat, 0), coalesce(p_gross_non_vat, 0),
    v_vatable, v_input, coalesce(p_gross_vat, 0) + coalesce(p_gross_non_vat, 0),
    p_category, coalesce(p_branch, 'shared'), to_char(p_expense_date, 'FMMMYYYY'),
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.update_bir_expense(
  p_id uuid,
  p_expense_date date,
  p_supplier_id uuid,
  p_supplier_name text,
  p_doc_type text,
  p_doc_no text,
  p_gross_vat numeric,
  p_gross_non_vat numeric,
  p_category text,
  p_branch text default 'shared',
  p_note text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_vatable numeric;
  v_input numeric;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can edit BIR expenses';
  end if;

  select vatable, input_tax into v_vatable, v_input
  from public.bir_split(coalesce(p_gross_vat, 0));

  -- The predicate is in the WHERE, not in a prior SELECT: read-then-write is
  -- the house bug (it produced the post_collection_entry double-post).
  update public.bir_expenses
  set expense_date = p_expense_date,
      supplier_id = p_supplier_id,
      supplier_name_snapshot = coalesce(
        nullif(btrim(coalesce(p_supplier_name, '')), ''), supplier_name_snapshot),
      doc_type = p_doc_type,
      doc_no = nullif(btrim(coalesce(p_doc_no, '')), ''),
      gross_vat = coalesce(p_gross_vat, 0),
      gross_non_vat = coalesce(p_gross_non_vat, 0),
      vatable_purchases = v_vatable,
      vat_input_tax = v_input,
      total = coalesce(p_gross_vat, 0) + coalesce(p_gross_non_vat, 0),
      category = p_category,
      branch = coalesce(p_branch, 'shared'),
      period_key = to_char(p_expense_date, 'FMMMYYYY'),
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id
    and voided_at is null;

  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end;
$$;

create or replace function public.void_bir_expense(p_id uuid, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can void a BIR expense';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'A reason is required to void an expense';
  end if;

  update public.bir_expenses
  set voided_at = now(), voided_by = auth.uid(), void_reason = btrim(p_reason)
  where id = p_id
    and voided_at is null;

  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end;
$$;

create or replace function public.upsert_bir_supplier(
  p_id uuid,
  p_name text,
  p_address text,
  p_tin text,
  p_vat_registered boolean,
  p_bir_name text default null
)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.can_manage_bir() then
    raise exception 'Only the owner or an admin can manage suppliers';
  end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then
    raise exception 'A supplier name is required';
  end if;

  if p_id is null then
    insert into public.suppliers (name, address, tin, vat_registered, bir_name)
    values (btrim(p_name),
            nullif(btrim(coalesce(p_address, '')), ''),
            nullif(btrim(coalesce(p_tin, '')), ''),
            coalesce(p_vat_registered, false),
            nullif(btrim(coalesce(p_bir_name, '')), ''))
    returning id into v_id;
    return v_id;
  end if;

  update public.suppliers
  set name = btrim(p_name),
      address = nullif(btrim(coalesce(p_address, '')), ''),
      tin = nullif(btrim(coalesce(p_tin, '')), ''),
      vat_registered = coalesce(p_vat_registered, false),
      bir_name = nullif(btrim(coalesce(p_bir_name, '')), '')
  where id = p_id;

  if not found then
    raise exception 'Supplier not found';
  end if;
  return p_id;
end;
$$;

-- EXECUTE is granted to PUBLIC by default (the 0029 lesson). Each function
-- checks the caller, but defence in depth costs a few lines.
revoke execute on function public.record_bir_expense(date, uuid, text, text, text, numeric, numeric, text, text, text) from public, anon;
revoke execute on function public.update_bir_expense(uuid, date, uuid, text, text, text, numeric, numeric, text, text, text) from public, anon;
revoke execute on function public.void_bir_expense(uuid, text) from public, anon;
revoke execute on function public.upsert_bir_supplier(uuid, text, text, text, boolean, text) from public, anon;

grant execute on function public.record_bir_expense(date, uuid, text, text, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.update_bir_expense(uuid, date, uuid, text, text, text, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.void_bir_expense(uuid, text) to authenticated;
grant execute on function public.upsert_bir_supplier(uuid, text, text, text, boolean, text) to authenticated;
