-- E & J — Product typeahead, add-item-mid-contract, duplicate review
--
-- The picker on the new-contract form was a plain <select> with no photos, so
-- an item that was not in it got typed as free text and the catalogue drifted.
-- That is not hypothetical: the Pricelist import produced 12 duplicate products
-- that had to be merged by hand.
--
-- Items can now be added while writing a contract. The contract completes
-- immediately -- catalogue hygiene must never hold up a sale -- and the new item
-- is flagged for review afterwards. Nothing is ever auto-merged: at 134 products
-- the cost of a wrong merge is a wrong price on a customer's contract, so the
-- system only ranks suspects and a human decides.

-- pg_trgm is already enabled (0001_schema.sql:4) but products.name was never
-- indexed for it, unlike customers.display_name and contracts.item_description.
create index if not exists products_name_trgm
  on public.products using gin (name gin_trgm_ops);

alter table public.products
  add column if not exists review_status text not null default 'approved'
    check (review_status in ('pending', 'approved'));

-- dHash of the photo: resize to 9x8 greyscale, compare each pixel with its right
-- neighbour, 64 bits. Compared by Hamming distance; ~5 bits is the conventional
-- near-duplicate threshold. Nullable because existing photos have none until the
-- backfill script runs.
alter table public.product_photos
  add column if not exists dhash bit(64);

comment on column public.product_photos.dhash is
  'Perceptual hash (dHash, 64-bit) for near-duplicate detection. Computed in the '
  'browser at upload time from the same canvas pass that downscales the image.';

create index if not exists products_review_status
  on public.products (review_status) where review_status = 'pending';

-- ──────────────────────────────────────────────────────────────
-- search_products — the typeahead
-- ──────────────────────────────────────────────────────────────
-- Has to be an RPC: PostgREST cannot express `order by <similarity fn>`.
--
-- Uses word_similarity, NOT similarity. similarity() normalises over the whole
-- string, so a short query against a long product name scores low and barely
-- separates: "sharp tv 32" scored 0.35-0.40 against the actual Sharp TVs and
-- 0.09-0.14 against Sharp refrigerators. word_similarity scores the best
-- matching word extent instead -- 1.00 vs 0.50 on the same data.
--
-- Threshold 0.45, below pg_trgm's 0.6 default so real typos still land
-- ("dinning" finds Dining Tables at 0.67) but not so low that noise creeps in.
-- At 0.15 the query "fridg" returned Dining Tables and a Freezer -- worse than
-- returning nothing. Abbreviations like "fridg" are deliberately NOT supported;
-- "ref" finds every refrigerator via the substring branch.
create or replace function public.search_products(p_query text)
returns table (
  id uuid,
  sku text,
  name text,
  category text,
  price numeric,
  on_hand int,
  review_status text,
  storage_path text,
  score real
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.sku, p.name, p.category, p.price, p.on_hand, p.review_status,
    (select ph.storage_path from public.product_photos ph
      where ph.product_id = p.id order by ph.sort_order, ph.created_at limit 1),
    greatest(
      word_similarity(p_query, p.name),
      -- a literal substring is a strong signal trigrams can undervalue
      case when p.name ilike '%' || p_query || '%' then 0.7 else 0 end,
      case when coalesce(p.category, '') ilike '%' || p_query || '%' then 0.25 else 0 end
    )::real as score
  from public.products p
  where p.active
    and (
      word_similarity(p_query, p.name) >= 0.45
      or p.name ilike '%' || p_query || '%'
      or coalesce(p.category, '') ilike '%' || p_query || '%'
    )
  order by score desc, p.name
  limit 12;
$$;

-- ──────────────────────────────────────────────────────────────
-- create_product_for_contract — deliberately separate from create_product
-- ──────────────────────────────────────────────────────────────
-- Kept distinct so the pending flag can never be set by accident from the
-- ordinary /products screen, and so the notification only fires for items
-- created in the rush of writing a contract.
create or replace function public.create_product_for_contract(
  p_name text,
  p_category text default null,
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
    raise exception 'Item name is required';
  end if;

  insert into public.products (sku, name, category, price, description, review_status)
  values (
    'PRD' || lpad(public.next_counter('product')::text, 4, '0'),
    trim(p_name),
    nullif(trim(coalesce(p_category, '')), ''),
    p_price,
    nullif(trim(coalesce(p_description, '')), ''),
    'pending'
  )
  returning * into v_row;

  -- Notification reuses the tasks module rather than inventing a second
  -- mechanism: this lands in the nav badge and task list the admin already
  -- watches every day.
  insert into public.tasks (task_no, title, body, assignee_role, priority, created_by)
  values (
    'TSK' || lpad(public.next_counter('task')::text, 4, '0'),
    'Check new item: ' || v_row.name,
    'Added while writing a contract, so it has not been checked against the '
      || 'catalogue. Open Products > Review to compare it with similar items.',
    'admin', 'normal', auth.uid()
  );

  return v_row;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- find_duplicate_candidates
-- ──────────────────────────────────────────────────────────────
-- Name similarity only. Image distance is combined in TypeScript so this stays
-- a simple, fast query and the hash comparison is easy to reason about.
create or replace function public.find_duplicate_candidates(p_product_id uuid)
returns table (
  id uuid,
  sku text,
  name text,
  category text,
  price numeric,
  on_hand int,
  storage_path text,
  dhash bit(64),
  name_score real
)
language sql stable security definer set search_path = public
as $$
  select
    p.id, p.sku, p.name, p.category, p.price, p.on_hand,
    (select ph.storage_path from public.product_photos ph
      where ph.product_id = p.id order by ph.sort_order, ph.created_at limit 1),
    (select ph.dhash from public.product_photos ph
      where ph.product_id = p.id and ph.dhash is not null
      order by ph.sort_order, ph.created_at limit 1),
    similarity(p.name, (select name from public.products where id = p_product_id))::real
  from public.products p
  where p.id <> p_product_id
    and p.active
    and p.review_status = 'approved'
  order by similarity(p.name, (select name from public.products where id = p_product_id)) desc
  limit 8;
$$;

-- product_photos has a SELECT policy only — every write goes through an RPC.
-- A separate function rather than a new add_product_photo signature, because
-- changing that one's arguments would require dropping it and would break the
-- existing /products upload path mid-deploy.
create or replace function public.set_product_photo_hash(
  p_storage_path text,
  p_dhash text
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;
  if p_dhash !~ '^[01]{64}$' then
    raise exception 'A dHash must be exactly 64 binary digits';
  end if;

  update public.product_photos
  set dhash = p_dhash::bit(64)
  where storage_path = p_storage_path;
end;
$$;

create or replace function public.approve_product(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.can_post_payments() then
    raise exception 'Not authorized';
  end if;
  update public.products set review_status = 'approved' where id = p_id;
  if not found then
    raise exception 'Product not found';
  end if;
end;
$$;

-- ──────────────────────────────────────────────────────────────
-- merge_products — the destructive one
-- ──────────────────────────────────────────────────────────────
-- Everything pointing at the duplicate is repointed BEFORE it is deleted, or the
-- foreign keys would either block the delete or orphan a contract. Stock is
-- summed rather than discarded. This is irreversible once it commits.
create or replace function public.merge_products(
  p_duplicate uuid,
  p_keep uuid
)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_dup public.products;
  v_keep public.products;
  v_contracts int;
begin
  if not public.can_post_payments() then
    raise exception 'Only the owner or admin can merge products';
  end if;
  if p_duplicate = p_keep then
    raise exception 'Cannot merge a product into itself';
  end if;

  select * into v_dup from public.products where id = p_duplicate;
  if not found then raise exception 'The duplicate product no longer exists'; end if;
  select * into v_keep from public.products where id = p_keep;
  if not found then raise exception 'The product to keep no longer exists'; end if;

  update public.contracts set product_id = p_keep where product_id = p_duplicate;
  get diagnostics v_contracts = row_count;

  update public.deliveries set product_id = p_keep where product_id = p_duplicate;
  update public.stock_movements set product_id = p_keep where product_id = p_duplicate;
  update public.product_photos set product_id = p_keep where product_id = p_duplicate;

  -- Stock held against the duplicate is real stock; fold it in.
  update public.products
  set on_hand = on_hand + coalesce(v_dup.on_hand, 0)
  where id = p_keep;

  delete from public.products where id = p_duplicate;

  -- Audit trail. products has no notes table, so this goes to the task thread
  -- the review queue is worked from.
  insert into public.tasks (task_no, title, body, assignee_role, priority, status, created_by)
  values (
    'TSK' || lpad(public.next_counter('task')::text, 4, '0'),
    'Merged: ' || v_dup.name,
    v_dup.sku || ' (' || v_dup.name || ') merged into ' || v_keep.sku || ' ('
      || v_keep.name || '). ' || v_contracts || ' contract(s) repointed, '
      || coalesce(v_dup.on_hand, 0) || ' stock folded in.',
    'admin', 'low', 'done', auth.uid()
  );
end;
$$;
