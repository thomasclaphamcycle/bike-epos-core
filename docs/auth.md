# Auth Modes

The app uses real authentication by default (`AUTH_MODE=real`) with cookie-based login sessions.

## Real Auth (default)

- `POST /api/auth/login` with `{ email, password }` sets an HTTP-only auth cookie.
- `POST /api/auth/logout` clears the cookie.
- `GET /api/auth/me` returns the authenticated user.
- Protected routes use `requireRoleAtLeast("STAFF" | "MANAGER" | "ADMIN")`.

Roles are stored in DB (`User.role`) and enforced from the authenticated user, not from headers.

## Header Fallback (dev/test only)

Header auth is a fallback for smoke tests and local troubleshooting.

It is accepted only when one of these is true:

- `NODE_ENV=test`
- `ALLOW_HEADER_AUTH=1`

Accepted headers:

- `X-Staff-Role`
- `X-Staff-Id`
- optional `X-Internal-Auth` if `INTERNAL_AUTH_SHARED_SECRET` is set

Safety rules:

- Existing real users are never mutated by header auth input.
- In production, header-only auth is rejected.
- `AUTH_MODE=header` is blocked unless `NODE_ENV=test` or `ALLOW_HEADER_AUTH=1`.

## Environment Variables

- `AUTH_MODE=real` (recommended default)
- `AUTH_JWT_SECRET` (required in production)
- `AUTH_TOKEN_TTL_SECONDS` (optional, default 12h)
- `ALLOW_HEADER_AUTH=1` (optional local non-test bypass)
- `INTERNAL_AUTH_SHARED_SECRET` (optional extra protection for header fallback)

## Initial Admin Setup

Option 1 (recommended): script

```bash
ADMIN_NAME="Admin User" \
ADMIN_EMAIL="admin@example.com" \
ADMIN_PASSWORD="ChangeMe123!" \
npm run auth:seed-admin
```

Option 2: bootstrap endpoint (only when DB has no users)

```http
POST /api/auth/bootstrap
{ "name": "Admin User", "email": "admin@example.com", "password": "ChangeMe123!" }
```

## Local Login Flow

1. Start app (`npm run dev`).
2. Open `/login`.
3. Login with staff credentials.
4. Navigate to `/pos`, `/workshop`, `/admin`, `/till` based on role.

## Default Routes and Navigation

- `/` redirects to `/pos` when authenticated, otherwise `/login`.
- Protected HTML pages redirect to `/login?next=...` if unauthenticated.
- If authenticated but role is insufficient, HTML pages redirect to `/not-authorized`.
- App shell nav visibility:
  - `STAFF+`: POS, Workshop, Inventory
  - `MANAGER+`: Till / Cash Up
  - `ADMIN`: Admin Users, Admin Audit

## Smoke Tests and Auth

Smoke scripts run with `NODE_ENV=test`, so header fallback remains available for existing milestone scripts.

New auth/admin/till smoke tests also validate real login flows via `/api/auth/login`.
