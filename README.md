# bike-epos-core

Node/TypeScript + Express + Prisma + Postgres backend for bike EPOS workflows.

## Local Setup

1. Install dependencies:

```bash
npm ci
```

2. Create local env files:

```bash
cp .env.test.example .env.test
# keep your existing .env for dev DATABASE_URL
```

3. Start dedicated test DB + migrations:

```bash
npm run test:db:up
```

## Auth (M35)

Default auth mode is real auth (`AUTH_MODE=real`) with cookie sessions.

- Login API: `POST /api/auth/login`
- Logout API: `POST /api/auth/logout`
- Current user: `GET /api/auth/me`
- Login UI: `/login`

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

- `/` redirects to `/pos` when authenticated, otherwise `/login`.
- Unauthenticated access to protected pages redirects to `/login?next=...`.
- Role-based page access redirects to `/not-authorized` for HTML requests.

Navigation visibility:

- `STAFF+`: POS, Workshop, Inventory
- `MANAGER+`: Till / Cash Up
- `ADMIN`: Admin Users, Admin Audit

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

## Test Commands

### Baseline + new milestone smoke suite

```bash
npm test
```

`npm test` runs:

1. `npm run typecheck:reports`
2. `npm run test:smoke`

`test:smoke` runs milestones in order:

- m11, m12, m13, m28, m32, m34, m35, m36, m37, m38, m39

### Individual milestone tests

```bash
npm run test:m35
npm run test:m36
npm run test:m37
npm run test:m38
npm run test:m39
```

### Full regression smoke set (m11..m39)

```bash
npm run test:m11 && npm run test:m12 && npm run test:m13 && npm run test:m14 && npm run test:m16 && npm run test:m17 && npm run test:m18 && npm run test:m19 && npm run test:m19_1 && npm run test:m22 && npm run test:m23b && npm run test:m24 && npm run test:m25 && npm run test:m26 && npm run test:m27 && npm run test:m28 && npm run test:m29 && npm run test:m30 && npm run test:m31 && npm run test:m32 && npm run test:m33 && npm run test:m34 && npm run test:m35 && npm run test:m36 && npm run test:m37 && npm run test:m38 && npm run test:m39
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

## Dev Workflow

Start dev server:

```bash
npm run dev
```

Useful UI routes:

- `/login`
- `/pos`
- `/workshop`
- `/inventory`
- `/inventory/adjust`
- `/admin`
- `/admin/audit`
- `/till`
- `/reports`

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
