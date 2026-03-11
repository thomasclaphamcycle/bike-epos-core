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
- `/management/reminders`: customer follow-up queue.
- `/management/capacity`: workshop backlog and ageing view.

## Event Foundation

`src/core/events.ts` provides a minimal internal event bus with `emit()` and `on()`.

It exists as a safe extension point for future integrations and internal automation. Current emitted events are:

- `sale.completed`
- `purchaseOrder.received`
- `workshop.job.completed`
- `stock.adjusted`

These emissions are additive only. They do not change route behavior, API contracts, or database writes. Real consumers and third-party integrations are still future work.
