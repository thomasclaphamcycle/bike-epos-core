# CorePOS Roadmap Progress Reporting

This document explains the real-data roadmap progress system used by CorePOS.

Use it alongside:

- [docs/ROADMAP.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/ROADMAP.md) for the canonical phase structure
- [PLAN.md](/Users/thomaswitherspoon/Development/bike-epos-core/PLAN.md) for milestone history and sequencing context

## Commands

- `npm run roadmap`
  - prints the current per-phase completion table in the terminal
- `npm run roadmap -- --debug`
  - prints item-level scoring and matched / unmatched evidence signals
- `npm run roadmap:json`
  - prints the full computed roadmap state as JSON
- `npm run roadmap:chart`
  - writes a PNG chart to `docs/roadmap-progress.png`

## Source Of Truth

The roadmap structure itself remains defined in [docs/ROADMAP.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/ROADMAP.md).

Computed progress is defined by:

- [definition.js](/Users/thomaswitherspoon/Development/bike-epos-core/scripts/roadmap/definition.js)
- [engine.js](/Users/thomaswitherspoon/Development/bike-epos-core/scripts/roadmap/engine.js)

`definition.js` is the canonical scoring definition file. It maps:

- each roadmap phase
- each measurable roadmap item within that phase
- the evidence signals used to score that item
- the item weight
- the thresholds for `partial` and `complete`

## Scoring Model

Each roadmap item is scored using simple thresholds against explicit signals:

- `0` = not started
- `0.5` = partial
- `1` = complete

Each item defines:

- `weight`
- `partialAt`
- `completeAt`
- `signals`

Signals are evaluated against real repository evidence such as:

- route/page existence
- backend service files
- Prisma models
- registered smoke scripts
- smoke/e2e test files
- concrete route strings or implementation markers in code

Phase completion is the weighted average of its item scores.

Overall completion is the weighted average across all phases.

## Evidence Types

The current engine supports these evidence types:

- `fileExists`
- `text`
- `packageScript`
- `schemaModel`

This keeps the system simple, explicit, and auditable.

## LOC Calculation

The report also computes source LOC from the current repo.

Current LOC rules:

- included roots:
  - `src`
  - `frontend/src`
  - `scripts`
  - `e2e`
  - `prisma`
- included file extensions:
  - `.ts`
  - `.tsx`
  - `.js`
  - `.jsx`
  - `.prisma`
  - `.sql`
  - `.css`
- excluded directories:
  - `node_modules`
  - `dist`
  - `frontend/dist`
  - `coverage`
  - `playwright-report`
  - `test-results`
  - `.git`
  - `tmp`

The current LOC metric counts non-empty lines only.

## Updating The System

When CorePOS evolves:

1. update [docs/ROADMAP.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/ROADMAP.md) if the phase structure changes
2. update [definition.js](/Users/thomaswitherspoon/Development/bike-epos-core/scripts/roadmap/definition.js) when:
   - a new measurable item should count toward a phase
   - a stronger evidence signal becomes available
   - a placeholder signal should be replaced by real feature evidence
3. rerun:
   - `npm run roadmap`
   - `npm run roadmap:chart`

Prefer stronger evidence over weaker evidence:

- smoke/e2e coverage is stronger than a placeholder route
- real backend services or Prisma models are stronger than docs
- route existence alone should usually count as partial, not complete

## Limitations

- The system is conservative and evidence-based, not product-management-perfect.
- Some future-facing phases still rely on partial UI scaffolding or absence-of-file checks because the full implementation does not exist yet.
- A feature can be implemented in a limited way and still score `partial`; that is intentional.
- This system measures implemented evidence in the repo, not business readiness or production rollout quality.
