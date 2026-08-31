-- ──────────────────────────────────────────────────────────────
-- 0040: every expense belongs to a registration — there is no "shared"
--
-- 0039 gave bir_expenses three branch values: appliances, furniture, and
-- 'shared' for overhead that seemed to belong to neither, on the assumption
-- that splitting it was a judgement someone would make later.
--
-- That assumption was wrong. Ryan (2026-08-31): "there must be no shared...
-- the utilities are paid by appliances... as well as salaries." The Appliances
-- registration carries the overhead. It is not an unallocated bucket waiting
-- for a decision — the decision was made long ago, and encoding a third
-- option only invited rows that belong to neither book and can therefore be
-- filed in neither return.
--
-- Two registrations, two books, every peso in one of them.
--
-- Safe to apply in either order with the code, unusually. This migration only
-- REMOVES a permitted value; it adds no function or column the app depends on.
-- Deploying the code first (which stops offering "Shared") is in fact the
-- safer order here, because the reverse leaves a deployed dropdown offering a
-- value the CHECK has just started rejecting. The house rule that migrations
-- go first exists for the opposite case — new code calling SQL that does not
-- exist yet, which is how 0031 broke collection posting.
-- ──────────────────────────────────────────────────────────────

-- Nothing to migrate in practice: bir_expenses held 0 rows when this was
-- written (the module shipped hours earlier). Written anyway so the migration
-- is correct on any database where someone did record one, and so re-running
-- it is safe.
update public.bir_expenses
set branch = 'appliances'
where branch = 'shared';

alter table public.bir_expenses drop constraint if exists bir_expenses_branch_check;
alter table public.bir_expenses
  alter column branch set default 'appliances';
alter table public.bir_expenses
  add constraint bir_expenses_branch_check
  check (branch in ('appliances', 'furniture'));

comment on column public.bir_expenses.branch is
  'Which VAT registration the document belongs to: appliances '
  '(437-961-107-00000) or furniture (437-961-107-00001). There is no third '
  'value — overhead such as utilities and salaries is paid by the Appliances '
  'registration, so it is recorded there rather than in a bucket that belongs '
  'to no return. Defaults to appliances for that reason.';

-- ── The RPCs default to appliances, not shared ────────────────
-- Only the p_branch default changes; both bodies are otherwise identical to
-- 0039. `create or replace` with the SAME argument list is a replacement, not
-- an overload — an overload is what happens when the argument list CHANGES,
-- and it is what makes PostgREST resolve rpc() ambiguously.
create or replace function public.record_bir_expense(
  p_expense_date date,
  p_supplier_id uuid,
  p_supplier_name text,
  p_doc_type text,
  p_doc_no text,
  p_gross_vat numeric,
  p_gross_non_vat numeric,
  p_category text,
  p_branch text default 'appliances',
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
    p_category, coalesce(p_branch, 'appliances'), to_char(p_expense_date, 'FMMMYYYY'),
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
  p_branch text default 'appliances',
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
      branch = coalesce(p_branch, 'appliances'),
      period_key = to_char(p_expense_date, 'FMMMYYYY'),
      note = nullif(btrim(coalesce(p_note, '')), '')
  where id = p_id
    and voided_at is null;

  if not found then
    raise exception 'Expense not found or already voided';
  end if;
end;
$$;
