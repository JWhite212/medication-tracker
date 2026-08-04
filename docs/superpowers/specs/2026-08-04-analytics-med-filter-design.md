# Analytics medication filter — design

**Date:** 2026-08-04
**Status:** Implemented (autonomous session; assumptions listed below for review)

## Goal

Let the user scope the Analytics page to one or many medications, composing with
the existing timeframe controls (period pills and custom from/to range). All
stats, charts, insights, and trends reflect the selection.

## Approaches considered

1. **Widen the shared filter object (chosen).** Every analytics query already
   takes an optional `range?: DateRange` as its 4th parameter and funnels
   through `buildDateFilters`. Introduce `AnalyticsFilter extends DateRange`
   with an optional `medicationIds?: string[]`, widen the parameter type, and
   apply `inArray(dose_logs.medication_id, ids)` in `buildDateFilters`. Existing
   callers (inventory, export-pdf) pass `DateRange`, which remains assignable —
   zero churn outside analytics. One choke point for the dose-log side; the two
   places that compute _expected_ doses from medications/schedules
   (`getDailyAdherenceSeries` active-med query, page-server `scheduledHours` /
   refill insight input) are scoped explicitly.
2. **Fifth positional parameter on every function.** More churn, worsens the
   existing `(userId, days, timezone, range, options)` sprawl. Rejected.
3. **Client-side filtering.** Impossible — expected-dose math and previous-period
   comparisons are server-side; violates the app's server-first architecture.
   Rejected.

## URL contract

- Repeated query params: `?med=<id>&med=<id2>`, read via
  `url.searchParams.getAll("med")`. Composes with `period`/`from`/`to` because
  `setPeriod`/`setDateRange` mutate only their own params.
- Server validation: intersect requested IDs with the user's own medications
  (pure helper `resolveMedicationFilter`). Unknown/garbage IDs are dropped; if
  nothing valid remains the filter is treated as absent — same fall-through
  philosophy as the bounds-checked date params. Queries stay user-scoped either
  way, so this is UX hygiene, not a security boundary.

## Server changes

- `src/lib/server/analytics.ts`: `AnalyticsFilter` type; `buildDateFilters`
  gains the `inArray` condition (empty/absent ⇒ no condition);
  `getDailyAdherenceSeries` scopes its active-medication (expected-per-day)
  query by the same IDs so expected and actual stay consistent.
  `getPerMedicationStats`, `getDoseStatusBreakdown`, `getScheduleVariance`,
  `getSideEffectStats`, and the distribution queries inherit the filter through
  `buildDateFilters` (schedule lookups are per-dose-row and self-scope).
- `analytics/+page.server.ts`: fetch the user's medications (id, name, colour,
  isArchived; active first) for the picker; resolve `?med=` params; pass the
  filter into **all** analytics calls including the previous-period pair;
  restrict `scheduledHours` and the refill-insight count to the selection;
  return `medications` and `selectedMedIds`.

## UI

New `src/lib/components/MedicationFilterSelect.svelte` (Svelte 5 runes):
popover with a checkbox row per medication (colour dot, name, archived badge),
trigger label "All medications" / single name / "N medications", "Clear" row
when filtered. Toggling applies immediately by navigating with updated `med`
params — same-route `goto` keeps component state, so the popover stays open
across reloads. Local `$state` mirrors `data.selectedMedIds` for instant
checkbox feedback. Escape and click-outside close; entirely keyboard operable.
Placed in the filter row on the Analytics page beside the period pills.

## Semantics when a filter is active

- Streak, totals, adherence, sparklines, distributions, side effects, insights,
  and trends are all computed from the filtered inputs — they read as "for the
  selected medications". The refill insight counts only selected meds.
- A selected medication with zero logs in range still yields "No data yet" in
  the per-med chart (pre-existing behaviour for the unfiltered page, unchanged).
- Archived medications appear in the picker (labelled) so historical analysis
  remains possible.

## Testing

- Unit tests for `resolveMedicationFilter` (dedupe, unknown-ID drop,
  empty ⇒ undefined) and for adherence-series medication scoping via the
  established `vi.mock("$lib/server/db")` pattern.
- `npm run check`, `vitest run`, and `npm run build` gate the PR.

## Assumptions made without live user input

- Repeated `med` params (not comma-joined) for the URL contract.
- Immediate-apply on toggle rather than an Apply button.
- Invalid selection falls back to "all medications" rather than an error state.
- Archived meds are selectable; pure-PRN meds are selectable (their doses count
  even though they contribute no expected doses).
