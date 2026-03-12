# Deployment Guide

For a production-first operator checklist covering backups, restore, safe upgrades, logs, recovery, and minimal hardware guidance, use [production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) alongside this document.

## Required Environment Variables

Backend:

- `DATABASE_URL` (PostgreSQL connection string)
- `AUTH_JWT_SECRET`
- `COOKIE_SECRET`
- `PORT` (default `3000`)
- `NODE_ENV` (`development`, `test`, or `production`)

Frontend (optional build-time customizations):

- `VITE_*` variables as needed (defaults work for local development)

## Local Development

1. Create `.env` from the example and point `DATABASE_URL` at a real local Postgres role:

```bash
cp .env.example .env
```

On many macOS setups the simplest working value is:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/bike_epos
```

If the role or database is missing:

```bash
createuser -s "$(whoami)"
createdb bike_epos
```

If you previously ran a different branch and `npx prisma migrate dev` reports drift, reset the local dev database and recreate it from the current migrations:

```bash
node scripts/reset_local_dev_db.js
```

2. Run migrations and seed demo data:

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed:dev
```

3. Start backend (server-rendered UI and APIs):

```bash
npm run dev
```

4. Optional React UI development server for the current evaluator path:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

The React app proxies `/api` to `http://localhost:3000` in development and is the recommended trial/evaluation surface on `http://localhost:5173/login`.

5. Prepare the dedicated test database before running `npm test` or `npm run e2e`:

```bash
npm run test:db:up
```

## Production Build

Build the React frontend bundle:

```bash
npm run build
```

Start production server:

```bash
npm run start:prod
```

In production (`NODE_ENV=production`), the backend serves static files from `frontend/dist` and returns `index.html` for non-API SPA routes.

Legacy printable routes (for example receipt and workshop print views) continue to be served by backend HTML handlers.

## Backup And Restore

CorePOS now includes a simple repo-supported database backup helper for trusted local or operator-managed environments:

```bash
scripts/backup_database.sh
```

This uses the current `DATABASE_URL` and writes a timestamped PostgreSQL custom-format dump to `backups/` by default. You can also pass an explicit output path:

```bash
scripts/backup_database.sh backups/pre-trial-corepos.dump
```

Requirements:

- `pg_dump` must be installed and on `PATH`
- `DATABASE_URL` must point at the database you intend to back up

Important distinction:

- use the in-app Export Hub for CSV extracts and operational data handoff
- use `scripts/backup_database.sh` for full database backup before upgrades, trial resets, or risky maintenance

To restore a backup into the database currently pointed to by `DATABASE_URL`:

```bash
COREPOS_CONFIRM_RESTORE=1 scripts/restore_database.sh backups/pre-trial-corepos.dump
```

Restore should be treated as a deliberate operator action because it overwrites existing objects in the target database.

Restore helper notes:

- `pg_restore` must be installed and on `PATH` or in the common local PostgreSQL client paths
- the script requires `COREPOS_CONFIRM_RESTORE=1` to avoid accidental destructive runs
- the helper restores into the database pointed to by `DATABASE_URL`

## Local Automation Note

This repo includes a project-scoped `.codex/config.toml` for trusted local development. It keeps Codex in `workspace-write`, sets `approval_policy = "never"`, and enables workspace-write network access so local services such as PostgreSQL on `localhost:5432` remain reachable without switching to full-access mode.

## Test Seeding

Seed test database data using `.env.test`:

```bash
npm run db:seed:test
```
