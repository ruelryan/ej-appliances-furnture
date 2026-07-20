-- E & J — Repair id_counters after a Sheet re-import
--
-- BUG THIS FIXES. scripts/migrate/import.ts wipes id_counters and reseeds only
-- the contract:YYYY and payment scopes (delivery is recreated by its trigger).
-- Every other series — product, task, commission, collection_entry,
-- cash_advance, lead, repricing — is left with no row at all.
--
-- next_counter() treats a missing scope as a fresh start at 0, so the next id
-- it emits is #0001. Where rows survived the import that is an immediate unique
-- violation: after today's cutover the catalogue still held 134 products up to
-- PRD0438 and 2 tasks up to TSK0002, so *adding any product or task would have
-- failed outright*. It surfaced when merge_products tried to write its audit
-- task and hit tasks_task_no_key.
--
-- This resets every counter to the highest id actually present. Idempotent and
-- safe to re-run: greatest() never moves a counter backwards, so running it
-- against healthy data is a no-op.

do $$
declare
  r record;
begin
  for r in
    select 'product'          as scope, coalesce(max(substring(sku            from '[0-9]+$')::int), 0) as mx from public.products
    union all
    select 'task',                      coalesce(max(substring(task_no        from '[0-9]+$')::int), 0) from public.tasks
    union all
    select 'commission',                coalesce(max(substring(commission_no  from '[0-9]+$')::int), 0) from public.commissions
    union all
    select 'collection_entry',          coalesce(max(substring(entry_no       from '[0-9]+$')::int), 0) from public.collection_entries
    union all
    select 'cash_advance',              coalesce(max(substring(advance_no     from '[0-9]+$')::int), 0) from public.cash_advances
    union all
    select 'lead',                      coalesce(max(substring(lead_no        from '[0-9]+$')::int), 0) from public.leads
    union all
    select 'repricing',                 coalesce(max(substring(amendment_no   from '[0-9]+$')::int), 0) from public.contract_repricings
    union all
    select 'delivery',                  coalesce(max(substring(delivery_no    from '[0-9]+$')::int), 0) from public.deliveries
  loop
    insert into public.id_counters (scope, last_value)
    values (r.scope, r.mx)
    on conflict (scope) do update
      set last_value = greatest(public.id_counters.last_value, excluded.last_value);
  end loop;
end;
$$;

-- Contract numbers are per-year (contract:2025, contract:2026, …), so they are
-- rebuilt from the contract_no prefix rather than a single scope. Only the
-- YYYY### form participates; the early Sheet era used bare numbers.
do $$
declare
  r record;
begin
  for r in
    select 'contract:' || substring(contract_no from '^(20[0-9]{2})') as scope,
           max(substring(contract_no from '^20[0-9]{2}([0-9]{3,})$')::int) as mx
      from public.contracts
     where contract_no ~ '^20[0-9]{2}[0-9]{3,}$'
     group by 1
  loop
    insert into public.id_counters (scope, last_value)
    values (r.scope, r.mx)
    on conflict (scope) do update
      set last_value = greatest(public.id_counters.last_value, excluded.last_value);
  end loop;
end;
$$;
