-- E & J — Product description field (Phase 6, follow-up for the Pricelist import)
-- Holds the full specification text imported from the Sheet's Pricelist tab.

alter table public.products add column if not exists description text;

-- Recreate create_product / update_product to carry a description.
drop function if exists public.create_product(text, text, numeric, numeric);

create or replace function public.create_product(
  p_name text,
  p_category text default null,
  p_default_cost numeric default null,
  p_price numeric default null,
  p_description text default null
)
returns public.products
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.products;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can add products';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Product name is required';
  end if;

  insert into public.products (sku, name, category, default_cost, price, description)
  values (
    'PRD' || lpad(public.next_counter('product')::text, 4, '0'),
    trim(p_name),
    nullif(trim(coalesce(p_category, '')), ''),
    p_default_cost,
    p_price,
    nullif(trim(coalesce(p_description, '')), '')
  )
  returning * into v_row;

  return v_row;
end;
$$;

drop function if exists public.update_product(uuid, text, text, numeric, numeric, boolean);

create or replace function public.update_product(
  p_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
  p_default_cost numeric,
  p_active boolean,
  p_description text default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;

  update public.products
  set name = coalesce(nullif(trim(coalesce(p_name, '')), ''), name),
      category = nullif(trim(coalesce(p_category, '')), ''),
      price = p_price,
      default_cost = p_default_cost,
      active = coalesce(p_active, active),
      description = nullif(trim(coalesce(p_description, '')), '')
  where id = p_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;
