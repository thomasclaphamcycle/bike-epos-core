# Production Setup Checklist

This checklist is for deploying CorePOS in a real shop environment with PostgreSQL, Prisma migrations, the backend server, and the built React frontend.

Use this alongside [deployment.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/deployment.md). `deployment.md` covers the basic runtime model; this document is the operational checklist for first production setup, safe upgrades, backup, and recovery.

For the repository release gate and tagging checklist, use [release_checklist.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/release_checklist.md).

## 1. Environment Variables

Required backend variables:

- `DATABASE_URL`: PostgreSQL connection string for the production database
- `AUTH_JWT_SECRET`: strong random secret for auth tokens
- `COOKIE_SECRET`: strong random secret for signed cookies
- `NODE_ENV=production`
- `PORT`: backend listen port, usually `3000` behind a reverse proxy

Optional operational variable:

- `OPS_LOGGING=1`: enables concise structured lifecycle logs for auth, workshop status changes, stock adjustments, and purchase-order receiving
- `COREPOS_DEBUG=1`: enables concise request, error, and startup diagnostics for troubleshooting without changing API responses
- `PUBLIC_APP_URL`: base customer-facing CorePOS URL used in workshop quote emails, for example `https://corepos.example.com`
- `EMAIL_DELIVERY_MODE=log|smtp`: `log` is safe for evaluation and local testing, while `smtp` enables real delivery
- `SMTP_URL`: required when `EMAIL_DELIVERY_MODE=smtp`
- `EMAIL_FROM`: optional sender email override for workshop notifications
- `EMAIL_FROM_NAME`: optional sender display-name override for workshop notifications
- `WORKSHOP_NOTIFICATION_EMAIL_ENABLED=0|1`: optional smart-delivery gate for workshop email notifications, defaults to enabled
- `SMS_DELIVERY_MODE=log|twilio`: `log` is safe for evaluation and local testing, while `twilio` enables real SMS delivery
- `SMS_FROM`: optional sender override for workshop SMS notifications and required when `SMS_DELIVERY_MODE=twilio`
- `WORKSHOP_NOTIFICATION_SMS_ENABLED=0|1`: optional smart-delivery gate for workshop SMS notifications, defaults to enabled
- `WHATSAPP_DELIVERY_MODE=log|twilio`: `log` is safe for evaluation and local testing, while `twilio` enables real WhatsApp delivery
- `WHATSAPP_FROM`: optional sender override for workshop WhatsApp notifications and required when `WHATSAPP_DELIVERY_MODE=twilio`
- `WORKSHOP_NOTIFICATION_WHATSAPP_ENABLED=0|1`: optional smart-delivery gate for workshop WhatsApp notifications, defaults to enabled
- `TWILIO_ACCOUNT_SID`: required when `SMS_DELIVERY_MODE=twilio` or `WHATSAPP_DELIVERY_MODE=twilio`
- `TWILIO_AUTH_TOKEN`: required when `SMS_DELIVERY_MODE=twilio` or `WHATSAPP_DELIVERY_MODE=twilio`

Operational guidance:

- use a dedicated PostgreSQL database and role for CorePOS
- keep secrets out of git and shell history
- store production env values in the service manager or deployment platform, not in committed files

## 2. Database Initialization

Before the first production start:

1. create the PostgreSQL database and role
2. set `DATABASE_URL` to that production database
3. generate the Prisma client if this is a fresh checkout:

```bash
npx prisma generate
```

4. apply the committed migrations:

```bash
npx prisma migrate deploy
```

5. if you want an evaluator/demo environment rather than a live shop database, seed it intentionally:

```bash
npm run db:seed:dev
```

Do not run demo seeding on a live shop database unless you explicitly want demo data there.

## 3. Running Migrations Safely

Use deploy-style migrations in production:

```bash
npx prisma migrate deploy
```

Safe upgrade sequence:

1. stop writes or place the system in a maintenance window
2. take a backup
3. pull the new release
4. run `npx prisma migrate deploy`
5. run `npm run build` if the frontend bundle is not already built in your release artifact
6. restart the application
7. verify login, POS, workshop, inventory, purchasing, and management routes

Do not use `npx prisma migrate dev` against production.

## 4. Backup And Restore

Create a backup with the repo helper:

```bash
scripts/backup_database.sh
```

Or write to an explicit path:

```bash
scripts/backup_database.sh backups/corepos-pre-upgrade.dump
```

Requirements:

- `pg_dump` installed on the machine running the backup
- `DATABASE_URL` pointed at the production database

Restore example:

```bash
COREPOS_CONFIRM_RESTORE=1 scripts/restore_database.sh backups/corepos-pre-upgrade.dump
```

Restore guidance:

- restore into a staging database first when possible
- treat restore as destructive for the target database
- after restore, restart the app and verify core flows before reopening the shop
- keep `pg_restore` installed on the operator or admin machine performing the recovery

## 5. Monitoring Logs

CorePOS logs to standard output and standard error. In production:

- capture logs with your process manager, container runtime, or hosting platform
- retain recent startup and error logs for troubleshooting
- monitor for repeated auth failures, migration failures, database connection errors, and uncaught exceptions
- enable `OPS_LOGGING=1` if you want structured lifecycle logs without introducing a separate logging stack
- enable `COREPOS_DEBUG=1` temporarily when you need request ids, per-request timings, or richer startup diagnostics during an incident

Minimum operational check after deploy:

- confirm the server starts cleanly
- confirm `/health` responds successfully
- use `/health?details=1` when you want an operator-facing confirmation of database connectivity, migration status, app version, runtime uptime, and safe configuration hints such as frontend serving mode or shipping-print-agent readiness
- use `/api/system/version` when support or staff need a quick version/runtime snapshot without requiring manager auth
- use manager-only `/metrics` when you want the same detailed health checks plus diagnostics/feature metadata in one response
- confirm there are no repeated Prisma or auth errors in the first few minutes
- note that successful routine `/health`, `/api/system/version`, and `/metrics` probes are intentionally suppressed from default request logs unless `COREPOS_DEBUG=1`, so the remaining logs stay easier to scan during incidents

## 6. Production Upgrade Procedure

Recommended release procedure:

1. take a fresh database backup
2. confirm the new release includes committed Prisma migrations if schema changed
3. note that the helper will forcibly discard local checkout drift before deploying
4. configure a safe restart command using either:
   - `COREPOS_RESTART_CMD`, for example `COREPOS_RESTART_CMD="pm2 restart corepos"`
   - `COREPOS_SYSTEMD_SERVICE`, for example `COREPOS_SYSTEMD_SERVICE=corepos`
5. run the repo helper:

```bash
COREPOS_SYSTEMD_SERVICE=corepos \
COREPOS_HEALTHCHECK_URL=http://127.0.0.1:3000/health \
scripts/upgrade_corepos.sh
```

Manual equivalent:

```bash
git fetch origin
git reset --hard origin/main
git clean -fd
npm install
npm --prefix frontend install
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run build
```

6. restart the production process using your process manager
7. smoke-check:
   - `/login`
   - `/home`
   - `/pos`
   - `/workshop`
   - `/inventory`
   - `/purchasing`
   - `/management`

The helper script now force-syncs the checkout to `origin/main` with `git fetch origin`, `git reset --hard origin/main`, and `git clean -fd` before continuing, so routine local drift such as server-side `package-lock.json` changes cannot block auto-deploy.

If a release introduces unexpected operational issues, restore the backup and roll back to the last known-good release.

## 7. Recovery Procedures

If CorePOS fails during startup:

1. check environment variables
2. confirm PostgreSQL is reachable from the app host
3. check whether pending migrations failed
4. inspect recent logs for Prisma, auth, or port-binding errors
5. compare `/health?details=1` and `/api/system/version` to confirm the running version/revision, environment, runtime uptime, and whether shipping-print-agent support is configured as expected

If the database is corrupted or a bad release must be reversed:

1. stop the app
2. restore the most recent verified backup
3. redeploy the last known-good release
4. restart the app
5. verify login and a small set of core workflows before resuming use

Keep a known-good release artifact and a recent verified backup before every production upgrade.

## Minimal Hardware Guidance

For a small single-shop deployment, start with:

- 2 CPU cores
- 4 GB RAM
- SSD-backed storage
- reliable local network access for tills/workshop stations
- regular off-machine backup storage for PostgreSQL dumps

If you run PostgreSQL and the app on the same machine, prefer headroom over minimums, especially for backup, restore, and browser-heavy manager workflows.
