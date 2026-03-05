# Auth Modes

This project supports a runtime auth mode switch via `AUTH_MODE`.

## Values

- `header`: temporary header-based staff auth for local development and CI smoke/E2E tests.
- `real`: placeholder for non-header auth integration.
- `disabled`: alias of `real`.

## Header Mode Rules

When `AUTH_MODE=header`:

- Protected staff routes use `X-Staff-Role` and optional `X-Staff-Id`.
- If `INTERNAL_AUTH_SHARED_SECRET` is set, matching `X-Internal-Auth` is required.
- Startup hard-fails when `NODE_ENV=production`.

This prevents accidental production deployment with header auth enabled.

## Non-Header Mode Rules

When `AUTH_MODE` is `real`/`disabled`:

- Header-based auth is not accepted.
- Requests that attempt `X-Staff-Id`, `X-Staff-Role`, or `X-Internal-Auth` are rejected.

## Local Test Recommendation

For smoke/E2E:

- `NODE_ENV=test`
- `AUTH_MODE=header`
- `TEST_DATABASE_URL` pointing to a dedicated test DB

The helper scripts in `scripts/` and npm test scripts are wired to this flow by default.
