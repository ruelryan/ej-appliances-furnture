-- E & J — Product catalog: selling price, photos, richer editing (Phase 6)
-- Adds a selling price + uploaded photos (Supabase Storage) to products.
-- Internal only: photos are shown on authed screens; the bucket is public so
-- <img src> works without signed URLs (product images are not sensitive).

-- ──────────────────────────────────────────────────────────────
-- 1. Selling price
-- ──────────────────────────────────────────────────────────────
alter table public.products add column if not exists price numeric(12,2);

-- ──────────────────────────────────────────────────────────────
-- 2. Product photos
-- ──────────────────────────────────────────────────────────────
create table public.product_photos (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  storage_path text not null,
  sort_order int not null default 0,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index product_photos_product on public.product_photos (product_id);

alter table public.product_photos enable row level security;

create policy product_photos_select on public.product_photos
  for select using (public.is_active_user());

-- ──────────────────────────────────────────────────────────────
-- 3. Storage bucket + policies (product-photos, public read)
-- ──────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('product-photos', 'product-photos', true)
on conflict (id) do nothing;

drop policy if exists product_photos_write_ins on storage.objects;
drop policy if exists product_photos_write_upd on storage.objects;
drop policy if exists product_photos_write_del on storage.objects;

create policy product_photos_write_ins on storage.objects
  for insert to authenticated
  with check (bucket_id = 'product-photos' and public.can_post_payments());
create policy product_photos_write_upd on storage.objects
  for update to authenticated
  using (bucket_id = 'product-photos' and public.can_post_payments());
create policy product_photos_write_del on storage.objects
  for delete to authenticated
  using (bucket_id = 'product-photos' and public.can_post_payments());
-- Reads: the bucket is public, so the /object/public/ endpoint serves images
-- without RLS. No SELECT policy needed for display.

-- ──────────────────────────────────────────────────────────────
-- 4. Recreate create_product / update_product with price (+ cost on update)
-- ──────────────────────────────────────────────────────────────
drop function if exists public.create_product(text, text, numeric);

create or replace function public.create_product(
  p_name text,
  p_category text default null,
  p_default_cost numeric default null,
  p_price numeric default null
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

  insert into public.products (sku, name, category, default_cost, price)
  values (
    'PRD' || lpad(public.next_counter('product')::text, 4, '0'),
    trim(p_name),
    nullif(trim(coalesce(p_category, '')), ''),
    p_default_cost,
    p_price
  )
  returning * into v_row;

  return v_row;
end;
$$;

drop function if exists public.update_product(uuid, text, text, boolean);

create or replace function public.update_product(
  p_id uuid,
  p_name text,
  p_category text,
  p_price numeric,
  p_default_cost numeric,
  p_active boolean
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
      active = coalesce(p_active, active)
  where id = p_id;

  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- 5. Photo RPCs
-- ──────────────────────────────────────────────────────────────
create or replace function public.add_product_photo(
  p_product_id uuid,
  p_storage_path text,
  p_sort_order int default 0
)
returns public.product_photos
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.product_photos;
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Product not found';
  end if;

  insert into public.product_photos (product_id, storage_path, sort_order, created_by)
  values (p_product_id, p_storage_path, coalesce(p_sort_order, 0), auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- Deletes the row and returns its storage_path so the caller removes the file.
create or replace function public.delete_product_photo(p_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_path text;
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;

  delete from public.product_photos where id = p_id returning storage_path into v_path;
  if v_path is null then
    raise exception 'Photo not found';
  end if;

  return v_path;
end;
$$;
