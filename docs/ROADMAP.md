# CorePOS Development Roadmap

## Phase 1 — POS Foundation
Goal: Run the till

Features:
- Product search
- Basket management
- Checkout
- Payment methods
- Customer attach
- Email capture
- Quick product buttons
- Basket -> Quote
- Quote -> Sale
- Email quotes

Milestone:
Shop can sell products and send quotes.

---

## Phase 2 — Inventory Control
Goal: Accurate stock

Features:
- Product management
- SKU / barcode
- Price / cost
- Stock levels
- Stock movements
- Stock adjustments
- Multiple locations
- Low stock alerts
- Stock take
- Cycle counting

Milestone:
Shop trusts inventory numbers.

---

## Phase 3 — Bulk Data Import & Export
Goal: Efficiently manage large datasets

This phase supports:
- POS migration imports
- Supplier catalogue uploads where no live feed/API exists
- Bulk shop updates

Typical imports:
- Customers
- Products
- Inventory
- Supplier catalogues
- Price updates

Typical fields:
- Supplier SKU
- Barcode
- Product name
- Description
- Cost
- RRP
- Category
- Image URL

Workflow:
1. Upload CSV
2. Map columns
3. Validate
4. Preview
5. Import

Exports:
- Customers
- Products
- Sales
- Inventory
- Suppliers

Milestone:
CorePOS can ingest large datasets easily.

---

## Phase 4 — Purchasing
Goal: Manage suppliers and orders

Features:
- Supplier management
- Purchase orders
- Receive stock
- Backorders
- Product -> supplier linking

Milestone:
Shop can order and receive inventory.

---

## Phase 5 — Staff Management
Goal: Manage staff operations

Features:
- Staff accounts
- Role permissions
- PIN login
- Staff rota
- Workshop capacity planning
- Activity logs
- Sales performance tracking
- Mechanic performance tracking

Milestone:
Shop can manage staff and productivity.

---

## Phase 6 — Rental System
Goal: Manage bike rentals

Features:
- Rental products
- Availability tracking
- Booking calendar
- Deposits
- Rental agreements
- Collection and return workflow
- Damage tracking

Calendar notes:
- Rental and workshop should remain operationally separate calendars
- Workshop calendar should display rental bookings as a secondary visibility overlay
- Rental calendar does not need full workshop visibility by default

Milestone:
Shop can run bike hire operations.

---

## Phase 7 — Workshop System
Goal: Manage bike repairs

Features:
- Workshop jobs
- Customer bikes
- Job estimates
- Quote -> job conversion
- Parts + labour tracking
- Job workflow
- Customer notifications
- Collection workflow

Milestone:
Shop can run repairs digitally.

---

## Phase 8 — Workshop Booking Widget
Goal: Allow customers to book repairs online

Embeddable widget for any website.

Features:
- Repair booking
- Service selection
- Issue description
- Customer contact capture
- Email confirmations
- Automatic workshop job creation

Purpose:
- Validate workshop workflow
- Stress-test booking and job creation
- Allow shops to embed booking on any existing website

Milestone:
Customers can book repairs online.

---

## Phase 9 — Reporting & Insights
Goal: Understand business performance

Features:
- Daily sales
- Product performance
- Workshop revenue
- Stock valuation
- Customer insights
- Staff performance

Milestone:
Owner understands business metrics.

---

## Phase 10 — Supplier Feed Integration
Goal: Automate product data

Notes:
Some suppliers may provide live stock feeds.

Features:
- Supplier catalogue APIs
- Supplier stock feeds
- Automatic cost updates
- Automatic RRP updates
- Product matching
- Product image imports
- Supplier stock visibility
- Quick supplier ordering

Milestone:
Catalogue and stock availability update automatically.

---

## Phase 11 — Automation
Goal: Reduce manual work

Features:
- Reorder suggestions
- Service reminders
- Warranty tracking
- Customer communication queue
- Internal task reminders

Milestone:
System automatically manages routine tasks.

---

## Phase 12 — Customer Website Platform
Goal: Provide shop websites powered by CorePOS

This phase should come after embedded customer-facing tools have been proven.

Features:
- Shop website builder
- Content editor
- Media library
- Branding/themes
- Embedded CorePOS modules

Product strategy notes:
- Start with embedded customer-facing widgets rather than replacing whole websites immediately
- Use the workshop booking widget as the first real customer-facing embedded tool
- A good validation step is building the shop's own website using this tool

Milestone:
Shops can run their website on CorePOS.
