# BIR books

Migration `0039`. Routes `/bir`, `/bir/expenses`, `/bir/suppliers`, export
`/api/export/bir-expenses`.

E & J is VAT-registered. Its tax books lived in Google Sheets: a monthly
Subsidiary Purchase Journal sent to the bookkeeper, and a Sales Journal built by
hand. **Phase 1 brings the expense side into the app.** The sales journal is
designed but not built — see the bottom of this page.

## The role is the interesting part

`is_active_user()` (`0001:46`) was **role-blind** — `id = auth.uid() and active`
— and it backs about **sixty policies**. A `bookkeeper` profile would therefore
have had read access to contracts, customers, payments and products the moment
the account was activated, which is the opposite of the point.

`0039` redefines that one function to mean **"an active user who is not a
bookkeeper"**, rather than editing sixty policies (sixty chances to miss one).
Nothing changes for the other five roles: no existing policy was ever written
with a bookkeeper in mind.

Two policies then had to be widened by hand, and both are load-bearing:

| Policy | Why |
|---|---|
| `profiles_select` | It reads through `is_active_user()`, so without `or id = auth.uid()` a bookkeeper cannot read **their own** profile. `getProfile()` returns null, middleware redirects to `/login`, and the account is unusable rather than merely restricted. |
| `suppliers_select` | The purchase journal is a list of supplier documents. A bookkeeper who cannot see suppliers cannot read the book. |

**If you ever wall off another role, add it to `is_active_user()` and re-check
exactly these two policies.** `tasks_select` (`0017:227`) also runs through
`is_active_user()`, which is why the bookkeeper deliberately has **no Tasks
link** and is **not** an assignable task team: the page would always be empty.

Helpers, beside the existing ones in `0011`:

| Helper | Who | Used for |
|---|---|---|
| `is_bookkeeper()` | bookkeeper | mirrors `is_collector()` |
| `can_see_bir()` | owner, admin, bookkeeper | every `select` policy and the export gate |
| `can_manage_bir()` | owner, admin | every write |

TS mirror: `canSeeBir()` in `src/lib/supabase/server.ts`. Writes gate on
`canPostPayments()`, which already means owner-or-admin and so matches
`can_manage_bir()` exactly.

## Who does what

| | owner | admin | bookkeeper |
|---|---|---|---|
| Open `/bir` | yes | yes | yes — and nothing else |
| Add / edit / void an expense | yes | yes | no |
| Add / edit a supplier | yes | yes | no |
| Export the CSV | yes | yes | yes |

Decided with Ryan on 2026-08-31: the office keeps the book, the bookkeeper
receives it.

## Two registrations, not one

E & J is **two VAT registrations on one base TIN**, and they file separately:

| Book | Registered name | TIN |
|---|---|---|
| Appliances | E & J APPLIANCES STORE | `437-961-107-00000` |
| Furniture | E & J FURNITURE STORE | `437-961-107-00001` |

Registered address: **Bogo, Tomas Oppus, Southern Leyte 6605**. All of this
lives in `BIR_BRANCHES` / `BIR_REGISTERED_ADDRESS` in `src/lib/bir.ts`, with the
TINs asserted in `bir.test.ts` — a wrong TIN on a book is a misfiled return.

This is why the Sales Journal has always kept Appliances and Furniture as
separate monthly columns, and it is why `bir_expenses.branch` exists.

**There are exactly two values, and no "shared".** 0039 shipped a third,
`shared`, for overhead that appeared to belong to neither. That was wrong:
utilities and salaries are paid by the **Appliances** registration (Ryan,
2026-08-31), and an unallocated bucket only produces rows that belong to
neither book and can therefore be filed in neither return. **0040** removed it,
moved any such row to Appliances, and made Appliances the default.

`/bir` totals each book separately; `/bir/expenses` filters by book; the export
takes `?branch=` and stamps the matching registered name and TIN on the file.
Exporting **All** is labelled *for review, not for filing*, because a combined
journal belongs to neither TIN.

`contracts.item_type` is already constrained to exactly `'Appliances' |
'Furniture'` (`0003`) — the same split — so Phase 2 can derive a sale's book
without anyone tagging it (`branchForItemType()`).

## The purchase journal

`bir_expenses`, one row per supplier document, mirroring the Expenses tab of the
General workbook.

- **The VAT split lives in SQL** (`bir_split()`), for the same reason
  `compute_terms()` does. `birSplit()` in `src/lib/bir.ts` is a TS **mirror**
  used only for the form's live preview; `BIR_SPLIT_CASES` in `bir.test.ts` are
  real rows from the sheet (₱2,015.10 → ₱1,799.20 + ₱215.90). Change one, change
  the other.
- It **rounds the vatable base and takes the input tax as the remainder**.
  Rounding both lets `vatable + input` miss the gross by a centavo, and the
  bookkeeper's workbook foots every column.
- **The amount is entered once, with a VAT switch**, not as the two columns the
  sheet has. Every row in the sheet fills either the VAT or the non-VAT column
  and never both, so two fields would only offer a way to get it wrong. The
  switch defaults from the supplier's `vat_registered` flag, which is the fact
  that decides it.
- `period_key` is `MMYYYY` **with no leading zero** — July 2021 is `72021` —
  matching the sheet so the export pastes straight in. Derived by the RPCs from
  `expense_date`, never set by hand.
- **Voided, never deleted**, like payments. There is no delete policy at all.
  A void needs a reason, and `audit_row_changes()` is attached — remember it is
  `after update` only, so a row created and then voided leaves **one** entry.
- `branch` says which registration the document belongs to (see above).
- Categories are the sheet's, with one correction: it spells one of them
  `OFFICE SUPPLES`. Any importer must map the old spelling across.

## The RR 7-2024 warning

Under RA 11976 (Ease of Paying Taxes) and RR 7-2024 the **Sales Invoice** is the
primary VAT document, and an **Official Receipt issued after 31 Dec 2024 is a
supplementary document that cannot support an input-tax claim**.

`orCannotClaimInputTax()` encodes that, and it surfaces twice: in the entry
dialog as you type, and as a banner over the period list — the list matters
because historical rows will arrive by import, not by typing. It is a **warning,
not a block**: SQL accepts the row. The call is the bookkeeper's.

## Suppliers

`suppliers` (from `0014`) is **extended, not duplicated** — the purchase journal
names the same vendors the delivery module orders stock from. New columns:
`tin`, `vat_registered`, `bir_name` (the registered name, when it differs from
the name on the signboard; the journal uses it).

`/bir/suppliers` warns about any supplier marked VAT-registered with no TIN,
because the journal needs it in the VAT REG NO. column.

## Export

`/api/export/bir-expenses?period=YYYY-MM` (or `YYYY-Qn`). Unlike the other four
datasets it is gated on `can_see_bir()` rather than owner-only, and it needs a
period filter and a supplier join — which is why it has its own path in
`src/app/api/export/[dataset]/route.ts` rather than a fifth `DATASETS` entry
bent out of shape. It reuses that file's `csvCell()` escaping (CSV injection,
0029), its `PAGE_SIZE` pagination with a stable sort, and its UTF-8 BOM.

Voided rows are excluded: a void means the document should never have been in
the book. Columns are the sheet's, in the sheet's order.

## The sales book

`bir_sales_entries` + `v_bir_sales_register` (**0041**), route `/bir/sales`,
export `/api/export/bir-sales`.

**Booked at the cash price**, `contracts.cash_price`, never `total_price`
(Ryan, 2026-08-31 — sales go to the bookkeeper as if sold for cash). On 4/5-month
Good-as-Cash terms the two are identical; they diverge at 6 months (cash × 1.225)
and 12 months (cash × 1.375). Contract 2026188 is the extreme case in the live
data: cash ₱29,900 against a term price of ₱41,112.50.

It is also the safer column for a filed book: a reprice moves `total_price` but
never `cash_price` (`0022`), so **a reprice cannot restate a month already
declared** — the trap that makes the analytics views' `sum(total_price)` rewrite
past months.

**The invoice number is always typed**, never minted or suggested. Each
registration has its own BIR-registered booklet, so the numbers are two
independent sequences. An app-assigned number would be a number the BIR series
does not know about — the same shape as the contract-number collision that came
out of the Sheet reconciliation. Two partial unique indexes hold the invariants
a pre-check cannot: one live booking per contract, and one use of an invoice
number **per branch** (the same number in the other book is legal, because it is
a different booklet).

**What the bookkeeper sees is the book, and only the book.** The unbooked
figure is internal — it is the office's working queue, not something the
bookkeeper is given (Ryan, 2026-08-31). Their `/bir/sales` reads
`bir_sales_entries` directly; owner and admin read `v_bir_sales_register`.

That is not UI hiding. RLS already enforces it: the register is
`security_invoker` and joins `contracts`, which `is_active_user()` walls the
bookkeeper out of, so **the view returns them zero rows whatever the page
asks**. That was in fact a bug — their sales page rendered empty — and
reading the entries table fixes it and meets the requirement in one change.
It works only because every column the book needs is snapshotted at booking:
customer, address, item, amount. The bookkeeper never needs `contracts`.

**The register is the point.** `v_bir_sales_register` is every contract with its
booking if it has one, so an undeclared sale is *visible* rather than absent.
`/bir/sales` shows, for the period: sold, booked, not yet booked, and the output
VAT both ways.

Two figures that are deliberately **not** netted: *booked* counts entries by
`sales_date` (the date written in the book), *sold* counts contracts by
`contract_date`. A sale made in July and booked in August appears in both, in
different periods. Subtracting them would invent a number that means nothing.

`branch` is derived from `contracts.item_type` — 0003 constrains it to
`Appliances`/`Furniture`, and all 1,544 live rows carry one, so nothing is
tagged by hand. Entries are **cancelled, never deleted**; a cancel frees the
invoice number and returns the sale to the queue.

## Still to come

- `/bir/vat` — a proper 2550Q worksheet. `/bir` already shows output less input
  per registration, which is the shape of it but not the return.
- **`scripts/import-bir-sales.ts` is written** — it backfills the sales book
  from the Sheet's **Contracts Database** tab, not from the Sales Journal.
  That is the important choice: the Sales Journal identifies a customer by
  name and amount with no contract number, and matching that way scored 43 of
  45 on real data — the two failures being two contracts for the same person
  at the same price, and a row declared at ₱29,900 against a ₱26,900 contract.
  Columns **R–T** (`Sales OR`, `Sales Date`, `Sales By`) already record which
  contract was booked, so the importer keys on contract number and guesses at
  nothing. It writes through `book_sale` while impersonating an owner, so
  every guard holds, and it never takes the amount from the CSV — a Sheet
  price that disagrees with `cash_price` is reported and skipped.
  A blank Sales Date falls back to the contract date; one that is present but
  unreadable is reported, because silently moving a sale into another period
  changes which return it belongs to.
- Importing the purchase journal is still to do.
- The Sheet's Sales Journal emits a row for **every calendar day**, including
  "No transaction" days. The export does not reproduce those — it is a
  presentation choice, and nobody has asked for it.

Open, and for a professional rather than for this repo: for **goods**, gross
sales is what the buyer "pays *or is obligated to pay*", so output VAT falls due
in full in the quarter of sale (the 25%-initial-payments rule that lets VAT
follow instalments is for **real property**). And the 22.5% / 37.5% uplift on
longer terms is a financing charge, which RR 16-2005 generally treats as part of
the VATable base.
