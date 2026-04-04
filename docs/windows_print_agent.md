# Windows Zebra Print Agent

This document describes the first real CorePOS print-agent path for web-order shipping labels.

## What is implemented now

CorePOS now supports a real backend-to-agent print handoff for shipment labels:

- CorePOS still owns shipment lifecycle and print orchestration.
- The prepared shipment print payload remains a stable backend contract.
- A repo-local Windows-oriented print agent can accept that payload over HTTP.
- The print agent can either:
  - simulate printing safely in `DRY_RUN`, or
  - send raw ZPL to a configured Zebra-style target over raw TCP.
- Successful agent prints mark the shipment as printed in CorePOS.
- Failed agent prints do not set `printedAt`.

This is intentionally the first operational slice, not the final multi-device print platform.

## Architecture

The shipping-label print path is now split into five layers:

1. Shipment orchestration
   - `src/services/orderService.ts`
   - owns shipment state, `printPreparedAt`, `printedAt`, reprints, dispatch rules, and audit events

2. Shipping provider abstraction
   - `src/services/shipping/contracts.ts`
   - `src/services/shipping/providerRegistry.ts`
   - current label generation is still `INTERNAL_MOCK_ZPL`

3. Print preparation contract
   - CorePOS prepares a `SHIPMENT_LABEL_PRINT` payload with Zebra-oriented metadata
   - payloads remain fetchable and previewable from CorePOS

4. CorePOS print-agent delivery
   - `src/services/shipping/printAgentDeliveryService.ts`
   - delivers prepared print jobs to the configured agent URL with timeout handling and normalized errors

5. Local Windows print agent
   - `print-agent/src/`
   - validates the payload, checks the optional shared secret, and sends ZPL through the selected transport mode

## Current agent API

The local print agent exposes:

- `GET /health`
- `POST /jobs/shipment-label`

The print-job endpoint accepts:

- `{ "printRequest": <SHIPMENT_LABEL_PRINT payload> }`

If `COREPOS_PRINT_AGENT_SHARED_SECRET` is set, CorePOS must send the same value in:

- `X-CorePOS-Print-Agent-Secret`

## Supported transport modes now

### `DRY_RUN`

Use this for development, verification, and safe rollout checks.

Behavior:

- accepts the real shipment print payload
- writes the ZPL output to `COREPOS_PRINT_AGENT_OUTPUT_DIR`
- returns a successful simulated print result
- still lets CorePOS update `printedAt` safely because the agent completed the job intentionally

### `RAW_TCP`

This is the first real Zebra-oriented transport.

Behavior:

- connects to `COREPOS_PRINT_AGENT_RAW_TCP_HOST:COREPOS_PRINT_AGENT_RAW_TCP_PORT`
- sends raw ZPL bytes directly
- is appropriate for a Zebra printer or print server that accepts raw TCP/9100-style traffic

## Important limitation of the first version

The first real transport is `RAW_TCP` only.

That means:

- USB-only or Windows spooler-only Zebra setups are not directly supported yet
- if your dispatch Zebra is connected only by USB, this first milestone is not the final answer
- for now, the clean supported real path is a raw TCP reachable Zebra target or Zebra-compatible print server path

This is intentional. It keeps the contract and orchestration correct without pretending that browser printing or a fragile pseudo-driver path is production-ready.

## CorePOS backend configuration

Set these in the CorePOS backend environment when you want CorePOS to hand off shipment label prints to the agent:

- `COREPOS_SHIPPING_PRINT_AGENT_URL`
- `COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET` (optional but recommended)

Example:

```bash
COREPOS_SHIPPING_PRINT_AGENT_URL=http://127.0.0.1:3211
COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS=7000
COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET=replace-me
```

## Print agent configuration

Set these where the local print agent runs:

- `COREPOS_PRINT_AGENT_BIND_HOST` (default `127.0.0.1`)
- `COREPOS_PRINT_AGENT_PORT` (default `3211`)
- `COREPOS_PRINT_AGENT_TRANSPORT` (`DRY_RUN` or `RAW_TCP`)
- `COREPOS_PRINT_AGENT_DEFAULT_PRINTER_NAME` (optional label only)
- `COREPOS_PRINT_AGENT_SHARED_SECRET` (optional but recommended)
- `COREPOS_PRINT_AGENT_OUTPUT_DIR` for `DRY_RUN`
- `COREPOS_PRINT_AGENT_RAW_TCP_HOST` for `RAW_TCP`
- `COREPOS_PRINT_AGENT_RAW_TCP_PORT` for `RAW_TCP` (default `9100`)
- `COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS` for `RAW_TCP` (default `5000`)

Example dry-run setup:

```bash
COREPOS_PRINT_AGENT_BIND_HOST=127.0.0.1
COREPOS_PRINT_AGENT_PORT=3211
COREPOS_PRINT_AGENT_TRANSPORT=DRY_RUN
COREPOS_PRINT_AGENT_OUTPUT_DIR=tmp/print-agent-output
COREPOS_PRINT_AGENT_SHARED_SECRET=replace-me
npm run print-agent:start
```

Example raw TCP setup:

```bash
COREPOS_PRINT_AGENT_BIND_HOST=127.0.0.1
COREPOS_PRINT_AGENT_PORT=3211
COREPOS_PRINT_AGENT_TRANSPORT=RAW_TCP
COREPOS_PRINT_AGENT_RAW_TCP_HOST=192.168.1.50
COREPOS_PRINT_AGENT_RAW_TCP_PORT=9100
COREPOS_PRINT_AGENT_SHARED_SECRET=replace-me
npm run print-agent:start
```

## How the current flow works

1. Manager generates a shipment label for a shipping web order.
2. CorePOS stores the ZPL label content and shipment metadata.
3. Manager can still call `prepare-print` to inspect the exact backend-owned print payload.
4. Manager clicks the real print action.
5. CorePOS:
   - prepares the print payload
   - sends it to the configured agent
   - only records the shipment as printed if the agent succeeds
6. Manager can then dispatch the shipment separately.

Reprints stay supported by sending the same stored label content through the same flow again.

## Deployment note

The agent binds to `127.0.0.1` by default for safety.

If CorePOS backend and the print agent are on different machines, the backend must be able to reach the agent over a trusted network path. For that setup:

- bind the agent to an appropriate LAN interface deliberately
- protect it with `COREPOS_PRINT_AGENT_SHARED_SECRET`
- restrict network access with normal Windows firewall or LAN controls

## What remains

Still future work:

- real courier/provider integrations
- printer/device mappings beyond a single configured target
- durable local queueing or job retry policy inside the agent
- direct Windows spooler / USB Zebra transport
- richer dispatch batching and packing workflows

The current milestone is the honest first operational bridge between CorePOS shipment orchestration and Zebra-oriented local printing.
