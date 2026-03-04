# M12 Closeout - Workshop Money Lifecycle

Date: 2026-03-04

## Scope Delivered

Milestone M12 implemented cancellations, refunds, credits, and reporting for workshop money flows with auditability, atomic transactions, idempotency, and race-safety.

## Endpoints Added

- `POST /api/workshop-bookings/manage/:token/cancel`
- `POST /api/workshop/jobs/:id/cancel`
- `POST /api/payments/:id/refund`
- `GET /api/payments/:id`
- `GET /api/credits/balance`
- `POST /api/credits/issue`
- `POST /api/credits/apply`
- `GET /api/reports/workshop/payments?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/reports/workshop/deposits?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/reports/workshop/credits?from=YYYY-MM-DD&to=YYYY-MM-DD`

## Idempotency Contract

- `POST /api/credits/issue`
  - `idempotencyKey` is required.
  - Primary idempotency key: `(creditAccountId, idempotencyKey)`.
- `POST /api/credits/apply`
  - `idempotencyKey` is required.
  - Primary idempotency key: `(creditAccountId, idempotencyKey)`.
  - Secondary guard exists for duplicate source/amount collisions.
- `POST /api/payments/:id/refund`
  - `idempotencyKey` optional but recommended.
  - If provided, idempotent on `(paymentId, idempotencyKey)`.
- Cancellation endpoints
  - Idempotent per workshop job via unique cancellation record on `workshopJobId`.
  - Repeated cancels return existing cancellation and do not duplicate side effects.

## Key Invariants

- Credit balance never goes below zero.
- Refund amount cannot exceed refundable payment amount.
- Cancellation side effects (refund/credit/forfeit) execute once only.
- Workshop checkout remains idempotent under concurrent requests.
- Outstanding checkout amount is clamped to zero (never negative).

## Reporting Rules

- Payments report groups totals by payment purpose and method.
- Refund totals are reported separately from payment grouped totals.
- Credits report is ledger-based (`CreditLedgerEntry` sums), not derived from invoice/outstanding fields.

## Smoke Tests

- M11 workshop deposit checkout:
  - `ALLOW_NON_TEST_DB=1 ALLOW_EXISTING_SERVER=1 npm run test:m11`
- M12 workshop money lifecycle:
  - `ALLOW_NON_TEST_DB=1 ALLOW_EXISTING_SERVER=1 npm run test:m12`

Test scripts enforce `NODE_ENV=test`. Use a test database by default. `ALLOW_NON_TEST_DB=1` is an explicit override only.
