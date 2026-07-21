# E & J App — Developer Documentation

Technical reference for the E & J Appliances Furniture installment-sales app. The staff-facing manual is inside the app itself at `/help` (and the collector field manual at `/collections/sop`); these pages are for developers.

## Contents

| Page | What it covers |
|---|---|
| [architecture.md](architecture.md) | Stack, repo layout, auth gate, the server-action → RPC → RLS write path, the two-places business-math rule, design system, deploys |
| [database.md](database.md) | All 28 tables, every view (and the frozen-view rules), the full RPC catalog, triggers, RLS philosophy |
| [roles-and-permissions.md](roles-and-permissions.md) | The 5 roles, per-route access matrix, SQL guard helpers, user lifecycle |
| [modules/contracts-payments.md](modules/contracts-payments.md) | Contract lifecycle, terms math, cash sales, payments/void, repricing, repossession, status signals |
| [modules/collections.md](modules/collections.md) | Worklist, log → post pipeline, promises and receipt numbers, cash advances, GPS tagging, the two Messenger links |
| [modules/commissions-leads.md](modules/commissions-leads.md) | Commission lifecycle, DP-paid trigger, lead pipeline, agent restrictions |
| [modules/deliveries-inventory-products.md](modules/deliveries-inventory-products.md) | Delivery queue, suppliers, stock ledger, catalog, typeahead and duplicate review |
| [modules/payroll-dtr.md](modules/payroll-dtr.md) | Clock rules, geofence, holiday math, payslip snapshots, meal allowance, 13th month |
| [business-rules-legal.md](business-rules-legal.md) | Recto Law, mutuality, demand, Truth in Lending, Data Privacy, collection conduct, labor rules |
| [testing.md](testing.md) | Vitest, SQL verification scripts, and the Playwright e2e suite with its production-safety procedure |
| [operations.md](operations.md) | Deploy, backup/restore, migrations, imports, keep-alive, environments |

## How these docs stay current

CLAUDE.md carries a standing rule: **any commit that changes user-facing behavior, a route, a role's access, a business rule, or the schema must update the matching page here (and the in-app `/help` pages when staff behavior changes) in the same commit.** If you find drift, the code is the truth — fix the doc.
