# React Frontend Usage

## Run

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

Backend should be running on `http://localhost:3100`.
If you need a different local backend origin, set `VITE_API_PROXY_TARGET` before starting the frontend dev server so API proxying and backend print/receipt links stay aligned.
For local customer-capture testing, do not point `VITE_PUBLIC_APP_ORIGIN` at production. Leave it unset to use the local frontend origin, or set it to an explicitly reachable dev/tunnel host only for phone testing.
For the full phone/NFC customer-capture tunnel setup, use [docs/dev-tunnel-customer-capture.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/dev-tunnel-customer-capture.md).

## POS (M76)

Route: `/pos`

Keyboard and scanner flow:

- `/` focuses the search input.
- Barcode scans ending with `Enter` auto-add exact matches.
- `Enter` adds the top search result.
- `ArrowUp` / `ArrowDown` selects basket lines.
- `+` / `-` adjusts quantity on selected line.
- `Delete` / `Backspace` removes selected line.
- `Ctrl+Enter` opens completion confirmation.

The page keeps search focused after add/remove/qty changes and shows a **Last scanned** indicator.
Receipt links prefer the server-provided `receiptUrl` and fall back to `/r/:saleId` when missing.

## Workshop (M68 polish)

Routes:

- `/workshop`
- `/workshop/:id`

The workshop views include status badges, quick status actions, and prominent **Convert to Sale** / **Print Job** actions on job cards.

## Refunds (M77)

Route: `/refunds` (MANAGER/ADMIN)

Flow:

1. Search by sale ID or receipt number.
2. Choose refund quantities per line.
3. Select tender method.
4. Toggle **Return items to stock** if needed.
5. Process refund and open generated receipt.

## Daily Close (M78)

Route: `/manager/daily-close` (MANAGER/ADMIN)

Flow:

1. Choose date and optional location code.
2. Run daily close.
3. Review tenders/refunds/cash summary.
4. Print via `/reports/daily-close/print`.
