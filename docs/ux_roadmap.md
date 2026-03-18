# CorePOS UX Roadmap

This document is the canonical UX roadmap and navigation reference for CorePOS.

## Primary Navigation

- Dashboard
- POS
  - Sale
  - Receipts
  - Cash Management
- Sales History
  - Transaction List
  - Receipt View
  - Refund
  - Exchange
- Workshop
  - Job Board
  - New Job
  - Technician View
  - Workshop Analytics
- Inventory
  - Products
    - Product List
    - Categories
    - Brands
    - Attributes
  - Stock Levels
  - Stocktake
  - Transfers
  - Adjustments
- Customers
  - Customer List
  - Customer Bikes
  - Service History
  - Loyalty
- Purchasing
  - Suppliers
  - Purchase Orders
  - Receive Deliveries
- Reports
  - Sales Reports
  - Inventory Reports
  - Workshop Reports
  - Staff Performance
- Rental
  - Rental Calendar
  - New Rental
  - Active Rentals
  - Returns
  - Rental History
- Online Store
  - Orders
  - Products
  - Click & Collect
  - Website Builder
- Settings
  - Store Info
  - Staff & Roles
    - Staff List
    - Roles & Permissions
    - Staff Rota
  - POS Settings
  - Workshop Settings
  - Inventory Settings
  - Payments
  - Integrations
  - Receipts
  - System / Diagnostics

## UX Roadmap Phases

- UX-0 Navigation Architecture
- UX-1 POS (Checkout Experience)
- UX-2 Sales History
- UX-3 Workshop (Discovery)
- UX-4 Inventory
- UX-5 Reports
- UX-6 Manager Dashboard
- UX-7 Rental
- UX-8 Customer Experience
- UX-9 Online Store

## UX-1 POS Planned Follow-On

### POS Basket Persistence (PARTIAL / MEDIUM)

Intent:
Implement POS basket persistence in stages so staff do not lose the active basket during normal use, while leaving room for a later user/till-scoped model.

Phase 1 — Session Basket Persistence (Implemented):
- persist active basket ID in localStorage
- restore basket on POS load
- preserve basket across navigation
- clear basket on checkout / new sale
- recover safely from invalid or missing basket IDs
- backend remains the source of truth

Phase 2 — User / Till-Scoped Basket (Future):
- associate active basket with user and/or till session
- support recovery across login/logout and multiple tabs/devices
- define one-active-basket rules and conflict handling
- align the final model with till sessions and workshop handoff flows

Progress thresholds:
- partial = session persistence working
- complete = user/till-scoped persistence working

Architectural note:
- basket persistence is being implemented intentionally in stages so the near-term UX fix does not prematurely lock CorePOS into the wrong long-term session model
