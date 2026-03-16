# Real Shop Pilot Preparation

This guide is for a developer, shop owner, or evaluator preparing a short CorePOS pilot using the seeded demo environment.

Use this alongside:

- [README.md](/Users/thomaswitherspoon/Development/bike-epos-core/README.md) for local setup
- [production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) for real deployment, backup, restore, and upgrade guidance

## Quick Start For Shop Owners

1. Prepare the local environment:

```bash
npm ci
npm --prefix frontend ci
cp .env.example .env
cp .env.test.example .env.test
npx prisma generate
npx prisma migrate dev
npm run db:seed:dev
```

2. Start CorePOS:

```bash
npm run dev
npm --prefix frontend run dev
```

3. Open `http://localhost:5173/login`.

4. Log in with an existing active staff account.

If this is a fresh local setup, restore the intended local roster with `npm run auth:seed-local-staff` or `npm run db:reset-and-seed:dev`. That makes Thomas the local admin account.

5. Walk the core operational flows below in order.

## Operator Walkthrough

### 1. Staff login and POS sale

- Log in as an active staff user
- confirm `/home` routes to `/dashboard`
- open `/pos`
- attach one of the seeded customers
- add one or two seeded products
- complete a simple sale and open the receipt

What this proves:

- role-aware login works
- POS search, basket, tenders, and receipts work
- customer attachment persists through checkout

### 2. Workshop intake and collection

- stay as staff or log back in as a manager
- open `/workshop` and review the seeded jobs
- open `/workshop/check-in` and create a simple new job for an existing customer
- open a job detail page and review notes, parts, and current status
- open `/workshop/collection` to review ready-to-collect work

What this proves:

- workshop intake works end to end
- job progress and notes are visible to operators
- collection is treated as a sale-linked handoff

### 3. Inventory lookup and stock visibility

- log in as a manager
- open `/inventory`
- search for a seeded product
- open the variant detail page
- review on-hand stock and recent movement history

What this proves:

- stock visibility is usable from a seeded state
- inventory detail explains current on-hand and movement context

### 4. Purchasing and receiving

- remain logged in as a manager
- open `/purchasing`
- open the seeded purchase order
- review expected quantities and supplier cost
- use the receiving flow to receive some or all of the order

What this proves:

- purchase-order lifecycle works from draft/sent into receiving
- receiving updates stock with the current purchasing rules

### 5. Management overview

- review `/management`
- open `/management/actions`
- open `/management/investigations`
- open `/management/reminders`
- open `/management/exports` and `/management/backups`

What this proves:

- managers can find the main reporting/oversight surfaces
- the seeded environment is sufficient for a guided evaluation

## Sample Shop Workflows

Use this small pilot script when demonstrating CorePOS to a real shop team:

1. Morning open:
   log in as manager, confirm dashboard, review management alerts, then open the till.
2. Counter sale:
   log in as staff, find a product, attach a customer, and complete a sale.
3. Workshop drop-off:
   check in a bike, add notes, and assign or progress the job.
4. Parts and stock check:
   review inventory for the part used by the workshop job and inspect movement history.
5. Supplier receiving:
   receive a purchase-order line and confirm stock updates.
6. End-of-demo management review:
   return to management pages and review activity, actions, and exports/backups.

## Known Limitations

- some management surfaces are visibility/reporting tools rather than fully closed-loop operational modules
- supplier catalogue and supplier-product linking are still internal/manual groundwork, not automated supplier integrations
- multi-location inventory is foundation work only; default-location behavior remains the main operational path
- legacy backend-rendered pages still coexist with the React SPA, but the recommended pilot path is the React app on `http://localhost:5173`
- demo data is intentionally small and evaluation-friendly, not a full simulation of a live shop

## Pilot Readiness Checks

Before showing CorePOS to a shop team:

- confirm `npm run db:seed:dev` completed successfully
- confirm both backend and frontend are running
- confirm you can log in with staff, manager, and admin demo accounts
- confirm `/pos`, `/workshop`, `/inventory`, `/purchasing`, and `/management` all load
- take a backup if you plan to reuse the same pilot database across sessions

If you are preparing for a real deployment rather than a demo, use [production_setup.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/production_setup.md) before going live.
