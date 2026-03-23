# CorePOS Development Roadmap

This document is the canonical forward-looking roadmap for CorePOS.
It must remain the master 11-phase planning structure for the project.

It should remain the master planning structure for the project and should be read alongside:

- [PLAN.md](/Users/thomaswitherspoon/Development/bike-epos-core/PLAN.md) for repo-history and milestone evidence
- [docs/architecture.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/architecture.md) for domain and system structure
- [docs/roadmap_progress.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/roadmap_progress.md) for the computed scoring model and roadmap progress commands

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
- customer and communication features are now substantially implemented for workshop operations, with broader portal/self-service depth still future work
- rental and online-store phases remain future work

The roadmap below remains the canonical planning structure even where current implementation is ahead in some areas and behind in others.
The phase count should not be collapsed or reduced unless the product strategy itself is intentionally changed.

Progress percentages are no longer maintained manually in this document.
Use the computed roadmap commands instead:

- `npm run roadmap`
- `npm run roadmap:json`
- `npm run roadmap1`

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
- stocktake support is implemented on the current working line with expected snapshots, review/finalize workflow, and manager-facing React workflow, with future room for broader count-ops refinement

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

## Phase 8 — Workshop System (SUBSTANTIALLY IMPLEMENTED)

Purpose:
Run the repair and service side of the bike shop digitally.

Workshop improvements:
- repair job queue
- workshop job tickets
- queue view
- job status tracking
- technician assignment
- workshop notes
- workshop service templates
- workshop calendar day view
- customer workshop portal
- smart multi-channel customer notifications

Bike records:
- bike records linked to customers
- brand
- model
- year
- frame number
- wheel size
- frame size
- bike type
- groupset
- e-bike profile details
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
- two-way messaging
- quote approval
- customer portal job tracking
- smart notifications across email, SMS, and WhatsApp
- operational communication permissions
- collection workflow

Milestone:
The shop can manage repair, service history, bike-build workflow, and workshop customer communication in one connected system.

Implementation status:
- substantially implemented, with the remaining gap now concentrated in parity-polish features rather than missing workshop foundations
- reusable customer bike records now expose linked bike service history for workshop and customer staff flows, while still excluding truthful-but-unlinked legacy free-text jobs
- customer bike records now also support richer structured profile data plus compact staff editing for year, bike type, technical details, and e-bike metadata without breaking existing display naming
- known-bike workshop intake can now start directly from a customer bike profile or bike history view, preloading the linked customer and bike context into workshop check-in
- workshop estimates can now generate secure customer quote-review links, with customer approvals or rejections flowing back into the existing estimate history and audit trail without weakening stale-quote handling
- secure customer workshop portal access now extends those quote links into a broader read-only job view with customer-safe bike details, current work summary, customer-visible notes, and timeline context while preserving stale-quote approval protection
- workshop jobs now also have an additive backend scheduling foundation with optional timed slots, staff working hours, and workshop/staff time-off blocks, while keeping legacy `scheduledDate` flows operationally compatible
- workshop calendar now also has a production-ready backend API for date-range reads plus safe schedule/reschedule updates, so an MVP calendar UI can build on shared scheduling rules without breaking legacy workshop flows
- workshop now also has a staff-facing calendar MVP at `/workshop/calendar`, giving the team a day view of mechanic rows, timed jobs, working hours, time off, and a live unscheduled queue without replacing the existing job board
- workshop service templates now let staff define reusable labour-plus-parts job starters, apply them during check-in or on a live job, and fill an unset planning duration for calendar use without overwriting an already intentional timed schedule
- the `v1.1.0` workshop shaping pass now aligns execution, quote, and collection wording across workshop jobs, bike history, customer profiles, check-in, and customer quote review so the full workflow reads as one coherent milestone
- the workshop notification layer now uses deterministic smart delivery for quote-ready and ready-for-collection events, choosing one primary channel with truthful fallback, skip, and failure history across email, SMS, and WhatsApp
- workshop job detail now exposes notification history plus safe resend controls, so staff can review delivery outcomes and retry customer emails without leaving the live job
- customer profiles now include simple operational communication permissions for email, SMS, and WhatsApp, and smart workshop delivery respects those channel settings with truthful skip history when a customer has updates disabled

Remaining to practical Bikebook parity:

### 1. Two-way customer messaging

Why it matters:
- reduces inbound phone chasing and gives the workshop a single place to handle customer questions, approvals, and update replies

Current repo status / gap:
- one-way outbound notifications are delivered across email, SMS, and WhatsApp
- customer quote approval and portal access exist, but there is no reply capture, threaded conversation view, or staff-send messaging workflow

Rough implementation scope:
- add inbound/outbound conversation records tied to `WorkshopJob`
- introduce a narrow staff messaging surface on the workshop job and portal side
- wire reply-capable delivery handling into the existing notification/event foundation without replacing it

Classification:
- parity work

### 2. Attachments / photos

Why it matters:
- photos of damage, parts, and completed work are a practical day-to-day workshop need and are a frequent reason staff still fall back to ad-hoc tools

Current repo status / gap:
- customer-visible notes and bike profile data exist, but there is no upload/storage model for job photos, inspection images, or customer-safe attachments

Rough implementation scope:
- add additive attachment metadata plus file storage handling for workshop jobs
- support staff upload, internal visibility, and selective customer-visible sharing in the portal
- keep the first pass narrow to photos/documents rather than a full asset-management system

Classification:
- parity work

### 3. Working-hours / time-off admin UI

Why it matters:
- the calendar foundation is already operationally useful, but managers still need a practical way to maintain technician availability without direct database or request-level intervention

Current repo status / gap:
- `WorkshopWorkingHours`, `WorkshopTimeOff`, scheduling validation, calendar API, and calendar MVP UI are implemented
- there is no manager-facing UI yet to maintain recurring hours or planned time off

Rough implementation scope:
- add a compact manager/admin maintenance surface for technician hours and workshop/staff time off
- reuse the existing calendar validation layer and avoid introducing a second scheduling model
- include enough controls for daily operational maintenance, not full rota replacement

Classification:
- parity work

### 4. Customer portal polish

Why it matters:
- the first portal already reduces basic status and quote-query friction, but a tighter customer experience would reduce support load further and make the portal feel production-complete

Current repo status / gap:
- secure portal access, customer-safe notes, timeline context, and quote approval are implemented
- the portal still lacks richer status storytelling, stronger timeline detail, clearer collection guidance, and broader communication/context depth

Rough implementation scope:
- refine customer-safe status/timeline presentation
- add clearer collection and next-step guidance
- improve note/work-summary presentation and small-screen usability without turning the portal into a full customer account system

Classification:
- parity work

### 5. Public booking polish

Why it matters:
- public intake remains a practical parity expectation for modern workshop systems and is the clearest remaining bridge from internal scheduling to customer self-service acquisition

Current repo status / gap:
- workshop check-in, bike-led intake, templates, and calendar foundations exist internally
- there is still no polished public booking flow layered on top of those foundations

Rough implementation scope:
- add a narrow public booking/request flow that feeds the existing workshop intake model
- reuse bike/customer/workshop foundations where possible
- keep first pass focused on request capture and staff triage rather than full automated slot marketplace behaviour

Classification:
- parity work

---

## Phase 9 — Staff & Operations (PARTIAL)

Purpose:
Manage staff access, oversight, daily operations, and business reporting.

Features:
- user roles
- PIN login
- Store Info / business identity settings
- Store Info opening hours / shared trading schedule
- activity logs
- rota planning
- rota import foundations
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
- persisted Store Info now provides a central business-identity source for receipts, location-aware features, and future customer-facing profile surfaces
- Store Info now also provides the shared trading-hours source used by rota import and dashboard staffing interpretation
- dashboard Staff Today now reads from the live rota assignment layer for today and tomorrow coverage rather than depending on spreadsheet import as the only practical source
- Staff Rota now supports in-app six-week period creation plus week-by-week manager editing, while keeping spreadsheet import available for bulk loading and review
- Staff Rota now separates the day-to-day planner from admin-only rota tools, so weekly scheduling gets the main workspace while bank-holiday sync and spreadsheet import live under settings
- rota holiday requests now provide a lightweight staff-to-manager workflow that writes approved leave back into the live rota as HOLIDAY assignments
- holiday requests now include staff-facing request history plus manager decision notes, so the operational leave workflow is trackable without turning CorePOS into a leave-entitlement system
- Staff Rota now supports inline manager/admin day-level editing, keeping `RotaAssignment` as the live source of truth for imported, holiday-approved, and manually adjusted coverage
- Staff Rota now supports practical daily-use filters, print-friendly output, and active-staff visibility beyond imported spreadsheet rows so managers can schedule missing staff directly in-app
- rota spreadsheet workflow now supports manager-safe round-tripping with template download, current-period export, previewed update counts, and explicit `Off` clearing before any spreadsheet changes are applied
- UK bank holidays can now be synced from the official GOV.UK feed into `RotaClosedDay`, so rota import, editing, holiday approvals, and dashboard staffing all respect the same exceptional-closure layer
- workshop operations now surface rota-backed staffing visibility for the day, including scheduled cover, holiday absences, and closed-day reasons without introducing a separate attendance model
- staff management now includes lightweight operational role tagging so workshop views can prefer workshop-capable rota staff without changing auth roles or introducing a second scheduling model
- workshop operations now also surface a simple capacity signal that combines rota-backed workshop cover with due, overdue, and active workshop workload for better daily triage
- workshop jobs now also have an additive backend scheduling foundation with optional timed slots, staff working hours, and workshop/staff time-off blocks, while keeping legacy `scheduledDate` flows operationally compatible
- workshop calendar now also has a production-ready backend API for date-range reads plus safe schedule/reschedule updates, so an MVP calendar UI can build on shared scheduling rules without breaking legacy workshop flows
- workshop now also has a staff-facing calendar MVP at `/workshop/calendar`, giving the team a day view of mechanic rows, timed jobs, working hours, time off, and a live unscheduled queue without replacing the existing job board

Planned item:

### POS Basket Persistence (PARTIAL / MEDIUM)

Intent:
Implement POS basket persistence in stages so the active basket survives normal use now without prematurely locking CorePOS into the wrong long-term session model.

Phase 1 — Session Basket Persistence (Implemented):
- persist active basket ID in localStorage
- restore basket on POS load
- preserve basket across navigation
- clear basket on checkout / new sale
- recover safely from invalid or missing basket IDs
- backend remains the source of truth

Phase 2 — User / Till-Scoped Basket (Future):
- associate active basket with user and/or till session
- support recovery across login/logout and multiple tabs/devices
- define one-active-basket rules and conflict handling
- align the final model with till sessions and workshop handoff flows

Progress thresholds:
- partial = session persistence working
- complete = user/till-scoped persistence working

Architectural note:
- basket persistence is being implemented intentionally in stages so CorePOS can ship near-term session recovery without prematurely locking into the wrong long-term user/till session model

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
