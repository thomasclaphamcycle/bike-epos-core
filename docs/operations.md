# Operations Runbook

## Scope
Operational reference for database backup/restore, migration deploys, release flow, and production checks.

## Backup and Restore (Local / Non-Production)

### Backup
1. Export connection string:
   - `export DATABASE_URL=postgresql://...`
2. Run:
   - `npm run db:backup`
3. Script output:
   - Creates `./backups/backup_YYYYMMDD_HHMMSS.sql`
   - Prints full output path

### Restore
1. Export target connection string:
   - `export DATABASE_URL=postgresql://...`
2. Set backup file path:
   - `export BACKUP_FILE=./backups/backup_YYYYMMDD_HHMMSS.sql`
   - or pass path argument: `npm run db:restore -- ./backups/file.sql`
3. Run:
   - `npm run db:restore`

### Production-safety guard
- `scripts/db_backup.sh` and `scripts/db_restore.sh` refuse execution when `DATABASE_URL` appears production-like.
- Heuristics check for substrings such as:
  - `prod`
  - `production`
  - `rds.amazonaws.com`
  - `supabase`
  - `render.com`
  - `railway.app`
  - `neon.tech`
- Override only when intentional:
  - `CONFIRM_PROD=true npm run db:backup`
  - `CONFIRM_PROD=true npm run db:restore`

## Migration Runbook

### Deploy migrations
1. Confirm env:
   - `DATABASE_URL` points to target DB
   - app secrets are present (`JWT_SECRET`, `COOKIE_SECRET`)
2. Run:
   - `npx prisma generate`
   - `npx prisma migrate deploy`
3. Verify:
   - `npx prisma migrate status`
   - `npm test`
   - `npm run test:smoke`
   - `npm run e2e`

### Rollback guidance
- Prefer **roll-forward fixes** with a new migration.
- If rollback is unavoidable:
  1. Take backup first (`npm run db:backup`).
  2. Restore known-good backup into target.
  3. Deploy last known-good application revision.
- Avoid manual schema edits unless incident response requires it.

## Tag and Release Strategy
- Use annotated tags for release points:
  - `git tag -a vX.Y.Z -m "release vX.Y.Z"`
  - `git push origin vX.Y.Z`
- Keep release commits small, with migrations and scripts included.
- Record release notes with:
  - schema/migration changes
  - operational changes
  - test evidence (`test`, `smoke`, `e2e`)

## Before Deploy Checklist
- Clean git state and correct branch.
- `DATABASE_URL`, `JWT_SECRET`, `COOKIE_SECRET`, `NODE_ENV`, `PORT` set.
- Prisma migrations reviewed and committed.
- All validations pass:
  - `npm test`
  - `npm run test:smoke`
  - `npm run e2e`
- Backup taken for target DB.

## After Deploy Checklist
- `/health` returns 200.
- Login works for admin/staff roles.
- Core transaction path verified:
  - create/complete sale
  - receipt view
  - workshop job update
- Audit logs and reports endpoints respond.
- Monitor logs for spikes in 4xx/5xx.

## Troubleshooting

### Database connection failures
- Verify `DATABASE_URL` format and credentials.
- Ensure database is reachable from runtime host.
- Check TLS requirements for hosted Postgres providers.

### Missing environment variables
- Startup or auth failures usually indicate missing `JWT_SECRET` or `COOKIE_SECRET`.
- Re-check deployment secret injection and runtime env visibility.

### Port conflicts
- If app fails to bind:
  - Confirm `PORT` value.
  - Stop conflicting process on the same port.

### Migration issues
- Run `npx prisma migrate status`.
- Ensure DB user has DDL permissions.
- If a migration partially applied, restore from backup or roll forward with a corrective migration.
