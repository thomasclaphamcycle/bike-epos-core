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

## Reminder Groundwork

Automated reminder groundwork is now present behind the event bus and is intentionally internal only.

- `workshop.job.completed` can create a persisted `ReminderCandidate` when the job has a real `completedAt` timestamp and a linked customer
- candidates store narrow groundwork fields only: customer, workshop job, source event, due date, status, and timestamps
- the current default reminder due date is 90 days after workshop completion
- candidates are not delivered automatically and do not currently change the manager reminder pages or customer-facing flows

Intentionally deferred:

- SMS, email, push, or webhook delivery
- background schedulers and automated send orchestration
- public or staff-facing reminder management UI based on these candidates
- sale-driven reminder candidate creation until a concrete reminder policy exists for retail-only events
