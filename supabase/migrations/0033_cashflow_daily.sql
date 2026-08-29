-- ──────────────────────────────────────────────────────────────
-- 0033: daily cash collected
--
-- The dashboard could not answer "what happened over the last two weeks",
-- because the finest time grain in the database was the month
-- (v_cashflow_monthly, 0002). At month granularity a bad fortnight is
-- invisible until the month closes, which is exactly when it is too late to
-- send anyone out.
--
-- Purely additive: nothing depends on this view and it depends on nothing but
-- `payments`, so it adds no member to the v_contract_financials drop-cascade
-- that 0027 had to work around. The payments_payment_date index (0001) already
-- covers the range scan.
--
-- Why a view rather than bucketing in JS: a daily bucket boundary is a date
-- calculation, and the app runs on a UTC server for a business in Asia/Manila.
-- That is the shape of bug this project has already hit twice (the node-postgres
-- date parser in sync-sheet-divergence, and the standing rule that time-dependent
-- numbers come out of SQL). `payment_date` is a plain `date`, so grouping it in
-- Postgres has no timezone in the path at all.
--
-- security_invoker, like every other view here: a collector reading this sees
-- only the payments their RLS allows. That is a real number, not an error, so
-- callers must role-gate what they show rather than assume it is company-wide.
-- ──────────────────────────────────────────────────────────────

create or replace view public.v_cashflow_daily
with (security_invoker = true)
as
select
  payment_date as day,
  count(*) as payment_count,
  sum(amount) as collected
from public.payments
where voided_at is null
group by 1
order by 1;

comment on view public.v_cashflow_daily is
  'Unvoided payments summed per calendar day. Days with no payments have NO '
  'ROW — a caller drawing a fixed window must fill the gaps or the chart will '
  'misreport how often money actually arrives.';
