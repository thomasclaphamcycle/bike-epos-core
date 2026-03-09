# CorePOS Plan

## Project Summary

CorePOS is a staff-facing bike shop EPOS and workshop operations platform. It handles retail basket and sale flows, workshop bookings and workshop job lifecycle, customer records, stock and inventory movements, receipts, refunds, till cash-up, and reporting. The repository now also includes a React frontend for core staff workflows while retaining server-rendered operational pages.

## Current System State

As of commit `c1fbf7c`:

- local backend, frontend, migrations, and demo seed are working together
- PostgreSQL + Prisma local development flow is documented and operational
- React frontend exists for login, POS, workshop, and customers
- server-rendered pages still exist for reports, inventory, till, manager pages, admin, receipts, and workshop print views
- baseline smoke coverage is centered on milestone scripts `m11`, `m12`, `m13`, `m28`, `m32`, `m34`, `m35`, `m36`, `m37`, `m38`, `m39`, `m40`, `m41`, `m42`, `m43`

## Current Release Checkpoint

- Restore tag: `v1.2-demo-running`
- Safety branch: `stable-demo`
- Commit: `c1fbf7c`

This is the canonical local-demo restore point currently available in git.

## Completed Work In This Branch

### Foundation And Core Data

- Prisma/Postgres foundation
- users/auth tables and user mapping
- product, variant, barcode, stock balance, stock movement foundations
- basket and sales core
- customers core

### Workshop Platform

- workshop availability and booking manage token flows
- deposit checkout and money lifecycle
- cancellations, credits, payment refunds, and workshop reporting
- workshop workflow management
- workshop parts and workshop lines
- workshop completed-at backfill

### Stock, Purchasing, And Catalog

- inventory ledger single-location support
- inventory adjustment flows
- stocktake sessions
- catalog/product variant support
- suppliers and purchase orders

### Retail, Auth, And Operations

- POS basket flow
- sale completion and receipts
- customer APIs and customer history
- real auth with cookie sessions
- admin users
- till cash-up
- navigation/auth routing shell
- sale tenders
- receipts v1
- refunds v1
- cash management v1
- manager cash/refunds UI

### React UI Layer

- React login
- React POS page
- React workshop dashboard and job detail
- React customer list and profile
- shared auth context, protected routing, toast provider, and Vite proxy setup

### Local Dev Stabilization

- working `.env.example`
- demo seed script
- local dev DB reset helper
- production serving of `frontend/dist`
- deployment guide updates
- sync migration `20260309122901_sync_current_schema`

## Milestone History

The repo contains evidence of these completed milestone groups in scripts, migrations, docs, or code:

- `M11` workshop deposit checkout
- `M12` workshop money lifecycle
- `M13` workshop ops dashboard, audit, permissions
- `M14` workshop workflow follow-on
- `M16` workshop parts
- `M17` suppliers and purchase orders
- `M18` stocktake sessions
- `M19` reporting
- `M19.1` workshop completed-at regression/backfill
- `M22` CSV reporting
- `M23b` reports UI
- `M24` inventory ledger
- `M25` catalog and variants
- `M26` stocktake follow-on
- `M27` purchase orders
- `M28` POS basket and checkout
- `M29` product APIs
- `M30` workshop job lines
- `M31` payment intents
- `M32` sale completion and receipts groundwork
- `M34` customers
- `M35` real auth
- `M36` admin
- `M37` till/cash-up
- `M38` auth-aware navigation
- `M39` sale tenders
- `M40` receipts v1
- `M41` refunds v1
- `M42` cash management v1
- `M43` manager ops pages

## Product Direction

### Staff Platform

This is the main product today.

Current staff-facing capabilities:

- POS and receipt issuance
- workshop operations
- customer history
- admin/auth/till/reporting
- inventory and purchasing via backend and server-rendered pages

### Customer-Facing Surface

This is limited today.

Currently present:

- workshop booking management by token
- printable views and receipts

Inferred future direction:

- customer self-service should remain secondary to the staff platform unless the roadmap is explicitly changed

## Near-Term Priorities

These are the most sensible next priorities based on the code currently in this branch.

1. Stabilize and document the current mixed SSR + React architecture.
2. Expand automated coverage for React UI flows already present.
3. Bring React parity to remaining high-value operational areas still only available in server-rendered pages.
4. Clean up repo hygiene issues such as tracked junk files and older doc drift.
5. Keep local development and seeding reliable as the schema evolves.

## Future Phases

The items below are authoritative as direction, but some are inferred from current gaps rather than backed by committed milestone specs in this branch.

### Phase A: UI Parity And Workflow Consolidation

- React pages for inventory, reports, till, admin, purchasing, and manager ops
- decide whether SSR pages remain first-class or become fallback/print-only
- align navigation and role handling across SSR and React surfaces

### Phase B: Operational Hardening

- broader smoke and E2E coverage
- security regression expansion
- backup/restore operational docs and scripts
- request tracing and stronger API error shaping
- cleaner CI validation for backend plus frontend

### Phase C: Data And Commerce Expansion

- richer purchasing/receiving if reintroduced on this branch
- stronger inventory valuation and reporting
- deeper customer-sales-workshop linking
- daily close and manager reporting enhancements if not merged into this line yet

### Phase D: Multi-Site And Deployment Maturity

- multi-location evolution beyond current single-location assumptions
- production packaging hardening
- deployment automation and environment validation

## Long-Term Vision

CorePOS should become a dependable internal operating system for a bike shop:

- fast at the counter
- reliable in the workshop
- accurate in stock and cash
- auditable for management
- deployable with predictable local, CI, and production behavior

The long-term goal is not just more features. It is a coherent staff platform where sales, workshop, stock, customers, and reporting share one trustworthy operational model.

## Planning Notes

- Treat code, migrations, and smoke scripts as more current than older milestone notes.
- If future milestone branches are merged into this line, update this file deliberately rather than appending conflicting status notes.
- If a roadmap item is only inferred, label it as inferred until a formal milestone spec or merged implementation exists.
