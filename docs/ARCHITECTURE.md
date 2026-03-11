# CorePOS Architecture Overview

This document describes the high-level architecture of the CorePOS system.

## Core Domain Models

Primary models:
- Products
- Inventory
- Suppliers
- Customers
- Sales
- Quotes
- Staff
- Rentals
- Workshop Jobs
- Customer-Facing Widgets (later)
- Website Platform (later)

These models power most platform features.

---

## Key Relationships

Products
-> linked to suppliers
-> stored in inventory locations
-> sold through POS
-> used in workshop jobs
-> may be used in rentals where applicable

Customers
-> linked to sales
-> linked to quotes
-> linked to workshop jobs
-> linked to rentals

Staff
-> perform sales
-> perform workshop jobs
-> appear in activity logs
-> drive rota and capacity planning

Suppliers
-> provide products
-> provide catalogue imports
-> may provide live feeds/APIs
-> support purchasing workflows

Rentals
-> depend on customers
-> depend on staff
-> depend on booking/calendar logic

Workshop Jobs
-> depend on customers
-> depend on staff
-> depend on products/inventory
-> may be created through the workshop booking widget

---

## System Layers

Frontend
- React UI
- POS interface
- management dashboards
- embedded customer-facing widgets (later)
- website platform UI (later)

Backend
- API endpoints
- business logic
- authentication
- reporting
- booking logic
- supplier integration logic

Database
- PostgreSQL
- Prisma ORM

---

## Major System Modules

POS
Handles sales, checkout, quotes, and customer attachment.

Inventory
Tracks stock levels, movements, stock take, and locations.

Import / Export
Handles migration imports, supplier catalogue uploads, and bulk updates.

Purchasing
Handles supplier relationships, purchase orders, and receiving stock.

Staff
Handles authentication, permissions, rota, activity logs, and performance tracking.

Rentals
Handles rental products, availability, bookings, deposits, returns, and damage tracking.

Workshop
Manages repair jobs, labour, parts usage, and customer communication.

Workshop Booking Widget
Provides an embeddable booking experience for workshop jobs on external websites.

Reporting
Provides operational and financial insights.

Supplier Integrations
Handles live feeds, APIs, stock availability, and automated updates.

Automation
Handles reorder suggestions, reminders, and communication tasks.

Website Platform
Provides a future shop website builder powered by CorePOS modules.

---

## Calendar Design Principles

Rental and workshop should remain separate operational calendars.

However:
- the workshop calendar should display rental bookings as a secondary overlay for visibility
- the rental calendar does not need full workshop visibility by default

This keeps ownership separate while improving operational awareness.

---

## Product Strategy Notes

Customer-facing tools should be introduced in two stages:

### Stage 1 — Embedded Customer Widgets
Examples:
- Workshop booking widget
- Quote approval widget
- Rental booking widget
- Service reminder booking links

### Stage 2 — Website Platform
Examples:
- Shop website builder
- Editable pages
- Media/content management
- Branding/theme controls
- Embedded CorePOS modules

The workshop booking widget should come earlier to validate the workshop module before a full website platform is attempted.
