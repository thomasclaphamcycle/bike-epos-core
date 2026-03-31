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
- workshop checkout now persists a single `WorkshopCheckoutOutcome` snapshot so concurrent idempotent retries replay one authoritative result instead of reconstructing success from sale/payment side effects
- ready jobs cannot be manually marked collected or closed unless a linked sale already exists
- `workshop.job.completed` should only represent actual completion, which keeps reminder-candidate generation aligned with real completed jobs

## Bike Lifecycle Scheduling Foundation

Customer bikes are no longer only historical workshop anchors. CorePOS now includes additive bike-owned lifecycle scheduling through `BikeServiceSchedule` and `src/services/bikeServiceScheduleService.ts`:

- each `CustomerBike` can carry multiple service schedules such as general service, brakes, drivetrain, suspension, or e-bike system checks
- schedules can track date cadence, mileage cadence, or both, while remaining explicitly staff-editable rather than inferred from brittle workshop-line parsing
- lifecycle state is derived centrally as `UPCOMING`, `DUE`, `OVERDUE`, or `INACTIVE`
- current v1 workflow is staff-managed from the customer/bike surfaces, including explicit create, edit, deactivate, and mark-serviced refresh actions
- bike history and customer bike responses now include lifecycle schedule data so the same bike record can answer both “what happened before?” and “what is due next?”

This is intentionally different from the existing internal reminder-candidate groundwork:

- `ReminderCandidate` remains an internal post-completion follow-up queue derived from completed workshop jobs
- `BikeServiceSchedule` is the bike-owned future service plan and the data foundation for later reminder automation
- automated reminder sending is still future work, so the system does not yet claim that service schedules automatically contact customers

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
  - currently listen to `workshop.quote.ready`, `workshop.job.ready_for_collection`, and `workshop.portal_message.ready`
  - create persistent `WorkshopNotification` rows for sent, skipped, failed, and duplicate-safe notification outcomes
  - send simple workshop customer messages through `src/services/notificationService.ts`, `src/services/emailService.ts`, `src/services/smsService.ts`, and `src/services/whatsappService.ts`
  - apply deterministic primary-channel selection plus fallback inside `notificationService.ts`, so quote-ready and portal-message alerts prefer WhatsApp then SMS then email, while ready-for-collection prefers SMS then WhatsApp then email
  - respect explicit per-customer operational channel permissions on `Customer.emailAllowed`, `Customer.smsAllowed`, and `Customer.whatsappAllowed` before attempting a delivery or fallback
  - default to log-mode delivery locally, while allowing SMTP email delivery plus Twilio-backed SMS and WhatsApp delivery from environment configuration
  - support simple channel gating via environment flags alongside staff-managed customer communication settings on the customer profile
- workshop customer conversation in `src/services/workshopConversationService.ts`
  - stores one additive `WorkshopConversation` per `WorkshopJob`, with timestamped `WorkshopMessage` rows for outbound staff portal messages and inbound customer portal replies
  - keeps customer conversation distinct from `WorkshopJobNote`, so internal notes and quote-only notes remain separate from the auditable customer thread
  - exposes staff-side thread retrieval and message posting under `/api/workshop/jobs/:id/conversation` plus `/messages`
  - exposes token-scoped public thread retrieval and reply posting under `/api/public/workshop/:token/conversation` plus `/messages`
  - currently uses the existing secure workshop portal token as the public access boundary, so v1 reply capture is portal-thread based rather than full email/SMS/WhatsApp webhook ingestion
- workshop attachments in `src/services/workshopAttachmentService.ts`
  - stores additive `WorkshopAttachment` rows against `WorkshopJob` with explicit `INTERNAL` vs `CUSTOMER` visibility, preserving the separation between internal operational context and customer-safe sharing
  - uses pragmatic local server-side storage under `uploads/workshop-attachments` in v1, with metadata persisted in Prisma and file serving kept behind staff auth or the existing secure portal token
  - exposes staff list/upload/delete plus authenticated file access under `/api/workshop/jobs/:id/attachments`
  - exposes token-scoped customer-visible attachment list/file access under `/api/public/workshop/:token/attachments`
  - intentionally keeps v1 narrow to image/PDF uploads without annotation, bulk asset management, or cloud-storage abstraction
- workshop calendar foundation in `src/services/workshopCalendarService.ts`
  - keeps the existing day-level `scheduledDate` contract intact while adding optional `scheduledStartAt`, `scheduledEndAt`, and `durationMinutes` on `WorkshopJob`
  - validates timed jobs against shared store opening hours first, then rota-derived staff availability when a technician is assigned
  - now treats live `RotaAssignment` rows as the primary workshop staff availability truth, with `WorkshopWorkingHours` retained only as a documented transition fallback on days that do not yet have rota coverage
  - keeps `WorkshopTimeOff` as a workshop-specific overlay on top of rota/fallback availability rather than a second base-hours system
  - blocks overlapping timed jobs for the same assigned staff member without forcing legacy unscheduled jobs through a new scheduling flow
  - now also exposes `GET /api/workshop/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD` for staff rows, rota-backed availability windows, time off, scheduled jobs, and clipped daily capacity summaries
  - now also exposes `PATCH /api/workshop/jobs/:id/schedule` for atomic assignment plus schedule/reschedule/clear operations through the shared validation layer rather than duplicating rules in controllers
  - the current staff-facing React scheduler now acts as the primary Workshop Operating Screen at `/workshop`, using the shared calendar read model plus schedule patch API for a real timed scheduling grid with week view first, day view second, list fallback, timed booking blocks, and quick schedule editing rather than introducing a separate scheduling subsystem
  - `/workshop/calendar` remains as a secondary standalone scheduler route that reuses the same shared timed scheduling surface rather than maintaining a separate calendar implementation
- workshop service templates in `src/services/workshopServiceTemplateService.ts`
  - store reusable workshop job starters in `WorkshopServiceTemplate` and `WorkshopServiceTemplateLine`, including labour lines plus optional part suggestions
  - expose manager CRUD under `/api/workshop/service-templates` and application to live jobs under `POST /api/workshop/jobs/:id/templates/apply`
  - apply templates by creating ordinary `WorkshopJobLine` records, then invalidating the current estimate through the existing estimate service so downstream quoting and approval workflows stay truthful
  - now support both standard service pricing and fixed-price service templates, where a single labour line rebalances against later job-line changes so practical fixed-price repairs stay on target
  - propagate `defaultDurationMinutes` into `WorkshopJob.durationMinutes` only when the job does not already have an intentional duration, which keeps calendar planning defaults additive instead of silently overwriting live schedule decisions
  - support compact staff usage during check-in and on the workshop job page, while manager maintenance lives at `/management/workshop/templates`
- workshop technician workflow in `src/services/workshopWorkflowService.ts`, `src/services/workshopStatusService.ts`, `frontend/src/features/workshop/status.ts`, `frontend/src/pages/WorkshopJobPage.tsx`, and `frontend/src/pages/WorkshopPage.tsx`
  - keeps the existing customer-facing execution status model intact, while the operational raw status model now centers on `BOOKED`, `BIKE_ARRIVED`, `IN_PROGRESS`, `WAITING_FOR_APPROVAL`, `WAITING_FOR_PARTS`, `ON_HOLD`, `READY_FOR_COLLECTION`, `COMPLETED`, and `CANCELLED`
  - keeps quote approval owned by the estimate approval flow instead of treating `APPROVED` as a long-lived raw workshop state, while `BIKE_ARRIVED` remains distinct from `IN_PROGRESS` so bike check-in and active bench work do not collapse into the same operational state
  - surfaces a compact technician workflow summary, blocker context, and assignment coverage on the live workshop job and board views without creating a separate technician-only subsystem
- workshop analytics and management reporting in `src/services/reports/workshopReports.ts`, `src/controllers/reportController.ts`, `src/routes/reportRoutes.ts`, and `frontend/src/pages/WorkshopPerformancePage.tsx`
  - now exposes `GET /api/reports/workshop/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD` for one shared management payload covering turnaround, quote conversion, technician throughput, and stalled-job reporting
  - reuses existing workshop job timestamps, estimate decisions, and current assignment fields rather than inventing speculative tracking tables, so the metrics stay grounded in the actual workshop model
  - keeps v1 honest by reporting technician throughput from the current job assignee, quote conversion from requested estimate versions in-range, and blocked-stage age from the best available timestamps or explicit proxies where exact stage-entry tracking does not yet exist
  - the existing manager route `/management/workshop` and `/workshop/analytics` now act as the main workshop reporting surface, while `/management/capacity` and `/management/workshop-ageing` remain narrower follow-up views
- customer workshop portal in `src/services/workshopEstimateService.ts` and `frontend/src/pages/WorkshopQuotePage.tsx`
  - reuses the existing secure customer quote token on `WorkshopEstimate.customerQuoteToken` rather than creating a parallel public-access model
  - exposes `GET /api/public/workshop/:token` for a customer-safe portal payload containing a derived customer-progress summary, bike summary, current estimate/work summaries, customer-visible notes, and a minimal timeline
  - now also exposes token-scoped conversation retrieval and reply posting so the portal carries a real job thread instead of staying quote-only
  - now also exposes customer-visible workshop attachments so staff-shared photos and PDFs appear inside the same secure job portal without leaking internal-only files
  - keeps approval and rejection on the same estimate-decision workflow, so `POST /api/public/workshop/:token/decision` stays idempotent and still blocks stale or superseded quote approval
  - the frontend portal now treats that payload as a mobile-first customer summary surface with clearer next-step guidance, progress wording, and tighter hierarchy for status, quote, messages, attachments, notes, and timeline data
  - preserves existing `/quote/:token` frontend links and `/api/public/workshop-quotes/:token` API aliases for compatibility while new generated links point to `/public/workshop/:token`
- public workshop booking flow in `src/services/workshopBookingService.ts`, `src/routes/workshopBookingRoutes.ts`, and the public SPA pages
  - exposes `GET /api/workshop-bookings/public-form` for customer-safe booking metadata such as store contact context, booking settings, and active service-template summaries
  - keeps `POST /api/workshop-bookings` as the single public booking intake entrypoint, while now accepting richer request capture for bike details, service choice, preferred timing, and issue summary without breaking older minimal clients
  - keeps `GET|PATCH /api/workshop-bookings/manage/:token` as the secure booking follow-up surface, now returning a structured `bookingRequest` summary alongside the existing booking fields so public pages can render trustworthy request details without exposing internals
  - the public SPA now uses `/site/book-workshop` for request capture and `/site/bookings/:token` for token-scoped follow-up, while staying honest that the customer is requesting a preferred date rather than claiming a confirmed live mechanic slot

Manager-facing internal visibility now exists through:

- `GET /api/reports/reminder-candidates`
- `POST /api/reports/reminder-candidates/:reminderCandidateId/review`
- `POST /api/reports/reminder-candidates/:reminderCandidateId/dismiss`
- the React management route `/management/reminders`

These surfaces are internal visibility and control only. They expose reminder-candidate rows for review, dismissal, and linking back into customer/workshop flows, but they still do not perform reminder delivery.

Reminder groundwork remains intentionally internal only. Customer-facing workshop delivery now includes quote/share notifications, secure portal access, and a portal-thread conversation model, but push notifications, broader customer self-service account management, and full external-channel reply ingestion remain intentionally out of scope, while workshop time-slot scheduling now has an additive backend foundation plus a week-first staff scheduling grid and lightweight in-calendar editing rather than a separate scheduling subsystem.
