# Web-Order Shipping Labels

This document describes the first CorePOS foundation for shipping-label-driven web-order dispatch.

## Scope implemented now

CorePOS now includes a dedicated web-order shipment slice that can:

- persist web orders independently of workshop or POS sales
- create one active shipment label per shipping order
- generate a stored label artifact through a provider abstraction
- return a backend-owned print-preparation payload for later local-agent delivery
- record printed and dispatched timestamps with audit events
- expose a minimal manager-facing UI at `/online-store/orders`

The current implementation is intentionally a development foundation, not a production courier integration.

## Current architecture

The flow is split into three layers:

1. CorePOS shipment orchestration
   - `src/services/orderService.ts`
   - owns web-order lifecycle, shipment creation, audit events, duplicate-active-shipment protection, and dispatch status transitions

2. Shipping provider abstraction
   - `src/services/shipping/contracts.ts`
   - `src/services/shipping/providerRegistry.ts`
   - provider implementations generate a normalized label artifact for CorePOS to store

3. Print-preparation contract
   - shipment label payloads can be fetched directly from CorePOS
   - print preparation returns a stable `SHIPMENT_LABEL_PRINT` payload with printer intent metadata
   - current transport target is declared as `WINDOWS_LOCAL_AGENT`

## Mock provider status

The first provider is `INTERNAL_MOCK_ZPL`.

It is explicitly mock/dev only:

- it does not call a real courier
- it generates deterministic tracking numbers for testing
- it returns ZPL content shaped for Zebra-style thermal printing
- it stores the label content inline in CorePOS so reprints do not depend on external URLs

## Why ZPL first

The target dispatch setup is a Windows machine connected to a Zebra GK420d direct-thermal printer.

ZPL is the preferred intermediate artifact because it:

- matches the intended printer family well
- avoids brittle browser print scaling for label stock
- can be handed off to a lightweight local print agent later

## Current API shape

The first API slice lives under `/api/online-store` and supports:

- listing and creating web orders
- generating a shipment label for an order
- fetching shipment metadata and stored label content
- preparing a print-intent payload
- recording print and dispatch milestones

## Current UI slice

`/online-store/orders` is now a real manager-facing page rather than a placeholder.

It currently supports:

- selecting a web order
- generating a shipment label for shipping orders
- viewing shipment/tracking state
- previewing stored ZPL
- preparing a Windows-local-agent print payload
- recording printed and dispatched timestamps

This is intentionally a narrow dispatch workflow, not a broader storefront or fulfilment dashboard redesign.

## Future integration path

The intended next steps are:

1. real courier/provider adapters
   - e.g. carrier API credentials, service mapping, rate/service validation, production tracking references

2. local Windows print agent
   - a small trusted companion process on the dispatch PC
   - consumes the prepared print payload from CorePOS
   - sends ZPL directly to the configured Zebra printer without using the browser print dialog

3. richer fulfilment operations
   - packing workflow
   - dispatch batching
   - shipment cancellation/void flows
   - label regeneration policies where providers allow it
   - eventual customer-facing online-order history and notifications

## Constraints kept intentionally

The current implementation does not attempt to be:

- a generic workshop label system
- a multi-carrier abstraction with live production integrations
- a general media or document library
- a browser-print-based final architecture

It is a backend-first shipping foundation for web-order dispatch that stays honest about the current mock/dev stage while pointing cleanly toward real courier and Windows print-agent integrations.
