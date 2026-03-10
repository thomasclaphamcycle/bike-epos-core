# CorePOS Agent Guide

## Purpose

This file is the operating manual for coding agents working in the CorePOS repository.

CorePOS is a bike shop EPOS platform covering retail sales, workshop jobs, stock control, customers, receipts, refunds, till cash-up, reporting, and supporting admin/auth workflows. The repository now contains both:

- a Node/TypeScript + Express + Prisma + PostgreSQL backend
- a React + Vite frontend in `frontend/`

The current branch also retains server-rendered HTML pages in `src/views/`, so both UI layers coexist.

Important repo-state caveat:

- the broader repository history reaches approximately `M78`
- the current `dev-next` branch is a working local line, but it is not the single fully consolidated ancestry for every post-`M43` milestone commit
- when assessing milestone state, inspect repo history and active remote branches, not just the current working tree

## Source Of Truth Order

When repo notes conflict, trust sources in this order:

1. Running code in `src/`, `frontend/`, `prisma/`
2. Prisma migrations in `prisma/migrations/`
3. Automated regression scripts in `scripts/` and `e2e/`
4. `README.md` and `docs/`
5. Older milestone notes such as `PROJECT_CONTEXT.md` and `M12_CLOSEOUT.md`

Mark anything inferred from gaps as inferred. Do not present inferred future state as completed work.

## Current Architecture

### Backend

- Express app entrypoint: `src/server.ts`
- Route/controller/service split is the standard pattern
- Prisma client wrapper: `src/lib/prisma.ts`
- Auth and role enforcement: `src/middleware/staffRole.ts`
- Error shape: `src/middleware/errorHandler.ts`
- HTML pages: `src/views/` plus UI controllers/routes under `src/controllers/*UiController.ts` and `src/routes/*UiRoutes.ts`

### Frontend

- React SPA: `frontend/src/`
- Router entry: `frontend/src/App.tsx`
- Shared auth context: `frontend/src/auth/AuthContext.tsx`
- Shared API wrapper: `frontend/src/api/client.ts`
- Current React pages on this branch:
  - `/login`
  - `/home`
  - `/dashboard`
  - `/management`
  - `/management/dashboard-settings`
  - `/management/summary`
  - `/management/trade-close`
  - `/management/liabilities`
  - `/management/alerts`
  - `/management/activity`
  - `/management/cash`
  - `/management/refunds`
  - `/management/reminders`
  - `/management/communications`
  - `/management/warranty`
  - `/management/stock-exceptions`
  - `/management/integrity`
  - `/management/sales`
  - `/management/workshop`
  - `/management/staff-performance`
  - `/management/calendar`
  - `/management/products`
  - `/management/pricing`
  - `/management/customers`
  - `/management/inventory`
  - `/management/suppliers`
  - `/management/supplier-returns`
  - `/management/catalogue`
  - `/management/product-data`
  - `/management/reordering`
  - `/management/transfers`
  - `/management/capacity`
  - `/management/workshop-ageing`
  - `/management/health`
  - `/management/purchasing`
  - `/management/views`
  - `/management/exports`
  - `/management/backups`
  - `/management/staff`
  - `/management/admin-review`
  - `/management/onboarding`
  - `/management/settings`
  - `/management/docs`
  - `/pos`
  - `/workshop`
  - `/workshop/check-in`
  - `/workshop/bookings`
  - `/workshop/collection`
  - `/workshop/print`
  - `/workshop/:id`
  - `/tasks`
  - `/customers`
  - `/customers/:id`
  - `/customers/:id/timeline`
  - `/inventory`
  - `/inventory/locations`
  - `/inventory/:variantId`
  - `/suppliers`
  - `/purchasing`
  - `/purchasing/receiving`
  - `/purchasing/:id`

### Database

- PostgreSQL via Prisma
- Schema file: `prisma/schema.prisma`
- Interactive local migrations: `npx prisma migrate dev`
- Non-interactive deploys: `npx prisma migrate deploy`
- Local dev DB reset helper: `scripts/reset_local_dev_db.js`
- Demo seed: `scripts/seed_demo_data.ts`

### Production Serving Model

- In production, backend serves `frontend/dist`
- SPA fallback is enabled for non-API routes
- Legacy printable routes must keep working and must not be swallowed by the SPA fallback

## Repo Layout

- `src/`: backend code
- `frontend/`: React app
- `prisma/`: schema and migrations
- `scripts/`: smoke scripts, DB helpers, seeding
- `requests/`: manual API request collections
- `docs/`: supporting docs
- `e2e/`: Playwright critical flows

## Coding Principles

- Make additive, backward-compatible changes by default.
- Preserve existing endpoints, response shapes, printable routes, and current UI flows unless the task explicitly allows a breaking change.
- Keep controller, service, and route responsibilities separate.
- Reuse existing auth and role guard patterns instead of inventing new ones.
- Prefer small, explicit changes over broad refactors.
- Keep local development working after each milestone, not just CI.
- Preserve both UI surfaces unless the task explicitly retires one of them.

## Safety Rules

- Do not delete or silently repurpose existing routes.
- Do not break receipt URLs, workshop print URLs, login flow, seed flow, or smoke scripts.
- Do not commit `.env`, `frontend/dist`, `frontend/node_modules`, root `node_modules`, `*.tsbuildinfo`, Playwright output, or test result artefacts.
- Do not force-reset a developer database unless the task explicitly calls for it. If local drift is the issue, use `scripts/reset_local_dev_db.js` and document that step.
- If a branch is dirty and unrelated changes are present, work around them rather than reverting them.

## Backend Change Rules

- Put route declarations under `src/routes/`
- Put transport and validation logic in controllers
- Put business logic in services
- Reuse `HttpError` for predictable API failures
- Protect staff routes with `requireRoleAtLeast(...)`
- Preserve header-auth fallback behavior used by smoke tests

If adding or changing an API endpoint:

- add or update a request example under `requests/`
- add or update smoke coverage under `scripts/`
- run at least the relevant milestone test plus broader regression if the change is cross-cutting

## Frontend Change Rules

- Use the shared API client in `frontend/src/api/client.ts`
- Use `AuthContext` and `ProtectedRoute`
- Keep `/api` traffic backend-compatible
- Maintain SPA behavior in development and backend-served SPA behavior in production
- Prefer compatibility with existing backend contracts over frontend-only assumptions
- Prefer `/home` as the role-aware landing route instead of hardcoding `/pos` when a generic post-login home is needed

If a frontend change depends on a missing backend endpoint:

- add the smallest backend endpoint needed
- keep it additive
- update docs and regression coverage

## Prisma And Database Rules

- Schema changes require a committed Prisma migration in `prisma/migrations/`
- Use `npx prisma migrate dev --name <meaningful_name>` locally
- Use `npx prisma migrate deploy` for CI or production
- Run `npx prisma generate` after schema changes
- Keep `scripts/seed_demo_data.ts` working after schema changes
- Keep `.env.example` accurate when env assumptions change

If `migrate dev` reports drift on a local-only database:

- do not hack around it in code
- use `node scripts/reset_local_dev_db.js`
- rerun migrate + seed

## Local Development Safety

The current known-good local setup is:

- `.env` pointing `DATABASE_URL` at a real local Postgres role and `bike_epos`
- `npx prisma generate`
- `npx prisma migrate dev`
- `npm run db:seed:dev`
- backend on `http://localhost:3000`
- frontend dev server on `http://localhost:5173`

Do not reintroduce placeholder DB credentials like `postgresql://user:password@...` into `.env.example` or docs as if they are expected to work locally.

## Testing Expectations

Minimum expectations depend on the surface changed:

- Backend-only small change: targeted smoke script for affected area
- Backend change touching auth, routing, receipts, till, or shared services: `npm test` and usually `npm run e2e`
- Frontend-only change: `npm --prefix frontend run build`
- Cross-cutting change: `npm test`, `npm run e2e`, and frontend build
- Schema change: `npx prisma generate`, `npx prisma migrate dev`, seed validation

Current baseline smoke runner: `scripts/run_smoke_suite.js`

Current baseline smoke steps:

- `m11`
- `m12`
- `m13`
- `m28`
- `m32`
- `m34`
- `m35`
- `m36`
- `m37`
- `m38`
- `m39`
- `m40`
- `m41`
- `m42`
- `m43`

## Git And Checkpoint Expectations

- Keep commits focused and milestone-shaped when possible.
- Before risky changes, create a branch or tag restore point rather than relying on a dirty working tree.
- The current known restore point is:
  - tag `v1.2-demo-running`
  - branch `stable-demo`
  - commit `c1fbf7c`
- Do not retag or rewrite stable restore points without explicit instruction.
- If milestone progress appears missing on the current branch, check:
  - `origin/main`
  - `origin/react-ui`
  - `origin/backend-v1`
  before concluding the work does not exist in the repo.

## Definition Of Done

A milestone or feature is done only when all of the following are true:

- implementation is additive and backward-compatible
- Prisma migration exists if schema changed
- seed flow still works if the schema changed
- docs are updated where behavior, setup, or architecture changed
- request examples exist for new/changed endpoints
- smoke coverage exists or is updated for regressions
- relevant tests and builds pass
- local dev remains runnable from a clean checkout

## Documentation Update Rules

Update docs whenever you change:

- local setup or environment variables
- auth flows or role rules
- route structure or major endpoint families
- database schema assumptions
- build/deployment behavior
- restore/checkpoint guidance

Keep canonical high-signal docs aligned:

- `README.md` for onboarding
- `docs/deployment.md` for runtime/setup
- `AGENTS.md` for agent operating rules
- `PLAN.md` for roadmap
- `TASK.md` for the active queue

## Known Cautions

- This repo currently mixes milestone-era backend work, server-rendered pages, and a newer React frontend. Treat all three as live until deliberately consolidated.
- `PROJECT_CONTEXT.md` is historically useful but no longer current on its own.
- Some tracked junk files such as `.DS_Store` still exist in the repository and should be cleaned in a dedicated hygiene pass, not opportunistically during product work.
