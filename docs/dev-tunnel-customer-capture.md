# Local Dev Customer Capture Tunnel

## Purpose

Use this setup when testing customer capture, NFC, or QR flows on a phone against local CorePOS development.

Why this is needed:

- `localhost` on your Mac is not reachable from your phone
- customer-capture links generated for phone use therefore need a reachable dev host
- production must not be used for dev-generated customer-capture links

## Standard Local Dev Ports

- backend default: `http://localhost:3100`
- frontend dev origin: `http://localhost:5173`
- do not use port `3000` for normal local CorePOS development

## Working Local Dev Model

- normal local dev:
  - leave `VITE_PUBLIC_APP_ORIGIN` unset
  - customer-capture links stay on the local frontend origin
- phone testing:
  - set `VITE_PUBLIC_APP_ORIGIN` to a reachable dev tunnel URL
  - generate a fresh customer-capture link after switching to that tunnel
- production:
  - never use the production capture host for local dev-generated capture links

## Local Config

Backend:

```env
PORT=3100
```

Local frontend example:

```env
VITE_API_URL=http://localhost:3100
VITE_PUBLIC_APP_ORIGIN=https://<current-trycloudflare-url>
```

Notes:

- `frontend/.env.local` is local-only and gitignored
- do not commit transient quick-tunnel URLs
- when you are not actively testing on a phone, leave `VITE_PUBLIC_APP_ORIGIN` unset

## Quick Tunnel Flow

1. Start CorePOS locally.
2. Start a Cloudflare quick tunnel:

```bash
cloudflared tunnel --url http://localhost:3100
```

3. Copy the generated `https://...trycloudflare.com` URL.
4. Update `frontend/.env.local`:

```env
VITE_API_URL=http://localhost:3100
VITE_PUBLIC_APP_ORIGIN=https://<current-trycloudflare-url>
```

5. Rebuild the frontend:

```bash
npm run build:frontend
```

6. Restart CorePOS.
7. Hard refresh the browser.
8. Generate a fresh tap request in POS.
9. Use the newest generated capture link only.

## Important Caveats

- each Cloudflare quick tunnel URL changes
- old quick tunnel URLs stop working
- old customer-capture tokens may already be expired, replaced, or no longer reachable through the new tunnel
- if the tunnel URL changes:
  - update `frontend/.env.local`
  - rebuild frontend
  - restart the app
  - hard refresh the browser
  - generate a fresh tap request

## Important Fixes Behind This Setup

- backend dev default port is `3100`
- localhost fallback URLs were aligned to `3100`
- backend SPA serving in dev must work for `/customer-capture`
- `serveFrontendSpa` depends on frontend bundle presence, not production-only mode

## Troubleshooting

### `Cannot GET /customer-capture`

Cause:

- backend is not serving the frontend bundle for SPA routes
- or the frontend bundle is stale/missing

Check:

- rebuild with `npm run build:frontend`
- restart CorePOS
- confirm the current code is using bundle-presence SPA serving

### Link opens production instead of dev

Cause:

- `VITE_PUBLIC_APP_ORIGIN` is set to a production host

Fix:

- remove that production value from `frontend/.env.local`
- for normal local dev, leave it unset
- for phone testing, set it to the current tunnel URL only
- rebuild frontend and restart CorePOS

### `localhost:5173` link works on Mac but not phone

Cause:

- your phone cannot reach your Mac's `localhost`

Fix:

- use a reachable tunnel URL in `VITE_PUBLIC_APP_ORIGIN`
- rebuild frontend, restart CorePOS, and generate a fresh tap request

### Tunnel URL returns `404`

Cause:

- the quick tunnel is no longer running
- or CorePOS was restarted without the tunnel still pointing at it

Fix:

- restart `cloudflared`
- confirm it points to `http://localhost:3100`
- update `frontend/.env.local` if the URL changed
- rebuild frontend, restart CorePOS, and generate a fresh tap request

### Cloudflare quick tunnel fails because `~/.cloudflared/config.yml` exists

Cause:

- `cloudflared tunnel --url ...` quick tunnels can be blocked by an existing persistent-tunnel config

Fix:

- temporarily move or rename `~/.cloudflared/config.yml`
- rerun:

```bash
cloudflared tunnel --url http://localhost:3100
```

### Backend is accidentally running on `3000` instead of `3100`

Cause:

- `PORT` was overridden manually
- or an old local process was started with stale defaults

Fix:

- confirm `.env` has `PORT=3100`
- stop the old process
- restart CorePOS and confirm backend health on `http://localhost:3100/health`

### Token is invalid, unavailable, or replaced

Cause:

- a newer tap request replaced the older one
- the link expired
- the tunnel URL changed after the link was generated

Fix:

- go back to POS
- refresh or create a new tap request
- use the newest generated link only

