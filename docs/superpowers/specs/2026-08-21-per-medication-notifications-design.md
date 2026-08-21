# Per-Medication Notification Settings — Design

Notification preferences are account-wide. `user_preferences` carries four booleans —
`overdueEmailReminders`, `overduePushReminders`, `lowInventoryEmailAlerts`,
`lowInventoryPushAlerts` — and both reminder sweeps read them as a single gate for
every medication the user owns (`reminders.ts:46-47`, `:174-175`).

That is the wrong granularity for the actual complaint. A user who wants to stop being
nagged about one medication has exactly one lever: turn overdue reminders off for
_everything_. There is no way to say "push me about the 8pm one, email me about the
inhaler, and never mention the multivitamin again".

This adds a per-medication layer over that global default, and — separately — lets a
medication re-notify on a cadence until the dose is actually logged or skipped.

## Scope

Two phases, sequential, one spec. Phase 2 hangs off Phase 1's columns.

- **Phase 1 — per-medication control.** Enable/disable per medication; choose email
  and/or push per medication; choose which notification types (overdue dose,
  low inventory) per medication. Ships on today's infrastructure unchanged.
- **Phase 2 — custom timing and repeat-until-acted.** An offset from each scheduled
  slot, and a bounded re-notification cadence that stops when the user logs or skips.

## The infrastructure constraint, and what it decided

`/api/cron/reminders` is driven by two schedulers: the Vercel cron once a day
(`vercel.json:5`, the Hobby plan cap) and a GitHub Actions workflow every 30 minutes
between 06:00 and 22:59 UTC (`reminder-tick.yml:28`). **30 minutes is the finest
re-notification resolution the system can currently deliver**, and there is a nightly
blackout.

Driving it faster is not free. Neon's free tier autosuspends the compute after ~5
minutes idle, so this is a cliff rather than a slope:

| tick interval  | compute behaviour    | approx hours/month              |
| -------------- | -------------------- | ------------------------------- |
| 30 min (today) | wakes, works, sleeps | ~90 — inside the free allowance |
| 20 min         | wakes, works, sleeps | ~140 — inside                   |
| ≤ 5 min        | **never sleeps**     | ~510 — well over                |

Any tick at or below the autosuspend threshold keeps the compute permanently awake, so
a 1-minute driver and a 5-minute driver cost the same. Tightening the GitHub Actions
cron to `*/5` therefore buys nothing on cost while still being best-effort and
routinely late.

**Decision: store an arbitrary interval, expose only what can be honoured.** The
schema accepts any whole number of minutes. The picker offers 30 / 60 / 120. If a
faster driver is ever added, widening the picker is a config change, not a migration.
The UI must never show a cadence the infrastructure cannot deliver.

## Decisions

1. **Per-medication settings are nullable columns on `medications`, not a child
   table.** `NULL` means "inherit the global preference".
2. **Resolution has exactly one owner** — a pure function in
   `src/lib/server/notifications/resolve.ts`. Both sweeps consume it; neither
   re-derives it.
3. **Custom time is an offset from each scheduled slot**, not a standalone daily time.
4. **The repeat is a bounded ordinal appended to the existing dedupe key**, derived
   from elapsed time rather than counted in a state table.
5. **The nag ordinal clamps at `maxRepeats`; it does not cut off.**
6. **Phase 2's timing and repeat apply to overdue reminders only.** Low inventory keeps
   its single-shot behaviour. (Phase 1's per-medication toggles still cover both types.)
7. **Contract tests for today's behaviour land before any production line moves.**

### Why columns on `medications` (decision 1)

A `medication_notification_settings` child table is the more orthodox modelling. It
was rejected because four things come free from the parent table and each would
otherwise be hand-built:

- **Audit.** `computeChanges` already whole-row diffs the medication
  (`medications.ts:239`). A child table gets no audit today — `medication_schedules`
  is delete-and-reinsert with none — and would need a second audited writer mirroring
  `updatePreferences`' read-before-image discipline.
- **Sync.** Settings ride the medication's `updatedAt` bump. A child row only reaches
  a delta sync if the write also touches the parent, which is the documented trap at
  `docs/api-v1-contract.md:190-197`.
- **Deletion.** "Revert this medication to the global default" is `SET NULL`, so no
  new `syncTombstones.entityType` is needed.
- **Join safety.** The sweeps already INNER JOIN `medications`. A nullable child row
  reintroduces the LEFT-JOIN-predicate trap that CLAUDE.md documents at length.

The cost is five columns on an already-wide table. `inventoryAlertThreshold` is
already a per-medication notification-shaped field living there, so this follows
precedent rather than setting one.

### Why `NULL` means inherit

A plain boolean cannot express "unset", and the difference is not cosmetic. With
booleans, every newly created medication would need its settings configured up front,
and flipping the global toggle would silently stop affecting medications created
before the change. The tri-state keeps the global preference meaningful as a default
rather than a one-time seed.

This has a direct UI consequence: `checkboxField` maps a missing field to `false`
(`validation.ts:113-116`), so a checkbox **structurally cannot** represent inherit.
The control is a three-way select or radio group.

## Data model

All columns on `medications`.

```
-- Phase 1
notifications_enabled          boolean NOT NULL DEFAULT true   -- per-med kill switch
notify_overdue_email           boolean NULL                    -- NULL = inherit global
notify_overdue_push            boolean NULL
notify_low_inventory_email     boolean NULL
notify_low_inventory_push      boolean NULL

-- Phase 2
notify_offset_minutes          integer NOT NULL DEFAULT 0
notify_repeat_every_minutes    integer NULL                    -- NULL = no repeat
notify_max_repeats             integer NOT NULL DEFAULT 3
```

Every default reproduces today's behaviour exactly, so the migration is a no-op for
existing rows and needs no backfill.

Escalation state is deliberately absent. See decision 4.

## Phase 1 — resolution and the SQL gate

`resolveChannels(medication, preferences)` returns the four effective booleans:

- `notificationsEnabled === false` → all four `false`, regardless of anything else.
- a non-null per-medication column wins.
- a null per-medication column falls through to the global preference.

It lives in `src/lib/server/` rather than in the route because coverage thresholds
only count `src/lib/**` (`vite.config.ts:29-34`); putting the logic in a route action
would put it outside the CI floor.

The sweeps' WHERE clause changes from an account-level OR
(`reminders.ts:55-60`) to a coalesce over the join:

```sql
AND m.notifications_enabled = true
AND ( coalesce(m.notify_overdue_email, p.overdue_email_reminders)
   OR coalesce(m.notify_overdue_push,  p.overdue_push_reminders) )
```

This is safe **because** it coalesces to the parent value. A naive
`m.notify_overdue_email = true` would evaluate false for every medication that has no
override and drop them all — the same class of bug as a child predicate in the WHERE
of a LEFT JOIN. Since the columns sit on the already-INNER-JOINed `medications`, there
is no null-row case at all, which is the second reason decision 1 went the way it did.

The per-channel gates inside the loops (`reminders.ts:117-118`, `:196-198`) take their
values from `resolveChannels` instead of the raw preference columns. The
`ChannelIntent` contract passed to `withReminderClaim` is unchanged — this alters
_which_ rows are claimed and _what_ the intent says, not the dispatch shape.

## Phase 2 — the bounded nag ordinal

### The stop signal already exists

`computeOverdueSlot` returns `null` once a `taken` or `skipped` dose lands, because the
last-event anchor counts both (`reminders.ts:77-89`, established by #111). So
"repeat until I log a dose or skip it for that day" needs no new acknowledgement
concept — when the user acts, no key is minted and the series ends. `missed` is
deliberately excluded: it records that a dose was not consumed, so the slot is still
outstanding.

Stopping on "I dismissed the notification" is **not achievable** and is out of scope.
Only test pushes post back to the server; real reminders have no delivery-side signal.

### This feature is a controlled version of a production outage

#110 was reverted by #112 because reminders repeated indefinitely. Its own post-mortem:

> `isOutstanding` returns the most recent _elapsed_ occurrence, which advances by one
> interval every interval [...] The slot is part of the dedupe key, so the key churns
> and `claimReminderSlot` never suppresses the repeat. One reminder per interval,
> forever, where the old behaviour was one reminder then silence.

Deliberately re-notifying means deliberately building the machine that broke. The
difference must be structural, not careful:

```
slot = computeOverdueSlot(row, now)              // unchanged; a FIXED instant
if (!slot) return null

firstNagAt = slot + offsetMinutes * 60_000
if (now < firstNagAt) return null

nagIndex = repeatEveryMinutes == null
  ? 0
  : min( floor((now - firstNagAt) / (repeatEveryMinutes * 60_000)), maxRepeats )

key = <existing key>  +  (nagIndex > 0 ? `:n${nagIndex}` : "")
```

Four properties, each answering one of #110's blockers:

1. **The slot stays fixed.** #110's slot advanced every interval. Here
   `computeOverdueSlot` is untouched and keeps returning the same instant; only the
   appended ordinal moves.
2. **The ordinal is bounded.** `maxRepeats` makes the key space per slot finite
   (`N+1` keys). #110's was unbounded — that is the whole difference between this
   feature and that outage.
3. **It is derived, not counted.** No escalation counter, no compare-and-set, no state
   table. Computing it is O(1); #110's fourth blocker was an interval loop allocating
   ~390k Dates per row.
4. **`nagIndex === 0` reproduces today's key byte-for-byte.** With
   `repeatEveryMinutes` null — the default for every existing medication — the key
   format, and therefore every existing dedupe test, is unchanged.

Note that the key is built from `slot`, **not** `firstNagAt`. Editing a medication's
offset therefore does not churn the key space for a slot already in flight; it shifts
when the series starts, not which keys it occupies. Given that key churn is the exact
failure mode this design is defending against, that separation is deliberate.

### Why it clamps rather than cuts off (decision 5)

A hard `nagIndex > maxRepeats → null` would **lose reminders that fire today**.
Consider a 22:00 slot with the overnight blackout: by the 06:00 tick, eight hours have
elapsed, so at a 30-minute cadence the raw index is 16. Cutting off returns null and
the user gets _no_ reminder for a dose they never took — strictly worse than current
behaviour, which reminds them once.

Clamping makes the index saturate at `maxRepeats`. The final key is claimed once,
sent once, and suppressed on every subsequent tick. Two consequences worth stating:

- No reminder is ever lost to the cap.
- A gap in ticks **skips nag windows rather than firing a burst** — the user gets one
  reminder on the tick after the gap, not one per window they missed.

### Interaction with the retry machinery

Each nag is its own `reminder_events` row, so `RETRY_DELAY_MS` (30 min) and
`MAX_ATTEMPTS` (3) keep meaning exactly what they mean today — _retry a failed send_ —
and never gate the nag cadence.

This matters more than it looks. Those constants do double duty as the stale-`pending`
lease-recovery threshold (`dispatch.ts:85-89`). A design that reused `attemptCount` as
the escalation counter would conflate "this send failed" with "time to nag again", and
a nag interval shorter than the lease timeout would let an in-flight dispatch be
reclaimed as abandoned. Keeping the two orthogonal is why the ordinal goes in the key
rather than in the row.

### Bounds

`z.coerce.number().positive()` has no lower bound. A `repeatEveryMinutes` of `0.001`
produces an astronomical index, which is the same class of bug as #110's blocker (4).
The schema takes an explicit integer floor of 1 and a ceiling; `MAX_INTERVAL_HOURS`
is a per-dose cap and is the wrong bound to reuse. `maxRepeats` is likewise bounded.

`offsetMinutes` is bounded at **zero or greater**, and the reason is structural rather
than a policy choice. `computeOverdueSlot` only returns a slot that has _already
elapsed_, so at the moment a slot becomes visible to the sweep it is by definition in
the past. A negative offset — "remind me 15 minutes before the dose" — could never
fire early; it would simply make the first nag land sooner after the fact. Accepting
one would be accepting a setting that silently does not mean what it says.

Note also the existing `z.coerce.number()` blank-string-to-0 trap that already
mis-stores `inventoryAlertThreshold`: any new numeric field needs the explicit
`"" -> undefined` transform that `scheduleIntervalHours` has (`validation.ts:43-48`).

### Push tag

Each nag reuses `overdueTag(medicationId)`. Because tags are a replace-key, that means
the tray holds one entry per medication rather than N — and that each nag silently
erases the previous one. That is the intended behaviour, but CLAUDE.md is explicit
that tag semantics are a decision rather than a detail, so it gets a named test.

Re-alerting a replaced notification requires `renotify: true`, a new `PushPayload`
field. The wire format is frozen against _renames_, not additions, so this is
permitted; service workers predating the deploy ignore it and simply do not re-alert.
`toNotification` is extended to pass it through.

### Retention

A slot can now produce up to `maxRepeats + 1` rows instead of one. The cron already
prunes expired password-reset tokens and rate limits; it gains a `reminder_events`
purge on the same pass.

## UI

A seventh child under `src/lib/components/medication-form/`, rendered in
`MedicationForm.svelte` between the schedule block (ends `:173`) and inventory
(`:175`) — timing configuration belongs next to timing configuration, and above
`MedicalDisclaimer`.

Two constraints from the existing form:

- `Object.fromEntries(request.formData())` keeps only the **last** value for a repeated
  field name, so the settings serialize into one hidden JSON input following the
  `schedules` idiom (`MedicationForm.svelte:171`).
- State derivation belongs in `medication-form-state.ts` beside `deriveInitialMode`,
  and must round-trip through `formValues` — otherwise a failed submit silently
  discards the user's input, which is the fixed-times bug repeating.

Elsewhere: a "notifications off" badge on `MedicationCard.svelte` (badge slot at
`:62-76`), and a read-only per-medication summary on `settings/notifications` so the
global page stops implying it is the whole story.

**Correction (implementation):** the settings use plain named form fields, not a
hidden JSON input. The reasoning above about `Object.fromEntries` keeping only the
last value for a repeated field name doesn't apply here: `schedules` needs JSON
because one medication has _many_ schedule rows sharing one field name, whereas these
five settings are uniquely named scalars on a form that edits exactly one medication —
nothing repeats, so nothing collapses. The JSON idiom would only earn its keep if
these moved to a page editing several medications at once.

**Correction (implementation):** the kill switch needs a hidden companion input.
`notificationsEnabled` is a real boolean whose absence must mean _enabled_ — an
`/api/v1` client that omits the field must not silently mute the medication. But an
unchecked HTML checkbox submits nothing at all, so with absence meaning enabled the
control could never be switched off from the web form. The form works around this by
rendering `<input type="hidden" name="notificationsEnabled" value="off">` immediately
**before** the checkbox, relying on the same last-value-wins behaviour cited above:
checked, the checkbox's `"on"` overwrites the hidden field's `"off"`; unchecked,
nothing overwrites it and `"off"` stands. The DOM order is load-bearing.

**Correction (implementation):** the `/api/v1` write door accepts the read window's
shape, not just the form's. `serializeMedication` emits `true | false | null` for the
four override columns and `null` for an unconfigured `notifyRepeatEveryMinutes`, while
the form submits `"inherit" | "on" | "off"` and minute strings. Zod's `.default()`
only substitutes for `undefined`, never for `null`, so the write schemas were widened
to accept both representations, with `null` and omission meaning "inherit" and "do not
repeat" respectively. Without this, a client that read a medication and wrote it
straight back — the most ordinary sync operation there is — would have its entire
upsert rejected.

## API, sync, export, import

- `upsertMedicationPayload` gains the fields, which carries them to `/api/v1` for free.
- `FullExport` re-lists fields by hand (`export.ts:8-17`), so it needs explicit
  additions — otherwise an export → import round trip loses per-medication settings
  **without failing**.
- Matching additions in `src/lib/server/import/types.ts`, the import Zod schema, and
  `api/serialize.ts`'s explicit parameter type.
- `docs/api-v1-contract.md` §3, §4 and §5 enumerate fields by hand and each needs an
  entry; the contract is the source of truth for the separate `medtracker-mac` repo.

## Testing

#112's post-mortem is the reason this section leads rather than trails:

> The tests that pinned the old contract were deleted, then the behaviour they
> protected was changed. 753 green tests proved nothing.

**Contract tests for current behaviour land first** — including the assertions #112
records as deleted, which its "what happens next" section says the redo must restore
before the module is touched again. Every new test must be shown failing against
unmodified production code before the corresponding line is written.

Split by the repo's existing rule — the fake unless the _database_ decides:

- **Pure / `fake-db`:** nag-index arithmetic, the clamp at `maxRepeats`, the
  `nagIndex === 0` key-identity property, resolution precedence (per-med off + global
  on; per-med on + global off; NULL inherits; kill switch overrides all four).
- **PGlite (`tests/unit/pg/`):** the coalesce gate, and `claimReminderSlot`'s
  `setWhere` across consecutive nag keys — both are decided by SQL.

`pg-db.ts` needs a `seedPreferences` fixture. The overdue query INNER JOINs
`user_preferences` (`reminders.ts:52`), so a PGlite reminder test without a
preferences row returns zero rows and **passes vacuously**.

`tests/unit/reminders.test.ts` keeps a deliberate bespoke fake that asserts on
`whereArgsByCall[1]`. Adding columns to the existing join survives that; adding a
separate `db.select()` would delete the ordering assertion while leaving the suite
green. Its fixtures and its five-field `UpdateCapture` type both need widening.

Also mechanical: `notificationSchema` has no tests at all, so the per-medication
schema gets the first ones.

## Out of scope

- **Quiet hours.** The GitHub Actions blackout (23:00–05:59 UTC) provides them today
  by accident. It is timezone-naive and would need to become explicit if the driver
  ever changes. Recorded as a known limitation, not solved here.
- **Repeat for low inventory.** Its dedupe key includes the count, so it self-heals;
  the request was about doses.
- **Reminders for PRN medications.** They are excluded from the overdue sweep
  (`ne(scheduleKind, "prn")`, `reminders.ts:56`) and decision 3 keeps them there.
- **Dismiss-to-stop.** No delivery-side signal exists.
- **Pre-dose reminders ("remind me 15 minutes before").** The sweep is elapsed-only, so
  this needs a forward-looking due-ness path rather than an offset — a genuinely
  different feature, and the one whose rewrite #110 came to grief on.
- **Per-medication "send test push".** The existing test button is account-wide.
- **A faster scheduler tick.** Decided against above; the schema does not foreclose it.

## Docs to update

`docs/api-v1-contract.md`, ADR 0005 (already stale on the key format — the correction
was lost in the #112 revert), `docs/database.md` (`:92` phantom "reminder cadence",
`:114` wrong key and a "can't fire twice" claim this feature makes false),
`docs/architecture.md` (`:51` names a single cron participant, `:60` describes a
`status='claimed'` / `ON CONFLICT DO NOTHING` scheme that no longer exists), the README
feature table, and CHANGELOG, which has recorded nothing about reminders since #69.
