# Web-Order Shipping Labels

This document describes the current CorePOS foundation for shipping-label-driven web-order dispatch.

## Scope implemented now

CorePOS now includes a dedicated web-order shipment slice that can:

- persist web orders independently of workshop or POS sales
- create one active shipment label per shipping order
- generate a stored label artifact through a provider abstraction
- persist provider-backed shipment references, tracking references, label references, and provider status
- manage the default shipping provider through CorePOS settings
- register dispatch printers and choose a default shipping-label target
- return a backend-owned print-preparation payload
- hand that payload off to a repo-local Windows-oriented print agent
- record printed and dispatched timestamps with audit events
- mark web orders as packed before shipment processing
- bulk-create shipment labels across packed web orders
- bulk-print shipment labels across packed web orders with per-order outcomes
- resolve scanned tracking, provider, or order references into the correct dispatch record before confirming dispatch
- refresh provider-backed shipment state from CorePOS
- accept automated provider-sync updates through a webhook-ready inbound path
- request shipment void/cancel where the provider supports it
- block print/dispatch cleanly while a void outcome is pending
- generate a replacement shipment only after the prior shipment is fully voided
- expose a minimal manager-facing UI at `/online-store/orders`

The current implementation now includes a real courier-integration foundation:

- `INTERNAL_MOCK_ZPL` remains available as the built-in development path
- `GENERIC_HTTP_ZPL` provides a production-shaped provider adapter scaffold with manager-configured endpoint, environment, and credentials
- `EASYPOST` provides the first genuine carrier-backed shipment purchase flow with stored provider references, tracking, and downloaded ZPL
- shipment labels continue through the existing CorePOS-owned print preparation, dispatch-printer resolution, and Windows print-agent path

## Current architecture

The flow is now split into seven layers:

1. CorePOS shipment orchestration
   - `src/services/orderService.ts`
   - owns web-order lifecycle, shipment creation, shipment refresh/void/regenerate rules, audit events, duplicate-active-shipment protection, and dispatch status transitions

2. Shipping provider abstraction
   - `src/services/shipping/contracts.ts`
   - `src/services/shipping/providerRegistry.ts`
   - `src/services/shipping/providerConfigService.ts`
   - provider implementations generate a normalized label artifact for CorePOS to store
   - provider configuration, enablement, and default-provider resolution stay in CorePOS settings rather than loose env-only flags

3. Provider sync and reconciliation
   - `src/services/shipping/providerSyncService.ts`
   - accepts fetched lifecycle results plus inbound provider events
   - applies idempotent lifecycle reconciliation into the existing shipment state fields
   - stores inbound provider event receipts for audit/troubleshooting

4. Print-preparation contract
   - shipment label payloads can be fetched directly from CorePOS
   - print preparation resolves a registered printer and returns a stable `SHIPMENT_LABEL_PRINT` payload with printer intent metadata
   - current transport target is declared as `WINDOWS_LOCAL_AGENT`

5. Printer registration and default resolution
   - `src/services/printerService.ts`
   - registered printers are stored in CorePOS with capability, active status, transport mode, and target details
   - shipment printing can resolve either a chosen printer or the default shipping-label printer

6. CorePOS print-agent delivery
   - `src/services/shipping/printAgentDeliveryService.ts`
   - sends prepared shipment print requests to the configured local agent endpoint
   - normalizes timeout, unreachable-agent, and bad-response cases

7. Local Windows print agent / helper
   - `print-agent/src/`
   - validates shipment print payloads and performs the actual transport
   - now supports `DRY_RUN`, real `RAW_TCP` ZPL delivery, and Windows-helper `WINDOWS_PRINTER` delivery for USB-connected Zebra hosts

## Provider status

CorePOS currently ships with three provider paths:

### `INTERNAL_MOCK_ZPL`

This path is explicitly mock/dev only:

- it does not call a real courier
- it generates deterministic tracking numbers for testing
- it returns ZPL content shaped for Zebra-style thermal printing
- it stores the label content inline in CorePOS so reprints do not depend on external URLs

### `GENERIC_HTTP_ZPL`

This path is a production-shaped courier adapter scaffold:

- it is configured in CorePOS Settings rather than hardcoded in the UI
- it supports enabled/disabled state plus `SANDBOX` or `LIVE` environment selection
- it accepts manager/admin-provided endpoint and credential settings, with secrets masked on readback
- it maps a CorePOS shipment request into a normalized HTTP JSON request and expects a normalized ZPL response
- it persists provider-backed shipment metadata so later live adapters have a clean storage model

`GENERIC_HTTP_ZPL` is intentionally honest about its current status: it is a generic adapter scaffold, not a branded live carrier integration.

### `EASYPOST`

This path is the first real carrier adapter:

- it is configured through CorePOS Settings with sandbox/live mode, API key, carrier account, default service, and parcel defaults
- it creates and buys a real provider-backed shipment through EasyPost
- it stores provider shipment/tracking/label references on the shipment record
- it downloads ZPL-compatible label output into CorePOS so reprints stay local and stable

The current scope is intentionally narrow:

- one configured carrier account
- one configured default service
- one parcel-default profile suitable for the current dispatch workflow

## Why ZPL first

The target dispatch setup is a Windows machine connected to a Zebra GK420d direct-thermal printer.

ZPL is the preferred intermediate artifact because it:

- matches the intended printer family well
- avoids brittle browser print scaling for label stock
- can be handed off to a lightweight local print agent without going through the browser print dialog

## Current API shape

The first API slice lives under `/api/online-store` and supports:

- listing and creating web orders
- listing configured shipping providers and setting the default provider through settings APIs
- listing, creating, editing, and defaulting registered shipping-label printers via settings APIs
- generating a shipment label for an order
- fetching shipment metadata and stored label content
- refreshing shipment/provider state
- requesting provider void/cancel where supported
- generating a replacement shipment after a voided label
- preparing a print-intent payload
- printing through the configured Windows/local agent path
- recording print and dispatch milestones

## Shipment lifecycle hardening

CorePOS now separates the main operational states for a web-order shipment:

- `LABEL_READY`: provider-backed label exists and is available locally in CorePOS
- `PRINT_PREPARED`: a Zebra-oriented print payload has been prepared
- `PRINTED`: CorePOS has a successful print record
- `DISPATCHED`: staff have separately confirmed dispatch
- `VOID_PENDING`: CorePOS has submitted a provider void/refund request and is waiting for a final provider outcome
- `VOIDED`: the provider has confirmed the shipment is no longer active

Additional persisted lifecycle fields now track:

- provider shipment status
- provider refund/void status
- provider sync timestamp
- last provider sync error
- void-requested timestamp
- voided timestamp

Automated provider sync now adds:

- idempotent inbound event receipts
- verified-signature tracking for provider webhooks
- duplicate/unmatched event handling without corrupting shipment state

Operational rules:

- printing never implies dispatch
- dispatch never recreates a shipment
- void-pending and voided shipments cannot be prepared or printed
- missing stored label content now blocks raw-label access and print preparation with an explicit recovery error instead of letting an empty print payload through
- reprints stay available for active or already-dispatched shipments
- replacement shipment generation is only allowed once the previous shipment is fully voided
- provider refresh can restore a `VOID_PENDING` shipment back to its last active local print state if the carrier rejects the void/refund
- EasyPost refresh can also re-fetch the stored ZPL document if the local label content has gone missing and the provider still exposes the purchased label
- provider webhooks do not imply print or dispatch; they only reconcile provider-side shipment state

## Current UI slice

`/online-store/orders` is now a real manager-facing page rather than a placeholder.

It currently supports:

- selecting a web order
- seeing a recommended next dispatch action plus compact shipment/print/dispatch readiness states
- generating a shipment label for shipping orders
- choosing between the built-in mock provider and configured provider-backed shipment creation paths
- viewing shipment/tracking state
- seeing a compact shipment activity timeline built from persisted lifecycle timestamps
- surfacing provider-sync exceptions more clearly in queue hints, next-step guidance, and shipment readiness
- seeing which registered printer will be used
- previewing stored ZPL
- refreshing provider status
- receiving automated provider sync updates once the current provider webhook secret is configured
- voiding/cancelling shipments where supported
- generating a replacement shipment after void
- preparing a Windows-local-agent print payload
- sending the print job through the real agent path
- selecting multiple packed orders for bulk shipment creation, bulk print, or bulk dispatch confirmation in sequence
- seeing per-order bulk outcomes with safe skip/failure isolation plus concise retry/recovery cues
- dispatching separately after print succeeds, including a ready-to-dispatch batch queue for printed labels
- scanning a tracking number, provider reference, or order reference to load the matched shipment and confirm dispatch explicitly from a scan-first bench flow
- keeping the scan bench warm with clearer blocked/no-match feedback, keyboard-friendly repeat confirmation, and a small recent-scan session summary for quick operator recovery
- keeping the packing station explicit with clearer packed-vs-needs-packing cues, ready-to-create queue shortcuts, and a small recent-packing handoff summary before shipment creation
- showing a closeout / handoff summary for the visible dispatch queue, including today’s dispatched count, outstanding-work buckets, and a copy-friendly summary block for shift handover

This is intentionally a narrow dispatch workflow, not a broader storefront or fulfilment dashboard redesign.

## Future integration path

The intended next steps are:

1. real branded courier/provider adapters
   - e.g. carrier API credentials, service mapping, rate/service validation, production tracking references, broader provider-status sync

2. richer print-agent/device support
   - local printer/device mappings beyond the current CorePOS-managed target model
   - durable local queueing or retry behavior
   - direct Windows spooler / USB Zebra support in addition to raw TCP

3. richer fulfilment operations
   - deeper pack/bench/station workflows beyond the first packed queue
   - more advanced batching, wave handling, or scan-assisted exception handling beyond the first scan-first bench flow
   - eventual customer-facing online-order history and notifications

## Constraints kept intentionally

The current implementation does not attempt to be:

- a generic workshop label system
- a multi-carrier abstraction with live production integrations
- a general media or document library
- a browser-print-based final architecture

It is a backend-first shipping foundation for web-order dispatch that now includes a first live carrier path while still staying honest about the remaining production rollout work.

For the courier adapter/configuration foundation and current provider-backed workflow, see [courier_integration.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/courier_integration.md).
For the current Windows/Zebra print-agent setup, configuration, and limitations, see [windows_print_agent.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/windows_print_agent.md).
