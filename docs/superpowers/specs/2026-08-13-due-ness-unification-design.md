# Due-ness Unification — Design

"Is this dose due right now, and which slot?" is currently answered by three
independent implementations that disagree with each other. Collapse them into one
module so the question has one home, one rule, and one place to test.

> **Amended 2026-09-24 by the [dashboard "Due Now" rebuild](2026-09-24-dashboard-due-now-design.md).**
> That change landed some of this spec's pieces early and made others obsolete; read
> the _Amended_ notes below before implementing anything here. In short:
>
> - The dashboard's `computeTimingStatus` block and `covered` merge are already deleted.
> - `timingStatusFromSlots`, `classifyDueStatus`, `groupSlotsByTimeOfDay` and
>   `classifyHour` are deleted rather than moved or kept.
> - The lifecycle clip already applies in `computeScheduleSlots`.
> - The resolution rule should adopt that spec's passes 0–2 rather than the symmetric
>   ±1h rule stated here.

## The three answers, and how they differ

|                | module                                           | evidence it reads                     | used by            |
| -------------- | ------------------------------------------------ | ------------------------------------- | ------------------ |
| slot matching  | `computeScheduleSlots` (`utils/schedule.ts:188`) | every dose row for the day            | My Day timeline    |
| interval badge | `computeTimingStatus` (`utils/time.ts:135`)      | `lastEventAt` (taken **or skipped**)  | QuickLogBar badges |
| overdue scan   | `computeOverdueSlot` (`reminders/domain.ts:41`)  | `max(takenAt)` where `status='taken'` | reminder cron      |

Three verified divergences follow from that split:

1. **Skips.** `doses.ts:317` documents the intended rule outright — `lastEventAt`
   advances on `taken` _and_ `skipped` so "the user can dismiss an overdue slot by
   skipping it." The cron never calls it; `reminders.ts:106` runs its own aggregate
   filtered to `status = 'taken'`. Skipping a dose clears the dashboard badge and
   still sends a push.
2. **Tolerance.** The "a dose this close counts as satisfying the slot" rule is one
   hour, declared twice and independently: `MATCH_TOLERANCE_MS`
   (`utils/schedule.ts:29`, module-private) and `FIXED_TIME_TOLERANCE_MS`
   (`reminders/domain.ts:3`). Neither references the other.
3. **Never handled.** `computeTimingStatus` returns `overdue` when there is no prior
   event (`time.ts:143-146`); `computeOverdueSlot` returns `null` for the same case
   (`domain.ts:43`). An interval medication you have never logged shows an overdue
   badge but never pushes.

The dashboard load compounds this: `dashboard/+page.server.ts:39-45` picks which
implementation answers by branching on the **deprecated** `scheduleType` /
`scheduleIntervalHours` columns, then patches the gap with a `covered` set at
`:81-89`. That merge has no test.

## Decisions

**A dose resolves a slot when it is `taken` or `skipped`; `missed` never resolves.**
This adopts the `lastEventAt` semantics everywhere — the rule the codebase already
documents and two of three surfaces already implement. The cron changes to match.

**One rule, two projections.** The two callers genuinely differ in the evidence they
can afford: the dashboard has every dose row for one user's day, while the cron scans
every user on each tick and can only afford one grouped aggregate. Rather than force
one shape, the module owns the rule once and exposes two entry points over it.

**The legacy fallback is absorbed into the module.** Medications with zero
`medication_schedules` rows are still creatable: `importMedicationSchema` defaults
`schedules` to `[]` (`validation.ts:395`) while still accepting the deprecated
`scheduleIntervalHours` (`:380`), and `import/apply.ts:107` synthesises nothing. The
module derives a schedule from the legacy columns for such medications, so the
deprecated columns stop leaking into route-level branching.

**Never-handled medications begin at `startedAt`.** Neither existing answer is kept.
An occurrence exists once `startedAt` has passed, so a never-logged interval
medication becomes outstanding at `startedAt + intervalHours` — not instantly
(the badge's answer) and not never (the cron's). `medications.startedAt` is
`notNull().defaultNow()` (`schema.ts:95`), so this is always available.

## Architecture

New module at `src/lib/utils/due.ts`. It must live in `utils/` because the cron
(server), the dashboard load (server) and `MyDayTimeline.svelte` (client) all consume
it, so it may never import `$lib/server`. Date primitives (`localTimeOnDateToUtc`,
`getLocalDayOfWeek`, `getLocalDateString`) stay in `schedule.ts` and are imported.
_Amended 2026-09-24:_ the dashboard due-now rebuild **deleted** the presentation
helpers `groupSlotsByTimeOfDay` and `classifyHour`, and `classifyDueStatus` in
`time.ts`. The page is now grouped by action, not time of day, and no caller of the
classifier remained. None of them is moved here or kept. `MyDayTimeline.svelte` is
deleted as well; the client consumers are now the `src/lib/components/dashboard/`
components, which render a composed payload instead of calling due-ness directly.

```ts
export const SLOT_TOLERANCE_MS = 60 * 60 * 1000;
export const OVERDUE_LOOKBACK_DAYS = 1;

export type DoseEvent = {
  id: string;
  takenAt: Date;
  status: "taken" | "skipped" | "missed";
  quantity: number;
};

export type Evidence =
  | { kind: "events"; doses: DoseEvent[] } // UI: full fidelity
  | { kind: "anchor"; lastEventAt: Date | null }; // cron: one aggregate

export function effectiveSchedules(med, rows): EffectiveSchedule[];
export function outstandingSlots(med, schedules, evidence, window, tz, now): Slot[];
export function isOutstanding(schedule, evidence, tz, now): Date | null;
```

`window` is the `{ startUtc, endUtc }` pair the dashboard already derives from
`startOfDay` — the local day being rendered. `isOutstanding` takes no window: it walks
back `OVERDUE_LOOKBACK_DAYS` from `now` internally.

Both entry points are thin callers of one private occurrence-walk. Tolerance,
DST-safe day arithmetic, the walk-back, per-kind occurrence projection, the lifecycle
clip and the resolution rule are all private to it. _Amended 2026-09-24:_
`timingStatusFromSlots` was **deleted** rather than moved. Its only consumer was the
dashboard's `covered` merge, which is gone.

Modelling the evidence as a union is the point of the design: the cron's weaker
evidence becomes explicit in the type rather than an unremarked difference, which is
how the original divergence survived unnoticed.

## The rule, stated once

Occurrences project per schedule kind:

- **`fixed_time`** — one occurrence per local day at `timeOfDay`, filtered by
  `daysOfWeek` evaluated against the occurrence's _own_ local date, not today's.
- **`interval`** — steps of `intervalHours` from an anchor. The anchor is the last
  resolving event (`taken` or `skipped`), or `startedAt` when there is none.
- **`prn`** — no occurrences.

Occurrences are clipped to the medication's `[startedAt, endedAt]` lifecycle window,
consistent with how analytics already treats that range. _Amended 2026-09-24:_ this
clip has already landed in `computeScheduleSlots`, together with a second,
schedule-edit clip for pre-midnight slots. Move both into the new module; do not add
them again.

An occurrence is **resolved** by a `taken` or `skipped` event within
±`SLOT_TOLERANCE_MS`. A `missed` row never resolves one — it records that a dose was
not consumed, so the slot stays outstanding. An occurrence in the past that is not
resolved is outstanding. The fixed-time scan walks back `OVERDUE_LOOKBACK_DAYS` to
find the most recent elapsed occurrence, so a slot timed after the cron tick is not
lost when the local date rolls over.

_Amended 2026-09-24:_ the symmetric ±`SLOT_TOLERANCE_MS` rule above is what the
dashboard used to do, and it is now pass 1 of three. `outstandingSlots` should adopt
the dashboard's rules as specified in
[the due-now spec's Three passes](2026-09-24-dashboard-due-now-design.md#three-passes):
passes 0–2 (exact-instant claims, reserved skips, late resolution), the segment limit
and both clips. The cron's anchor evidence cannot run pass 2 and stays as described
under "Limits of the anchor projection".

### Limits of the anchor projection

The two projections apply one rule, but they do not have equal evidence, and the
difference is real rather than cosmetic. `{kind:"events"}` sees every dose row and can
resolve each occurrence independently — that is what makes capacity matching (one
quantity-3 dose satisfying three nearby slots) possible. `{kind:"anchor"}` sees a
single `lastEventAt` and can therefore only reason about the most recent event.

Where a day holds several occurrences and several dose events, the anchor projection
is strictly less precise: it can tell that the most recent occurrence is outstanding,
but not that an earlier one in the same day was missed. That is an accepted limit of
the cheap projection, not a defect — it matches what the cron does today, and the cron
only needs to answer "should this medication reminder fire now?".

This bounds the parity test below: the two projections must agree for a single
schedule whose relevant window holds at most one dose event. Beyond that, `events` is
authoritative and `anchor` is a conservative approximation of it. An implementer who
writes an unbounded parity test will be unable to make it pass, and should not try.

## Migration

### The reminder cron

Today:

```
medication_schedules ⋈ medications ⋈ users ⋈ prefs        (inner join)
+ max(takenAt) filter (status = 'taken')   →  computeOverdueSlot(row, now)
```

After:

```
medications ⋈ users ⋈ prefs ⟕ medication_schedules        (left join)
+ max(takenAt) filter (status in ('taken','skipped'))
→ effectiveSchedules(med, rows) → isOutstanding(sched, {kind:"anchor", lastEventAt}, tz, now)
```

The join relaxes to a left join because absorbing the legacy fallback means
schedule-less medications must reach the dispatcher. The select gains `startedAt` and
`endedAt` for the lifecycle clip. The aggregate the cron needs already exists —
`getLastDoseTimes` (`doses.ts:317`) computes exactly this `lastEventAt`; the cron
simply never called it.

Everything downstream of `isOutstanding` is untouched: the dedupe key, the claim, the
channel fan-out, `claimReminderSlot` and `completeReminder` all keep their contracts.

`buildOverdueDedupeKey` takes a `scheduleId`, and a synthesised legacy schedule has no
row, so it gets the stable synthetic id `legacy:{medicationId}` — mirroring how
migration `0006` derived deterministic ids. The key stays well-formed and unique per
medication.

### The dashboard load

`dashboard/+page.server.ts:39-54` (the `computeTimingStatus` block and its filter on
deprecated columns) and `:81-89` (the `covered`-set merge) are both deleted.
_Amended 2026-09-24: both deletions have landed._ The dashboard load is now
`loadDashboard` (`src/lib/server/dashboard/load.ts`) plus `getRefillForecast`, and
composition lives in `src/lib/server/dashboard/page-data.ts`. What remains here is to
route that composition's per-medication projection and matching through
`outstandingSlots`.
`lastDoseByMedication` is rebuilt from `lastEventAt` rather than `lastTakenAt`. What
remains is one call to `outstandingSlots` with `{kind:"events", doses: todaysDoses}`,
with badges derived from the returned slots. Roughly 50 lines of domain logic leave
the route, and the route stops branching on deprecated columns to choose an
implementation.

### Deleted

`computeOverdueSlot`, `isScheduleOverdue`, `computeTimingStatus`,
`MATCH_TOLERANCE_MS`, `FIXED_TIME_TOLERANCE_MS`, and the `covered`-set merge.
`reminders/domain.ts` keeps only its dedupe-key builders, which are reminder
concerns rather than due-ness. _Amended 2026-09-24:_ `computeTimingStatus` and the
`covered`-set merge are already gone. `MATCH_TOLERANCE_MS` is now **exported** from
`schedule.ts` beside `CARRY_OVER_MS`, which the reminder cap imports. Fold both into
`SLOT_TOLERANCE_MS`'s module rather than deleting them.

### Unchanged

_Amended 2026-09-24: obsolete as written._ `MyDayTimeline.svelte` and
`MedicationTimingStatus` are deleted. `QuickLogBar.svelte` takes
`{ medications, todayStart, timezone, timeFormat }` and shows no due-ness at all. `ScheduleSlot` is kept
(it gained `kind`, `isEarlier`, `resolvedByDoseId` and `missedByDoseId`). The
medications list computes no due-ness and is untouched.

## Testing

**Survives unchanged.** `schedule.test.ts`'s ~30 cases encode the rules the module
must preserve — skipped-dose matching (`:218`), missed-rows-stay-overdue (`:242`), the
±1h vicinity (`:402`), quantity capacity matching, drifted-twin suppression
(`:498-549`). Assertions stand; only the call signature gains the `Evidence` argument.
If a rewrite breaks a rule, that suite says so. `reminders-dedupe.test.ts` keeps its
dedupe-key cases, its look-back cases (`:216-247`) and its fixed-time tolerance cases.
_Amended 2026-09-24:_ it keeps the look-back cases, with ticks inside 12h of the
slot, because the reminder cap stops reminding about a pre-midnight slot once it is
12h old.

**Contradicts the new rule — exactly two cases.** These are the only assertions in the
suite that the `startedAt` decision invalidates, one on each side of the old
contradiction:

- `reminders-dedupe.test.ts:86` — "never-taken interval is not overdue (no baseline)"
- ~~`time.test.ts:152` — "returns 'overdue' when lastTakenAt is null (never taken)"~~
  _Amended 2026-09-24:_ deleted with `computeTimingStatus` by the dashboard due-now
  rebuild, so this half of the check no longer exists.

The remaining case is replaced by one asserting the `startedAt + intervalHours` rule.
Having to edit precisely that one, and nothing else, is the check that the decision
landed where the design says it does.

**Retires with its function.** _Amended 2026-09-24: done._ The dashboard due-now
rebuild deleted `computeTimingStatus`'s block in `time.test.ts` together with the
function. `time.test.ts` keeps `formatTimeSince`, `formatTime`, `startOfDay` and
`formatDueIn`, and gains `formatDuration`. `classifyDueStatus` had no tests and is
deleted.

**New.** The test that matters most is a **parity test**, bounded as described under
"Limits of the anchor projection": given one schedule, one timezone, one instant and
at most one dose event in the relevant window, `outstandingSlots` and `isOutstanding`
must agree on whether that slot is outstanding — across `taken` / `skipped` / `missed`,
inside and outside tolerance. That test would have caught the original divergence, and
it only becomes writable once both answers come from one module. Plus targeted cases
for skip-resolves, the `startedAt` rule, and legacy-fallback synthesis.

**Known friction.** `reminders.test.ts` mocks the database by call order
(`selectCallIndex === 0 ? scheduleRows : lastTakenRows`, `:28-30`). The cron's query
shape changes here, so that mock must be reworked as part of this work. Budget for it.

## Behaviour changes

1. Skipping a dose stops the overdue push. _(the fix)_
2. Never-logged interval medications stop showing an instant "overdue" badge; they go
   outstanding at `startedAt + intervalHours`, and can now push, which they never did.
3. After skipping an interval dose, My Day's later slots shift out by one interval,
   matching what the badge already did.
4. Medications imported without schedule rows begin receiving reminders.

Point 4 is the deployment risk: that population has been silently invisible, so the
first cron tick after deploy could produce a burst for any account that imported such
a backup. Count those medications before shipping —
`medications LEFT JOIN medication_schedules … WHERE schedule_id IS NULL` — rather than
discovering the number from push volume.

## Adjacent fixes (in scope)

ADR-0005 documents the dedupe key as `${userId}:${medicationId}:${reminderType}:${nextDueAt}`.
The implementation has built six segments since the multi-schedule work, adding
`scheduleKind` and `scheduleId`. Since this change adds a synthetic-id case to that same
key, correct the ADR here rather than let it drift further.

## Out of scope

The duplicated "expected daily rate" precedence (`inventory.ts:32`,
`analytics.ts:249-254`, `medications.ts:95-121`) is a separate candidate, even though
`effectiveSchedules` is the natural seam it would later share. The dead
`calculateDaysUntilRefill` (`time.ts:80`) and its 13 assertions stay for now — deleting
them belongs with that work. Giving the database a substitution seam, which would fix
the `reminders.test.ts` mock properly rather than reworking it, is its own candidate
and should follow this one.
