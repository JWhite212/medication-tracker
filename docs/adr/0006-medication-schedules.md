# ADR 0006: Multi-row medication schedules

- **Status**: Accepted
- **Date**: 2026-04-29
- **Deciders**: Jamie White

## Context

Until Phase 4d the schedule for a medication lived on the
`medications` table itself: a single `schedule_type` enum
(`scheduled` / `as_needed`) plus a single `schedule_interval_hours`
column. That covered "every N hours" but couldn't represent any of
the most common real-world schedules:

- Twice daily at fixed times (e.g. 08:00 and 20:00).
- Three times daily at meals.
- Weekday-only doses (e.g. Mon/Wed/Fri statins).
- Combinations (a base interval plus a fixed evening dose).

It also conflated "on demand" (PRN) with the rest of the schema —
PRN had to be encoded as `as_needed` with a null interval, which
several downstream readers had to special-case.

## Decision

Introduce a `medication_schedules` table that owns the schedule
shape, with one **row per slot**. A medication can have any number
of schedule rows; readers union the slots they emit.

```ts
medicationSchedules: {
  id, medicationId, userId,
  scheduleKind: "interval" | "fixed_time" | "prn",
  timeOfDay: string | null,        // 'HH:mm' for fixed_time
  intervalHours: numeric | null,   // for interval
  daysOfWeek: number[] | null,     // 0=Sun..6=Sat, null = every day
  sortOrder, createdAt
}
```

`computeScheduleSlots` now takes a `Map<medicationId,
MedicationSchedule[]>`. Per row:

- **interval** projects forward from the last dose by `intervalHours`.
- **fixed_time** emits one slot per local-time-of-day per local day
  in range, optionally filtered by `daysOfWeek`.
- **prn** emits zero slots — PRN medications are user-initiated only.

Adherence (`expectedPerDayForSchedules`) sums each row's expected
contribution: `24 / intervalHours` for interval, `1 * daysOfWeek/7`
for fixed_time, `0` for prn.

The legacy `medications.scheduleType` and `schedule_interval_hours`
columns stay populated for one PR cycle for rollback safety, marked
DEPRECATED in `schema.ts`. A follow-up migration drops them after
the rollout.

## Alternatives considered

- **Cron-string column on `medications`** — flexible but opaque;
  hostile to UI rendering and to per-row analytics.
- **Wide column set on `medications`** (e.g. `time_of_day_1`,
  `time_of_day_2`, `time_of_day_3`) — bounded, awkward to extend,
  poor fit for `daysOfWeek` per slot.
- **Single JSONB schedule blob** — makes adherence queries painful
  and loses referential integrity.

A normalised child table is cheap, readable, and lets us add new
schedule kinds (cyclic, taper, n-on-m-off) without further schema
churn.

## Consequences

**Positive**

- Real-world schedules are representable directly.
- Each schedule row owns a clean `expectedPerDay` contribution,
  making analytics and overdue detection straightforward.
- PRN is a first-class kind, no longer an "absence of schedule".
- Migration is idempotent — `md5(med_id)` keys backfill rows so a
  replay is a no-op.

**Negative**

- One more table to keep in sync on create/update. Mitigated by
  funnelling all writes through `replaceSchedulesForMedication`
  (delete-then-insert), so a single code path owns the invariant.
- Neon HTTP doesn't support real transactions, so the delete/insert
  window is best-effort atomic. In practice a failed insert leaves
  a medication with no schedules — recoverable from the form by
  re-saving.
- Two columns on `medications` linger as DEPRECATED until the
  follow-up cleanup migration; readers must not regress to using
  them.
