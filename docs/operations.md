# Operations Guide

## Management Pages

- `/management`
  - dashboard and quick links
- `/management/actions`
  - grouped triage queue
- `/management/exceptions`
  - flat operational exception list
- `/management/investigations`
  - stock anomaly review queue
- `/management/reminders`
  - customer follow-up queue
- `/management/reordering`
  - purchasing prompts
- `/management/pricing`
  - margin and retail-price review
- `/management/capacity`
  - workshop backlog and ageing

## Severity Language

Manager-facing reporting pages should prefer the shared severity vocabulary:

- `CRITICAL`
- `WARNING`
- `INFO`

Business-specific statuses such as reorder urgency or reminder status can still exist, but they should map cleanly to the shared severity language in the UI.

## Practical Triage Order

1. Start in Action Centre for grouped operational review.
2. Use Operations Exceptions for the flat cross-functional queue.
3. Use Stock Investigations for item-level stock and pricing follow-up.
4. Move into the specific workflow surface:
   - inventory item
   - purchasing
   - workshop
   - customer profile
