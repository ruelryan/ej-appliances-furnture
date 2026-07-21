# Deliveries, Inventory, and the Product Catalog

Three migrations built this area — 0014 (deliveries + suppliers), 0015 (inventory), 0018/0019/0024 (catalog, photos, typeahead, duplicate review) — around three invariants. **Every contract has exactly one delivery row**, auto-enqueued by a trigger, so nothing sold can silently never ship. **`products.on_hand` only ever moves through RPCs that also write a `stock_movements` ledger row**, so the count is always explainable. And **nothing is ever auto-merged**: the duplicate-review queue ranks suspects, but a human clicks merge, because at ~134 products the cost of a wrong merge is a wrong price on a customer's contract. For table/column detail see [../database.md](../database.md); the delivery status also feeds the contract detail page described in [contracts-payments.md](contracts-payments.md).

## The delivery queue

Creating a contract fires the `contracts_enqueue_delivery` after-insert trigger, which inserts a `deliveries` row (`DEL#####`, status `pending`, carrying the contract's `product_id` if one was picked). There is no code path that creates a contract without a delivery, cash sales included.

The status flow, and the RPC that drives each step:

| Step | Status change | RPC | Who |
|---|---|---|---|
| Is the item in the office? | `pending` → `in_stock` or `to_order` | `set_delivery_availability` | delivery team or owner/admin |
| Ordered from a supplier | → `ordered` (sets supplier, cost, `ordered_at`, `paid_at`) | `record_supplier_order` | owner/admin only (cost is office-only) |
| Invoice arrives | sets `invoice_ref` + `invoice_received_at` | `record_supplier_invoice` | owner/admin only |
| Handed to the customer | → `delivered` (sets `delivered_at = ph_today()`, `delivered_by`, note) | `mark_delivered` | delivery team or owner/admin |

Notes on the flow's edges, all enforced in SQL:

- `set_delivery_availability` only works from `pending`/`in_stock`/`to_order` — once ordered or delivered, the availability answer is settled.
- `record_supplier_order` works from any status except `delivered`, so the office can jump straight from `pending` to `ordered` without the availability step.
- `mark_delivered` refuses an already-delivered row; every step raises a clear exception rather than silently matching zero rows.
- Linking a catalog product after the fact is `set_delivery_product` (delivery team or owner/admin, blocked once delivered) — this is what makes the stock decrement below possible.

**The legacy `contracts.delivery_status` text is a derived label, never edited by hand.** The `deliveries_sync_status` trigger mirrors every status change into it as display text ("Out for Delivery", "Ordered from supplier", …) so old screens and the CSV export kept working through the 0014 transition. The `deliveries` row is the source of truth.

The `/deliveries` page reads `v_deliveries` (delivery + contract + customer + supplier context — drop-and-recreated in 0028 with hand-enumerated columns after its `d.*` was caught hiding `product_id`, see the frozen-view rules in [../database.md](../database.md)), split into To do / Delivered / All tabs with stat tiles for pending, to-order, awaiting-supplier, and late invoices. Since 0028 the queue shows the customer's structured address (`formatAddress`) with the landmark, and a Directions link (`directionsUrl`: tagged pin → legacy `gps_url` → address search, `~` marking an approximate one) — the same treatment the collector worklist got in 0023. RLS on `deliveries`: owner/admin/delivery see all; a collector or sales agent sees only deliveries for their own contracts.

## Suppliers and invoice lag

`suppliers` is a plain reference table (name/contact/address/note/active) managed directly through RLS from the `/deliveries` page — one of the very few tables written without an RPC (everyone reads; owner/admin insert/update; owner deletes). What matters operationally is the **invoice-lag tracking**: `v_deliveries` computes `days_awaiting_invoice` for any delivery that is `ordered` with no `invoice_received_at` yet, and the page badges anything over 14 days. Supplier cost lives on the delivery row, visible only to roles that can see the queue's management view.

## The stock ledger

`products.on_hand` never changes without a matching `stock_movements` row (`delta`, `reason` = `restock` / `delivery` / `adjust`, optional `delivery_id`, who and when). The three write paths:

- `restock_product` — positive quantity only; logs a `restock` row.
- `adjust_stock` — signed delta for corrections; refuses to take `on_hand` negative; logs an `adjust` row.
- `mark_delivered` — the only automatic movement. It decrements `on_hand` by the contract's quantity and logs a negative `delivery` row **only when the delivery is `in_stock` AND has a linked product** at the moment it is delivered. A drop-shipped supplier order (`ordered`) or an unlinked delivery changes no stock — the item never passed through the office. Note this path has no negative-stock guard: delivering more than the recorded on-hand drives the count negative, which is deliberate (the physical item did leave; fix the count with `adjust_stock`).

The ledger is readable by owner/admin only. Stock counts are managed on `/products` alongside the catalog (0018 moved them there); `/deliveries` links across.

## The catalog (`/products`)

Each product carries `sku` (`PRD####`), name, category, `on_hand`, `default_cost` (what the office pays), `price` (selling price — pre-fills the new-sale form), `description` (the spec text from the Pricelist import), `active`, and `review_status`. Owner/admin manage everything through `create_product` / `update_product`; the catalog is readable by every active user (the picker needs it) but the cost and ledger views are not.

**Photos** live in the **public** Storage bucket `product-photos` — public read so `<img src>` works without signed URLs (product images are not sensitive); writes are gated to owner/admin by storage policies, and the `product_photos` table rows go through `add_product_photo` / `delete_product_photo` (which returns the storage path so the caller can remove the file). Before upload, the browser does all the image work in `src/lib/image.ts`: one canvas decode downscales to ≤1024px JPEG (phone originals were up to 5 MB and were being served as 64px thumbnails) and computes the 64-bit dHash from the same pass, stored via `set_product_photo_hash` for duplicate ranking.

## Typeahead on the new-contract form

The picker used to be a plain `<select>` with no photos, so items not in it got typed as free text and the catalog drifted — the Pricelist import surfaced 12 hand-merged duplicates caused exactly this way. It is now a photo typeahead backed by the `search_products` RPC (an RPC because PostgREST cannot `order by` a similarity function).

Two tuning decisions, both measured on the real catalog and worth not relitigating:

- **`word_similarity`, not `similarity()`.** `similarity()` normalises over the whole string, so a short query against a long product name barely separates — "sharp tv 32" scored 0.35–0.40 against the actual Sharp TVs and 0.09–0.14 against Sharp refrigerators. `word_similarity` scores the best matching word extent: 1.00 vs 0.50 on the same data.
- **Threshold 0.45** — below pg_trgm's 0.6 default so real typos still land ("dinning" finds Dining Tables at 0.67), but not so low that noise creeps in: at 0.15, "fridg" returned Dining Tables and a Freezer. Literal substring matches get a 0.7 floor ("ref" finds every refrigerator that way); category substring matches a 0.25 floor. Top 12, active products only.

## Adding an item mid-contract, and the review queue

Catalog hygiene must never hold up a sale, so if the item isn't in the typeahead the admin can create it right there via `create_product_for_contract` — a deliberately separate RPC from `create_product` so the ordinary `/products` screen can never set the pending flag by accident. The new product lands with `review_status = 'pending'` and the RPC files an admin-team task ("Check new item: …"), reusing the tasks module as the notification channel instead of inventing a second mechanism.

`/products/review` (owner/admin) works the queue. For each pending item, `find_duplicate_candidates` returns the 8 closest approved products by **name** similarity (plain `similarity` is fine here — both sides are full product names); the client then combines in the **photo** signal by Hamming distance between dHashes.

**The dHash caveat — calibrated against the real catalog, do not restore textbook thresholds.** Across all 8,911 photo pairs the closest was 2 bits and the 5th percentile 19, and every one of the closest pairs is a *different* product (2 bits between two Acer laptops; 4 between a 1.5 HP and a 0.75 HP aircon). These are white-background studio shots with near-identical silhouettes, so dHash barely separates same-category items, and the conventional "≤5 = duplicate" would flag ten unrelated pairs. What a low distance *does* catch reliably is the same image file uploaded twice — the realistic duplicate, since a re-added item usually reuses the supplier's photo. So photo evidence is trusted only at **≤2 bits**, and name similarity leads the ranking.

The reviewer either **approves** (`approve_product` — the item is real, keep it) or **merges** (`merge_products`). A merge repoints everything on the duplicate — contracts, deliveries, stock movements, photos — onto the kept product *before* deleting it, folds the duplicate's `on_hand` into the kept product (its stock is real stock), then deletes the row and logs a completed admin task recording what was merged and how many contracts were repointed (products have no notes table; the task thread is the audit trail). **This is irreversible once it commits** — the UI makes it a two-step confirm, and there is no unmerge.
