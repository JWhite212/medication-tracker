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

| #   | Decision                                                                                                                                                                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Rebuild the UI on the **existing per-slot model** and change only slot matching. The dashboard stops using per-medication `timingStatus`. The due-ness unification (`due.ts`) stays a separate project.                    |
| D2  | An unresolved slot from before local midnight stays visible under **"Earlier"** until it is logged or skipped, or becomes **12 hours** old. Nothing older is shown.                                                        |
| D3  | **Log now** records the current time. Overdue rows also offer **"Took it at HH:MM"**, which records the slot's own time.                                                                                                   |
| D4  | Resolution approach **A** — no schema change. Keep today's ±1h pass; add a late-resolution pass; anchor every button to the row it sits on.                                                                                |
| D5  | Quick Log moves below the timeline as **"Log something else"**, restyled as neutral chips with a capsule glyph; captions removed; quantity resets after a log.                                                             |
| D6  | Layout: **Due-first** (Section 1 below), including its grafted safety mechanics.                                                                                                                                           |
| D7  | **Pass 0**: a dose or skip recorded at _exactly_ a slot's instant resolves that slot.                                                                                                                                      |
| D8  | **One-hour Log-now cooldown**: a medication with a taken dose in the last hour shows no Log now (Took it at and Skip remain).                                                                                              |
| D9  | The reminder cron gets a **12h age cap on fixed-time slots**, in this change.                                                                                                                                              |
| D10 | An expired Earlier slot leaves **no per-dose record** (History lists only `dose_logs` rows, and nothing but import writes `missed`). No UI copy may claim otherwise. A slot-derived Missed view in History is a follow-up. |

Two refinements to the original decisions came out of adversarial review and were
approved with the sections they belong to:

- **Log now is placed by simulation, not by "latest outstanding".** D4 originally put
  Log now on each medication's latest outstanding slot on the premise that pass 2 would
  always pick it. It does not: pass 1 takes a dose logged now first when a slot is due
  within the hour or a second outstanding slot lies within the past hour, and on a
  medication with an interval schedule a new dose re-anchors the projection. The
  button now goes wherever a dose logged now would actually land.
- **The dashboard and Analytics will disagree more, deliberately.** See
  [Accepted divergence](#accepted-divergence-from-analytics).

## Section 1 — Layout

One column, `max-w-2xl`, ordered by what the user has to do.

1. **Header** (`DashboardHeader`) — replaces `<h1>Dashboard</h1>` and `SummaryStrip`.
2. **Due** — one card per medication with something to act on. An **Earlier**
   sub-group (visible `h3`, only when present) comes first; the **Today** sub-group gets
   a visible `h3` only when Earlier is also shown.
3. **Done today** — one row per dose event.
4. **Later today** — read-only lines for today's slots more than an hour ahead.
5. **Log something else** — neutral chips in the user's `sortOrder`.
6. **Refills** — `RefillsCard`, unchanged, last.
7. Overlays, not in flow: the existing `Modal` (with `DoseEditForm` and a separate
   _Remove this dose_ form) and the single layout-mounted `Toast`.

For an account with **no interval or fixed-time schedule rows at all** (as-needed only),
the chips move directly under the header, retitled **"Log a dose"**, and Done is
retitled **"Logged today"**. There is no Due or Later section.

There are **no time-of-day groups and no emoji headings**. The page is grouped by action,
so a 00:13 slot is simply the earliest instant of its day (problem 8).

### Header

- Eyebrow `<p class="text-sm text-text-secondary">`:
  `formatUserDate(now, tz, dateFormat, { weekday: true, year: false })` — "Thu 24 Sept".
- `<h1 id="dashboard-heading" tabindex="-1" class="text-2xl font-bold">Today</h1>` — a
  stable heading. `<title>` stays "Dashboard — MedTracker" to match the nav.
- Status sentence `<p class="text-lg font-semibold">`, first matching case wins:
  - Due has rows → "5 doses due" / "1 dose due" (every Due row, Earlier and nested
    rows included).
  - nothing due, slots still ahead today → "All caught up".
  - today had slots, all resolved, none ahead → "All done for today".
  - slot-producing schedules exist but none fall today, no carry-over → "Nothing
    scheduled today".
  - as-needed only → "2 doses logged today" / "No doses logged yet today".
- Supporting line `<p class="text-sm text-text-secondary">`:
  - due → "2 of 7 done today" (today's slots taken or skipped; Earlier excluded;
    omitted while 0).
  - caught up → "Next: Lisinopril 10mg at 20:00 · in 3 hours"; several at one time →
    "Next: Lisinopril 10mg and 2 more at 20:00 · in 3 hours".
  - all done → "7 of 7 done today". nothing scheduled → "2 doses logged today"
    (omitted at 0). as-needed only → "Tap a medication below to log a dose."

This is the **only** place a count appears. The word "overdue" appears in no visible
copy; it survives only as `StatusMarker`'s accessible name. The header is not a live
region.

### Due cards

`<li tabindex="-1" aria-labelledby={nameId} class="rounded-xl border bg-glass p-3">` in a
`<ul role="list">`. Border `border-warning/50` when the top row is overdue or earlier,
`border-accent-ink/50` when it is due now. No dashed border, no opacity, no tint.

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
  card in both sub-groups.

Row states and their status copy (durations per [Durations](#durations)):

| State   | When                                               | Status line                           | Marker                         | Buttons (each only if [proven](#which-buttons-a-row-offers)) |
| ------- | -------------------------------------------------- | ------------------------------------- | ------------------------------ | ------------------------------------------------------------ |
| earlier | unresolved, before today's midnight, under 12h old | "Due yesterday 22:00 · 9 hours ago"   | amber `!` (`overdue`)          | Log now, Took it at 22:00, Skip                              |
| overdue | unresolved, today, more than 1h past               | "Due 11:00 · 2 hours ago"             | amber `!` (`overdue`)          | Log now, Took it at 11:00, Skip                              |
| due-now | unresolved, within ±1h of now                      | "Due 13:45 · in 15 minutes" / "· now" | accent dot-in-ring (`due-now`) | Log now, Skip                                                |

On a due-now row, _Took it at_ is omitted because Log now resolves the same row — except
when the cooldown (D8) hides Log now on a past due-now row, in which case _Took it at_
takes its place so the row stays actionable.

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
hairlines, ascending by `takenAt`. Left to right: time (`w-14 tabular-nums`),
`StatusMarker`, `MedicationGlyph sm`, name + dose + "×n" when quantity > 1, a **covers**
line, and a trailing button.

- **Which rows**: doses with `todayStart ≤ takenAt < end`, **plus** doses with
  `loggedAt ≥ todayStart` and `takenAt < todayStart` — a backdated "Took it at" on an
  Earlier row — shown with their day ("Yesterday 22:00") so they can be undone.
- **Covers**: the slot instants this dose resolved, keeping only those whose minute
  differs from its own `takenAt` — "13:31 ✓ Metformin 500mg ×4 · for 08:55, 09:00,
  11:00". Facts only: no "extra" label, because an interval medication's earlier doses
  resolve nothing by design and are not extra.
- **taken / extra dose** → an **Edit** button (`h-11 px-3 rounded-lg border
border-border-strong`) opening the existing Modal: unchanged `DoseEditForm`, plus a
  separate `<form action="?/deleteDose">` with **Remove this dose** (`min-h-11`,
  `text-danger-ink`). No hover-revealed controls.
- **skipped** → a neutral marker (dash in a `border-strong` ring, `text-text-secondary`;
  a skip is a decision, not a problem), the word "Skipped", and an **Undo skip** button
  that posts `?/deleteDose`. A `missed` row (import/API only) renders the same with
  "Missed".

### Later today

One `bg-glass` card of 40px read-only lines: time, hollow `StatusMarker`,
`MedicationGlyph sm`, name + dose, and "in 3 hours" on the right. Not focusable, no
actions. To take a dose early the user taps its chip; within the hour it becomes a
due-now card on the next refresh.

### Log something else

Chips `h-11 rounded-full border border-border-strong bg-glass text-text-primary`:
`MedicationGlyph sm`, name + dose, "×n" when above 1, and fixed 44px **−** (rendered
always, `aria-disabled` at 1, so the log segment never shifts under the thumb) and
**+** segments. Medication colours never sit behind text again. Quantity resets to 1
after a successful log and is kept after a failure. The chips are never described as
"extra": with pass 2 a chip log of a scheduled medication often resolves a slot, and
the toast says which.

### Feedback, focus and freshness

- **`DoseActionForm`** is the one `use:enhance` implementation for every dose write on
  the page (Due buttons, chips, Undo skip, Remove). It owns everything below.
- **Pending**: the pressed button keeps its width and shows a 16px spinner plus
  "Logging…" / "Recording…" / "Skipping…" / "Removing…"; its card gets `aria-busy`.
- **Page-wide lock**: while any dose write is in flight, and for ~700ms after it settles,
  every dose-writing control is `aria-disabled` and the enhance `submit` calls
  `cancel()`. Never the `disabled` attribute, which drops focus to `<body>`.
- **Success**: `await update()`, then build the toast **from the reloaded data** using
  the returned `doseId`, so it states what the matcher actually did:
  - Log now / chip: "Metformin 500mg logged at 13:31 — counted for your 08:55, 09:00 and
    11:00 doses · Undo" (no "counted for" clause when it covered nothing).
  - Took it at: "Metformin 500mg recorded as taken at 11:00 · Undo".
  - Skip: "Metformin 500mg: 11:00 dose skipped · Undo".
  - If the reload fails, fall back to "Metformin 500mg logged at 13:31 · Undo".
  - **Undo** posts `?/deleteDose` (fetch + `deserialize`, then `invalidateAll()`);
    `deleteDose` restores exactly `inventoryApplied`. This is the first caller of
    `Toast`'s existing `undoAction`.
- **Failure**: `'failure'` → `actionErrorMessage(result)` toast, `update()`, unlock; a chip
  keeps its quantity. `'error'` (outcome unknown) → toast, then `invalidateAll()`
  **before** the lock releases, so any retry acts on fresh data.
- **Focus** after a row resolves: the same card's `<li>` if it survives, else the next
  card's `<li>`, else the `h1`. Never another write button — a repeated Enter must not
  log a different medication. After Remove or Undo skip: the "Done today" `h2`
  (`tabindex="-1"`). Chip logs keep focus on the chip.
- **Freshness**: the load returns `nextRefreshAt` (see
  [Freshness](#freshness)). The page arms one `setTimeout(invalidateAll)` for it and
  calls `invalidateAll()` on `visibilitychange` when it has passed. Visible durations
  tick from a client `now` updated every 60s (the `TimeSince` pattern). Status, rows
  and buttons change only through the load.
- **Stale guard (client)**: a submit when `Date.now() ≥ nextRefreshAt` is cancelled, the
  page reloads, and the toast reads "The list just updated — check it and tap again".
  The server check on Log now (below) is the authority; this saves a round trip.
- **Keyboard shortcuts 1–9** select `form[data-quick-log]` only (the chips), so a key can
  never submit a backdated _Took it at_. They pass through the same lock.

### Accessibility

- Headings: `h1` Today; `h2` "Due" (`sr-only`) › `h3` Earlier / Today; `h2` Done today,
  Later today, Log something else; the existing Refills heading. Each region is a
  `<section aria-labelledby>`. Lists are `<ul role="list">` (survives Tailwind's list
  reset in Safari).
- **Status never relies on colour**: visible text ("Due 11:00 · 2 hours ago",
  "Skipped"), a distinct marker shape (`!`, dot-in-ring, hollow ring, check, dash), then
  colour as reinforcement. `StatusMarker` keeps `role="img"` + `aria-label` — the
  Lighthouse `aria-prohibited-attr` fix now pinned by `my-day-timeline-ssr.test.ts`,
  which moves to `status-marker-ssr.test.ts` with the same assertions.
- **Names put the visible label first** (WCAG 2.5.3) with `sr-only` context after:
  "Log now: Metformin 500mg, 11:00 dose"; "Took it at 11:00: Metformin 500mg"; "Skip:
  Metformin 500mg, 11:00 dose"; "Edit: Metformin 500mg dose taken at 13:31". Chips:
  `<span class="sr-only">Log </span>Ibuprofen 200mg ×2`; the old `aria-label` that hid
  the visible label is dropped. Steppers keep "Decrease/Increase quantity for …".
- **Targets**: Log now 48×104px minimum; every other dose control, chip segment and the
  Toast's Undo at least 44×44px.
- **Live regions**: only the existing polite Toast.
- **Contrast**: only `accent`/`accent-fg` is a fill pair; control boundaries are
  `border-strong`; `glass-border` is hairlines only. Any new text-on-tint pair goes into
  `theme-tokens.test.ts`'s chip table with its real nesting.
- **Time limits (2.2.1)**: the Toast's hover/focus hold stays; Edit → Remove and Undo
  skip are untimed alternatives to the toast's Undo.

### Empty and edge states

- **Onboarding** (no active medications): `OnboardingWelcome` as today; step-2 copy
  becomes "Due — one tap to log what's due", "Done today — everything you've logged",
  "Refills — know when to reorder".
- **All done**: header, Done, chips, Refills; no Later.
- **Caught up with slots ahead**: header with its "Next:" line, Done, Later.
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

**Lifecycle clip.** Every projected slot outside `[med.startedAt, med.endedAt]` is
dropped before matching. A medication created at 14:00 no longer shows a phantom 08:00
slot, and a new medication gets no Earlier rows. This matches Analytics (`isActiveOn`
gives a creation day no expected doses) and the due-ness spec's clip.

**Doses** come from `getDosesInRange(userId, doseFetchFrom, doseFetchTo)`
(`takenAt ≥ from AND takenAt < to`, user-scoped, same select and join as the old
`getTodaysDoses`). The −1h is pass 1's reach before the first projected slot; the +2h is
its reach past the last tomorrow's-first-hour slot.

### Projection

Unchanged per kind, with three window-driven changes:

- **Interval rows anchor on `lastTakenAt`** (all-time max `takenAt` of taken rows; skips
  never anchor), exactly as today. Every taken dose re-anchors; interval points before it
  stop existing.
- **Never-taken interval medications** get a grid per segment, anchored at that
  segment's own local midnight. Today's grid is byte-identical to production; yesterday's
  rows are exactly what yesterday's dashboard showed; nothing slides during the day. The
  due-ness spec's "never-handled begins at `startedAt`" anchor stays with `due.ts`.
- **Drifted-twin suppression is per segment**: an interval point is dropped only when a
  fixed slot in the _same_ segment is within ±1h. Cross-day suppression would delete
  today's 00:10 because of yesterday's 23:30.

### Three passes

Per medication, slots deduplicated and ascending. `remaining(d)` starts at
`max(1, quantity)` for a taken dose and 1 for a skipped or missed one; one map is shared
by all three passes.

**Pass 0 — exact claims (taken only).** For each slot `t`, a taken dose with
`remaining > 0` and `takenAt === t` to the millisecond claims it; ties go to the smaller
id. Skips never claim in pass 0.

**Reserved skip.** A skipped dose whose `takenAt` equals one of that medication's
projected slot instants is that slot's own Skip. It is a candidate **only for that
slot**, in pass 1, at rank 1 — so a taken dose within tolerance still wins
(`schedule.test.ts:496` stays true) — and never takes part in pass 2. Skips not on a
slot instant (legacy skip-at-now rows, `/api/v1 skip_dose`, the Mac app) behave exactly
as today.

**Pass 1 — today's rule.** Today's loop body verbatim: slots ascending; candidates are
doses with `remaining > 0` and `|takenAt − t| ≤ MATCH_TOLERANCE_MS`; best by rank (taken
0, skipped/missed 1), then distance, then smaller id. Two filters are added:

- **Segment limit**: `takenAt` must be before the end of `t`'s segment (`todayStart` for
  yesterday's slots, `end` for today's; none for tomorrow's first hour). With fixed 23:30
  and 00:13, yesterday's 23:30 unlogged and a dose at 00:10, today's 00:13 gets the dose,
  as production does.
- A reserved skip is a candidate only for its own slot.

A missed row goes to `missedBy`; anything else to `resolvedBy`.

**Pass 2 — late resolution.** Doses that are taken or skipped (never missed), not
reserved skips, have `remaining > 0` after passes 0–1, and have `takenAt ≤ now`. Process
them ascending by `(takenAt, id)` so events replay in time order and history is never
re-attributed. For each, walk the slots backwards from the last slot strictly before
`takenAt`, skipping resolved slots (a slot with only a missed row is eligible) and
stopping at the first slot before `visibleStart`, claiming while `remaining > 0`.
Pass 2 never resolves a slot after its dose.

Worked cases:

- Slots 08:55, 09:00, 11:00; ×4 at 13:31 and ×3 at 21:48 → all three resolved by the
  13:31 dose (Done: "· for 08:55, 09:00, 11:00"); 21:48 covers nothing.
- Slots 14:00 and 20:00; dose at 20:30 → pass 1 gives 20:00; 14:00 stays overdue.
- "Took it at 09:00" beside an open 08:55 → pass 0 gives 09:00 to it; 08:55 stays
  overdue. Without pass 0, pass 1's ascending greed hands it to 08:55.

### Status

- Resolved by pass 0, 1 or 2 → `taken` or `skipped` from the resolving dose.
- Otherwise `overdue` if `expectedTime ≤ now`, else `upcoming` — **including** slots
  matched only to a missed row. A future slot no longer reads overdue because of a missed
  row (it previously offered buttons that could only fail).
- `matchedDoseId = resolvedBy?.id ?? missedBy?.id ?? null`.
- `isEarlier = expectedTime < todayStart`, by instant.
- **Visible** when `expectedTime < end` and either not earlier, or overdue and
  `≥ visibleStart`. Earlier rows are never upcoming.

The dashboard's display states map from these: `earlier` = visible, earlier, overdue;
`overdue` = today, overdue, more than 1h past; `due-now` = today, unresolved,
`|t − now| ≤ MATCH_TOLERANCE_MS`; `upcoming` beyond that goes to Later.

### Which buttons a row offers

`slotActions(med, …, now)` decides every button by **simulating its write** and
re-running passes 0–2 for that medication with the same window and `now`:

- **Log now** — probe a taken ×1 dose at `now` (id sorting last so it never wins a tie),
  and re-project interval rows with `lastTakenAt' = max(lastTakenAt, now)` — what the
  next load will see. Key base and simulated slots by `expectedTime`. The target is the
  latest base slot that is visible, unresolved, `≤ now + 1h`, and in the simulation is
  either resolved by a taken dose or (interval slots only) no longer projected because
  the re-anchor superseded it. At most one per medication; never a hidden or
  tomorrow's-first-hour row.
- **Took it at** — probe a taken dose at exactly `expectedTime`; offered on past rows
  when the simulation resolves exactly this row.
- **Skip** — probe a skip at `min(expectedTime, now)`; offered when the simulation moves
  exactly this row to skipped. For a past slot that is a reserved skip; for a due-now
  slot still ahead it is a skip at `now`, which is within the hour — no dose row is ever
  future-dated.
- **Cooldown (D8)**: no Log now for a medication with a taken dose whose `takenAt` is in
  `(now − 1h, now]`.

A row whose simulations prove nothing shows its status line with no buttons. With pass
0 and reserved skips this is rare; the known case is the hour after a slot is skipped at
its instant, when a dose logged now would still count for the skipped slot (taken beats
skip) and so the medication has no Log now — its other rows keep Took it at and Skip.

Consequences the user will see, all intended: Log now can sit on a dose due within the
next hour; on a legacy medication mixing interval and fixed schedules it is often absent
from the fixed rows; tapping it on an interval row replaces that row and every earlier
interval row with "Taken HH:MM".

### Freshness

`nextRefreshAt` = the earliest instant after `now` among: `end`; `t − 1h`, `t` and
`t + 1h` for each visible slot; `t + 12h` for each Earlier slot; `t − 1h` for each
tomorrow's-first-hour slot; `takenAt + 1h` for each taken dose inside the cooldown;
any fetched `takenAt` later than `now`. Clamped to at least `now + 5s`.

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
  `now − expectedTime`, never from status.
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

`/api/v1` passes neither argument: the API, its tests and the Mac app are unchanged.

**Schemas** (`utils/validation.ts`):

- `doseSkipSchema = z.object({ medicationId: z.string().min(1), takenAt:
z.string().datetime().optional() })`. This also fixes today's `String(undefined)`,
  which answered 404 where it should answer 400.
- `doseLogSchema` gains `forSlot: z.string().datetime().optional()`, refined so
  `takenAt` and `forSlot` are never both present.

**`checkSlotActionTime(at, now, tz)`** → `'future'` if `at > now`; `'stale'` if
`at < dashboardWindow(now, tz).visibleStart`; otherwise `null`.

What each control posts:

| Control                   | Action         | Fields                                                 |
| ------------------------- | -------------- | ------------------------------------------------------ |
| Log now                   | `?/logDose`    | `medicationId`, `quantity: 1`, `forSlot: expectedTime` |
| Took it at HH:MM          | `?/logDose`    | `medicationId`, `quantity: 1`, `takenAt: expectedTime` |
| Skip                      | `?/skipDose`   | `medicationId`, `takenAt: min(expectedTime, now)`      |
| Chip                      | `?/logDose`    | `medicationId`, `quantity`                             |
| Undo / Undo skip / Remove | `?/deleteDose` | `doseId`                                               |

`takenAt` is the millisecond-exact ISO string; Postgres `timestamptz` round-trips
milliseconds and pass 0 depends on that equality.

Action flow, `logDose` and `skipDose`:

1. `if (!locals.user) error(401, "Unauthorized")`.
2. `safeParse` → `fail(400, { errors: fieldErrors })`.
3. If `takenAt` is present, `checkSlotActionTime`: `'future'` →
   `fail(400, { errors: { takenAt: ["That time hasn't happened yet."] } })`; `'stale'` →
   `fail(409, { errors: { form: ["This dose has moved off your dashboard. Refresh to see what's due now."] } })`.
4. `logDose` with `forSlot`: `loadDashboard(user, tz, new Date())`; medication not active
   → the existing 404 shape; its Log-now target missing or not equal to `forSlot` →
   `fail(409, { errors: { form: ["What's due has changed. Refresh to see what's due now."] } })`,
   writing nothing. This covers render-to-tap drift, a page left open across midnight,
   a tap after the 12h expiry, and a double tap.
5. Write with `exactInstantGuard: Boolean(takenAt)`.
6. `MedicationNotFoundError` → existing 404 shapes; `SlotAlreadyTakenError` →
   `fail(409, { errors: { form: ["This dose is already logged as taken. Refresh to see it."] } })`.
7. Success → `{ success: true, doseId }`.

Every shape is one `actionErrorMessage` already reads. "Took it at" is an ordinary
`logDose` (decrement, `inventoryApplied`, audit), deduplicated so a double tap decrements
once. A skip never touches inventory.

### Reminder cap (D9)

`computeOverdueSlot`'s fixed-time walk-back (`reminders/domain.ts:55`) finds the most
recent elapsed slot first; if that slot is older than `CARRY_OVER_MS`, return `null`.
The cron then stops reminding about a slot the dashboard has hidden.

Interval rows are **deliberately not capped**. The cron reminds about the _first_ missed
occurrence after the last event, while the dashboard shows today's projected
occurrences — so an interval medication never has an empty dashboard to point at, and a
cap would silently end its reminders after 12h. Aligning the interval semantics belongs
to the due-ness unification.

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
- `computeScheduleSlots(…, opts?: { window?: DashboardWindow })` — passes 0–2, lifecycle
  clip, per-segment projection and suppression. **Without `window` it is one segment
  with no extension and behaves exactly as today**, so direct callers and
  `dst-wall-clock.test.ts` are unaffected. `ScheduleSlot` gains `kind`, `isEarlier` and
  `resolvedByDoseId`.
- `slotActions(…)` — the simulations above.
- `checkSlotActionTime(at, now, tz)`.
- Deleted: `timingStatusFromSlots`, `groupSlotsByTimeOfDay`, `classifyHour`, `TimeOfDay`,
  `TimeOfDayGroup`.

### Composition — `src/lib/server/dashboard/`

- `page-data.ts` — pure, no db import (the `analytics/page-data.ts` precedent).
  `composeDashboardPageData({ medications, schedulesByMedId, doses, lastDoses,
refillForecast, now, timezone })` returns the load payload: header status, Earlier and
  Today `DueCard`s, Done rows with `covers`, Later rows, `nextRefreshAt`.
- `load.ts` — `loadDashboard(userId, tz, now)`: the queries plus composition. Shared by
  the page load and `logDose`'s `forSlot` check, so both see one answer.

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
  refillForecast: RefillForecastEntry[];
}

type DueCard = { medicationId: string; name: string; dosageAmount: string; dosageUnit: string;
  colour: string; colourSecondary: string | null; pattern: string; rows: DueRow[] };
type DueRow = { key: string; kind: "interval" | "fixed_time"; expectedTime: string;
  state: "earlier" | "overdue" | "due-now";
  logNow: boolean; tookItAt: string | null; skipAt: string | null };
type DoneRow = { key: string; dose: DoseLogWithMedication; covers: string[]; dayLabel: string | null };
type LaterRow = { key: string; medicationId: string; name: string; dosageAmount: string;
  dosageUnit: string; colour: string; colourSecondary: string | null; pattern: string;
  expectedTime: string };
```

### Server

- `server/doses.ts`: `getTodaysDoses` → `getDosesInRange(userId, from, to)`;
  `logSkippedDose` and `logDose` gain their optional parameters. No existing caller
  changes.
- `routes/(app)/dashboard/+page.server.ts`: the load is I/O only — `loadDashboard` +
  `getRefillForecast`. Deleted: the `lastEventMap`/`timingStatus` block, the `covered`
  merge and their imports. Actions as above; the action set and every opening 401 guard
  are unchanged.
- `server/reminders/domain.ts`: the fixed-time cap.

### Client

- `routes/(app)/dashboard/+page.svelte` — composition: sets the lock context, holds the
  60s `now` tick and `visibilitychange` handler, arms the `nextRefreshAt` timer, renders
  the Modal.
- New components (`src/lib/components/dashboard/`): `DashboardHeader`, `DueCard`,
  `DoseActionForm`, `DoneList`, `LaterList`, `MedicationGlyph`, `StatusMarker`.
- `QuickLogBar.svelte` → props `{ medications }`; `timingStatus`, captions and
  `formatDueIn` removed; restyled; built on `DoseActionForm` with `data-quick-log`.
- `KeyboardShortcuts.svelte` → selector `form[data-quick-log]`; help text "Log a
  medication now, by position in Log something else".
- `ui/Toast.svelte` → Undo `min-h-11 px-3`. Position unchanged.
- `OnboardingWelcome.svelte` → step-2 copy only.
- Deleted: `MyDayTimeline.svelte`, `SummaryStrip.svelte`, `MedicationTimingStatus`
  (`types.ts`).
- Unchanged and kept: `TimelineEntry`, `EmptyState`, `DoseEditForm`, `RefillsCard`
  (used by `/log` and `/medications`, or unchanged).

### `utils/time.ts`

Adds `formatDuration`; rebuilds `formatDueIn` on it; deletes `computeTimingStatus` and
`classifyDueStatus` (no caller remains once `timingStatusFromSlots` goes).
`formatTimeSince` is untouched — `reminders.ts` builds push bodies with it.

## Section 4 — Testing

Every new rule is proven by mutation: break the production line and watch the named
test fail, or the test does not ship.

**Matching (`schedule.test.ts`)**

- Every existing case keeps its outcome except the deleted `classifyHour`,
  `groupSlotsByTimeOfDay` and `timingStatusFromSlots` blocks. Two cases keep passing but
  now credit a different slot because of pass 0 — "a skipped dose clears at most one
  slot" (now 09:00, not 08:45) and "a quantity-1 dose still fills exactly one slot" (now
  09:00, not 08:30); each gets a comment saying so.
- Pass 0 own row; reserved skip own row; taken beats an exact skip; pass 0 is exact to
  the millisecond; pass 0 precedence with a skip and a taken dose at one instant.
- Capacity across passes (one ×3 dose resolving slots via passes 0, 1 and 2).
- Pass 2: the live 08:55/09:00/11:00 case; latest first; never forward; pass 1 beats
  pass 2; time-order replay; a future-dated dose; a legacy skip-at-now; the
  `visibleStart` bound.
- Missed: a past slot with a missed row stays overdue (existing `:251`); a future one
  reads upcoming.
- Segment limit (23:30 / 00:13 / dose at 00:10); per-segment twin suppression.
- Lifecycle clip; never-taken interval per-segment grids; interval carry-over and
  re-anchoring.
- **Stability across midnight and noon**, plus a seeded randomised test (~20,000
  fixed-time fixtures): each slot visible at 00:01 has the status it had at 23:59.
- **Differential against production**: a verbatim port of today's matcher over
  `[todayStart, end)` as the oracle; for fixtures with no dose in
  `[todayStart − 1h, todayStart)` and none on a slot instant, every today slot's status
  and `matchedDoseId` agree.
- **Slot-anchored property** (seeded): every offered button, applied, moves exactly its
  own row. Mutation: remove the simulation guard.
- Log-now placement: the common case; due-within-the-hour; 08:55/09:00 at 09:30; Earlier
  and hidden rows; the mixed interval + fixed medication (no target); the hour after a
  skip; interval supersession; the cooldown; a round trip (add the dose, recompute, the
  target is resolved).
- Window: London BST and the October transition; the 12h boundary to the millisecond;
  Godthab's Saturday 23:30 on Sunday.

**Time (`time.test.ts`)** — `formatDuration` short and long at every threshold
(59,999ms, 60,000ms, 45m, 60m, 2h15m, 23h59m, 24h, 24h59m, 25h, 49h); `formatDueIn`'s 11
assertions unchanged; `computeTimingStatus` cases deleted with the function.

**Composition (`dashboard-page-data.test.ts`, new)** — state boundaries at ±1h and +12h;
header kinds and copy; `covers`; backdated rows in Done with their day label; as-needed
only; `nextRefreshAt` (including the cooldown term). Replaces
`dashboard-timing-status.test.ts`.

**Load (`dashboard-load.test.ts`, new, fake-db)** — `getDosesInRange` is called with
`doseFetchFrom`/`doseFetchTo`; no `timingStatus` key.

**Actions (`dashboard-dose-actions.test.ts`)** — `forSlot` 409 with a fake clock (target
14:00 at 18:50, posted at 19:05); `takenAt` future (400) and stale (409); `takenAt` with
`forSlot` (400); missing `medicationId` (400, not 404); `doseId` returned. The auth-guard
suite's `skipDose` body still passes the schema; no new actions.

**Database-decided (`tests/unit/pg/`, PGlite)** — two "Took it at 09:00" posts produce
one taken row and one inventory decrement; two exact skips produce one skip; a skip over
a taken instant raises `SlotAlreadyTakenError`; a "Took it at" over a skip inserts.

**Reminders** — the 12h fixed-time cap (a slot 12h + 1ms old returns `null`, 12h − 1ms
returns the slot); interval rows unaffected.

**Components** — `status-marker-ssr.test.ts` (moved; fails if a new state lacks a label);
`DueCard` SSR + axe (`button-name`, `label-in-name`, `list`, `target-size`);
`KeyboardShortcuts` submits only `data-quick-log` forms; new chip and card pairs in
`theme-tokens.test.ts`.

**Pinned divergences** — the Analytics divergence (fixed 08:00/14:00/20:00, one ×3 at
20:30: all three taken on the dashboard), with a comment pointing at CLAUDE.md.

**E2E** — update the dose-logging selector in the same PR. `RUN_E2E` never runs in CI,
so nothing else catches it.

## Out of scope

- The due-ness unification (`due.ts`, `outstandingSlots`/`isOutstanding`, `lastEventAt`
  anchoring, the `startedAt` rule). When it lands, passes 0–2 and the segment limit move
  into `outstandingSlots`.
- Any schema migration; any `/api/v1` change.
- Forward matching: a dose taken more than 1h before its slot stays unmatched, and the
  slot still comes due.
- A batch "log all due" action; pagination or collapse for long lists.
- Projecting tomorrow beyond its first hour.
- Moving the Toast; removing the 1–9 shortcuts; `TimelineEntry`'s hover-revealed controls
  and `opacity-60` on `/log`.
- A future-`takenAt` bound on `logDose` for callers that do not send `forSlot` or
  `takenAt` from this page.

## Follow-ups

1. **A slot-derived Missed view in History** (D10), with nothing written to the database.
2. **Mac app port** of passes 0–2, the segment limit and reserved skips to
   `Schedule.swift`, with a shared fixture table. Capacity matching already diverges
   today.
3. **Reminder copy**: "last logged X ago" in `reminders.ts` and `email.ts` becomes
   inaccurate when a skip or "Took it at" records a past instant.
4. **Landing walkthrough**: `walkthrough/scenes/DashboardScene.svelte`,
   `parts/MyDaySection.svelte` and `parts/SummaryAndRefills.svelte` depict the old
   dashboard until redrawn.

## Docs to update in the same PR

- **CLAUDE.md**: the slot-matching rule and its single owner (window, lifecycle clip,
  passes 0–2, segment limit, reserved skips); the accepted dashboard/Analytics divergence
  beside the denominator rules; `DoseActionForm` as the single dashboard write path.
- **`2026-08-13-due-ness-unification-design.md`**: its dashboard deletions
  (`computeTimingStatus`, the `covered` merge) land early; `timingStatusFromSlots` and
  `classifyDueStatus` are deleted rather than moved or kept; its "exactly two cases"
  check loses the `time.test.ts` half; its resolution rule should adopt passes 0–2; the
  lifecycle clip lands early; "QuickLogBar keeps `MedicationTimingStatus`" is obsolete.
- **`tests/unit/dst-wall-clock.test.ts:515`**: the comment "My Day cannot show a slot
  that rolled out of the day" — the direct-call assertion still holds, but the dashboard
  now shows that slot under the window.
