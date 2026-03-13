# Real-Shop Pilot Support Pack

Use this pack during the first live or near-live CorePOS pilot when operators need one practical reference for setup, backups, restore, and daily checks.

Use this alongside:

- [README.md](/Users/thomaswitherspoon/Development/bike-epos-core/README.md) for local setup and the main verification gate
- [docs/pilot_shop_guide.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/pilot_shop_guide.md) for the step-by-step onboarding walkthrough
- [docs/production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) for production deployment, upgrade, and recovery details

## 1. Pilot Readiness Before Day One

Confirm these before staff rely on the system:

1. `npm run verify` completed on the exact code revision being piloted
2. the production or pilot database has been backed up
3. admin, manager, and staff logins have been tested
4. `/pos`, `/workshop`, `/inventory`, `/purchasing`, and `/management` all load
5. the operator running the pilot knows where backups are stored

## 2. First-Day Operator Walkthrough

Recommended order:

1. manager logs in and checks `/management`
2. staff completes a small POS sale
3. staff or manager checks in a workshop job
4. manager receives part of the open purchase order
5. manager checks `/management/actions` and `/management/health`

This gives a quick confidence pass across the main pilot surfaces before normal trading continues.

## 3. Daily Operating Checks

At open:

- confirm the app loads cleanly
- confirm login works for the expected staff account
- confirm `/health` responds successfully
- confirm the register/till state is what the team expects before trading

Midday:

- review `/management/actions`
- review `/management/investigations`
- review `/workshop/collection` for ready jobs waiting on handoff

At close:

- confirm any important receipts or workshop changes are visible
- take a fresh backup if the pilot data should be retained
- note any operator confusion, dead ends, or support incidents while they are still fresh

## 4. Backup Procedure During Pilot Use

Run:

```bash
set -a
source .env
set +a
scripts/backup_database.sh backups/corepos-pilot-$(date +%Y%m%d-%H%M).dump
```

Practical rule:

- take a backup before upgrades
- take a backup before schema work
- take a backup before wiping or reseeding the pilot database
- take a backup after any especially valuable pilot session you may want to preserve

## 5. Restore Procedure

Only restore when the pilot database must be rolled back or recovered.

Example:

```bash
set -a
source .env
set +a
COREPOS_CONFIRM_RESTORE=1 scripts/restore_database.sh backups/corepos-pilot-YYYYMMDD-HHMM.dump
```

After restore:

1. restart the backend and frontend or the production process
2. verify `/health`
3. log in as manager
4. verify POS, workshop, inventory, and purchasing screens

## 6. Support Notes To Capture

During the pilot, keep short notes on:

- login confusion or forgotten credentials
- POS friction or slow cashier actions
- workshop queue confusion or unclear statuses
- stock mismatches or purchasing surprises
- manager/reporting pages that feel unclear or incomplete

That feedback is more useful when tied to:

- the route used
- the role affected
- what the operator expected to happen

## 7. Safe Pilot Upgrade Rule

If the pilot instance needs updating:

1. take a backup first
2. use [docs/production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md)
3. rerun `npm run verify` on the target code before rollout when possible
4. do not mix live pilot changes with unverified local experiments

## 8. When To Stop And Recover

Pause the pilot and recover before continuing if:

- login fails unexpectedly for known-good users
- receipts or workshop updates stop appearing
- inventory changes are clearly wrong
- migrations fail
- `/health?details=1` shows database or migration problems

When that happens:

1. stop making new operational changes
2. take or preserve the latest backup if possible
3. inspect logs and `/health?details=1`
4. restore or roll back using the production runbook if needed
