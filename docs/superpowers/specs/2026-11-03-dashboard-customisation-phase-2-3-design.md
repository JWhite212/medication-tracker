# Dashboard Phases 2 and 3: two section options, presets, and an in-place edit mode

**Status:** design, 2026-11-03. All five user decisions were answered on 2026-11-03, each with the recommended default. Builds on Phase 0 ([PR #188](https://github.com/JWhite212/medication-tracker/pull/188)), Phase 1 ([PR #189](https://github.com/JWhite212/medication-tracker/pull/189), `docs/superpowers/specs/2026-11-03-dashboard-layout-preferences-design.md`) and the phone fix for Done rows ([PR #190](https://github.com/JWhite212/medication-tracker/pull/190), branch `fix/done-row-phone-layout`).

## Decisions awaiting the user

These are batched into one question set. The recommended default comes first in each.

1. **DECIDED (user, 2026-11-03): Schema change.** Add two `user_preferences` columns, applied by `drizzle-kit push`: `dashboard_later_mode` (`text NOT NULL DEFAULT 'next'`) and `dashboard_done_time` (`text NOT NULL DEFAULT 'both'`). They are additive, there is no backfill, and existing rows read today's behaviour. **Recommended: approve as designed.** Alternative: ship Phase 2 presets over the Phase 1 columns only, and drop Full day and the Done option.
2. **DECIDED (user, 2026-11-03): Public API wire change.** Both keys appear on `/api/v1` sync and become optional enum fields on `update_preferences`. This is additive, and the Mac app's synthesised `Codable` ignores unknown keys (checked for Phase 1; to be re-confirmed before merge). **Recommended: approve.** Alternative: keep them web-only, which would need a new `INTENTIONAL_DIVERGENCES` entry and breaks "the backup restores everything".
3. **DECIDED (user, 2026-11-03): What "How long ago" mode shows on a taken Done row.** **Recommended: "2h 15m ago" alone as the visible line,** with the clock kept in the element's `title` and in screen-reader text. Alternative: "2h 15m ago" first and the clock small underneath (a swap, with less decluttering).
4. **DECIDED (user, 2026-11-03): The four presets** in section 4 ("Standard", "Focused", "Full day", "Just log"), with exactly those patches. **Recommended: approve.** Alternative: name changes only, since the patches follow from the rules below.
5. **DECIDED (user, 2026-11-03): Edit mode saves each change as it is made.** There is no Save or Cancel, and "Done" only leaves the mode. **Recommended: instant save,** which matches `/settings/dashboard` today. Alternative: a draft with Save and Cancel, which needs a third, multi-key write door (see section 9).

**Delivery (designer call).** PR #190 lands first: it fixes the skipped-row phone bug the user screenshotted, and Phase 2 edits the same `DoneList.svelte` markup. Phase 2 then branches from `main` as `feat/dashboard-options-presets`, and Phase 3 is a separate PR, `feat/dashboard-edit-mode`, stacked on it. Phase 3 needs no schema or wire change, so its review stays free of the migration.

Bindings carried over from earlier answers:

- Layout is per account, not per device.
- Due always comes first whenever something is due.
- **Elvanse at 8:55 and 9:00 are two deliberate doses.** No option, preset or mode may merge, deduplicate or hide either row.
- Few people customise (NN/g), so an account that never customises sees exactly today's page.

## Intent and why

The user's complaint was clutter. What they use is Done today and how long ago each dose was taken. They rarely use Later today but see its value. They asked for three things:

- show and hide sections;
- choose which values a section shows and in what format;
- reorder sections.

Phase 1 shipped show/hide and reorder. What is left is **"which values, in what format"**, a quicker way to reach a good arrangement than setting each control, and a quicker way to change things than a separate page.

How other apps do it (from what I know of them; no fresh survey was run for this design):

- **Medisafe, MyTherapy and Round Health** fix a timeline of "taken at" rows and offer almost no home-screen customisation. That supports a short option list.
- **Apple Health Medications** shows "Logged 8:55 AM" and nothing relative. Our "time since" is a distinguishing feature, so the format choice is about where it sits, not whether it exists.
- **iOS Home Screen edit mode, Android At a Glance and Notion** customise in place: you rearrange the real page, then tap Done. None of them shows a miniature copy beside it.
- **Todoist views and iOS Focus modes** are named arrangements you switch between, which is what presets are.

One fact shapes the option set. **`timeSinceDaysFromHours` almost never changes anything on Done.** Done lists today's doses plus a 12h carry-over, and the threshold is at least 24h (`formatTimeSince`, `utils/time.ts`), so Done prints "Xh Ym ago" whatever the setting. The format control a Done user actually notices is _which time fields a row shows_, not when hours become days. So Phase 2 adds a Done display option and not a `time_since_style`.

## Goals

- **Phase 2a:** two per-section options, Later mode (`next | all`) and Done time (`both | since | clock`), on all three preference doors, audited, with defaults that reproduce today byte for byte.
- **Phase 2b:** four presets, applied by one `?/applyPreset` action through one `updatePreferences` call. The active preset is detected by matching and never stored. Reset becomes "apply Standard".
- **Phase 3:** an in-place edit mode on the dashboard. The real page is the preview, hidden sections show dimmed in their places, and every change saves through the existing field actions.

## Non-goals

- Drag and drop. ↑/↓ stay the mechanism.
- Options for Due of any kind.
- Hiding Done, or hiding skipped or missed rows in it.
- Rendering the layout in the Mac app (Phase 1 decision 2 still holds).
- User-named or saved custom presets.
- Storing the active preset.
- Per-device layouts.
- Moving any layout logic into the composer.
- Remembering Later's expanded state across loads. `dashboardLaterMode = "all"` is the persistent version.

## Anti-goals (must never happen)

- An account that never customised seeing any change in markup or copy.
- A preset that hides Quick log and so disables the 1–9 shortcuts as a side effect.
- A preset that triggers the "Refills is hidden" urgent-floor note as a side effect.
- Any option or preset hiding an amber (needs-you) refill. The urgent floor lives in `resolveDashboardLayout`, not in a preset, and stays the only way Refills narrows.
- A skipped or missed Done row showing a "since". Its instant is a slot, not an intake.
- A dose write starting while edit mode is open, by tap, keyboard shortcut or programmatic `requestSubmit()`.
- Two elements with the same id while edit mode mounts a hidden section.
- A slot-boundary reload in Later's `all` mode silently collapsing the list.

## Constraints verified in the code

- `src/lib/dashboard/layout.ts` is zod-free and import-free. It already exports `DASHBOARD_SECTIONS`, `DEFAULT_ORDER`, `HIDEABLE_SECTIONS`, `SECTION_LABELS`, `SHORT_SECTION_LABELS`, `normaliseAgainst`, `normaliseSectionOrder`, `resolveDashboardLayout` (returning `{ pinned, sections, hidden, refillsUrgentOnly }`), `moveSection`, `orderValue` and `mergeVisibleOrder`. Every pure operation Phase 3 needs exists.
- `normaliseSectionOrder(raw, "as-needed-only")` drops `later` and `quickLog`, because `DEFAULT_ORDER["as-needed-only"]` is `["done", "refills"]`. Preset matching therefore cannot normalise against the variant (see section 4).
- `src/lib/server/db/schema.ts` has the five Phase 1 columns. The comment on `dashboardShowLater` already records "Later mode must not gain an `off` value". The latest migration is `drizzle/0023_small_firebrand.sql`.
- `src/routes/(app)/settings/dashboard/+page.server.ts` has `admit()` (the 401, then `enforceLimit(LIMITS.dashboardSettingsSave)`, 60 per minute per account), one `fieldAction(key)` per preference, and `resetDashboardLayout`, which writes the literal `RESET_LAYOUT` through one `updatePreferences` call.
- `dashboardSettingsFieldSchemas` (`src/lib/utils/validation.ts`) is the form door: one `z.strictObject` per key, piped into `preferenceFieldTypes`.
- `(app)/dashboard/+page.svelte` makes the one `resolveDashboardLayout` call. Its `{#snippet section(id)}` renders DoneList, LaterList, the Quick log chips and RefillsCard with their real props. The footer label "Customise this page" / "… is hidden · Customise" is built there.
- `tests/unit/dashboard-layout-owner.test.ts` asserts the dashboard page names `dashboardSectionOrder` exactly once (line 73) and that `layout.ts` never names it.
- `LaterList.svelte` holds `let expanded = $state(false)` and renders `groups.slice(0, 1)` until "Show N more". Its `$effect.pre` runs `if (hasToggle) return; expanded = false;`, so a reload that leaves one group resets the list to folded.
- `DoneList.svelte` computes `since` for taken rows only and renders it as `<time datetime={v.takenAtIso} data-time-since class="block text-xs">` under the clock.
- `KeyboardShortcuts.svelte:80` only suppresses keys while `[aria-modal="true"]` exists, and line 119 calls `form.requestSubmit()`. `inert` does not stop a programmatic `requestSubmit()`, and an in-place mode has no `aria-modal`.
- The composer (`server/dashboard/page-data.ts`) has no preferences, so `data.later`, `data.done` and the refill forecast are always in the payload, whatever is hidden. Phase 3 depends on this.
- `preference-door-conformance.test.ts` asserts 18 columns (line 77), 18 shared keys (line 216) and 12 `NON_APPEARANCE_PREFERENCE_KEYS` (line 378).
- `timeSinceDaysFromHours` is a non-appearance key in `preferences/schema.ts`, written from both `settings/appearance` and `settings/dashboard`. It is shared with /log, /medications and reminder copy.

## 1. Phase 2: storage

```ts
// src/lib/server/db/schema.ts, after the Phase 1 dashboard columns
// Phase 2. text + a zod enum, like time_format / export_format. The DEFAULTs
// are today's page and are pinned to PRESETS.standard by a test.
dashboardLaterMode: text("dashboard_later_mode").$type<DashboardLaterMode>().notNull().default("next"),
dashboardDoneTime: text("dashboard_done_time").$type<DoneTimeDisplay>().notNull().default("both"),
```

The migration, `drizzle/0024_*.sql` from `npx drizzle-kit generate`, must contain exactly:

```sql
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_later_mode" text DEFAULT 'next' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_done_time" text DEFAULT 'both' NOT NULL;
```

There is no UPDATE and no backfill. Push applies both unattended, and the NOT NULL is what makes the DEFAULT reach existing rows. Inspect the generated SQL before merge, as with 0022 and 0023.

Two columns, and each has to earn its place, because each is a permanent obligation across schema, wire, import, export, conformance probes and the Mac app.

## 2. Phase 2: the options

### 2a. `dashboardLaterMode`: how much of Later is drawn

| Value            | Rendering                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `next` (default) | Today: the first `groupLaterRows` group, then "Show N more".                                                                         |
| `all`            | Every group expanded on first render. The toggle stays, reads as it does when expanded today, and can fold the list for the session. |

- **There is no `off`.** `dashboardShowLater` stays the only owner of whether Later is shown.
- **LaterList change:** a `mode: DashboardLaterMode = "next"` prop. `let expanded = $state(mode === "all")`, read once through `untrack`.
- **The reset becomes mode-aware.** The `$effect.pre` that runs when the toggle disappears sets `expanded = mode === "all"` instead of `false`. Without that, a slot-boundary reload that leaves one group and then brings a second back would silently collapse `all`. The focus-parking half of the effect is unchanged.
- **Why it earns its place:** it is the only Later behaviour the user cannot get today without a tap, and Full day is meaningless without it. The user rarely uses Later, so the useful axis is less versus more. Less is already `dashboardShowLater = false`, and this supplies more.

### 2b. `dashboardDoneTime`: which time fields a taken Done row shows

| Value            | A taken row at 14:30 for a dose at 08:55                                     |
| ---------------- | ---------------------------------------------------------------------------- |
| `both` (default) | **08:55**, then small "5h 35m ago". Byte-identical to today.                 |
| `since`          | **5h 35m ago** as the primary line (`text-sm text-text-primary`). See below. |
| `clock`          | **08:55** only. No `[data-time-since]` element is rendered.                  |

- **`since` keeps the exact instant reachable.** The visible text sits inside the same `<time datetime={takenAtIso} data-time-since>`, which gains `title="08:55"` and an sr-only suffix " at 08:55". The Edit button's sr-only "taken at 08:55" text is unchanged. (Decided, item 3; the alternative swaps the two lines and changes nothing else in this section.)
- **Skipped and missed rows are unchanged in every mode.** They show their clock time and never a since. That also keeps PR #190's phone layout for skipped rows intact.
- **The "Yesterday" prefix line** for carry-over rows is unchanged in every mode.
- **Elvanse 08:55 and 09:00:** both rows render in every mode. The option removes a field, never a row: "5h 35m ago" and "5h 30m ago" in `since`, "08:55" and "09:00" in `clock`.
- **Width:** "26h 59m ago" does not fit the clock column's `min-w-20`, so in `since` mode the column takes `min-w-24`. #190 already puts the name on its own line below `sm`, which absorbs this. Verify at 320px and 375px.
- **Scope:** the dashboard's Done only. /log and /medications keep `TimeSince` as it is, which the column name says.
- **The 60s tick** keeps running in `clock` mode. That is harmless, and not worth a branch.
- **Why it earns its place:** it is the user's own request ("choose which values a section shows and in what format"), on the one section they said they use, for the value they named.

### 2c. Where the domains live

- `src/lib/preferences/domains.ts` (zod-free): `DASHBOARD_LATER_MODES = ["next", "all"] as const` and `DONE_TIME_DISPLAYS = ["both", "since", "clock"] as const`, with their types `DashboardLaterMode` and `DoneTimeDisplay`.
- `src/lib/preferences/schema.ts`: `dashboardLaterMode: z.enum(DASHBOARD_LATER_MODES)` and `dashboardDoneTime: z.enum(DONE_TIME_DISPLAYS)`. The `Exclude<PreferenceKey, AppearanceKey>` key set makes each column a compile error until it is listed. Arities 2 and 3 are `optionalise()` with no override, so `INTENTIONAL_DIVERGENCES` stays empty. The "twelve keys" comments become "fourteen".
- `src/lib/utils/validation.ts`: `dashboardSettingsFieldSchemas` gains `dashboardLaterMode: z.strictObject({ dashboardLaterMode: preferenceFieldTypes.dashboardLaterMode })` and the same shape for Done. An enum posts as a plain string, so no transform is needed.
- `settings/dashboard/+page.server.ts`: two more `fieldAction(...)` entries.
- **The read side is tolerant**, like `normaliseSectionOrder`. A new `normaliseOption(raw, values, fallback)` in `layout.ts` returns the fallback for anything not in the domain and never throws, so a value written by a newer Mac build cannot break the page.

### 2d. Page wiring (`(app)/dashboard/+page.svelte`)

- The page gathers the stored layout values **once**, into `const stored = { order: data.preferences.dashboardSectionOrder, showLater: …, laterMode: normaliseOption(…), doneTime: normaliseOption(…) }`. The resolver and Phase 3's editor both read `stored`, so the owner test's "exactly once" for `dashboardSectionOrder` still holds.
- The `section(id)` snippet passes `mode={stored.laterMode}` to LaterList and `timeDisplay={stored.doneTime}` to DoneList. Both props default to today's behaviour, so the walkthrough parts, `due-card-ssr`, `timeline-entry-ssr` and `walkthrough-dashboard-fidelity` hold without edits.

### 2e. `/settings/dashboard` additions (no-JS first, same contract as Phase 1)

- **Later row:** a two-option group, "Next few" / "Whole day", as `Toggle`s with `submit={{ name: "dashboardLaterMode", value }}` in one `<form action="?/dashboardLaterMode">`. When Later is hidden, the group still works and its hint says "Later today is hidden".
- **Done row:** a three-option group, "Time and how long ago" / "How long ago" / "Time only". Under it, a sample renders a fixed 2h15m-old instant through `formatTimeSince` itself (the Appearance time-since sample's precedent), so the label cannot drift from the output.
- Each group is a `fieldset` with a `legend`. `Toggle` renders `aria-pressed` from the server-confirmed value. Presses post a complete value, with no optimistic state and no debounce. The page's single `saving` flag and `aria-disabled` apply. The existing `save()` handler gains an `option` intent that announces "Later today: whole day".

## 3. Phase 2: what was cut, and why

- **`dashboard_refills_min_tier`** (sketched in the Phase 1 spec). It is unsafe and redundant. `refillChip` (`RefillsCard.svelte:56`) draws a row amber when stock is at or below the alert threshold whatever the tier, so a tier filter would hide exactly the at-threshold rows a73565e and `refills-card-agreement.test.ts` exist to show. A tone filter ("only what needs you") is redundant, because hiding Refills already renders exactly that set through the urgent floor. If the floor's note reads badly, that is a copy fix, not a column.
- **`dashboard_later_grouping`.** `LATER_GROUP_WINDOW_MS` (10 minutes) is a presentational constant nobody has complained about, and exposing it invites a numeric bound, a probe and a divergence risk.
- **A Later `next3` mode.** It is an arbitrary middle state and a third path through LaterList's collapse and focus logic, for no named need. The enum can gain it later, additively.
- **A Later `summary` mode** (one line: "Next: Elvanse 10mg at 13:00 · 3 more today"). It is a third path through the same logic, plus new copy the walkthrough tests would also track, for a section the user rarely uses and can already hide.
- **An app-wide `time_since_style`** ("2:15 ago", "2.3h"). Minute precision matters for stimulant timing, and the real ask is which fields (2b). A second format axis would triple DoneList's SSR test matrix.
- **Done row order (newest first).** Plausible, but not asked for, and it changes which row `restoredDoneRowFocus` and the Remove focus paths land near. Deferred.
- **Quick log scope** (as-needed medications only). It renumbers the 1–9 shortcuts per account and changes what `findQuickLogForm` reaches. Deferred until wanted.

## 4. Phase 2: presets

### 4a. Module: `src/lib/dashboard/presets.ts`

Zod-free, with `import type` only from `$lib/types`, and imports from `layout.ts` and `preferences/domains.ts`. It joins the bundle-boundary test's client-reachable set.

```ts
export const PRESET_KEYS = [
  "dashboardSectionOrder",
  "dashboardShowLater",
  "dashboardShowQuickLog",
  "dashboardShowRefills",
  "dashboardLaterMode",
  "dashboardDoneTime",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];
export type PresetPatch = { [K in PresetKey]: UserPreferences[K] }; // TOTAL, not Partial
export const PRESET_IDS = ["standard", "focused", "fullDay", "justLog"] as const;
export type PresetId = (typeof PRESET_IDS)[number];
export const PRESETS: Record<PresetId, { label: string; blurb: string; patch: PresetPatch }>;
export function activePreset(stored: PresetPatch): PresetId | null;

/** The one place a layout field's short name meets its preference key (Phase 3 posts by it). */
export const PREFERENCE_KEY_OF = {
  order: "dashboardSectionOrder",
  showLater: "dashboardShowLater",
  showQuickLog: "dashboardShowQuickLog",
  showRefills: "dashboardShowRefills",
  laterMode: "dashboardLaterMode",
  doneTime: "dashboardDoneTime",
} as const satisfies Record<string, PresetKey>;
```

- **A patch is total over `PRESET_KEYS`.** Applying a preset gives the same result from any starting state, and matching is exact.
- **`timeSinceDaysFromHours` is not a preset key.** It is a reading preference shared with /log, /medications and reminder copy, and a dashboard preset must not silently change those.
- `presets.ts` names `dashboardSectionOrder`, so it joins that key's owner list in `dashboard-layout-owner.test.ts`, deliberately.

### 4b. The patches (decided, item 4)

| id         | Label    | order                                       | showLater | showQuickLog | showRefills | laterMode | doneTime    |
| ---------- | -------- | ------------------------------------------- | --------- | ------------ | ----------- | --------- | ----------- |
| `standard` | Standard | `null`                                      | true      | true         | true        | `next`    | `both`      |
| `focused`  | Focused  | `null`                                      | **false** | true         | true        | `next`    | **`since`** |
| `fullDay`  | Full day | `null`                                      | true      | true         | true        | **`all`** | `both`      |
| `justLog`  | Just log | **`["quickLog","done","refills","later"]`** | **false** | true         | true        | `next`    | **`since`** |

Blurbs, one line each:

- Standard: "The dashboard as it ships."
- Focused: "What you've taken and how long ago, without the rest of the day."
- Full day: "Every dose left today, listed."
- Just log: "Logging buttons first, then what you've taken."

Rules the table obeys:

- **`standard` is today, and it replaces `RESET_LAYOUT`.** Reset becomes `updatePreferences(userId, PRESETS.standard.patch)`, so it also resets the two new columns. That is correct, because Reset now means "Standard". Its per-variant label from 09cb2a4 stays.
- **No preset hides Quick log**, so no preset disables the 1–9 shortcuts.
- **No preset hides Refills**, so no preset triggers the urgent-floor note. (This is why Focused keeps Refills, unlike earlier sketches.)
- **No preset touches Done visibility.** Done has no flag.
- **Due stays pinned in all four by construction.** No order contains `"due"`.
- **Just log stores `later` last,** so re-showing Later afterwards puts it in a sensible place.

### 4c. The matching rule

`activePreset(stored)` returns the preset for which every key in `PRESET_KEYS` matches, else `null` (rendered as "Custom"):

- `dashboardSectionOrder` matches when **both sides normalised against the scheduled defaults** are equal: `normaliseSectionOrder(x, "scheduled")`. So `null`, `[]`, an explicit default array and a stored subset all compare by their effective full order.
  - Not against the account's variant: as-needed-only normalisation drops `later` and `quickLog`, which would make Just log's order equal Standard's and let Focused and Just log collide. The stored order of an as-needed-only account still places Later and Quick log (through `mergeVisibleOrder`), so the scheduled comparison is the faithful one.
  - Consequence, accepted: on an as-needed-only account Standard and Full day look the same (Later never renders there), and so do Focused and Just log (Quick log is pinned first anyway). They remain distinguishable by stored values, so matching stays unambiguous.
- Every other key matches with `===`.

The active preset is never stored: no column, nothing on the wire. The Mac app can run the same match, or simply send a patch.

### 4d. The door: `?/applyPreset`

- On `settings/dashboard/+page.server.ts`. It opens with `if (!locals.user) error(401, "Unauthorized")` inside `admit("applyPreset", locals)`.
- Schema in `validation.ts`: `z.strictObject({ preset: z.enum(PRESET_IDS) })`. The client posts only the id, never the patch, so the form door cannot be used to write an arbitrary multi-key blob. There is still no all-optional form door.
- Body: `updatePreferences(userId, PRESETS[id].patch)`. That is one write and one multi-key audit row, and the diff is scoped to `Object.keys(updates)` against the locking CTE's before-image, so it lists only the keys that changed. Re-applying the preset already in force logs nothing.
- Failure is `fail(400, { error })` or the 429 shape `admit()` already returns, both read by `actionErrorMessage`.
- **No `/api/v1` command.** A preset is just a patch, which the Mac app can send through `update_preferences`. Preset ids are not part of the wire.

### 4e. Settings UI

A "Start from" `fieldset` at the top of `/settings/dashboard`, above Sections:

- Four `Toggle`s with `submit={{ name: "preset", value: id }}` in one `<form method="POST" action="?/applyPreset" use:enhance>`, each with its blurb underneath.
- `aria-pressed` is `activePreset(stored) === id`.
- When nothing matches, a static neutral line: "Custom: your own arrangement". It is not a control.
- Applying announces "Focused applied" through the page's existing status region. Focus stays on the pressed toggle, which is keyed by id and survives the reload.
- No confirmation, and not `danger`: applying a preset is reversed by applying another, and Standard is one press away.

## 5. Phase 3: in-place edit mode

### 5a. Why in place, and what it must add

`/settings/dashboard` already orders, toggles, applies presets and works without JS. A sheet that repeats those controls beside a little preview is a second copy of the settings page kept in step by hand. A sheet that renders the real sections a second time also breaks things the code depends on:

- it duplicates fixed ids: `DONE_HEADING_ID` (`dom-ids.ts`), `later-heading` / `later-list`, `quick-log-heading` and `refills-heading`, which Remove, Undo restore and the edit Modal's `returnFocus` resolve by id;
- it adds a second `form[data-quick-log]` for `findQuickLogForm` and the 1–9 keys;
- it adds live dose controls that need the write lock, the dashboard clock and `use:enhance`. The walkthrough already paid this cost: its stage is drawn, never mounted.

So edit mode follows the iOS Home Screen and Notion model. It earns its place by doing three things the settings page cannot:

1. **The preview is the page itself.** You rearrange the real dashboard, with today's rows, through the same `resolveDashboardLayout` call and the same `section(id)` snippet, so the preview cannot disagree with the result.
2. **Hidden sections are visible while editing,** dimmed in the place they would occupy, with real data (the composer always sends it). You see what you are hiding before you hide it.
3. **No navigation.** One tap in, one tap out.

Everything else stays on the settings page: the two Phase 2 options, `timeSinceDaysFromHours`, and the explanations. Edit mode's section bars carry only ↑/↓ and show/hide, plus a link "More options" to `/settings/dashboard`. That avoids a second copy of the option labels and halves the edit-mode test matrix.

### 5b. Entry point

- The footer control stays where Phase 1 put it, with the same label ("Customise this page", or "Later today is hidden · Customise").
- **In SSR and before hydration it is `<a href="/settings/dashboard?from=dashboard">`.** That is the complete no-JS path, presets included. A press before hydration navigates, which is correct, and never lands on a dead button.
- **After mount** (an `$effect` sets `hydrated = true`), the same `Button` renders without `href`, as `type="button"` with `aria-expanded={editing}` and `aria-controls="dashboard-editor"`. This mirrors the /log × "button until mounted" rule in reverse.
- There is no second entry point. One is enough.
- **Entering is refused while a dose write is `active`.** The handler reads `getDoseWriteLock().active` and, if set, shows the "Still saving your last change…" toast with `{ coalesce: true }`, the same words `beginDoseWrite` uses. This is a read, not an `acquire()`, so `begin-dose-write.test.ts`'s pinned caller list and its scan are unaffected. The reason: `reloadAfterWrite` could otherwise re-render rows under the editor mid-gesture.

### 5c. State: `src/lib/components/dashboard/dashboard-editor.svelte.ts`

- `createLayoutDraft(stored)` holds six `$state` values under short names, `{ order, showLater, showQuickLog, showRefills, laterMode, doneTime }`, with the order normalised against the scheduled defaults.
- **The module never names a preference key.** It posts through `PREFERENCE_KEY_OF` from `presets.ts`. So the dashboard page stays the only reader of the stored values on the dashboard, and the owner scans need no new exemption for it.
- Ops, all pure over the draft:
  - `move(id, dir, variant)`, which is `mergeVisibleOrder(moveSection(normaliseSectionOrder(order, variant), id, dir), normaliseSectionOrder(order, "scheduled"))`, exactly the settings page's composition, so an as-needed-only account keeps its stored places for Later and Quick log;
  - `setShown(id, value)` for `HIDEABLE_SECTIONS` only;
  - `applyPreset(id)`, which copies the patch into the draft.
- While `editing`, the page renders `resolveDashboardLayout({ ...draft, variant, hasUrgentRefill })`; otherwise it renders from `stored`. Same function, one call site.

### 5d. Interaction model

- **Region.** While editing, the sections are wrapped in `<div id="dashboard-editor" role="region" aria-labelledby="customise-heading">`, inside the page column (`div.mx-auto.max-w-2xl`). Its first child is `h2#customise-heading` ("Customising your dashboard", `tabindex="-1"`), rendered only while editing. The footer control's `aria-controls` points at this id.
- **Section bars.** Each section in `layout.sections` and `layout.hidden` is wrapped in a bar (`SectionEditBar.svelte`, new):
  - the name from `SECTION_LABELS`;
  - `IconButton` ↑ and ↓, labelled "Move Later today up" / "… down", `aria-disabled` at the ends;
  - a show/hide `Toggle` ("Shown", `aria-pressed`) for `HIDEABLE_SECTIONS`. Done shows the text "Always shown" instead;
  - for a hidden section, a "Hidden" label, and its content at reduced opacity;
  - for Refills hidden while the urgent floor forces it in, `URGENT_REFILLS_NOTE` in the bar, the floor made visible.
- **Pinned bars.** Due, when present, gets a fixed bar with no controls: "Due now · always first while something is due". On as-needed-only accounts Quick log gets "Log a dose · always first on your account".
- **Content is inert.** Every section's content sits in a wrapper with the `inert` attribute while editing, so no dose control, chip, Edit, Remove or "Show N more" is reachable or tappable. It still renders live from the payload.
- **A belt for `inert`.** The dashboard root carries a capture-phase `submit` listener (`onsubmitcapture`) that, while editing, calls `preventDefault()` and `stopPropagation()` on any submit. Capture at an ancestor runs before the form's own enhance listener, so this stops a dose write even where `inert` is missing (old iOS PWAs) or bypassed by `requestSubmit()`.
- **Shortcuts.** `KeyboardShortcuts` gains an `editing` prop, and 1–9 do nothing while it is true. This guard is explicit because the `aria-modal` gate does not apply and `requestSubmit()` ignores `inert`. The `?` overlay adds "Shortcuts are paused while you customise".
- **Toolbar.** A sticky bottom bar (`position: sticky; bottom: 0`, inside the page column and outside every `GlassCard`, because `backdrop-blur-xl` makes a card the containing block) holds the four preset `Toggle`s, or "Custom" when `activePreset(draft)` is `null`, plus a "More options" link and a primary "Done" `Button`.
- **The Undo offer** stays usable. Toast lives in the layout, outside the inert region.
- **The dashboard clock** keeps running. A slot-boundary `invalidateAll()` refreshes the rows under the editor, which is correct, because they are live facts. It announces nothing.

### 5e. Saving (decided, item 5)

Every control change updates the draft synchronously, then POSTs the **existing** field action, with the same body the settings page posts:

| Change      | POST                                                                  |
| ----------- | --------------------------------------------------------------------- |
| ↑ / ↓       | `/settings/dashboard?/dashboardSectionOrder` with `orderValue(order)` |
| Show / hide | `/settings/dashboard?/dashboardShowLater` (etc.) with `on` / `off`    |
| A preset    | `/settings/dashboard?/applyPreset` with `preset=<id>`                 |

No new action is added for Phase 3.

- **The POST goes through one helper, `submitPreference(action, body)`** (`fetch` plus `deserialize` from `$app/forms`). It reads every non-success result through `actionErrorMessage`. On failure the draft key reverts to the last server value, and a toast shows the message. Handling only success would be the silent failure `form-errors.ts` exists to prevent.
- **Offline**, it sends nothing, reverts and toasts "You're offline — that change wasn't saved." It must not reuse `OFFLINE_WRITE_TOAST`, which the begin-dose-write scan reserves for `beginDoseWrite`.
- **Writes are serialised per key, last write wins.** While a key is in flight a newer value is queued, and only the latest is sent. A preset counts as in flight for all six keys.
- **Draft versus payload.** The draft re-syncs from `stored` on each new payload, **except for keys with a write in flight or queued.** Without that, the dashboard clock's refresh landing mid-edit would snap a just-moved section back.
- **"Done"** sets `editing = false` and calls `invalidateAll()` once, so the page renders the server's truth. It is not a save, because everything is already saved.
- **No dose-write lock is taken.** These are not dose writes, and the page content is inert throughout.
- **Rate limit.** `dashboardSettingsSave` allows 60 per minute. Ten quick ↑ presses are ten writes, well inside it. A 429 reverts and toasts like any failure.
- **Audit cost:** one audit row per press, the same as the appearance page and the settings page today. Accepted.

Why instant rather than a draft with Save and Cancel: every change is reversible (presets, Reset, ↑/↓), every write is already audited, and the settings page is already instant. Save and Cancel would add a third write path (an all-required multi-key `saveLayout` action), a dirty state, and a `beforeNavigate` discard prompt, for no safety gain on a reversible, non-medical preference.

### 5f. Accessibility, focus and keyboard

- **Enter.** Focus moves to `#customise-heading` with `{ preventScroll: true }`. A polite status region in the editor says "Customising. Changes save as you make them."
- **Leave.** "Done" and Escape both leave. Escape is handled on the editor region, not the document, so it never fights Modal or the help overlay. Focus returns to the footer control; if that is gone, to `pageHeading`, without scrolling.
- **After a move,** focus goes back explicitly, after `tick()`, to the same arrow of the moved section, or to the opposite arrow when the section reaches an end and that arrow becomes `aria-disabled`. This is commit 09cb2a4's rule from the settings page, and keyed DOM moves can drop focus in some engines. **The rule is extracted** from the settings page's `focusMoved` into one shared helper, `moveFocusTarget(prefix, id, direction, isEnd)` in `src/lib/dashboard/move-focus.ts`, used by both pages, with id prefixes `settings-move-…` and `editor-move-…` so they can never collide.
- **Announcements** use the settings page's parity zero-width-space trick: "Later today moved to position 2 of 4", "Refills hidden. Refills that need you still show", "Focused applied".
- **Tab order** follows visual order: toolbar controls last, bars top to bottom, inert content skipped.
- **Controls** are `Button`, `IconButton` and `Toggle` only, so they get the 2px `accent-ink` ring and fixed heights (`h-11`, `size-11`), never padding, so `data-density="compact"` cannot shrink a target below 44px. They signal state with `aria-disabled`, never `disabled`. Bar borders are `border-strong` (a control boundary under WCAG 1.4.11). No status colour is used: pressed is the accent.
- **Motion:** reorders are instant. No `animate:flip`, so `data-reduced-motion` has nothing to honour.
- **Without JS:** the footer is a link to the settings page, which supports everything.

### 5g. Phone and desktop

- **Phone:** each bar is a full-width row above its section, the name on the left and the controls right-aligned. Below `sm` they wrap onto a second line rather than letting words run under buttons, which is the #190 lesson. The toolbar is sticky at the bottom with `pb-[env(safe-area-inset-bottom)]`. Its presets scroll horizontally inside the toolbar, never across the page.
- **Desktop:** the same markup in the `max-w-2xl` column. No side panel: the preview is the page, so a panel would only shrink it.

## 6. API, import, export and the Mac app

- **`/api/v1 update_preferences`:** two new optional enum keys through `optionalise()`. Old clients never send them, and an unknown value is a 400, like every other enum. Sync and read responses pick them up through `serializePreferences`'s spread. (Decided, item 2.)
- **`docs/api-v1-contract.md`** gains both domains and one semantics line: "Presentation advice. Clients without a dashboard store and return these unchanged. There is no `off` for Later; use `dashboardShowLater`."
- **Import:** `preferenceImportShape` gains both keys as optional enums. `import/apply.ts` is unchanged. An old backup lacks them and leaves them alone.
- **Export and backup:** automatic.
- **Mac app:** decodes, keeps and ignores both keys (Phase 1 decision 2). Before merge, re-confirm that `WirePreferences` (`WireModels.swift:372`) still uses synthesised `Codable`. It may apply a preset by sending the patch.
- **Phase 3** has no schema change, no wire change and no new API.
- **Walkthrough:** unaffected. The defaults reproduce today, the composer is unchanged, and `StageDoneList` / `StageLaterList` copy the default rendering. A comment in `StageDoneList.svelte` names `dashboardDoneTime` as deliberately not modelled.

## 7. Tests that pin it

Each is proven by breaking the line it guards (the project's mutation rule).

**Phase 2**

1. **`preference-door-conformance.test.ts`.** The literals become 20 columns (line 77), 20 shared keys (line 216) and 14 `NON_APPEARANCE_PREFERENCE_KEYS` (line 378). The derived `ZodEnum` probes cover the new keys automatically. Pinned literal cases are added because derived probes move with the schema: `dashboardLaterMode` accepts `next` and `all` and rejects `"off"`, `"next3"` and `""`; `dashboardDoneTime` accepts its three values and rejects `"relative"` and `""`. Mutation: add `"off"` to `DASHBOARD_LATER_MODES` and the literal case fails.
2. **Defaults pin (`tests/unit/dashboard-presets.test.ts`).** For every key in `PRESET_KEYS`, `PRESETS.standard.patch[k]` deep-equals `getTableColumns(userPreferences)[k].default` (with `null` for the order, which has none). That mechanises "an account that never customises sees today".
3. **Presets (same file):**
   - every patch is total over `PRESET_KEYS`;
   - every patch parses through the real door, `z.strictObject` over `preferenceFieldTypes` picked to `PRESET_KEYS`;
   - for both variants, every patch run through `resolveDashboardLayout` keeps `done` in `sections`, keeps `pinned`, has `refillsUrgentOnly === false` with no urgent refill, and never puts `quickLog` in `hidden`;
   - `activePreset(PRESETS[x].patch) === x` for each preset, and no two patches match each other;
   - `null`, `[]`, the explicit default array and a stored subset all match Standard;
   - changing any single key of a preset gives `null`;
   - `resetDashboardLayout` writes `PRESETS.standard.patch`.
4. **PGlite (`tests/unit/pg/preferences-audit.test.ts`):**
   - a freshly seeded user reads both new defaults, which proves migration 0024;
   - applying Focused over defaults writes one audit row naming exactly `dashboardShowLater` and `dashboardDoneTime`;
   - re-applying it writes none;
   - Reset after Just log restores every changed key in one row.
5. **Actions.** In `dashboard-settings-actions.test.ts`: each new field action calls `updatePreferences` with exactly its key; `applyPreset` calls it once with the full patch; an unknown id, a missing id and an extra key are each a 400; a 429 passes through. In `app-action-auth-guard.test.ts`: cases for `applyPreset`, `dashboardLaterMode` and `dashboardDoneTime`, each with a body that passes its schema. Its coverage test fails until they exist.
6. **DoneList SSR (`done-list-ssr.test.ts`, reading `.body`, because `render()` is lazy):**
   - no prop renders byte-identical to `timeDisplay="both"`;
   - `since` puts the since text as the primary line on taken rows, inside `<time datetime>` with the clock in `title` and in sr-only text;
   - `clock` renders no `[data-time-since]`;
   - skipped and missed rows show their clock and no since in every mode;
   - the Elvanse 08:55 and 09:00 doses produce two distinct rows in every mode.
     Mutation: drop the `status === "taken"` guard in `since` mode and the skipped-row case fails.
7. **LaterList component test:** `mode="all"` renders every group on mount; a reload to one group and back to two leaves it expanded. Mutation: hard-code the reset to `false` and it fails.
8. **Dashboard page forwarding (`dashboard-page-ssr.test.ts`),** one per option in the pattern of e23aa09, so the page passes the stored value and not the default.
9. **Owner scan (`dashboard-layout-owner.test.ts`),** generalised to `dashboardLaterMode` and `dashboardDoneTime` in both directions. The dashboard page names each exactly once (in its `stored` gather). `presets.ts` joins all three keys' owner lists. The editor module names none.
10. **Bundle boundary (`appearance-bundle-boundary.test.ts`):** `dashboard/presets.ts`, `dashboard/move-focus.ts` and `preferences/domains.ts` stay zod-free.

**Phase 3**

11. **`dashboard-editor.svelte.test.ts`** (jsdom, mounted under the real layout contexts):
    - entering focuses `#customise-heading`, and Escape and Done both leave and return focus to the footer control;
    - the rendered order follows the draft through `resolveDashboardLayout`;
    - a hidden section renders dimmed under `[inert]` only while editing, and not at all otherwise;
    - **ids are unique** across `document.querySelectorAll("[id]")` while editing with every section hidden-then-shown;
    - no focusable element exists inside any section's content while editing;
    - a dose form's submit is cancelled while editing, with `inert` removed by the test. Mutation: drop the capture listener and it fails;
    - a 1–9 keydown submits nothing while editing. Mutation: drop the `editing` guard and it fails;
    - focus stays on the moved section's arrow, and moves to the opposite arrow at an end;
    - the draft survives a payload refresh for an in-flight key, and re-syncs a key with nothing in flight;
    - a failed POST reverts the key and toasts `actionErrorMessage`'s text;
    - entering is refused, with the coalesced toast, while the lock is `active`.
12. **Footer hydration:** the SSR render is `<a href="/settings/dashboard?from=dashboard">`, and the mounted render is `type="button"` with `aria-expanded`.
13. **Shared focus helper:** `moveFocusTarget` has its own unit test, and the settings page's existing focus test passes against it unchanged.
14. **Manual check on prod after merge** (local dev login is a known dead end): on a phone, enter, move Done up, hide Later, apply Focused, leave; with VoiceOver, the region name and the move announcement; on iOS Safari, that taps on inert content do nothing.

## 8. Risks

- **Production schema change and an additive public wire change** (decided, items 1 and 2). Re-check the Mac decoder first.
- **The editor draft clobbered by the dashboard clock's `invalidateAll`.** Mitigated by the in-flight-key rule; covered by test 11.
- **`inert` missing, or bypassed by `requestSubmit()`.** Mitigated by the capture-phase submit listener and the explicit `KeyboardShortcuts` guard; both mutation-tested.
- **Hidden sections mounting for the first time inside edit mode.** They render composed data the page already has, and LaterList's focus-parking effect cannot steal focus, because `focusIfLost` only acts when focus is lost and focus is in the editor. Duplicate ids are impossible because a hidden section is otherwise not mounted at all; test 11 asserts it.
- **`since` hides the clock.** Someone checking "did I take it at 08:55 or 09:00" reads "2h 5m ago" and "2h ago" instead. The clock stays in `title` and sr-only text, and `both` is one press away. The user chose this over the swap (item 3).
- **`since` widens the time column** on a 320px phone. #190's own-line name absorbs it; verify on device.
- **Preset collisions as columns are added.** The pairwise test fails the moment two patches stop being distinct, and totality forces every future preset key to be set in every patch.
- **One audit row per edit-mode press.** The same as appearance today. Accepted.
- **An Undo offer during edit mode** stays reachable, because there is no focus trap, but its target row is inert until the user leaves. Undo's focus fallback then lands on the `h1`. Accepted.

## 9. Explicitly cut from Phase 3, and why

- **A modal Customise sheet with a second preview renderer.** It duplicates fixed ids, the Quick log form and live dose controls (5a), and is the kind of drift the walkthrough tests exist to catch.
- **A new `Sheet` primitive.** Not needed without a sheet.
- **Draft plus Save and Cancel**, a `saveLayout` / `saveDashboardLayout` all-required action and a `beforeNavigate` discard prompt. See 5e. Had the user chosen this (item 5), the action must be a `z.strictObject` composed from the existing per-field shapes with **every key required**, because an all-optional form door writes defaults over the user's settings (the `heatmapPeriod` lesson).
- **Per-section option controls in the edit bars.** They would be a second copy of the option labels; "More options" links to the settings page instead.
- **A new `/api/v1` `apply_preset` command.** The patch is the API.
- **Editing `timeSinceDaysFromHours` in edit mode.** It has no per-section visual and stays on the settings pages.

## 10. Calls made by the designer

- **Base and grafts.** The minimal design is the base. From the others: the mode-aware LaterList reset; the capture-phase submit guard and the unique-id test; the SSR link that becomes a button after hydration; the defaults pin against the column defaults and parsing each patch through the real door; keeping the exact instant reachable in `since` mode; the PGlite preset audit tests; the Mac decoder re-check and contract wording; one shared move-focus helper; and the owner scan generalised to the new keys.
- **Two options, not four.** Later mode and Done time. Everything else in the Phase 1 sketch is cut in section 3.
- **Focused does not hide Refills**, because a preset must not raise the urgent-floor note as a side effect.
- **Presets match on order normalised against the scheduled defaults**, not the account's variant, so as-needed-only accounts cannot produce a collision.
- **Reset is "apply Standard"** and now resets both new columns.
- **Edit mode reads the lock but never takes it,** and takes no `aria-modal`, so it needs its own shortcut guard.
- **Preset ids are `standard | focused | fullDay | justLog`**, camelCase like the section ids. `standard` rather than `default`, so it cannot be confused with the order field's `"default"` form value.
- **`PREFERENCE_KEY_OF` lives in `presets.ts`**, so the editor posts by preference key without naming one.
- **Domain arrays live in `preferences/domains.ts`**, beside the other zod-free bounds, rather than in `layout.ts`.

## 11. Delivery order

1. Land #190 (the skipped Done row on phones).
2. **Phase 2a, schema and doors:** columns and migration 0024, `domains.ts`, `preferenceFieldTypes`, the form door and the two field actions, conformance, PGlite defaults, `docs/api-v1-contract.md`.
3. **Phase 2b, rendering:** `normaliseOption`, the page's `stored` gather, the DoneList and LaterList props, the settings option groups, the SSR, component and forwarding tests, the owner scan.
4. **Phase 2c, presets:** `presets.ts`, `?/applyPreset`, Reset unified onto Standard, the "Start from" fieldset, the preset tests.
5. **Phase 3:** `move-focus.ts` extracted first (settings page unchanged in behaviour), then the editor module, `SectionEditBar`, the footer upgrade, the inert wiring, the submit guard and shortcut guard, the toolbar, and their tests. CLAUDE.md's dashboard layout bullet gains: presets and their matching rule; "edit mode is the real page made inert; never mount a second copy of a section"; and the capture-phase guard.

Each step is gated on `npm run check` (with pglite installed in the worktree), lint and `npx vitest run`.
