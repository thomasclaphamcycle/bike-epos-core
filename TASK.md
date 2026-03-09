# CorePOS Active Task Queue

## Current Snapshot

- Branch: `dev-next`
- Current HEAD: `c1fbf7c`
- Stable restore point:
  - tag `v1.2-demo-running`
  - branch `stable-demo`
- Local dev is working:
  - backend runs
  - frontend runs
  - Prisma generate and migrate work
  - demo seed works
  - login works

## Done

- local PostgreSQL setup is documented and working
- `.env.example` exists and reflects the intended local setup
- demo seed and reset helper exist
- React frontend exists for login, POS, workshop, and customers
- backend baseline smoke coverage is established through `m43`
- checkpoint commit, branch, and tag have already been created
- canonical project guidance pack now exists:
  - `AGENTS.md`
  - `PLAN.md`
  - `TASK.md`

## Next

Highest-priority next work, in recommended order:

1. Expand automated coverage for the React pages already present on this branch.
2. Decide whether the next product work should happen on `dev-next` or be merged from other milestone branches first.
3. Bring the next operational area to React parity without breaking SSR or print routes.
4. Do a focused repo hygiene pass for tracked junk files and stale docs.

## Recommended Sequencing

### 1. Protect What Already Exists

- add or extend E2E coverage for:
  - React login
  - React POS happy path
  - React workshop convert-to-sale flow
  - React customers attach-to-sale flow

### 2. Choose The Next UI Surface

Preferred next UI targets:

- inventory
- manager ops
- reports
- till
- admin

Choose one domain, complete it end-to-end, then update smoke/E2E/docs before starting another.

### 3. Consolidate Architecture Intent

- decide whether SSR remains a permanent admin/print surface
- or whether React becomes the main shell and SSR is reduced to printable/special-purpose pages

Do not let both UI layers drift independently.

## Blocked Or Dependent Work

- Any future milestone plan beyond what is visible in this branch is partially dependent on reconciling work that may exist in other branches or tags.
- Schema-heavy work is dependent on keeping `prisma/schema.prisma`, `prisma/migrations/`, and `scripts/seed_demo_data.ts` in sync.
- Local DB drift must be resolved before meaningful schema work. Use `node scripts/reset_local_dev_db.js` only for local development databases.

## Known Technical Debt

- The repo still tracks junk files such as `.DS_Store` in some locations.
- Older docs such as `PROJECT_CONTEXT.md` are historically useful but no longer complete.
- The smoke suite baseline does not yet cover all existing React flows.
- The branch currently mixes:
  - legacy/server-rendered UI
  - newer React UI
  - milestone-era backend surfaces

This is workable, but it needs deliberate consolidation.

## Practical Resume Instructions

For the next coding session:

1. `git fetch --all --tags`
2. `git checkout dev-next`
3. `npm ci`
4. `npm --prefix frontend install`
5. `cp .env.example .env` if needed and confirm `DATABASE_URL`
6. `cp .env.test.example .env.test` if needed
7. `npx prisma generate`
8. `npx prisma migrate dev`
9. `npm run db:seed:dev`
10. `npm run dev`
11. `npm --prefix frontend run dev`

If local Prisma drift appears:

1. stop the app
2. run `node scripts/reset_local_dev_db.js`
3. rerun migrate + seed

## Validation Baseline For New Work

Use this as the normal minimum before closing a task:

- backend changes:
  - relevant `npm run test:mXX`
  - `npm test` if shared flows changed
- frontend changes:
  - `npm --prefix frontend run build`
- auth/routing/workshop/POS changes:
  - `npm run e2e`

## Notes For The Next Agent

- Start from `AGENTS.md`, then `PLAN.md`, then this file.
- Trust code and smoke coverage over older narrative docs.
- Treat `v1.2-demo-running` as the safe rollback point.
- If you introduce a new milestone, update all three canonical guidance files as part of the same change.
