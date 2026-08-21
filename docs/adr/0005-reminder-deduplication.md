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
unique `dedupe_key`. The key format is specific to the reminder type:

- **Overdue** (`buildOverdueDedupeKey` in
  `src/lib/server/reminders/domain.ts`):
  `<userId>:<medicationId>:overdue:<scheduleKind>:<scheduleId>:<slotISO>[:n<index>]`.
  `scheduleKind`/`scheduleId` pin the key to the specific
  `medication_schedules` row that produced the slot, so a medication
  with two fixed-time schedules on the same day doesn't collapse onto
  one key. The optional `:n<index>` ordinal is covered below.
- **Low inventory** (`buildLowInventoryDedupeKey`):
  `<userId>:<medicationId>:low_inventory:<inventoryCount>`, so a
  fresh alert only fires once the count actually changes.

Claiming is an atomic `INSERT ... ON CONFLICT DO UPDATE ... WHERE
<retryable>` (`claimReminderSlot` in
`src/lib/server/reminders/dispatch.ts`), not a plain insert-or-skip:
a row that already exists is reclaimable only when its status is
`failed` or `pending` **and** `attempt_count < MAX_ATTEMPTS` **and**
`last_attempt_at` is older than the retry cooldown — the cooldown
gates both statuses equally, it is not skipped for `failed`. The two
statuses differ only in why the row is retryable: `failed` is an
explicit retry-after-cooldown, while a stale `pending` is lease
recovery for a worker that crashed mid-dispatch, which would
otherwise stay claimed forever.

## Bounded re-notification ordinal

A later phase added a repeat-until-acted cadence: a medication can be
configured to nag again every `notifyRepeatEveryMinutes`, up to
`notifyMaxRepeats` times, after the first overdue reminder. The
naive way to build that — re-deriving a new slot for each
re-notification — would have reproduced exactly the failure #110 was
reverted for: there, the SLOT itself advanced every interval, so the
dedupe key churned without bound and `claimReminderSlot` could never
suppress a repeat, i.e. "one reminder per interval, forever."

The implementation keeps the slot fixed (`computeOverdueSlot` is
untouched) and appends a **bounded** ordinal, `nagIndex`, computed
from elapsed time rather than counted in a table — no loop, and a
missed cron tick skips ahead in the series instead of firing a
backlog burst. `nagIndex` is clamped to `[0, maxRepeats]`, so one
slot owns at most `maxRepeats + 1` distinct keys, never an unbounded
number. That bound is what makes this safe where #110 wasn't.

At index 0 the `:n0` suffix is omitted entirely, which makes the key
byte-for-byte identical to the pre-feature format: every medication
that doesn't repeat keeps its existing key unchanged, and every
`reminder_events` row already in flight stayed addressable across
the deploy. See `computeNagIndex` and `buildOverdueDedupeKey` in
`src/lib/server/reminders/domain.ts`.

One consequence worth stating plainly: the unique constraint on
`dedupe_key` still guarantees any single key produces one row, but a
slot is no longer guaranteed to produce only one row overall — it can
now legitimately mint up to `maxRepeats + 1` rows, one per ordinal.

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

- The computed slot has to be stable across runs (we use the
  schedule's exact computed overdue timestamp, not "now").
- The table grows over time — the bounded re-notification ordinal
  above made this non-negligible, since one slot can now mint several
  rows. `purgeExpiredReminderEvents` (`src/lib/server/reminders/retention.ts`)
  now runs on every cron tick and deletes rows older than
  `REMINDER_EVENT_RETENTION_DAYS` (90).
