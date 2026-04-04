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

### `GENERIC_HTTP_ZPL`

Purpose:

- production-shaped adapter scaffold for real courier-style HTTP integrations
- lets CorePOS exercise real provider resolution, credential handling, normalized response mapping, and failure handling without pretending a specific live carrier is already integrated

Characteristics:

- mode: `integration`
- implementation state: `scaffold`
- requires configuration: yes

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
- API key

Security behavior:

- API keys are stored but masked on API readback
- API responses expose `hasApiKey` plus a masked hint instead of the raw secret
- clearing a stored API key is explicit
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
- provider metadata blob
- normalized service code / name
- stored label document content

This keeps the persistence model ready for future real carrier adapters without forcing the print path to depend on remote label retrieval.

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

## API and UI surfaces

Settings/API:

- `GET /api/settings/shipping-providers`
- `PUT /api/settings/shipping-providers/:providerKey`
- `PUT /api/settings/shipping-providers/default`

Dispatch/API:

- shipment creation under `/api/online-store/orders/:orderId/shipments`
- shipment metadata and label retrieval under `/api/online-store/shipments/...`
- print preparation and print execution remain on the existing shipment-print endpoints

UI:

- `/management/settings` now includes shipping-provider configuration alongside dispatch-printer management
- `/online-store/orders` shows provider selection/readiness plus persisted provider references on created shipments
- EasyPost configuration now includes carrier account, service, and parcel-default controls required for a usable shipment purchase flow

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
- shipment cancellation / void APIs
- provider webhook/status sync
- remote label re-fetch logic
- carrier-specific packaging/compliance features
- multi-carrier production rollout beyond the first EasyPost path

`EASYPOST` is the first real carrier adapter, but the overall courier platform is still intentionally narrow and shipping-label focused.

## Recommended next steps

The next realistic follow-on work is:

1. expand EasyPost service/rate handling beyond a configured default service
2. add shipment cancellation/regeneration rules where the carrier permits them
3. add richer provider status sync and operational troubleshooting surfaces
4. add the next branded carrier adapter on top of the current contracts
5. keep the print-agent contract stable while printer/device support expands
