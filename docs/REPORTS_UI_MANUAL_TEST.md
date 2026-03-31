# Reports UI (M20) Manual Test

CSV exports now use server endpoints from M22 (not client-side CSV generation):
- `/api/reports/sales/daily.csv?from&to`
- `/api/reports/workshop/daily.csv?from&to`
- `/api/reports/inventory/on-hand.csv?locationId=...`
- `/api/reports/inventory/value.csv?locationId=...`
Both control-row and section-header `Export CSV` actions use the same server endpoints and validation rules.

## Prerequisites
- Server running on `http://localhost:3100`.
- Use manager headers (temporary auth pattern):
  - `X-Staff-Role: MANAGER` or `ADMIN`
  - Optional: `X-Staff-Id: <id>`

## Open page
1. Open `/reports` in an HTTP client or browser request that sends manager headers.
2. Confirm page loads and tabs are visible:
   - Sales Daily
   - Workshop Daily
   - Inventory On-hand
   - Inventory Value

## Sales Daily checks
1. Set `from` and `to`.
2. Click `Load`.
3. Confirm table rows render and totals show:
   - saleCount
   - grossPence
   - refundsPence
   - netPence
4. Confirm note is visible: refunds are posted that day, net can be negative.
5. Click `Export CSV` and verify file downloads.

## Workshop Daily checks
1. Set `from` and `to`.
2. Click `Load`.
3. Confirm table rows render and totals show:
   - jobCount
   - revenuePence
4. Click `Export CSV` and verify file downloads.

## Inventory On-hand checks
1. Confirm location dropdown loads from `GET /api/locations`.
2. Select a location and click `Load`.
3. Confirm rows render with:
   - variantId
   - productName
   - option/name
   - barcode
   - onHand
4. Type in filter box and confirm client-side filtering updates rows without refetch.
5. Click `Export CSV` and verify file downloads.

## Inventory Value checks
1. Select a location and click `Load`.
2. Confirm totals render:
   - totalValuePence
   - countMissingCost
3. Confirm rows with missing cost are highlighted.
4. Click `Export CSV` and verify file downloads.

## Error/loading checks
1. Temporarily set `X-Staff-Role: STAFF` in the page header fields and load any report.
2. Confirm friendly API error message appears.
3. Confirm loading status text appears while requests are in-flight.
