-- ──────────────────────────────────────────────────────────────
-- 0037: count online payments as the collection work they are
--
-- The collections module was built around a collector walking a route: log a
-- visit, carry the cash, remit it. Every report in it reads collection_entries.
--
-- That is not where the collecting happens. In August the whole
-- collection_entries table held THREE entries, all cash, all from July. Over
-- the same period Analyn recorded 77 payments worth ₱264,594, of which 52
-- carried an online reference — ₱138,629 collected over Messenger and GCash.
-- None of it appeared in v_collector_day, the remittance ledger, or the
-- dashboard's "today on the ground". The screens reported near-zero collection
-- during the month with the most collection in it.
--
-- An online payment needs no collection_entry and must not get one. The money
-- goes straight to the office, so there is no cash custody to track and nothing
-- to remit — and logging an entry AND recording the payment is the documented
-- double-post that creates two payments for one peso. The payment row IS the
-- record. What was missing is that the collections views never looked at it.
--
-- `reference_no` is the payer's online reference (0001) — distinct from
-- `receipt_no`, which the office assigns, and from collection_entries.or_no,
-- the collector's field booklet. Its presence is what marks a payment as
-- having arrived electronically.
-- ──────────────────────────────────────────────────────────────

create or replace view public.v_online_collections_day
with (security_invoker = true)
as
select
  p.payment_date as work_date,
  p.recorded_by,
  pr.full_name as recorded_by_name,
  count(*) as payments,
  coalesce(sum(p.amount), 0) as online_total
from public.payments p
left join public.profiles pr on pr.id = p.recorded_by
where p.voided_at is null
  and p.reference_no is not null
  and btrim(p.reference_no) <> ''
group by p.payment_date, p.recorded_by, pr.full_name;

comment on view public.v_online_collections_day is
  'Payments that arrived electronically, per day and per person who recorded '
  'them. A payment counts as online when it carries the payer''s reference_no. '
  'This is the office-side counterpart to v_collector_day: that view reports '
  'field visits from collection_entries, this one reports money collected '
  'without a visit. They are deliberately separate — an online payment has no '
  'cash custody, so it never enters the remittance ledger (0030), and it must '
  'NOT also be logged as a collection_entry or the account gets paid twice.';
