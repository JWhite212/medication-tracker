# Dashboard Phase 1: Layout and Time-Since Preferences — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each account reorder and hide dashboard sections (Due pinned first, Done never hidden), and set when "time since" switches from hours to days (24–168h), everywhere that string appears.

**Architecture:** Five additive `user_preferences` columns, with their domain written once in `src/lib/preferences/schema.ts` and shared by all three doors (settings forms, `/api/v1`, import), and every write going through `updatePreferences`. A pure, zod-free resolver in `src/lib/dashboard/layout.ts` turns the stored preferences into a section sequence. The dashboard page renders that sequence. The composer and the load are unchanged. The threshold is threaded to every `formatTimeSince` caller as a required argument.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, Drizzle (`drizzle-kit generate`, push in prod), zod 4.3.6, Vitest (jsdom default; PGlite suites need `// @vitest-environment node`).

**Spec:** `docs/superpowers/specs/2026-11-03-dashboard-layout-preferences-design.md`. Read it first. This plan assigns its decisions to tasks and does not restate them.

**Branch:** `feat/dashboard-layout-preferences`, stacked on PR #188's branch. Open its PR against `feat/dashboard-customization-review-cd083d`, and retarget it to `main` after #188 merges.

## Global Constraints

- New columns, exactly:
  - `dashboard_section_order` jsonb, nullable, no default;
  - `dashboard_show_later`, `dashboard_show_quick_log` and `dashboard_show_refills`, boolean NOT NULL DEFAULT true;
  - `time_since_days_from_hours` integer NOT NULL DEFAULT 48.
- The migration is `drizzle/0023_*.sql` from `npx drizzle-kit generate`. It contains `ADD COLUMN` only: no UPDATE, no backfill.
- Section ids: `"done" | "later" | "quickLog" | "refills"`. The default order is `scheduled = ["done","later","quickLog","refills"]` and `asNeededOnly = ["done","refills"]`.
- Hideable sections: `later`, `quickLog`, `refills`. Done is never hidden. Due is never in the order: it is pinned straight after the header.
- On as-needed-only accounts, Quick log ("Log a dose") is pinned first and always shown. Later never renders there.
- Threshold domain: integer 24–168 inclusive. UI presets: 24, 48, 72 and 168, labelled "1 day", "2 days (default)", "3 days" and "1 week". A stored value outside the presets renders as an extra pressed "N hours" option.
- "Urgent" refill means `refillChip(entry)?.tone === "needs-you"`, using the exported `refillChip` from `RefillsCard.svelte`'s module script. Never re-derive it.
- The floor note is exactly: "Showing urgent refills only. Refills is hidden on your dashboard."
- The settings page title is `Dashboard`, at route `/settings/dashboard`. The settings index card reads "Dashboard: section order and what's shown".
- The Appearance control label is "Show days instead of hours after", with the description "Also used in History, Medications and reminder emails and notifications."
- Every `(app)` action opens with `if (!locals.user) error(401, "Unauthorized")`. Every preference write calls `updatePreferences` and nothing else.
- Every new test is proven by breaking its production line and watching it fail (the user's standing rule).
- Svelte's server `render()` is lazy: every SSR test must read `.body`.

## Review Focus

1. **`[]` stored as the order** (an API client may send it) must render the default page, and Settings must still offer Reset. The test is in Task 4 and Task 7.
2. **Pressing ↑ on the second section moves it to the top**, and its ↑ becomes `aria-disabled`. Focus must land on that section's ↓, not `<body>`. The test is in Task 7.
3. **Hidden Refills with an urgent entry on an as-needed-only account** still shows the floor card. The test is in Task 5.
4. **A second press while a save is in flight** is cancelled and sends nothing. Two quick ↑ presses must never post two orders computed from the same stale state. The test is in Task 7.
5. **A reminder for a user who never opened any settings** words its "Last logged" from the column default of 48, not a fallback. The test is in Task 2 (PGlite default) and Task 3 (reminders fixture).

---

### Task 1: Threshold domain and a parameterised formatter

**Files:**

- Create: `src/lib/preferences/domains.ts`
- Modify: `src/lib/utils/time.ts` (`TIME_SINCE_DAYS_FROM_HOURS`, `formatTimeSince`, `lastLoggedPhrase`)
- Modify (test callers; svelte-check type-checks `tests/`): `tests/unit/walkthrough-demo-facts.test.ts`, `tests/unit/walkthrough-dashboard-fidelity.test.ts`, `tests/unit/email.test.ts`, `tests/unit/reminders.test.ts`, plus any further hit from `grep -rln "formatTimeSince\|lastLoggedPhrase" tests`
- Test: `tests/unit/time.test.ts`

**Interfaces:**

- Produces:
  - `TIME_SINCE_DAYS_FROM_HOURS_BOUNDS = { min: 24, max: 168 } as const satisfies NumericBound`;
  - `TIME_SINCE_PRESETS = [24, 48, 72, 168] as const`;
  - `formatTimeSince(date: Date, now: Date, daysFromHours: number): string`;
  - `lastLoggedPhrase(lastEventAt: Date | null, now: Date, daysFromHours: number): string`.
  - `TIME_SINCE_DAYS_FROM_HOURS = 48` stays.
- Note: `domains.ts` has no imports except a type. Move `NumericBound` there and re-export it from `preferences/schema.ts`, so client code reaches no zod.

- [ ] **Step 1: Write the failing tests.** Add `describe("formatTimeSince threshold")` with three cases.
  - Use `it.each([24, 48, 72, 168])`: `formatTimeSince(new Date(NOW - (h*HOUR - MINUTE)), new Date(NOW), h)` ends with `"m ago"` and starts with `${h - 1}h`; exactly `h*HOUR` gives `${h/24 | 0}d ago` (`Math.floor`).
  - `it.each([undefined, NaN, 0, 12, 47.5, 1000])`: the result at 30h never equals `"0d ago"`. At 30h with `undefined` it equals `"30h 0m ago"` (the fallback is 48). With 12 it equals `"1d ago"` (clamped to 24). With 1000 it equals `"30h 0m ago"` (clamped to 168).
  - Cases where the clamp is visible: at 13h with 12 it equals `"13h 0m ago"` (unclamped it would be `"0d ago"`); at 200h with 1000 it equals `"8d ago"` (unclamped it would be `"200h 0m ago"`).
  - `lastLoggedPhrase(before(30*HOUR), NOW, 24)` gives `"Last logged 1d ago"`.

  Update the existing cases to pass `48` explicitly.

- [ ] **Step 2: Run** `npx vitest run tests/unit/time.test.ts`. Expected: FAIL. TS also reports the arity in callers; the next step fixes that.
- [ ] **Step 3: Implement.**
  - `formatTimeSince`: `now` and `daysFromHours` become required, with no defaults.
  - Guard: `const h = Number.isInteger(daysFromHours) ? Math.min(max, Math.max(min, daysFromHours)) : TIME_SINCE_DAYS_FROM_HOURS`.
  - `lastLoggedPhrase` forwards it.
  - Update every caller to pass `TIME_SINCE_DAYS_FROM_HOURS` for now, so the build stays green: `TimeSince.svelte` (passes `new Date()`), `DoneList.svelte`, `settings/notifications/+page.svelte`, `reminders.ts`, `email.ts`, `StageDoneList.svelte`, `PhoneScene.svelte`. Task 3 replaces those with the user's value.
- [ ] **Step 4: Run** `npx vitest run tests/unit/time.test.ts tests/unit/walkthrough-demo-facts.test.ts && npm run check`. Expected: PASS, 0 errors.
- [ ] **Step 5: Mutation proofs.** Remove the `Math.min`/`Math.max` clamp: the 13h-with-12 and 200h-with-1000 cases fail. Remove the `Number.isInteger` fallback: the `undefined` case fails. Restore both.
- [ ] **Step 6: Commit** `feat(time): take the hours-before-days threshold as an argument`.

### Task 2: Columns, migration, domain and doors

**Files:**

- Modify: `src/lib/server/db/schema.ts` (`userPreferences`, after `exportFormat`)
- Create: `drizzle/0023_*.sql`, plus the meta snapshot and journal (generated)
- Modify: `src/lib/preferences/schema.ts` (`preferenceFieldTypes`, plus header comments "seven" → "twelve")
- Modify: `src/lib/types.ts`, only if `UserPreferences` is hand-written (it is inferred: confirm)
- Modify: `docs/api-v1-contract.md`, `docs/database.md`
- Create: `tests/unit/helpers/preferences-fixture.ts`. It exports `preferencesFixture`, a full `UserPreferences` (`satisfies UserPreferences`) including the five new fields at their defaults.
- Modify: the 26 test files that hand-write a whole preferences object (`grep -rl "heatmapPeriod: " tests/unit`). Each spreads `preferencesFixture` with its own overrides.
- Test: `tests/unit/preference-door-conformance.test.ts`, `tests/unit/pg/preferences-audit.test.ts`

**Interfaces:**

- Consumes: nothing from later tasks. **Create `src/lib/dashboard/layout.ts` here** with only `export const DASHBOARD_SECTIONS = ["done","later","quickLog","refills"] as const;` and `export type DashboardSectionId = (typeof DASHBOARD_SECTIONS)[number];`, zod-free and with no imports. Import them into `preferences/schema.ts`, and as `import type` into `db/schema.ts` for the `$type<>`. Task 4 extends the file.
- Produces:
  - `UserPreferences` gains `dashboardSectionOrder: DashboardSectionId[] | null`, `dashboardShowLater: boolean`, `dashboardShowQuickLog: boolean`, `dashboardShowRefills: boolean` and `timeSinceDaysFromHours: number`;
  - `preferenceFieldTypes` gains the five domains exactly as the spec's "The value domain" block gives them.

- [ ] **Step 1: Write the failing conformance changes.**
  - Change the column and `sharedKeys` literals from 13 to 18 (lines 67 and 186), and `NON_APPEARANCE_PREFERENCE_KEYS`' length from 7 to 12 (line 263).
  - Add a `z.ZodArray` branch to `probesFor`. Its probes are derived from the element enum's `.options`: `[]`, all options, all reversed, `[options[0]]`, `[options[0], options[0]]`, `["header"]`, `["due"]`, `[...options, "extra"]`, and `options[0]` as a bare string.
  - Add the pinned literal cases from the spec's conformance list. For `timeSinceDaysFromHours`, 24 and 168 are accepted; 23, 169, 47.5, `"48"` and 0 are rejected. For `dashboardSectionOrder`, `null`, `[]` and the scheduled default are accepted; `["due"]`, `["done","done"]` and `"done,later"` are rejected.
- [ ] **Step 2: Write the failing PGlite tests** in `tests/unit/pg/preferences-audit.test.ts`.
  - `"a freshly seeded user reads the Phase 1 defaults"`: `getOrCreatePreferences` returns `dashboardSectionOrder === null`, the three show flags as `true`, and `timeSinceDaysFromHours === 48`. This proves 0023 through the real migrations.
  - `"saving an order audits once and an identical re-save audits nothing"`: one audit row with `{ dashboardSectionOrder: { from: null, to: [...] } }`, then zero new rows.
  - `"the threshold audits only its own key"`.
  - `"reset audits the order back to null and the flags back to true in one row"`. Start from order `["refills","done"]` with `dashboardShowLater: false` and `dashboardShowRefills: false`. One `updatePreferences` call with the reset payload writes one audit row whose diff holds exactly those three keys. `dashboardShowQuickLog` didn't change, so it is absent.
  - Also pin the column default against the constant: `getTableColumns(userPreferences).timeSinceDaysFromHours.default === TIME_SINCE_DAYS_FROM_HOURS`.
- [ ] **Step 3: Run** `npx vitest run tests/unit/preference-door-conformance.test.ts tests/unit/pg/preferences-audit.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Add the columns to the schema with the spec's comments.
  - Run `npx drizzle-kit generate` and **read the SQL**: five `ADD COLUMN` lines and nothing else.
  - Add the domains to `preferenceFieldTypes`. Arity 2 and arity 3 follow through `optionalise()`, with no override lines.
- [ ] **Step 5: Run** the same tests, then `npx vitest run && npm run check`. Expected: PASS. `INTENTIONAL_DIVERGENCES` is still empty.
- [ ] **Step 6: Docs.**
  - In `api-v1-contract.md`, add the five fields to `SerializedPreferences`.
  - Add the domains to the `update_preferences` row.
  - Add the semantics note and the client obligations, as in the spec's "API and the Mac app".
  - In `database.md`, add the five columns.
- [ ] **Step 7: Mutation proof.** Drop the ZodArray branch and the conformance `> 3` guard fails. Change the default 48 to 24 and the constant pin fails. Restore both.
- [ ] **Step 8: Commit** `feat(preferences): dashboard layout and time-since columns (migration 0023)`.

### Task 3: Thread the user's threshold to every "ago"

**Files:**

- Modify: `src/lib/components/TimeSince.svelte` (new required prop `daysFromHours: number`)
- Modify: `src/lib/components/MedicationCard.svelte` and `src/routes/(app)/medications/+page.svelte` (prop `timeSinceDaysFromHours`)
- Modify: `src/lib/components/TimelineEntry.svelte` and `src/routes/(app)/log/+page.svelte` (same prop)
- Modify: `src/lib/components/dashboard/DoneList.svelte` and `src/routes/(app)/dashboard/+page.svelte` (same prop)
- Modify: `src/routes/(app)/settings/notifications/+page.svelte` (reads `data.preferences.timeSinceDaysFromHours`)
- Modify: `src/lib/server/reminders.ts` (overdue select gains `userTimeSinceDaysFromHours: userPreferences.timeSinceDaysFromHours`; line ~201)
- Modify: `src/lib/server/email.ts` (`sendReminderEmail(email, medicationName, lastEventAt, now, daysFromHours)`)
- Modify (mount sites that must pass the new required prop): `tests/unit/timeline-entry-delete.test.ts`, `tests/unit/done-list-undo.test.ts`, `tests/unit/medication-card-stock-ssr.test.ts`, `tests/unit/pg/refills-card-agreement.test.ts`, plus every other hit from `grep -rln "TimeSince\|MedicationCard\|TimelineEntry\|DoneList" tests/unit`
- Test: `tests/unit/done-list-ssr.test.ts`, `tests/unit/timeline-entry-ssr.test.ts`, `tests/unit/medication-card-*.test.ts`, `tests/unit/reminders.test.ts`, `tests/unit/email.test.ts`

**Interfaces:**

- Consumes: Task 1 signatures; Task 2 `UserPreferences.timeSinceDaysFromHours`.
- Produces: `sendReminderEmail(..., daysFromHours: number)`.

- [ ] **Step 1: Write the failing tests.**
  - DoneList with `timeSinceDaysFromHours: 24` and a dose 30h before `serverNow` shows `"1d ago"`; with 48 it shows `"30h 0m ago"`.
  - TimelineEntry and MedicationCard each have one SSR case: a 30h-old dose at 24 reads `"1d ago"`.
  - `reminders.test.ts`: a fixture row with `userTimeSinceDaysFromHours: 24` and a last event 30h before the tick gives the push body `"Last logged 1d ago"`. With 48 it gives `"Last logged 30h 0m ago"`. Keep the `whereArgsByCall` ordering assertion intact, and add the field to every fixture row, or they only exercise the fallback.
  - `email.test.ts`: the same pair through `sendReminderEmail`.
- [ ] **Step 2: Run** those files. Expected: FAIL.
- [ ] **Step 3: Implement.** Thread the prop exactly as the spec's "How the value reaches each consumer" lists it. Walkthrough parts keep passing `TIME_SINCE_DAYS_FROM_HOURS`.
- [ ] **Step 4: Run** `npx vitest run && npm run check`. Expected: PASS.
- [ ] **Step 5: Mutation proof.** Make `reminders.ts` pass the constant instead of the row value, and the reminders case at 24 fails. Restore it.
- [ ] **Step 6: Commit** `feat(time): honour each account's time-since threshold everywhere`.

### Task 4: The layout resolver

**Files:**

- Modify: `src/lib/dashboard/layout.ts` (created in Task 2 with `DASHBOARD_SECTIONS` and `DashboardSectionId`)
- Modify: `tests/unit/appearance-bundle-boundary.test.ts` (add `src/lib/dashboard/layout.ts` and `src/lib/preferences/domains.ts` to the zod-free set)
- Test: `tests/unit/dashboard-layout.test.ts`

**Interfaces:**

- Produces:
  - `DASHBOARD_SECTIONS = ["done","later","quickLog","refills"] as const`;
  - `type DashboardSectionId`;
  - `type DashboardVariant = "scheduled" | "as-needed-only"`;
  - `DEFAULT_ORDER: Record<DashboardVariant, readonly DashboardSectionId[]>`;
  - `HIDEABLE_SECTIONS = ["later","quickLog","refills"] as const`;
  - `SECTION_LABELS: Record<DashboardSectionId, string>`, which are "Done today", "Later today", "Log something else" and "Refills";
  - `normaliseAgainst(raw: unknown, defaults: readonly string[]): string[]`. It never throws. It drops non-strings, ids not in `defaults` and duplicates, then inserts each missing id after its nearest present default predecessor, or at the front if none is present. NULL or a non-array returns `defaults`;
  - `normaliseSectionOrder(raw: unknown, variant: DashboardVariant): DashboardSectionId[]`, which is `normaliseAgainst(raw, DEFAULT_ORDER[variant])`;
  - `resolveDashboardLayout(input: { order: unknown; showLater: boolean; showQuickLog: boolean; showRefills: boolean; variant: DashboardVariant; hasUrgentRefill: boolean }): { pinned: "due" | "quickLog"; sections: DashboardSectionId[]; hidden: DashboardSectionId[]; refillsUrgentOnly: boolean }`;
  - `moveSection(order: readonly DashboardSectionId[], id: DashboardSectionId, direction: "up" | "down"): DashboardSectionId[]`;
  - `orderValue(order: readonly DashboardSectionId[]): string`, which comma-joins.
- Consumes: Task 2 `preferenceFieldTypes.dashboardSectionOrder` (in the fuzz test).
- `hidden` lists the sections suppressed by a preference only, never those the variant excludes. The footer names exactly these.

- [ ] **Step 1: Write the failing tests** in `tests/unit/dashboard-layout.test.ts`.
  - `"defaults reproduce today's two pages"`. With `null`, all flags true and no urgent refill:
    - scheduled gives `{ pinned: "due", sections: ["done","later","quickLog","refills"], hidden: [], refillsUrgentOnly: false }`;
    - as-needed-only gives `{ pinned: "quickLog", sections: ["done","refills"], hidden: [] }`.
  - `"[] behaves as the default"` (Review Focus 1).
  - `"normalise drops unknown, duplicate and non-string ids and inserts missing ids after their default predecessor"`: `["refills", "x", 3, "refills", "done"]` with scheduled gives `["refills","done","later","quickLog"]`. Check: `later` goes after `done`, then `quickLog` after `later`.
  - `"a section added to the defaults later slots in after its predecessor"`: `normaliseAgainst(["c","a"], ["a","b","c","d","e"])` gives `["c","d","e","a","b"]`, and `normaliseAgainst(["b"], ["a","b","c"])` gives `["a","b","c"]`.
  - `"property: every subset and permutation × flags × variant × urgent"`, enumerated over all 65 ordered subsets (permutations of every subset) × 8 flag combinations × 2 variants × 2:
    - `done` is always in `sections`;
    - no duplicates;
    - `later` and `quickLog` never appear in `sections` on as-needed;
    - `pinned` is `"due"` iff scheduled;
    - `refills` is in `sections` iff `showRefills || hasUrgentRefill`;
    - `refillsUrgentOnly === (!showRefills && hasUrgentRefill)`;
    - `hidden` equals the flags turned off, intersected with the variant's sections, and minus refills when the floor applies.
  - `"seeded fuzz never throws and always yields a door-valid order"`: 500 random JSON values; the output parses against `preferenceFieldTypes.dashboardSectionOrder`.
  - `"moveSection at either end returns the same order"`. `moveSection(["done","later"], "later", "up")` gives `["later","done"]`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/dashboard-layout.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement** the rest of `layout.ts`, zod-free, with `normaliseSectionOrder` delegating to `normaliseAgainst`.
- [ ] **Step 4: Run** the test and `tests/unit/appearance-bundle-boundary.test.ts`. Expected: PASS.
- [ ] **Step 5: Mutation proof.** Let `later` through on as-needed, and the property test fails. Restore it.
- [ ] **Step 6: Commit** `feat(dashboard): a pure resolver for section order and visibility`.

### Task 5: Render the dashboard from the resolver

**Files:**

- Modify: `src/routes/(app)/dashboard/+page.svelte` (replace both branches: header, pinned block, `{#each layout.sections as id (id)}{@render section(id)}{/each}`, footer line)
- Modify: `src/lib/components/RefillsCard.svelte` (optional `note?: string` prop rendered as one `text-text-secondary text-sm` line under the heading; still renders nothing for empty `entries`)
- Modify: `src/lib/components/KeyboardShortcuts.svelte` (prop `quickLog = true`; when false, digits are ignored and the help row reads "Number shortcuts need Quick log on your dashboard", linking to `/settings/dashboard`)
- Modify: `tests/unit/walkthrough-dashboard-fidelity.test.ts` (the stage's section sequence equals `resolveDashboardLayout` defaults for the variant it draws)
- Test: `tests/unit/dashboard-page-ssr.test.ts`, `tests/unit/quick-log-target.test.ts` (KeyboardShortcuts mount cases), `tests/unit/refills-card-ssr.test.ts`

**Interfaces:**

- Consumes: Task 4 `resolveDashboardLayout`; Task 2 preference fields on `data.preferences`; `refillChip` from `RefillsCard.svelte`'s module script.
- Produces:
  - The footer copy: "Customise this page", linking to `/settings/dashboard?from=dashboard`.
  - When `hidden.length > 0`, the footer reads `${names} ${hidden.length === 1 ? "is" : "are"} hidden · Customise`. `names` joins `SECTION_LABELS` with ", " and " and ".
  - Use a ghost `Button` with `href`, size `sm`.

- [ ] **Step 1: Write the failing SSR tests** in `dashboard-page-ssr.test.ts`:
  - `"default order: h1, due, done, later, quick log, refills"`, by heading order;
  - `"Done first with something due still renders Due right after the header"`;
  - `"hidden Later and Refills are absent and the footer names them"`: "Later today and Refills are hidden";
  - `"hidden Quick log removes form[data-quick-log]"`. The help overlay only renders after `?` is pressed, so SSR cannot see it. The mount cases below cover it;
  - `"urgent floor renders only needs-you rows plus the note"`. Use four entries:
    - a 7-day forecast;
    - at-threshold stock with 40 days left;
    - a "Refill needed" row with `daysUntilRefill: null` at threshold;
    - a watch-tier row.

    The first three render and the fourth doesn't (spec decision 3);

  - `"as-needed-only: Log a dose is first whatever the stored order, and the floor applies there too"` (Review Focus 3);
  - `"#done-heading exists in every combination"`, looping the 8 flag combinations.
  - Mount cases in `tests/unit/quick-log-target.test.ts`:
    - (a) With `quickLog: false` beside a `form[data-quick-log]` with a spied `requestSubmit`, pressing `1` never calls the spy.
    - (b) With `quickLog: false`, pressing `?` shows "Number shortcuts need Quick log on your dashboard" with `a[href="/settings/dashboard"]`, and no "Log a medication now" row.
    - (c) With `quickLog: true`, the 1–9 row is present.

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Compute `hasUrgentRefill` from `data.refillForecast.some(e => refillChip(e)?.tone === "needs-you")`. Pass `refillChip` the same input shape `RefillsCard` uses.
  - When `refillsUrgentOnly`, pass the filtered entries and the note.
  - The `section(id)` snippet dispatches to today's exact markup and props.
- [ ] **Step 4: Run** `npx vitest run && npm run check`. Expected: PASS, including the walkthrough fidelity suite.
- [ ] **Step 5: Mutation proofs.**
  - Move Due inside the loop: the Done-first test fails.
  - Drop the as-needed Quick log pin: the as-needed test fails.
  - Narrow the floor to `severity === "critical"`: the at-threshold row fails.
  - Narrow it to `daysUntilRefill !== null`: the "Refill needed" row fails.
  - Ignore the `quickLog` prop in KeyboardShortcuts: cases (a) and (b) fail.
  - Restore all three.
- [ ] **Step 6: Commit** `feat(dashboard): render sections in the account's order`.

### Task 6: Dashboard settings doors and actions

**Files:**

- Modify: `src/lib/utils/validation.ts` (add `dashboardSettingsFieldSchemas`)
- Modify: `src/lib/server/dashboard/page-data.ts`. Extract `export function dashboardVariantFor(medications, schedulesByMedId): DashboardVariant` ("scheduled" iff any medication has a schedule passing `isTimed`), and make `composeDashboardPageData` use it for `anyTimed`.
- Modify: `src/lib/components/ui/Toggle.svelte`. Add an opt-in `submit?: { name: string; value: string }`. When given, render `type="submit" name value`; otherwise keep `type="button"`. Update its comment and CLAUDE.md's Button/IconButton/Toggle bullet. Add a case to the existing Toggle tests: the default is still `type="button"`, and with `submit` it is `type="submit"` with name and value. The walkthrough's `stageToggle` class test must stay green.
- Modify: `src/lib/preferences/schema.ts` (the "ARITY 1 deliberately absent" comment now points at them)
- Modify: `src/lib/server/auth/rate-limit-policy.ts` (`dashboardSettingsSave: { namespace: "dashboard-settings", max: 60, windowMs: MINUTE, identity: "account" }`)
- Create: `src/routes/(app)/settings/dashboard/+page.server.ts`
- Modify: `src/routes/(app)/settings/appearance/+page.server.ts` (`actions = { ...registryActions, timeSinceDaysFromHours }`)
- Modify: `tests/unit/appearance-actions.test.ts:32` (literal list gains `timeSinceDaysFromHours`)
- Test: `tests/unit/dashboard-settings-actions.test.ts`, `tests/unit/app-action-auth-guard.test.ts`, `tests/unit/rate-limit-registry.test.ts`, `tests/unit/preference-door-conformance.test.ts` (form-door cases)

**Interfaces:**

- Consumes: Task 2 domains; Task 4 `DASHBOARD_SECTIONS`.
- Produces:
  - Actions `?/dashboardSectionOrder`, `?/dashboardShowLater`, `?/dashboardShowQuickLog`, `?/dashboardShowRefills` and `?/resetDashboardLayout`, plus the Appearance action `?/timeSinceDaysFromHours`.
  - Form fields have the same names as the actions.
  - Failures:
    - `fail(400, { key, errors })`;
    - `fail(429, { key, saveError, retryAfterMs })`, mirroring Appearance's `fieldAction`.
  - Load returns `{ preferences, variant }`. It queries the user's active medications and their schedules, scoped by `user_id`, and calls `dashboardVariantFor`.

- [ ] **Step 1: Write the failing tests.**
  - Each action calls `updatePreferences(userId, …)` with exactly its key.
  - `"default"` becomes `{ dashboardSectionOrder: null }`.
  - `"done,done"`, `"due"` and an unknown key are 400.
  - Each flag accepts only `"on"` or `"off"`.
  - Reset gives exactly `{ dashboardSectionOrder: null, dashboardShowLater: true, dashboardShowQuickLog: true, dashboardShowRefills: true }` in one call.
  - The threshold gives `"72"` → 72, while `"23"`, `"169"` and `"4.5"` are 400.
  - A 429 carries `saveError` and `retryAfterMs`.
  - In `tests/unit/app-action-auth-guard.test.ts`:
    - import `../../src/routes/(app)/settings/dashboard/+page.server` as `dashboardSettings`;
    - add `["settings/dashboard", dashboardSettings.actions]` to the hand-written `all` array in "covers every action defined under (app)";
    - add six schema-passing CASES (five dashboard, plus Appearance `timeSinceDaysFromHours`).
  - Load tests: an account with only as-needed medications gets `variant: "as-needed-only"`, and one fixed-time medication makes it `"scheduled"`.
  - `dashboard-page-data` tests stay green after the extraction.
  - Add the form-door literal cases to conformance: `{}` fails, `"default"` becomes null, and `"done,done"` gives a 400.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** the field schemas as the spec's "Arity 1" gives them, using `z.strictObject` with one required key, derived from the exported domains. Implement the actions in the order: auth check, limit, parse, `updatePreferences`.
- [ ] **Step 4: Run** `npx vitest run && npm run check`. Expected: PASS.
- [ ] **Step 5: Mutation proof.** Make reset skip one flag and the reset test fails. Restore it.
- [ ] **Step 6: Commit** `feat(settings): form doors and actions for dashboard layout and time-since`.

### Task 7: `/settings/dashboard` page

**Files:**

- Create: `src/routes/(app)/settings/dashboard/+page.svelte`
- Modify: `src/routes/(app)/settings/+page.svelte` (new card, with the Global Constraints copy)
- Test: `tests/unit/settings-dashboard-ssr.test.ts`, `tests/unit/settings-dashboard-mount.svelte.test.ts`

**Interfaces:**

- Consumes: Task 6 actions and `data.variant`; Task 4 `normaliseSectionOrder`, `moveSection`, `orderValue`, `SECTION_LABELS` and `HIDEABLE_SECTIONS`; `actionErrorMessage`; `showToast`; `Button`, `IconButton`, and `Toggle` with its new `submit` prop.
- Produces: ids `move-section-${id}-up` and `move-section-${id}-down`.

- [ ] **Step 1: Write the failing SSR tests.**
  - `<h1 tabindex="-1">` reads "Dashboard".
  - There is exactly one `role="status"`.
  - The pinned first row reads "Due now: always first whenever something is due, so nothing overdue sits below the fold.", or "Log a dose: always first" on as-needed.
  - Every ↑ and ↓ is a submit carrying `name="dashboardSectionOrder"` with `value === orderValue(moveSection(confirmed, id, dir))`.
  - The end buttons are `type="button"` and `aria-disabled="true"`, with no value.
  - Each hideable row's Toggle is `type="submit"` with `name` set to its key and `value` set to the opposite of the confirmed flag (`"on"`/`"off"`). Done has no visibility control and reads "Always shown".
  - With `variant: "as-needed-only"`, the pinned row reads "Log a dose: always first", only the Done and Refills rows are listed, and their values come from `normaliseSectionOrder(order, "as-needed-only")`.
  - One line links to `/settings/appearance` for when time since switches to days.
  - The Quick log hint reads "1–9 shortcuts are off while hidden" when it's off. The Refills hint reads "Urgent refills still appear".
  - Reset is absent at the defaults, and present for `[]` (Review Focus 1), for any non-null order, and for any false flag. Its text is "Default: Done, Later, Quick log, Refills".
  - The back link reads "← Back to dashboard" only with `?from=dashboard`.
- [ ] **Step 2: Write the failing mount tests.**
  - ↑ on the second row posts once. After the mocked success and the reload, `document.activeElement.id === "move-section-later-down"` and not `-up` (Review Focus 2).
  - A second press while the first is in flight is cancelled: one `fetch` (Review Focus 4).
  - On a 400, the toast shows `actionErrorMessage(result)` and the order stays unchanged.
  - The status text after a move is "Later today moved to position 1 of 4".
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.**
  - The page renders only server-confirmed data, with no optimistic state.
  - It has one page-level `saving` flag. While a save is in flight, controls are `aria-disabled`, never `disabled`.
  - Focus after a successful move: once the reload lands, await `tick()`, then focus `move-section-${id}-${direction}`, unless it is `aria-disabled="true"`, in which case focus `move-section-${id}-${opposite}`. Do this unconditionally, as on `/medications`, not through `focusIfLost`, because the pressed button can survive and keep focus while it becomes inert.
  - Below the Sections card, add one line linking to `/settings/appearance` for "Show days instead of hours after".
  - Announcements alternate a trailing zero-width space so a repeat still fires.
- [ ] **Step 5: Run** `npx vitest run tests/unit/page-heading-owner.test.ts tests/unit/status-colour-owner.test.ts tests/unit/settings-dashboard-*.test.ts && npm run check`. Expected: PASS.
- [ ] **Step 6: Mutation proofs.** Remove the `saving` cancel: Review Focus 4 fails. Always focus the same-direction button: Review Focus 2 fails. Delete the Appearance link: its assertion fails. Restore all three.
- [ ] **Step 7: Commit** `feat(settings): Dashboard page for section order and visibility`.

### Task 8: Appearance "Show days instead of hours after" control

**Files:**

- Modify: `src/routes/(app)/settings/appearance/+page.svelte` (Formatting group, under Time format; `+page.server.ts` was already done in Task 6)
- Test: `tests/unit/appearance-page-ssr.test.ts`, `tests/unit/settings-pages-mount.svelte.test.ts`

**Interfaces:**

- Consumes: Task 1 `TIME_SINCE_PRESETS` and `formatTimeSince`; Task 6 `?/timeSinceDaysFromHours`.

- [ ] **Step 1: Write the failing tests.**
  - A `role="group"` labelled "Show days instead of hours after" contains four `Toggle`s: "1 day", "2 days (default)", "3 days" and "1 week". Each is `type="submit"` with `name="timeSinceDaysFromHours"` and its hours as `value`. Only the stored value is `aria-pressed="true"`.
  - A stored 60 adds a pressed "60 hours".
  - The sample line equals `formatTimeSince(new Date(SAMPLE_NOW - 30*HOUR), SAMPLE_NOW, stored)` and changes when the stored value is 24.
  - The description copy is exact (Global Constraints).
  - In the mount test, a press posts one request carrying `timeSinceDaysFromHours=72`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** one `<form method="POST" action="?/timeSinceDaysFromHours">`. Each Toggle uses `submit={{ name: "timeSinceDaysFromHours", value: String(hours) }}`, with one local saving flag. It does not join the registry's debounce maps.
- [ ] **Step 4: Run** the files plus `tests/unit/appearance-bundle-boundary.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(appearance): choose when time since switches to days`.

### Task 9: Docs, owner scan and whole-branch verification

**Files:**

- Modify: `CLAUDE.md`:
  - a new Key Patterns bullet, from the spec's sentence: "Dashboard layout is presentational: the composer owns content, `resolveDashboardLayout` owns order, and it reads preferences from the (app) layout, never from the dashboard load". It must also cover Due pinned, Done never hidden and the urgent floor;
  - note the time-since threshold in the existing time bullets.
- Create: `tests/unit/dashboard-layout-owner.test.ts`. It scans `src/` for `dashboardSectionOrder` and allows it only in `src/lib/dashboard/layout.ts`, `src/lib/server/db/schema.ts`, `src/lib/preferences/schema.ts`, `src/lib/utils/validation.ts`, the settings dashboard route and `+page.svelte`'s single resolver call. The check runs in both directions: a stale entry also fails.
- Test: the whole suite.

- [ ] **Step 1: Write the owner-scan test** and run it. It should PASS against the finished code. Prove it by adding a stray read in `DoneList.svelte` and watching it FAIL, then restore.
- [ ] **Step 2: Update CLAUDE.md** as above.
- [ ] **Step 3: Full verification.** Run `npx vitest run`, `npm run check` (0 errors; warnings no more than the 27 already there), `npx eslint src tests --quiet` and `npx prettier --check src tests docs`. Expected: all clean.
- [ ] **Step 4: Inspect `drizzle/0023_*.sql`** one last time: ADD COLUMN only.
- [ ] **Step 5: Commit** `docs: record the dashboard layout and time-since invariants`.
- [ ] **Step 6: Open the PR** against `feat/dashboard-customization-review-cd083d`.
  - In the body: decisions with one-line reasons, the needs-you widening of decision 3 flagged for the user, and the follow-up for medtracker-mac (adopt `timeSinceDaysFromHours`; keep layout fields untouched).
  - Manual checks on the Vercel preview, since local dev login is a known dead end: keyboard-only reorder, Done on top with an overdue card on a phone, no-JS reorder, Reset, and a threshold change seen in History, Medications, Done and a test reminder.
