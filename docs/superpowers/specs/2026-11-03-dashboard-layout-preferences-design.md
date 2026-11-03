# Dashboard Phase 1: per-account layout and an adjustable "time since" threshold

**Status:** approved design, 2026-11-03. Follows Phase 0 ([PR #188](https://github.com/JWhite212/medication-tracker/pull/188)), which this builds on.

## Decisions the user made (2026-11-03)

1. **Schema and API change: approved as designed.** Five additive `user_preferences` columns, applied by `drizzle-kit push`: `dashboard_section_order` (jsonb, nullable, no default; NULL means "follow the product default"), `dashboard_show_later`, `dashboard_show_quick_log` and `dashboard_show_refills` (boolean, NOT NULL DEFAULT true), and `time_since_days_from_hours` (integer, NOT NULL DEFAULT 48). The same five fields go onto `/api/v1` sync and `update_preferences`, additively.
2. **Mac app: adopt the time-since threshold now; layout later.** The Mac app uses `timeSinceDaysFromHours` in its own "ago" text. It decodes the layout fields, keeps them unchanged and ignores them until it has a dashboard of its own. The medtracker-mac work is a separate change in that repository.
3. **A hidden Refills still shows urgent stock.** If Refills is hidden but any medication needs the user, the card renders in its usual place with only those entries and a one-line note. The user approved this for "3 days or less". **"Urgent" was then widened in design to every row Refills draws as needing you.** That is `refillChip(...).tone === "needs-you"`, which since a73565e covers three cases:
   - a 7-day-or-less forecast;
   - stock at or below the user's own alert threshold;
   - "Refill needed" with no rate.

   The user gave the reason as "nobody runs out without seeing a warning", and a 3-day cut would hide amber rows that exist for exactly that. This is a designer call: flag it at handoff.

4. **Time-since range: 24 to 168 whole hours.** The web offers four presets: 1 day, 2 days (default), 3 days and 1 week. `/api/v1` accepts any whole hour in range.

Earlier answers that also bind this design:

- **Layout is per account**, not per device.
- **Due always comes first** whenever something is due.
- **Elvanse at 8:55 and 9:00 are two deliberate doses.** Nothing may merge or deduplicate them.

**Delivery (designer call).** Phase 1 goes on its own branch, `feat/dashboard-layout-preferences`, stacked on #188's branch. Its PR targets #188's branch and is retargeted to `main` once #188 merges, so that #188's review stays free of the schema change.

**Mac app decoder (checked).** `WirePreferences` in medtracker-mac (`Packages/MedTrackerSync/Sources/MedTrackerSync/WireModels.swift:372`) uses synthesised `Codable`, which ignores unknown keys. The five additive fields cannot break sync on deploy.

Everything under "Calls made by the designer" at the end was decided in design, not by the user. Read those with that in mind.

## Intent and why

The user wants to (1) choose the order of their dashboard sections and which ones appear, for example Done at the top, and (2) choose when "time since a dose" switches from hours to days. Phase 0 (PR #188) fixed that switch at `TIME_SINCE_DAYS_FROM_HOURS = 48` in `src/lib/utils/time.ts`.

The NN/g evidence is that few people customise, so the defaults carry the product. This design is therefore built around three rules:

- An account that never customised sees exactly today's page and copy.
- That account keeps following the product default if the default improves later.
- No layout can push something that needs the user out of view.

The design starts from the "minimal" design, which won on fit with the existing seams. It takes in the judges' grafts and fixes every flaw they raised that I could confirm in the code.

## Goals

- Per-account section order for Done today, Later today, Quick log and Refills.
- Per-account visibility for Later, Quick log and Refills.
- Due (the Earlier and Today cards) always renders straight after the header whenever anything is due. Nothing the user stores can move it.
- A per-account `timeSinceDaysFromHours` setting that applies to every time-since string: History, Medications, Done, the push-health lines on Notifications, and both channels of reminder copy.
- All three preference doors accept the new keys. Every save is audited through `updatePreferences`, and the conformance test covers them.

## Non-goals (Phase 1)

- Per-section options such as Later mode, grouping, refill tier filters or time-since display style. Those are Phase 2.
- Presets ("Focused", "Full day", "Just log"). Phase 2.
- The in-place Customise sheet with live preview. Phase 3.
- Drag-and-drop. If it ever arrives, it is an enhancement over the ↑/↓ buttons, never a replacement.
- Making the Mac app render the layout (decision 2: it keeps the fields and ignores them for now).

## Anti-goals (must never happen)

- Due moving below anything, or being hidden.
- Done being hidden. `DONE_HEADING_ID` is documented as "Always rendered" in `src/lib/components/dashboard/dom-ids.ts`. Remove, Remove skip, the edit Modal's `returnFocus` and `focusAfter`, and the Undo-restore fallback all target it.
- An as-needed-only account losing its only logging control.
- 1–9 shortcuts that silently do nothing, or a help overlay that advertises them when they do nothing.
- A refill the card draws as needing you (amber) vanishing silently because the user hid Refills.
- `formatTimeSince` printing "0d ago".
- Any write to `user_preferences` that bypasses `updatePreferences`. The import door's existing, commented upsert in `import/apply.ts` is unchanged.
- Layout logic moving into `composeDashboardPageData`. That function has no preferences: `dashboard/+page.server.ts` loads with `locals.user` only, so moving the logic would need a fifth query or `await parent()`.

## Constraints verified in the code

- `(app)/+layout.server.ts` returns `{ user, preferences }` from `getOrCreatePreferences`. The dashboard page's `data` already carries `data.preferences`, so no new query is needed.
- `dashboard/+page.svelte` has two hand-ordered branches:
  - as-needed-only: chips("Log a dose"), then DoneList, then RefillsCard;
  - scheduled: Due, then DoneList, then LaterList, then chips("Log something else"), then RefillsCard.
  - `RefillsCard` sits outside both branches, and `KeyboardShortcuts` is mounted with `medications` only.
- In `tests/unit/preference-door-conformance.test.ts`:
  - `probesFor` has ZodNumber, ZodEnum, ZodBoolean and ZodString branches only, plus a universal set `[undefined, null, NOT_A_VALID_VALUE]`.
  - The column count and the `sharedKeys` count are both literal 13.
  - `INTENTIONAL_DIVERGENCES` is empty.
- In `src/lib/preferences/schema.ts`, the key set is `Exclude<PreferenceKey, AppearanceKey>`, so a new column is a compile error until it is listed. Its header says "ARITY 1 deliberately absent".
- Appearance actions are generated from the registry (`APPEARANCE_ACTION_KEYS`), and its client state (`values`, `acked`, `timers`, `inFlight`, `queued`) is typed by `AppearanceKey`. `tests/unit/appearance-actions.test.ts:32` pins the action list literally.
- Time-since callers (from grep):
  - `TimeSince.svelte` makes three calls with no `now`;
  - `DoneList.svelte:76`;
  - `settings/notifications/+page.svelte:355,364`;
  - `server/email.ts:172` and `server/reminders.ts:201` (via `lastLoggedPhrase`);
  - the walkthrough's `StageDoneList.svelte:49` and `PhoneScene.svelte:59`.
  - `MedicationCard` and `TimelineEntry` reach it through `TimeSince`.
- The reminders overdue query already inner-joins `userPreferences` (`reminders.ts:66`).
- `serializePreferences` is `{ ...p, updatedAt }`, so sync, full export and the backup file pick up new columns automatically.
- The latest migration is `drizzle/0022_complex_shard.sql`. Production applies schema with `drizzle-kit push`, so only a column's DEFAULT and NOT NULL reach existing rows.

## Storage

Five additive columns on `user_preferences` in `src/lib/server/db/schema.ts`. One migration, `drizzle/0023_*.sql`, from `npx drizzle-kit generate`, containing only `ADD COLUMN`s. There is no UPDATE and no backfill: none is needed, and none would run under push.

```ts
// NULL = never customised: follow the product default for the page's variant.
// A stored value is a SUBSET of DASHBOARD_SECTIONS (no duplicates); the
// resolver inserts missing ids at their default position. Hidden state is
// NOT encoded here (see the show flags), so re-showing a section restores its place.
dashboardSectionOrder: jsonb("dashboard_section_order").$type<DashboardSectionId[]>(),
// Named positively so DEFAULT true = today. Done has no flag: it cannot be hidden.
// Phase 2 rule, recorded here: Later mode must not gain an "off" value;
// dashboardShowLater is the only owner of "is Later shown".
dashboardShowLater: boolean("dashboard_show_later").notNull().default(true),
dashboardShowQuickLog: boolean("dashboard_show_quick_log").notNull().default(true),
dashboardShowRefills: boolean("dashboard_show_refills").notNull().default(true),
// formatTimeSince's hours-before-days switch, in hours. 48 = Phase 0 behaviour.
timeSinceDaysFromHours: integer("time_since_days_from_hours").notNull().default(48),
```

Why this shape:

- **The order is nullable with no default** (taken from the ux design). The minimal design wrote today's order into every row, which freezes the many accounts that never customise. NULL keeps them on the product default. It also gives each variant its own default for free, and makes Reset a write of NULL. A nullable column with no default is what 0022 did, and push applies it unattended.
- **A JSON array, not an enum of permutations or a comma string.** The permutation enum grows factorially. Worse, once a fifth section exists, every stored or backed-up four-id value would fail the import door, which rejects the whole import. A subset array stays valid after sections are added. It is also a cleaner wire value for the Mac app than a mini-language.
- **jsonb, not `text[]`.** jsonb already exists in this schema (`side_effects`), and an array with no default carries no risk of push looping on a diff.
- **Visibility is scalar booleans**, which the existing probes, the audit diff and Phase 2 presets all handle with no new machinery.
- **The time-since threshold is a plain integer.**

Audit idempotence: `updatePreferences` diffs the CTE before-image against the RETURNING after-image, and both are database-normalised. jsonb keeps array order, so re-saving an identical order writes no audit row. A PGlite test pins this.

## Domain and doors

### Zod-free, client-reachable data

**New `src/lib/dashboard/layout.ts`.** The settings page and the dashboard page import it, so it must not reach zod; the bundle-boundary test is extended to cover it. It exports:

- `DASHBOARD_SECTIONS = ["done", "later", "quickLog", "refills"] as const` and `type DashboardSectionId`.
- `SECTION_LABELS`, which repeat the page's own titles: "Done today", "Later today", "Log something else", "Refills". These are restated by hand per the walkthrough-title rule.
- `DEFAULT_ORDER`:
  - `scheduled = ["done", "later", "quickLog", "refills"]`;
  - `asNeededOnly = ["done", "refills"]`, because Quick log is pinned there and Later never renders.
- `HIDEABLE_SECTIONS = ["later", "quickLog", "refills"]`.
- `normaliseSectionOrder(raw: unknown, variant)`. It never throws. It drops unknown ids, non-strings and duplicates, then inserts each missing id after its nearest present default predecessor (or at the front). NULL or a non-array gives the variant default.
- `resolveDashboardLayout(...)` (see Rendering).
- Pure edit operations, `moveSection(order, id, "up" | "down")` and `orderValue(order)`, used to precompute button values. The Phase 3 sheet reuses them.

**New `src/lib/preferences/domains.ts`** (zod-free):

- `TIME_SINCE_DAYS_FROM_HOURS_BOUNDS = { min: 24, max: 168 }`.
- `TIME_SINCE_PRESETS = [24, 48, 72, 168]`. These are UI suggestions, not the domain, the same convention as the accent presets.

The bounds have reasons. Below 24, `Math.floor(h / 24)` prints "0d ago", so 24 is a correctness floor. Above a week, "200h 3m ago" is noise. `time.ts` imports these, and `preferences/schema.ts` re-exports them so there is one statement. `TIME_SINCE_DAYS_FROM_HOURS = 48` stays in `time.ts` as the named default for the walkthrough and logged-out surfaces. A test pins it to the column default through `getTableColumns(userPreferences).timeSinceDaysFromHours.default`.

### The value domain in `src/lib/preferences/schema.ts`

The `satisfies` clause forces all five keys in. Comments that say "seven" become "twelve".

```ts
dashboardSectionOrder: z.array(z.enum(DASHBOARD_SECTIONS))
  .max(DASHBOARD_SECTIONS.length)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate section")
  .nullable(),
dashboardShowLater: z.boolean(),
dashboardShowQuickLog: z.boolean(),
dashboardShowRefills: z.boolean(),
timeSinceDaysFromHours: boundedInt(TIME_SINCE_DAYS_FROM_HOURS_BOUNDS),
```

Arity 2 (`preferencePayloadShape`, for `/api/v1 update_preferences`) and arity 3 (`preferenceImportShape`) are `optionalise()` of the same object, with no override lines, so `INTENTIONAL_DIVERGENCES` stays empty. `null` at `/api/v1` means "reset to default", and on import it round-trips faithfully. Unknown ids, `"due"`, `"header"` and duplicates are 400s at the door; tolerance applies only on read. `import/apply.ts` needs no change. An old backup lacks the keys and leaves them untouched.

### Arity 1, the form doors

These live in `src/lib/utils/validation.ts` beside `notificationSchema`, as `dashboardSettingsFieldSchemas`. Each is a `z.strictObject` with one required key, and each derives from the exported domain objects:

- `dashboardSectionOrder`: a string up to 128 characters. The literal `"default"` becomes `null`. Anything else is split on `,` and piped into the domain's array schema.
- The three show flags: `z.enum(["on", "off"]).transform(v => v === "on")`, the reducedMotion pattern. Each button posts its explicit value, so absence is never ambiguous.
- `timeSinceDaysFromHours`: `z.string().regex(/^\d{1,3}$/).transform(Number).pipe(boundedInt(BOUNDS))`. This is the full 24–168 range, not only the presets, so a value the Mac app set (for example 60) can be re-posted. Again, no divergence.
- Update the "ARITY 1 deliberately absent" header comment to point at these.

### Routes and actions

- **`src/routes/(app)/settings/dashboard/+page.server.ts`** has the actions `dashboardSectionOrder`, `dashboardShowLater`, `dashboardShowQuickLog`, `dashboardShowRefills` and `resetDashboardLayout`. Reset is a single `updatePreferences` call setting the order to null and all three flags to true: one write and one audit row.
- **Appearance gains one hand-added action**, `timeSinceDaysFromHours`, giving `actions = { ...registryActions, timeSinceDaysFromHours }`. It reuses `LIMITS.appearanceSave`.
- **Every action:**
  - opens with `if (!locals.user) error(401)`;
  - calls `enforceLimit`; on 429 it returns `fail(429, { saveError, retryAfterMs })`;
  - parses its schema; on failure it returns `fail(400, { errors })`;
  - calls `updatePreferences(userId, parsed.data)`. Nothing else writes the row.
- **New rate-limit row** in `src/lib/server/auth/rate-limit-policy.ts`: `dashboardSettingsSave: { namespace: "dashboard-settings", max: 60, windowMs: MINUTE, identity: "account" }`.

### Conformance test changes (`tests/unit/preference-door-conformance.test.ts`)

- The column and `sharedKeys` literals go from 13 to 18, and `NON_APPEARANCE_PREFERENCE_KEYS` from 7 to 12.
- `probesFor` gains a `z.ZodArray` branch whose probes are derived from the element enum's `.options`, not hand-written:
  - `[]`;
  - all options;
  - all options reversed;
  - a single option;
  - the first option twice;
  - `["header"]` and `["due"]`;
  - all options plus one extra (over the max);
  - a bare option string, which is not an array.

  Without this branch, the key falls to the three universal probes and trips the `> 3` guard. That is the intended forcing function, so keep the guard.

- New pinned "domains that shipped" literals, which catch both doors widening together:
  - `timeSinceDaysFromHours`: 24 and 168 accepted; 23, 169, 47.5, `"48"` and 0 rejected, at both doors.
  - `dashboardSectionOrder`: `null`, `[]` and the default accepted; `["due"]`, a duplicate and `"done,later"` (a string at the API door) rejected.
  - Form-door cases: `{}` fails on the required key; `"default"` becomes null; `"done,done"` gives a 400.

## Rendering

### The resolver

A pure resolver in `src/lib/dashboard/layout.ts`, called from `+page.svelte`, not from the composer:

```ts
resolveDashboardLayout({
  order: unknown,            // data.preferences.dashboardSectionOrder
  showLater, showQuickLog, showRefills: boolean,
  variant: "scheduled" | "as-needed-only",   // data.status.kind
  hasUrgentRefill: boolean,                 // any refillForecast entry whose refillChip tone is "needs-you"
}): { pinned: "due" | "quickLog"; sections: DashboardSectionId[]; hidden: DashboardSectionId[]; refillsUrgentOnly: boolean }
```

It is deterministic over the payload, so SSR and hydration agree. The composer, `load.ts` (four queries) and every status, row and button rule stay untouched. A new CLAUDE.md bullet says: "Dashboard layout is presentational: the composer owns content, `resolveDashboardLayout` owns order, and it reads preferences from the (app) layout, never from the dashboard load."

### Rules

1. **Pinned block, straight after DashboardHeader and outside the loop.** "Due first" holds by construction, not by a sort.
   - Scheduled accounts get `pinned = "due"`, the existing `{#if hasDue}` section, unchanged.
   - As-needed-only accounts get `pinned = "quickLog"`, titled "Log a dose" and always visible. On that page the chips are the primary action, which is the same reasoning as Due.
2. **`sections`** is `normaliseSectionOrder(order, variant)`, filtered:
   - `done` is always kept;
   - `later` needs `showLater` and is always dropped on as-needed-only;
   - `quickLog` needs `showQuickLog` (scheduled only, since it is pinned on as-needed-only);
   - `refills` needs `showRefills || hasUrgentRefill`.
3. **Refills safety floor.** When Refills is hidden but an urgent entry exists, the card renders in its stored position showing only the urgent entries, with one neutral line. "Urgent" means `refillChip(entry)?.tone === "needs-you"`, computed with the exported `refillChip` from `RefillsCard.svelte`'s `<script module>` and never re-derived. The line reads: "Showing urgent refills only. Refills is hidden on your dashboard." `RefillsCard` gets optional `note` and filtered `entries` props. It still renders nothing when its entries are empty, so callers are not wrapped in `{#if}`.
4. **Defaults reproduce today exactly:**
   - scheduled: Header, Due?, Done, Later, Quick log ("Log something else"), Refills;
   - as-needed-only: Header, Quick log ("Log a dose"), Done ("Logged today"), Refills.

### Page change (`(app)/dashboard/+page.svelte`)

- Replace the two branches with: Header, then the pinned block, then `{#each layout.sections as id (id)}{@render section(id)}{/each}`, then the footer line.
- `section(id)` dispatches to today's exact markup: the `chips(title)` snippet, `DoneList`, `LaterList` and `RefillsCard`, with the same props and titles.
- Hidden sections are not rendered at all. There is no `display: none`, so there are no duplicate ids.

### Focus and shortcuts

- `DASHBOARD_HEADING_ID` and `DONE_HEADING_ID` exist in every layout, because the header is pinned and Done cannot be hidden.
- `later-heading`, `refills-heading` and `quick-log-heading` are only `aria-labelledby` targets inside their own sections.
- The LaterList toggle-focus fix (0ad725c) is internal to its section.
- `KeyboardShortcuts` gets `quickLog={layout.pinned === "quickLog" || layout.sections.includes("quickLog")}`. When it is false, digit keys are ignored, and the `?` overlay replaces the 1–9 row with "Number shortcuts need Quick log on your dashboard", linking to `/settings/dashboard`.

### Footer line

One quiet ghost text line at the foot of the dashboard, after the last section:

- "Customise this page", linking to `/settings/dashboard?from=dashboard`;
- when anything is hidden by preference: "Later today and Refills are hidden · Customise".

It never goes in the header or the status line, and there is no onboarding nag.

### Walkthrough

The landing stage keeps drawing the default. `tests/unit/walkthrough-dashboard-fidelity.test.ts` gains an assertion that the stage's hand-drawn section sequence equals `resolveDashboardLayout` with default inputs for the variant(s) the stage draws. A change to the default then fails there, instead of leaving the landing page advertising the old order. The Stage parts pass `TIME_SINCE_DAYS_FROM_HOURS` explicitly and never read user preferences.

## The time-since setting

### Signatures (`src/lib/utils/time.ts`)

- `formatTimeSince(date, now, daysFromHours)` and `lastLoggedPhrase(lastEventAt, now, daysFromHours)`.
- `daysFromHours` is required, with no default, so the compiler lists every consumer.
- Inside, there is one guard: `Number.isInteger(h) ? clamp(h, BOUNDS) : TIME_SINCE_DAYS_FROM_HOURS`. This is a read-side guard of the formatter's own invariant (never "0d ago"), the same narrow exception as the heatmap clamp. A stale fixture or `undefined` would otherwise make `diffHours < undefined` false and print days for everything.
- The single `if (diffHours < h)` branch remains the only rule.

### How the value reaches each consumer

The value is threaded as a prop, following the `timeFormat` precedent. There is no context and no `$app/state`.

- `TimeSince.svelte`: a new required prop `daysFromHours`. It passes `new Date()` explicitly in its three calls.
- `MedicationCard`: a `timeSinceDaysFromHours` prop from `medications/+page.svelte`, which reads `data.preferences.timeSinceDaysFromHours`.
- `TimelineEntry` (History): the same prop, from `log/+page.svelte`.
- `DoneList`: a prop from the dashboard page, giving `formatTimeSince(takenAt, serverNow, h)`.
- `settings/notifications/+page.svelte`: its two push-health calls use `data.preferences`.
- **The reminder sweep:**
  - `reminders.ts` adds `userTimeSinceDaysFromHours: userPreferences.timeSinceDaysFromHours` to the overdue select, which already joins that table.
  - The push body becomes `lastLoggedPhrase(lastEventAt, now, row.userTimeSinceDaysFromHours)`.
  - `sendReminderEmail(email, name, lastEventAt, now, daysFromHours)` threads it to `email.ts:172`.
  - Both channels still word from one tick `now` and one phrase function. The low-inventory sweep is untouched.
  - The copy is not part of `buildOverdueDedupeKey`, so changing the setting never re-sends a reminder.
- **Walkthrough** (`PhoneScene`, `StageDoneList`): pass the constant.

### UI

Appearance, Formatting group, directly under Time format.

- **Label:** "Show days instead of hours after".
- **Control:** a `role="group"` of `Toggle` buttons, "1 day", "2 days (default)", "3 days", "1 week", with `aria-pressed` on the confirmed value. Each is a no-JS submit through `Toggle`'s new opt-in `submit={{ name, value }}` prop. `Toggle` stays `type="button"` unless that prop is given.
- **How it saves:** each button is a submit in one `<form action="?/timeSinceDaysFromHours">` carrying its hour value, and saves on a discrete press with one local saving flag. It deliberately does not join the registry's debounce/queue/`acked` maps, which are typed by `AppearanceKey`, so that machinery is not widened. A press is a settled intent and needs no debounce.
- **Off-preset values:** a stored value outside the presets, which only the API can produce, renders as an extra pressed "60 hours" option.
- **Live sample:** a fixed 30-hour-old instant rendered by `formatTimeSince` itself under the confirmed value ("A dose 30 hours ago reads '30h 0m ago'"), following the dateFormat sample precedent.
- **Description:** "Also used in History, Medications and reminder emails and notifications."
- The Dashboard settings page cross-links here in one line.

## Settings UI: `/settings/dashboard`

- **Route:** `src/routes/(app)/settings/dashboard/+page.svelte` and `+page.server.ts`, linked from a new card on the settings index: "Dashboard: section order and what's shown".
- **Page frame:** `<h1 tabindex="-1">Dashboard</h1>`, as `page-heading-owner.test.ts` requires. The back link reads "← Back to dashboard" when `?from=dashboard`. There is one sr-only polite `role="status"` region, placed before the first form.
- **"Sections" card**, an `<ol>`:
  - A pinned, non-interactive first row. On a scheduled account: "Due now: always first whenever something is due, so nothing overdue sits below the fold." On an as-needed-only account the row reads "Log a dose: always first".
  - One row per movable section, in the resolved order, each with:
    - its position number and name;
    - "↑" and "↓" `IconButton`s labelled "Move Done today up" and "Move Done today down", 44px;
    - for hideable sections, a `Toggle` "Show Later today" with `aria-pressed`, posting the opposite state through `submit={{ name, value }}`. Done shows the static text "Always shown".
  - Hints under the hideable rows: Quick log when off, "1–9 shortcuts are off while hidden"; Refills, "Urgent refills still appear".
- **Reset to default:** a secondary `Button`, shown only when the order is non-null or a flag is false, with the text "Default: Done, Later, Quick log, Refills". No confirmation, because the change is reversible.
- **No-JS first:**
  - Each control is a submit button in a `<form method="POST" action="?/<key>">`, carrying the complete resulting value computed at render from server-confirmed data by `moveSection`. For example, Later's ↑ from the default posts `later,done,quickLog,refills`.
  - The toggles post the opposite of the current state.
  - End buttons render `aria-disabled="true"` and `type="button"` with no value.
- **With JS:**
  - `use:enhance` with one page-level `saving` flag. While a request is in flight every control is `aria-disabled` (never `disabled`), and a press is `cancel()`ed.
  - On success: `invalidateAll()`, then an announcement such as "Later today moved to position 1 of 4" or "Refills hidden", with the parity zero-width space so a repeated announcement still fires.
  - On failure: the UI is unchanged, because it renders only confirmed data, and a toast shows `actionErrorMessage(result)`. The callback never handles only success.
  - There is no optimistic state and no debounce.
  - This is not a dose write, so the `begin-dose-write.test.ts` caller list does not grow.
- **Focus after a move.** Once the move succeeds and the page has reloaded, focus goes to `move-section-${id}-${direction}`. If that button has `aria-disabled="true"` (the section reached an end), focus goes to the opposite button instead. This happens unconditionally, as on `/medications`, not through `focusIfLost`: the pressed button can survive the reorder and keep focus while it becomes inert. Repeated ↑ presses walk a section to the top.
- **The settings page knows the account's variant.** Its load returns `{ preferences, variant }`. The variant comes from a shared server helper, `dashboardVariantFor`, which `composeDashboardPageData` also calls, so the "any timed schedule" rule is written once.

## API and the Mac app

- **The wire change is additive only.** `SerializedPreferences` gains the five keys through the spread, and `update_preferences` accepts them as optional. The response is unchanged.
- **`docs/api-v1-contract.md`** needs:
  - the `SerializedPreferences` block;
  - the `update_preferences` row, with the domains: the order is a subset array of `done | later | quickLog | refills` or `null` (reset), with no duplicates and unknown ids rejected; the flags are booleans; the threshold is an int from 24 to 168;
  - a semantics note: Due is always first, `null` means the product default, a subset is normalised on read, the layout is presentation-only advice, and clients that do not render a dashboard ignore it;
  - client obligations: send the order only when the user edited it (last writer wins), and never rebuild it from a model that drops ids it does not know.
- **`docs/database.md`:** add the five columns.
- **Mac app:** decision 2 applies. Before merge, confirm in medtracker-mac that its preferences model decodes with synthesised `Decodable`, which ignores unknown keys. A strict decoder would break sync on deploy.

## Phase 2 readiness

- **Per-section options** become more scalar columns with NOT NULL defaults reproducing today, each a `ZodEnum` in `preferenceFieldTypes`. The probes derive automatically. Examples:
  - `dashboard_later_mode` (`next | next3 | all`, with no `off`);
  - `dashboard_later_grouping`;
  - `dashboard_refills_min_tier`, over `classifyRefillSeverity`'s tiers;
  - `time_since_style`.
- **Presets** are named `Partial<UserPreferences>` patches in a zod-free module, applied by one `?/applyPreset` action through one `updatePreferences` call (one write, one multi-key audit row). The active preset is detected by matching, never stored. The Mac app can send the same patch.
- **The Phase 3 sheet** runs the pure `resolveDashboardLayout` and the edit operations over draft values and renders the real section snippet. It saves through the same doors.
- **A new section** is one more id in `DASHBOARD_SECTIONS`. Stored subsets stay valid, and the normaliser inserts the new id at its default position. Old backups and older Mac builds keep validating.
- Nothing in Phase 1 needs undoing: there is no blob, no hidden state encoded in the order, and no new registry control kind.

## Risks

- **Production schema change.** Five additive `ADD COLUMN`s applied by push. They are non-destructive and need no backfill, but they need the user's sign-off. Inspect the generated SQL before merge, per 0022.
- **Additive public wire fields.** A strict Mac decoder would break sync. Verify in medtracker-mac first.
- **`zod 4.3.6` `.refine` on `ZodArray`:** confirm it still reports `instanceof z.ZodArray` after unwrapping. If not, the probe branch reads the element through the check wrapper. Prove this with a failing probe count first.
- **A missing threshold renders days for everything.** The read-side guard covers it. The bespoke-fake `reminders.test.ts` fixtures must carry `userTimeSinceDaysFromHours`, or they exercise only the fallback. Keep its `whereArgsByCall` ordering assertion intact.
- **Last writer wins across tabs and devices** for the order. Accepted for a personal preference; every write is audited.
- **Hidden Quick log:** the shortcuts must be disabled, or they become dead keys. Covered by an SSR test.
- **`appearance-actions.test.ts`** pins its action list literally, so that literal gains `timeSinceDaysFromHours`. The registry-coverage test (`APPEARANCE_ACTION_KEYS` equals `APPEARANCE_KEYS`) is unaffected, because the action is hand-added and not a registry key.
- **Mechanical diff:** required parameters touch about ten call sites plus `time.test.ts`, `email.test`, `reminders.test` and the walkthrough tests.
- **Lazy `render()`:** Svelte 5's server render is lazy, so every SSR test must read `.body` and be mutation-proven.

## Test plan

Every new test is proven by breaking its production line and watching it fail.

1. **`tests/unit/dashboard-layout.test.ts`** (pure):
   - The defaults reproduce both of today's pages.
   - A property loop over every subset and permutation × the 8 flag combinations × both variants × urgent yes/no checks that:
     - `pinned` is due on scheduled and quickLog on as-needed;
     - `done` is always present;
     - no id appears twice;
     - `later` never appears on as-needed;
     - `quickLog` is never in `sections` on as-needed;
     - an urgent refill forces `refills` with `refillsUrgentOnly`;
     - `hidden` lists exactly the suppressed sections.
   - `normaliseSectionOrder`: unknown, duplicate and non-string ids are dropped; a missing id is inserted after its default predecessor (tested with an injected five-section list); null gives the variant default.
   - A seeded fuzz over random JSON: it never throws, and its output passes the door schema.
   - `moveSection` at both ends is a no-op.
2. **`tests/unit/dashboard-page-ssr.test.ts`:**
   - Default heading order.
   - With Done first and something due: h1, then due, then done.
   - Hidden Later and Refills are absent, and the footer names them.
   - Hidden Quick log: no `form[data-quick-log]`, and no 1–9 help row.
   - The urgent floor renders only needs-you rows plus the note. Cover all three needs-you causes: a 7-day forecast, at-threshold stock with weeks left, and "Refill needed" with no rate. A watch-tier row is dropped.
   - On as-needed-only, "Log a dose" is first whatever the order.
   - `#done-heading` is present in every combination.
3. **`time.test.ts`:**
   - At 24, 48, 72 and 168: one minute under renders hours; exactly at the threshold renders days.
   - `undefined`, NaN, 0, 12, 47.5 and 1000 never yield "0d ago".
   - The column default equals the constant.
   - `lastLoggedPhrase` forwards the threshold.
4. **`reminders.test.ts` and `email.test`:** a last event 30h before the tick reads "Last logged 1d ago" at 24 and "Last logged 30h 0m ago" at 48, in both push and email.
5. **Conformance:** the new counts, the ZodArray branch, the pinned literals and the form-door cases.
6. **PGlite, `tests/unit/pg/preferences-audit.test.ts`:**
   - Saving an order writes one row, from null to the array.
   - Re-saving an identical order writes none.
   - Reset audits back to null and true.
   - The threshold audits only its key.
   - A freshly seeded user reads null, true, true, true and 48, which proves migration 0023 through the real `drizzle/` migrations.
7. **`tests/unit/dashboard-settings-actions.test.ts`:**
   - Each action calls `updatePreferences` with exactly its keys.
   - A typo'd key is a 400, an out-of-domain value is a 400, and `"default"` becomes null.
   - A 429 carries `saveError` and `retryAfterMs`.
   - The flags accept only `on` and `off`.
   - Plus the Appearance time-since action.
8. **Guard tests:**
   - `app-action-auth-guard.test.ts`: schema-passing cases for all six new actions; its coverage enumeration fails until they exist.
   - `rate-limit-registry.test.ts`: the new policy is used and its namespace is disjoint.
   - `page-heading-owner`: the new h1 has `tabindex="-1"`.
   - `appearance-bundle-boundary`: `dashboard/layout.ts`, `preferences/domains.ts` and the new page reach no zod.
   - `status-colour-owner`: the note is neutral.
   - The `begin-dose-write` caller list is unchanged.
9. **Owner scan:** `dashboardSectionOrder` is read only in `dashboard/layout.ts`, the schema, serialize and import (the latter two by spread). A raw read elsewhere fails.
10. **Settings SSR:**
    - Every ↑/↓ value equals `moveSection` of the confirmed order.
    - The end buttons are `aria-disabled` with `type="button"`.
    - Done has no toggle.
    - The pinned row is present.
    - Reset shows only when the layout is customised.
    - There is one `role="status"`.
    - On Appearance: preset samples come from the formatter, and a stored 60 renders as an extra pressed option.
11. **Walkthrough fidelity:** the stage's section order equals the resolver default.
12. **Required mutation proofs:**
    - Move Due into the loop: the SSR order test fails.
    - Drop the as-needed Quick log pin: the as-needed test fails.
    - Change the column default 48 to 24: the pin test fails.
    - Delete the urgent floor: the refills test fails. Then narrow it to `severity === "critical"`: the at-threshold case fails.
    - Remove the ZodArray probe branch: the conformance `> 3` guard fails.
13. **Manual check** (on prod after merge, since local dev login is a known dead end):
    - Keyboard-only reorder.
    - Done on top with an overdue card on a phone.
    - No-JS reorder.
    - Reset.
    - A threshold change seen in History, Medications, Done and a test reminder.
    - `npm run check` (with pglite installed per worktree), lint and `npx vitest run` green.

## Calls made by the designer

- **Winner and grafts.** Minimal is the base. From the others: a nullable order (NULL = product default); a subset array instead of a permutation enum; the resolver kept in the page; the walkthrough fidelity assertion; the fuzz test and the mutation list; the PGlite idempotence and default tests; the owner scan; and the API client-obligation wording.
- **"Urgent" for the hidden-Refills floor means needs-you (amber), not just critical.** See decision 3.
- **`Toggle` gains an opt-in `submit={{ name, value }}` prop** so that pressed-state controls work without JS. Its default stays `type="button"`, and its look is unchanged. The plan review found that `Toggle` could not submit at all. CLAUDE.md's primitives bullet is updated to match.
- **Done can move but never hide.** dom-ids.ts documents it as always rendered, and four focus paths depend on it. It is also the dashboard's only "did I take it?" confirmation.
- **Quick log can be hidden on scheduled accounts**, and the 1–9 shortcuts are then disabled and explained. Logging stays available on /medications.
- **On as-needed-only accounts, Quick log is pinned first and always visible.** It is that page's primary action, the same reasoning as Due.
- **Header stays above Due.** The header is the h1 and status, not a section.
- **The order is stored as a jsonb subset array, nullable.** Visibility is three NOT NULL DEFAULT true booleans, so a hidden section keeps its place.
- **No form-door divergence.** The form accepts the full 24–168 range so API-set values can be re-posted.
- **The time-since control lives on Appearance → Formatting** because its reach is app-wide. It uses discrete toggle presses outside the registry's debounce machinery, so the `AppearanceKey`-typed maps are not widened.
- **`/settings/dashboard` saves on discrete presses** with server-confirmed absolute values. No optimistic state, no debounce, no extracted instant-save module.
- **One footer line** ("Customise this page", naming any hidden sections) instead of a header entry point or onboarding nudges.
- **Reset is one action** with one write and one audit row, and needs no confirmation.
- **A separate rate-limit namespace** for the dashboard settings; the Appearance time-since action reuses `appearanceSave`.
- **The read-side clamp in `formatTimeSince`** is the narrow heatmap-style exception: it only changes wording, never data.
- **Section ids are camelCase** (`quickLog`), matching the codebase's identifier style on the wire.
