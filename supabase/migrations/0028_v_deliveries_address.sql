-- E & J — v_deliveries: structured address + frozen-star repair
--
-- Two fixes in one recreate:
--
-- 1. The view was created in 0014 as `select d.*`, so its output froze at the
--    deliveries columns of 0014 — it has silently LACKED `product_id` (added
--    in 0015) ever since. Same trap as v_contract_financials (see 0020/0023
--    and the frozen-view rules in docs/database.md). Columns are now
--    enumerated by hand; keep it that way.
--
-- 2. The customer context never got the 0023 structured-address treatment:
--    the /deliveries page was still showing the legacy free-text address and
--    raw gps_url while collectors got barangay grouping and tagged pins.
--    The view now also exposes province/municipality/barangay/street_purok/
--    landmark and the tagged lat/lng, so the page can use formatAddress()
--    and directionsUrl() like the collector worklist does. The legacy
--    customer_address and gps_url stay: they are formatAddress()'s fallback
--    and directionsUrl()'s second preference.
--
-- Nothing depends on v_deliveries (no other view reads it), so a plain drop
-- and recreate is safe. `create or replace` would NOT be: re-expanding d.*
-- splices product_id into the middle and fails with "cannot change name of
-- view column".

drop view public.v_deliveries;

create view public.v_deliveries
with (security_invoker = true)
as
select
  -- deliveries, enumerated (0014 columns + product_id from 0015)
  d.id,
  d.delivery_no,
  d.contract_id,
  d.status,
  d.supplier_id,
  d.supplier_cost,
  d.ordered_at,
  d.paid_at,
  d.invoice_received_at,
  d.invoice_ref,
  d.delivered_at,
  d.delivered_by,
  d.delivery_note,
  d.created_at,
  d.updated_at,
  d.product_id,
  -- contract context
  c.contract_no,
  c.item_description,
  c.item_type,
  c.quantity,
  c.contract_date,
  c.cash_price,
  -- customer context
  cu.display_name as customer_name,
  cu.address as customer_address,
  cu.phones,
  cu.gps_url,
  cu.province,
  cu.municipality,
  cu.barangay,
  cu.street_purok,
  cu.landmark,
  cu.lat,
  cu.lng,
  -- supplier context
  s.name as supplier_name,
  case
    when d.status = 'ordered' and d.invoice_received_at is null and d.ordered_at is not null
    then (public.ph_today() - d.ordered_at)
    else null
  end as days_awaiting_invoice
from public.deliveries d
join public.contracts c on c.id = d.contract_id
join public.customers cu on cu.id = c.customer_id
left join public.suppliers s on s.id = d.supplier_id;
