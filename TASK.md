# CorePOS Active Task Queue

## Current Snapshot

- Working branch: `dev-next`
- Stable local restore point:
  - tag `v1.2-demo-running`
  - branch `stable-demo`
  - commit `c1fbf7c`
- Historically evidenced milestone history reaches `M78`
- The current working line implements the roadmap through `M135`
- Earlier branch ancestry is still fragmented, but the present branch state is roadmap-complete and in stabilization mode
- Current working mode is trial-use readiness, not milestone expansion
- Roadmap implementation on the current working line is complete through `M135`
- Current focus is stabilization, verification, release readiness, and operational polish
- Current branch purpose: Saledock-aligned UX refinement focused on navigation clarity, grouping, discoverability, and lower cognitive load

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
- `M82` workshop board is implemented
- `M83` workshop estimates and approvals are implemented
- `M84` workshop parts allocation workflow is implemented
- `M85` management dashboard is implemented
- `M86` sales analytics is implemented
- `M87` workshop performance metrics is implemented
- `M88` product sales analytics is implemented
- `M89` inventory velocity is implemented
- `M90` supplier performance is implemented
- `M91` reorder suggestions is implemented
- `M92` workshop capacity analytics is implemented
- `M93` staff / role management UI is implemented
- `M94` audit and activity UI is implemented
- `M95` customer insights / CRM summary is implemented
- `M96` purchase order action centre is implemented
- `M97` refunds / exceptions oversight is implemented
- `M98` cash / till oversight dashboard is implemented
- `M99` end-of-day / ops summary is implemented
- `M100` notifications & alerts centre is implemented
- `M101` saved views / manager filters are implemented
- `M102` export hub / management downloads is implemented
- `M103` service reminders / follow-up queue is implemented
- `M104` customer contact timeline is implemented
- `M105` supplier catalogue / intake tools is implemented
- `M106` booking / appointment board is implemented
- `M107` workshop calendar and capacity scheduling is implemented
- `M108` customer communication queue is implemented
- `M109` multi-step workshop check-in / intake form is implemented
- `M110` collection / handover workflow is implemented
- `M111` warranty / return tracking is implemented
- `M112` workshop documents / print centre is implemented
- `M113` internal tasks / follow-up actions is implemented
- `M114` stock exceptions / investigation queue is implemented
- `M115` role-tailored home screens are implemented
- `M116` KPI widgets / dashboard customization is implemented
- `M117` operational search / global command bar is implemented
- `M118` multi-location inventory views are implemented
- `M119` transfer / replenishment queue is implemented
- `M120` advanced workshop SLA / ageing views are implemented
- `M121` supplier receiving workspace is implemented
- `M122` product data completion queue is implemented
- `M123` admin audit / permissions review is implemented
- `M124` pricing review / margin exceptions is implemented
- `M125` returns-to-supplier queue is implemented
- `M126` ops health / system readiness dashboard is implemented
- `M127` daily trade close pack is implemented
- `M128` outstanding liabilities / deposits review is implemented
- `M129` staff activity & throughput views are implemented
- `M130` data integrity checks are implemented
- `M131` backup / export toolkit is implemented
- `M132` system configuration panel is implemented
- `M133` onboarding / first run setup is implemented
- `M134` UI polish / navigation consistency pass is implemented
- `M135` admin / operations documentation hub is implemented

### Confirmed Elsewhere In Repo History

- `M44` to `M60`
- `M67` to `M69`
- `M70` to `M73`
- `M76` to `M78`

These milestones are confirmed in branch history and/or remote refs. The current `dev-next` line now carries the later roadmap continuation through `M135`, but the long-term ancestry remains historically fragmented.

## Current Milestone

- no new feature milestone is active
- current phase: UX refinement, release readiness, and real-world trial preparation

## Next Milestones Queue

- not yet defined in the canonical plan after `M135`

## What Is Next

Highest priority:

1. keep the branch buildable and smoke-stable
2. simplify navigation and improve discoverability with small, reversible shell changes
3. improve regression coverage where current gaps block confident verification
4. continue repo hygiene and branch consolidation in parallel

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

### 1. Management & Reporting Follow-Through

- keep `/management` practical and additive as analytics/reporting, planning, and administration grows around it

### 2. React Coverage And Parity

- add or expand E2E coverage for:
  - dashboard loading
  - inventory search/detail flows
  - purchasing flows
  - workshop board flows

### 3. Maintenance Track

- continue branch consolidation work in parallel
- keep docs aligned with the actual milestone state
- address tracked junk files and other hygiene issues in dedicated maintenance work

## Blocked / Dependent

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
- React workshop estimates/approvals and parts allocation now exist, but they still lack dedicated frontend automation

## Practical Resume Instructions

For the next session:

1. `git fetch --all --tags`
2. review `AGENTS.md`, `PLAN.md`, and this file first
3. inspect:
   - `origin/main`
   - `origin/react-ui`
   - `origin/backend-v1`
4. confirm which branch is intended to become the canonical post-`M81` line
5. inspect the current workshop + stock route/controller/service surface before starting the next milestone
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
- The current working line now includes `M82`, `M83`, and `M84`.
- The current working line now includes `M85` and `M86`.
- The current working line now includes `M87`.
- The current working line now includes `M88`, `M89`, and `M90`.
- The current working line now includes `M91`, `M92`, and `M93`.
- The current working line now also includes `M94`.
- The current working line now also includes `M95`.
- The current working line now also includes `M96`.
- The current working line now also includes `M97`.
- The current working line now also includes `M98`.
- The current working line now also includes `M99`.
- The current working line now also includes `M100`.
- The current working line now also includes `M101`.
- The current working line now also includes `M102`.
- The current working line now also includes `M103`.
- The current working line now also includes `M104`.
- The current working line now also includes `M105`.
- The current working line now also includes `M106`.
- The current working line now also includes `M107`.
- The current working line now also includes `M108`.
- The current working line now also includes `M109`.
- The current working line now also includes `M110`.
- The current working line now also includes `M111`.
- The current working line now also includes `M112`.
- The current working line now also includes `M113`.
- The current working line now also includes `M114`.
- The current working line now also includes `M115`.
- The current working line now also includes `M116`.
- The current working line now also includes `M117`.
- The current working line now also includes `M118`.
- The current working line now also includes `M119`.
- The current working line now also includes `M120`.
- The current working line now also includes `M121`.
- The current working line now also includes `M122`.
- The current working line now also includes `M123`.
- The current working line now also includes `M124`.
- The current working line now also includes `M125`.
- The current working line now also includes `M126`.
- The current working line now also includes `M127`.
- The current working line now also includes `M128`.
- The current working line now also includes `M129`.
- The current working line now also includes `M130`.
- The current working line now also includes `M131`.
- The current working line now also includes `M132`.
- The current working line now also includes `M133`.
- The current working line now also includes `M134`.
- The current working line now also includes `M135`.
- No post-`M135` milestone is defined yet in this canonical plan.
- If you add or merge milestone work, update all three canonical guidance files in the same change.
