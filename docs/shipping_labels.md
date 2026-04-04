# Web-Order Shipping Labels

This document describes the current CorePOS foundation for shipping-label-driven web-order dispatch.

## Scope implemented now

CorePOS now includes a dedicated web-order shipment slice that can:

- persist web orders independently of workshop or POS sales
- create one active shipment label per shipping order
- generate a stored label artifact through a provider abstraction
- register dispatch printers and choose a default shipping-label target
- return a backend-owned print-preparation payload
- hand that payload off to a repo-local Windows-oriented print agent
- record printed and dispatched timestamps with audit events
- expose a minimal manager-facing UI at `/online-store/orders`

The current implementation is intentionally still mock/dev on the courier side, but it now includes a real print-agent handoff path for Zebra-oriented shipment labels.

## Current architecture

The flow is now split into six layers:

1. CorePOS shipment orchestration
   - `src/services/orderService.ts`
   - owns web-order lifecycle, shipment creation, audit events, duplicate-active-shipment protection, and dispatch status transitions

2. Shipping provider abstraction
   - `src/services/shipping/contracts.ts`
   - `src/services/shipping/providerRegistry.ts`
   - provider implementations generate a normalized label artifact for CorePOS to store

3. Print-preparation contract
   - shipment label payloads can be fetched directly from CorePOS
   - print preparation resolves a registered printer and returns a stable `SHIPMENT_LABEL_PRINT` payload with printer intent metadata
   - current transport target is declared as `WINDOWS_LOCAL_AGENT`

4. Printer registration and default resolution
   - `src/services/printerService.ts`
   - registered printers are stored in CorePOS with capability, active status, transport mode, and target details
   - shipment printing can resolve either a chosen printer or the default shipping-label printer

5. CorePOS print-agent delivery
   - `src/services/shipping/printAgentDeliveryService.ts`
   - sends prepared shipment print requests to the configured local agent endpoint
   - normalizes timeout, unreachable-agent, and bad-response cases

6. Local Windows print agent
   - `print-agent/src/`
   - validates shipment print payloads and performs the actual transport
   - currently supports `DRY_RUN` plus real `RAW_TCP` ZPL delivery

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
- can be handed off to a lightweight local print agent without going through the browser print dialog

## Current API shape

The first API slice lives under `/api/online-store` and supports:

- listing and creating web orders
- listing, creating, editing, and defaulting registered shipping-label printers via settings APIs
- generating a shipment label for an order
- fetching shipment metadata and stored label content
- preparing a print-intent payload
- printing through the configured Windows/local agent path
- recording print and dispatch milestones

## Current UI slice

`/online-store/orders` is now a real manager-facing page rather than a placeholder.

It currently supports:

- selecting a web order
- generating a shipment label for shipping orders
- viewing shipment/tracking state
- seeing which registered printer will be used
- previewing stored ZPL
- preparing a Windows-local-agent print payload
- sending the print job through the real agent path
- dispatching separately after print succeeds

This is intentionally a narrow dispatch workflow, not a broader storefront or fulfilment dashboard redesign.

## Future integration path

The intended next steps are:

1. real courier/provider adapters
   - e.g. carrier API credentials, service mapping, rate/service validation, production tracking references

2. richer print-agent/device support
   - local printer/device mappings beyond the first CorePOS-managed target model
   - durable local queueing or retry behavior
   - direct Windows spooler / USB Zebra support in addition to raw TCP

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

For the current Windows/Zebra print-agent setup, configuration, and limitations, see [windows_print_agent.md](/Users/thomaswitherspoon/Development/bike-epos-core/docs/windows_print_agent.md).
