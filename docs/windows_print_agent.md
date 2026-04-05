# Windows Local Print Agent

This document describes the current real CorePOS local print-agent paths for:

- web-order Zebra shipment labels
- Dymo product labels printed from the product-label page

## What is implemented now

CorePOS now supports real backend-to-agent print handoff for two narrow workflows:

- CorePOS still owns shipment lifecycle, product-label intent preparation, and print orchestration.
- Shipment and product-label print payloads remain separate stable backend contracts.
- CorePOS resolves both through registered printer records and workflow-specific defaults.
- A repo-local Windows-oriented print agent can accept that payload over HTTP.
- The print agent can either:
  - simulate printing safely in `DRY_RUN`
  - send Zebra ZPL to the registered shipment printer over raw TCP
  - render a Dymo-style 57x32 product label and hand it to the installed Windows printer by name
- Successful agent prints mark the shipment as printed in CorePOS.
- Failed agent prints do not set `printedAt`.
- Product-label direct prints stay separate from shipment state and keep the browser-print fallback available.

This is intentionally the first operational slice, not the final multi-device print platform.

## Architecture

The local print-agent path is now split into six layers:

1. Shipment orchestration
   - `src/services/orderService.ts`
   - owns shipment state, `printPreparedAt`, `printedAt`, reprints, dispatch rules, and audit events

2. Shipping provider abstraction
   - `src/services/shipping/contracts.ts`
   - `src/services/shipping/providerRegistry.ts`
   - `src/services/shipping/providerConfigService.ts`
   - label generation can come from the built-in `INTERNAL_MOCK_ZPL` path, the `GENERIC_HTTP_ZPL` scaffold, or the first live `EASYPOST` adapter

3. Print preparation contracts
   - CorePOS prepares a `SHIPMENT_LABEL_PRINT` payload with Zebra-oriented metadata plus the resolved registered printer target
   - CorePOS also prepares a separate `PRODUCT_LABEL_PRINT` payload for Dymo-style product labels
   - shipment payloads remain fetchable and previewable from CorePOS

4. Printer registration and default selection
   - `src/services/printerService.ts`
   - manages the registered printer list, shipping-label or product-label capability, active status, and workflow-specific defaults

5. CorePOS print-agent delivery
   - `src/services/shipping/printAgentDeliveryService.ts`
   - `src/services/productLabelPrintAgentDeliveryService.ts`
   - delivers prepared print jobs to the configured agent URL with timeout handling and normalized errors

6. Local Windows print agent
   - `print-agent/src/`
   - validates the payload, checks the optional shared secret, and sends either Zebra ZPL or Dymo PNG output through the transport declared by the resolved printer record

## Current agent API

The local print agent exposes:

- `GET /health`
- `POST /jobs/shipment-label`
- `POST /jobs/product-label`

The print-job endpoint accepts:

- `{ "printRequest": <SHIPMENT_LABEL_PRINT payload> }`
- `{ "printRequest": <PRODUCT_LABEL_PRINT payload> }`

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

- connects to the `rawTcpHost:rawTcpPort` declared by the registered printer record
- sends raw ZPL bytes directly
- is appropriate for a Zebra printer or print server that accepts raw TCP/9100-style traffic

### `WINDOWS_PRINTER`

This is the narrow Dymo-oriented direct-print path for product labels.

Behavior:

- CorePOS sends a `PRODUCT_LABEL_PRINT` request to the local agent
- the agent renders the 57x32 product label as a PNG using the same content intent as the browser label page
- on Windows, the agent invokes `powershell.exe` and prints that PNG to the installed printer named on the registered Dymo printer record
- this avoids the browser print popup and its paper-size handling limits

## Important limitation of the first version

The two real transports are intentionally narrow:

- shipment labels: `RAW_TCP`
- product labels: `WINDOWS_PRINTER`

That means:

- USB-only or Windows spooler-only Zebra setups are not directly supported yet
- if your dispatch Zebra is connected only by USB, this first milestone is not the final answer
- for now, the clean supported real path is a raw TCP reachable Zebra target or Zebra-compatible print server path
- Dymo product-label direct printing currently assumes a Windows machine with the Dymo printer installed in the local Windows printer list
- product-label direct printing is intentionally raster-based and targeted at the current Dymo 57x32 use case, not a generic label-designer subsystem

This is intentional. It keeps the contract and orchestration correct without pretending that browser printing or a fragile pseudo-driver path is production-ready.

## CorePOS backend configuration

Set these in the CorePOS backend environment when you want CorePOS to hand off shipment label prints to the agent:

- `COREPOS_SHIPPING_PRINT_AGENT_URL`
- `COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET` (optional but recommended)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL` (optional, falls back to `COREPOS_SHIPPING_PRINT_AGENT_URL`)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET` (optional, falls back to `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET`)

Example:

```bash
COREPOS_SHIPPING_PRINT_AGENT_URL=http://127.0.0.1:3211
COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS=7000
COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET=replace-me
```

## Printer registration in CorePOS

CorePOS now owns the operational printer registry for shipment labels.

Each registered printer record includes:

- name
- internal key/code
- printer family and model hint
- shipping-label or product-label capability
- active/inactive status
- transport mode (`DRY_RUN`, `RAW_TCP`, or `WINDOWS_PRINTER`)
- current target details for the supported transport
- location and notes

Current dispatch behavior:

- staff can choose a registered printer explicitly on `/online-store/orders`
- if they do not choose one, CorePOS uses the default shipping-label printer
- inactive or non-shipping-capable printers are rejected before the agent is called

Current product-label behavior:

- staff can direct-print from `/inventory/:variantId/label-print`
- CorePOS uses the default product-label printer unless a later caller explicitly selects another registered Dymo target
- the registered Dymo printer record stores the installed Windows printer name when `WINDOWS_PRINTER` transport is used
- if no default product-label printer is configured, CorePOS fails clearly and staff can still use the browser-print fallback

## Print agent configuration

Set these where the local print agent runs:

- `COREPOS_PRINT_AGENT_BIND_HOST` (default `127.0.0.1`)
- `COREPOS_PRINT_AGENT_PORT` (default `3211`)
- `COREPOS_PRINT_AGENT_SHARED_SECRET` (optional but recommended)
- `COREPOS_PRINT_AGENT_OUTPUT_DIR` for `DRY_RUN`
- `COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS` for `RAW_TCP` jobs (default `5000`)

Example dry-run setup:

```bash
COREPOS_PRINT_AGENT_BIND_HOST=127.0.0.1
COREPOS_PRINT_AGENT_PORT=3211
COREPOS_PRINT_AGENT_OUTPUT_DIR=tmp/print-agent-output
COREPOS_PRINT_AGENT_SHARED_SECRET=replace-me
npm run print-agent:start
```

Example raw TCP-capable agent setup:

```bash
COREPOS_PRINT_AGENT_BIND_HOST=127.0.0.1
COREPOS_PRINT_AGENT_PORT=3211
COREPOS_PRINT_AGENT_RAW_TCP_TIMEOUT_MS=5000
COREPOS_PRINT_AGENT_SHARED_SECRET=replace-me
npm run print-agent:start
```

The actual target printer host and port now come from the registered CorePOS printer record, not from global print-agent env vars.

## Relationship to courier integration

The print agent remains deliberately downstream of courier generation.

Current behavior:

- CorePOS creates or retrieves the shipment label through the selected shipping provider
- provider-backed shipment metadata is stored on the shipment record
- the printable label artifact is still stored inline in CorePOS as ZPL for reprint safety
- printer resolution still happens through the registered-printer/default-printer layer
- the Windows/local agent still only receives the backend-owned `SHIPMENT_LABEL_PRINT` payload

That means courier integration can evolve independently without forcing the print-agent contract to change every time a new carrier is added.

## How the current flow works

1. Manager generates a shipment label for a shipping web order.
2. CorePOS stores the ZPL label content plus shipment/provider metadata.
3. CorePOS resolves the selected or default registered printer.
4. Manager can still call `prepare-print` to inspect the exact backend-owned print payload.
5. Manager clicks the real print action.
6. CorePOS:
   - prepares the print payload
   - sends it to the configured agent
   - only records the shipment as printed if the agent succeeds
7. Manager can then dispatch the shipment separately.

Reprints stay supported by sending the same stored label content through the same flow again.

## Deployment note

The agent binds to `127.0.0.1` by default for safety.

If CorePOS backend and the print agent are on different machines, the backend must be able to reach the agent over a trusted network path. For that setup:

- bind the agent to an appropriate LAN interface deliberately
- protect it with `COREPOS_PRINT_AGENT_SHARED_SECRET`
- restrict network access with normal Windows firewall or LAN controls

## What remains

Still future work:

- additional branded courier/provider integrations beyond the current EasyPost path
- richer local printer/device mappings for multi-station environments
- durable local queueing or job retry policy inside the agent
- direct Windows spooler / USB Zebra transport
- richer Dymo label-template variations or multi-printer product-label selection in the UI
- richer dispatch batching and packing workflows

The current milestone is the honest first operational bridge between CorePOS print orchestration and workflow-specific local printing for Zebra shipment labels and Dymo product labels.
