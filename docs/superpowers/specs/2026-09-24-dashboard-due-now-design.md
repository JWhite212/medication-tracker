# Dashboard "Due Now" Rebuild — Design

The dashboard's job is one question — _is anything due, and can I log it?_ — and today
it answers that question last. A live review of production on 2026-09-24 found the page
ordered as a report (count strip, refills, a time-of-day schedule, a wall of coloured
pills, a log list), with the one action that matters rendered as a 37×20px text button.
Worse, that button frequently **does not work**: logging a fixed-time slot late records
a dose the matcher never connects to the slot, so the row stays overdue however many
doses are logged.

This spec rebuilds the page around what is due, and changes the slot matcher so that a
late dose resolves the slot it was for. It deliberately does **not** implement the
[due-ness unification](2026-08-13-due-ness-unification-design.md); it lands a few of
that spec's pieces early and says exactly which.

## What is broken, with evidence

Observed on a live account (fixed-time slots 08:55, 09:00 and 11:00 for one
medication; several daily supplements):

1. **Late logging does not resolve a fixed-time slot.** `computeScheduleSlots` matches a
   dose to a slot only within a _symmetric_ ±1h (`MATCH_TOLERANCE_MS`,
   `utils/schedule.ts:30`). Tapping _Log_ on the 09:00 row at 13:30 writes a 13:30 dose
   that is 4.5h from every slot. Live: all three morning slots still showed overdue, each
   with a _Log_ button, after doses of ×4 at 13:31 and ×3 at 21:48. The reminder cron
   applies the opposite rule — "a dose at or after the slot satisfies it however late"
   (`reminders/domain.ts:73-78`) — so the two surfaces already disagree. Interval slots
   do not have this bug: they re-anchor on the last taken dose.
2. **The page does not lead with what is due.** Top to bottom: `<h1>Dashboard`,
   `SummaryStrip`, `RefillsCard`, `MyDayTimeline`, `QuickLogBar`, then a "Today" list
   (`dashboard/+page.svelte:48-138`). Refills — days away — sit above today's doses.
3. **"Overdue" is stated four times** — the summary chip, My Day's marker, a Quick Log
   caption and the Today list — from **two independent models**: per-slot
   `scheduleSlots` and a per-medication `timingStatus` built on the deprecated interval
   columns plus a `covered` merge (`+page.server.ts:39-90`).
4. **"Overdue 504h 20m."** `formatDueIn` has no day unit (`utils/time.ts:606`), and the
   per-medication `timingStatus` grows without bound for a medication last taken three
   weeks ago.
5. **The rows that need action are the faintest on the page.** The Today list renders
   overdue medications at `opacity-60` with a dashed border and offers only **Skip**
   (`+page.svelte:73,96-118`).
6. **The primary action is the smallest target**: My Day's _Log_ measured 37×20px.
7. **Quick Log is the loudest element and the least safe.** Full-colour gradient, striped
   and two-tone pills put text across colour boundaries (a name split across a purple
   and white half; text on stripes), and `opacity-70` on the dose and ± controls undoes
   `getReadableTextColor`'s worst-case contrast solution. The quantity persists after a
   successful log (live: a pill still read "3×" after a ×3 log), and no log button has a
   pending state, so a double tap logs twice.
8. **A 00:13 slot renders last**, under "Night" (`classifyHour` puts 00–04 in night).

## Decisions

Made with the user on 2026-09-24. Each is a constraint on everything below.

| #   | Decision                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Rebuild the UI on the **existing per-slot model** and change only slot matching. The dashboard stops using per-medication `timingStatus`. The due-ness unification (`due.ts`) stays a separate project.                   |
| D2  | An unresolved slot from before local midnight stays visible under **"Earlier"** until it is logged or skipped, or becomes **12 hours** old. Nothing older is shown.                                                       |
| D3  | **Log now** records the current time. Overdue rows also offer **"Took it at HH:MM"**, which records the slot's own time.                                                                                                  |
| D4  | Resolution approach **A** — no schema change. Keep today's ±1h pass; add a late-resolution pass; anchor every button to the row it sits on.                                                                               |
| D5  | Quick Log moves below the timeline as **"Log something else"**, restyled as neutral chips with a capsule glyph; captions removed; quantity resets after a log.                                                            |
| D6  | Layout: **Due-first** (Section 1 below), including its grafted safety mechanics.                                                                                                                                          |
| D7  | **Pass 0**: a taken dose recorded at exactly a slot's instant resolves that slot. A skip recorded at exactly a slot's instant can resolve only that slot, and — as today — a real taken dose within ±1h still beats it.   |
| D8  | **One-hour Log-now cooldown**: a medication with a taken dose in the last hour shows no Log now (Took it at and Skip remain).                                                                                             |
| D9  | The reminder cron stops reminding about a **pre-midnight fixed-time slot once it is 12 hours old** — the instant the dashboard hides it — in this change.                                                                 |
| D10 | An expired Earlier slot leaves **no per-dose record**. History lists only `dose_logs` rows, and nothing but import writes `missed`. No UI copy may claim otherwise. A slot-derived Missed view in History is a follow-up. |

Refinements that came out of adversarial review and were approved with the section they
belong to:

- **Log now is placed by simulation, not by "latest outstanding".** D4 originally put
  Log now on each medication's latest outstanding slot on the premise that pass 2 would
  always pick it. It does not: pass 1 takes a dose logged now first when a slot is due
  within the hour or a second outstanding slot lies within the past hour, and on a
  medication with an interval schedule a new dose re-anchors the projection. The
  button now goes wherever a dose logged now would actually land.
- **Lifecycle clip**: slots outside a medication's `startedAt`/`endedAt` are dropped, so
  a medication created at 14:00 no longer shows a phantom 08:00 slot (approved with
  Section 2).
- **The dashboard and Analytics will disagree more, deliberately.** See
  [Accepted divergence](#accepted-divergence-from-analytics).

## Section 1 — Layout

One column, `max-w-2xl`, ordered by what the user has to do.

1. **Header** (`DashboardHeader`) — replaces `<h1>Dashboard</h1>` and `SummaryStrip`.
2. **Due** — one card per medication **per sub-group** with an outstanding row. An
   **Earlier** sub-group (visible `h3`, only when present) comes first; the **Today**
   sub-group gets a visible `h3` only when Earlier is also shown.
3. **Done today** — one row per dose event.
4. **Later today** — read-only lines for today's slots more than an hour ahead.
5. **Log something else** — neutral chips in the user's `sortOrder`.
6. **Refills** — `RefillsCard`, unchanged, last.
7. Overlays, not in flow: the existing `Modal` (with `DoseEditForm` and a separate
   _Remove this dose_ form) and the single layout-mounted `Toast`.

Header, Done, Log something else and Refills always render; Due and Later render only
when they have rows.

For an account where **no active medication has an interval or fixed-time schedule
row** (as-needed only), the chips move directly under the header, retitled **"Log a
dose"**, and Done is retitled **"Logged today"**. There is no Due or Later section.

There are **no time-of-day groups and no emoji headings**. The page is grouped by action,
so a 00:13 slot is simply the earliest instant of its day (problem 8).

### Header

- Eyebrow `<p class="text-sm text-text-secondary">`:
  `formatUserDate(serverNow, tz, dateFormat, { weekday: true, year: false })` — "Thu
  24 Sept".
- `<h1 id="dashboard-heading" tabindex="-1" class="text-2xl font-bold">Today</h1>` — a
  stable heading. `<title>` stays "Dashboard — MedTracker" to match the nav.
- Status sentence `<p class="text-lg font-semibold">` and supporting line
  `<p class="text-sm text-text-secondary">`, both produced by the pure
  `dashboardHeaderCopy(status, serverNow, tz, timeFormat)` (`utils/dashboard-copy.ts`).
  First matching `kind` wins; the predicates are exact:

| `kind`           | Predicate                                                                                    | Status sentence                                                                | Supporting line                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `as-needed-only` | no active medication has an interval or fixed-time schedule row                              | "2 doses logged today" / "No doses logged yet today"                           | "Tap a medication below to log a dose."                                                                                       |
| `due`            | Due has at least one row                                                                     | "5 doses due" / "1 dose due" (every Due row, Earlier and nested rows included) | "2 of 7 done today" (today's visible slots resolved; Earlier excluded; omitted while 0)                                       |
| `caught-up`      | Due is empty and at least one of today's slots is unresolved with `expectedTime > serverNow` | "All caught up"                                                                | "Next: Lisinopril 10mg at 20:00 · in 3 hours"; several at one time → "Next: Lisinopril 10mg and 2 more at 20:00 · in 3 hours" |
| `all-done`       | Due is empty, today has at least one visible slot, and every one is resolved                 | "All done for today"                                                           | "7 of 7 done today"                                                                                                           |
| `none-today`     | none of the above                                                                            | "Nothing scheduled today"                                                      | "2 doses logged today" (omitted at 0)                                                                                         |

This is the **only** place a count appears. The word "overdue" appears in no visible
copy; it survives only as `StatusMarker`'s accessible name. The header is not a live
region.

### Due cards

`<li tabindex="-1" aria-labelledby={nameId} class="rounded-xl border bg-glass p-3">` in a
`<ul role="list">`, keyed by `DueCard.key` = `${subGroup}:${medicationId}`. Border
`border-warning/50` when the top row is overdue or earlier, `border-accent-ink/50` when
it is due now. No dashed border, no opacity, no tint.

- **Tier 1**: a 28px left column with `MedicationGlyph` (28×14 capsule,
  `getMedicationBackground(c1, c2, pattern, true)`, `ring-1 ring-border-strong`,
  `aria-hidden`) above `StatusMarker`; a text column with name
  (`text-base font-semibold`) + dose (`text-sm text-text-secondary`, truncating) and a
  status line; a right column holding **Log now** when the row is the Log-now target.
- **Tier 2**, under the text column and away from the Log now column: **Took it at
  HH:MM**, then **Skip**. A thumb slipping off Log now does not land on Skip. At 12h
  time a long label wraps Skip to its own line rather than shrinking a target.
- The card's top row is its Log-now target when it has one, otherwise its latest
  outstanding row. Other outstanding rows of the same medication nest below a
  `border-glass-border` hairline, latest first; name and glyph are not repeated.
- Cards are ordered by top-row `expectedTime`, then `sortOrder`. A medication can have a
  card in each sub-group. A row whose simulations prove no button still renders, with
  its status line and no buttons (see [Which buttons a row
  offers](#which-buttons-a-row-offers)).

Row states and their status copy (durations per [Durations](#durations)):

| State   | When                                               | Status line                           | Marker                         |
| ------- | -------------------------------------------------- | ------------------------------------- | ------------------------------ |
| earlier | unresolved, before today's midnight, under 12h old | "Due yesterday 22:00 · 9 hours ago"   | amber `!` (`overdue`)          |
| overdue | unresolved, today, more than 1h past               | "Due 11:00 · 2 hours ago"             | amber `!` (`overdue`)          |
| due-now | unresolved, within ±1h of now                      | "Due 13:45 · in 15 minutes" / "· now" | accent dot-in-ring (`due-now`) |

Which of **Log now**, **Took it at** and **Skip** a row shows is decided only by
[simulation](#which-buttons-a-row-offers). The one presentation rule on top: _Took it at_
is not shown on a due-now row that also shows Log now, because both resolve the same row.

Button recipes (fixed heights, so `data-density="compact"` — which rewrites only `.p-5`,
`.p-6` and `.py-2.5` — cannot shrink them):

- **Log now** — `h-12 min-w-26 rounded-lg bg-accent text-accent-fg text-base
font-semibold`. The only filled button on the page.
- **Took it at HH:MM** — `h-11 px-3 rounded-lg border border-border-strong text-sm
font-medium text-text-primary hover:bg-surface-overlay`.
- **Skip** — `h-11 min-w-11 px-3 rounded-lg text-sm font-medium text-text-secondary
hover:bg-surface-overlay`.

### Done today

One `bg-glass` card, rows as `<li class="flex min-h-11 items-center gap-3">` separated by
hairlines, ascending by `takenAt`. Left to right: time (`w-14 tabular-nums`, prefixed
"Yesterday" for a row with a `dayLabel`), `StatusMarker`, `MedicationGlyph sm`, name +
dose + "×n" when quantity > 1, a **covers** line, and a trailing button. When empty the
section keeps its `h2` and shows "Nothing logged yet today", so it is always a valid
focus target.

- **Which rows**: doses with `todayStart ≤ takenAt < end`, **plus** doses with
  `loggedAt ≥ todayStart` and `takenAt < todayStart` — a backdated "Took it at" on an
  Earlier row — which carry `dayLabel` so they can be seen and undone.
- **Covers**: the slot instants this dose resolved — slots whose `resolvedByDoseId` is
  this dose, among today's and Earlier slots (never tomorrow's first hour) — keeping only
  those whose minute differs from its own `takenAt`. A covered slot before today's
  midnight is prefixed "yesterday". "13:31 ✓ Metformin 500mg ×4 · for 08:55, 09:00,
  11:00". Facts only, no verdict.
- **Taken rows** → an **Edit** button (`h-11 px-3 rounded-lg border
border-border-strong`) opening the existing Modal: unchanged `DoseEditForm`, plus a
  separate `<form action="?/deleteDose">` with **Remove this dose** (`min-h-11`,
  `text-danger-ink`). This applies to every taken dose, whether or not it resolved a
  slot. No hover-revealed controls.
- **Skipped rows** → a neutral marker (dash in a `border-strong` ring,
  `text-text-secondary`; a skip is a decision, not a problem), the word "Skipped", and an
  **Undo skip** button that posts `?/deleteDose`. A `missed` row (only import writes one)
  renders the same with "Missed".

### Later today

One `bg-glass` card of 40px read-only lines: time, hollow `StatusMarker`,
`MedicationGlyph sm`, name + dose, and "in 3 hours" on the right. Not focusable, no
actions. A dose taken **within an hour** of its slot resolves it (pass 1). A dose taken
**more than an hour early** does not — forward matching is out of scope — so the slot
still comes due and is shown in Due at its time; its Done entry shows the early dose,
and _Skip_ dismisses the slot.

### Log something else

Chips `h-11 rounded-full border border-border-strong bg-glass text-text-primary`:
`MedicationGlyph sm`, name + dose, "×n" when above 1, and fixed 44px **−** (rendered
always, `aria-disabled` at 1, so the log segment never shifts under the thumb) and
**+** segments. Medication colours never sit behind text again. Quantity resets to 1
after a successful log and is kept after a failure. The chips are never described as
"extra": with pass 2 a chip log of a scheduled medication often resolves a slot, and
the toast says which.

### Feedback, focus and freshness

- **`DoseActionForm`** is the one `use:enhance` implementation for every **log, skip,
  undo and remove** on the page (Due buttons, chips, Undo skip, Remove this dose). It
  owns everything below. The Modal's **edit** stays on `DoseEditForm`'s own enhance
  (the component is shared with `/log` and unchanged); while the Modal is open its focus
  trap keeps the page's other controls unreachable.
- **Pending**: the pressed button keeps its width and shows a 16px spinner plus
  "Logging…" / "Recording…" / "Skipping…" / "Removing…"; its card gets `aria-busy`.
- **Page-wide lock**: `+page.svelte` sets a context
  `DOSE_WRITE_LOCK = createDoseWriteLock({ cooldownMs: DOSE_WRITE_COOLDOWN_MS })`
  (`DOSE_WRITE_COOLDOWN_MS = 700`, exported for tests) with `busy` (`$state`),
  `acquire(): boolean` and `release(): void`. `release()` starts the cooldown; `busy`
  stays true until it ends. While `busy`, every dose-writing control is `aria-disabled`
  and the enhance `submit` calls `cancel()` when `acquire()` fails. Never the `disabled`
  attribute, which drops focus to `<body>`.
- **Success**: `await update()`, then build the toast **from the reloaded data** using
  the returned `doseId`, so it states what the matcher actually did. Times not on today's
  civil day are prefixed "yesterday":
  - Log now / chip: "Metformin 500mg logged at 13:31 — counted for your 08:55, 09:00 and
    11:00 doses · Undo" (no "counted for" clause when it covered nothing).
  - Took it at: "Metformin 500mg recorded as taken at yesterday 22:00 · Undo".
  - Skip: "Metformin 500mg: 11:00 dose skipped · Undo".
  - If the reload fails, fall back to "Metformin 500mg logged at 13:31 · Undo".
  - **Undo** posts to the absolute action `/dashboard?/deleteDose` (fetch +
    `deserialize`, then `invalidateAll()`), because the layout-mounted Toast outlives
    navigation. `deleteDose` restores exactly `inventoryApplied`. This is the first caller
    of `Toast`'s existing `undoAction`.
- **Failure**: `'failure'` → `actionErrorMessage(result)` toast; a **409** additionally
  runs `invalidateAll()` before `release()`, because `update()` does not re-run the
  load for a failure and the button that failed is stale; other failures run `update()`
  and release. A chip keeps its quantity. `'error'` (outcome unknown) → toast, then
  `invalidateAll()` **before** `release()`, so any retry acts on fresh data.
- **Focus** after a row resolves: the same card's `<li>` if it survives, else the next
  card's `<li>`, else the `h1`. Never another write button — a repeated Enter must not
  log a different medication. After Remove or Undo skip: the "Done today" `h2`
  (`tabindex="-1"`, always rendered). Chip logs keep focus on the chip.
- **All client time is server-relative.** When `data` arrives, record
  `skewMs = Date.parse(data.now) − Date.now()` and use `serverNow() = Date.now() + skewMs`
  everywhere. The page arms one `setTimeout(invalidateAll)` with delay
  `Date.parse(data.nextRefreshAt) − serverNow()`, calls `invalidateAll()` on
  `visibilitychange` when `serverNow() ≥ nextRefreshAt`, and renders visible durations
  from a `serverNow()` tick every 60s (the `TimeSince` pattern). Never compare a payload
  instant with raw `Date.now()`: a client clock minutes fast would otherwise reload in a
  loop and refuse every tap near a boundary. Status, rows and buttons change only through
  the load.
- **Stale guard (client)**: a submit when `serverNow() ≥ nextRefreshAt` is cancelled,
  the page reloads, and the toast reads "The list just updated — check it and tap
  again". The server check on Log now (below) is the authority; this saves a round trip.
- **Keyboard shortcuts 1–9** select `form[data-quick-log]` only (the chips), so a key can
  never submit a backdated _Took it at_. They pass through the same lock.

### Accessibility

- Headings: `h1` Today; `h2` "Due" (`sr-only`) › `h3` Earlier / Today; `h2` Done today,
  Later today, Log something else; the existing Refills heading. Each region is a
  `<section aria-labelledby>`. Lists are `<ul role="list">` (survives Tailwind's list
  reset in Safari).
- **Status never relies on colour**: visible text ("Due 11:00 · 2 hours ago",
  "Skipped"), a distinct marker shape, then colour as reinforcement. `StatusMarker`
  keeps `role="img"` + `aria-label` — the Lighthouse `aria-prohibited-attr` fix now pinned
  by `my-day-timeline-ssr.test.ts`, which moves to `status-marker-ssr.test.ts` with the
  same assertions. Recipes (20px circle, 12px glyph):

| State      | Classes                                                 | Glyph       | `aria-label` |
| ---------- | ------------------------------------------------------- | ----------- | ------------ |
| `taken`    | `bg-success/20 text-success`                            | check       | Taken        |
| `overdue`  | `bg-warning/20 text-warning`                            | `!`         | Overdue      |
| `due-now`  | `ring-2 ring-accent-ink`, inner 8px `bg-accent-ink` dot | dot-in-ring | Due now      |
| `upcoming` | `border border-border-strong`                           | hollow ring | Upcoming     |
| `skipped`  | `border border-border-strong text-text-secondary`       | dash        | Skipped      |
| `missed`   | `border border-border-strong text-text-secondary`       | dash        | Missed       |

- **Names put the visible label first** (WCAG 2.5.3) with `sr-only` context after:
  "Log now: Metformin 500mg, 11:00 dose"; "Took it at 11:00: Metformin 500mg"; "Skip:
  Metformin 500mg, 11:00 dose"; "Edit: Metformin 500mg dose taken at 13:31". Chips:
  `<span class="sr-only">Log </span>Ibuprofen 200mg ×2`; the old `aria-label` that hid
  the visible label is dropped. Steppers keep "Decrease/Increase quantity for …".
- **Targets**: Log now 48×104px minimum; every other dose control, chip segment and the
  Toast's Undo at least 44×44px.
- **Live regions**: only the existing polite Toast.
- **Contrast**: only `accent`/`accent-fg` is a fill pair; control boundaries are
  `border-strong`; `glass-border` is hairlines only. The tinted markers (`success/20`,
  `warning/20`) sit on a `bg-glass` card over the page; those pairs replace
  `theme-tokens.test.ts`'s two "timeline status glyph" rows (which read their backdrop off
  the deleted `MyDayTimeline`).
- **Time limits (2.2.1)**: the Toast's hover/focus hold stays; Edit → Remove and Undo
  skip are untimed alternatives to the toast's Undo.

### Empty and edge states

- **Onboarding** (no active medications): `OnboardingWelcome` as today; step-2 copy
  becomes "Due — one tap to log what's due", "Done today — everything you've logged",
  "Refills — know when to reorder".
- **All done**: header, Done, chips, Refills; no Due, no Later.
- **Caught up with slots ahead**: header with its "Next:" line, Done, Later, chips,
  Refills.
- **Many medications**: no batch action, no collapse. Cards take their natural height;
  chips wrap.
- The dashboard stops using `EmptyState`; `/log` and `/medications` keep it.

## Section 2 — Matching

### The window

`dashboardWindow(now, tz)` in `utils/schedule.ts` owns every bound. The load, the Log-now
server check and `checkSlotActionTime` all call it.

```
todayKey      = isoDayKey(now, tz)
todayStart    = startOfDay(now, tz)
end           = endOfDay(now, tz)                                          // exclusive
projectStart  = wallClockToInstant(shiftDayKey(todayKey, -1), "00:00", tz) // yesterday's midnight
projectEnd    = end + MATCH_TOLERANCE_MS                                   // tomorrow's first hour
visibleStart  = max(projectStart, min(todayStart, now - CARRY_OVER_MS + 1ms))
doseFetchFrom = projectStart - MATCH_TOLERANCE_MS
doseFetchTo   = end + 2 * MATCH_TOLERANCE_MS
```

- `projectStart` walks the day key. `todayStart - 24h` is wrong twice a year in every DST
  zone (London 2026-10-26 would give 01:00 BST on the 25th).
- **Tomorrow's first hour is matched, never shown, counted or targeted.** Without it,
  pass 1 at tomorrow's view could take a dose that pass 2 gave to one of today's slots at
  today's view, and that row reappeared as overdue at midnight. With it, today's view
  already makes the choice tomorrow's will make.
- `visibleStart` is the first millisecond under 12h old: a slot at exactly `now − 12h` is
  hidden, one at `now − 12h + 1ms` is shown. The 12h bound applies to **Earlier rows
  only**; today's rows stay visible until midnight, as today.
- Three segments, compared by instant, never by day key: yesterday
  `[projectStart, todayStart)`, today `[todayStart, end)`, tomorrow's first hour
  `[end, projectEnd)`.
- `CARRY_OVER_MS = 12h` is new and exported beside `MATCH_TOLERANCE_MS` (now exported;
  value unchanged). One `now` per request.

**Doses** come from `getDosesInRange(userId, doseFetchFrom, doseFetchTo)`
(`takenAt ≥ from AND takenAt < to`, user-scoped, same select and join as the old
`getTodaysDoses`). The −1h is pass 1's reach before the first projected slot; the +2h is
its reach past the last tomorrow's-first-hour slot.

### Projection

Per kind as today, with these window-driven rules:

- **Fixed-time instants are generated once over `[projectStart, projectEnd)`**, for every
  day key that range touches, with day-of-week read off the key (never the instant), and
  each instant is then assigned to the segment that contains it. Godthab's Saturday 23:30
  (01:30Z Sunday) is therefore a tomorrow's-first-hour slot at Saturday's view and a
  today slot at Sunday's.
- **Interval rows anchor on `lastTakenAt`** (all-time max `takenAt` of taken rows; skips
  never anchor), exactly as today. Every taken dose re-anchors; interval points before it
  stop existing.
- **Never-taken interval medications** get a grid per segment, anchored at that
  segment's own local midnight. Today's grid is byte-identical to production; yesterday's
  rows are what yesterday's dashboard showed; nothing slides during the day. The due-ness
  spec's "never-handled begins at `startedAt`" anchor stays with `due.ts`.
- **Drifted-twin suppression is per segment**: an interval point is dropped only when a
  fixed slot in the _same_ segment is within ±1h. Cross-day suppression would delete
  today's 00:10 because of yesterday's 23:30.

**Lifecycle clip.** Every projected slot outside `[med.startedAt, med.endedAt]` is
dropped before matching. A medication created at 14:00 no longer shows a phantom 08:00
slot, and a new medication gets no Earlier rows. This matches Analytics (`isActiveOn`
gives a creation day no expected doses) and the due-ness spec's clip.

**Schedule-edit clip (Earlier rows only).** Every save deletes and re-inserts a
medication's schedule rows with `effectiveFrom = now` (`medications.ts:247-253`), and
`getSchedulesForUser` ignores effective dates, so the current rows say nothing about what
was scheduled before the save. A slot before `todayStart` is therefore dropped when
`expectedTime < min(effectiveFrom)` over that medication's rows. Without this, moving an
evening dose from 20:00 to 22:00 this morning would show "Due yesterday 22:00" with a Log
now button beside yesterday's 20:05 dose — an invitation to double-dose. Today's slots
are unaffected (production behaviour).

### Three passes

Per medication, slots deduplicated and ascending. `remaining(d)` starts at
`max(1, quantity)` for a taken dose and 1 for a skipped or missed one; one map is shared
by all three passes.

**Pass 0 — exact claims (taken only).** For each slot `t`, a taken dose with
`remaining > 0` and `takenAt === t` to the millisecond claims it; ties go to the smaller
id. Skips never claim in pass 0.

**Reserved skip.** A skipped dose whose `takenAt` equals one of that medication's
projected slot instants is that slot's own Skip. It is a candidate **only for that
slot**, in pass 1, at rank 1 — so a taken dose within tolerance still wins (D7) — and
never takes part in pass 2.

**Pass 1 — today's rule.** Today's loop body, over the slots **still unresolved after
pass 0**, ascending; candidates are doses with `remaining > 0` and
`|takenAt − t| ≤ MATCH_TOLERANCE_MS`; best by rank (taken 0, skipped/missed 1), then
distance, then smaller id. Two filters are added:

- **Segment limit**: `takenAt` must be before the end of `t`'s segment (`todayStart` for
  yesterday's slots, `end` for today's; none for tomorrow's first hour). With fixed 23:30
  and 00:13, yesterday's 23:30 unlogged and a dose at 00:10, today's 00:13 gets the dose,
  as production does.
- A reserved skip is a candidate only for its own slot.

A missed row goes to `missedByDoseId`; anything else to `resolvedByDoseId`.

**Pass 2 — late resolution.** Doses that are taken or skipped (never missed), not
reserved skips, have `remaining > 0` after passes 0–1, and have `takenAt ≤ now`. Process
them ascending by `(takenAt, id)` so events replay in time order and history is never
re-attributed. For each, walk the slots backwards from the last slot strictly before
`takenAt`, skipping resolved slots (a slot with only a missed row is eligible) and
stopping at the first slot before the pass-2 bound (`visibleStart` with a window;
`dayStart` without one), claiming while `remaining > 0`. Pass 2 never resolves a slot
after its dose.

Skips not on a slot instant (legacy skip-at-now rows, `/api/v1 skip_dose`, the Mac app)
take part in passes 1 and 2 like any skip, so their leftover capacity can now resolve an
earlier outstanding slot — the intent of a skip recorded late.

Worked cases:

- Slots 08:55, 09:00, 11:00; ×4 at 13:31 and ×3 at 21:48 → all three resolved by the
  13:31 dose (Done: "· for 08:55, 09:00, 11:00"); 21:48 covers nothing.
- Slots 14:00 and 20:00; dose at 20:30 → pass 1 gives 20:00; 14:00 stays overdue.
- "Took it at 09:00" beside an open 08:55 → pass 0 gives 09:00 to it; 08:55 stays
  overdue. Without pass 0, pass 1's ascending greed hands it to 08:55.

### Status

- Resolved by any pass → `taken` or `skipped` from the resolving dose.
- Otherwise `overdue` if `expectedTime ≤ now`, else `upcoming` — **including** slots
  matched only to a missed row. A future slot no longer reads overdue because of a missed
  row (it previously offered buttons that could only fail).
- `matchedDoseId = resolvedByDoseId ?? missedByDoseId ?? null` (kept for existing
  readers); `resolvedByDoseId` is what covers and toasts read.
- `isEarlier = expectedTime < todayStart`, by instant.
- **Visible** when `expectedTime < end` and either not earlier, or overdue and
  `≥ visibleStart`. Earlier rows are never upcoming.

The dashboard's display states map from these: `earlier` = visible, earlier, overdue;
`overdue` = today, overdue, more than 1h past; `due-now` = today, unresolved,
`|t − now| ≤ MATCH_TOLERANCE_MS`; `upcoming` beyond that goes to Later.

### Which buttons a row offers

`slotActions` decides every button by **simulating its write** and re-running passes
0–2 for that medication with the same window and `now`. Every simulation that adds a
**taken** dose also re-projects that medication's interval rows with
`lastTakenAt' = max(lastTakenAt, probe.takenAt)` — what the next load will see — and
base and simulated slots are keyed by `expectedTime`.

- **Log now** — probe a taken ×1 dose at `now` (id sorting last so it never wins a tie).
  The target is the latest base slot that is visible, unresolved, `≤ now + 1h`, and in
  the simulation is either resolved by a taken dose or (interval slots only) no longer
  projected because the re-anchor superseded it. At most one per medication; never a
  hidden or tomorrow's-first-hour row.
- **Took it at** — probe a taken dose at exactly `expectedTime`; offered on any row with
  `expectedTime ≤ now` whose simulation resolves exactly this row (interval rows removed
  or re-timed by the re-anchor excepted). Hidden by presentation on a due-now row that
  also shows Log now.
- **Skip** — probe a skip at `min(expectedTime, now)`; offered when the simulation moves
  exactly this row to skipped. For a past slot that is a reserved skip; for a due-now
  slot still ahead it is a skip at `now`, which is within the hour — no dose row is ever
  future-dated. The load computes this instant once and ships it as `skipAt`; the client
  posts it verbatim.
- **Cooldown (D8)**: no Log now for a medication with a taken dose whose `takenAt` is in
  `(now − 1h, now]`.

A row whose simulations prove nothing shows its status line with no buttons. Two
expected cases: the hour after a slot is skipped at its instant, when a dose logged now
would still count for the skipped slot (taken beats skip) so the medication has no Log
now; and a due-now slot still ahead while an earlier outstanding slot of the same
medication lies within the hour, whose Skip-at-now and Log-now probes both land on the
earlier slot — its buttons appear once the earlier slot is handled or the refresh moves
the boundary.

Consequences the user will see, all intended: Log now can sit on a dose due within the
next hour; on a legacy medication mixing interval and fixed schedules it is often absent
from the fixed rows; Log now or Took it at on an interval row removes that row and every
earlier interval row from Due (they are superseded, not resolved) and re-times a
never-taken medication's grid, while the new dose appears in Done.

### Freshness

`nextRefreshAt` = the earliest instant after `now` among: `end`; `t − 1h`, `t` and
`t + 1h` for each visible slot; `t + 12h` for each Earlier slot; `t − 1h` for each
tomorrow's-first-hour slot; `takenAt + 1h` for each taken dose inside the cooldown;
any fetched `takenAt` later than `now`. Ties are irrelevant (one instant); the result
is clamped to at least `now + 5s`.

### Durations

One formatter replaces the missing day unit everywhere:
`formatDuration(ms, { style: 'short' | 'long' = 'short', maxUnits: 1 | 2 = 2 })` in
`utils/time.ts`.

- Uses `|ms|`, floors at every unit (lateness is never overstated), units m / h / d where
  1d = 24 elapsed hours, largest first, zero units dropped, minutes dropped once days
  appear. Under a minute: "<1m" / "less than a minute".
- Short: "45m", "2h 15m", "1d 1h", "21d". Long: "2 hours 15 minutes", "1 day 1 hour".
- **Dashboard copy** uses `{ style: 'long', maxUnits: 1 }`: "2 hours ago", "in 15
  minutes", "now" under a minute. "ago" versus "in" comes from the sign of
  `serverNow − expectedTime`, never from status.
- `formatDueIn` is rebuilt on `{ style: 'short', maxUnits: 2 }` and stays for the landing
  walkthrough. Its 11 existing assertions are unchanged; −504h20m now prints
  "Overdue 21d".

The window caps a visible age below about 25h, so "day" appears on the dashboard only in
the last hour of a 25-hour day; the unit exists so no future caller can print "504h".

### Server actions

**`logSkippedDose(userId, medicationId, takenAt?: Date, opts = {})`** inserts
`takenAt = takenAt ?? now`, `loggedAt = now`, quantity 1, status `skipped`, with the
audit row in the same transaction. With `opts.exactInstantGuard`, inside the
transaction: lock the medication row (`FOR UPDATE`); an existing skip at exactly
`takenAt` → return its id without inserting; an existing **taken** row there → throw
`SlotAlreadyTakenError`.

**`logDose(…, opts = {})`** — with `opts.exactInstantGuard`, the medication read that
already happens for `inventoryCount` becomes `FOR UPDATE`, and an existing **taken** row
at exactly `takenAt` is returned without inserting or decrementing inventory. An
existing skip there does not block the insert (taken beats skip; pass 0 then gives the
slot to the taken dose).

**`logDoseForSlot(userId, medicationId, forSlot: Date, now: Date)`** — Log now's write.
One transaction: lock the medication row (`FOR UPDATE`); read that medication's
schedules, doses in the window and `lastTakenAt` inside the transaction; recompute its
Log-now target with the same pure `slotActions`; if the target is missing or differs
from `forSlot`, throw `SlotTargetChangedError` and write nothing; otherwise insert the
taken ×1 dose at `now` exactly as `logDose` does (decrement, `inventoryApplied`, audit).
The row lock serialises concurrent Log-now posts for one medication — two devices, or a
retry after an `'error'` while the first request still runs — so the second sees the
first dose, finds the cooldown active, and gets a 409 instead of a second dose.

`SlotAlreadyTakenError` and `SlotTargetChangedError` are exported from `server/doses.ts`
beside `MedicationNotFoundError`. `/api/v1` calls none of the new parameters or
functions: the API, its tests and the Mac app are unchanged.

**Schemas** (`utils/validation.ts`):

- `doseSkipSchema = z.object({ medicationId: z.string().min(1), takenAt:
z.string().datetime().optional() })`. This also fixes today's `String(undefined)`,
  which answered 404 where it should answer 400.
- `doseLogSchema` gains `forSlot: z.string().datetime().optional()`, refined so
  `takenAt` and `forSlot` are never both present.

**`checkSlotActionTime(at, now, tz)`** → `'future'` if `at > now`; `'stale'` if
`at < dashboardWindow(now, tz).visibleStart`; otherwise `null`.

What each control posts:

| Control            | Action                   | Fields                                                 |
| ------------------ | ------------------------ | ------------------------------------------------------ |
| Log now            | `?/logDose`              | `medicationId`, `quantity: 1`, `forSlot: expectedTime` |
| Took it at HH:MM   | `?/logDose`              | `medicationId`, `quantity: 1`, `takenAt: expectedTime` |
| Skip               | `?/skipDose`             | `medicationId`, `takenAt: row.skipAt`                  |
| Chip               | `?/logDose`              | `medicationId`, `quantity`                             |
| Undo (toast)       | `/dashboard?/deleteDose` | `doseId`                                               |
| Undo skip / Remove | `?/deleteDose`           | `doseId`                                               |

`takenAt` is the millisecond-exact ISO string; Postgres `timestamptz` round-trips
milliseconds and pass 0 depends on that equality.

Action flow, `logDose` and `skipDose`:

1. `if (!locals.user) error(401, "Unauthorized")`.
2. `safeParse` → `fail(400, { errors: fieldErrors })`.
3. If `takenAt` is present, `checkSlotActionTime`: `'future'` →
   `fail(400, { errors: { takenAt: ["That time hasn't happened yet."] } })`; `'stale'` →
   `fail(409, { errors: { form: ["This dose has moved off your dashboard. Refresh to see what's due now."] } })`.
4. `logDose` with `forSlot` → `logDoseForSlot`. `MedicationNotFoundError` → the existing
   404 shape; `SlotTargetChangedError` →
   `fail(409, { errors: { form: ["What's due has changed. Refresh to see what's due now."] } })`.
   This covers render-to-tap drift, a page left open across midnight, a tap after the
   12h expiry, a double tap and concurrent devices.
5. Otherwise write with `exactInstantGuard: Boolean(takenAt)`.
6. `MedicationNotFoundError` → existing 404 shapes; `SlotAlreadyTakenError` →
   `fail(409, { errors: { form: ["This dose is already logged as taken. Refresh to see it."] } })`.
7. Success → `{ success: true, doseId }`.

Every shape is one `actionErrorMessage` already reads. "Took it at" is an ordinary
`logDose` (decrement, `inventoryApplied`, audit), deduplicated so a double tap decrements
once. A skip never touches inventory.

### Reminder cap (D9)

In `computeOverdueSlot`'s fixed-time walk-back (`reminders/domain.ts:55`), a slot is
skipped when `slotUtc < startOfDay(now, tz)` **and** `now − slotUtc ≥ CARRY_OVER_MS` —
the same boundary as `visibleStart`. The cron stops reminding about a slot from before
local midnight at the instant the dashboard hides it. Today's slots keep reminding while
the dashboard shows them.

Interval rows are **deliberately not capped**. The cron reminds about the _first_ missed
occurrence after the last event, while the dashboard shows today's projected
occurrences — so an interval medication never has an empty dashboard to point at, and a
cap would silently end its reminders. Aligning the interval semantics belongs to the
due-ness unification.

**Scheduler trade-off, accepted.** The `reminder-tick` workflow runs every 30 minutes,
06:00–22:59 UTC; the daily Vercel cron (`0 9 * * *`) is the backstop. With the cap, the
09:00 tick alone covers only yesterday's slots in the 12h before it. If GitHub disables
the scheduled workflow (it does so after 60 days of repository inactivity), yesterday's
daytime slots lose their day-late reminder instead of receiving it at 09:00. The
cron dead-man switch (#128) is the detector for that failure.

`CARRY_OVER_MS` is imported from `utils/schedule.ts`; the constant is not restated.

### Accepted divergence from Analytics

The dashboard answers "has this slot been handled?" — with capacity and late
resolution. Analytics counts dose events per civil day of `takenAt`
(`analytics.ts:185-193, 288-290, 390`). They already differ inside ±1h (a ×3 dose fills
three slots on My Day and counts once in Analytics); pass 2 extends that to late doses,
and Log now on an Earlier row credits yesterday's slot on the dashboard while Analytics
files the dose under today. Both alternatives would reverse decisions D4 and D3. The
divergence is recorded in CLAUDE.md beside the denominator rules and pinned by a test;
convergence belongs with the analytics-window (W1) or due-ness work.

## Section 3 — Architecture

### Pure matching — `src/lib/utils/schedule.ts`

It stays in `utils/` because `utils/time.ts` and `utils/schedule.ts` are client-reachable
and must never import `$lib/server`.

- `dashboardWindow(now, tz)`, `CARRY_OVER_MS`, exported `MATCH_TOLERANCE_MS`.
- `computeScheduleSlots(…, opts?: { window?: DashboardWindow })`. **Without `window`** it
  is one segment `[dayStart, dayEnd)` with no extension; passes 0–2 (pass 2 bounded at
  `dayStart`), reserved skips, the missed-row status rule and the lifecycle clip still
  apply, so attribution differs from today exactly as Section 4 lists.
  `dst-wall-clock.test.ts`'s direct calls are unaffected: its fixtures pass no doses and
  a `startedAt` of 2026-01-01. `ScheduleSlot` gains `kind`, `isEarlier`,
  `resolvedByDoseId` and `missedByDoseId`.
- `slotActions({ med, fixedInstants, intervalSchedules, doses, lastTakenAt, window,
now })` — the simulations. `fixedInstants` is the medication's fixed-time projection
  over `[projectStart, projectEnd)`, computed once per medication per request and passed
  in; `lastTakenAt` comes from `getLastDosePerMedication`. A simulation re-runs passes
  0–2 and, for taken probes, re-projects interval rows arithmetically from the new
  anchor. **No simulation calls `isoDayKey` or `wallClockToInstant`**, so 15 medications
  × ~9 simulations costs a few milliseconds rather than the ~0.3s a per-simulation
  re-projection would.
- `checkSlotActionTime(at, now, tz)`.
- Deleted: `timingStatusFromSlots`, `groupSlotsByTimeOfDay`, `classifyHour`,
  `getLocalHour`, `TimeOfDay`, `TimeOfDayGroup`.

### Pure copy — `src/lib/utils/dashboard-copy.ts`

`dashboardHeaderCopy(status, serverNow, tz, timeFormat)` and the toast builders
(`toastForLog`, `toastForTookItAt`, `toastForSkip`), so every sentence in this spec is
unit-testable without rendering.

### Composition — `src/lib/server/dashboard/`

- `page-data.ts` — pure, no db import (the `analytics/page-data.ts` precedent).
  `composeDashboardPageData({ medications, schedulesByMedId, doses, lastDoses, now,
timezone })` returns everything below except `refillForecast`.
- `load.ts` — `loadDashboard(userId, tz, now)`: the four queries
  (`getActiveMedications`, `getDosesInRange`, `getLastDosePerMedication`,
  `getSchedulesForUser`) plus composition. The page load calls it alongside
  `getRefillForecast` and merges the two. `logDoseForSlot` does not call it; it
  recomputes one medication inside its transaction with the same pure functions.

Load payload:

```ts
{
  now: string; nextRefreshAt: string; timezone: string;
  status: {
    kind: "due" | "caught-up" | "all-done" | "none-today" | "as-needed-only";
    dueCount: number; doneToday: number; totalToday: number; loggedToday: number;
    next: { name: string; dosageAmount: string; dosageUnit: string;
            expectedTime: string; alsoCount: number } | null;
  };
  earlier: DueCard[]; today: DueCard[]; done: DoneRow[]; later: LaterRow[];
  medications: Medication[];            // chips, in sortOrder
  refillForecast: RefillForecastEntry[]; // merged in by the page load
}

type DueCard = { key: string; medicationId: string; name: string; dosageAmount: string;
  dosageUnit: string; colour: string; colourSecondary: string | null; pattern: string;
  rows: DueRow[] };
type DueRow = { key: string; kind: "interval" | "fixed_time"; expectedTime: string;
  state: "earlier" | "overdue" | "due-now";
  logNow: boolean; tookItAt: string | null; skipAt: string | null };
type DoneRow = { key: string; dose: DoseLogWithMedication; covers: string[];
  dayLabel: "yesterday" | null };
type LaterRow = { key: string; medicationId: string; name: string; dosageAmount: string;
  dosageUnit: string; colour: string; colourSecondary: string | null; pattern: string;
  expectedTime: string };
```

`covers` holds ISO instants; the component formats them, prefixing "yesterday" for any
before `todayStart`.

### Server

- `server/doses.ts`: `getTodaysDoses` → `getDosesInRange(userId, from, to)`;
  `logSkippedDose` and `logDose` gain their optional parameters; new `logDoseForSlot`,
  `SlotAlreadyTakenError`, `SlotTargetChangedError`. No existing caller changes.
- `routes/(app)/dashboard/+page.server.ts`: the load is I/O only — `loadDashboard` +
  `getRefillForecast`. Deleted: the `lastEventMap`/`timingStatus` block, the `covered`
  merge and their imports. Actions as above; the action set and every opening 401 guard
  are unchanged.
- `server/reminders/domain.ts`: the pre-midnight fixed-time cap.

### Client

- `routes/(app)/dashboard/+page.svelte` — composition: sets the lock context, computes
  `skewMs`, runs the `serverNow()` tick and `visibilitychange` handler, arms the
  `nextRefreshAt` timer, renders the Modal.
- New components (`src/lib/components/dashboard/`): `DashboardHeader`, `DueCard`,
  `DoseActionForm`, `DoneList`, `LaterList`, `MedicationGlyph`, `StatusMarker`; and
  `dose-write-lock.svelte.ts` (`createDoseWriteLock`, `DOSE_WRITE_LOCK`,
  `DOSE_WRITE_COOLDOWN_MS`).
- `QuickLogBar.svelte` → props `{ medications }`; `timingStatus`, captions and
  `formatDueIn` removed; restyled; built on `DoseActionForm` with `data-quick-log`.
- `KeyboardShortcuts.svelte` → selector `form[data-quick-log]`; help text "Log a
  medication now, by its position in the chip list".
- `ui/Toast.svelte` → Undo `min-h-11 px-3`. Position unchanged.
- `OnboardingWelcome.svelte` → step-2 copy only.
- Deleted: `MyDayTimeline.svelte`, `SummaryStrip.svelte`, `MedicationTimingStatus`
  (`types.ts`).
- Unchanged and kept: `TimelineEntry`, `EmptyState`, `DoseEditForm`, `RefillsCard`.

### `utils/time.ts`

Adds `formatDuration`; rebuilds `formatDueIn` on it; deletes `computeTimingStatus` and
`classifyDueStatus` (no caller remains once `timingStatusFromSlots` goes).
`formatTimeSince` is untouched — `reminders.ts` builds push bodies with it. Its
`Intl.DateTimeFormat` instances are memoised per timezone in a module-level `Map`
(`isoDayKey` and `wallClockToInstant` construct one per call today, ~30µs each).

### Hidden edits

Work the plan must include even though no behaviour depends on it:

- The `vi.mock("$lib/server/doses")` factories in `app-action-auth-guard.test.ts:57` and
  `dashboard-dose-actions.test.ts:20` name `getTodaysDoses`; they gain
  `getDosesInRange`, `logDoseForSlot`, `SlotAlreadyTakenError` and
  `SlotTargetChangedError`. The `logDose` mock returns `{ id }` and `logSkippedDose` an id
  string, so `doseId` is real.
- Stale comments: `utils/time.ts` (the `startOfDay` note naming `getTodaysDoses`, and the
  `computeTimingStatus`/QuickLogBar-badge notes), `app.css` (the comment naming the old
  timeline), `reminders/domain.ts` (`OVERDUE_LOOKBACK_DAYS` — "correct at any cron
  cadence up to daily" no longer holds for pre-midnight slots), and
  `.github/workflows/reminder-tick.yml` (the daily cron now backstops only the 12h
  before 09:00 UTC).
- `theme-tokens.test.ts`: the two "timeline status glyph" rows read their backdrop off
  `MyDayTimeline`; replace them with `StatusMarker`'s real nesting.

## Section 4 — Testing

Every new rule is proven by mutation: break the production line and watch the named
test fail, or the test does not ship. Seeded randomised tests declare an explicit
timeout (`it(…, 60_000)`) with a fixture count that finishes inside it; `vite.config.ts`
sets no `testTimeout`.

**Matching (`schedule.test.ts`)**

- Every existing case keeps its outcome except the deleted `classifyHour`,
  `groupSlotsByTimeOfDay` and `timingStatusFromSlots` blocks. Two cases keep passing but
  now credit a different slot, each with a comment naming the mechanism: "a skipped dose
  clears at most one slot" (`:477`, now 09:00 not 08:45, via the **reserved skip** — the
  skip sits on the 09:00 instant) and "a quantity-1 dose still fills exactly one slot"
  (`:527`, now 09:00 not 08:30, via **pass 0**).
- Pass 0 own row; reserved skip own row; taken beats an exact skip; pass 0 is exact to
  the millisecond; pass 0 precedence with a skip and a taken dose at one instant; pass 1
  never re-claims a slot pass 0 resolved.
- Capacity across passes (one ×3 dose resolving slots via passes 0, 1 and 2).
- Pass 2: the live 08:55/09:00/11:00 case; latest first; never forward; pass 1 beats
  pass 2; time-order replay; a future-dated dose; a legacy skip-at-now resolving an
  earlier slot; the `visibleStart` bound and the `dayStart` bound without a window.
- Missed: a past slot with a missed row stays overdue (existing `:251`); a future one
  reads upcoming.
- Segment limit (23:30 / 00:13 / dose at 00:10); per-segment twin suppression.
- Projection: fixed-time instants assigned by instant (Godthab's Saturday 23:30 on
  Sunday); lifecycle clip; schedule-edit clip (a 20:00→22:00 edit this morning shows no
  "Due yesterday 22:00"; today's slots unaffected); never-taken interval per-segment
  grids; interval carry-over and re-anchoring.
- **Stability across midnight and noon**, plus a seeded randomised test of fixed-time
  fixtures: each slot visible at 00:01 has the status it had at 23:59.
- **Differential against production.** Oracle: a verbatim port of today's matcher over
  `[todayStart, end)` with doses `≥ todayStart`. Domain: fixtures with no dose in
  `[todayStart − 1h, todayStart)` or at/after `end`, none on a slot instant, no missed
  row, every medication's `startedAt ≤ projectStart` and `endedAt` null, and schedule
  `effectiveFrom ≤ projectStart`. Property: every today slot the oracle resolves has the
  same status and `matchedDoseId`; every slot the oracle leaves overdue is either still
  overdue or resolved by pass 2 (its `resolvedByDoseId` names a dose taken after it).
- **Slot-anchored property** (seeded): every offered button, applied through the same
  re-projection the next load performs, moves its own row to taken or skipped; every
  other visible row keeps its status and instant, except interval rows removed or
  re-timed by the new `lastTakenAt`, which the test takes from the simulation. Mutation:
  remove the simulation guard.
- Log-now placement: the common case; due-within-the-hour; 08:55/09:00 at 09:30; Earlier
  and hidden rows; the mixed interval + fixed medication (no target); the hour after a
  skip; interval supersession; the cooldown; a due-now slot ahead with an earlier
  outstanding slot within the hour (no buttons); a round trip (add the dose, recompute,
  the target is resolved).
- Took it at: offered on a past due-now row without Log now (slots 12:40 and 13:10 at
  13:30); hidden on a due-now row with Log now; re-projects interval rows.
- Window: London BST and the October transition; the 12h boundary to the millisecond.

**Time (`time.test.ts`)** — `formatDuration` short and long at every threshold
(59,999ms, 60,000ms, 45m, 60m, 2h15m, 23h59m, 24h, 24h59m, 25h, 49h); `formatDueIn`'s 11
assertions unchanged; `computeTimingStatus` cases deleted with the function; the
formatter memo returns one instance per timezone.

**Copy (`dashboard-copy.test.ts`, new)** — every header `kind` and its predicates,
singular/plural, "Next: … and 2 more", omitted-at-0 rules; toast builders including the
"yesterday" prefix and the no-"counted for" case.

**Composition (`dashboard-page-data.test.ts`, new)** — state boundaries at ±1h and +12h;
header `kind` selection; `covers` (resolvedBy only; tomorrow's first hour excluded);
backdated rows in Done with `dayLabel`; as-needed only (archived medications' schedules
ignored); `skipAt` shipped per row; `nextRefreshAt` including the cooldown term. Replaces
`dashboard-timing-status.test.ts`.

**Load (`dashboard-load.test.ts`, new, fake-db)** — `getDosesInRange` is called with
`doseFetchFrom`/`doseFetchTo`; no `timingStatus` key; `refillForecast` merged by the
page load.

**Actions (`dashboard-dose-actions.test.ts`)** — `forSlot` → `SlotTargetChangedError` →
409 with a fake clock (target 14:00 at 18:50, posted at 19:05); `takenAt` future (400)
and stale (409); `takenAt` with `forSlot` (400); missing `medicationId` (400, not 404);
`doseId` returned. The auth-guard suite's `skipDose` body still passes the schema; no
new actions.

**Database-decided (`tests/unit/pg/`, PGlite)** — two "Took it at 09:00" posts produce
one taken row and one inventory decrement; two exact skips produce one skip; a skip over
a taken instant raises `SlotAlreadyTakenError`; a "Took it at" over a skip inserts; two
concurrent `logDoseForSlot` calls for one medication produce one dose and one
`SlotTargetChangedError`.

**Reminders (`reminders-dedupe.test.ts`)** — the cap: a pre-midnight slot at exactly
12h returns `null`, at 12h − 1ms returns the slot; a today slot older than 12h still
returns the slot; interval rows unaffected; the 09:00 tick returns `null` for the
previous day's 20:00 slot. The existing look-back cases whose slots are 13–16h old at
their tick (`:253`, `:317`, `:323`, `:348`, `:377`, `:387`, `:396`, `:405`) move their
`now` inside 12h of the slot, keeping each test's named property.

**Components** — `status-marker-ssr.test.ts` (moved; fails if a new state lacks a label);
`DueCard` SSR + axe (`button-name`, `label-in-name`, `list`, `target-size`); the lock
(fake timers: busy through the cooldown, `acquire` fails while busy, `'error'` path
releases only after `invalidateAll`); client time with a clock 10 minutes fast
invalidates at most once per `nextRefreshAt`; `KeyboardShortcuts` submits only
`data-quick-log` forms; `StatusMarker` pairs in `theme-tokens.test.ts`.

**Pinned divergences** — the Analytics divergence (fixed 08:00/14:00/20:00, one ×3 at
20:30: all three taken on the dashboard), with a comment pointing at CLAUDE.md.

**E2E** — in the same PR, because `RUN_E2E` never runs in CI and nothing else catches
these: set `HEADING.dashboard = "Today"` (`tests/e2e/helpers/selectors.ts:14`) and make
every dashboard-heading wait `getByRole("heading", { level: 1, name:
HEADING.dashboard, exact: true })` — `helpers/auth.ts:28` (inside `login()`, which every
authenticated test runs), `auth.test.ts:16`, `accessibility.test.ts:55` and `:102`
(exact matching matters: "Today" is a substring of "Done today" and "Later today");
change `dose-logging.test.ts:28-30` to submit the `form[data-quick-log]` for the seeded
medication.

## Out of scope

- The due-ness unification (`due.ts`, `outstandingSlots`/`isOutstanding`, `lastEventAt`
  anchoring, the `startedAt` rule). When it lands, passes 0–2, the segment limit and the
  clips move into `outstandingSlots`.
- Any schema migration; any `/api/v1` change.
- Forward matching: a dose taken more than 1h before its slot stays unmatched, and the
  slot still comes due.
- Schedule history: projecting yesterday from the schedule as it was, rather than
  clipping at the last save.
- A batch "log all due" action; pagination or collapse for long lists.
- Projecting tomorrow beyond its first hour.
- Moving the Toast; removing the 1–9 shortcuts; `TimelineEntry`'s hover-revealed controls
  and `opacity-60` on `/log`.
- A future-`takenAt` bound on `logDose` for callers that do not send `forSlot` or
  `takenAt` from this page.

## Follow-ups

1. **A slot-derived Missed view in History** (D10), with nothing written to the database.
2. **Mac app port** of passes 0–2, the segment limit, reserved skips and both clips to
   `Schedule.swift`, with a shared fixture table. Capacity matching already diverges
   today.
3. **Reminder copy**: "last logged X ago" in `reminders.ts` and `email.ts` becomes
   inaccurate when a skip or "Took it at" records a past instant.
4. **Landing walkthrough**: `walkthrough/scenes/DashboardScene.svelte`,
   `parts/MyDaySection.svelte` and `parts/SummaryAndRefills.svelte` depict the old
   dashboard until redrawn.

## Docs to update in the same PR

- **CLAUDE.md**: the slot-matching rule and its single owner (window, both clips,
  passes 0–2, segment limit, reserved skips); the accepted dashboard/Analytics divergence
  beside the denominator rules; `DoseActionForm` as the single path for dashboard logs,
  skips, undos and removes; client time is server-relative.
- **`2026-08-13-due-ness-unification-design.md`**: its dashboard deletions
  (`computeTimingStatus`, the `covered` merge) land early; `timingStatusFromSlots` and
  `classifyDueStatus` are deleted rather than moved or kept; its "exactly two cases"
  check loses the `time.test.ts` half; its resolution rule should adopt passes 0–2; the
  lifecycle clip lands early; "QuickLogBar keeps `MedicationTimingStatus`" is obsolete;
  "reminders-dedupe keeps its look-back cases" now reads "keeps them, with ticks inside
  12h of the slot".
- **`tests/unit/dst-wall-clock.test.ts:515`**: the comment "My Day cannot show a slot
  that rolled out of the day" — the direct-call assertion still holds, but the dashboard
  now shows that slot under the window.
- **`reminders/domain.ts`** (`OVERDUE_LOOKBACK_DAYS`) and
  **`.github/workflows/reminder-tick.yml`**: the backstop comments, per Hidden edits.
