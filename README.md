# bike-epos-core

Node/TypeScript + Express + Prisma + Postgres backend for bike EPOS workflows.

## Local Test Setup (Recommended)

1. Copy test env template:

```bash
cp .env.test.example .env.test
```

2. Start the dedicated test database and apply migrations:

```bash
npm run test:db:up
```

3. Run baseline test suite:

```bash
npm test
```

4. Run browser E2E suite:

```bash
npm run e2e
```

5. Stop and reset test database when done:

```bash
npm run test:db:down
```

## Baseline Smoke Suite

`npm test` runs:

- `npm run typecheck:reports`
- `npm run test:smoke`

`test:smoke` runs milestone smoke tests in this order:

1. `m11`
2. `m12`
3. `m13`
4. `m28`
5. `m32`
6. `m34`

All milestone smoke scripts now load `.env.test` automatically when present and default to:

- `NODE_ENV=test`
- `AUTH_MODE=header`
- `ALLOW_EXISTING_SERVER=1`
- `DATABASE_URL=TEST_DATABASE_URL` (when `DATABASE_URL` is unset)

Safety check remains in place: smoke scripts refuse non-test DB URLs unless `ALLOW_NON_TEST_DB=1` is explicitly set.

## Auth Modes

See [docs/auth.md](docs/auth.md) for full details.

Quick summary:

- `AUTH_MODE=header` is for local/CI smoke runs only.
- `AUTH_MODE=header` with `NODE_ENV=production` hard-fails at startup.
- Non-header modes reject incoming `X-Staff-*` header auth input.

## CI

GitHub Actions workflow: `.github/workflows/ci.yml`

On push and pull requests it:

1. Starts a Postgres service container
2. Installs dependencies
3. Runs Prisma generate + migrate deploy
4. Runs baseline `npm test`
5. Runs `npm run e2e` (Playwright)
