# Release Checklist

Use this checklist before tagging or announcing a CorePOS release.

## Pre-release

1. Confirm you are on the intended release branch.
2. Confirm the working tree is clean.
3. Pull the latest remote changes with `git pull --ff-only`.
4. Review the committed changes for schema, auth, routing, or deployment impact.
5. If Prisma schema changed, confirm the required migration is committed.

## Verification

Run the single release gate:

```bash
npm run verify
```

Do not manually expand the sequence unless you are debugging a failure.

If `npm run verify` fails:

- stop
- fix the root cause
- rerun `npm run verify`
- do not tag or release until the gate is green

## Release Preparation

1. Confirm production docs are current:
   - `README.md`
   - `docs/deployment.md`
   - `docs/production_setup.md`
2. Confirm backup and upgrade guidance still match the current code:
   - `scripts/backup_database.sh`
   - `scripts/restore_database.sh`
   - `scripts/upgrade_corepos.sh`
3. Summarize operator-facing changes, known limitations, and any upgrade notes.

## Tagging

After verification passes:

```bash
git tag <version>
git push origin <version>
```

Only tag the commit that passed `npm run verify`.
