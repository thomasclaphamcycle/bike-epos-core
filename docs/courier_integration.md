# Courier Integration Foundation

This document describes the current CorePOS courier/provider integration foundation for web-order shipping labels.

## What is implemented now

CorePOS now supports provider-backed shipment creation without collapsing the existing shipment, printer, or print-agent boundaries.

The current delivered slice includes:

- CorePOS-owned shipment orchestration for web orders
- a provider registry with explicit mock vs integration implementations
- manager/admin settings for configured shipping providers
- default shipping-provider resolution inside CorePOS
- provider-backed shipment metadata persisted on `WebOrderShipment`
- provider lifecycle refresh/void hooks with adapter-level capability flags
- webhook-ready provider sync with idempotent event receipts
- continued use of stored inline ZPL for reliable reprints
- compatibility with the existing registered-printer and Windows print-agent flow

This milestone is production-oriented in shape, but intentionally honest about current provider readiness.

## Provider model

The provider layer now distinguishes between:

- built-in mock providers that are always available for development
- configured integration providers that require stored settings before use

Current providers:

### `INTERNAL_MOCK_ZPL`

Purpose:

- deterministic local/dev shipment-label generation
- no external network dependency
- reliable smoke/e2e coverage

Characteristics:

- mode: `mock`
- implementation state: `mock`
- requires configuration: no
- supports shipment refresh: yes
- supports shipment void: yes

### `GENERIC_HTTP_ZPL`

Purpose:

- production-shaped adapter scaffold for real courier-style HTTP integrations
- lets CorePOS exercise real provider resolution, credential handling, normalized response mapping, and failure handling without pretending a specific live carrier is already integrated

Characteristics:

- mode: `integration`
- implementation state: `scaffold`
- requires configuration: yes
- supports shipment refresh: no
- supports shipment void: no

It currently expects a provider endpoint that accepts a normalized shipment request and returns:

- shipment/tracking references
- provider status
- inline ZPL document content

### `EASYPOST`

Purpose:

- first genuine carrier-backed shipment adapter in CorePOS
- provides a real sandbox/live credential model, shipment purchase flow, provider shipment/tracking references, and ZPL-compatible label handling

Characteristics:

- mode: `integration`
- implementation state: `live`
- requires configuration: yes
- supports shipment refresh: yes
- supports shipment void: yes

Current behavior:

- CorePOS creates an EasyPost shipment from the web-order shipping address plus Store Info ship-from details
- CorePOS buys the requested EasyPost rate from the configured carrier account
- CorePOS prefers `label_zpl_url` and stores the downloaded ZPL inline for safe reprints
- if EasyPost does not return a ZPL URL directly but does support PNG purchase output, CorePOS can request ZPL conversion through the EasyPost shipment label endpoint

## Provider settings model

Provider configuration is managed through CorePOS settings and stored in `AppConfig`.

Current config keys:

- `shipping.defaultProviderKey`
- `shipping.provider.genericHttpZpl`
- `shipping.provider.easyPost`

Current configurable fields for `GENERIC_HTTP_ZPL`:

- enabled
- environment: `SANDBOX` or `LIVE`
- display name
- endpoint base URL
- account ID
- API key

Current configurable fields for `EASYPOST`:

- enabled
- environment: `SANDBOX` or `LIVE`
- display name
- optional API base URL override
- carrier account ID
- default service code
- default service name
- default parcel weight/length/width/height
- webhook secret for HMAC-validated inbound sync
- API key

Security behavior:

- API keys are stored but masked on API readback
- webhook secrets are stored but masked on API readback
- API responses expose `hasApiKey` plus a masked hint instead of the raw secret
- API responses expose `hasWebhookSecret` plus a masked hint instead of the raw secret
- clearing a stored API key is explicit
- clearing a stored webhook secret is explicit
- disabled or incomplete providers cannot be resolved for shipment creation

## Shipment data stored now

`WebOrderShipment` now has room for provider-backed shipment metadata, including:

- provider key / display name
- provider environment
- provider reference
- provider shipment reference
- provider tracking reference
- provider label reference
- provider status
- provider refund/void status
- provider metadata blob
- provider sync timestamp / last sync error
- void-requested and voided timestamps
- normalized service code / name
- stored label document content

This keeps the persistence model ready for future real carrier adapters without forcing the print path to depend on remote label retrieval.

CorePOS now also persists inbound provider event receipts in `ShippingProviderSyncEvent`, including:

- provider event ID and type
- matched shipment reference fields
- verified-signature flag
- deduplicated processing status
- delivery count / timestamps
- last processing error for troubleshooting

## Shipment lifecycle operations

CorePOS now supports three distinct provider-facing shipment operations:

1. create label
   - creates and purchases the shipment
   - stores the label inline in CorePOS

2. refresh shipment
   - re-reads provider shipment state
   - updates provider status / refund status / sync metadata
   - can confirm a pending EasyPost refund into a final voided shipment state

3. void shipment
   - requests provider-side shipment void/refund when the adapter supports it
   - does not silently mark the shipment voided unless the provider confirms a successful outcome

4. inbound provider sync
   - accepts provider webhook events through a dedicated inbound path
   - verifies signatures where supported
   - reconciles delayed provider outcomes idempotently
   - keeps manual refresh available as a fallback

CorePOS keeps these separate from print and dispatch:

- print remains a local printer/agent concern
- dispatch remains a distinct staff confirmation
- voided or void-pending shipments are blocked from new print/dispatch actions
- replacement shipment creation is only allowed after a prior shipment is fully voided

## Request mapping and normalization

CorePOS now keeps three layers separate:

1. CorePOS shipment request model
   - built from the internal web-order/shipment domain

2. provider adapter mapping
   - provider-specific request shaping, auth headers, and endpoint details

3. normalized provider response
   - tracking/service/reference/document fields mapped back into a stable CorePOS result

This means later carrier adapters can differ internally without changing shipment orchestration or the print-agent contract.

For EasyPost specifically, the mapping is now:

1. CorePOS shipment request
   - order, recipient, ship-from, service, and parcel defaults

2. EasyPost adapter mapping
   - `/shipments`
   - rate selection from returned `rates`
   - `/shipments/:id/buy`
   - ZPL label retrieval

3. normalized CorePOS result
   - shipment/provider references
   - tracking number
   - provider status
   - provider refund status where relevant
   - stored inline ZPL document

## Current shipment generation flow

1. A manager chooses a provider explicitly, or CorePOS falls back to the configured default provider.
2. CorePOS validates the order state and reserves the next shipment number.
3. CorePOS resolves provider runtime configuration from settings.
4. The selected provider adapter creates the shipment label.
5. CorePOS persists the normalized result on the shipment record.
6. The stored ZPL artifact then feeds the existing print-preparation flow.
7. Registered printer resolution and Windows print-agent delivery happen afterwards as a separate concern.

Important safety behavior:

- provider creation failures do not create a false successful shipment
- shipment print and shipment dispatch remain separate actions
- reprints use the stored CorePOS-owned label artifact
- EasyPost credential/config readiness is validated before shipment creation is attempted

For lifecycle hardening:

- provider refresh failures are recorded without falsely changing local shipment state
- provider void failures do not falsely mark a shipment as voided
- a pending void can later resolve to either `VOIDED` or back to the prior active local print state depending on the provider outcome
- existing provider-backed shipments can still use lifecycle actions even if new-shipment defaults such as parcel presets are incomplete later

## API and UI surfaces

Settings/API:

- `GET /api/settings/shipping-providers`
- `PUT /api/settings/shipping-providers/:providerKey`
- `PUT /api/settings/shipping-providers/default`

Dispatch/API:

- shipment creation under `/api/online-store/orders/:orderId/shipments`
- shipment metadata and label retrieval under `/api/online-store/shipments/...`
- provider refresh under `/api/online-store/shipments/:shipmentId/refresh`
- provider void under `/api/online-store/shipments/:shipmentId/cancel`
- replacement shipment generation under `/api/online-store/shipments/:shipmentId/regenerate`
- print preparation and print execution remain on the existing shipment-print endpoints
- inbound provider webhook ingestion under `/api/shipping/providers/:providerKey/webhooks`

UI:

- `/management/settings` now includes shipping-provider configuration alongside dispatch-printer management
- `/online-store/orders` shows provider selection/readiness plus persisted provider references on created shipments
- `/online-store/orders` now also surfaces provider refund state, last sync outcome, void controls, refresh controls, and replacement-shipment recovery
- EasyPost configuration now includes carrier account, service, parcel-default, and webhook-secret controls required for a usable shipment purchase and sync flow

## Provider sync foundation

CorePOS now includes a dedicated provider-sync service layer that sits between provider adapters and shipment persistence.

Current responsibilities:

- normalize fetched lifecycle results and inbound provider events into the existing shipment lifecycle fields
- apply state transitions safely without collapsing print or dispatch semantics
- record `providerSyncedAt` / `providerSyncError`
- persist idempotent inbound event receipts
- ignore duplicate or unmatched events safely

EasyPost support now includes:

- HMAC-validated inbound webhook handling using `x-timestamp`, `x-path`, and `x-hmac-signature-v2`
- mapped `tracker.updated` events for shipment/tracker status freshness
- mapped `refund.successful` events for delayed void/refund completion
- manual refresh remaining available when webhook sync is not configured or when staff want an explicit fallback check

## Relationship to Windows/Zebra printing

Courier generation still stops at a CorePOS-owned printable artifact.

That matters because:

- CorePOS does not depend on a provider-hosted label URL at print time
- provider-backed labels remain reprintable even if the provider is unavailable later
- the Windows local print agent continues to receive the same backend-owned print contract
- printer registration/default resolution remains independent from provider selection

The Zebra GK420d path therefore stays stable while the courier layer evolves.

## Current limitations

This milestone does not yet provide:

- rate shopping or service availability lookup
- webhook coverage beyond the first EasyPost tracker/refund events
- remote label re-fetch logic
- carrier-specific packaging/compliance features
- multi-carrier production rollout beyond the first EasyPost path

`EASYPOST` is the first real carrier adapter, but the overall courier platform is still intentionally narrow and shipping-label focused.

## Recommended next steps

The next realistic follow-on work is:

1. expand EasyPost service/rate handling beyond a configured default service
2. expand provider sync coverage beyond the first EasyPost events and add richer troubleshooting surfaces
3. add carrier-specific regeneration/void policies where adapters differ materially
4. add the next branded carrier adapter on top of the current contracts
5. keep the print-agent contract stable while printer/device support expands
