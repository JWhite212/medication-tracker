# My Day — quantity-aware, vicinity-bounded slot matching

**Date:** 2026-08-04
**Status:** Approved

## Problem

On the Dashboard "My Day" timeline, a scheduled medication can have several dose
slots in a day (e.g. `08:55`, `09:00`, `11:00`). When the user takes several units
at once and logs a single dose with `quantity: 3`, only **one** slot is marked
taken. The other nearby slots stay `overdue`/`upcoming` even though the user has
physically taken enough to cover them.

**Root cause:** `computeScheduleSlots` (`src/lib/utils/schedule.ts`) matches each
dose row to **at most one** slot via a `usedDoseIds` set, and ignores the dose's
`quantity` entirely. The data model implicitly assumes 1 dose row ↔ 1 slot.

## Decision

A logged dose satisfies scheduled slots **near when it was taken**, up to the
number of units taken:

- **Match scope — nearby slots only.** A `quantity: N` dose can fill up to `N`
  unfilled slots whose expected time is within the existing ±1h tolerance
  (`MATCH_TOLERANCE_MS`) of the dose's `takenAt`. Slots outside that window (e.g.
  an `11:00` slot vs a `09:00` log) remain their own `upcoming`/`overdue` entry —
  they are genuinely-separate doses and must never be auto-marked taken.
- **Display — unchanged.** Slots still render as separate rows in
  `MyDayTimeline.svelte`. This is a matching-logic change only.

### Why this scope (safety)

This is a medication tracker holding health data. Binding a multi-unit log only to
slots within ±1h of the actual `takenAt` guarantees a morning log can never
green-check a genuinely-later dose the user has not yet taken. Capacity is bounded
by units actually recorded.

## Design

Scope of change: **only** `computeScheduleSlots` in `src/lib/utils/schedule.ts`.
No schema, UI, validation, or server-action changes. `matchedDoseId` stays on the
slot (it is only ever written, never read — multiple slots may share a dose id).

Replace the `usedDoseIds` loop with capacity-based spreading:

1. **Capacity per dose.**
   - `taken` → `quantity` (integer column, ≥ 1).
   - `skipped` / `missed` → `1` (a skip/miss can only ever clear one slot).
   - Track `remaining` per dose id, initialised to capacity.
2. **Walk the med's deduped slots chronologically.** For each slot:
   - Candidates = doses with `remaining > 0` and
     `|dose.takenAt − slot| ≤ MATCH_TOLERANCE_MS`.
   - Pick the best candidate: **prefer `taken` over `skipped`/`missed`, then
     nearest `takenAt` to the slot**, tie-break by dose id for determinism.
   - If found: decrement its `remaining`; derive slot status from that dose's
     status (`taken`, `skipped`, `missed` → `overdue`) — same mapping as today.
   - If none: `overdue` when slot time ≤ now, else `upcoming` — unchanged.

### Behaviour

| Log                             | Slots 08:55 / 09:00 / 11:00 | Outcome                                                                         |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------- |
| ×3 @ 09:00                      |                             | ✓ 08:55, ✓ 09:00, ○ 11:00 (2h away → own dose)                                  |
| ×1 @ 09:00                      |                             | fills exactly one slot — identical to today                                     |
| ×3 @ 09:00, only 2 nearby slots |                             | fills 2; 3rd unit unused (inventory already decremented at log time, untouched) |

### Known limitation (accepted, YAGNI)

Greedy chronological + nearest-first is not globally optimal when two _separate_
multi-unit logs have overlapping ±1h windows (a contrived case): one unit may go
unused while a slot stays unmatched. Real usage — one multi-unit log covering a
cluster — is handled exactly. No bipartite-matching machinery.

## Testing

Keep every existing `tests/unit/schedule.test.ts` case. Add:

- `quantity: N` fills `N` nearby slots, not `N+1`.
- `quantity: N` leaves an out-of-vicinity slot (`11:00` vs `09:00` log) unmatched.
- `quantity: N` with fewer than `N` nearby slots fills what it can; extra ignored, no crash.
- `skipped` dose (`quantity` irrelevant) clears at most one slot.
- `taken` preferred over `skipped` when both are in-vicinity candidates for a slot.
- `quantity: 1` regression — unchanged single-slot behaviour.

## Out of scope

- Any change to how doses are logged (QuickLogBar, slot Log button, med form).
- Merging/collapsing clustered slots into a single row.
- Investigating why a single med might emit two slots ~5 min apart (possible
  interval-drift) — noted for a separate follow-up.
