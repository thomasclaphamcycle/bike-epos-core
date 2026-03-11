# Purchasing Workflow

## Core Flow

1. Maintain suppliers and product/supplier relationships.
2. Create purchase orders.
3. Send and track open purchase orders.
4. Receive against open quantities.
5. Update inventory through receiving and stock ledger flows.

## Key Surfaces

- `/purchasing`
  - operational purchasing workspace
- `/purchasing/:id`
  - purchase order detail and receiving state
- `/purchasing/receiving`
  - goods-in shortcuts
- `/management/purchasing`
  - manager-facing PO action centre
- `/management/reordering`
  - stock-led buying suggestions
- `/management/suppliers`
  - supplier performance review

## Reporting Inputs Used By Purchasing Views

- open and partially received purchase orders
- purchase order item ordered and received quantities
- supplier-level PO activity
- inventory on-hand and recent sales data

## Current Constraints

- no automatic PO creation
- no forecasting engine
- no purchasing schema redesign on this branch
- manager reporting surfaces are advisory and operational rather than workflow automation
