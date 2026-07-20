-- E & J — Collection entry fields the SOP depends on
--
-- Two things the collections SOP asks collectors to record had nowhere
-- structured to live, so they survived only as prose in `note`:
--
--   promised_date — when a customer promises to pay. Without a column nothing
--                   can resurface a promise on the day it falls due, so the
--                   worklist had no memory and follow-up depended entirely on
--                   the collector remembering.
--   or_no         — the number from the collector's pre-numbered receipt
--                   booklet. This is NOT reference_no: that field is the
--                   PAYER's GCash/online confirmation. The official receipt
--                   number is assigned much later, at post_collection_entry.
--                   Cash handed over in the field had no traceable document.

alter table public.collection_entries add column if not exists promised_date date;
alter table public.collection_entries add column if not exists or_no text;

comment on column public.collection_entries.promised_date is
  'Date the customer promised to pay. Required when disposition = promised.';
comment on column public.collection_entries.or_no is
  'Collector''s field receipt-booklet number. Required for cash collections. '
  'Distinct from reference_no (payer''s online ref) and from payments.receipt_no.';

-- Promises that are due; drives the worklist ordering.
create index if not exists collection_entries_promised_date
  on public.collection_entries (promised_date)
  where disposition = 'promised' and status = 'pending';

-- ──────────────────────────────────────────────────────────────
-- log_collection — must be DROPPED, not replaced
-- ──────────────────────────────────────────────────────────────
-- Postgres will not `create or replace` a function across a changed argument
-- list, so the old 6-arg signature has to go first.
drop function if exists public.log_collection(uuid, numeric, text, text, text, text);

create or replace function public.log_collection(
  p_contract_id uuid,
  p_amount numeric,
  p_method text,
  p_reference text,
  p_disposition text default 'collected',
  p_note text default null,
  p_promised_date date default null,
  p_or_no text default null
)
returns public.collection_entries
language plpgsql
security definer set search_path = public
as $$
declare
  v_n int;
  v_row public.collection_entries;
begin
  if not public.is_collector() then
    raise exception 'Only a collector can log collections';
  end if;

  if not exists (
    select 1 from public.contracts
    where id = p_contract_id and collector_id = auth.uid()
  ) then
    raise exception 'This contract is not assigned to you';
  end if;

  if p_disposition = 'collected' then
    if coalesce(p_amount, 0) <= 0 then
      raise exception 'A collected entry needs an amount greater than zero';
    end if;
    if p_method is null or p_method not in ('cash', 'online') then
      raise exception 'Collected entry needs method cash or online';
    end if;
    if p_method = 'online' and coalesce(trim(p_reference), '') = '' then
      raise exception 'Online collection needs a reference number';
    end if;
    -- No receipt, no money: cash taken in the field must carry the booklet
    -- number, because the app cannot print an official receipt until the
    -- admin posts the entry back at the office.
    if p_method = 'cash' and coalesce(trim(p_or_no), '') = '' then
      raise exception 'Cash collection needs the receipt number from your booklet';
    end if;
  end if;

  -- A promise with no date is not a promise — nothing can follow it up.
  if p_disposition = 'promised' then
    if p_promised_date is null then
      raise exception 'A promise to pay needs the date the customer promised';
    end if;
    if p_promised_date < public.ph_today() then
      raise exception 'The promised date cannot be in the past';
    end if;
  end if;

  v_n := public.next_counter('collection_entry');

  insert into public.collection_entries (
    entry_no, contract_id, collector_id, work_date,
    amount, method, reference_no, disposition, note,
    promised_date, or_no
  ) values (
    'CE' || lpad(v_n::text, 4, '0'),
    p_contract_id, auth.uid(), public.ph_today(),
    case when p_disposition = 'collected' then p_amount else 0 end,
    case when p_disposition = 'collected' then p_method else null end,
    nullif(trim(coalesce(p_reference, '')), ''),
    p_disposition,
    nullif(trim(coalesce(p_note, '')), ''),
    case when p_disposition = 'promised' then p_promised_date else null end,
    case when p_disposition = 'collected' and p_method = 'cash'
         then nullif(trim(coalesce(p_or_no, '')), '') else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- v_open_promises — promises that have come due
-- ──────────────────────────────────────────────────────────────
-- One row per contract: the most recent still-pending promise whose date has
-- arrived. The worklist joins this to float those accounts to the top, which
-- is the whole point of capturing the date.
create or replace view public.v_open_promises
with (security_invoker = true)
as
select distinct on (e.contract_id)
  e.contract_id,
  e.promised_date,
  e.amount as promised_amount,
  e.collector_id,
  e.note as promise_note
from public.collection_entries e
where e.disposition = 'promised'
  and e.status = 'pending'
  and e.promised_date is not null
  and e.promised_date <= public.ph_today()
order by e.contract_id, e.promised_date desc, e.created_at desc;
