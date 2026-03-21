# CorePOS Architecture

## Layers

- `src/server.ts`: Express entrypoint and production SPA serving.
- `src/routes/`: route registration and role guards.
- `src/controllers/`: request parsing, response shaping, and narrow transport logic.
- `src/services/`: business logic and workflow services.
- `src/services/reports/`: modular reporting services grouped by domain.
- `src/lib/prisma.ts`: Prisma client wrapper.
- `frontend/src/`: React SPA pages, shared API client, auth context, and management UI.

## Reporting Structure

The reporting layer is intentionally split by domain:

- `salesReports.ts`
- `inventoryReports.ts`
- `purchasingReports.ts`
- `pricingReports.ts`
- `workshopReports.ts`
- `customerReports.ts`
- `operationsReports.ts`
- `shared.ts`

`src/services/reportService.ts` is a compatibility facade that re-exports the modular report functions for the controller layer.

## Management Reporting Surfaces

- `/management/actions`: grouped manager action queue.
- `/management/exceptions`: unified cross-functional exception list.
- `/management/investigations`: stock-focused anomaly queue.
- `/management/reordering`: buying suggestions from stock, sales, and open POs.
- `/management/pricing`: pricing and margin exception queue.
- `/management/product-data`: catalogue cleanup plus product CSV import preview/confirm.
- `/management/catalogue`: supplier catalogue intake plus supplier-product link management.
- `/management/reminders`: internal reminder-candidate queue for manager visibility.
- `/management/capacity`: workshop backlog and ageing view.

## Multi-Location Inventory Foundation

Inventory groundwork now treats stock as location-aware while preserving existing single-location behavior:

- `StockLocation` is the operational inventory-location model for stock such as shop floor, workshop, storage, or warehouse
- `StockLedgerEntry` is the authoritative on-hand ledger and carries `locationId` on every stock-affecting entry
- `InventoryMovement` remains as the compatible movement/history surface and now also carries `locationId` where available
- existing inventory flows still default to the primary stock location when no explicit `locationId` is provided
- purchasing receiving, stock adjustments, workshop part usage, and sales/returns continue to work without API breakage while remaining compatible with transfer/location workflows
- stock transfers now exist as an additive operational workflow through `StockTransfer` and `StockTransferLine`
  - transfers move through `DRAFT -> SENT -> RECEIVED`
  - stock only moves on transfer receipt
  - receipt posts paired `TRANSFER` ledger/movement records out of the source location and into the target location

This remains intentionally narrow. It does not yet introduce transfer reservations, in-transit valuation, location-specific replenishment rules, or location-aware POS picking UX.

## Bike Hire Foundations

CorePOS now includes a narrow first-pass bike hire workflow that stays additive to existing sales, workshop, and inventory behavior:

- `HireAsset` tracks a real hire fleet bike against an existing catalogue `Variant`
- `HireBooking` links a hire asset to a `Customer` with reserved, checked-out, returned, and cancelled states
- deposits are tracked independently from normal retail checkout through `HireDepositStatus`
- current API surface lives under `/api/hire`
  - `GET|POST /api/hire/assets`
  - `GET|POST /api/hire/bookings`
  - `POST /api/hire/bookings/:id/checkout`
  - `POST /api/hire/bookings/:id/return`
  - `POST /api/hire/bookings/:id/cancel`
- manager-facing workflow currently starts from `/management/hire`

This is groundwork only. It does not yet implement fleet maintenance scheduling, online booking, damage charging workflows, or tight payment/till reconciliation for deposits.

## Configuration Foundation

CorePOS now includes a small persisted configuration layer for operational defaults:

- Prisma model `AppConfig`
  - stores additive key/value settings using a simple JSON payload per key
  - is intended for gradual expansion rather than a large one-shot settings schema
- backend service `src/services/configurationService.ts`
  - centralizes setting defaults and validation
  - exposes a typed manager-facing snapshot instead of scattering raw config lookups
- manager API surface
  - `GET /api/settings`
  - `PATCH /api/settings`
- manager UI surface
  - `/management/settings`

This foundation is intentionally narrow. Existing specialist settings models such as receipt settings and workshop booking settings remain in place, while future operational defaults can move into the shared configuration layer gradually.

## Workshop Handoff Safety

Workshop collection is now treated as a sale-linked handoff rather than a manual status toggle:

- ready jobs should move into POS through the existing workshop finalize-to-basket flow or the explicit workshop checkout flow
- POS checkout for a finalized workshop basket must preserve the workshop linkage on the resulting sale
- ready jobs cannot be manually marked collected or closed unless a linked sale already exists
- `workshop.job.completed` should only represent actual completion, which keeps reminder-candidate generation aligned with real completed jobs

## Product Import Flow

The first product CSV import flow is intentionally narrow and internal:

- `POST /api/products/import/preview`
  - parses CSV text, maps practical product columns, and returns row-level errors and warnings
  - does not write products
- `POST /api/products/import/confirm`
  - revalidates the same CSV using the preview key before writing
  - creates new `Product` and default `Variant` rows only for eligible rows
  - can create opening stock through internal inventory movements when stock quantity is supplied

This flow is manager-only groundwork for manual catalogue loading. It does not automate supplier feeds, catalogue matching, or external ingest.

## Supplier Product Linking Groundwork

Supplier integration groundwork now includes a narrow internal supplier-to-variant linkage model:

- Prisma model `SupplierProductLink`
  - stores `supplierId`, `variantId`, `supplierProductCode`, `supplierCostPence`, `preferredSupplier`, and `isActive`
  - keeps one link row per supplier + variant pair
- internal API surface under `GET|POST|PATCH /api/supplier-product-links`
  - staff can list links
  - managers can create and update links
- purchasing integration
  - draft PO line creation now prefers the active supplier-link cost for that supplier + variant when unit cost is left blank
  - receiving still remains manual and does not introduce any automation
- manager UI integration
  - `/management/catalogue` now exposes manual link management on top of the existing supplier intake view

This is groundwork only. It does not implement supplier feeds, external supplier APIs, advanced matching, or automated PO generation.

## Event Foundation

`src/core/events.ts` provides a minimal internal event bus with `emit()` and `on()`.
`src/core/eventSubscribers.ts` registers a tiny diagnostic subscriber set during server startup.
`src/core/reminderSubscribers.ts` registers internal reminder groundwork subscribers.

It exists as a safe extension point for future integrations and internal automation. Current emitted events are:

- `sale.completed`
- `purchaseOrder.received`
- `workshop.job.completed`
- `workshop.quote.ready`
- `workshop.job.ready_for_collection`
- `stock.adjusted`

These emissions are additive only. They do not change route behavior or API contracts. Internal subscribers may now perform narrow internal persistence where explicitly documented.

Current internal subscribers are:

- diagnostic subscribers in `src/core/eventSubscribers.ts`
  - keep a small in-memory ring buffer of recent events for development-time inspection
  - can emit concise `[eventbus] ...` structured logs when `EVENT_BUS_DEBUG=1`
- reminder groundwork subscribers in `src/core/reminderSubscribers.ts`
  - currently listen to `workshop.job.completed`
  - only create or refresh internal `ReminderCandidate` records when the job is actually completed and linked to a customer
  - derive a default `dueAt` at 90 days after completion and store `PENDING`, `READY`, or `DISMISSED`
  - preserve idempotency by keeping at most one reminder candidate per workshop job
- notification subscribers in `src/core/notificationSubscribers.ts`
  - currently listen to `workshop.quote.ready` and `workshop.job.ready_for_collection`
  - create persistent `WorkshopNotification` rows for sent, skipped, failed, and duplicate-safe notification outcomes
  - send simple workshop customer messages through `src/services/notificationService.ts`, `src/services/emailService.ts`, `src/services/smsService.ts`, and `src/services/whatsappService.ts`
  - default to log-mode delivery locally, while allowing SMTP email delivery plus Twilio-backed SMS and WhatsApp delivery from environment configuration

Manager-facing internal visibility now exists through:

- `GET /api/reports/reminder-candidates`
- `POST /api/reports/reminder-candidates/:reminderCandidateId/review`
- `POST /api/reports/reminder-candidates/:reminderCandidateId/dismiss`
- the React management route `/management/reminders`

These surfaces are internal visibility and control only. They expose reminder-candidate rows for review, dismissal, and linking back into customer/workshop flows, but they still do not perform reminder delivery.

Reminder groundwork remains intentionally internal only. Customer-facing workshop delivery now exists only for the narrow quote-ready and ready-for-collection notification events above; push notifications, webhooks, customer preferences, and background scheduling remain intentionally out of scope.
