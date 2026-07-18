---
name: business-management
description: Business rules and decision-making context for E & J Appliances Furniture — credit, collections, pricing, and operations.
---

# Business Management — E & J Appliances Furniture

Business context for an appliance/furniture retailer in Southern Leyte, PH operating an installment (hulugan/patong) system.

---

## 1. 🏪 Business Model

- **Installment sales** — customer pays 25% downpayment, then monthly installments over 4, 5, 6, or 12 months
- **Good-as-Cash (4/5 months):** total = cash price (no interest) — for customers who can pay quickly
- **6-month terms:** +30% effective interest (cash×1.3×0.75 + cash×0.25)
- **12-month terms:** +50% effective interest (cash×1.5×0.75 + cash×0.25)
- **No third-party financing** — the store itself carries the credit risk
- Target market: rural/semi-urban households who can't pay upfront

---

## 2. 💳 Credit & Risk Assessment

When evaluating whether to approve a contract:

| Factor | What to check |
|--------|---------------|
| **Payment history** | Has this customer paid on time before? Check existing/previous contracts |
| **Existing balance** | Do they still owe on another contract? Total exposure = sum of all balances |
| **Phone reachability** | Do they have a working contact number? Required |
| **Address quality** | Is the address specific enough for collections? |
| **Messenger account** | Strongly preferred — enables soft collection |
| **Contract count** | 3+ paid-off contracts = trusted customer |
| **No contact info** | ⚠️ Red flag — difficult to collect |

**Rules of thumb:**
- A first-time customer with no references: keep initial contract small (₱5K–₱15K cash price)
- Returning customer with good history: can approve larger amounts
- Customer with past-due balance on an active contract: do NOT approve a new contract until caught up
- Blacklisted customers: never approve (status = `blacklisted`)

---

## 3. 📢 Collections Strategy

### Tier System (automated by the app)

| Tier | Trigger | Message | Action |
|------|---------|---------|--------|
| **1 — Check-in** | Last payment was 1 month overdue | Friendly "hi, just checking if everything's ok" | Staff calls or messages |
| **2 — Friendly overdue** | Last payment was 2 months overdue | "Reminder that your balance is due, can you visit the store?" | More persistent contact |
| **3 — Formal demand** | Last payment was 3+ months overdue | Formal demand letter with amount due | Print demand letter, consider home visit |

### Collection Principles

- **Be professional but firm.** Delinquency is common in the hulugan system — don't burn bridges unnecessarily
- **Always offer a partial payment option** — "kahit magkano muna" (even just something) keeps goodwill
- **Payment arrangements** — if the customer genuinely can't pay, agree on a revised schedule rather than ignoring it
- **Messenger is the primary channel** — it's less confrontational than a phone call
- **Home visits** — bring the printed demand letter; use the Map link for navigation
- **Escalate to owner** for:
  - Aggressive/difficult customers
  - Legal action decisions
  - Writing off bad debt

---

## 4. 💵 Payment Handling

- **Accept GCash** as the primary digital payment method
  - GCash number: **09069029261** (Ruel Ryan Rosal)
- **Cash** accepted in-store
- **Always issue a receipt** — print from the app
- **Partial payments are allowed** — record whatever amount the customer gives
- **Never delete a payment** — use the void/restore system for corrections
- **OR number** (Official Receipt) should be recorded when available for cash payments

### Reconciliation
- Payment records should reconcile to the peso — the app currently tracks ₱24.2M reconciled to the centavo
- If a payment entry seems wrong, investigate before voiding — check the customer's history

---

## 5. 📊 Key Business Metrics

| Metric | What it tells you | Action if bad |
|--------|-------------------|---------------|
| **Outstanding balance** | Total money owed to the store | Track trend over time |
| **Overdue amount** | Payments past due | Focus collections here |
| **Collected this month** | Cash inflow | Compare to expected |
| **Open contracts** | Active deal flow | Growing = good, but watch credit quality |
| **Aging receivables** | How old is the overdue money | >6 months old → likely bad debt |
| **Top customers** | Who pays the most | Build relationships here |

---

## 6. 🛒 Product Knowledge

- **Appliances:** refrigerators, washing machines, televisions, air conditioners, electric fans, rice cookers, etc.
- **Furniture:** cabinets, beds, sofas, dining sets, tables, chairs
- Items are categorized as `Appliances` or `Furniture` (enforced by DB constraint)
- Pricing is based on cash price; installment terms are computed from cash price

---

## 7. 🧾 Operational Rules

| Area | Rule |
|------|------|
| **Deleting data** | Never. Void payments, never delete. Update contract status, never delete. |
| **Audit trail** | All changes to contracts track who did it and when |
| **Owner approval needed** | Voiding payments, editing contract terms, creating staff accounts, CSV exports |
| **Data backups** | Export CSVs weekly from Admin page |
| **Staff limits** | Staff can record payments and view data — cannot edit contracts, access analytics, or export data |
| **Customer PII** | Never commit customer data to GitHub (names, phones, addresses stay in Supabase) |

---

## 8. 🇵🇭 Local Context

- **Currency:** Philippine Peso (₱)
- **Language:** Products are described in English; customer interactions mix English and Cebuano/Bisaya
- **Timezone:** Asia/Manila (UTC+8) — all time-dependent calculations use this
- **Typical customer:** Rural households, may not have stable internet — the app should work well on mobile data
- **Seasonal patterns:** Sales peak around Christmas (13th month pay), dip after New Year
- **Common practice:** "Pa-ekstra" — adding extra items to an existing contract rather than creating a new one
  - If a customer with an active contract wants to add more items, strongly consider whether to amend the existing contract (not yet implemented) or create a separate one

---

## 9. ⚠️ Anti-Patterns to Flag

| Pattern | Why it's bad | What to suggest instead |
|---------|-------------|------------------------|
| Allowing unlimited 12-month terms without DP verification | Increases bad debt risk | Verify 25% DP was actually collected |
| Granting credit without any contact info | Uncollectible | Require at least phone or Messenger |
| Staff voiding payments | Breaks audit trail | Only owner can void |
| Storing full customer PII in GitHub/CSVs outside Supabase | Data exposure risk | Keep in DB, export only via Admin |
| Hard-deleting a contract or payment | Loses financial history | Use status flags instead |
