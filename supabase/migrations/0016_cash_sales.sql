-- E & J — Cash sales & Office Sales (Phase 4)
-- A cash/outright sale is a contracts row with sale_type='cash', term_months=0,
-- downpayment = total_price = cash_price, monthly = 0. That shape makes the
-- existing frozen views (v_contract_financials, v_contract_dp, analytics) and
-- the delivery-enqueue trigger correct with NO view changes.
-- Walk-in sales with no agent are attributed to 'Office Sales'.

-- ──────────────────────────────────────────────────────────────
-- 1. sale_type + relaxed term check
-- ──────────────────────────────────────────────────────────────
alter table public.contracts
  add column if not exists sale_type text not null default 'installment'
    check (sale_type in ('installment', 'cash'));

alter table public.contracts drop constraint if exists contracts_term_months_check;
alter table public.contracts add constraint contracts_term_months_check
  check (
    (sale_type = 'installment' and term_months in (4, 5, 6, 12))
    or (sale_type = 'cash' and term_months = 0)
  );

-- ──────────────────────────────────────────────────────────────
-- 2. Recreate create_contract with p_sale_type
--    (drop the 11-arg 0015 version; a defaulted 12th arg would overload)
-- ──────────────────────────────────────────────────────────────
drop function if exists public.create_contract(uuid, date, text, text, int, numeric, int, text, text, uuid, uuid);

create or replace function public.create_contract(
  p_customer_id uuid,
  p_contract_date date,
  p_item_description text,
  p_item_type text,
  p_quantity int,
  p_cash_price numeric,
  p_term_months int,
  p_sales_agent text,
  p_note text default null,
  p_agent_id uuid default null,
  p_product_id uuid default null,
  p_sale_type text default 'installment'
)
returns public.contracts
language plpgsql
security definer set search_path = public
as $$
declare
  v_year text := to_char(p_contract_date, 'YYYY');
  v_n int;
  v_terms record;
  v_total numeric;
  v_dp numeric;
  v_monthly numeric;
  v_term int;
  v_row public.contracts;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can create contracts';
  end if;
  if p_sale_type not in ('installment', 'cash') then
    raise exception 'Invalid sale type';
  end if;
  if p_agent_id is not null and not exists (
    select 1 from public.profiles where id = p_agent_id and role = 'sales_agent' and active
  ) then
    raise exception 'Sales agent must be an active sales_agent user';
  end if;

  if p_sale_type = 'cash' then
    -- Paid-in-full: the whole amount is due now, no schedule.
    v_total := p_cash_price;
    v_dp := p_cash_price;
    v_monthly := 0;
    v_term := 0;
  else
    select * into v_terms from public.compute_terms(p_cash_price, p_term_months);
    v_total := v_terms.total_price;
    v_dp := v_terms.downpayment;
    v_monthly := v_terms.monthly_amortization;
    v_term := p_term_months;
  end if;

  v_n := public.next_counter('contract:' || v_year);

  insert into public.contracts (
    contract_no, customer_id, contract_date, item_description, item_type,
    quantity, cash_price, term_months, total_price, downpayment,
    monthly_amortization, sales_agent, agent_id, product_id, sale_type, created_by
  ) values (
    v_year || lpad(v_n::text, 3, '0'),
    p_customer_id, p_contract_date, p_item_description, p_item_type,
    p_quantity, p_cash_price, v_term,
    v_total, v_dp, v_monthly,
    coalesce(nullif(trim(coalesce(p_sales_agent, '')), ''), 'Office Sales'),
    p_agent_id, p_product_id, p_sale_type, auth.uid()
  )
  returning * into v_row;

  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.contract_notes (contract_id, body, created_by)
    values (v_row.id, trim(p_note), auth.uid());
  end if;

  if p_agent_id is not null then
    insert into public.commissions (
      commission_no, contract_id, agent_id, base_amount, rate, commission_amount, created_by
    ) values (
      'COM' || lpad(public.next_counter('commission')::text, 4, '0'),
      v_row.id, p_agent_id, v_row.cash_price, 0.10,
      round(v_row.cash_price * 0.10, 2), auth.uid()
    );
  end if;

  return v_row;
end;
$$;
