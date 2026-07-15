-- E & J — computed views. All time-dependent business math lives here.
-- "Today" is always Asia/Manila, computed server-side.

create or replace function public.ph_today()
returns date
language sql stable
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

-- Whole months elapsed since a date, day-of-month aware
-- (mirrors the Apps Script: decrement if today's day-of-month not yet reached).
create or replace function public.months_elapsed_ph(p_from date)
returns int
language sql stable
as $$
  select greatest(0,
    (extract(year from public.ph_today())::int * 12 + extract(month from public.ph_today())::int)
    - (extract(year from p_from)::int * 12 + extract(month from p_from)::int)
    - case when extract(day from public.ph_today()) < extract(day from p_from) then 1 else 0 end
  );
$$;

-- ──────────────────────────────────────────────────────────────
-- v_contract_financials — the single source of truth
-- ──────────────────────────────────────────────────────────────
create or replace view public.v_contract_financials
with (security_invoker = true)
as
with pay as (
  select
    contract_id,
    coalesce(sum(amount), 0) as total_paid,
    max(payment_date) as last_payment_date,
    count(*) as payment_count
  from public.payments
  where voided_at is null
  group by contract_id
)
select
  c.*,
  cu.display_name,
  cu.first_name,
  cu.last_name,
  cu.phones,
  cu.messenger_url,
  cu.gps_url,
  cu.address,
  public.months_elapsed_ph(c.contract_date) as months_elapsed,
  coalesce(p.total_paid, 0) as total_paid,
  p.last_payment_date,
  coalesce(p.payment_count, 0) as payment_count,
  -- expected = downpayment + monthly × min(months elapsed, term)
  round(
    c.downpayment
    + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months),
    2
  ) as expected_to_date,
  greatest(
    round(
      c.downpayment
      + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months)
      - coalesce(p.total_paid, 0),
      2
    ),
    0
  ) as overdue_amount,
  round(c.total_price - coalesce(p.total_paid, 0), 2) as remaining_balance,
  -- fractional months since last payment (Apps Script used days / 30.44)
  case
    when p.last_payment_date is null then null
    else round((public.ph_today() - p.last_payment_date) / 30.44, 2)
  end as months_since_last_payment,
  case
    when c.payment_status = 'closed' then 'closed'
    when round(c.total_price - coalesce(p.total_paid, 0), 2) <= 0 then 'on_track'
    when c.downpayment
         + c.monthly_amortization * least(public.months_elapsed_ph(c.contract_date), c.term_months)
         - coalesce(p.total_paid, 0) <= 0.009 then 'on_track'
    when p.last_payment_date is not null
         and (public.ph_today() - p.last_payment_date) / 30.44 >= 3 then 'demand'
    else 'overdue'
  end as followup_tier
from public.contracts c
join public.customers cu on cu.id = c.customer_id
left join pay p on p.contract_id = c.id;

-- ──────────────────────────────────────────────────────────────
-- Analytics views (owner dashboard)
-- ──────────────────────────────────────────────────────────────

create or replace view public.v_sales_monthly
with (security_invoker = true)
as
select
  date_trunc('month', contract_date)::date as month,
  count(*) as contract_count,
  sum(cash_price) as cash_price_total,
  sum(total_price) as contract_value_total
from public.contracts
group by 1
order by 1;

create or replace view public.v_sales_by_agent
with (security_invoker = true)
as
select
  coalesce(nullif(trim(sales_agent), ''), '(none)') as sales_agent,
  count(*) as contract_count,
  sum(total_price) as contract_value_total
from public.contracts
group by 1
order by contract_value_total desc;

create or replace view public.v_sales_by_item_type
with (security_invoker = true)
as
select
  coalesce(nullif(trim(item_type), ''), '(none)') as item_type,
  count(*) as contract_count,
  sum(total_price) as contract_value_total
from public.contracts
group by 1
order by contract_value_total desc;

create or replace view public.v_cashflow_monthly
with (security_invoker = true)
as
select
  date_trunc('month', payment_date)::date as month,
  count(*) as payment_count,
  sum(amount) as collected
from public.payments
where voided_at is null
group by 1
order by 1;

-- Expected collections per month: downpayment lands in the contract month,
-- then one amortization per month for term_months months.
create or replace view public.v_expected_monthly
with (security_invoker = true)
as
with schedule as (
  select
    c.id,
    (date_trunc('month', c.contract_date) + make_interval(months => gs.n))::date as month,
    case when gs.n = 0 then c.downpayment else c.monthly_amortization end as expected
  from public.contracts c
  cross join lateral generate_series(0, c.term_months) as gs(n)
)
select month, sum(expected) as expected
from schedule
group by month
order by month;

create or replace view public.v_collections_vs_expected
with (security_invoker = true)
as
select
  coalesce(e.month, a.month) as month,
  coalesce(e.expected, 0) as expected,
  coalesce(a.collected, 0) as collected
from public.v_expected_monthly e
full outer join public.v_cashflow_monthly a using (month)
order by 1;

-- Aging: how many amortization-months behind is each open contract
create or replace view public.v_aging
with (security_invoker = true)
as
select
  case
    when overdue_amount <= 0 then 'current'
    when overdue_amount <= monthly_amortization then '1 month'
    when overdue_amount <= monthly_amortization * 2 then '2 months'
    else '3+ months'
  end as bucket,
  count(*) as contract_count,
  sum(overdue_amount) as overdue_total,
  sum(remaining_balance) as balance_total
from public.v_contract_financials
where payment_status = 'open'
group by 1;

create or replace view public.v_top_customers
with (security_invoker = true)
as
select
  cu.id as customer_id,
  cu.display_name,
  count(c.id) as contract_count,
  sum(c.total_price) as lifetime_value,
  sum(case when c.payment_status = 'open' then f.remaining_balance else 0 end) as current_balance
from public.customers cu
join public.contracts c on c.customer_id = cu.id
join public.v_contract_financials f on f.id = c.id
group by cu.id, cu.display_name
order by lifetime_value desc;

create or replace view public.v_dashboard_stats
with (security_invoker = true)
as
select
  (select count(*) from public.contracts where payment_status = 'open') as open_contracts,
  (select coalesce(sum(remaining_balance), 0) from public.v_contract_financials where payment_status = 'open') as outstanding_balance,
  (select coalesce(sum(overdue_amount), 0) from public.v_contract_financials where payment_status = 'open') as total_overdue,
  (select count(*) from public.v_contract_financials where payment_status = 'open' and followup_tier = 'demand') as demand_tier_count,
  (select count(*) from public.v_contract_financials where payment_status = 'open' and followup_tier = 'overdue') as overdue_tier_count,
  (select coalesce(sum(amount), 0) from public.payments
    where voided_at is null
      and date_trunc('month', payment_date) = date_trunc('month', public.ph_today())) as collected_this_month;
