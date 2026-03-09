# CorePOS Active Task Queue

## Current Snapshot

- Working branch: `dev-next`
- Stable local restore point:
  - tag `v1.2-demo-running`
  - branch `stable-demo`
  - commit `c1fbf7c`
- Repo-wide milestone history reaches `M78`
- Current branch does not yet consolidate all post-`M43` milestone commits

## Confirmed Done

### On Current Working Line

- local PostgreSQL, Prisma migrate, demo seed, backend, frontend, and login all work together
- React login, POS, workshop, inventory, and customers pages exist
- canonical project guidance pack now exists
- local dev restore point exists and is pushed
- `M65` React inventory UI is implemented and committed
- `M79` staff dashboard is implemented
- `M80` inventory management tools are implemented
- `M81` supplier and purchasing UI is implemented

### Confirmed Elsewhere In Repo History

- `M44` to `M60`
- `M67` to `M69`
- `M70` to `M73`
- `M76` to `M78`

These milestones are confirmed in branch history and/or remote refs, even where `dev-next` has not absorbed them as a single linear branch.

## Current Milestone

### `M81` - Supplier & Purchasing UI

Status:

- completed on the current working line

## Next Milestones Queue

- post-`M81` milestones are not yet defined in the canonical roadmap

## What Is Next

Highest priority:

1. validate and commit `M81` cleanly
2. define the next post-`M81` milestone batch before starting implementation work
3. expand regression coverage for the React line already in use
4. keep branch consolidation and repo hygiene as parallel maintenance work

## Missing Milestone Reconciliation

Not active gaps:

- `M1` to `M10`
  - historical foundation numbering with no surviving per-milestone artifacts
- `M61` to `M62`
  - appear to be dropped numbering slots between `M60` and the later React milestone line
- `M74` to `M75`
  - best treated as scope absorbed into neighboring infra/admin/security milestones

Current true gaps from the reconciled missing-milestone set:

- none

## Recommended Sequencing

### 1. Post-`M81` Roadmap Definition

- define the next exact milestone batch before coding further
- keep the historical `M1` to `M78` ledger unchanged
- add new milestones explicitly instead of extending "roughly" phrasing

### 2. React Coverage And Parity

- add or expand E2E coverage for:
  - dashboard loading
  - inventory search/detail flows
  - purchasing flows once added

### 3. Maintenance Track

- continue branch consolidation work in parallel
- keep docs aligned with the actual milestone state
- address tracked junk files and other hygiene issues in dedicated maintenance work

## Blocked / Dependent

- no implementation blocker is currently known for `M81`; the remaining dependency is roadmap definition for the next milestone batch
- Any schema-heavy work is dependent on keeping:
  - `prisma/schema.prisma`
  - `prisma/migrations/`
  - `scripts/seed_demo_data.ts`
  in sync.
- Local database drift must still be resolved using `node scripts/reset_local_dev_db.js` only for local development databases.

## Known Technical Debt

- tracked junk files such as `.DS_Store` still exist
- old narrative docs understate milestone progress relative to repo history
- smoke coverage on `dev-next` still centers on `M43` era scripts
- React and server-rendered UI layers coexist without a fully consolidated ownership model
- branch history after `M43` is fragmented across `origin/main`, `origin/react-ui`, `origin/backend-v1`, and milestone refs
- React purchasing flows now exist but do not yet have dedicated frontend automation

## Practical Resume Instructions

For the next session:

1. `git fetch --all --tags`
2. review `AGENTS.md`, `PLAN.md`, and this file first
3. inspect:
   - `origin/main`
   - `origin/react-ui`
   - `origin/backend-v1`
4. confirm which branch is intended to become the canonical post-`M81` line
5. define the next explicit milestone batch
6. only then start new feature work

For local setup:

1. `npm ci`
2. `npm --prefix frontend install`
3. `cp .env.example .env` if needed
4. `cp .env.test.example .env.test` if needed
5. `npx prisma generate`
6. `npx prisma migrate dev`
7. `npm run db:seed:dev`
8. `npm run dev`
9. `npm --prefix frontend run dev`

## Validation Baseline

For consolidation or major cross-cutting work:

- `npm test`
- `npm run e2e`
- `npm --prefix frontend run build`

For repo-history alignment work, also verify that:

- migrations still apply cleanly on a fresh local DB
- demo seed still runs
- restore point guidance remains accurate

## Notes For The Next Agent

- Start from `AGENTS.md`, then `PLAN.md`, then this file.
- Treat repo-wide confirmed history as reaching `M78`.
- Do not assume `dev-next` already contains every later milestone merge.
- Do not reopen `M1` to `M10`, `M61` to `M62`, or `M74` to `M75` as implementation gaps unless new archival evidence appears.
- Treat the previously missing-milestone set as reconciled; do not reopen `M65` unless the new inventory UI is removed or proven incomplete.
- The current working line now includes `M79`, `M80`, and `M81`.
- If you add or merge milestone work, update all three canonical guidance files in the same change.
