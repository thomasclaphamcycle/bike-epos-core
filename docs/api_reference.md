# API Reference

Base URL in local dev: `http://localhost:3000`

Notes:

- API routers are mounted in `src/server.ts`
- Permissions are shown from current route middleware (`requireRoleAtLeast`, `requireAuth`)
- `STAFF+` means `STAFF`, `MANAGER`, or `ADMIN`

## Auth

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | Public | Login and set auth cookie |
| POST | `/api/auth/logout` | Public | Clear auth cookie/session |
| GET | `/api/auth/me` | Authenticated | Return current user |
| POST | `/api/auth/bootstrap` | Public | Bootstrap first admin user (legacy/setup) |
| POST | `/auth/bootstrap` | Public | Top-level bootstrap alias |

## Sales

### Basket + checkout
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/baskets` | STAFF+ | Create basket |
| GET | `/api/baskets/:id` | STAFF+ | Get basket details |
| POST | `/api/baskets/:id/items` | STAFF+ | Add basket line |
| PATCH | `/api/baskets/:id/items/:itemId` | STAFF+ | Update basket line |
| DELETE | `/api/baskets/:id/items/:itemId` | STAFF+ | Remove basket line |
| POST | `/api/baskets/:id/lines` | STAFF+ | Alias: add basket line |
| PATCH | `/api/baskets/:id/lines/:itemId` | STAFF+ | Alias: update basket line |
| DELETE | `/api/baskets/:id/lines/:itemId` | STAFF+ | Alias: remove basket line |
| POST | `/api/baskets/:id/checkout` | STAFF+ | Convert basket to sale |

### Sales/tenders/returns
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/sales` | STAFF+ | List sales |
| GET | `/api/sales/:id` | STAFF+ | Get single sale |
| PATCH | `/api/sales/:saleId` | STAFF+ | Attach/patch sale customer |
| PATCH | `/api/sales/:saleId/customer` | STAFF+ | Attach customer (explicit path) |
| POST | `/api/sales/:saleId/customer` | STAFF+ | Attach customer (compat path) |
| GET | `/api/sales/:saleId/tenders` | STAFF+ | List tenders for sale |
| POST | `/api/sales/:saleId/tenders` | STAFF+ | Add tender line |
| DELETE | `/api/sales/:saleId/tenders/:tenderId` | STAFF+ | Delete tender line |
| POST | `/api/sales/:saleId/complete` | STAFF+ | Complete sale |
| POST | `/api/sales/:saleId/returns` | MANAGER+ | Create return/refund record against sale |

### Receipts
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/receipts/issue` | STAFF+ | Issue receipt for sale/refund |
| GET | `/api/receipts/:receiptNumber` | STAFF+ | Fetch receipt JSON |
| GET | `/api/sales/:saleId/receipt` | STAFF+ | Print-friendly sale receipt view |

## Workshop

### Workshop jobs
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/workshop/availability` | Public | Workshop scheduling availability |
| GET | `/api/workshop/dashboard` | Public | Workshop dashboard summary |
| POST | `/api/workshop/jobs` | STAFF+ | Create workshop job |
| GET | `/api/workshop/jobs` | STAFF+ | List workshop jobs |
| GET | `/api/workshop/jobs/:id` | STAFF+ | Get workshop job details |
| PATCH | `/api/workshop/jobs/:id` | STAFF+ | Patch workshop job |
| PATCH | `/api/workshop/jobs/:id/customer` | STAFF+ | Attach customer to workshop job |
| POST | `/api/workshop/jobs/:id/lines` | STAFF+ | Add workshop line |
| PATCH | `/api/workshop/jobs/:id/lines/:lineId` | STAFF+ | Update workshop line |
| DELETE | `/api/workshop/jobs/:id/lines/:lineId` | STAFF+ | Delete workshop line |
| POST | `/api/workshop/jobs/:id/reservations` | STAFF+ | Create stock reservation |
| DELETE | `/api/workshop/jobs/:id/reservations/:reservationId` | STAFF+ | Remove stock reservation |
| POST | `/api/workshop/jobs/:id/finalize` | STAFF+ | Finalize job |
| POST | `/api/workshop/jobs/:id/close` | STAFF+ | Close job |
| POST | `/api/workshop/jobs/:id/assign` | STAFF+ | Assign/unassign staff |
| POST | `/api/workshop/jobs/:id/status` | STAFF+ | Change job status |
| POST | `/api/workshop/jobs/:id/notes` | STAFF+ | Add job note |
| GET | `/api/workshop/jobs/:id/notes` | STAFF+ | List job notes |
| POST | `/api/workshop/jobs/:id/convert-to-sale` | MANAGER+ | Convert workshop lines to sale |
| POST | `/api/workshop/jobs/:id/checkout` | STAFF+ | Workshop checkout flow |
| POST | `/api/workshop/jobs/:id/cancel` | STAFF+ | Cancel workshop job |

### Workshop parts API (`/api/workshop-jobs`)
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/workshop-jobs/:id/parts` | Public (no route guard) | List workshop parts |
| POST | `/api/workshop-jobs/:id/parts` | Public (no route guard) | Add workshop part |
| PATCH | `/api/workshop-jobs/:id/parts/:partId` | Public (no route guard) | Patch workshop part |
| DELETE | `/api/workshop-jobs/:id/parts/:partId` | Public (no route guard) | Remove workshop part |

### Online booking API (`/api/workshop-bookings`)
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/workshop-bookings` | Public | Create online workshop booking |
| GET | `/api/workshop-bookings/manage/:token` | Public | Fetch booking by manage token |
| PATCH | `/api/workshop-bookings/manage/:token` | Public | Update booking by token |
| POST | `/api/workshop-bookings/manage/:token/pay-deposit` | Public | Pay booking deposit |
| POST | `/api/workshop-bookings/manage/:token/cancel` | Public | Cancel booking by token |

## Inventory

### Inventory ledger
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/inventory/movements` | STAFF+ | Record inventory movement |
| GET | `/api/inventory/movements` | MANAGER+ | List movements |
| GET | `/api/inventory/on-hand/search` | STAFF+ | Search on-hand records |
| GET | `/api/inventory/on-hand` | STAFF+ | Get on-hand for variant |
| POST | `/api/inventory/adjustments` | STAFF+ | Create adjustment movement |

### Stock + stocktake + locations
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/stock/variants/:variantId` | STAFF+ | Variant stock summary |
| POST | `/api/stock/adjustments` | MANAGER+ | Stock adjustment endpoint |
| GET | `/api/stocktakes` | STAFF+ | List stocktakes |
| POST | `/api/stocktakes` | MANAGER+ | Create stocktake |
| GET | `/api/stocktakes/:id` | STAFF+ | Get stocktake |
| POST | `/api/stocktakes/:id/lines` | MANAGER+ | Upsert stocktake line |
| DELETE | `/api/stocktakes/:id/lines/:lineId` | MANAGER+ | Delete stocktake line |
| POST | `/api/stocktakes/:id/post` | MANAGER+ | Post stocktake |
| POST | `/api/stocktakes/:id/finalize` | MANAGER+ | Finalize stocktake |
| POST | `/api/stocktakes/:id/cancel` | MANAGER+ | Cancel stocktake |
| GET | `/api/stocktake/sessions` | STAFF+ | List stocktake sessions (alias set) |
| POST | `/api/stocktake/sessions` | MANAGER+ | Create stocktake session |
| GET | `/api/stocktake/sessions/:id` | STAFF+ | Get stocktake session |
| POST | `/api/stocktake/sessions/:id/lines` | MANAGER+ | Upsert session line |
| POST | `/api/stocktake/sessions/:id/finalize` | MANAGER+ | Finalize session |
| POST | `/api/stocktake/sessions/:id/cancel` | MANAGER+ | Cancel session |
| GET | `/api/locations` | STAFF+ | List stock locations |

## Reports

### Core reports (`/api/reports`)
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/reports/sales/daily` | Public (no route guard) | Sales daily JSON report |
| GET | `/api/reports/sales/daily.csv` | MANAGER+ | Sales daily CSV export |
| GET | `/api/reports/workshop/daily` | Public (no route guard) | Workshop daily JSON report |
| GET | `/api/reports/workshop/daily.csv` | MANAGER+ | Workshop daily CSV export |
| GET | `/api/reports/inventory/on-hand` | Public (no route guard) | Inventory on-hand JSON report |
| GET | `/api/reports/inventory/on-hand.csv` | MANAGER+ | Inventory on-hand CSV export |
| GET | `/api/reports/inventory/value` | Public (no route guard) | Inventory valuation JSON report |
| GET | `/api/reports/inventory/value.csv` | MANAGER+ | Inventory valuation CSV export |
| GET | `/api/reports/payments` | MANAGER+ | Payments CSV export |

### Workshop financial reports (`/api/reports/workshop`)
| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/reports/workshop/payments` | Public (no route guard) | Workshop payments report |
| GET | `/api/reports/workshop/deposits` | Public (no route guard) | Workshop deposits report |
| GET | `/api/reports/workshop/credits` | Public (no route guard) | Workshop credits report |

## Admin

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| POST | `/api/admin/users` | ADMIN | Create user |
| GET | `/api/admin/users` | ADMIN | List users |
| PATCH | `/api/admin/users/:id` | ADMIN | Update user |
| POST | `/api/admin/users/:id/reset-password` | ADMIN | Reset user password |
| GET | `/api/admin/export/sales` | ADMIN | Stream sales CSV export |
| GET | `/api/admin/export/workshop` | ADMIN | Stream workshop CSV export |
| GET | `/api/admin/export/inventory` | ADMIN | Stream inventory CSV export |

## Audit

| Method | Path | Permission | Description |
| --- | --- | --- | --- |
| GET | `/api/audit` | MANAGER+ | Query audit events/log stream |

