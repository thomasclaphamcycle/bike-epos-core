# CorePOS Active Task Queue

## Current Snapshot

- Working branch: `dev-next`
- Current HEAD: `62cb82c`
- Stable local restore point:
  - tag `v1.2-demo-running`
  - branch `stable-demo`
  - commit `c1fbf7c`
- Repo-wide milestone history reaches `M78`
- Current branch does not yet consolidate all post-`M43` milestone commits

## Confirmed Done

### On Current Working Line

- local PostgreSQL, Prisma migrate, demo seed, backend, frontend, and login all work together
- React login, POS, workshop, and customers pages exist
- canonical project guidance pack now exists
- local dev restore point exists and is pushed

### Confirmed Elsewhere In Repo History

- `M44` to `M60`
- `M67` to `M69`
- `M70` to `M73`
- `M76` to `M78`

These milestones are confirmed in branch history and/or remote refs, even where `dev-next` has not absorbed them as a single linear branch.

## What Is Next

The next tasks should start after the currently implemented milestone range, but only after branch reality is cleaned up.

Highest priority:

1. Consolidate the repo after `M78`
2. Expand regression coverage for the React line already in use
3. Decide the post-`M78` roadmap rather than continuing to accumulate disconnected milestone branches
4. Consolidate branch history so the current working line reflects the real implemented milestone set

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

### 1. Branch Consolidation

- reconcile `dev-next` with confirmed repo-wide milestone history
- decide whether `dev-next` should become the new integration branch or whether `origin/main` should remain canonical
- ensure one branch clearly represents the true project state through `M78`

### 2. React Coverage And Parity

- add or expand E2E coverage for:
  - React login
  - React POS sale completion and receipt opening
  - React workshop convert-to-sale flow
  - React customers attach-to-sale flow
  - manager refunds and daily close if those pages are merged into the active line

### 3. Strengthen The React Staff Surface

- add or expand coverage for:
  - React inventory search and detail flows
  - role-sensitive inventory detail behavior for STAFF vs MANAGER+
  - React navigation parity across POS, workshop, customers, and inventory

### 4. Start Post-M78 Planning

Only after the above:

- define the next milestone batch after the actual implemented range
- avoid inventing `M79+` work until the branch story is coherent

## Blocked / Dependent

- Post-`M78` planning is blocked on branch consolidation.
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

## Practical Resume Instructions

For the next session:

1. `git fetch --all --tags`
2. review `AGENTS.md`, `PLAN.md`, and this file first
3. inspect:
   - `origin/main`
   - `origin/react-ui`
   - `origin/backend-v1`
4. confirm which branch is intended to become the canonical post-`M78` line
5. only then start new feature work

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
- Treat repo-wide confirmed history as reaching roughly `M78`.
- Do not assume `dev-next` already contains every later milestone merge.
- Do not reopen `M1` to `M10`, `M61` to `M62`, or `M74` to `M75` as implementation gaps unless new archival evidence appears.
- Treat the previously missing-milestone set as reconciled; do not reopen `M65` unless the new inventory UI is removed or proven incomplete.
- If you add or merge milestone work, update all three canonical guidance files in the same change.
