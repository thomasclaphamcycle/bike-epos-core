# Dojo Pay at Counter Integration

CorePOS supports a Dojo Pay at Counter terminal flow for POS card tenders. This is a server-side cloud API integration: CorePOS creates a local card payment intent, creates a Dojo payment intent, starts a Dojo terminal session, then polls the session until the terminal reports a final state.

## Runtime Configuration

Add these values to the backend runtime environment:

```env
DOJO_PAY_AT_COUNTER_ENABLED=1
DOJO_API_BASE_URL=https://api.dojo.tech
DOJO_API_VERSION=2026-02-27
DOJO_API_KEY=base64-basic-auth-token-from-dojo
DOJO_SOFTWARE_HOUSE_ID=your-software-house-id
DOJO_RESELLER_ID=your-reseller-id
DOJO_DEFAULT_TERMINAL_ID=terminal-id-from-dojo
DOJO_TERMINAL_A_ID=terminal-a-id-from-dojo
DOJO_TERMINAL_B_ID=terminal-b-id-from-dojo
DOJO_CURRENCY_CODE=GBP
DOJO_REQUEST_TIMEOUT_MS=15000
```

`DOJO_TERMINAL_A_ID` and `DOJO_TERMINAL_B_ID` are optional named routes for the POS workstation setup screen. If only `DOJO_DEFAULT_TERMINAL_ID` is set, Terminal A uses that value and Terminal B stays pending until Dojo provides the second terminal ID.

For local development and smoke tests, set:

```env
DOJO_MOCK_MODE=1
DOJO_DEFAULT_TERMINAL_ID=dojo-mock-terminal
```

Mock mode enables the endpoints without real Dojo credentials. A created terminal session captures on the first status refresh.

Optional till-point IP hints can suggest the right till after a browser reset:

```env
COREPOS_TILL_POINT_IP_HINTS=TILL_1=192.168.1.41;TILL_2=192.168.1.42;TILL_3=192.168.1.*
```

Hints support exact IP matches or a trailing `*` prefix match. The suggestion is shown in POS Settings; the browser still stores the final selected till locally.

## API Flow

The POS uses these backend endpoints:

- `GET /api/payments/terminal-config`
- `GET /api/payments/terminals`
- `POST /api/payments/terminal-sessions`
- `GET /api/payments/terminal-sessions/:id`
- `POST /api/payments/terminal-sessions/:id/cancel`
- `POST /api/payments/terminal-sessions/:id/signature`

When a session reaches `CAPTURED`, CorePOS records a `CARD` sale tender, captures the local payment intent, creates the settled payment row, and completes the sale if the sale is fully tendered.

Declined, canceled, expired, or failed terminal sessions mark the local payment intent as failed or canceled so the POS can safely retry.

## Operational Notes

- Dojo must enable Pay at Counter for the merchant account before live terminals can be used.
- Do not put Dojo credentials in committed files.
- Keep manual card approval available as a fallback while piloting the terminal integration.
- Use Settings > POS Settings > This browser's workstation to assign each browser to Till Point 1/2/3 and Terminal A/B.
- Run `npm run test:dojo-card-terminals` after payment-terminal changes.
