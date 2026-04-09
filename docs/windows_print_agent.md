# Windows Local Print Agent

This document describes the current real CorePOS local print-agent paths for:

- web-order Zebra shipment labels
- office-printer bike tags
- Dymo product labels printed from the product-label page
- thermal receipts printed from POS, workshop reprints, and the managed receipt page

## What is implemented now

CorePOS now supports real backend-to-agent print handoff for four narrow workflows:

- CorePOS still owns shipment lifecycle, bike-tag intent preparation, product-label intent preparation, receipt preparation, and print orchestration.
- Shipment, bike-tag, product-label, and receipt print payloads remain separate stable backend contracts.
- CorePOS resolves all four through registered printer records and workflow-specific defaults.
- A repo-local Windows-oriented print agent can accept that payload over HTTP for development and combined local setups.
- A standalone Windows Zebra helper EXE package can now accept shipment-label payloads for a USB-connected GK420d without needing a CorePOS repo checkout or npm on the printer host.
- A standalone Windows bike-tag helper EXE package can now accept rendered bike-tag sheet payloads for an installed office printer without needing a CorePOS repo checkout or npm on the printer host.
- A standalone Windows Dymo helper EXE package can accept the product-label payload without needing a CorePOS repo checkout or npm on the printer host.
- Managed receipts currently use the repo-local / standard Windows print-agent path and the same registered-printer routing model, but they do not yet have a standalone packaged receipt-only helper bundle.
- The print host can either:
  - simulate printing safely in `DRY_RUN`
  - send Zebra ZPL to the registered shipment printer over raw TCP
  - send Zebra ZPL to an installed Windows printer by name on a Windows helper host
  - receive a CorePOS-rendered A5 landscape 2-up bike-tag PNG sheet and hand it to the installed Windows office printer by name
  - receive a CorePOS-rendered Dymo 57x32 PNG and hand it to the installed Windows printer by name
  - receive a CorePOS-rendered ESC/POS receipt payload and send it either directly over raw TCP or to an installed Windows receipt printer by name
- Successful agent prints mark the shipment as printed in CorePOS.
- Failed agent prints do not set `printedAt`.
- Bike-tag direct prints stay separate from shipment state and keep the preview/browser-print fallback available.
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
   - CorePOS prepares a `BIKE_TAG_PRINT` payload for the rendered A5 landscape 2-up bike-tag sheet
   - CorePOS also prepares a separate `PRODUCT_LABEL_PRINT` payload for Dymo-style product labels, including the rendered PNG document that the host should print
   - CorePOS also prepares a separate `RECEIPT_PRINT` payload carrying the final ESC/POS bytes that should reach the receipt printer
   - shipment payloads remain fetchable and previewable from CorePOS

4. Printer registration and default selection
   - `src/services/printerService.ts`
   - manages the registered printer list, shipping-label or product-label capability, active status, and workflow-specific defaults

5. CorePOS print-agent delivery
   - `src/services/shipping/printAgentDeliveryService.ts`
   - `src/services/bikeTagPrintAgentDeliveryService.ts`
   - `src/services/productLabelPrintAgentDeliveryService.ts`
   - `src/services/receiptPrintAgentDeliveryService.ts`
   - delivers prepared print jobs to the configured agent URL with timeout handling and normalized errors

6. Local Windows print hosts
   - repo-local Node agent in `print-agent/src/`
   - standalone Zebra shipment helper EXE package built from source assets in `print-agent/windows-zebra-agent/`
   - standalone bike-tag helper EXE package built from source assets in `print-agent/windows-bike-tag-agent/`
   - standalone Dymo helper EXE package built from source assets in `print-agent/windows-dymo-agent/`
   - both validate the payload, check the optional shared secret, and send workflow-specific output through the transport declared by the resolved printer record

## Current agent API

The repo-local Node print agent exposes:

- `GET /health`
- `POST /jobs/shipment-label`
- `POST /jobs/bike-tag`
- `POST /jobs/product-label`
- `POST /jobs/receipt`

The print-job endpoint accepts:

- `{ "printRequest": <SHIPMENT_LABEL_PRINT payload> }`
- `{ "printRequest": <BIKE_TAG_PRINT payload> }`
- `{ "printRequest": <PRODUCT_LABEL_PRINT payload> }`
- `{ "printRequest": <RECEIPT_PRINT payload> }`

If `COREPOS_PRINT_AGENT_SHARED_SECRET` is set, CorePOS must send the same value in:

- `X-CorePOS-Print-Agent-Secret`

The standalone Zebra helper EXE package implements the narrow shipment-label subset:

- `GET /health`
- `POST /jobs/shipment-label`

The standalone bike-tag helper EXE package implements the narrow bike-tag subset:

- `GET /health`
- `POST /jobs/bike-tag`

The standalone Dymo helper EXE package implements the narrow product-label subset:

- `GET /health`
- `POST /jobs/product-label`

Receipts currently stay on the repo-local / standard Windows print-agent path:

- `GET /health`
- `POST /jobs/receipt`

That is intentional. It keeps each Windows host focused on one workflow instead of turning the helpers into a broad printer platform.

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

This is the narrow Windows-helper transport for installed local Windows printers.

Behavior:

- for shipment labels:
  - CorePOS sends a `SHIPMENT_LABEL_PRINT` request to the local agent
  - CorePOS includes the prepared ZPL document in that request
  - on Windows, the agent invokes `powershell.exe` and sends that ZPL payload to the installed Windows printer named on the registered Zebra printer record
  - this is the practical bridge for a USB-connected Zebra GK420d that is not reachable over raw TCP
- for bike tags:
  - CorePOS sends a `BIKE_TAG_PRINT` request to the local agent
  - CorePOS includes the already-rendered A5 landscape 2-up PNG document in that request
  - on Windows, the helper invokes `powershell.exe` and prints that sheet to the installed office printer named on the registered office-document printer record
  - this keeps paper size, orientation, and actual-size rendering on one controlled print host instead of relying on browser print dialogs on every device
- CorePOS sends a `PRODUCT_LABEL_PRINT` request to the local agent
- CorePOS includes the already-rendered 57x32 PNG document in that request
- on Windows, the agent invokes `powershell.exe` and prints that PNG to the installed printer named on the registered Dymo printer record
- this avoids the browser print popup and its paper-size handling limits
- the current product-label renderer is intentionally retail-first: subtle brand line only when useful, stronger product-and-price hierarchy, and a cleaner barcode footer sized for the Dymo 57x32 stock
- for receipts:
  - CorePOS sends a `RECEIPT_PRINT` request to the local agent
  - CorePOS includes the already-rendered ESC/POS byte payload in that request
  - `RAW_TCP` is the preferred LAN-first path for network receipt printers
  - `WINDOWS_PRINTER` remains available when a controlled Windows host needs to bridge to a locally installed receipt printer

## Current scope and limits

The real transports are still intentionally narrow:

- shipment labels: `RAW_TCP` or `WINDOWS_PRINTER`
- bike tags: `WINDOWS_PRINTER`
- product labels: `WINDOWS_PRINTER`
- receipts: `RAW_TCP`, `WINDOWS_PRINTER`, or `DRY_RUN`

That means:

- USB-only Zebra setups are now supported through the packaged Windows Zebra helper
- office-printer bike tags are now supported through the packaged Windows bike-tag helper
- raw TCP Zebra printing remains supported and unchanged for network-reachable devices
- Dymo product-label direct printing currently assumes a Windows machine with the Dymo printer installed in the local Windows printer list
- product-label direct printing is intentionally raster-based and targeted at the current Dymo 57x32 use case, not a generic label-designer subsystem

This is intentional. It keeps the contract and orchestration correct without turning shipment and product-label printing into a generic printer-control platform.

## CorePOS backend configuration

The preferred setup is now:

1. In CorePOS Settings, save the shipping helper URL and shared secret under `Shipping Print Helper (Zebra)`.
2. In CorePOS Settings, save the bike-tag helper URL and shared secret under `Bike-Tag Print Helper`.
3. In CorePOS Settings, save the receipt helper URL and shared secret under `Receipt Print Helper`.
4. In CorePOS Settings, save the product-label helper URL and shared secret under `Product-Label Print Helper`.
5. Keep backend env vars only as a legacy fallback for older deployments.

Legacy backend env fallback keys remain supported:

- `COREPOS_SHIPPING_PRINT_AGENT_URL`
- `COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET` (optional but recommended)
- `COREPOS_BIKE_TAG_PRINT_AGENT_URL` (legacy fallback only; bike-tag direct printing can now be configured persistently in CorePOS Settings)
- `COREPOS_BIKE_TAG_PRINT_AGENT_TIMEOUT_MS` (optional, default `10000`)
- `COREPOS_BIKE_TAG_PRINT_AGENT_SHARED_SECRET` (legacy fallback only; used when the bike-tag helper is reachable over the local network)
- `COREPOS_RECEIPT_PRINT_AGENT_URL` (legacy fallback only; managed receipt printing can now be configured persistently in CorePOS Settings)
- `COREPOS_RECEIPT_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_RECEIPT_PRINT_AGENT_SHARED_SECRET` (legacy fallback only; used when the receipt helper is reachable over the local network)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL` (legacy fallback only; product-label direct printing can now be configured persistently in CorePOS Settings)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_TIMEOUT_MS` (optional, default `7000`)
- `COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET` (legacy fallback only; falls back to `COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET`)

Example:

```bash
COREPOS_SHIPPING_PRINT_AGENT_URL=http://127.0.0.1:3211
COREPOS_SHIPPING_PRINT_AGENT_TIMEOUT_MS=7000
COREPOS_SHIPPING_PRINT_AGENT_SHARED_SECRET=replace-me
```

Legacy env-only fallback example:

```bash
COREPOS_PRODUCT_LABEL_PRINT_AGENT_URL=http://dymo-host-or-ip:3212
COREPOS_PRODUCT_LABEL_PRINT_AGENT_SHARED_SECRET=replace-me
```

CorePOS uses persisted settings first and falls back to env only when no saved helper URL exists.

## Printer registration in CorePOS

CorePOS now owns the operational printer registry for shipment labels, thermal receipts, bike tags, and product labels.

Each registered printer record includes:

- name
- internal key/code
- printer family and model hint
- shipping-label, bike-tag, product-label, or receipt capability
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

Current bike-tag behavior:

- staff can one-click print from `/inventory/:variantId`
- CorePOS uses the default bike-tag printer unless a later caller explicitly selects another registered office-document target
- the registered office printer record stores the installed Windows printer name when `WINDOWS_PRINTER` transport is used
- the fallback preview route still exists on `/variants/:variantId/bike-tag/print`, but it is now secondary to the controlled helper-driven print path

Current receipt behavior:

- POS checkout uses managed receipt printing as the primary path
- `/sales/:saleId/receipt/print` is now the managed receipt options and fallback page
- CorePOS resolves thermal receipt targets in this order:
  - explicit selected printer
  - workstation default
  - global default receipt printer
- workstation defaults are configured in Settings for `Till PC`, `Workshop 1`, and `Workshop 2 / Dymo PC`
- the current browser still stores which workstation it should behave as
- browser print remains available only as an explicit fallback action on the receipt page

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

## Standalone Zebra shipment helper EXE package

For a practical Windows Zebra deployment without the CorePOS repo or npm on the printer host:

1. On a CorePOS dev/release machine, build the EXE package:

```bash
npm run print-agent:package:zebra
```

2. Copy the generated folder from `tmp/zebra-shipment-agent-bundle/` to the Windows Zebra host.
3. Copy `corepos-zebra-shipment-agent.config.example.json` to `corepos-zebra-shipment-agent.config.json`.
4. Edit the config file:
   - keep `bindHost` as `127.0.0.1` unless you deliberately need LAN access
   - default `port` is `3211`
   - set `sharedSecret` to match the secret you will save in CorePOS Settings
   - choose a writable `dryRunOutputDir`
5. Start the helper with `corepos-zebra-shipment-agent.exe`.
6. In CorePOS, open Settings and save that helper URL plus shared secret under `Shipping Print Helper (Zebra)`.
7. In CorePOS Settings, register the Zebra shipment printer with:
   - printer family `ZEBRA_LABEL`
   - transport mode `WINDOWS_PRINTER`
   - `windowsPrinterName` matching the installed Windows Zebra printer name
8. Set that printer as the default shipping-label printer, or choose it explicitly on the dispatch bench.

This gives the Windows Zebra host a small copyable EXE folder instead of a repo checkout and npm workflow.

## Standalone bike-tag helper EXE package

For a practical Windows office-printer deployment without the CorePOS repo or npm on the printer host:

1. On a CorePOS dev/release machine, build the EXE package:

```bash
npm run print-agent:package:bike-tag
```

2. Copy the generated folder from `tmp/bike-tag-agent-bundle/` to the Windows office-printer host.
3. Copy `corepos-bike-tag-agent.config.example.json` to `corepos-bike-tag-agent.config.json`.
4. Edit the config file:
   - keep `bindHost` as `127.0.0.1` unless you deliberately need LAN access
   - default `port` is `3213` so it can live beside the Zebra shipment agent on `3211` and the Dymo helper on `3212`
   - set `sharedSecret` to match the secret you will save in CorePOS Settings
   - choose a writable `dryRunOutputDir`
5. Start the helper with `corepos-bike-tag-agent.exe`.
6. In CorePOS, open Settings and save that helper URL plus shared secret under the Bike-Tag Print Helper section.
7. In CorePOS Settings, register the office printer with:
   - printer family `OFFICE_DOCUMENT`
   - transport mode `WINDOWS_PRINTER`
   - `windowsPrinterName` matching the installed Windows office printer name, for example `Xerox VersaLink C405`
8. Set that printer as the default bike-tag printer.

This gives the Windows office-printer host a small copyable EXE folder instead of a repo checkout and npm workflow.

## Standalone Dymo helper EXE package

For a practical Windows Dymo deployment without the CorePOS repo or npm on the printer host:

1. On a CorePOS dev/release machine, build the EXE package:

```bash
npm run print-agent:package:dymo
```

2. Copy the generated folder from `tmp/dymo-product-label-agent-bundle/` to the Windows Dymo host.
3. Copy `corepos-dymo-product-label-agent.config.example.json` to `corepos-dymo-product-label-agent.config.json`.
4. Edit the config file:
   - keep `bindHost` as `127.0.0.1` unless you deliberately need LAN access
   - default `port` is `3212` so it can live beside the Zebra shipment agent on `3211`
   - set `sharedSecret` to match the secret you will save in CorePOS Settings
   - choose a writable `dryRunOutputDir`
5. Start the helper with `corepos-dymo-product-label-agent.exe`.
6. In CorePOS, open Settings and save that helper URL plus shared secret under the Product-Label Print Helper section.

This gives the Windows Dymo host a small copyable EXE folder instead of a repo checkout and npm workflow.

## Zebra ops note

Keep the roles split clearly:

- CorePOS backend host:
  - runs the main CorePOS backend
  - owns shipment preparation, shipment state, and dispatch workflow
  - stores the Zebra helper URL and shared secret in CorePOS Settings
  - resolves the default or chosen Zebra printer record before sending the job
- Windows Zebra helper host:
  - runs `corepos-zebra-shipment-agent.exe`
  - must have the Zebra GK420d installed in Windows
  - accepts `/jobs/shipment-label` and prints ZPL to the configured Windows printer name

For day-to-day reliability, give the Windows Zebra host a fixed IP or DHCP reservation and point:

`http://<fixed-windows-ip>:3211`

Quick health check from the CorePOS host:

```bash
curl http://<fixed-windows-ip>:3211/health
```

If shipment printing stops working:

1. Confirm the Windows Zebra helper EXE is running on the Windows host.
2. Open `http://<fixed-windows-ip>:3211/health` and confirm it responds.
3. Check the configured Zebra printer is still installed in Windows and matches the registered CorePOS printer record.
4. In CorePOS Settings, confirm the `Shipping Print Helper (Zebra)` URL and shared secret still match the running helper.
5. If labels are urgent and the printer is network-reachable, switch the registered Zebra printer back to `RAW_TCP` temporarily instead of weakening shipment lifecycle rules.

## Bike-tag ops note

Keep the roles split clearly:

- CorePOS backend host:
  - runs the main CorePOS backend
  - owns bike-tag rendering, printer selection, and job submission
  - stores the bike-tag helper URL and shared secret in CorePOS Settings
  - resolves the default or chosen office-document printer before sending the job
- Windows office-printer helper host:
  - runs `corepos-bike-tag-agent.exe`
  - must have the Xerox or other office printer installed in Windows
  - accepts `/jobs/bike-tag` and prints the A5 landscape 2-up sheet at controlled settings

For day-to-day reliability, give the Windows office-printer host a fixed IP or DHCP reservation and point:

`http://<fixed-windows-ip>:3213`

Quick health check from the CorePOS host:

```bash
curl http://<fixed-windows-ip>:3213/health
```

If bike-tag printing stops working:

1. Confirm the Windows bike-tag helper EXE is running on the office-printer host.
2. Open `http://<fixed-windows-ip>:3213/health` and confirm it responds.
3. Check the configured office printer is still installed in Windows and matches the registered CorePOS printer record.
4. In CorePOS Settings, confirm the `Bike-Tag Print Helper` URL and shared secret still match the running helper.
5. If tags are urgent, staff can still use the preview fallback on `/variants/:variantId/bike-tag/print` while the controlled helper path is repaired.

## Dymo ops note

Keep the roles split clearly:

- Mac/CorePOS backend host:
  - runs the main CorePOS backend
  - owns inventory search, product-label print requests, and printer selection
  - stores the Dymo helper URL and shared secret in CorePOS Settings
  - sends product-label jobs to the Windows Dymo helper over that persisted URL
- Windows Dymo helper host:
  - runs `corepos-dymo-product-label-agent.exe`
  - must have the Dymo printer installed in Windows
  - accepts `/jobs/product-label` and prints to the configured Windows printer name

For day-to-day reliability, give the Windows Dymo host a fixed IP or DHCP reservation and point:

`http://<fixed-windows-ip>:3212`

Quick health check from the CorePOS host:

```bash
curl http://<fixed-windows-ip>:3212/health
```

If direct product-label printing stops working:

1. Confirm the Windows Dymo helper EXE is running on the Windows host.
2. Open `http://<fixed-windows-ip>:3212/health` and confirm it responds.
3. Check the configured Dymo printer is still installed in Windows and matches the registered CorePOS printer record.
4. Confirm the Product-Label Print Helper settings in CorePOS still match the Windows host IP and shared secret.
5. If the helper URL was never saved in Settings, confirm any legacy fallback env vars on the CorePOS backend are still correct.
6. If labels are urgent, use the existing browser-print fallback from the product-label page while the helper route is being fixed.

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
- richer Dymo label-template variations or multi-printer product-label selection in the UI
- richer dispatch batching and packing workflows

The current milestone is the honest first operational bridge between CorePOS print orchestration and workflow-specific local printing for Zebra shipment labels and Dymo product labels.
