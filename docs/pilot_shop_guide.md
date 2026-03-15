# Pilot Shop Onboarding Guide

This guide is for a bike shop owner, manager, or evaluator who wants to get CorePOS running locally and walk the main day-to-day flows with the current seeded demo environment.

Use this alongside:

- [README.md](/Users/thomaswitherspoon/Development/bike-epos-core/README.md) for the main developer setup reference
- [docs/auth.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/auth.md) for login and role details
- [docs/production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) for real deployment, backup, restore, and upgrade procedures
- [docs/pilot_support_pack.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/pilot_support_pack.md) for first-live-week support and recovery guidance

## 1. System Requirements

For a local pilot or trial setup, prepare:

- PostgreSQL running on `localhost:5432`
- Node.js and `npm`
- two terminals
- a modern browser

Recommended local URLs:

- backend: `http://localhost:3000`
- React frontend: `http://localhost:5173`

## 2. Installing CorePOS

From a fresh checkout:

```bash
npm ci
npm --prefix frontend ci
cp .env.example .env
cp .env.test.example .env.test
```

Set `DATABASE_URL` in `.env` to a real local PostgreSQL database. On macOS a common local setup is:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/bike_epos
```

If the role or database does not exist yet:

```bash
createuser -s "$(whoami)"
createdb bike_epos
```

## 3. Running Migrations

Prepare the local database:

```bash
npx prisma generate
npx prisma migrate dev
```

If your local development database has drift from older work, reset only the local dev database before retrying:

```bash
node scripts/reset_local_dev_db.js
```

## 4. Seeding Demo Data

Load the current minimal demo environment:

```bash
npm run db:seed:dev
```

The current seed is intentionally small and evaluation-friendly. It creates:

- 3 role-based users
- 7 products with opening stock in `Main Stock`
- 4 customers
- 3 workshop jobs
- 1 supplier
- 1 open purchase order for receiving

## 5. First Login

Start the app:

```bash
npm run dev
npm --prefix frontend run dev
```

Open:

```text
http://localhost:5173/login
```

Use an existing active staff account.

If this is a fresh local setup, restore the intended local roster with `npm run auth:seed-local-staff` or `npm run db:reset-and-seed:dev`. That makes Thomas the local admin account.

The React login screen is intentionally PIN-first and lists active users from the database. Password login remains available as a fallback.

## 6. Running A POS Sale

Recommended first counter-sale walkthrough:

1. Log in as an active staff user.
2. Confirm `/home` routes to `/dashboard`.
3. Open `/pos`.
4. Attach one of the seeded customers.
5. Add one or two seeded products to the basket.
6. Complete the sale and view the receipt.

This validates:

- role-aware login
- customer attachment
- product search
- basket and checkout flow
- receipt generation

## 7. Creating A Workshop Job

Recommended workshop walkthrough:

1. Stay as staff or switch to a manager.
2. Open `/workshop`.
3. Review the seeded jobs already present.
4. Open `/workshop/check-in`.
5. Create a simple new job for an existing customer.
6. Open the created job and review:
   - current status
   - notes
   - parts section
   - collection readiness

This validates workshop intake and day-to-day job tracking.

## 8. Receiving Inventory

Recommended purchasing walkthrough:

1. Log in as a manager.
2. Open `/purchasing`.
3. Open the seeded purchase order.
4. Review expected quantities and supplier cost.
5. Receive part or all of the order.
6. Re-open `/inventory` and confirm stock has updated.

This validates:

- purchase order visibility
- receiving flow
- stock update behavior
- supplier-cost-backed purchasing data

## 9. Reviewing Management Dashboard

Recommended manager walkthrough:

1. Open `/management`.
2. Review the overview cards and recent activity.
3. Open:
   - `/management/actions`
   - `/management/investigations`
   - `/management/reminders`
   - `/management/exports`
   - `/management/backups`

This gives a quick tour of the manager-facing reporting and oversight surfaces.

## 10. Backup Procedure

Before reusing the same pilot database for another session, take a backup:

```bash
set -a
source .env
set +a
scripts/backup_database.sh backups/corepos-pilot.dump
```

Notes:

- `pg_dump` must be installed locally
- `DATABASE_URL` must point at the correct database
- for restore and production-style recovery, follow [docs/production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md)

## Recommended Pilot Order

If you are running a live demo with shop staff, use this order:

1. login as staff
2. complete a small POS sale
3. create or inspect a workshop job
4. switch to manager
5. receive inventory on the open purchase order
6. review management pages
7. take a backup if the database state should be preserved

## Known Trial Notes

- the seeded environment is intentionally small, not a full live-shop history
- some management pages are reporting/oversight surfaces rather than closed-loop operational tools
- multi-location inventory is currently groundwork; default-location behavior remains the main evaluation path
- the recommended evaluator path is the React app on `http://localhost:5173`
