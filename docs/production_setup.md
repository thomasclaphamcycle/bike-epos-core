# Production Setup Checklist

This checklist is for deploying CorePOS in a real shop environment with PostgreSQL, Prisma migrations, the backend server, and the built React frontend.

Use this alongside [deployment.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/deployment.md). `deployment.md` covers the basic runtime model; this document is the operational checklist for first production setup, safe upgrades, backup, and recovery.

## 1. Environment Variables

Required backend variables:

- `DATABASE_URL`: PostgreSQL connection string for the production database
- `AUTH_JWT_SECRET`: strong random secret for auth tokens
- `COOKIE_SECRET`: strong random secret for signed cookies
- `NODE_ENV=production`
- `PORT`: backend listen port, usually `3000` behind a reverse proxy

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

Minimum operational check after deploy:

- confirm the server starts cleanly
- confirm `/health` responds successfully
- confirm there are no repeated Prisma or auth errors in the first few minutes

## 6. Updating CorePOS Safely

Recommended release procedure:

1. take a fresh database backup
2. confirm the new release includes committed Prisma migrations if schema changed
3. deploy code
4. run `npx prisma migrate deploy`
5. build frontend assets if needed:

```bash
npm run build
```

6. start or restart the production process:

```bash
npm run start:prod
```

7. smoke-check:
   - `/login`
   - `/home`
   - `/pos`
   - `/workshop`
   - `/inventory`
   - `/purchasing`
   - `/management`

If a release introduces unexpected operational issues, restore the backup and roll back to the last known-good release.

## 7. Recovery Procedures

If CorePOS fails during startup:

1. check environment variables
2. confirm PostgreSQL is reachable from the app host
3. check whether pending migrations failed
4. inspect recent logs for Prisma, auth, or port-binding errors

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
