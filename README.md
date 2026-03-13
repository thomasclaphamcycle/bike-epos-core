# bike-epos-core

Node/TypeScript + Express + Prisma + Postgres backend for bike EPOS workflows.

## Prerequisites

- local PostgreSQL running on `localhost:5432`
- Node.js with `npm`
- two terminals when evaluating the React SPA locally

## Trial Quickstart

1. Install backend dependencies:

```bash
npm ci
```

2. Install frontend dependencies:

```bash
npm --prefix frontend ci
```

3. Create local env files:

```bash
cp .env.example .env
cp .env.test.example .env.test
```

4. Prepare the local development database:

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed:dev
```

5. Run the backend:

```bash
npm run dev
```

6. In a second terminal, run the React frontend:

```bash
npm --prefix frontend run dev
```

7. Open `http://localhost:5173/login`.

The React evaluator path is frontend on `http://localhost:5173` talking to the backend on `http://localhost:3000`.
Production-style serving still comes from the backend after `npm run build`.

## Production Deployment Checklist

For a real shop deployment, use the concise production runbook in [docs/production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md).

It covers:

- production environment variables
- database initialization and Prisma migrations
- backup and restore
- log handling
- safe upgrade steps
- recovery procedures
- minimal hardware guidance

For the branch/release gate used before tagging, use [docs/release_checklist.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/release_checklist.md).

## Roadmap Progress

CorePOS roadmap progress is now computed from real repo evidence rather than maintained as hardcoded percentages.

- `npm run roadmap` prints the current per-phase completion table
- `npm run roadmap:json` prints the explainable JSON breakdown
- `npm run roadmap1` writes `docs/roadmap-progress.png`

See [docs/roadmap_progress.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/roadmap_progress.md) for the scoring model, evidence rules, and maintenance guidance.

## Real Shop Pilot Guide

For a concise trial-evaluation walkthrough covering seeded logins, operator flows, sample shop scenarios, and known pilot limitations, use [docs/pilot_preparation.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/pilot_preparation.md).

For a tighter step-by-step onboarding guide aimed at a real bike shop trial setup, use [docs/pilot_shop_guide.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/pilot_shop_guide.md).

For first-live-week support, backup, restore, and daily pilot runbook guidance, use [docs/pilot_support_pack.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/pilot_support_pack.md).

## Local Setup

1. Install dependencies:

```bash
npm ci
```

2. Create local env files:

```bash
cp .env.example .env
cp .env.test.example .env.test
```

Set `DATABASE_URL` in `.env` to a real local Postgres role and database. On macOS that is often your local username:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/bike_epos
```

If the role or database does not exist yet:

```bash
createuser -s "$(whoami)"
createdb bike_epos
```

If `prisma migrate dev` reports drift against an old local dev database, reset only the local development DB and recreate it:

```bash
node scripts/reset_local_dev_db.js
```

3. Prepare the local development database:

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed:dev
```

4. Start the backend:

```bash
npm run dev
```

5. Install and run the React frontend when evaluating the SPA locally:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

6. Prepare the dedicated test database before running `npm test` or `npm run e2e`:

```bash
npm run test:db:up
```

7. If you are using Codex locally, this repo already ships a project-scoped `.codex/config.toml` with:

- `sandbox_mode = "workspace-write"`
- `approval_policy = "never"`
- `[sandbox_workspace_write].network_access = true`
- `[sandbox_workspace_write].allowed_hosts = ["localhost", "127.0.0.1"]`
- `[env].allow = ["DATABASE_URL"]`

That keeps local automation project-scoped while still allowing trusted access to local services such as PostgreSQL on `localhost:5432`.

### Trusted Local Codex Mode

This repository is set up for trusted local Codex runs through `.codex/config.toml`.

- `workspace-write` keeps file access scoped to the project instead of enabling full machine access
- local loopback and PostgreSQL access on `localhost:5432` are expected for seeds, smoke tests, and verification
- approval prompts should now be minimal during normal local development

On a fully trusted machine, advanced users can still choose `sandbox_mode = "danger-full-access"` for fully autonomous runs, but that is intentionally not the project default.

## Auth (M35)

Default auth mode is real auth (`AUTH_MODE=real`) with cookie sessions.

- Login API: `POST /api/auth/login`
- PIN Login API: `POST /api/auth/pin-login`
- Logout API: `POST /api/auth/logout`
- Current user: `GET /api/auth/me`
- Active login users: `GET /api/auth/active-users`
- Login UI: `/login` (current React UI is PIN-first with active-user buttons, and now includes a password fallback form for password-only or reset-PIN accounts)

### Login after `npm run db:seed:dev`

`scripts/seed_demo_data.ts` no longer creates demo auth users.

The login screen remains PIN-first and lists whatever active staff accounts already exist in the local database. For a fresh local setup, create an admin first with `npm run auth:seed-admin`, then create or manage the remaining staff accounts from `/management/staff`.

`npm run db:seed:dev` now keeps the demo environment intentionally small:

- no demo auth users
- 7 products with opening stock in `Main Stock`
- 4 customers
- 3 workshop jobs
- 1 supplier and 1 open purchase order for receiving

### Create initial admin

Recommended:

```bash
ADMIN_NAME="Admin User" \
ADMIN_EMAIL="admin@example.com" \
ADMIN_PASSWORD="ChangeMe123!" \
npm run auth:seed-admin
```

Alternative (only when DB has no users): `POST /api/auth/bootstrap`.

See [docs/auth.md](docs/auth.md) for full mode/flag details.

## App Navigation (M38)

Authenticated pages now use a shared app shell with role-aware navigation.

- When the React SPA is active, `/` loads the app shell and routes authenticated users through `/home` to their role landing page (`/dashboard`, `/management`, or `/management/staff`).
- In backend-only/non-SPA mode, `/` still redirects authenticated users to `/pos`; unauthenticated access still goes to `/login`.
- The React `/login` screen now routes successful fallback password logins through `/home`; the backend-only legacy login page still falls back to `/pos`.
- Unauthenticated access to protected pages redirects to `/login?next=...`.
- Role-based page access redirects to `/not-authorized` for HTML requests.

Current UX-branch shell visibility:

- sidebar currently shows a reduced navigation set for redesign work
- route access is still enforced by `ProtectedRoute` role checks
- management/admin pages remain directly routable for authorized users

## Trial Flow Guide

Recommended evaluator pass:

1. Log in with an existing staff account and confirm `/home` routes to `/dashboard`.
2. Open `/pos`, attach a seeded customer, add one or two seeded products, and complete a simple sale.
3. Open `/workshop` and `/workshop/collection` to review the three seeded jobs across booking, waiting-for-parts, and ready-for-collection states.
4. Log in with an existing manager account, then review `/inventory`, `/purchasing`, and `/management` using the seeded supplier and open purchase order.
5. Log in with an existing admin account and review `/management/staff` for staff lifecycle and password/PIN controls.

Intentional trial limitations to note:

- some management surfaces are visibility/reporting groundwork rather than full operational modules
- backend-only legacy HTML routes still exist, but the current evaluator path is the React SPA

## POS Tenders (M39)

Sales now support explicit tender lines (cash/card/bank transfer/voucher) with split payment and cash change-due handling.

- Endpoints:
  - `POST /api/sales/:saleId/tenders`
  - `GET /api/sales/:saleId/tenders`
  - `DELETE /api/sales/:saleId/tenders/:tenderId`
- Sale completion (`POST /api/sales/:saleId/complete`) now validates tender coverage:
  - tendered total must cover sale total
  - over-tender is allowed only when cash tender covers the overage
- Till integration records only net cash taken for split/overpaid tender flows.

## Receipts v1 (M40)

Receipts are now issued as first-class records with immutable shop metadata snapshots and printable URLs.

- New endpoints:
  - `POST /api/receipts/issue` with `{ saleId }` or `{ refundId }`
  - `GET /api/receipts/:receiptNumber`
  - `GET /r/:receiptNumber` (printable HTML)
- Backward-compatible endpoints remain:
  - `GET /api/sales/:saleId/receipt`
  - `GET /sales/:saleId/receipt`
- Receipt numbers use a monotonic sequence (`R-00000001`, ...), generated transactionally.

## Refunds v1 (M41)

Completed sales now support manager-authored draft refunds with line-level quantities, explicit refund tenders, completion validation, and receipt issuance.

- Endpoints (MANAGER+):
  - `POST /api/refunds`
  - `GET /api/refunds/:refundId`
  - `POST /api/refunds/:refundId/lines`
  - `DELETE /api/refunds/:refundId/lines/:refundLineId`
  - `POST /api/refunds/:refundId/tenders`
  - `DELETE /api/refunds/:refundId/tenders/:tenderId`
  - `POST /api/refunds/:refundId/complete`
- Receipt integration:
  - `POST /api/receipts/issue` with `{ refundId }` now supports both legacy payment refunds and M41 sale refunds.
  - `GET /r/:receiptNumber` prints sale-refund lines and tenders.

## Cash Management v1 (M42)

Manager cash operations now expose date-range movement and summary APIs in addition to M37 till session workflows.

- Endpoints (MANAGER+):
  - `POST /api/cash/movements` with `type` (`FLOAT`, `PAID_IN`, `PAID_OUT`)
  - `GET /api/cash/movements?from=YYYY-MM-DD&to=YYYY-MM-DD`
  - `GET /api/cash/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Movement records now include `locationId`, optional notes, and related sale/refund links.
- Cash summary reports:
  - `float + paid_in - paid_out + cash_sales - cash_refunds`

## Manager Ops UI (M43)

Manager-only operations pages are now available inside the authenticated M38 app shell.

- Pages:
  - `/manager/cash`
  - `/manager/refunds`
- Role behavior:
  - visible in nav for `MANAGER+`
  - `STAFF` users are redirected to `/not-authorized`
- Data sources:
  - `/manager/cash` uses `/api/cash/summary` + `/api/cash/movements`
  - `/manager/refunds` uses `/api/refunds?from&to`

## Test Commands

### Baseline + new milestone smoke suite

```bash
npm test
```

`npm test` runs:

1. `npm run typecheck:reports`
2. `npm run test:smoke`

`test:smoke` runs milestones in order:

- m11, m12, m13, m28, m32, m34, m35, m36, m37, m38, m39, m40, m41, m42, m43

### Individual milestone tests

```bash
npm run test:m35
npm run test:m36
npm run test:m37
npm run test:m38
npm run test:m39
npm run test:m40
npm run test:m41
npm run test:m42
npm run test:m43
```

### Full regression smoke set (m11..m40)

```bash
npm run test:m11 && npm run test:m12 && npm run test:m13 && npm run test:m14 && npm run test:m16 && npm run test:m17 && npm run test:m18 && npm run test:m19 && npm run test:m19_1 && npm run test:m22 && npm run test:m23b && npm run test:m24 && npm run test:m25 && npm run test:m26 && npm run test:m27 && npm run test:m28 && npm run test:m29 && npm run test:m30 && npm run test:m31 && npm run test:m32 && npm run test:m33 && npm run test:m34 && npm run test:m35 && npm run test:m36 && npm run test:m37 && npm run test:m38 && npm run test:m39 && npm run test:m40 && npm run test:m41 && npm run test:m42 && npm run test:m43
```

### Playwright E2E

Install browser once:

```bash
npx playwright install chromium
```

Run suite:

```bash
npm run e2e
```

E2E covers:

- login + POS critical paths
- login + workshop critical paths
- admin permissions
- till open/paid-in/count/close flow

### Full local verification pass

Run these sequentially from a clean environment:

```bash
npm test
npm run build
npm run e2e
npm run test:m38
npm run test:m24
npm run test:m27
npm run test:m30
npm run db:seed:dev
```

Notes:

- keep shared test ports such as `3100` clear before starting
- standalone smoke commands start their own local test-mode server on `http://localhost:3100`
- run `npm run test:db:up` first if the dedicated test database is not already running

## Dev Workflow

Start dev server:

```bash
npm run dev
```

Start the frontend dev server in a second terminal:

```bash
npm --prefix frontend run dev
```

Useful UI routes:

- `/login`
- `/home`
- `/dashboard`
- `/management`
- `/pos`
- `/workshop`
- `/inventory`
- `/suppliers`
- `/purchasing`

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

On push + PR:

1. Start Postgres service container
2. `npm ci`
3. `prisma generate`
4. `prisma migrate deploy`
5. `npm test`
6. `npm run e2e`

CI runs with:

- `NODE_ENV=test`
- `AUTH_MODE=real`
- `TEST_DATABASE_URL` + `DATABASE_URL` pointed at CI Postgres

## Cleanup Test DB

```bash
npm run test:db:down
```
