# Deployment Guide

## Required Environment Variables

Set these in both local and production environments:

- `DATABASE_URL` (PostgreSQL connection string)
- `JWT_SECRET`
- `COOKIE_SECRET`
- `NODE_ENV` (`development` or `production`)
- `PORT` (default `3000`)

Optional but recommended:

- `DEFAULT_LOCATION_CODE` (default: `MAIN`)
- `DEFAULT_LOCATION_NAME` (default: `Main`)
- `AUTH_BCRYPT_ROUNDS` (default: `12`)

## Local Development

From repo root:

```bash
npx prisma migrate dev
npm run db:seed:dev
npm run dev
```

- Backend runs on `http://localhost:3000`.
- React frontend dev server runs separately with `npm --prefix frontend run dev` when needed.

## Production Build (Single Service)

The backend serves the built React app from `frontend/dist` when `NODE_ENV=production`.

```bash
npm ci
npm --prefix frontend ci
npx prisma migrate deploy
npm run build
npm run start:prod
```

## Notes

- In production, non-`/api` routes fall back to React `index.html`.
- Existing printable/server-rendered routes are preserved:
  - `/r/:receiptNumber`
  - `/sales/:saleId/receipt`
  - `/reports/daily-close/print`
