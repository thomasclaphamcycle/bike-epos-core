# Auth Modes

The app uses real authentication by default (`AUTH_MODE=real`) with cookie-based login sessions.

## Real Auth (default)

- `POST /api/auth/login` with `{ email, password }` sets an HTTP-only auth cookie.
- `POST /api/auth/pin-login` with `{ userId, pin }` sets the same HTTP-only auth cookie for the current PIN-first login UI.
- `POST /api/auth/logout` clears the cookie.
- `GET /api/auth/me` returns the authenticated user.
- `GET /api/auth/active-users` returns the active login-button list for the React login screen, including whether each account currently has a PIN set.
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

1. Start the backend (`npm run dev`).
2. Start the React frontend for the trial path (`npm --prefix frontend run dev`).
3. Open `http://localhost:5173/login`.
4. Select an active user button and enter a 4-digit PIN when the account has a PIN set.
5. If the account is password-only or its PIN has been reset, use the password fallback form on the same `/login` screen.
6. On successful login, navigate through `/home` to the authorized area based on role.

If the React frontend is not running, the backend-only login surface remains available on `http://localhost:3000/login`, but the current trial/evaluator path is the React SPA on `http://localhost:5173`.

## Seeded Demo Accounts

After `npm run db:seed:dev`, the demo seed creates these trial users:

| Role | Email | Password | PIN | Redirect from `/home` |
| --- | --- | --- | --- | --- |
| STAFF | `staff@local` | `staff123` | `1111` | `/dashboard` |
| MANAGER | `manager@local` | `manager123` | `2222` | `/management` |
| ADMIN | `admin@local` | `admin123` | `4444` | `/management/staff` |

The demo seed keeps the login list intentionally minimal at three clearly named role accounts. The login UI is intentionally PIN-first, but password login remains preserved for compatibility and for password-reset/operator flows.

Inactive or disabled users are not shown in the active-user login list and cannot authenticate through either the PIN or password flow.

## Default Routes and Navigation

- When the React SPA is active, `/` loads the app shell and immediately routes authenticated users through `/home` to their role landing page (`/dashboard`, `/management`, or `/management/staff`).
- In backend-only/non-SPA mode, `/` continues to redirect authenticated users to `/pos`; the legacy server-rendered `/login` page also keeps `/pos` as its default fallback target.
- Protected HTML pages redirect to `/login?next=...` if unauthenticated.
- If authenticated but role is insufficient, HTML pages redirect to `/not-authorized`.
- Current UX branch shell visibility is intentionally reduced while navigation is being refined.
- The reduced sidebar still exposes the core day-to-day links for the signed-in role, while protected routes continue to enforce direct access to management and admin pages that are not surfaced as top-level sidebar links.

## Smoke Tests and Auth

Smoke scripts run with `NODE_ENV=test`, so header fallback remains available for existing milestone scripts.

New auth/admin/till smoke tests validate backend auth behavior, while the current React login UI uses `GET /api/auth/active-users`, `POST /api/auth/pin-login`, and the preserved password fallback path as needed.
