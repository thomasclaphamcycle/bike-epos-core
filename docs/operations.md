# Operations Guide

## Backup And Restore

For operator-managed database backup and restore in local or non-production environments:

- `npm run db:backup`
- `npm run db:restore`

These scripts wrap the repo backup helpers under `scripts/backup_database.sh` and `scripts/restore_database.sh`.

Safety notes:

- `npm run db:restore` expects a PostgreSQL custom-format dump created by `scripts/backup_database.sh`
- set `COREPOS_CONFIRM_RESTORE=1` before running the restore command because it is destructive
- keep using the Export Hub for CSV/data handoff; use the DB backup scripts for full-instance recovery points
- `scripts/db_restore.sh` remains only as the legacy plain-SQL restore helper for deliberate older workflows

## Management Pages

- `/management`
  - dashboard and quick links
- `/management/actions`
  - grouped triage queue
- `/management/exceptions`
  - flat operational exception list
- `/management/investigations`
  - stock anomaly review queue
- `/management/product-data`
  - catalogue cleanup plus product CSV import preview and confirm
- `/management/catalogue`
  - supplier intake review plus manual supplier-product link management
- `/management/reminders`
  - internal service reminder candidates queue
- `/management/reordering`
  - purchasing prompts
- `/management/pricing`
  - margin and retail-price review
- `/management/capacity`
  - workshop backlog and ageing

## Severity Language

Manager-facing reporting pages should prefer the shared severity vocabulary:

- `CRITICAL`
- `WARNING`
- `INFO`

Business-specific statuses such as reorder urgency or reminder status can still exist, but they should map cleanly to the shared severity language in the UI.

## Practical Triage Order

1. Start in Action Centre for grouped operational review.
2. Use Operations Exceptions for the flat cross-functional queue.
3. Use Stock Investigations for item-level stock and pricing follow-up.
4. Move into the specific workflow surface:
   - inventory item
   - purchasing
   - workshop
   - customer profile

## Data Integrity Guardrails

CorePOS now blocks a small set of high-risk inventory and money writes earlier and more explicitly.

- POS basket checkout now refuses to post sale stock movements that would drive on-hand below zero at the active stock location.
  - blocked code: `SALE_STOCK_INSUFFICIENT`
- Purchase-order receiving now serializes receive requests on the same PO lines so concurrent receive calls cannot over-receive the same item.
  - blocked code: `PURCHASE_ORDER_OVER_RECEIVE`
- Payment intents now refuse to attach new payment collection to sales that are already settled or already completed through another route.
  - blocked codes: `SALE_ALREADY_PAID`, `SALE_ALREADY_COMPLETED`
- Sale completion and sale-tender mutation now share the same sale-row lock so tenders cannot race in after a sale has already been completed.
- Workshop-linked checkout now treats workshop finalization as the inventory-consumption boundary.
  - workshop part stock is consumed once at finalize time, not again when the linked sale is checked out
  - synthetic workshop labour lines are excluded from stock guards and stock movements

These guardrails are intentionally narrow:

- they protect against silent stock drift, duplicate financial side effects, and stale-state writes
- they do not add new approval steps or hidden auto-corrections
- they preserve explicit override-style behavior only where the existing service already supports it, such as intentional negative stock in dedicated inventory mutation flows

## Reminder Groundwork

Automated reminder groundwork is now present behind the event bus and is intentionally internal only.

- `workshop.job.completed` can create a persisted `ReminderCandidate` when the job has a real `completedAt` timestamp and a linked customer
- candidates store narrow groundwork fields only: customer, workshop job, source event, due date, status, and timestamps
- candidates can now also be marked reviewed or dismissed by managers for operational queue control
- the current default reminder due date is 90 days after workshop completion
- manager visibility is available through `GET /api/reports/reminder-candidates` and `/management/reminders`
- managers can now review or dismiss reminder candidates from the internal report/page without triggering delivery
- candidates are not delivered automatically and do not change customer-facing flows
- separate workshop notifications now use smart channel selection for quote-ready and ready-for-collection events, preferring one primary path with fallback across email, SMS, and WhatsApp only when needed
- staff can now manage simple operational communication permissions from the customer profile, and disabled channels are recorded as truthful notification skips rather than silent failures

Intentionally deferred:

- reminder email delivery, reminder SMS, push, or webhook delivery
- background schedulers and automated send orchestration
- public reminder APIs or customer-facing reminder management UI based on these candidates
- sale-driven reminder candidate creation until a concrete reminder policy exists for retail-only events

## Product CSV Import

The first product import flow is internal and manager-facing only.

- use `/management/product-data` to choose a CSV file, preview validation, and confirm the import
- preview calls `POST /api/products/import/preview`
- confirm calls `POST /api/products/import/confirm` and revalidates the same CSV before writing
- the import creates new products plus default variants only
- stock quantity, when supplied, is written as opening stock through inventory movements
- invalid rows are not imported; warnings remain visible during preview so managers can decide whether to continue

Intentionally deferred:

- supplier feed automation
- external catalogue sync
- image URL import
- updates/merge logic for existing product rows beyond duplicate detection

## Supplier Product Linking

Supplier-product linking groundwork is now available for internal purchasing use.

- use `/management/catalogue` to review existing supplier intake rows and manage supplier-product links
- links store a supplier-specific product code, supplier-specific cost, preferred supplier flag, and active state for a variant
- linked supplier cost is now used as the fallback when a manager adds a draft purchase-order line without entering unit cost manually
- `GET /api/supplier-product-links` provides staff-visible internal listing, while managers can create and update links through the same internal API family

Intentionally deferred:

- automated supplier feeds
- external supplier APIs
- full supplier catalogue sync
- advanced matching/deduplication
- automated PO creation from supplier links
