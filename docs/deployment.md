# Deployment Guide

For a production-first operator checklist covering backups, restore, safe upgrades, logs, recovery, and minimal hardware guidance, use [production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) alongside this document.

## Required Environment Variables

Backend:

- `DATABASE_URL` (PostgreSQL connection string)
- `AUTH_JWT_SECRET`
- `COOKIE_SECRET`
- `PORT` (default `3000`)
- `NODE_ENV` (`development`, `test`, or `production`)
- `OPS_LOGGING=1` (optional, enables concise structured operational logs for auth, workshop, purchasing, and inventory lifecycle events)
- `COREPOS_DEBUG=1` (optional, adds concise request, error, and startup diagnostics for support/debug sessions)
- `COREPOS_SHIPPING_PRINT_AGENT_URL` (optional legacy fallback for web-order shipping-label printing when Shipping Print Helper settings are empty)
- `COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET` (optional legacy fallback secret when using a remote agent over a trusted LAN)
- `COREPOS_BIKE_TAG_PRINT_AGENT_URL` (optional legacy fallback for one-click office-printer bike-tag printing when Bike-Tag Print Helper settings are empty)
- `COREPOS_BIKE_TAG_PRINT_AGENT_TIMEOUT_MS` (optional, default `10000`)
- `COREPOS_BIKE_TAG_PRINT_AGENT_SHARED_SECRET` (optional legacy fallback secret when using a remote bike-tag helper over a trusted LAN)
- `COREPOS_RECEIPT_PRINT_AGENT_URL` (optional legacy fallback for managed receipt printing when Receipt Print Helper settings are empty)
- `COREPOS_RECEIPT_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_RECEIPT_PRINT_AGENT_SHARED_SECRET` (optional legacy fallback secret when using a remote receipt helper over a trusted LAN)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL` (optional legacy fallback for direct Dymo product-label printing and falls back to `COREPOS_SHIPPING_PRINT_AGENT_URL`)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET` (optional, falls back to `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET`)

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

The React app proxies `/api` to `http://localhost:3100` in development and is the recommended trial/evaluation surface on `http://localhost:5173/login`.

Optional repo-local print agent for local development of web-order shipment labels, managed thermal receipts, office-printer bike tags, and direct Dymo product labels:

```bash
npm run print-agent:start
```

Then register a printer in `/management/settings`, mark it shipping-label, receipt, bike-tag, or product-label capable as appropriate, and set it as the default printer for that workflow. For managed receipts, also configure the Receipt Print Helper and station defaults for Till PC / Workshop 1 / Workshop 2. For the full Windows helper setup, see [windows_print_agent.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/windows_print_agent.md).

Managed receipt printing is now queue-backed:

- CorePOS persists the print job first
- only one active managed job is delivered to a given printer at a time
- transient helper/network failures retry automatically with short backoff
- browser receipt print remains available as explicit fallback if the managed route is unavailable

Operators can inspect queued, printing, and failed jobs from Settings under `Managed Print Queue`.

For a Windows office-printer host that should print bike tags without a CorePOS repo checkout or npm, build the standalone bike-tag helper EXE package from a CorePOS dev/release machine:

```bash
npm run print-agent:package:bike-tag
```

That command stages a copyable folder under `tmp/bike-tag-agent-bundle/` with `corepos-bike-tag-agent.exe`, the config example, and the deployment notes. Copy the resulting folder to the Windows office-printer host, create `corepos-bike-tag-agent.config.json` from the example, then save the helper URL and shared secret in CorePOS Settings under `Bike-Tag Print Helper`. Register the office printer in CorePOS Settings with printer family `OFFICE_DOCUMENT`, transport mode `WINDOWS_PRINTER`, and make it the default bike-tag printer.

For a Windows Dymo host that should not keep a CorePOS repo checkout or run npm, build the standalone Dymo helper EXE package from a CorePOS dev/release machine:

```bash
npm run print-agent:package:dymo
```

That command stages a copyable folder under `tmp/dymo-product-label-agent-bundle/` with `corepos-dymo-product-label-agent.exe`, the config example, and the deployment notes. Copy the resulting folder to the Windows Dymo host, create `corepos-dymo-product-label-agent.config.json` from the example, then save the helper URL and shared secret in CorePOS Settings under `Product-Label Print Helper`.

For a Windows Zebra host running a USB-connected GK420d without a repo checkout or npm, build the standalone shipment helper EXE package from a CorePOS dev/release machine:

```bash
npm run print-agent:package:zebra
```

That command stages a copyable folder under `tmp/zebra-shipment-agent-bundle/` with `corepos-zebra-shipment-agent.exe`, the config example, and the deployment notes. Copy the resulting folder to the Windows Zebra host, create `corepos-zebra-shipment-agent.config.json` from the example, save that helper URL and shared secret in CorePOS Settings under `Shipping Print Helper (Zebra)`, and register the Zebra printer in CorePOS Settings with transport mode `WINDOWS_PRINTER`.

## Runtime Diagnostics

CorePOS keeps diagnostics lightweight and repo-native:

- `GET /health`
  - low-noise liveness check
  - returns only `{ "status": "ok" }` when the app is responsive
- `GET /health?details=1`
  - adds database, migration, runtime, and configuration checks
  - includes safe runtime metadata such as app version, revision, uptime, environment, frontend serving mode, and whether the shipping print agent is configured
- `GET /api/system/version`
  - safe runtime snapshot used by the app shell and support/debugging flows
  - returns app version plus runtime/feature metadata without exposing secrets
- `GET /metrics`
  - manager-protected diagnostics snapshot
  - mirrors detailed health plus diagnostics/feature flags for operator troubleshooting

Logging notes:

- `OPS_LOGGING=1` keeps concise structured lifecycle logs on
- `COREPOS_DEBUG=1` adds richer request/startup/error detail for incident sessions
- successful routine hits to `/health`, `/api/system/version`, and `/metrics` are suppressed from normal request logs unless debug mode is enabled, so repeated probes do not bury real failures

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

This includes:

- `/r/:receiptNumber`
- `/sales/:saleId/receipt`
- `/reports/daily-close/print`

## Backup And Restore

CorePOS now includes a simple repo-supported database backup helper for trusted local or operator-managed environments:

```bash
scripts/backup_database.sh
```

The merge line also retains npm-wrapped operator scripts:

```bash
npm run db:backup
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

Or via the wrapped helper:

```bash
npm run db:restore -- backups/pre-trial-corepos.dump
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
