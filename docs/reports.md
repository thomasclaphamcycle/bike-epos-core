# Reports Overview

## Current API Families

- `/api/reports/financial/*`
- `/api/reports/sales/*`
- `/api/reports/workshop/*`
- `/api/reports/inventory/*`
- `/api/reports/pricing/*`
- `/api/reports/customers/*`
- `/api/reports/suppliers/*`
- `/api/reports/operations/*`
- `/api/reports/reminder-candidates`

## Current Manager-Facing Reporting Queue

- Financial Reports
  - monthly margin
  - monthly sales summary
  - sales by category
- Action Centre
  - grouped operational sections for manager triage
- Operations Exceptions
  - flat list of cross-functional issues
- Stock Investigation Queue
  - stock and pricing anomalies requiring item-level review
- Reorder Suggestions
  - practical buying prompts from sales, stock, and open PO data
- Pricing Exceptions
  - missing retail, at/below-cost, and low-margin lines
- Customer Reminders
  - follow-up queue from completed workshop activity
- Reminder Candidates
  - internal reminder-groundwork visibility from persisted workshop-completion candidates, including manager review and dismissal state
- Workshop Capacity
  - backlog, throughput, and ageing pressure

## Financial Reporting Notes

- `GET /api/reports/financial/monthly-margin`
  - current month-to-date summary
  - returns gross sales, refunds, net revenue, known COGS, and gross margin
- `GET /api/reports/financial/monthly-sales`
  - current month-to-date sales summary
  - returns gross sales, refunds, net revenue, transaction count, and average sale value
- `GET /api/reports/financial/sales-by-category`
  - current month-to-date category view
  - groups product-linked sales by `Product.category`
  - includes `Workshop Labour` as a synthetic category when workshop checkout revenue exists without sale-line detail

Current cost-basis rules are intentionally conservative:

- retail sale-line COGS uses the current `Variant.costPricePence`
- workshop used parts use stored `WorkshopJobPart.costPriceAtTime` when present
- workshop labour revenue is included in revenue but flagged as revenue without recorded cost basis
- responses expose cost-coverage fields so incomplete costing is visible rather than silently invented

## Relationship Between Actions, Exceptions, and Investigations

- `operations/exceptions`
  - produces a unified flat row list with severity and destination link
- `operations/actions`
  - groups those rows into manager-facing sections without changing the underlying heuristics
- `inventory/investigations`
  - adds a stock-specific queue for negative stock, dead stock, and pricing-linked stock issues

The action centre links into the stock investigation queue rather than replacing it.

## Reminder Candidate Controls

- `GET /api/reports/reminder-candidates`
  - manager-only report for internal reminder candidates created from `workshop.job.completed`
  - supports `status`, `take`, and `includeDismissed`
- `POST /api/reports/reminder-candidates/:reminderCandidateId/review`
  - marks a candidate as internally reviewed
  - records `reviewedAt` and the acting staff id when available
- `POST /api/reports/reminder-candidates/:reminderCandidateId/dismiss`
  - dismisses a candidate from the active queue
  - also ensures the candidate is marked reviewed for operational traceability

These reminder-candidate routes are internal manager controls only. They do not send customer communications and do not introduce scheduling or delivery behavior.
