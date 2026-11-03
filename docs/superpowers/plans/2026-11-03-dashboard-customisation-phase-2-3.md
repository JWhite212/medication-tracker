# Dashboard Phases 2 and 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two per-section dashboard options (Later mode, Done time), four presets, and an in-place edit mode on the dashboard itself.

**Architecture:** Phase 2 adds two enum columns that flow through the existing three preference doors and `updatePreferences`, plus a zod-free `presets.ts` applied by one `?/applyPreset` action. Phase 3 turns the real dashboard into its own preview: a draft drives the one `resolveDashboardLayout` call, section content goes `inert`, and every change saves through the existing `/settings/dashboard` field actions.

**Tech Stack:** SvelteKit 2, Svelte 5 runes, Drizzle/Postgres (push), zod 4.3.6, Vitest (jsdom default; PGlite tests `// @vitest-environment node`), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-11-03-dashboard-customisation-phase-2-3-design.md`. Every task reads the spec sections it names. The spec's section numbers are cited as §N.

## Global Constraints

- An account that never customises sees byte-identical markup and copy. Every new prop and column defaults to today's behaviour.
- Columns: `dashboard_later_mode text NOT NULL DEFAULT 'next'`, `dashboard_done_time text NOT NULL DEFAULT 'both'`. The migration is exactly the two `ADD COLUMN` lines in §1, with no UPDATE.
- Domains: `DASHBOARD_LATER_MODES = ["next", "all"]` (never `"off"`); `DONE_TIME_DISPLAYS = ["both", "since", "clock"]`.
- Preset ids are `standard | focused | fullDay | justLog`, and the patches are exactly §4b's table. `timeSinceDaysFromHours` is never a preset key.
- No preset hides Done, Quick log or Refills.
- Skipped and missed Done rows never show a "since". The Elvanse 08:55 and 09:00 rows always render as two rows.
- Edit mode never takes the dose-write lock, never mounts a second copy of a section, and adds no new write action. It only reads `getDoseWriteLock().active`.
- Controls are `Button`, `IconButton` and `Toggle` only. They use fixed heights, `aria-disabled` never `disabled`, no status colour, and no `animate:flip`.
- `layout.ts`, `presets.ts`, `move-focus.ts` and `preferences/domains.ts` stay zod-free.
- Every new `(app)` action opens with `if (!locals.user) error(401, "Unauthorized")` (through `admit()`).
- Every new test is proven by mutation: break the guarded line, watch the named test fail, restore it. Record each mutation in the task report.
- Each task gates on `npx vitest run` (full suite), `npm run check` (0 errors, with pglite installed), and eslint and prettier on the changed files.
- Commits carry no Claude/AI attribution of any kind.

## Review Focus

Five ways this could break for a real person that the spec's own test list does not pin. Each one's test sits in the task that owns the code:

1. **Leaving the dashboard mid-edit** (a sidebar link while editing, then coming back): the dashboard must open out of edit mode with nothing `inert`. Task 7, test "remount starts out of edit mode".
2. **An Undo pressed during edit mode:** its reload lands while editing. Edit mode must stay open, and the draft must keep any key that's in flight. Task 6, test "an invalidate while a key is in flight keeps that key and stays editing".
3. **A preset applied while a single-key write is still in flight:** the preset must win once both settle, with no flicker back to the older value. Task 6, test "a preset queued behind an in-flight key ends on the preset".
4. **Done in `since` mode on a 320px phone with "26h 59m ago":** no overlap with the marker or name. Task 2 visual check at 320 and 375, using the harness in Task 2's step.
5. **An as-needed-only account in edit mode:** ↑/↓ must keep the stored positions of Later and Quick log, and the pinned bar must say "Log a dose · always first on your account". Task 7, test "as-needed-only move keeps stored places".

---

### Task 1: Phase 2a: columns, domains and doors

**Spec:** §1, §2c, §6, tests 1, 4 (defaults only), 5 (field actions only).

**Files:**

- Modify: `src/lib/server/db/schema.ts` (after the Phase 1 dashboard columns)
- Create: `drizzle/0024_*.sql` via `npx drizzle-kit generate` (plus the snapshot and journal it writes)
- Modify: `src/lib/preferences/domains.ts`, `src/lib/preferences/schema.ts`, `src/lib/utils/validation.ts` (`dashboardSettingsFieldSchemas`), `src/routes/(app)/settings/dashboard/+page.server.ts`, `docs/api-v1-contract.md`, `docs/database.md`
- Test: `tests/unit/preference-door-conformance.test.ts`, `tests/unit/pg/preferences-audit.test.ts`, `tests/unit/dashboard-settings-actions.test.ts`, `tests/unit/app-action-auth-guard.test.ts`

**Interfaces:**

- Produces: `DASHBOARD_LATER_MODES`, `DashboardLaterMode`, `DONE_TIME_DISPLAYS`, `DoneTimeDisplay` (from `$lib/preferences/domains`); `UserPreferences.dashboardLaterMode`, `UserPreferences.dashboardDoneTime`; actions `?/dashboardLaterMode` and `?/dashboardDoneTime`, each posting one field of the same name.

- [ ] **Step 1: Write failing tests.**
  - Conformance: change the literals to 20 (line ~77), 20 (line ~216) and 14 (line ~378). Add pinned cases: `dashboardLaterMode` accepts `"next"` and `"all"` and rejects `"off"`, `"next3"` and `""` at every door; `dashboardDoneTime` accepts `"both"`, `"since"` and `"clock"` and rejects `"relative"` and `""`.
  - PGlite: a freshly seeded user reads `dashboardLaterMode === "next"` and `dashboardDoneTime === "both"`.
  - Actions: each new action calls `updatePreferences(userId, { <key>: value })` with exactly its key, and a bad value is a 400.
  - Auth guard: cases for `dashboardLaterMode` and `dashboardDoneTime`, each with a body that passes its schema.
- [ ] **Step 2: Run them and see them fail:** `npx vitest run tests/unit/preference-door-conformance.test.ts tests/unit/dashboard-settings-actions.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/pg/preferences-audit.test.ts`.
- [ ] **Step 3: Implement.** Add the columns as in §1 (`$type<…>()`), then `npx drizzle-kit generate`. Open the SQL and confirm it is exactly the two `ADD COLUMN` lines in §1, with nothing else. Add the domains to `domains.ts` and the `z.enum(...)` entries to `preferenceFieldTypes`. Change the comments that say "twelve" to "fourteen". Add the two `z.strictObject` form schemas and two `fieldAction(...)` entries. Add the two domains and the semantics line to `api-v1-contract.md` (§6), and the columns to `docs/database.md`.
- [ ] **Step 4: Run the full gate.** Every test passes, check reports 0 errors, and lint is clean. Mutation: add `"off"` to `DASHBOARD_LATER_MODES` and the pinned conformance case fails.
- [ ] **Step 5: Commit** `feat(preferences): add dashboard Later mode and Done time preferences`.

### Task 2: Phase 2b: DoneList time display and LaterList mode

**Spec:** §2a, §2b, tests 6 and 7.

**Files:**

- Modify: `src/lib/components/dashboard/DoneList.svelte`, `src/lib/components/dashboard/LaterList.svelte`, `src/lib/components/walkthrough/parts/dashboard/StageDoneList.svelte` (a comment only: `dashboardDoneTime` is deliberately not modelled)
- Test: `tests/unit/done-list-ssr.test.ts`, the LaterList component test (extend the existing LaterList mount test; find it with `grep -l LaterList tests/unit`)

**Interfaces:**

- Consumes: `DoneTimeDisplay` and `DashboardLaterMode` from Task 1.
- Produces: `DoneList` prop `timeDisplay?: DoneTimeDisplay` (default `"both"`); `LaterList` prop `mode?: DashboardLaterMode` (default `"next"`).

- [ ] **Step 1: Write failing tests.**
  - **DoneList.** No prop renders the same `.body` as `timeDisplay="both"`.
  - **`since`.** On a taken row, the primary line is the since text inside `<time datetime=… data-time-since title="13:31">`, followed by an sr-only " at 13:31". The visible clock is gone. The column carries `min-w-24`.
  - **`clock`.** No `[data-time-since]` is rendered.
  - **Skipped and missed rows.** In all three modes they show their clock and no since.
  - **Two doses minutes apart.** Two taken doses at 08:55 and 09:00 render as two `li`s in every mode.
  - **LaterList `mode="all"`.** Every group renders on mount, and the toggle reads as expanded. With two groups, then rerendered with one, then two again, the list is still expanded.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - **DoneList.** Make `since` the primary line (`text-sm text-text-primary`) in `since` mode. Render no since element in `clock` mode. Keep the "Yesterday" line in every mode. Don't touch PR #190's phone layout.
  - **LaterList.** Initialise with `let expanded = $state(untrack(() => mode === "all"))`. In the `$effect.pre`, the reset becomes `expanded = mode === "all"`, and its focus parking is unchanged.
- [ ] **Step 4: Visual check.** Reuse the harness the #190 fix used:
  - Write a temporary `tests/unit/zz-preview-*.test.ts` that renders `DoneList` with `timeDisplay="since"` and a row 26h59m old, then writes HTML with CSS compiled by `@tailwindcss/node` plus `@tailwindcss/oxide`.
  - Screenshot it with `npx playwright screenshot --viewport-size=320,700` and `375,700`, both with `--color-scheme=dark`.
  - Read the PNGs. Nothing may overlap. Delete the temporary test afterwards.
- [ ] **Step 5: Run the full gate.** Mutations: drop the `status === "taken"` guard in `since` mode, so the skipped-row test fails; then hard-code LaterList's reset to `false`, so the reload test fails.
- [ ] **Step 6: Commit** `feat(dashboard): let Done show the time, how long ago, or both, and Later the whole day`.

### Task 3: Phase 2b: page wiring, settings option groups and owner scan

**Spec:** §2c (read-side `normaliseOption`), §2d, §2e, tests 8, 9 and 10.

**Files:**

- Modify: `src/lib/dashboard/layout.ts`, `src/routes/(app)/dashboard/+page.svelte`, `src/routes/(app)/settings/dashboard/+page.svelte`
- Test: `tests/unit/dashboard-layout.test.ts` (or the existing layout unit test file), `tests/unit/dashboard-page-ssr.test.ts`, `tests/unit/dashboard-layout-owner.test.ts`, `tests/unit/appearance-bundle-boundary.test.ts`, the settings dashboard page SSR test (find it with `grep -l "settings/dashboard" tests/unit`)

**Interfaces:**

- Consumes: the Task 1 domains and the Task 2 props.
- Produces: `normaliseOption<T extends string>(raw: unknown, values: readonly T[], fallback: T): T` in `layout.ts`; the page-local `stored` object `{ order, showLater, showQuickLog, showRefills, laterMode, doneTime }`, which Task 7 reads.

- [ ] **Step 1: Write failing tests.**
  - `normaliseOption` returns the fallback for `undefined`, `null`, `"off"` and `42`, and returns each valid value unchanged.
  - Page forwarding (following commit e23aa09's pattern): with stored `laterMode: "all"` the page passes it to LaterList (every group renders), and with stored `doneTime: "clock"` Done has no `[data-time-since]`.
  - The owner scan is generalised to `dashboardLaterMode` and `dashboardDoneTime` in both directions: the dashboard page names each exactly once, and `layout.ts` names none.
  - The bundle boundary includes `preferences/domains.ts`.
  - Settings SSR: a "Later today" group with Toggles "Next few" and "Whole day" posting `dashboardLaterMode`, and a "Done today" group with "Time and how long ago", "How long ago" and "Time only" posting `dashboardDoneTime`. Each group is a `fieldset` with a `legend`, `aria-pressed` follows the stored value, and the Done sample text comes from `formatTimeSince` for a fixed 2h15m-old instant. With Later hidden, the Later group still renders, plus the hint "Later today is hidden".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement.**
  - Add `normaliseOption` to `layout.ts`.
  - On the page, gather `stored` once (§2d) and pass `mode` and `timeDisplay` in the `section(id)` snippet.
  - On the settings page, add the two option groups (§2e), each in its own `<form action="?/<key>" use:enhance>`, reusing the page's `saving` flag and `save()` handler, extended with an `option` intent that announces, for example, "Later today: whole day".
- [ ] **Step 4: Run the full gate.** Mutation: pass a hard-coded `"next"` instead of `stored.laterMode`, and the forwarding test fails.
- [ ] **Step 5: Commit** `feat(settings): choose Later mode and Done time on the dashboard settings page`.

### Task 4: Phase 2c: presets

**Spec:** §4 (all of it) and tests 2, 3, 4 (preset audit rows) and 5 (`applyPreset`).

**Files:**

- Create: `src/lib/dashboard/presets.ts`
- Modify: `src/lib/utils/validation.ts` (`applyPresetSchema = z.strictObject({ preset: z.enum(PRESET_IDS) })`), `src/routes/(app)/settings/dashboard/+page.server.ts` (`applyPreset`, with Reset rewritten to `PRESETS.standard.patch` and `RESET_LAYOUT` deleted), `src/routes/(app)/settings/dashboard/+page.svelte` (the "Start from" fieldset)
- Test: create `tests/unit/dashboard-presets.test.ts`; modify `tests/unit/pg/preferences-audit.test.ts`, `tests/unit/dashboard-settings-actions.test.ts`, `tests/unit/app-action-auth-guard.test.ts`, `tests/unit/dashboard-layout-owner.test.ts` (add `presets.ts` to all three keys' owner lists), `tests/unit/appearance-bundle-boundary.test.ts` (add `dashboard/presets.ts`), and the settings page SSR test

**Interfaces:**

- Produces, exactly as named in §4a: `PRESET_KEYS`, `PresetKey`, `PresetPatch`, `PRESET_IDS`, `PresetId`, `PRESETS: Record<PresetId, { label: string; blurb: string; patch: PresetPatch }>`, `activePreset(stored: PresetPatch): PresetId | null`, `PREFERENCE_KEY_OF`.

- [ ] **Step 1: Write failing tests.** Write every item in spec test 3 as its own `it`, plus test 2 (Standard's patch deep-equals the column defaults from `getTableColumns(userPreferences)`, with `null` for the order).
  - **PGlite.** Applying Focused over the defaults writes one audit row whose diff keys are exactly `dashboardShowLater` and `dashboardDoneTime`. Re-applying Focused writes none. Reset after Just log restores every changed key in one row.
  - **Actions.** `applyPreset` calls `updatePreferences` once with the full patch. An unknown id, a missing id and an extra key are each a 400. A 429 passes through.
  - **Auth guard.** A case for `applyPreset`.
  - **Settings SSR.** Four Toggles named Standard, Focused, Full day and Just log, each posting `preset=<id>` and each with its §4b blurb. `aria-pressed` is set on the active preset. A custom arrangement renders the static line "Custom: your own arrangement".
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per §4.
  - `activePreset` compares orders with `normaliseSectionOrder(x, "scheduled")` on both sides and every other key with `===`.
  - Announce "<Label> applied" through the existing status region.
- [ ] **Step 4: Run the full gate.** Mutations:
  - Make Focused hide Refills, and the "never triggers the urgent floor" test fails.
  - Compare orders with the account's variant, and the as-needed-only collision test fails.
- [ ] **Step 5: Commit** `feat(dashboard): add Standard, Focused, Full day and Just log presets`.

**After Task 4:** this is the end of Phase 2. The controller opens PR "Dashboard Phase 2" from this branch, then continues Phase 3 on a branch stacked on it (§Delivery).

### Task 5: Phase 3: shared move-focus helper

**Spec:** §5f "After a move", test 13.

**Files:**

- Create: `src/lib/dashboard/move-focus.ts`
- Modify: `src/routes/(app)/settings/dashboard/+page.svelte` (replace its local `focusMoved` logic, with no behaviour change)
- Test: create `tests/unit/move-focus.test.ts`; the existing settings focus test must pass unchanged

**Interfaces:**

- Produces: `moveFocusTarget(prefix: string, id: DashboardSectionId, direction: "up" | "down", isEnd: boolean): string`. It returns the element id to focus, `${prefix}-${id}-${direction}`, or the opposite direction when `isEnd`. Prefixes: `"settings-move"` on the settings page (rename the ids from `move-section-…` and update its tests) and `"editor-move"` in Task 7.

- [ ] **Step 1: Write failing unit tests** for the same-arrow case and the opposite-arrow-at-the-end case, in both directions.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement the helper**, switch the settings page to it, and rename the id prefix.
- [ ] **Step 4: Run the full gate.** The settings page's existing focus tests pass once the ids are renamed.
- [ ] **Step 5: Commit** `refactor(settings): share the after-move focus rule`.

### Task 6: Phase 3: the layout draft and its writer

**Spec:** §5c, §5e, test 11 (draft, write and revert items only). Review Focus 2 and 3.

**Files:**

- Create: `src/lib/components/dashboard/dashboard-editor.svelte.ts`
- Test: create `tests/unit/dashboard-editor.svelte.test.ts`

**Interfaces:**

- Consumes: `PRESETS`, `PREFERENCE_KEY_OF` and `activePreset` (Task 4); `moveSection`, `mergeVisibleOrder`, `normaliseSectionOrder` and `orderValue` (`layout.ts`); `actionErrorMessage`; `deserialize` from `$app/forms`; `showToast`.
- Produces: `createLayoutDraft(initial: LayoutValues, deps?: { post?: (action: string, body: FormData) => Promise<ActionResult>; online?: () => boolean }): LayoutDraft`, where `LayoutValues = { order, showLater, showQuickLog, showRefills, laterMode, doneTime }` and `LayoutDraft` exposes:
  - the reactive `values: LayoutValues`;
  - `move(id, dir, variant)`;
  - `setShown(id: "later" | "quickLog" | "refills", value: boolean)`;
  - `applyPreset(id: PresetId)`;
  - `sync(stored: LayoutValues)`, the payload re-sync that skips keys with a write in flight or queued;
  - `pending(): boolean`.
  - It posts to `/settings/dashboard?/<preferenceKey>` (and `?/applyPreset`) with the same bodies the settings page sends. The module never spells a preference key; it goes through `PREFERENCE_KEY_OF`.

- [ ] **Step 1: Write failing tests** with a stubbed `post`:
  - `move` posts `dashboardSectionOrder` with `orderValue(...)`. On an as-needed-only account the posted order keeps the stored places of `later` and `quickLog`.
  - `setShown("later", false)` posts `dashboardShowLater` with `off`.
  - `applyPreset("focused")` posts `preset=focused`, and the draft equals Focused's patch at once.
  - Per key, last write wins: three quick moves while the first is in flight send exactly two posts, the first and the latest.
  - A failure reverts the key to the last server value and toasts `actionErrorMessage(result)`. A 429 does the same.
  - Offline sends nothing, reverts, and toasts exactly "You're offline — that change wasn't saved."
  - `sync` keeps an in-flight key and updates an idle one. "An invalidate while a key is in flight keeps that key and stays editing" (Review Focus 2).
  - "A preset queued behind an in-flight key ends on the preset" (Review Focus 3).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per §5c and §5e. The default `post` is `fetch(action, { method: "POST", body, headers: { "x-sveltekit-action": "true" } })` followed by `deserialize(await res.text())`.
- [ ] **Step 4: Run the full gate.** Mutations: re-sync in-flight keys and the in-flight test fails; drop the revert and the failure test fails.
- [ ] **Step 5: Commit** `feat(dashboard): add the layout draft that saves each edit as it is made`.

### Task 7: Phase 3: edit mode on the dashboard

**Spec:** §5a, §5b, §5d, §5f and §5g, tests 11 (UI items) and 12. Review Focus 1 and 5.

**Files:**

- Create: `src/lib/components/dashboard/SectionEditBar.svelte`, `src/lib/components/dashboard/EditToolbar.svelte`
- Modify: `src/routes/(app)/dashboard/+page.svelte`, `src/lib/components/KeyboardShortcuts.svelte` (an `editing` prop and the overlay line "Shortcuts are paused while you customise"), `src/lib/components/dashboard/dom-ids.ts` (`CUSTOMISE_HEADING_ID = "customise-heading"`, `DASHBOARD_EDITOR_ID = "dashboard-editor"`)
- Test: add to `tests/unit/dashboard-editor.svelte.test.ts` (mounted, jsdom), `tests/unit/dashboard-page-ssr.test.ts` (footer SSR), and the KeyboardShortcuts test

**Interfaces:**

- Consumes: Task 6's `createLayoutDraft`, Task 5's `moveFocusTarget`, Task 4's `activePreset`/`PRESETS`, Task 3's `stored`, and `getDoseWriteLock`.

- [ ] **Step 1: Write failing tests.**
  - **Footer.** The SSR render is `a[href="/settings/dashboard?from=dashboard"]`. Once mounted, it is `button[type=button][aria-expanded="false"][aria-controls="dashboard-editor"]`.
  - **Entering and leaving.** Entering focuses `#customise-heading`. Escape on the region leaves, and so does Done. Focus returns to the footer button.
  - **Refused entry.** Entering while the lock is `active` does nothing and toasts "Still saving your last change…" with `{ coalesce: true }`.
  - **Order.** The rendered section order follows the draft.
  - **Hidden sections.** A hidden section renders under `[inert]` with "Hidden" in its bar, only while editing.
  - **Unique ids.** Ids are unique across `document.querySelectorAll("[id]")` while editing, with every section hidden and then shown.
  - **Nothing focusable.** No focusable element sits inside any `[inert]` content.
  - **Submit guard.** With `inert` removed, a dose form's `requestSubmit()` while editing posts nothing (the capture-phase guard).
  - **Shortcuts.** A 1–9 keydown while editing submits nothing.
  - **Focus after a move.** It stays on `#editor-move-<id>-<dir>`, and moves to the opposite arrow at an end.
  - **Pinned bar.** On a scheduled account with something due: "Due now · always first while something is due". On an as-needed-only account: "Log a dose · always first on your account", and moves keep the stored places (Review Focus 5).
  - **Refills hidden under the urgent floor.** The bar shows `URGENT_REFILLS_NOTE`.
  - **Remount.** "Remount starts out of edit mode" with no `[inert]` (Review Focus 1).
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement** per §5b, §5d and §5f.
  - **Region.** `<div id="dashboard-editor" role="region" aria-labelledby="customise-heading">`, with the heading rendered only while editing.
  - **`SectionEditBar`.** Shows the `SECTION_LABELS` name. `IconButton` ↑/↓ are labelled "Move <label> up/down" and are `aria-disabled` at the ends. A "Shown" `Toggle` covers `HIDEABLE_SECTIONS`, and Done reads "Always shown".
  - **Root guard.** `onsubmitcapture` on the root calls `preventDefault()` and `stopPropagation()` while editing.
  - **Toolbar.** Sticky, outside every `GlassCard`, with `pb-[env(safe-area-inset-bottom)]` and presets scrolling horizontally. It holds the presets or "Custom", a "More options" link to `/settings/dashboard`, and a primary "Done".
  - **Status region.** Announcements use the settings page's parity zero-width-space trick.
  - **Done.** Calls `invalidateAll()` once after leaving.
- [ ] **Step 4: Run the full gate, then a visual check.**
  - Use the Task 2 harness, mounted rather than SSR. If mounting can't be screenshotted, render the editing markup through SSR with `editing` forced by a test-only initial prop. Only add that prop if it stays internal to the page.
  - Check 375 and 760 widths, in dark: the bars wrap below `sm`, and nothing overlaps.
  - Mutations: drop the capture listener, drop the `editing` guard in KeyboardShortcuts, and duplicate a section's render; each must fail its test.
- [ ] **Step 5: Commit** `feat(dashboard): customise the dashboard in place`.

### Task 8: Docs and final sweep

**Files:** `CLAUDE.md` (the dashboard-layout bullet), `docs/api-v1-contract.md` (confirm Task 1's wording)

- [ ] **Step 1:** Extend CLAUDE.md's "Dashboard layout is presentational" bullet with:
  - presets: total patches, matched with orders normalised against the scheduled defaults, never stored, and Reset is Standard;
  - "edit mode is the real page made inert; never mount a second copy of a section";
  - the capture-phase submit guard and the `KeyboardShortcuts` `editing` guard;
  - edit mode reads the lock and never takes it.
    Match the surrounding density and voice.
- [ ] **Step 2: Run the full gate** once more on the whole branch.
- [ ] **Step 3: Commit** `docs: record dashboard presets and edit mode invariants`.
