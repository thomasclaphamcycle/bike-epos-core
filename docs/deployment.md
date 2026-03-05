# Deployment Guide

## Runtime prerequisites

- Node.js 20 LTS
- PostgreSQL (same major/minor compatibility as Prisma client in this repo)
- npm (lockfile-based install)

## Environment variables

Required at startup (validated in `src/config/runtimeEnv.ts`):

- `DATABASE_URL`
- `JWT_SECRET` (legacy fallback: `AUTH_JWT_SECRET`)
- `PORT`
- `NODE_ENV`
- `COOKIE_SECRET`

Provided template:

- `.env.example`

Other commonly used variables:

- `AUTH_MODE` (`real` by default)
- `AUTH_COOKIE_NAME`
- `AUTH_TOKEN_TTL_SECONDS`
- `WORKSHOP_MANAGE_TOKEN_DAYS`

## Local development

1. Install dependencies:

```bash
npm ci
```

2. Create env file:

```bash
cp .env.example .env
```

3. Set `DATABASE_URL` to your local Postgres database.

4. Run migrations:

```bash
npx prisma migrate dev
```

5. Start app:

```bash
npm run dev
```

6. Verify health endpoint:

```bash
curl http://localhost:3000/health
```

Expected shape:

```json
{
  "status": "ok",
  "uptime": 123.45
}
```

## Docker

### Build image

```bash
docker build -t corepos:latest .
```

### Run container

```bash
docker run --rm -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_SECRET="replace-me" \
  -e COOKIE_SECRET="replace-me" \
  -e NODE_ENV="production" \
  -e PORT="3000" \
  corepos:latest
```

Container entrypoint:

- `npm run start` (runs `src/server.ts` via `ts-node`)

## Database setup and migrations

For production/CI style deployment:

1. Install dependencies (`npm ci`)
2. Generate Prisma client if needed:

```bash
npx prisma generate
```

3. Apply committed migrations:

```bash
npx prisma migrate deploy
```

4. Start application (`npm run start` or your process manager)

## Graceful shutdown behavior

The server traps `SIGINT` and `SIGTERM`.

On shutdown it:

1. stops accepting new HTTP connections (`server.close`)
2. disconnects Prisma (`prisma.$disconnect()`)
3. exits with code `0` on success or `1` on failure

## Production logging

A minimal request logger is enabled only when `NODE_ENV=production`.

Logged fields:

- HTTP method
- request path
- response status code
- response time (ms)

No request body, headers, cookies, or tokens are logged.

## Validation / release QA checklist

Run before release:

```bash
npm test
npm run e2e
npm run test:smoke
```

Optional targeted checks:

```bash
npm run test:m59
```

