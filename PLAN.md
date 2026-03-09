# CorePOS Plan

## Summary

CorePOS is a bike-shop staff platform spanning EPOS, workshop operations, stock control, receipts, refunds, till cash-up, reporting, and admin/auth workflows. The repo also contains a React frontend for key staff journeys while retaining server-rendered pages and printable HTML flows.

This file now reflects the exact repo-wide milestone ledger from `M1` to `M78`, not just the current `dev-next` working tree.

## Evidence Legend

- `Confirmed`: explicit evidence exists in committed code, migrations, request files, smoke tests, frontend files, or commit history
- `Inferred`: strong structural evidence exists, but the milestone label is not explicitly present in the current branch history

## Current Checkpoints

- Current local-working checkpoint: `v1.2-demo-running` / `stable-demo` / `c1fbf7c`
- Repo-wide deploy/demo checkpoint visible in remote history: `v1.2-demo-ready` / `5e8fa54`

## Branch Reality

The repo has diverged milestone lines:

- `dev-next`
  - current local working line
  - confirmed local dev setup, React app, demo seed, and working migrations
  - does not contain every later milestone commit as direct ancestry
- `origin/main`
  - confirmed merged line through `M69`, `M70` to `M73`, and `M76` to `M78`
- `origin/react-ui`
  - confirmed React/demo line through `M69` and React UI work for `M76` to `M78`
- `origin/backend-v1`
  - confirmed backend/security/retail line including `M73` and `M76` to `M78`
- historical milestone commits in repo history
  - confirmed `M44` to `M60`

Implication:

- the repo history has confirmed milestone evidence through `M78`
- the current `dev-next` branch is not yet the single consolidated branch containing every one of those milestone commits

## Exact Milestone Ledger

| Milestone | Status | Evidence |
| --- | --- | --- |
| `M1` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M2` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M3` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M4` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M5` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M6` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M7` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M8` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M9` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M10` | Historical foundation milestone not individually evidenced | First repo milestones begin at `M11`; earliest commits `bf63797` and `3c85f10` already contain initialized project foundations without numbered milestone labels. |
| `M11` | Confirmed | `scripts/workshop_checkout_deposit_tests.js`, `package.json` `test:m11`, `M12_CLOSEOUT.md`. |
| `M12` | Confirmed | `scripts/workshop_m12_smoke_tests.js`, `package.json` `test:m12`, `M12_CLOSEOUT.md`. |
| `M13` | Confirmed | `scripts/workshop_m13_smoke_tests.js`, auth/permission/report behavior in code and tests. |
| `M14` | Confirmed | `scripts/workshop_m14_smoke_tests.js`, `requests/workshop.http` M14 sections, workflow code. |
| `M15` | Confirmed | Commit `40bff02`, migration `20260304230000_m15_inventory_core`. |
| `M16` | Confirmed | Commit `ca9b5b0`, migration `20260304233000_m16_workshop_parts`, `scripts/workshop_m16_smoke_tests.js`. |
| `M17` | Confirmed via code evidence | Migration `20260304235500_m17_suppliers_purchase_orders`, `scripts/purchasing_m17_smoke_tests.js`, purchasing routes/services. |
| `M18` | Confirmed | Migration `20260305002000_m18_stocktake_sessions`, `scripts/stocktake_m18_smoke_tests.js`. |
| `M19` | Confirmed | `scripts/reports_m19_smoke_tests.js`, reporting services/routes. |
| `M20` | Confirmed via code evidence | `docs/REPORTS_UI_MANUAL_TEST.md` titled `Reports UI (M20)`, `src/views/reportsPage.ts` M20 note. |
| `M21` | Likely merged into another milestone | Commit `d312d5d` says `M25 product & variant catalog + M21 migration checksum fix`. |
| `M22` | Confirmed | `scripts/reports_csv_m22_smoke_tests.js`, CSV reporting endpoints/utilities. |
| `M23` | Likely merged into another milestone | No plain `M23` artifact found; `M23b` exists in smoke/docs as reports UI follow-on. |
| `M24` | Confirmed | Migration `20260304222948_m24_inventory_ledger_single_location`, `scripts/inventory_m24_smoke_tests.js`. |
| `M25` | Confirmed | Commit `d312d5d`, migration `20260305010000_m25_product_variant_catalog`, `scripts/catalog_m25_smoke_tests.js`. |
| `M26` | Confirmed | `scripts/stocktake_m26_smoke_tests.js`, `requests/stocktake_ui_m26.http`. |
| `M27` | Confirmed | `scripts/purchase_orders_m27_smoke_tests.js`, `requests/purchase_orders_m27.http`. |
| `M28` | Confirmed | `scripts/pos_m28_smoke_tests.js`, `requests/pos_m28.http`, basket routes alias comments. |
| `M29` | Confirmed | `scripts/products_m29_smoke_tests.js`, `requests/products_m29.http`. |
| `M30` | Confirmed | Migration `20260305120000_m30_workshop_job_lines`, `scripts/workshop_m30_smoke_tests.js`. |
| `M31` | Confirmed | Migration `20260305133000_m31_payment_intents`, `scripts/payments_m31_smoke_tests.js`. |
| `M32` | Confirmed | Migration `20260305150000_m32_sale_completion_receipts`, `scripts/sales_m32_smoke_tests.js`. |
| `M33` | Confirmed | `scripts/inventory_adjust_m33_smoke_tests.js`, `requests/inventory_adjust_m33.http`. |
| `M34` | Confirmed | Migration `20260305160000_m34_customers`, `scripts/customers_m34_smoke_tests.js`, tag `v0.1-m34`. |
| `M35` | Confirmed | Commit `82775b6`, migrations `20260305170000_m35_real_auth` and `20260305201000_m35_user_table_map`, `scripts/auth_m35_smoke_tests.js`. |
| `M36` | Confirmed | Commit `82775b6`, `scripts/admin_m36_smoke_tests.js`, admin services/controllers/routes. |
| `M37` | Confirmed | Commit `82775b6`, migration `20260305180000_m37_till_cashup`, `scripts/till_m37_smoke_tests.js`. |
| `M38` | Confirmed | Commit `e815665`, `scripts/navigation_m38_smoke_tests.js`, `requests/navigation_m38.http`. |
| `M39` | Confirmed | Commit `d24ecb0`, migration `20260305213000_m39_sale_tenders`, `scripts/pos_tenders_m39_smoke_tests.js`. |
| `M40` | Confirmed | Commit `9fd50aa`, migration `20260305223000_m40_receipts_v1`, `scripts/receipts_m40_smoke_tests.js`. |
| `M41` | Confirmed | Commit `e088b48`, migration `20260306010000_m41_refunds_v1`, `scripts/refunds_m41_smoke_tests.js`. |
| `M42` | Confirmed | Commit `e6c7982`, migration `20260306020000_m42_cash_management_v1`, `scripts/cash_m42_smoke_tests.js`. |
| `M43` | Confirmed | Commit `ab3ac47`, `scripts/manager_ui_m43_smoke_tests.js`, `requests/manager_ui_m43.http`. |
| `M44` | Confirmed | Commit `e75d48f`, migration `20260306030000_m44_purchase_orders_v1`, request + smoke artifacts in commit history. |
| `M45` | Confirmed | Commit `3592124`, migration `20260306040000_m45_goods_receiving_v1`, request + smoke artifacts in commit history. |
| `M46` | Confirmed | Commit `854690c`, migration `20260306050000_m46_supplier_management_v1`, request + smoke artifacts in commit history. |
| `M47` | Confirmed | Commit `5abf19b`, request `customers_m47.http`, smoke `customers_m47_smoke_tests.js` in commit history. |
| `M48` | Confirmed | Commit `da4e7e2`, request `customer_sales_m48.http`, smoke `customer_sales_m48_smoke_tests.js` in commit history. |
| `M49` | Confirmed | Commit `e47d541`, request `workshop_m49.http`, smoke `workshop_m49_smoke_tests.js` in commit history. |
| `M50` | Confirmed | Commit `c2ee514`, request `workshop_lines_m50.http`, smoke `workshop_lines_m50_smoke_tests.js` in commit history. |
| `M51` | Confirmed | Commit `4dfd32c`, request `workshop_convert_sale_m51.http`, smoke `workshop_convert_sale_m51_smoke_tests.js` in commit history. |
| `M52` | Confirmed | Commit `9621c70`, migration `20260305174012_m52_stock_reservations`, request + smoke artifacts in commit history. |
| `M53` | Confirmed | Commit `fd8352b`, request `workshop_reservation_consume_m53.http`, smoke `workshop_reservation_consume_m53_smoke_tests.js` in commit history. |
| `M54` | Confirmed | Commit `49f3db6`, request `workshop_workflow_m54.http`, smoke `workshop_workflow_m54_smoke_tests.js` in commit history. |
| `M55` | Confirmed | Commit `9700943`, request `workshop_print_m55.http`, smoke `workshop_print_m55_smoke_tests.js` in commit history. |
| `M56` | Confirmed | Commit `009e6c3`, request `sale_receipt_m56.http`, smoke `sale_receipt_m56_smoke_tests.js` in commit history. |
| `M57` | Confirmed | Commit `979481d`, migration `20260306060000_m57_audit_log`, request + smoke artifacts in commit history. |
| `M58` | Confirmed | Commit `4cfd9ca`, request `data_export_m58.http`, smoke `data_export_m58_smoke_tests.js` in commit history. |
| `M59` | Confirmed | Commit `4bce473`, request `health_check_m59.http`, smoke `health_check_m59_smoke_tests.js` in commit history. |
| `M60` | Confirmed | Commit `b26f115`, docs `architecture/api_reference/database_schema/deployment` in commit history. |
| `M61` | Obsolete or dropped from the plan | No `M61` artifact exists on any ref; commit history moves from `M60` into unnumbered security/infra/frontend work before milestone numbering resumes at `M63`. |
| `M62` | Obsolete or dropped from the plan | No `M62` artifact exists on any ref; commit history moves from `M60` into unnumbered security/infra/frontend work before milestone numbering resumes at `M63`. |
| `M63` | Confirmed via code evidence | React POS app exists in `frontend/src/pages/PosPage.tsx`, auth shell in `frontend/src/App.tsx` and `frontend/src/auth/AuthContext.tsx`. |
| `M64` | Confirmed via code evidence | React workshop pages exist in `frontend/src/pages/WorkshopPage.tsx` and `frontend/src/pages/WorkshopJobPage.tsx`; backend support commit `e04ce92`. |
| `M65` | Confirmed via code evidence | React inventory pages now exist in `frontend/src/pages/InventoryPage.tsx` and `frontend/src/pages/InventoryItemPage.tsx`, with routing/nav in `frontend/src/App.tsx` and `frontend/src/components/Layout.tsx`, backed by existing inventory/variant/stock endpoints. |
| `M66` | Confirmed via code evidence | React customer pages exist in `frontend/src/pages/CustomersPage.tsx` and `frontend/src/pages/CustomerProfilePage.tsx`. |
| `M67` | Confirmed | Commit `c6e014d`, demo seed system, `scripts/seed_demo_data.js` in commit history and current `scripts/seed_demo_data.ts`. |
| `M68` | Confirmed | Commit `9cf227e`, docs/frontend + React demo UX polish in commit history. |
| `M69` | Confirmed | Commit `5e8fa54`, backend serves `frontend/dist`, build/start scripts, deployment docs. |
| `M70` | Confirmed | Commit `39ec3a5`, request IDs and API error hardening. |
| `M71` | Confirmed | Commit `2d24646`, `docs/operations.md`, `scripts/db_backup.sh`, `scripts/db_restore.sh` in commit history. |
| `M72` | Confirmed | Commit `577e401`, expanded security/auth regression automation. |
| `M73` | Confirmed | Commit `c512370`, migration `20260305231237_m73_multilocation_groundwork`, `scripts/locations_m73_smoke_tests.js` in commit history. |
| `M74` | Merged into another milestone | Planned cloud/deploy readiness concerns are covered across `M59` deployment hardening, `M69` production packaging, `M70` hardening, `M71` ops runbook, and `M72` CI/security automation; no separate `M74` artifact exists. |
| `M75` | Merged into another milestone | Staff management and permission-hardening concerns are already implemented across `M36` admin user management, `M57` audit logging, and `M72` security regression work; no separate `M75` artifact exists. |
| `M76` | Confirmed | Backend commit `1781647` plus frontend commit `a34fa49`; request + smoke + React POS scanner UX in commit history. |
| `M77` | Confirmed | Backend commit `401c5e2` plus frontend commit `7938c31`; refund return-to-stock/exchange + manager UI in commit history. |
| `M78` | Confirmed | Backend commit `47df647` plus frontend commit `7f06056`; daily close backend/print/UI in commit history. |

## Phase Map

### Phase 1 - Core Infrastructure

Confirmed milestones:

- `M11` workshop deposit checkout baseline
- `M12` workshop money lifecycle
- `M13` workshop ops dashboard, auditability, and permission shaping
- `M14` workshop workflow follow-on
- `M16` workshop parts linkage
- `M17` suppliers and purchasing foundations
- `M18` stocktake sessions
- `M19` reporting
- `M19.1` workshop completed-at regression/backfill
- `M22` CSV reporting
- `M23b` reports UI

Confirmed evidence:

- milestone smoke scripts under `scripts/`
- migrations up through stocktake/catalog/auth/till eras
- current backend controllers/services/routes

### Phase 2 - Inventory + POS

Confirmed milestones:

- `M24` inventory ledger single-location support
- `M25` product and variant catalog
- `M26` stocktake follow-on UI/API
- `M27` purchase orders baseline
- `M28` POS basket and checkout
- `M29` products APIs/search
- `M30` workshop job lines
- `M31` payment intents
- `M32` sale completion and receipts groundwork
- `M33` inventory adjustments

Confirmed evidence:

- `scripts/inventory_m24_smoke_tests.js`
- `scripts/catalog_m25_smoke_tests.js`
- `scripts/stocktake_m26_smoke_tests.js`
- `scripts/purchase_orders_m27_smoke_tests.js`
- `scripts/pos_m28_smoke_tests.js`
- `scripts/products_m29_smoke_tests.js`
- `scripts/workshop_m30_smoke_tests.js`
- `scripts/payments_m31_smoke_tests.js`
- `scripts/sales_m32_smoke_tests.js`
- `scripts/inventory_adjust_m33_smoke_tests.js`

### Phase 3 - Sales + Customers

Confirmed milestones:

- `M34` customers core
- `M39` sale tenders
- `M40` receipts v1
- `M41` refunds v1
- `M42` cash management v1
- `M43` manager cash/refunds views
- `M44` purchase orders v1
- `M45` goods receiving v1
- `M46` supplier management v1
- `M47` customers v1 UI/API
- `M48` customer-to-sale linking and customer sales history
- `M49` workshop jobs v1 board/job card
- `M50` workshop estimate line items

Confirmed evidence:

- explicit milestone commits for `M44` to `M50`
- current or historical request files and smoke scripts
- commit history:
  - `e75d48f` `M44`
  - `3592124` `M45`
  - `854690c` `M46`
  - `5abf19b` `M47`
  - `da4e7e2` `M48`
  - `e47d541` `M49`
  - `c2ee514` `M50`

Inferred:

- some M47 to M50 style capabilities remain visible in `dev-next` code even though the original milestone commits are not direct ancestors of that branch

### Phase 4 - Authentication

Confirmed milestones:

- `M35` real auth
- `M36` admin user management
- `M37` till cash-up
- `M38` authenticated app shell and routing

Confirmed evidence:

- `scripts/auth_m35_smoke_tests.js`
- `scripts/admin_m36_smoke_tests.js`
- `scripts/till_m37_smoke_tests.js`
- `scripts/navigation_m38_smoke_tests.js`
- current auth middleware, controllers, and routes

### Phase 5 - React Frontend

Confirmed milestones:

- `M63` React POS v1
  - confirmed in code, but not explicitly labeled by milestone commit on this branch
- `M64` React workshop dashboard and job detail
  - confirmed in code, plus backend support commit `e04ce92`
- `M65` React inventory UI
  - confirmed in code
- `M66` React customers UI
  - confirmed in code
- `M79` React staff dashboard
  - confirmed in code on the current working line
- `M80` React inventory management tools
  - confirmed in code on the current working line
- `M81` React supplier and purchasing UI
  - confirmed in code on the current working line
- `M82` React workshop board
  - confirmed in code on the current working line
- `M83` React workshop estimates and approvals
  - confirmed in code on the current working line
- `M67` demo seed system
- `M68` demo UX polish
- `M69` production packaging with backend-served React build

Confirmed evidence:

- frontend app in `frontend/src/`
- `frontend/src/pages/PosPage.tsx`
- `frontend/src/pages/WorkshopPage.tsx`
- `frontend/src/pages/WorkshopJobPage.tsx`
- `frontend/src/pages/InventoryPage.tsx`
- `frontend/src/pages/InventoryItemPage.tsx`
- `frontend/src/pages/CustomersPage.tsx`
- `frontend/src/pages/CustomerProfilePage.tsx`
- `frontend/src/pages/DashboardPage.tsx`
- `frontend/src/pages/SuppliersPage.tsx`
- `frontend/src/pages/PurchasingPage.tsx`
- `frontend/src/pages/PurchaseOrderPage.tsx`
- `frontend/src/pages/WorkshopPage.tsx` board presentation
- `scripts/seed_demo_data.ts`
- `origin/main` / `origin/react-ui` commits:
  - `c6e014d` `M67`
  - `9cf227e` `M68`
  - `5e8fa54` `M69`

Confirmed but branch-specific:

- `M76` React POS barcode/keyboard UX: `a34fa49`
- `M77` React manager refunds UI: `7938c31`
- `M78` React daily close UI: `7f06056`

Confirmed on current working line without a historical milestone-labeled commit:

- `M65` React inventory UI is now present on the current working line via code evidence, though it is not backed by a historical milestone-labeled commit
- `M79` React staff dashboard is present on the current working line via code evidence
- `M80` React inventory management tools are present on the current working line via code evidence
- `M81` React supplier and purchasing UI is present on the current working line via code evidence
- `M82` React workshop board is present on the current working line via code evidence
- `M83` React workshop estimates and approvals are present on the current working line via code evidence

### Phase 6 - Security / Infrastructure

Confirmed milestones:

- `M56` sale receipt printing
- `M57` audit logging
- `M58` admin data export
- `M59` deployment readiness
- `M60` architecture and deployment documentation
- `M70` observability and API error hardening
- `M71` operations runbook and DB backup/restore scripts
- `M72` expanded auth/security regression automation
- `M73` multi-location groundwork

Confirmed evidence:

- explicit milestone commits and associated files:
  - `009e6c3` `M56`
  - `979481d` `M57`
  - `4cfd9ca` `M58`
  - `4bce473` `M59`
  - `b26f115` `M60`
  - `39ec3a5` `M70`
  - `2d24646` `M71`
  - `577e401` `M72`
  - `c512370` `M73`

### Phase 7 - Retail Features

Confirmed milestones:

- `M51` workshop job to sale conversion
- `M52` parts reservation for workshop jobs
- `M53` consume reservations on sale completion
- `M54` workshop lifecycle rules and reservation release
- `M55` workshop printable estimate/job card
- `M76` barcode endpoint and scanner-first POS UX
- `M77` return-to-stock refunds, exchanges, and refund UI/backend
- `M78` daily close report backend, print view, and manager UI

Confirmed evidence:

- explicit milestone commits:
  - `4dfd32c` `M51`
  - `9621c70` `M52`
  - `fd8352b` `M53`
  - `49f3db6` `M54`
  - `9700943` `M55`
  - `1781647` backend `M76`
  - `a34fa49` frontend `M76`
  - `401c5e2` backend `M77`
  - `7938c31` frontend `M77`
  - `47df647` backend `M78`
  - `7f06056` frontend `M78`

## Repo-Wide Milestone Summary

### Confirmed Through Current Repo History

- baseline implementation history reaches `M78`
- strongest continuous evidence after `M43` exists via explicit commits for:
  - `M44` to `M60`
  - `M67` to `M69`
  - `M70` to `M73`
  - `M76` to `M78`

### Confirmed In Code But Not Explicitly Labeled As Milestones On Current Branch

- `M63` React POS v1
- `M64` React workshop UI
- `M66` React customers UI

### Missing Or Not Yet Confirmed

- The previously missing milestone set has been reconciled; `M65` is now implemented on the current working line
- `M1` to `M10` are best treated as pre-ledger historical foundation work without individual surviving labels
- `M61` to `M62` appear to be dropped milestone numbers rather than missing implementations
- `M74` to `M75` are best treated as scope absorbed into neighboring milestones, not standalone missing deliveries

## Near-Term Priorities

1. Consolidate branch history so `dev-next` does not under-represent repo progress after `M43`.
2. Decide whether `dev-next` should absorb:
   - `M44` to `M60` historical milestone work
   - `M70` to `M73`
   - `M76` to `M78`
3. Consolidate the now-complete React staff surface and add stronger end-to-end coverage for it.
4. Expand automated coverage for the React frontend flows already present.
5. Do a dedicated hygiene pass for tracked junk files and stale docs.

## Next Development Phase - Management & Reporting Platform

Current state:

- the React staff platform now includes:
  - POS
  - Workshop
  - Inventory
  - Customers
  - Suppliers
  - Purchasing
- the current working line now includes:
  - `M79` staff dashboard
  - `M80` inventory management tools
  - `M81` supplier and purchasing UI
  - `M82` workshop board
  - `M83` estimates and approvals
  - `M84` parts allocation workflow
  - `M85` management dashboard
- the workshop operations expansion batch is now complete through `M84`
- the next planned phase is management-facing reporting and oversight:
  - `M86` sales analytics
  - `M87` workshop performance metrics

### Next Milestones

#### `M79` - Staff Dashboard

Goal:

- create a central React dashboard page for staff

Planned scope:

- today's sales summary
- open workshop jobs
- low stock alerts
- quick navigation to POS, Workshop, Inventory, and Customers
- recent system activity

Planned frontend entry:

- `frontend/src/pages/DashboardPage.tsx`

Notes:

- reuse existing report, workshop, inventory, and audit endpoints where practical
- if recent activity or low-stock alert data is not exposed cleanly enough for the dashboard, add the smallest additive backend endpoint needed
- implemented on the current working line via code evidence

#### `M80` - Inventory Management Tools

Goal:

- extend the React inventory surface from browse/detail into practical stock operations

Planned scope:

- stock adjustments
- inventory movement history improvements
- reorder alerts
- better filtering and sorting

Notes:

- build on top of the new React inventory pages from `M65`
- prefer the existing inventory adjustment and movement APIs over new parallel contracts
- implemented on the current working line via code evidence
- uses raw on-hand stock-state indicators only; no reorder-threshold model has been introduced

#### `M81` - Supplier And Purchasing UI

Goal:

- expose existing purchasing and receiving backend capabilities through the React UI

Planned scope:

- suppliers list
- purchase orders
- goods receiving

Notes:

- reuse the existing supplier, purchase-order, and receiving endpoints already present in repo history/current backend where available
- keep the initial UI operational and additive rather than redesign-heavy
- implemented on the current working line via code evidence
- keeps receiving inside `/purchasing/:id` for v1

#### `M82` - Workshop Board

Goal:

- create a React workshop board view for operational workflow

Planned scope:

- columns for booked / in progress / waiting parts / ready / completed
- quick movement between states
- quick job visibility
- links into workshop job detail

Planned frontend entry:

- `frontend/src/pages/WorkshopBoardPage.tsx` or a board mode within `frontend/src/pages/WorkshopPage.tsx`

Notes:

- reuse the existing workshop dashboard and job status endpoints where possible
- keep the first version operational rather than highly animated or Kanban-heavy
- preserve the current workshop list/detail flows as a fallback, even if the board becomes the preferred view
- implemented on the current working line via code evidence
- uses frontend display buckets only and does not introduce new backend workshop statuses

#### `M83` - Estimates And Approvals

Goal:

- add estimate and approval workflow to workshop jobs

Implemented scope on the current working line:

- estimate creation
- labour + parts preview
- approval status
- quote notes

Notes:

- implemented on the current working line via code evidence
- estimate contents reuse existing workshop job lines
- quote messaging reuses existing internal and customer-visible workshop notes
- waiting-for-approval visibility is now surfaced in workshop board/list and job detail views
- the only backend extension added is the explicit additive approval endpoint:
  - `POST /api/workshop/jobs/:id/approval`
- approval state is persisted on the existing raw workshop job status, not a separate estimate entity

#### `M84` - Parts Allocation Workflow

Goal:

- connect workshop jobs to stock allocation

Implemented scope on the current working line:

- reserve parts to job
- consume parts to job
- missing-parts visibility
- waiting-for-parts state support

Notes:

- implemented on the current working line via code evidence
- reuses the existing `WorkshopJobPart` + stock ledger + inventory movement primitives
- adds location-aware reservation accounting by persisting `stockLocationId` on workshop parts
- prevents over-reserving beyond available stock at the selected stock location
- keeps waiting-for-parts workflow honest by surfacing shortage state in job detail and the workshop board without inventing new raw workshop statuses

#### `M85` - Management Dashboard

Goal:

- create a high-level management dashboard for managers

Implemented scope on the current working line:

- daily revenue
- workshop workload
- open estimates awaiting approval
- jobs waiting for parts
- low stock alerts
- today’s sales count
- quick links to key operational pages

Frontend entry:

- `frontend/src/pages/ManagementDashboardPage.tsx`

Notes:

- implemented on the current working line via code evidence
- keeps this manager-focused and practical rather than presentation-heavy
- reuses the existing sales daily report, workshop dashboard, and inventory on-hand search endpoints
- preserves the current staff dashboard at `/dashboard` and introduces a separate manager-only route at `/management`

#### `M86` - Sales Analytics

Goal:

- add manager-facing sales reporting and trend analysis

Implemented scope on the current working line:

- daily / weekly / monthly revenue
- average basket size

Frontend entry:

- `frontend/src/pages/SalesAnalyticsPage.tsx`

Notes:

- implemented on the current working line via code evidence
- keeps this manager-only and separate from `/management`
- reuses `/api/reports/sales/daily` as the primary data source
- derives weekly rollups, monthly rollups, and average basket size client-side
- intentionally does not include revenue by category, product, or service in v1 because the current branch does not expose those breakdowns cleanly without widening backend scope

#### `M87` - Workshop Performance Metrics

Goal:

- add manager-facing workshop performance reporting

Implemented scope on the current working line:

- jobs completed per day
- average completion time
- waiting-for-approval count
- waiting-for-parts count
- technician / staff workload where current data supports it

Frontend entry:

- `frontend/src/pages/WorkshopPerformancePage.tsx`

Notes:

- implemented on the current working line via code evidence
- keeps this manager-only and separate from `/management` and `/management/sales`
- reuses `/api/reports/workshop/daily` and `/api/workshop/dashboard` only
- keeps the page summary-first with compact cards and tables rather than charts
- shows staff workload from existing assignment data and groups missing assignments under `Unassigned`

## Long-Term Direction

CorePOS is clearly evolving toward a unified staff platform with:

- fast counter workflows
- strong workshop operations
- auditable money and stock flows
- reliable local and deployment workflows
- a React frontend backed by stable Express/Prisma services

The next architectural goal should not be random feature addition. It should be consolidation: one coherent branch story, one up-to-date roadmap, and one clearly supported UI strategy.

## Next Development Phase - Business Intelligence

Current state:

- the management and reporting platform now includes:
  - `M85` management dashboard
  - `M86` sales analytics
  - `M87` workshop performance metrics
- the current working line now also includes:
  - `M88` product sales analytics
  - `M89` inventory velocity
  - `M90` supplier performance
- this first business intelligence batch is now complete through `M90`
- the next operational planning and administration batch is now complete through `M93`

### Next Milestones

#### `M88` - Product Sales Analytics

Goal:

- add a manager-facing product sales analytics surface

Implemented scope on the current working line:

- top selling products
- lowest selling products
- product sales totals over selected range

Frontend entry:

- `frontend/src/pages/ProductSalesAnalyticsPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/products`
- uses a focused additive backend report endpoint under `/api/reports/sales/products`
- intentionally omits category-level product sales because the current branch does not expose a clean category model

#### `M89` - Inventory Velocity

Goal:

- add manager-facing inventory intelligence

Implemented scope on the current working line:

- fast-moving products
- slow-moving products
- dead stock candidates
- stock velocity / sell-through style signals

Frontend entry:

- `frontend/src/pages/InventoryVelocityPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/inventory`
- uses a focused additive backend report endpoint under `/api/reports/inventory/velocity`
- keeps the first version practical and table-based without forecasting or speculative replenishment logic

#### `M90` - Supplier Performance

Goal:

- add manager-facing supplier performance reporting

Implemented scope on the current working line:

- supplier-linked purchasing summary
- purchase order counts / receiving activity
- honest overdue-open purchase order visibility

Frontend entry:

- `frontend/src/pages/SupplierPerformancePage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/suppliers`
- uses a focused additive backend report endpoint under `/api/reports/suppliers/performance`
- intentionally omits supplier revenue contribution and lead-time analytics because the current branch does not support those honestly enough yet

## Next Development Phase - Finance & Daily Operations Oversight

Current state:

- the current working line now also includes:
  - `M91` reorder suggestions
  - `M92` workshop capacity analytics
  - `M93` staff / role management UI
  - `M94` audit and activity UI
  - `M95` customer insights / CRM summary
  - `M96` purchase order action centre
  - `M97` refunds / exceptions oversight
  - `M98` cash / till oversight dashboard
  - `M99` end-of-day / ops summary
- this batch is now complete through `M99`

### Next Milestones

#### `M91` - Reorder Suggestions

Goal:

- add manager-facing reorder suggestions based on current stock and recent sales signals

Implemented scope on the current working line:

- suggested reorder candidates
- current on-hand
- recent sales over selected range
- simple suggested reorder quantity
- practical reorder urgency flags

Frontend entry:

- `frontend/src/pages/ReorderSuggestionsPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/reordering`
- reuses the existing inventory velocity report endpoint without widening backend scope
- uses a simple 30-day coverage heuristic and does not pretend to model supplier lead time or automated purchasing

#### `M92` - Workshop Capacity Analytics

Goal:

- add manager-facing workshop capacity visibility

Implemented scope on the current working line:

- jobs per day
- current open queue
- waiting for approval count
- waiting for parts count
- average jobs completed per day
- estimated queue pressure / backlog days
- assignment workload summary where existing data supports it

Frontend entry:

- `frontend/src/pages/WorkshopCapacityPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/capacity`
- reuses `/api/reports/workshop/daily` and `/api/workshop/dashboard` only
- keeps backlog pressure estimates honest by deriving them directly from open queue and average daily completions, with a clear no-data fallback

#### `M93` - Staff / Role Management UI

Goal:

- expose staff and role management in the React UI for admins according to the current backend rules

Implemented scope on the current working line:

- list staff users
- create staff users
- edit staff details
- activate/deactivate users
- assign roles

Frontend entry:

- `frontend/src/pages/StaffManagementPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds an admin-only route at `/management/staff`
- reuses the existing `/api/admin/users` endpoints and preserves the current admin-only backend permission model
- keeps the UI operational and does not redesign authentication or user lifecycle beyond the existing admin surface

#### `M94` - Audit & Activity UI

Goal:

- add a manager-facing audit and recent activity surface in React

Implemented scope on the current working line:

- recent system activity list
- date, entity, entity-id, and action filters using the existing audit API
- local actor filtering over the returned rows
- practical operational visibility rather than forensic audit tooling

Frontend entry:

- `frontend/src/pages/ActivityPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/activity`
- reuses the existing `/api/audit` endpoint without widening backend scope
- keeps actor filtering honest by applying it client-side because the current backend filter surface does not expose actor filtering

#### `M95` - Customer Insights / CRM Summary

Goal:

- add manager-facing customer insights using existing customer, sales, workshop, and credit data

Implemented scope on the current working line:

- customer summary metrics
- repeat customers
- high-value customers
- recent customer activity
- workshop-active customers
- credit / balance context

Frontend entry:

- `frontend/src/pages/CustomerInsightsPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/customers`
- uses a focused additive backend report endpoint under `/api/reports/customers/insights`
- keeps the metrics practical and avoids speculative CRM scoring or marketing segmentation

#### `M96` - Purchase Order Action Centre

Goal:

- add a manager-facing purchasing operations page focused on actionability, not just reporting

Implemented scope on the current working line:

- open purchase orders needing action
- overdue purchase orders
- partially received purchase orders
- supplier, status, created date, and expected date visibility
- prioritised operational queue rather than a replacement for the detailed purchasing UI

Frontend entry:

- `frontend/src/pages/PurchaseOrderActionPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/purchasing`
- reuses the existing `/api/purchase-orders` endpoint without widening backend scope
- complements the detailed purchasing workspace instead of replacing it

#### `M97` - Refunds / Exceptions Oversight

Goal:

- add a manager-facing oversight page for refunds and exception-style refund activity

Implemented scope on the current working line:

- recent refunds
- refund totals over selected range
- refund count
- large refund visibility derived from current totals
- cash refund visibility using current tender mix

Frontend entry:

- `frontend/src/pages/RefundOversightPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/refunds`
- reuses the existing `/api/refunds` endpoint without widening backend scope
- keeps exception visibility honest by using current refund size and cash mix only, not unsupported anomaly scoring

#### `M98` - Cash / Till Oversight Dashboard

Goal:

- add a manager-facing cash and till oversight dashboard

Implemented scope on the current working line:

- till sessions / cash-ups summary
- open tills
- recent cash movements
- cash variance visibility where current data supports it

Frontend entry:

- `frontend/src/pages/CashOversightPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/cash`
- reuses the existing `/api/till/sessions`, `/api/till/sessions/current`, `/api/till/sessions/:id/summary`, `/api/cash/summary`, and `/api/cash/movements` endpoints only
- keeps this as an oversight surface and does not replace the operational till workflows

#### `M99` - End-of-Day / Ops Summary

Goal:

- add a manager-facing end-of-day operational summary page

Implemented scope on the current working line:

- today sales summary
- refund summary
- workshop summary
- purchasing summary
- low stock / reorder attention items
- open action items carried into tomorrow

Frontend entry:

- `frontend/src/pages/OperationsSummaryPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/summary`
- reuses the existing sales, refunds, workshop dashboard, purchasing, and inventory endpoints without widening backend scope
- keeps this as a readable daily control-centre page and does not introduce scheduling, notifications, or export logic

#### `M100` - Notifications & Alerts Centre

Goal:

- add a manager-facing alerts and notifications centre that consolidates operational attention items already detectable from current data

Implemented scope on the current working line:

- low stock alerts
- reorder-now candidates
- jobs waiting for approval
- jobs waiting for parts
- overdue purchase orders
- refund attention items derived from current refund totals

Frontend entry:

- `frontend/src/pages/AlertsCentrePage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/alerts`
- composes existing inventory velocity, workshop dashboard, purchasing, and refunds endpoints without widening backend scope
- keeps the page operational and grouped by attention type rather than pretending to be a push-notification system

#### `M101` - Saved Views / Manager Filters

Goal:

- add reusable saved filters and views for manager reporting and oversight pages

Implemented scope on the current working line:

- save current filter state for selected management pages
- reload saved views
- basic rename and delete support
- manager-only scope
- local per-user persistence without backend schema or auth changes

Frontend entry:

- `frontend/src/pages/SavedViewsPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/views`
- integrates saved-view controls into:
  - `/management/sales`
  - `/management/workshop`
  - `/management/reordering`
  - `/management/activity`
  - `/management/purchasing`
- uses browser-local persistence per signed-in user and does not introduce a backend personalization system in v1

#### `M102` - Export Hub / Management Downloads

Goal:

- add a manager-facing export and download hub for operational and reporting outputs already supported by the system

Implemented scope on the current working line:

- central place to access available CSV/report exports
- clear descriptions of each export
- direct links to existing export endpoints
- simple date-range and filter inputs where the existing endpoints already support them

Frontend entry:

- `frontend/src/pages/ExportHubPage.tsx`

Notes:

- implemented on the current working line via code evidence
- adds a dedicated manager-only route at `/management/exports`
- reuses the existing sales, workshop, inventory, payments, and till CSV endpoints only
- keeps the first version practical and synchronous, with no export job queue or new export engine
