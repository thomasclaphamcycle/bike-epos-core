# CorePOS Development Roadmap

This document is the canonical forward-looking roadmap for CorePOS.
It must remain the master 11-phase planning structure for the project.

It should remain the master planning structure for the project and should be read alongside:

- [PLAN.md](/Users/thomaswitherspoon/Development/bike-epos-core/PLAN.md) for repo-history and milestone evidence
- [docs/ARCHITECTURE.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/ARCHITECTURE.md) for domain and system structure

CorePOS is evolving from a simple POS into a full bike shop operating system.

Development Rule:
- Only work on tasks in the current phase unless explicitly instructed.

Important planning note:

- `parts + labour bundle products` are intentionally not included here yet
- that feature remains pending internal discussion

## Current Progress Snapshot

The current codebase already contains substantial implementation across the early and middle roadmap phases:

- POS and cash-handling foundations are largely implemented
- product, inventory, stock movement, and purchasing foundations are largely implemented
- workshop operations are substantially implemented
- staff/admin/reporting surfaces are substantially implemented
- customer and communication features are only partially complete
- rental and online-store phases remain future work

The roadmap below remains the canonical planning structure even where current implementation is ahead in some areas and behind in others.
The phase count should not be collapsed or reduced unless the product strategy itself is intentionally changed.

---

## Phase 1 — POS & Cash Control (IN PROGRESS)

Purpose:
Run the till reliably with accountable cash handling.

Features:
- POS checkout UX
- basket editing
- barcode scanning workflow
- payment selection UI
- sale confirmation
- attach customer to sale

Cash register system:
- open register
- enforce register session
- close register
- expected vs counted cash
- X report
- Z report
- register audit log

Payments:
- cash
- card
- mixed payments
- refunds
- receipt generation

Milestone:
CorePOS can run day-to-day retail checkout and cash control confidently.

Implementation status:
- largely implemented on the current working line

---

## Phase 2 — Product Catalogue (PLANNED)

Purpose:
Give the shop a reliable, searchable product catalogue.

Features:
- create/edit product
- SKU
- barcode
- categories
- pricing
- product search

Milestone:
The shop can manage and search its sellable catalogue accurately.

Implementation status:
- largely implemented, with follow-on polish still possible around product data quality and supplier-linked enrichment

---

## Phase 3 — Inventory Control (PLANNED)

Purpose:
Keep stock levels trustworthy and operationally useful.

Features:
- stock levels
- stock adjustments
- stock movement history
- low stock alerts
- multiple locations
- workshop parts -> inventory deduction
  - parts used during repairs automatically reduce stock

Milestone:
The shop trusts inventory numbers and stock movement history.

Implementation status:
- largely implemented, with continued scope around replenishment refinement and multi-location depth

---

## Phase 4 — Stock Take (PLANNED)

Purpose:
Provide reliable count and reconciliation workflows.

Features:
- stock take
- cycle counting
- variance review
- reconciliation workflow

Milestone:
The shop can regularly verify and correct stock accuracy.

Implementation status:
- foundational stocktake support is implemented, with future room for workflow refinement

---

## Phase 5 — Purchasing (PLANNED)

Purpose:
Manage supplier ordering and stock receiving.

Features:
- supplier management
- purchase orders
- receive stock
- backorders
- product -> supplier linking

Milestone:
The shop can order and receive inventory through CorePOS.

Implementation status:
- substantially implemented on the current working line

---

## Phase 6 — Data Import / Export (PLANNED)

Purpose:
Handle migration, bulk updates, and supplier catalogue ingestion efficiently.

Import support:
- CSV import
- validation preview
- supplier CSV feeds
- product imports
- image URL imports

Typical import/export areas:
- customers
- products
- inventory
- suppliers
- price updates
- operational exports

Milestone:
CorePOS can ingest and export large datasets safely and efficiently.

Implementation status:
- partially implemented, with supplier-feed and import quality refinement still relevant

---

## Phase 7 — Supplier Integrations (PLANNED)

Purpose:
Automate supplier catalogue and availability updates where suppliers support it.

Features:
- supplier price feeds
- product imports
- validation preview
- image URL imports
- supplier stock feeds
- automated cost updates
- automated RRP updates
- product matching
- supplier stock visibility

Milestone:
Supplier catalogue and availability updates become automated where supported.

Implementation status:
- early groundwork exists, but this phase remains meaningfully future-facing

---

## Phase 8 — Workshop System (PLANNED)

Purpose:
Run the repair and service side of the bike shop digitally.

Workshop improvements:
- repair job queue
- workshop job tickets
- queue view
- job status tracking
- technician assignment
- workshop notes

Bike records:
- bike records linked to customers
- brand
- model
- year
- frame number
- wheel size
- notes

Bike service history:
- bike service history
- services per bike
- parts used
- labour performed
- technician
- service notes

Bike build queue:
- bike build queue
- track bikes awaiting assembly
- build status
- ready for pickup status

Inventory linkage:
- workshop parts -> inventory deduction

Customer workflow:
- estimates
- quote -> job conversion
- SMS notifications
- repair completion alerts
- two-way messaging
- customer notifications
- collection workflow

Milestone:
The shop can manage repair, service history, bike-build workflow, and workshop customer communication in one connected system.

Implementation status:
- substantially implemented, with additional bike-record depth and build-specific refinement still possible

---

## Phase 9 — Staff & Operations (PARTIAL)

Purpose:
Manage staff access, oversight, daily operations, and business reporting.

Features:
- user roles
- PIN login
- activity logs
- rota planning
- workshop capacity planning
- sales performance tracking
- mechanic performance tracking

Reports:
- sales reports
- register reports
- product performance
- workshop revenue
- dashboard views
- daily operational summaries

Milestone:
Managers and admins can operate, supervise, and measure the shop effectively.

Implementation status:
- substantially implemented on the current working line, with ongoing hardening and policy refinement

---

## Phase 10 — Rental Services (FUTURE)

Purpose:
Support bike hire and rental operations as a first-class flow.

Features:
- rental products
- availability tracking
- booking calendar
- deposits
- rental agreements
- collection and return workflow
- damage tracking

Calendar notes:
- rental and workshop should remain operationally separate calendars
- workshop calendar should display rental bookings as a secondary visibility overlay
- rental calendar does not need full workshop visibility by default

Milestone:
The shop can run bike rental operations through CorePOS.

Implementation status:
- planned, not yet a completed product line

---

## Phase 11 — Online Store & Website Builder (FUTURE)

Purpose:
Support customer-facing online workflows and eventually shop websites powered by CorePOS.

Embedded customer-facing tools:
- workshop booking widget
- service reminder booking links
- quote approval and other customer workflows where appropriate

Website platform:
- online store
- shop website builder
- content editor
- media library
- branding/themes
- embedded CorePOS modules

Milestone:
Shops can use CorePOS for customer-facing digital experiences and, later, for their website platform.

Implementation status:
- mostly future-facing
- customer communication groundwork exists, but the full online-store / website-builder phase is not yet complete
