# ADR 0005: Idempotent reminder dispatch via dedupe key

- **Status**: Accepted
- **Date**: 2026-04-23
- **Deciders**: Jamie White

## Context

The reminders cron (`/api/cron/reminders`) finds overdue medications
and sends email + push notifications. Cron jobs are at-least-once by
design, and the same overdue medication will stay overdue across
multiple cron invocations. Without deduplication a user could be
spammed every five minutes with the "you missed 8am ibuprofen"
notification.

## Decision

Persist a **`reminder_events` row per dispatched reminder** with a
unique `dedupe_key`. The key is the deterministic tuple
`${userId}:${medicationId}:${reminderType}:${nextDueAt.toISOString()}`,
so the same overdue slot only ever produces one event row. Sending
is wrapped in an insert-or-skip on conflict so a concurrent run
can't duplicate either.

## Alternatives considered

- **Compute "have I sent this in the last N minutes" at query time**
  — fragile around cron timing, doesn't survive cross-region
  failover.
- **Redis SET with TTL keyed by the same tuple** — adds an
  infrastructure dependency; Postgres can do the job here without
  a new moving part.
- **Send-and-forget** — what the previous version did; the doc's
  Phase 1 review flagged it as a real reliability bug.

## Consequences

**Positive**

- Deterministic; testable (insert the same dedupe row twice in a
  test and assert the second insert no-ops).
- The `reminder_events` table doubles as a delivery audit log —
  great for "why didn't I get a reminder?" debugging.
- Strong portfolio talking point: idempotent notification design.

**Negative**

- The `nextDueAt` rounding has to be stable across runs (we use the
  schedule's exact computed next-due timestamp, not "now").
- The table grows unbounded over time; we'll add a 90-day retention
  cron in a later phase.
