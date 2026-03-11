# Reports Overview

## Current API Families

- `/api/reports/sales/*`
- `/api/reports/workshop/*`
- `/api/reports/inventory/*`
- `/api/reports/pricing/*`
- `/api/reports/customers/*`
- `/api/reports/suppliers/*`
- `/api/reports/operations/*`

## Current Manager-Facing Reporting Queue

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
- Workshop Capacity
  - backlog, throughput, and ageing pressure

## Relationship Between Actions, Exceptions, and Investigations

- `operations/exceptions`
  - produces a unified flat row list with severity and destination link
- `operations/actions`
  - groups those rows into manager-facing sections without changing the underlying heuristics
- `inventory/investigations`
  - adds a stock-specific queue for negative stock, dead stock, and pricing-linked stock issues

The action centre links into the stock investigation queue rather than replacing it.
