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
- `/management/reminders`: internal reminder-candidate queue for manager visibility.
- `/management/capacity`: workshop backlog and ageing view.

## Event Foundation

`src/core/events.ts` provides a minimal internal event bus with `emit()` and `on()`.
`src/core/eventSubscribers.ts` registers a tiny diagnostic subscriber set during server startup.
`src/core/reminderSubscribers.ts` registers internal reminder groundwork subscribers.

It exists as a safe extension point for future integrations and internal automation. Current emitted events are:

- `sale.completed`
- `purchaseOrder.received`
- `workshop.job.completed`
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

Manager-facing internal visibility now exists through:

- `GET /api/reports/reminder-candidates`
- the React management route `/management/reminders`

These surfaces are internal visibility only. They expose reminder-candidate rows for review and linking back into customer/workshop flows, but they still do not perform delivery.

Reminder groundwork is intentionally internal only. It does not send SMS, email, push notifications, or webhooks, and it does not include background scheduling or delivery orchestration yet.
