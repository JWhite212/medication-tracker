# Plan: Analytics Overhaul + Cross-App Polish

## Summary

Make the Analytics page genuinely useful (not "slightly useful") and apply the same lift to Dashboard, Medications, and Log pages. The headline bug — the Day-of-Week and Time-of-Day distribution charts being visually empty — is a CSS layout bug, not a data bug. Beyond fixing it, the Analytics page is missing the things that turn raw counts into meaning: a narrative summary, an adherence trend over time, a missed/skipped breakdown, and refill forecasting that surfaces on the Dashboard. This plan delivers those, reuses existing patterns (CSS-only viz, server-first loads, Svelte 5 runes), and ships in a single feature branch broken into 4 reviewable PRs.

## User Story

As a MedTracker user,
I want my Analytics screen to tell me what's going on with my medications — not just count rows — and I want the rest of the app (Dashboard, Medications list, Log) to reflect the same insight at the right surfaces,
So that I can act on patterns (refills, adherence drops, side effects) without having to interpret raw bar charts myself.

## Metadata

- **Complexity**: Medium-Large
- **Total steps**: 10 (split across 4 PRs)
- **Estimated files touched**: ~20 files across `src/`
- **Source plans**: builds on top of the (mostly-done) `analytics-insights.plan.md`; does not duplicate
- **Branch strategy**: single base branch `feat/analytics-and-app-polish` with 4 stacked PRs, or one PR if the user prefers; default to stacked

---

## Root-Cause Diagnosis (recorded so future readers don't re-investigate)

**Empty Day-of-Week / Time-of-Day charts** — confirmed via static analysis of `src/routes/(app)/analytics/+page.svelte:134-172`:

The bars are rendered as:

```svelte
<div class="flex h-32 items-end gap-2">          <!-- outer: fixed h-32 -->
  {#each ... as dow}
    <div class="flex flex-1 flex-col items-center gap-1">  <!-- column wrapper -->
      <div class="bg-accent/60 w-full rounded-t" style="height: {pct}%"></div>
      <span ...>{label}</span>
    </div>
  {/each}
</div>
```

`items-end` on the outer flex row sets `align-self: flex-end` on each column, which in turn stops them from stretching vertically. The column wrapper therefore gets a content-driven height (just `bar + gap + label`). The bar's `height: X%` then resolves against an auto-height parent and collapses to `0`. This matches the user's report that the charts "don't show anything currently". Working comparison: `AdherenceChart.svelte` uses `width: X%` inside a fixed-height (`h-2`) bar — width % resolves against an auto-height parent, so it works.

**Fix** (Step 1 below): give each column wrapper an explicit `h-full` and stack from the bottom with `justify-end` instead of relying on outer `items-end`. Same fix applies to both charts.

---

## UX Changes

| Touchpoint                     | Before                                                                | After                                                                                                          | Notes                                              |
| ------------------------------ | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Analytics — Day-of-week chart  | Visually empty bars                                                   | Bars render with proportional heights, hovers show count, weekend column subtly tinted                         | CSS fix + small UX upgrade                         |
| Analytics — Time-of-day chart  | Visually empty bars                                                   | Bars render; scheduled-time tick marks overlay; "avg minutes off-schedule" stat                                | Same CSS fix + scheduled overlay                   |
| Analytics — Top of page        | Stat cards only                                                       | New "Insights" card with 3–5 plain-language observations (e.g. "Adherence up 8% vs. last 30 days")             | Server-computed, deterministic                     |
| Analytics — Trend arrows       | Single up/down arrow next to a number                                 | Inline sparkline for both adherence and dose volume; arrow remains as a label                                  | New `Sparkline.svelte` component                   |
| Analytics — Status breakdown   | Not shown                                                             | New stacked horizontal bar: taken / skipped / missed                                                           | Reuses existing `getDoseStatusBreakdown`           |
| Analytics — Empty state        | Plain text "No data yet" buried in two cards                          | Friendly empty state when fewer than 3 doses logged: "Log a few doses to see your analytics"                   | Uses existing illustration assets                  |
| Dashboard — Refill forecast    | None (low-inventory only fires via email job)                         | Compact "Refills" card listing meds with ≤7 days of stock left, severity-tinted; click → medication detail     | Reuses existing days-until-refill logic            |
| Medications list — per-med row | Static name + colour + dose                                           | Adds 14-day adherence sparkline + days-until-refill chip + adherence %                                         | Reuses `Sparkline.svelte`                          |
| Log — filters                  | Medication + date range only                                          | Adds status filter (taken/skipped/missed), "with side effects" toggle, and a notes search box                  | URL-driven, server-load reads params               |
| Log/Analytics/Medications/Dashboard — empty states | Inconsistent (some illustrations, some plain text)            | Unified `EmptyState.svelte` component using existing illustration assets where available                        | One reusable component                             |

---

## Files to Change

| File                                                  | Action | Justification                                                               |
| ----------------------------------------------------- | ------ | --------------------------------------------------------------------------- |
| `src/routes/(app)/analytics/+page.svelte`             | UPDATE | Bug fix; insights card; sparkline trends; status breakdown; empty state     |
| `src/routes/(app)/analytics/+page.server.ts`          | UPDATE | Wire new analytics functions (insights, daily series, status breakdown)     |
| `src/lib/server/analytics.ts`                         | UPDATE | Add `getDailyAdherenceSeries`, `getInsights`, `getMissedDosePatterns`       |
| `src/lib/server/inventory.ts`                         | CREATE | `getRefillForecast(userId)` — days-until-refill per med, severity tier      |
| `src/lib/components/Sparkline.svelte`                 | CREATE | Reusable inline-SVG sparkline (CSS-only, no chart library)                  |
| `src/lib/components/EmptyState.svelte`                | CREATE | Standardised empty state with optional illustration + CTA                   |
| `src/lib/components/InsightsCard.svelte`              | CREATE | Renders the insights list returned from server                              |
| `src/lib/components/StatusBreakdownBar.svelte`        | CREATE | Stacked horizontal bar for taken / skipped / missed                         |
| `src/routes/(app)/dashboard/+page.svelte`             | UPDATE | Add Refills card                                                            |
| `src/routes/(app)/dashboard/+page.server.ts`          | UPDATE | Load refill forecast                                                        |
| `src/routes/(app)/medications/+page.svelte`           | UPDATE | Per-row sparkline + refill chip + adherence %                               |
| `src/routes/(app)/medications/+page.server.ts`        | UPDATE | Load per-med 14-day series + refill data                                    |
| `src/routes/(app)/log/+page.svelte`                   | UPDATE | New filters (status, side effects, notes search), unified empty state       |
| `src/routes/(app)/log/+page.server.ts`                | UPDATE | Read new filter params, query accordingly                                   |
| `src/lib/server/doses.ts`                             | UPDATE | Extend `getDoseHistory` with status / side-effect / notes-search filters    |
| `src/lib/utils/validation.ts`                         | UPDATE | Zod schema for log filter params (defensive parsing)                        |
| `tests/unit/analytics.test.ts`                        | UPDATE | Tests for new analytics functions                                           |
| `tests/unit/inventory.test.ts`                        | CREATE | Tests for `getRefillForecast`                                               |
| `tests/unit/sparkline.test.ts`                        | CREATE | Snapshot test for Sparkline path generation                                 |
| `CLAUDE.md`                                           | UPDATE | Add notes for Sparkline / EmptyState / refill forecast patterns             |

## NOT Building (explicit out-of-scope)

- New charts library (Chart.js, layerchart, etc.) — sticking with the codebase's CSS/inline-SVG pattern.
- ML / predictive models for side effects, adherence, or interactions.
- Goal-setting UI (adherence targets, streak goals) — needs separate preference work.
- A "compare to others" benchmark (privacy-sensitive; out of scope).
- Push-notification-driven refill nudges — only surfacing refill data on Dashboard; the email cron already handles low-inventory alerts.
- WebSocket / real-time updates on Analytics — server-side rendering is sufficient.
- Dose log bulk-edit or bulk-delete UI on Log page.
- Schedule editing UI changes — schedules table is canonical and the existing form is fine.
- Column rename / drop of the deprecated `medications.scheduleType` and `scheduleIntervalHours` — keep deferring per existing comment in `schema.ts`.

---

## Step-by-Step Tasks

Each step is sized to be implementable in isolation with the context provided in this file. Steps within a PR group can be reordered if needed; PRs are independent of each other once Step 1 is done.

### PR 1 — Analytics Bug Fix + Core Insights (Steps 1–4)

#### Step 1 — Fix Day-of-Week and Time-of-Day distribution chart layout

- **Why**: The user-reported headline bug. Bars currently collapse to 0px because the column wrapper has no defined height (see Root-Cause Diagnosis above).
- **Action**: In `src/routes/(app)/analytics/+page.svelte`, change both chart blocks. Replace the outer `items-end` flex with `flex` (no items-end) and make each column wrapper `flex h-full flex-col items-center justify-end gap-1`. The bar div keeps `height: X%` and now resolves against the parent's full `h-32`.
- **Implement** (DoW chart, lines ~134-151; same shape for hourly):
  ```svelte
  <div class="flex h-32 gap-2" style="min-width: 20rem">
    {#each Array.from({ length: 7 }, (_, i) => i) as dow}
      {@const count = data.dayOfWeek.find((d) => d.dayOfWeek === dow)?.count ?? 0}
      <div class="flex h-full flex-1 flex-col items-center justify-end gap-1">
        <div
          class="bg-accent/60 w-full rounded-t transition-all"
          style="height: {(count / maxD) * 100}%"
          title="{DAY_LABELS[dow]}: {count}"
        ></div>
        <span class="text-text-muted text-[10px]">{DAY_LABELS[dow]}</span>
      </div>
    {/each}
  </div>
  ```
  Hoist `maxD` and `maxH` to a `$derived` outside the `{#each}` instead of recomputing per iteration.
- **Gotcha**: `{@const}` recomputed inside each iteration is wasteful — use `$derived` at the script top: `const maxD = $derived(Math.max(...data.dayOfWeek.map((d) => d.count), 1))`.
- **Validate**:
  - `npm run dev`, log doses across multiple days/hours via the Quick Log bar, navigate to `/analytics` — bars now show proportional heights for both charts.
  - `npx svelte-check` clean.
  - Add a Vitest component test (or screenshot smoke) asserting that with `{ dayOfWeek: 1, count: 5 }` the bar element receives a non-zero `height` style. The simplest version reads the rendered HTML and asserts a regex match on the inline style.

#### Step 2 — `Sparkline.svelte` reusable component

- **Why**: Multiple steps below (3, 7, and the dose-volume trend) need a small inline trend line. Centralise rather than re-emit SVG paths everywhere.
- **Action**: Create `src/lib/components/Sparkline.svelte`. Pure inline-SVG, accepts a `number[]`, optional `color`, `width`, `height`, and `aria-label`. Generates a smooth `<path>` plus an optional area fill underneath.
- **Implement**:
  - Props: `{ values: number[]; color?: string; width?: number = 80; height?: number = 24; ariaLabel?: string; fill?: boolean = true }`.
  - Compute `min`, `max`, `range`. Normalise each value to `[0, height]`. Build an SVG `path d` attribute with a leading `M` and subsequent `L` commands.
  - When all values equal, render a single horizontal line at mid-height.
  - When `values.length < 2`, render a single dot/circle.
  - `<svg role="img" aria-label={ariaLabel}>...</svg>`.
- **Gotcha**: SVG `<path>` rounding to integer pixels improves crispness; round to one decimal to avoid jaggies.
- **Validate**: Add `tests/unit/sparkline.test.ts` — snapshot test for `[1, 5, 3, 8, 2]`, `[]`, `[5]`, and `[5, 5, 5]` shapes; assert `<path>` `d` attribute matches expected coordinates.

#### Step 3 — Replace single-arrow trend with adherence/dose sparklines

- **Why**: A standalone "↑8%" tells a user nothing about volatility or recent direction. A 30-point sparkline tells a story at a glance.
- **Action**:
  1. In `src/lib/server/analytics.ts`, add `getDailyAdherenceSeries(userId, period, timezone, range?)`. For each day in the period, compute `taken / expected` capped at 100. Returns `{ date: string; adherence: number; doseCount: number }[]` ordered ascending by date.
  2. Wire into `analytics/+page.server.ts` and pass through to the page.
  3. In the Adherence stat card and Doses stat card, render the existing number + arrow PLUS a 30-point `Sparkline` underneath sized at `w-full h-6`.
- **Implement**: Compute the daily series in JS from the existing `getDailyDoseCounts` plus the per-medication expected-per-day from `expectedPerDayForSchedules` × number of meds active that day. For simplicity, multiply expected-per-day by total active medications across the period and use that as the daily expected. (Document this approximation — schedule activations within the period are not tracked granularly yet.)
- **Gotcha**: `expectedPerDayForSchedules` requires schedule rows. Use `getSchedulesForUser` once per request and pass the map to the new function — don't run it per-day.
- **Validate**:
  - Unit test in `tests/unit/analytics.test.ts`: stub `db` and assert series length equals period length, all adherence values are 0–100, and dose counts sum to `totalDoses`.
  - Visual: stat cards now show an inline sparkline; adherence sparkline trends should match the existing arrow direction.

#### Step 4 — Insights card (server-computed narrative)

- **Why**: Bare numbers force the user to interpret. A short list of plain-language observations turns the page from a dashboard into a report.
- **Action**:
  1. Add `getInsights(userId, period, timezone, range?, prevRange?)` to `analytics.ts`. Returns `Array<{ id: string; severity: 'info' | 'positive' | 'warning'; text: string }>`. Picks 3–5 from a fixed set of deterministic rules; never ML.
  2. Create `InsightsCard.svelte` that takes the array and renders a list with a coloured dot per severity.
  3. Render the card directly under the page header, above the stat strip.
- **Insight rules** (all evaluated, top 5 by priority kept):
  - "Adherence improved/declined N% vs. previous period" — only when both periods have ≥3 medications with expected doses.
  - "Highest-adherence medication is X (M%)" — when at least 2 meds have data.
  - "Lowest-adherence medication is X (M%)" — only emit if M < 80 AND there are ≥2 meds.
  - "You miss the most doses on {weekday}" — only if missed-by-DoW data has ≥3 missed doses on the worst day, AND it exceeds the average by ≥30%.
  - "Most consistent dosing time is {hour}:00" — only if a single hour bucket has ≥30% of all doses.
  - "{N} medications need a refill within 7 days" — only if N ≥ 1.
  - "{N} side effects logged this period — most common: {name}" — only if total ≥ 3.
  - "Streak: {N} days" — only if N ≥ 3.
- **Implement**: Each rule is a small pure function `({stats, prevStats, ...}) => Insight | null`. Filter null. Sort by `severity === 'warning' ? 0 : severity === 'positive' ? 1 : 2`, then by absolute magnitude. Slice 5.
- **Gotcha**: All copy needs the existing `MedicalDisclaimer` semantics; keep observations factual ("you logged X") not prescriptive ("you should X").
- **Validate**:
  - Unit tests for each rule with edge inputs (zero meds, single med, all-zero adherence, etc.).
  - Visual: cards appear in priority order; with empty data, the card hides (don't render an empty card).

---

### PR 2 — Distribution Improvements + Status Breakdown (Steps 5–6)

#### Step 5 — Schedule overlay + variance stat on Time-of-Day chart

- **Why**: Currently the chart shows when you logged doses but not when you were *supposed* to. The interesting question — "how close to schedule am I?" — is invisible.
- **Action**:
  1. In `analytics/+page.server.ts`, also load schedules via `getSchedulesForUser` and pass `scheduledHours: number[]` (extracted from `fixed_time` schedules' `timeOfDay HH:mm`).
  2. In the chart, add a tick mark element above the bars at each `hour ∈ scheduledHours` (small `▼` glyph or a vertical accent line).
  3. Add a "Avg minutes off-schedule" line under the chart. Computed in `analytics.ts` as `getScheduleVariance(userId, period, timezone, range?)`: for each taken dose with a `fixed_time` schedule, find the closest scheduled time and compute the abs-minute delta; return the mean.
- **Gotcha**: `interval` and `prn` schedules don't have a `timeOfDay`, so they are excluded from variance. Document this on the stat label ("for fixed-time schedules only").
- **Validate**:
  - Unit test for `getScheduleVariance` with synthetic dose timestamps and a single 08:00 schedule.
  - Visual: tick marks line up on the chart at scheduled hours; variance number is sane.

#### Step 6 — Status breakdown card (taken / skipped / missed)

- **Why**: The schema already records `status` and analytics already exposes `getDoseStatusBreakdown`, but the UI never surfaces missed/skipped counts to the user. A single stacked bar communicates this in 3 seconds.
- **Action**:
  1. In `analytics/+page.server.ts`, call `getDoseStatusBreakdown` and pass through.
  2. Create `StatusBreakdownBar.svelte` — single horizontal bar split into 3 coloured segments (success/warning/danger) sized by ratios. Tooltip on hover shows counts.
  3. Render between the Adherence chart and Day-of-Week chart.
- **Implement**: Reuse Tailwind tokens `bg-success`, `bg-warning`, `bg-danger`. Cap the missed count at `expected - taken - skipped` (already handled in `analytics.ts`).
- **Gotcha**: When `expectedTotal === 0` (e.g. only PRN meds), hide the card rather than rendering a meaningless empty bar.
- **Validate**: Unit test asserting widths sum to 100%; visual smoke check with mixed taken/skipped.

---

### PR 3 — Dashboard Refill Forecast + Medications List Polish (Steps 7–8)

#### Step 7 — Refill forecast on Dashboard

- **Why**: Users will only check email-based low-inventory alerts after running out. Surfacing it on the Dashboard turns it into a passive prompt.
- **Action**:
  1. Create `src/lib/server/inventory.ts` with `getRefillForecast(userId)`. For each non-archived medication that has `inventoryCount != null`:
     - Compute `dosesPerDay` from `getSchedulesForUser` map for `scheduled` meds (using `expectedPerDayForSchedules`).
     - For PRN meds, use 30-day historical average of taken doses (matches the existing rule in `medications.ts` per CLAUDE.md "Days until refill").
     - Compute `daysUntilRefill = inventoryCount / dosesPerDay` (rounded down). Severity = `<=3 critical`, `<=7 warning`, `<=14 watch`, else `ok`.
     - Return only meds at `critical | warning | watch` sorted by ascending days.
  2. Load it in `dashboard/+page.server.ts` and render under the SummaryStrip as a `Refills` card. Each row: medication colour dot, name, "{N} days left", severity-tinted background. Click → `/medications/{id}`.
- **Gotcha**: Existing rule for fresh meds ("use schedule rate, not 30-day average for `scheduled`") is in `medications.ts` — extract that logic into `inventory.ts` and have both call the new module to avoid duplicating intent.
- **Gotcha**: PRN medications with a 30-day average of `0` doses → infinite days left; treat as "ok" and don't surface.
- **Validate**:
  - Unit tests in `tests/unit/inventory.test.ts` for: scheduled med with stock=60 / interval=24h → 60 days; scheduled with stock=10 / interval=12h → 5 days; PRN with 30 doses in 30 days and stock=15 → 15 days.
  - Visual: card shows up only when at least one med is in critical/warning/watch tier.

#### Step 8 — Per-medication sparkline + refill chip on Medications list

- **Why**: The Medications list is currently a static catalog. Adding a 14-day adherence trend per row turns it into an at-a-glance health check.
- **Action**:
  1. In `medications/+page.server.ts`, additionally compute, for each non-archived medication, a 14-day daily-adherence series (reuse Step 3's helper, scoped per-med) and the days-until-refill from Step 7. Cap to non-archived meds.
  2. In `medications/+page.svelte`, add to each card: 14-day `<Sparkline>`, `XX% adherence` chip, days-until-refill chip with severity colour (only when not "ok").
  3. Adherence chip click → `/analytics?medication={id}` (deep-link reserved for a later iteration; keep it as a static label for now).
- **Gotcha**: The list page may render dozens of meds. Run all per-med computations in a single SQL query (group by medicationId, day) instead of N+1 queries. Process in JS to fan out into per-med arrays.
- **Gotcha**: The deprecated `scheduleType`/`scheduleIntervalHours` columns are still authoritative for some users; keep using `getSchedulesForUser` first and fall back to legacy columns (matches existing code in `getPerMedicationStats`).
- **Validate**: Visual: each med card shows a small sparkline + adherence chip. Type-check clean. Performance: fewer SQL round-trips than meds count.

---

### PR 4 — Log Filters + Empty States + Verification (Steps 9–10)

#### Step 9 — Log page filters + unified empty states

- **Why**: Log already has medication + date range filters. Adding status / side-effects / notes-search lets users find e.g. "skipped doses where I noted nausea". Unified empty states finish the polish pass.
- **Action**:
  1. In `validation.ts`, add `logFilterSchema` for the new params: `status: enum('taken','skipped','missed','any')` default `any`; `withSideEffects: boolean` default false; `q: string` (notes search), max 100 chars.
  2. In `log/+page.server.ts`, parse new params via Zod (default-parse on failure) and pass to `getDoseHistory` (extended).
  3. In `doses.ts:getDoseHistory`, accept the new filters: status `eq`, `with side effects` → `isNotNull(doseLogs.sideEffects)` AND `jsonb_array_length(side_effects) > 0` (use raw SQL for the jsonb check), notes search → `ilike(doseLogs.notes, '%q%')` (case-insensitive partial match).
  4. UI: add a status `<select>` next to the medication select, a "with side effects" checkbox, and a notes search input.
  5. Create `src/lib/components/EmptyState.svelte` — props: `{ illustration?: string; title: string; body?: string; action?: { href?: string; label: string; onclick?: () => void } }`. Use it on Log, Analytics, Medications-when-empty, and Dashboard-when-empty (replacing or wrapping the existing `OnboardingWelcome` per-page calls only if it makes them simpler — don't gut OnboardingWelcome).
- **Gotcha**: SQL `ilike` with user-provided `q` must escape `%` and `_` to prevent the user from accidentally matching everything. Easiest: replace `%` with `\%` and `_` with `\_` before wrapping in `%...%`.
- **Gotcha**: `jsonb_array_length` returns 0 for an empty array `[]` — not null. The existing schema sets `sideEffects` nullable; both null and `[]` should be treated as "no side effects".
- **Validate**:
  - Unit tests for `getDoseHistory` with each new filter.
  - Manual test: filter to "skipped only" + "with side effects" → returns the right subset.
  - All four pages render the unified `EmptyState` when their respective dataset is empty.

#### Step 10 — Verification, tests, and CLAUDE.md update

- **Why**: User explicitly required "without breaking or leaving existing code and behaviours worse than before". This step is the gate that proves it.
- **Action**:
  1. Run `npm run check` — zero new TypeScript errors.
  2. Run `npx vitest run` — all existing tests pass plus the new ones.
  3. Run `npm run lint` and `npm run format:check`.
  4. Manual smoke test:
     - `/analytics` with empty state → friendly empty state, no broken charts.
     - `/analytics` with data → bars render, sparklines render, insights card appears, status breakdown shows.
     - `/dashboard` with low-inventory med → Refills card appears.
     - `/medications` → per-row sparkline + refill chip render.
     - `/log` → status filter + side-effects toggle + notes search work.
  5. Update `CLAUDE.md`:
     - Add a Components section: "Sparkline" and "EmptyState" with usage one-liners.
     - Add "Refill forecast lives in `src/lib/server/inventory.ts` — single source of truth, called from both `medications.ts` and `dashboard`."
     - Update Gotchas: SQL `ilike` escape note; jsonb_array_length empty-array note.
- **Validate**: Final `git diff` review. No `console.log`. No commented-out code. PR descriptions reference this plan section by section.

---

## Acceptance Criteria

- [ ] Day-of-Week and Time-of-Day distribution charts render bars proportional to data
- [ ] Adherence and Dose stat cards include inline sparklines
- [ ] Insights card renders 3–5 plain-language observations at the top of `/analytics` when data is sufficient
- [ ] Status breakdown bar shows taken / skipped / missed with correct ratios
- [ ] Schedule tick marks visible on Time-of-Day chart for fixed_time schedules; variance stat displays
- [ ] Dashboard shows a Refills card when at least one med is in critical/warning/watch tier
- [ ] Medications list shows a 14-day sparkline + refill chip per row (when applicable)
- [ ] Log page supports filtering by status, "with side effects", and notes search
- [ ] All pages with empty data render a unified `EmptyState` component
- [ ] No new TypeScript errors; all existing and new unit tests pass
- [ ] CLAUDE.md updated with new patterns

---

## Risks

| Risk                                                           | Likelihood | Impact | Mitigation                                                                                       |
| -------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| CSS fix in Step 1 changes vertical rhythm, regresses other UI | Low        | Low    | Scope change is local to those two cards; visual smoke test                                       |
| Step 3 daily series approximation is misleading for users who added meds mid-period | Medium | Medium | Document approximation in CLAUDE.md gotcha; render the sparkline as supplementary, not primary    |
| Insight rules feel "AI-ish" or pseudo-medical                  | Medium     | Medium | Use factual phrasing only; review copy with user before merge                                     |
| Sparkline component performance with many rows on Medications  | Low        | Low    | Inline SVG is cheap; max ~50 sparklines per page in practice                                      |
| `ilike` notes search hits without index — slow at scale        | Low        | Low    | Acceptable at single-user scale; if it bites, add a `gin (notes gin_trgm_ops)` index later        |
| Accidentally surfacing other users' data via new queries       | Critical   | Critical | All new queries scoped by `userId`; reviewer must confirm in PR                                  |
| `jsonb_array_length` SQL not behaving across environments     | Low        | Medium | Vitest mocks the `db` import for unit tests; manual integration test in dev DB required          |
| Drizzle `numeric` column footgun (returns string)              | Medium     | Medium | CLAUDE.md already documents this — all new arithmetic goes through `Number(...)` first           |

---

## Sequencing & Parallelism Notes

- Step 1 must land first (or at least be on the same PR) — every other Analytics-page change touches the same file.
- Steps 2 (Sparkline component) is a dependency of Steps 3, 7, 8.
- Steps 5, 6 are independent of each other but both depend on Step 1.
- Steps 7, 8 share `inventory.ts` — easier as one author/agent in sequence.
- Step 9 is independent of all Analytics work; can run in parallel.
- Step 10 is the gate; do last.

A reasonable parallel split for sub-agent dispatch: one agent on PR 1 (steps 1–4), a second on PR 3 (steps 7–8), a third on PR 4-step-9 (log filters), then converge for Step 10.

---

## Open Questions for the User

These are not blocking — defaults are documented above — but the answers may shrink/grow scope:

1. **Scope width**: All 4 PRs (full plan), or just PR 1 (bug fix + insights + sparklines) for now and re-scope later?
2. **Insight tone**: Are factual/statistical observations enough, or do you also want softly-prescriptive nudges ("Consider logging earlier next time")? Default = factual only.
3. **Refill thresholds**: Defaults are critical ≤3, warning ≤7, watch ≤14 days. Adjust?
4. **Charts library**: Stay CSS/inline-SVG (current pattern), or are you open to adding `layerchart` or similar for richer interactions (tooltips, brush)? Default = stay CSS-only.
5. **Branch strategy**: One stacked branch + 4 PRs (recommended for review), or one big PR? Default = stacked.
