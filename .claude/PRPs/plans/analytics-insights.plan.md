# Plan: Analytics & Insights — Custom Date Ranges, Side Effect Patterns, Enhanced Exports

## Summary

Enhance analytics with three improvements: (1) custom date range picker replacing preset-only periods, (2) side effect frequency patterns by medication, and (3) enhanced PDF/CSV exports that include side effects and analytics summary data. Builds on the existing analytics infrastructure.

## User Story

As a MedTracker user,
I want to analyze my medication data over custom date ranges, see side effect patterns by medication, and export comprehensive reports,
So that I can share informed data with my doctor and identify patterns in my medication experience.

## Metadata

- **Complexity**: Medium
- **Source PRD**: N/A (from opportunity map Theme F)
- **Estimated Files**: 8

---

## UX Design

### Interaction Changes

| Touchpoint       | Before                                   | After                                                                    | Notes                                                |
| ---------------- | ---------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Analytics period | 4 preset buttons (7d/30d/90d/1y)         | Presets + custom date range picker (from/to inputs)                      | Existing DateRange interface already in analytics.ts |
| Analytics page   | Doses only                               | + Side effect frequency chart + side effect frequency by medication      | New section below existing charts                    |
| PDF export       | Date, time, medication, dosage, quantity | + Side effects column + analytics summary page                           | Enhanced report                                      |
| CSV export       | 6 columns (no side effects)              | + Side effects column                                                    | Simple addition                                      |

---

## Files to Change

| File                                          | Action | Justification                                  |
| --------------------------------------------- | ------ | ---------------------------------------------- |
| `src/routes/(app)/analytics/+page.svelte`     | UPDATE | Add date range picker + side effects section   |
| `src/routes/(app)/analytics/+page.server.ts`  | UPDATE | Parse custom date range, load side effect data |
| `src/lib/server/analytics.ts`                 | UPDATE | Add side-effect predicates wired into `buildInsights` |
| `src/lib/server/export-pdf.ts`                | UPDATE | Add side effects column                        |
| `src/lib/server/export-csv.ts`                | UPDATE | Add side effects column                        |
| `src/routes/api/export/+server.ts`            | UPDATE | Pass side effect data to export functions      |
| `src/lib/server/doses.ts`                     | UPDATE | Add getDosesWithSideEffects for export         |
| `src/routes/(app)/settings/data/+page.svelte` | UPDATE | Add custom date range inputs for export        |

## NOT Building

- Goal setting UI (adherence goals require separate preference infrastructure)
- Real-time analytics updates (server-side rendering is sufficient)
- Charts library (using CSS-only visualizations matching existing patterns)
- Side effect prediction/ML (simple frequency counts only)
- Medication-timing adherence breakdown (complex, separate feature)

---

## Step-by-Step Tasks

### Task 1: Custom Date Range Picker on Analytics

- **ACTION**: Add from/to date inputs to analytics page. Update server load to parse custom range from URL params.
- **IMPLEMENT**:
  `analytics/+page.svelte` — add date inputs after preset buttons.
  `analytics/+page.server.ts` — parse `from` and `to` URL params, create DateRange, pass to all analytics functions.
- **GOTCHA**: The `DateRange` interface and `buildDateFilters` already support custom ranges in analytics.ts — just need to wire up the UI. Validate that `from < to` and range <= 365 days.
- **VALIDATE**: Select custom dates → analytics update. Clear dates → revert to preset.

### Task 2: Side Effect Analytics Predicates

- **ACTION**: Extend the existing pure `buildInsights` pipeline in `src/lib/server/analytics.ts` with small predicate functions (`(doseLogs, medications) => Insight | null`) that surface side effect frequency by medication. Do **not** introduce a separate `getSideEffectStats` — keep results deterministic and sortable, matching the pattern documented in CLAUDE.md.
- **IMPLEMENT**: Each predicate parses `doseLogs[].sideEffects` (JSONB), joins medication names by id, computes counts in JS, and returns an `Insight` with neutral, non-prescriptive wording (e.g. "X reported alongside Y" — never "X causes Y" or "correlates with"). Predicates are registered with `buildInsights` so they slot in beside existing rules.
- **GOTCHA**: Side effects are JSONB arrays — handle null and empty arrays as "no contribution". Process in JS, not SQL — JSONB array unnesting in Drizzle is awkward. Keep `Insight` typing strict so outputs remain consistent and sortable by frequency.
- **VALIDATE**: Type-check clean. New predicates appear in the InsightsCard ordering. Wording is descriptive, not causal.

### Task 3: Side Effect UI Section on Analytics Page

- **ACTION**: Add a side-effect frequency chart and a "side effect frequency by medication" table below existing charts.
- **IMPLEMENT**: Horizontal bar chart (CSS-only, matching existing pattern). Only show section if side effects exist. Table headings stay neutral ("Medication / Reported alongside / Count") — avoid causal framing.
- **GOTCHA**: Use warning colour for bars (side effects are cautionary). Max bar width based on highest count.
- **VALIDATE**: Log doses with side effects → analytics shows frequency chart and per-medication table.

### Task 4: Enhanced PDF Export with Side Effects

- **ACTION**: Add side effects line under each dose entry in PDF export.
- **IMPLEMENT**: After each dose line, if sideEffects present, add smaller-font line listing them.
- **GOTCHA**: Use smaller font size. Truncate to first 5 per dose if list is long.
- **VALIDATE**: Export PDF → side effects appear under relevant dose entries.

### Task 5: Enhanced CSV Export with Side Effects

- **ACTION**: Add "Side Effects" column to CSV export.
- **IMPLEMENT**: Add header column. Format as semicolon-separated within cell.
- **GOTCHA**: Use semicolons within the cell (not commas). Escape quotes in effect names.
- **VALIDATE**: Export CSV → "Side Effects" column populated.

---

## Acceptance Criteria

- [ ] Custom date range picker works on analytics page
- [ ] Side effect frequency chart shows most common effects
- [ ] Side effect frequency by medication visible
- [ ] PDF export includes side effects
- [ ] CSV export includes side effects column
- [ ] Preset period buttons still work alongside custom range
- [ ] No type errors, all tests pass

## Risks

| Risk                                          | Likelihood | Impact | Mitigation                                       |
| --------------------------------------------- | ---------- | ------ | ------------------------------------------------ |
| Large JSONB side effects data slows analytics | Low        | Medium | JS processing is fast; only heavy users hit this |
| Custom date range validation edge cases       | Low        | Low    | Validate from < to and <= 365 days               |
| PDF layout breaks with many side effects      | Medium     | Low    | Truncate to first 5 per dose                     |
