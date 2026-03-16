# CorePOS Dashboard UX v1

## Purpose

Dashboard is the operational control centre for CorePOS.

It is not a generic analytics landing page. Its job is to help staff and managers understand what needs attention in under five seconds and jump into the right workflow immediately.

Dashboard v1 favors:

- operational awareness over deep reporting
- quick actions over navigation hunting
- compact status widgets over charts
- graceful placeholders where live feeds do not yet exist

## UI Foundation

Dashboard now sits on the shared CorePOS UI foundation layer used by other operational screens.

Dashboard is the first page expected to fully demonstrate that foundation in practice, with:

- workspace-width layout
- shared page and section headers
- consistent KPI tiles
- consistent operational surface cards
- shared empty-state treatment across manager and staff views

The current foundation standardizes:

- central colour, spacing, type, radius, shadow, and width tokens in the global frontend stylesheet
- reusable page primitives for:
  - page headers
  - section headers
  - surface cards
  - empty states
- two page-width modes:
  - standard pages for settings/forms/admin surfaces
  - workspace pages for broader operational views such as Dashboard and Rota

The foundation is intended to reduce page-by-page styling drift while keeping the app visually consistent with the existing CorePOS direction.

## Layout Zones

Dashboard v1 uses four zones:

1. Header
   - greeting
   - date
   - time-of-day or current time
   - quick actions
2. KPI Row
   - compact operational summary cards
3. Main Operational Row
   - Action Centre
   - Workshop Snapshot
   - Rentals
4. Lower Context Row
   - Staff Today
   - Weather

## Header

### Greeting

- Format: `Hello {FirstName}`
- Show the current date
- Show either time-of-day or current time

### Quick Actions

Dashboard v1 quick actions are:

- New Sale
- New Workshop Job
- Customer Search
- View Rota

Rules:

- each action should take the user directly into a real workflow where possible
- if the destination exists only as a placeholder, the action may still link there
- if the current user cannot access the destination, use a clear disabled state rather than a broken route

## KPI Row

Dashboard v1 KPI cards:

- Monthly Margin
- vs Last Year
- Sales Today
- Transactions Today
- Outstanding Workshop Jobs

Rules:

- use live data where a defensible source already exists
- if a KPI does not yet have a suitable backend feed, show a clear placeholder state rather than inventing a number
- keep cards compact and readable from a standing distance

## Action Centre

### Purpose

Action Centre is for actionable operational alerts only.

It is not a reporting widget and should not be used as a chart surface.

### Rules

- show a maximum of 6 items
- sort by urgency:
  - overdue first
  - then waiting action
  - then informational
- every item must link to the operational area that resolves it
- use empty states when there is nothing to action
- use a clear restricted state if the current role cannot access the underlying report

### Supported alert types in the UI structure

- Overdue Workshop Jobs
- Outstanding Workshop Jobs
- Web Orders Requiring Action
- Overdue Purchase Orders
- Low Stock Alerts
- Overdue Rentals
- Jobs Ready for Pickup

The report implementation may emit differently named items underneath; the dashboard should still treat them as operational actions and sort them into the urgency-first list.

## Workshop Snapshot

Dashboard v1 workshop snapshot shows:

- Waiting
- In Progress
- Ready for Pickup

Rules:

- these counts should come from existing workshop dashboard data
- include direct links into the workshop board or collection workflow
- keep it summary-first, not job-table-first
- workshop staffing visibility should prefer workshop-tagged rota staff when those tags exist, while falling back to broader scheduled staff so the view stays useful during rollout
- workshop should also surface a lightweight capacity signal using rota-backed staffing plus due/overdue workshop workload, with clear states such as Closed, No cover, Light, Normal, Busy, and Overloaded

## Rentals Widget

Dashboard v1 rentals widget shows:

- Pickups Today
- Pickups Tomorrow
- Returns Today
- Returns Tomorrow
- Overdue

Rules:

- reuse existing hire/rental data if available
- if the current user cannot access rental data, show a role-aware restricted state
- if rental data is unavailable, show a clear empty state instead of invented numbers

## Staff Today

Dashboard v1 staff widget now shows who is scheduled today and tomorrow from live rota data.

Rules:

- use the canonical rota assignment layer as the source of staff coverage, whether the period was created in-app or imported
- allow staff to submit simple holiday requests without turning the dashboard into a rota planner
- surface a clear My Holiday Requests view on the dashboard so staff can see pending, approved, rejected, and cancelled request history plus any manager decision notes
- reflect approved holiday directly from rota HOLIDAY assignments, including a light on-holiday summary when relevant
- respect store-closed days from Store Info opening hours and rota closed-day overrides
- treat synced UK bank holidays as explicit closed days through `RotaClosedDay`, so the widget can explain bank-holiday closures with the same reason seen in Staff Rota
- keep the widget simple and operational rather than turning it into a full rota planner
- provide a View Rota action that opens the live planning workspace rather than a placeholder route
- keep the planner focused on scheduling, with import and bank-holiday sync moved into admin-only rota tools under settings
- keep the rota destination usable for daily ops with filters, missing-staff visibility, and a print-friendly period view rather than forcing a full planner rewrite

## Weather

Dashboard v1 weather widget should show today’s predicted weather when a feed exists.

Dashboard v1 weather now:

- uses Open-Meteo through a backend weather service
- reads store location from Store Info settings
- uses the saved store postcode as the location source of truth
- geocodes the postcode internally before requesting the forecast

If store location is missing:

- show a clear empty state telling the user to update Store Info

If the provider is temporarily unavailable:

- show a calm unavailable state instead of stale or fabricated data

## Dashboard UX Principles

- useful in under five seconds
- action-first, not chart-first
- one clear next step per widget
- compact, modular card layout
- graceful empty states for unavailable data
- role-aware restrictions should explain why something is unavailable
- do not overload v1 with large charts

## Widget List

Dashboard v1 includes:

- Header
- Quick Actions
- KPI Row
- Action Centre
- Workshop Snapshot
- Rentals
- Staff Today
- Weather

## Data Rules

Dashboard should reuse existing data sources wherever possible:

- sales daily report
- workshop dashboard
- action centre report
- hire booking list

Where a suitable source does not yet exist:

- use an explicit placeholder or limited-state card
- do not invent backend logic just to fill a widget

## Evolution Notes

Current dashboard follow-ons may still add:

- real rota presence
- weather feed integration
- dedicated financial-report navigation from the live monthly margin KPI
- richer cross-widget filtering

Those additions should extend Dashboard v1 rather than replace its operational control-centre role.
