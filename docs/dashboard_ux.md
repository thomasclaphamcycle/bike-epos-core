# CorePOS Dashboard UX v1

## Purpose

Dashboard is the operational control centre for CorePOS.

It is not a generic analytics landing page. Its job is to help staff and managers understand what needs attention in under five seconds and jump into the right workflow immediately.

Dashboard v1 favors:

- operational awareness over deep reporting
- quick actions over navigation hunting
- compact status widgets over charts
- graceful placeholders where live feeds do not yet exist

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

Dashboard v1 staff widget now shows who is scheduled today from imported rota data.

Rules:

- use imported rota assignments as the source of staff coverage
- respect store-closed days from Store Info opening hours and rota closed-day overrides
- keep the widget simple and operational rather than turning it into a full rota planner
- provide a View Rota action

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

Future dashboard iterations may add:

- real rota presence
- weather feed integration
- cost-aware monthly margin KPI
- richer cross-widget filtering

Those additions should extend Dashboard v1 rather than replace its operational control-centre role.
