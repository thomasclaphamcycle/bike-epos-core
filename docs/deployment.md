# Deployment Guide

## Required Environment Variables

Backend:

- `DATABASE_URL` (PostgreSQL connection string)
- `AUTH_JWT_SECRET`
- `COOKIE_SECRET`
- `PORT` (default `3000`)
- `NODE_ENV` (`development`, `test`, or `production`)

Frontend (optional build-time customizations):

- `VITE_*` variables as needed (defaults work for local development)

## Local Development

1. Create `.env` from the example and point `DATABASE_URL` at a real local Postgres role:

```bash
cp .env.example .env
```

On many macOS setups the simplest working value is:

```bash
DATABASE_URL=postgresql://$(whoami)@localhost:5432/bike_epos
```

If the role or database is missing:

```bash
createuser -s "$(whoami)"
createdb bike_epos
```

If you previously ran a different branch and `npx prisma migrate dev` reports drift, reset the local dev database and recreate it from the current migrations:

```bash
node scripts/reset_local_dev_db.js
```

2. Run migrations and seed demo data:

```bash
npx prisma generate
npx prisma migrate dev
npm run db:seed:dev
```

3. Start backend (server-rendered UI and APIs):

```bash
npm run dev
```

4. Optional React UI development server for the current evaluator path:

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

The React app proxies `/api` to `http://localhost:3000` in development and is the recommended trial/evaluation surface on `http://localhost:5173/login`.

5. Prepare the dedicated test database before running `npm test` or `npm run e2e`:

```bash
npm run test:db:up
```

## Production Build

Build the React frontend bundle:

```bash
npm run build
```

Start production server:

```bash
npm run start:prod
```

In production (`NODE_ENV=production`), the backend serves static files from `frontend/dist` and returns `index.html` for non-API SPA routes.

Legacy printable routes (for example receipt and workshop print views) continue to be served by backend HTML handlers.

## Local Automation Note

This repo includes a project-scoped `.codex/config.toml` for trusted local development. It keeps Codex in `workspace-write`, sets `approval_policy = "never"`, and enables workspace-write network access so local services such as PostgreSQL on `localhost:5432` remain reachable without switching to full-access mode.

## Test Seeding

Seed test database data using `.env.test`:

```bash
npm run db:seed:test
```
