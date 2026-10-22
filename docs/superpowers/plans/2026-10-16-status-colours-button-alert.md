# Status Colours, Button and Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every status colour in the signed-in app exactly one meaning, owned by one module, and move every non-dose button and banner onto shared `Button`, `IconButton`, `Toggle` and `Alert` primitives, with one guarded confirmation for each permanent deletion.

**Architecture:**

- A pure, client-reachable module, `src/lib/utils/status-tone.ts`, maps each status to a tone, and each tone to literal Tailwind token classes per element: text, chip, marker, bar, alert box and a card's status border.
- Components read it instead of writing `warning`, `success`, `danger` or `info` classes themselves.
- A two-way source-scan test enforces that. It starts with a `PENDING_MIGRATION` list that each task shrinks, and Task 13 deletes the list.
- The primitives live in `src/lib/components/ui/`. They use fixed heights, so compact density can't invert their sizes.
- Dose controls are fenced: only their colours change.

**Tech Stack:** SvelteKit 2 with Svelte 5 runes; Tailwind CSS v4 with tokens in `src/app.css`; Vitest 4 (jsdom by default, `// @vitest-environment node` for SSR and server); Drizzle with `tests/unit/helpers/fake-db.ts`, and PGlite through `tests/unit/helpers/pg-db.ts` where the database decides the behaviour; axe through `tests/unit/helpers/axe-ssr.ts`.

**Spec:** `docs/superpowers/specs/2026-10-16-status-colours-button-alert-design.md`. The mockups that bind the look are in `docs/superpowers/specs/2026-10-16-status-colours-mockups/`.

## Global Constraints

These apply to every task.

**Colour meanings:**

- **Amber means "this needs you".**
- **Red means "something's gone wrong, or this can't be undone".**
- **Green only confirms that something happened.** It never judges a number as good.
- **Neutral is everything else.**
- **The accent colour** means due now, selected or current state, or the main action. It is not a status colour beyond "due now".
- **Colour is never the only signal.** Every amber, red or green element also carries a word or an icon.
- **No status colour is written by hand** outside `src/lib/utils/status-tone.ts` and the primitives. `tests/unit/status-colour-owner.test.ts` enforces this.

**The dose-control fence:** dose controls keep their markup, size, focus behaviour, write lock and submit path; only their colours change. The fenced controls are:

- `src/lib/components/dose-writes/**`
- `DoseActionForm` and its call sites
- DoneList's Edit
- the QuickLogBar chips and steppers
- the MedicationCard Log button
- the TimelineEntry ✎ and ×
- Toast's Undo and Dismiss
- DoseEditForm's Save
- the medications ↑/↓ reorder buttons

The user's anti-goal is "if dose buttons change size or stop working". A size assertion in a fenced control's test must never change.

**Button sizes are fixed heights:** `md` is `h-11` (44px) and `sm` is `h-9` (36px). Never derive a height from padding.

**Tokens and theming:**

- Tokens only; no raw palette colours.
- Accent roles: `accent` is the fill, `accent-ink` is text, border and ring, and `accent-fg` sits on the fill.
- Interactive borders use `border-strong`, never `glass-border`.
- Amber text is `text-warning` (there is no warning ink).
- Every text-bearing tone × element the owner can produce is measured over each backdrop it is drawn on, in **both** themes, by `tests/unit/theme-tokens.test.ts`, which reads `TONE_CLASSES` (Task 1). A new place an element is drawn adds a backdrop there.

**Banners and live regions:** an error `Alert` (tone `wrong`, `role="alert"`) never sits inside a persistent `role="status"` wrapper; it announces itself, and nested in a polite region it can be read twice. Only `happened` and `needs-you` content goes inside the wrapper. Task 3 writes this into `Alert.svelte`'s comment, and Tasks 7, 8 and 10 test it at their call sites.

**Svelte 5.57 markup traps:**

- SSR brackets a rendered snippet in hydration comments (`<a …><!---->Clear filters<!----></a>`). A raw-HTML regex on a `Button`'s text reads `withoutComments(html)`, the one helper Task 2 adds to `tests/unit/helpers/axe-ssr.ts`. No test this plan writes or edits defines its own.
- A literal space at an `{#if}` edge is dropped. A glyph before text inside an `{#if}` writes the space as `{" "}`.

**Accessible names stay identical** wherever an e2e selector or a test uses them, for example "Sign in", "Create account", "Add Medication", "Update Medication", `/archive/i`, "Save Changes", "Fixed time", "As needed (PRN)", "Mon", "Wed" and "Fri".

**Copy:**

- Pending labels use the Unicode ellipsis (`…`).
- Insights never carry prescriptive medical wording (CLAUDE.md).
- The guard words are exactly `DELETE` and `REPLACE`, case-sensitive and trimmed.

**Server:**

- Every form action under `src/routes/(app)/` still opens with `if (!locals.user) error(401, "Unauthorized")`.
- `/api/v1` wipes are unchanged: password reauth only.
- The browser guard checks the typed word for every account, plus the password where the account has one.

**Tests and process:**

- **Install PGlite in this worktree before Task 1:** `npm install --no-save @electric-sql/pglite`, run **outside the Bash sandbox** (inside it npm fails with a misleading EPERM). Every task's gates run the whole suite, which includes `tests/unit/pg/*`, and without PGlite those files fail to import and `npm run check` reports 3 errors. Task 7, whose own new tests live in `tests/unit/pg/`, re-checks it as its first step.
- `render` from `svelte/server` is lazy: read `.body`.
- jsdom mounts need `flushSync()`.
- Prove every new test by mutation: break the line it guards, watch it fail, then restore.
- Commits use conventional-commit messages with **no Claude/AI attribution of any kind**.
- Gates at the end of every task:
  - `npx vitest run` passes;
  - `npm run check`: 0 errors, at most 27 warnings;
  - `npm run lint`: 0 errors, and warnings **never above 115**. The count may fall as button-styled links move to `Button` (its `href` is exempt from `svelte/no-navigation-without-resolve` inside the primitive). Task 13 records the final figures;
  - `npm run format:check` is clean.

## Review Focus

These are the input classes the spec implies but no single happy-path test exercises. Each has a pinned test in the task named.

1. **Light theme.** Every tone's chip, marker, alert box and headline must pass contrast in light as well as dark. The page doesn't just look different; amber text on an amber tint in light mode is where contrast fails first. _Task 1_: the derived tone describe in `theme-tokens.test.ts` runs under both `SCHEMES`.
2. **An account with no password (OAuth only)** using each of the four guarded deletions. The typed word alone must work; today `confirmReauth` always fails for these accounts. The reverse also holds: a password account that posts the word but no password is refused, and a direct POST without the word is refused for both kinds. _Task 7_: `destructive-actions.test.ts`.
3. **Compact density.** A migrated `Button`, `IconButton` or `Toggle` keeps 44px or 36px under `data-density="compact"`. Today `py-2.5` buttons shrink to 32px. _Task 2_: a compiled-CSS test.
4. **Keyboard-only use of the deletion dialog.**
   - Tab reaches the word and password inputs and the danger button.
   - A not-ready danger button keeps focus (`aria-disabled`, not `disabled`) and doesn't submit.
   - Escape and Cancel close it without deleting anything.
   - Focus returns to the button that opened it.

   _Task 7_: `destructive-confirm.svelte.test.ts`.

5. **A screen-reader user whose medication save fails** while the drug-interaction notice is on screen. Exactly one `role="alert"` is in the form, focus lands on the error and not on the interaction notice (which is no longer `role="alert"`), and the submit button is re-enabled. _Task 10_.

---

## File Structure

**New files:**

- `src/lib/utils/status-tone.ts`: the owner. Defines `Tone`, `StatusKey`, `STATUS_TONE`, `toneOf`, `ToneElement`, `TONE_CLASSES`, `toneClass` and `refillStatus`. It is pure and has no runtime imports.
- `src/lib/components/ui/Button.svelte` (its `<script module>` exports `FOCUS_RING` and `DISABLED_LOOK`), `IconButton.svelte`, `Toggle.svelte`, `Alert.svelte`, `DestructiveConfirm.svelte`: the primitives.
- `src/lib/components/ui/destructive-dialog.svelte.ts`: `createDestructiveDialog`, the dialog's open, pending and error state.
- `src/lib/utils/destructive-confirm.ts`: `DestructiveWord`, `formatCount` and the four summary builders. No imports.
- `src/lib/server/auth/destructive-guard.ts`: `checkDestructiveGuard` and `accountHasPassword`, the server half of the deletion guard.
- `src/lib/components/walkthrough/parts/stage-controls.ts`: `stageButton` and `stageToggle`, the primitives' resting classes for the landing stage.
- Test helpers: `tests/unit/helpers/compiled-rule.ts` (`compiledCss`, `compiledRule`, moved out of `timeline-entry-ssr.test.ts`), `tests/unit/helpers/alert-dom.ts` (`alertTitled`, `expectClasses`), `tests/unit/helpers/ButtonGallery.svelte`, `tests/unit/helpers/AlertGallery.svelte`. `tests/unit/helpers/axe-ssr.ts` gains `withoutComments` (Task 2) and `expectAxeClean` (Task 8).

**Modified, beyond the pages:** `src/lib/utils/dashboard-copy.ts` gains `REORDER_SOON` (Task 5); `src/lib/types.ts`'s `Insight` gains `signal` and `lead` (Task 6).

**New tests:** `status-tone`, `status-colour-owner`, `button-ssr`, `button-mount.svelte`, `alert-ssr`, `status-breakdown-bar-ssr`, `refills-card-ssr`, `medication-card-stock-ssr`, `medication-inventory-history-ssr`, `insights-card-ssr`, `analytics-page-ssr`, `destructive-summary`, `destructive-guard`, `destructive-confirm.svelte`, `destructive-dialog`, `destructive-actions`, `pg/destructive-counts`, `destructive-pages-ssr`, `destructive-pages-mount.svelte`, `settings-pages-ssr`, `settings-pages-mount.svelte`, `auth-pages-ssr`, `empty-state-onboarding-ssr`, `onboarding-welcome.svelte`, `medication-form-controls-ssr`, `app-chrome-icon-buttons-ssr` and `medication-filter-select`, all under `tests/unit/`.

**Modified:** the files named in each task. Every task names them with line anchors read at `925be44`.

## Task order and dependencies

Run the tasks in numeric order; that order satisfies every dependency.

| Task                                        | Depends on                                         |
| ------------------------------------------- | -------------------------------------------------- |
| 1 Status-tone owner, contrast, owner scan   | —                                                  |
| 2 `Button`, `IconButton`, `Toggle`          | 1                                                  |
| 3 `Alert`                                   | 1                                                  |
| 4 Dose statuses                             | 1                                                  |
| 5 Refills and stock                         | 1                                                  |
| 6 Analytics                                 | 1, 2, 5 (`REORDER_SOON`)                           |
| 7 Guarded deletions; Privacy, Data, Import  | 1, 2, 3                                            |
| 8 Settings pages                            | 1, 2, 3                                            |
| 9 Auth and public pages                     | 1, 2, 3, 8 (test helpers)                          |
| 10 Medications and forms                    | 1, 2, 3, 5                                         |
| 11 Log controls and app chrome              | 2, 9 (`log-pagination-ssr` edits)                  |
| 12 Walkthrough follow-through               | 2, 4, 5, 6, 7, 8, 10, 11 (it copies their recipes) |
| 13 Retire `--color-info`, docs, final gates | all                                                |

## The pending list, and who empties it

Task 1 pastes these 35 files into `PENDING_MIGRATION`. Each task deletes its files' lines in the commit that removes their last status class (the scan is two-way, so a stale line fails). Task 13 stops if any line is left.

| Pending file                                                          | Removed by                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/lib/components/dashboard/StatusMarker.svelte`                    | Task 4                                                                                           |
| `src/lib/components/dashboard/DueCard.svelte`                         | Task 4                                                                                           |
| `src/lib/components/TimelineEntry.svelte`                             | Task 4                                                                                           |
| `src/lib/components/dashboard/DoseActionForm.svelte`                  | Task 4                                                                                           |
| `src/lib/components/StatusBreakdownBar.svelte`                        | Task 4                                                                                           |
| `src/lib/components/SideEffectPicker.svelte`                          | Task 4 (severity; Task 10's chips add no status class back)                                      |
| `src/lib/components/RefillsCard.svelte`                               | Task 5                                                                                           |
| `src/lib/components/MedicationCard.svelte`                            | Task 5                                                                                           |
| `src/lib/components/AdherenceChart.svelte`                            | Task 6                                                                                           |
| `src/lib/components/InsightsCard.svelte`                              | Task 6                                                                                           |
| `src/routes/(app)/analytics/+page.svelte`                             | Task 6                                                                                           |
| `src/routes/(app)/settings/privacy/+page.svelte`                      | Task 7                                                                                           |
| `src/routes/(app)/settings/data/+page.svelte`                         | Task 7                                                                                           |
| `src/routes/(app)/settings/data/import/+page.svelte`                  | Task 7                                                                                           |
| `src/routes/(app)/settings/+page.svelte`                              | Task 8                                                                                           |
| `src/routes/(app)/settings/security/+page.svelte`                     | Task 8 (including the `totp-error` banner the mask leaves unmasked)                              |
| `src/routes/(app)/settings/notifications/+page.svelte`                | Task 8                                                                                           |
| `src/routes/(app)/settings/appearance/+page.svelte`                   | Task 8                                                                                           |
| `src/routes/auth/login/+page.svelte`                                  | Task 9                                                                                           |
| `src/routes/auth/register/+page.svelte`                               | Task 9                                                                                           |
| `src/routes/auth/2fa/+page.svelte`                                    | Task 9                                                                                           |
| `src/routes/auth/reset-password/+page.svelte`                         | Task 9                                                                                           |
| `src/routes/auth/reset-password/confirm/+page.svelte`                 | Task 9                                                                                           |
| `src/routes/auth/verify/+page.svelte`                                 | Task 9                                                                                           |
| `src/routes/+page.svelte`                                             | Task 9 (header buttons and the two feature tiles at `:121`, `:132`)                              |
| `src/routes/(app)/medications/[id]/+page.svelte`                      | Task 10 (Task 5 neutralises its ±N first)                                                        |
| `src/lib/components/MedicationForm.svelte`                            | Task 10                                                                                          |
| `src/lib/components/medication-form/InteractionWarningPanel.svelte`   | Task 10                                                                                          |
| `src/lib/components/medication-form/MedicationScheduleSection.svelte` | Task 10                                                                                          |
| `src/lib/components/medication-form/MedicationStylePicker.svelte`     | Task 10                                                                                          |
| `src/lib/components/DoseEditForm.svelte`                              | Task 10 (the form-level banner at `:239`)                                                        |
| `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`  | Task 12                                                                                          |
| `src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`         | Task 12 (including the inline `var(--color-success)` and `var(--color-warning)` at `:44`, `:52`) |
| `src/lib/components/walkthrough/scenes/MedicationsScene.svelte`       | Task 12 (the last `text-info` reader)                                                            |
| `src/lib/components/walkthrough/scenes/SecurityScene.svelte`          | Task 12                                                                                          |

Tasks 1 to 13 together remove all 35: Task 4 six, Task 5 two, Task 6 three, Task 7 three, Task 8 four, Task 9 seven, Task 10 six and Task 12 four. Tasks 2, 3, 11 and 13 remove none, and no task removes a file that is not listed. `DoneList.svelte`, both `+error.svelte` pages, `EmptyState.svelte`, `OnboardingWelcome.svelte` and every Task 11 file write no status class at `925be44`, so they were never listed.

---

## Tasks

`Tn` in the steps is short for Task n. Line anchors are HEAD's (`925be44`); an earlier task can shift them, so find each anchor by its content.

### Task 1: Status-tone owner module, contrast table, owner scan test

The owner every later task reads, the contrast measurement that decides its opacities, and the scan that makes the owner the only place a status colour can be written. Nothing user-visible changes in this task.

**Files:**

- Create: `src/lib/utils/status-tone.ts`
- Create: `tests/unit/status-tone.test.ts`
- Create: `tests/unit/status-colour-owner.test.ts`
- Modify: `tests/unit/theme-tokens.test.ts` (one import beside `:15-16`; two helpers beside `alphaOf` at `:68-75`; one new `describe.each` after the hand-written CHIPS describe that ends at `:401`)

**Interfaces:**

- Consumes: `RefillSeverity` (type only) from `src/lib/types.ts:63`; `compositeOver` / `contrastRatio` from `src/lib/utils/contrast.ts`; `theme-tokens.test.ts`'s own `alphaOf` (`:68`) and `SCHEMES` (`:120`).
- Produces: `Tone`, `StatusKey`, `STATUS_TONE`, `toneOf`, `ToneElement`, `TONE_CLASSES`, `toneClass`, `refillStatus` (Tasks 2–12 consume them); the scan test's `EXEMPT` and `PENDING_MIGRATION` lists, which every later task edits in the commit that empties a file (the header's pending table says which).
- Decided here:
  - The happened **chip** is `bg-success/10`, not `/15`: at `/15` it is 4.33:1 on a hovered card in dark (Step 5 measures it).
  - `ToneElement` has six members. The sixth, `"border"`, is a card's status edge, colour only: DueCard's overdue edge (`DueCard.svelte:45`) and its stage copy (`StageDueCard.svelte:44`) draw `border-warning/50`, which no other element spells. `due-card-ssr.test.ts:250-252` asserts that class and passes unchanged.
  - `Button.svelte` is **not** in `EXEMPT` yet. The two-way check would fail on a file that does not exist; Task 2 adds the entry in the commit that creates it.
  - The field-error mask covers the three spellings the code uses (a quoted id, a template-literal id, and either one on its own line after `<p`) and skips any tag with a `bg-` fill, which is a banner (`settings/security`'s `totp-error`), not a field line.
  - The scan also catches an inline `var(--color-<status>)`, the spelling `AnalyticsScene.svelte:44,52` uses to escape a class regex.

- [ ] **Step 1: Write the failing owner test**

`tests/unit/status-tone.test.ts`:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  STATUS_TONE,
  TONE_CLASSES,
  toneOf,
  toneClass,
  refillStatus,
  type StatusKey,
  type Tone,
  type ToneElement,
} from "$lib/utils/status-tone";

const SOURCE = readFileSync(
  fileURLToPath(new URL("../../src/lib/utils/status-tone.ts", import.meta.url)),
  "utf8",
);

describe("STATUS_TONE is the spec's status table", () => {
  it("gives every status the tone the spec gives it", () => {
    expect(STATUS_TONE).toEqual({
      "dose-overdue": "needs-you",
      "dose-taken": "happened",
      "dose-skipped": "neutral",
      "dose-missed": "wrong",
      "refill-critical": "needs-you",
      "refill-warning": "needs-you",
      "refill-watch": "neutral",
      "refill-ok": "neutral",
      "stock-low": "needs-you",
      "side-effect-mild": "neutral",
      "side-effect-moderate": "neutral",
      "side-effect-severe": "wrong",
      "insight-needs-you": "needs-you",
      "insight-info": "neutral",
      "needs-you": "needs-you",
      "action-failed": "wrong",
      "action-done": "happened",
      state: "neutral",
    });
  });

  it("toneOf reads the table", () => {
    for (const [status, tone] of Object.entries(STATUS_TONE)) {
      expect(toneOf(status as StatusKey)).toBe(tone);
    }
  });
});

describe("refillStatus", () => {
  it("names each tier's status, so both urgent tiers are amber and watch is neutral", () => {
    const tiers = ["critical", "warning", "watch", "ok"] as const;
    expect(tiers.map(refillStatus)).toEqual([
      "refill-critical",
      "refill-warning",
      "refill-watch",
      "refill-ok",
    ]);
    expect(tiers.map((t) => toneOf(refillStatus(t)))).toEqual([
      "needs-you",
      "needs-you",
      "neutral",
      "neutral",
    ]);
  });
});

describe("TONE_CLASSES", () => {
  it("spells every tone for every element", () => {
    expect(TONE_CLASSES).toEqual({
      "needs-you": {
        text: "text-warning",
        chip: "border border-warning/35 bg-warning/15 text-warning",
        marker: "bg-warning/20 text-warning",
        bar: "bg-warning",
        alert: "border border-warning/35 bg-warning/10",
        border: "border-warning/50",
      },
      wrong: {
        text: "text-danger-ink",
        chip: "border border-danger-ink/35 bg-danger/15 text-danger-ink",
        marker: "bg-danger/20 text-danger-ink",
        bar: "bg-danger",
        alert: "border border-danger-ink/35 bg-danger/10",
        border: "border-danger-ink/50",
      },
      happened: {
        text: "text-success",
        // /10, not the /15 the other tinted chips use: see theme-tokens.test.ts.
        chip: "border border-success/30 bg-success/10 text-success",
        marker: "bg-success/20 text-success",
        bar: "bg-success",
        alert: "border border-success/30 bg-success/10",
        border: "border-success/50",
      },
      neutral: {
        text: "text-text-secondary",
        chip: "border border-border-strong text-text-secondary",
        marker: "border border-border-strong text-text-secondary",
        bar: "bg-border-strong",
        alert: "border border-glass-border bg-surface-raised",
        border: "border-border-strong",
      },
    });
  });

  it("toneClass reads the table", () => {
    for (const tone of Object.keys(TONE_CLASSES) as Tone[]) {
      for (const element of Object.keys(TONE_CLASSES[tone]) as ToneElement[]) {
        expect(toneClass(tone, element)).toBe(TONE_CLASSES[tone][element]);
      }
    }
  });

  // Tailwind v4 generates a utility only if its whole name appears in source
  // text. A class assembled at runtime renders as nothing, silently.
  it("writes every class string as one literal, so Tailwind's source scan sees it", () => {
    for (const byElement of Object.values(TONE_CLASSES)) {
      for (const classes of Object.values(byElement)) {
        expect(SOURCE).toContain(JSON.stringify(classes));
      }
    }
  });
});

describe("status-tone.ts is safe to import from anywhere", () => {
  // Client-reachable, and the landing-page walkthrough reads it.
  // `import { type X }` is flagged too: under verbatimModuleSyntax it leaves a
  // bare side-effect import behind.
  it("has no runtime import", () => {
    const imports = SOURCE.match(/^import\b.*$/gm) ?? [];
    expect(imports.filter((line) => !/^import type\b/.test(line))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/unit/status-tone.test.ts`
Expected: FAIL, `Failed to resolve import "$lib/utils/status-tone" from "tests/unit/status-tone.test.ts"`.

- [ ] **Step 3: Write the owner module**

Create `src/lib/utils/status-tone.ts`. The bodies are table lookups; the values are pinned by Step 1. The file comment is exact copy:

<!-- prettier-ignore -->
```ts
/**
 * The single owner of status colour.
 *
 * Amber ("needs-you") means something you should act on. Red ("wrong") means
 * something went wrong, or this cannot be undone. Green ("happened") only
 * confirms that something happened; it never judges a number as good.
 * Everything else (counts, percentages, trends, current states, reversible
 * "turn it off" actions) is neutral. The accent keeps "due now" and
 * "selected" and is not a status colour, so it is not here.
 *
 * STATUS_TONE encodes the table in
 * docs/superpowers/specs/2026-10-16-status-colours-button-alert-design.md
 * ("Every status, and its tone"). TONE_CLASSES turns a tone into token classes
 * for each kind of element. A component asks `toneClass(toneOf(status), el)`
 * and never writes `text-warning` itself; tests/unit/status-colour-owner.test.ts
 * fails the suite if it does.
 *
 * Every class is one whole string literal: Tailwind v4 finds utilities by
 * scanning source text, so a class assembled at runtime is never generated.
 *
 * No runtime imports. Components and the landing-page walkthrough both read
 * this module, so it must pull nothing into either bundle.
 *
 * The opacities are decided by tests/unit/theme-tokens.test.ts, which reads
 * this table and measures every tone over each backdrop its element is drawn
 * on, in both schemes. That is why the happened chip is /10 where the other
 * tinted chips are /15: at /15 it measures 4.33:1 on a hovered card in dark.
 */
import type { RefillSeverity } from "$lib/types";

export type Tone = "needs-you" | "wrong" | "happened" | "neutral";

export type StatusKey =
  | "dose-overdue" | "dose-taken" | "dose-skipped" | "dose-missed"
  | "refill-critical" | "refill-warning" | "refill-watch" | "refill-ok" | "stock-low"
  | "side-effect-mild" | "side-effect-moderate" | "side-effect-severe"
  | "insight-needs-you" | "insight-info"
  | "needs-you" | "action-failed" | "action-done" | "state";

export const STATUS_TONE: Record<StatusKey, Tone>; // the 18 entries pinned in Step 1

export function toneOf(status: StatusKey): Tone; // STATUS_TONE[status]

/**
 * text   a status word.
 * chip   a tinted pill holding a word and a glyph.
 * marker the 20px status circle (StatusMarker).
 * bar    a breakdown-bar segment.
 * alert  the Alert box only; its headline takes `text` (neutral's headline is
 *        text-text-primary).
 * border a card's status edge, colour only; the card carries the `border`
 *        width itself (DueCard's overdue edge).
 */
export type ToneElement = "text" | "chip" | "marker" | "bar" | "alert" | "border";

export const TONE_CLASSES: Record<Tone, Record<ToneElement, string>>; // the 24 strings pinned in Step 1

export function toneClass(tone: Tone, element: ToneElement): string; // TONE_CLASSES[tone][element]

/**
 * The tier's status. The thresholds stay with `classifyRefillSeverity`
 * (`src/lib/server/inventory.ts`); this only names the tier.
 * Implemented as a `Record<RefillSeverity, StatusKey>` lookup, so a new tier
 * is a compile error here rather than an uncoloured row.
 */
export function refillStatus(severity: RefillSeverity): StatusKey;
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/unit/status-tone.test.ts`
Expected: PASS, 7 tests.

Mutation proof (break, watch the named test fail, restore):

- `"dose-skipped": "needs-you"` → "gives every status the tone the spec gives it".
- `toneOf` returns `"neutral"` → "toneOf reads the table".
- `REFILL_STATUS.watch = "refill-warning"` → "names each tier's status…".
- `bar: ["bg", "warning"].join("-")` for needs-you → "writes every class string as one literal…" (the equality test still passes, which is why this one exists).
- `import { type RefillSeverity } from "$lib/types";` → "has no runtime import".

- [ ] **Step 5: Measure every tone the owner can produce, in both themes**

In `tests/unit/theme-tokens.test.ts`:

1. Beside the imports at `:15-16`: `import { TONE_CLASSES, type Tone } from "$lib/utils/status-tone";`
2. Beside `alphaOf` (`:68-75`), two parsers:

<!-- prettier-ignore -->
```ts
/** `bg-warning/15` -> the token and alpha a class string fills with; no `bg-` class -> null (transparent). */
function fillOf(classes: string): { token: string; alpha: number } | null {
  const m = classes.match(/(?:^|\s)bg-([a-z-]+?)(?:\/(\d+))?(?=\s|$)/);
  return m ? { token: `--color-${m[1]}`, alpha: m[2] ? Number(m[2]) / 100 : 1 } : null;
}

/** The one `text-*` colour in a class string, as its token. Throws on none or several. */
function inkOf(classes: string): string {
  const found = [...classes.matchAll(/(?:^|\s)text-([a-z-]+)(?=\s|$)/g)];
  if (found.length !== 1) {
    throw new Error(`Expected one text colour in "${classes}", found ${found.length}`);
  }
  return `--color-${found[0][1]}`;
}
```

3. After the CHIPS describe (ends `:401`), a new describe. Leave the hand-written CHIPS rows alone: they pin today's markup until T4/T5 migrate it, and T13 prunes them.

<!-- prettier-ignore -->
```ts
/**
 * Every status tone the owner can produce, over every backdrop its element is
 * really drawn on. The pairs are READ from TONE_CLASSES, not restated, so an
 * opacity tuned in status-tone.ts is re-measured here, and a tone or element
 * added there is measured without anyone remembering to add a row. That is
 * how the happened chip came to be /10: at /15 it is 4.33:1 on a hovered card
 * in dark.
 *
 * `bar` and `border` have no rows. Neither carries text, and the word or glyph
 * beside them carries the status. WCAG 1.4.11 asks 3:1 of a graphic only when
 * it is the sole carrier. The neutral bar's border-strong already clears 3:1
 * on every surface in the control-boundary describe below.
 *
 * Text on opaque surfaces and on a resting card is already in the text-token
 * table above (surfaces() includes surface-raised and glass-on-surface), so
 * `text` adds only the hovered card, which surfaces() does not composite.
 */
describe.each(SCHEMES)(
  "$name — every status tone is legible over the backdrops its element is drawn on",
  ({ T }) => {
    const glass = alphaOf(T["--color-glass"]);
    const glassHover = alphaOf(T["--color-glass-hover"]);
    const card = compositeOver(glass.alpha, T["--color-surface"], glass.overlay);
    const cardHover = compositeOver(glassHover.alpha, T["--color-surface"], glassHover.overlay);
    const modalGlass = compositeOver(glass.alpha, T["--color-surface-raised"], glass.overlay);

    // [backdrop, hex, the component that really draws this element there].
    const BACKDROPS: Record<"chip" | "marker" | "alert" | "text", [string, string, string][]> = {
      chip: [
        ["card", card, "MedicationCard refill chip; Log row status and side-effect chips"],
        ["cardHover", cardHover, "the same rows hovered (both carry hover:bg-glass-hover)"],
        ["modalGlass", modalGlass, "SideEffectPicker severity chip in the DoseEditForm modal"],
      ],
      marker: [["card", card, "StatusMarker in a DueCard <li> and in the Done card"]],
      alert: [
        ["card", card, "a banner inside a GlassCard or the auth card"],
        ["surface", T["--color-surface"], "a banner on the page itself (notifications' saved line)"],
        ["surface-raised", T["--color-surface-raised"], "DoseEditForm's and DestructiveConfirm's error, in the Modal panel"],
      ],
      text: [["cardHover", cardHover, "a status word on a hovered Log row or medication card"]],
    };

    for (const tone of Object.keys(TONE_CLASSES) as Tone[]) {
      const c = TONE_CLASSES[tone];
      const headline = tone === "neutral" ? "--color-text-primary" : inkOf(c.text);
      const CASES: [element: keyof typeof BACKDROPS, classes: string, fgs: string[], threshold: number][] = [
        ["chip", c.chip, [inkOf(c.chip)], 4.5],
        // 3:1: the marker's foreground is a glyph in a status circle (WCAG 1.4.11).
        ["marker", c.marker, [inkOf(c.marker)], 3],
        // The headline, the icon (the tone's text), the body (text-secondary),
        // and plain text in a row boxed the same way.
        ["alert", c.alert, [...new Set([headline, inkOf(c.text), "--color-text-secondary", "--color-text-primary"])], 4.5],
        ["text", "", [inkOf(c.text)], 4.5],
      ];
      for (const [element, classes, fgs, threshold] of CASES) {
        for (const [name, base, site] of BACKDROPS[element]) {
          for (const fg of fgs) {
            it(`${tone} ${element}: ${fg} over ${name} — ${site}`, () => {
              expect(T[fg], `${fg} is not defined`).toBeDefined();
              const fill = fillOf(classes);
              const bg = !fill
                ? base
                : fill.alpha === 1
                  ? T[fill.token]
                  : compositeOver(fill.alpha, base, T[fill.token]);
              const ratio = contrastRatio(T[fg], bg);
              expect(
                ratio,
                `${T[fg]} on ${bg} (${classes || "no fill"} over ${base}) is ${ratio.toFixed(2)}:1`,
              ).toBeGreaterThanOrEqual(threshold);
            });
          }
        }
      }
    }
  },
);
```

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS. 106 new tests (53 per scheme: 12 chip, 4 marker, 33 alert, 4 text); every pre-existing test unchanged. Lowest measured margins: dark happened chip over `cardHover` 4.71; light wrong alert headline over `surface` 4.97; light wrong marker 4.57 against 3.

Mutation proof: set the happened chip to `bg-success/15` in `status-tone.ts`. Then "dark — every status tone… › happened chip: --color-success over cardHover…" fails with `#10b981 on … is 4.33:1`, and Step 1's "spells every tone for every element" fails too. Restore.

- [ ] **Step 6: Commit**

<!-- prettier-ignore -->
```bash
npx prettier --write src/lib/utils/status-tone.ts tests/unit/status-tone.test.ts tests/unit/theme-tokens.test.ts
git add src/lib/utils/status-tone.ts tests/unit/status-tone.test.ts tests/unit/theme-tokens.test.ts
git commit -m "feat(status): one owner for status colour, measured in both themes"
```

- [ ] **Step 7: Write the owner scan with an EMPTY pending list, and watch it fail**

`tests/unit/status-colour-owner.test.ts`, with `PENDING_MIGRATION` written as `[]` for this step:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Status colour has one owner, `src/lib/utils/status-tone.ts`, and this scan
 * keeps it that way. Before the owner, every component chose its own amber,
 * which is how amber came to mean about twenty things and a 35% adherence
 * printed green. It is a scan rather than prose for the reason
 * server-log.test.ts gives: a rule that is only written down re-accumulates.
 *
 * A status class is `warning`, `success`, `danger`, `danger-ink`, `danger-fg`
 * or `info` behind any colour utility, with any variant prefix and any
 * opacity, or the same token read inline as `var(--color-…)`, which is how a
 * style attribute escapes a class regex. Both lists below are two-way: a file
 * that stops matching must leave its list, so a stale entry fails as loudly as
 * a new offender.
 */
const STATUS_CLASS =
  /\b(?:(?:text|bg|border|ring|fill|stroke|from|to|outline|divide|decoration)-(?:warning|success|danger-ink|danger-fg|danger|info)(?:\/\d+)?\b|var\(--color-(?:warning|success|danger-ink|danger-fg|danger|info)\))/g;

/**
 * A field-error line, `<p id="{name}-error" …>`, which the spec keeps as it is
 * (Non-goals). Three spellings exist: a quoted id, a template-literal id
 * (`id={`${id}-error`}`), and either one on a line of its own after `<p`.
 * A tag that carries a `bg-` fill is a banner that happens to have an -error
 * id (`settings/security`'s `totp-error`), not a field line, so it is NOT
 * masked and still has to be migrated.
 */
const FIELD_ERROR_OPEN = /<p\s[^>]*?\bid=(?:"[^"]*-error"|\{`[^`]*-error`\})[^>]*>/g;

function maskFieldErrors(source: string): string {
  return source.replace(FIELD_ERROR_OPEN, (tag) => (/\bbg-/.test(tag) ? tag : ""));
}

/** Permanent. Each entry says which part of the spec keeps it. */
const EXEMPT: { file: string; why: string }[] = [
  {
    file: "src/lib/utils/status-tone.ts",
    why: "The owner: every status class is spelled here and nowhere else.",
  },
  {
    file: "src/lib/components/ui/Toast.svelte",
    why: "Spec Non-goals: Toast is unchanged. Its colours already obey the rules and its markup is pinned.",
  },
  {
    file: "src/lib/components/ui/Input.svelte",
    why: "The field's error border and the required asterisk. Spec Non-goals keep form inputs and field errors as they are.",
  },
  {
    file: "src/lib/components/walkthrough/parts/FieldBox.svelte",
    why: "Draws Input's required asterisk on the landing stage, so it follows Input's exemption.",
  },
  {
    file: "src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte",
    why: "Draws Toast's Undo offer with Toast.svelte's own classes, so it follows Toast's exemption.",
  },
];

/**
 * Temporary. Every file that wrote a status class when the owner landed.
 * A task that removes a file's last status class deletes its line here in the
 * same commit (the stale check below fails otherwise). Task 13 deletes the list.
 */
const PENDING_MIGRATION: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry)) out.push(full.split(/[\\/]/).join("/"));
  }
  return out;
}

/** file -> the status classes it writes, field-error lines masked. */
const MATCHING = new Map(
  walk("src")
    .map((file) => [file, maskFieldErrors(readFileSync(file, "utf8")).match(STATUS_CLASS) ?? []] as const)
    .filter(([, found]) => found.length > 0),
);
const EXEMPT_FILES = new Set(EXEMPT.map((e) => e.file));
const PENDING = new Set(PENDING_MIGRATION);

describe("the field-error mask", () => {
  it("hides a field-error line in each of its spellings", () => {
    for (const tag of [
      '<p id="email-error" class="text-danger-ink mt-1 text-sm" role="alert">',
      '<p\n        id="schedules-error"\n        class="text-danger-ink mt-1 text-sm"\n        role="alert"\n      >',
      '<p id={`${id}-error`} class="text-danger-ink mt-1 text-sm" role="alert">',
    ]) {
      expect(maskFieldErrors(tag).match(STATUS_CLASS)).toBeNull();
    }
  });

  it("leaves a banner that happens to carry an -error id", () => {
    const banner =
      '<p\n  id="totp-error"\n  class="bg-danger/10 text-danger-ink mb-4 rounded-lg px-4 py-2 text-sm"\n  role="alert"\n>';
    expect(maskFieldErrors(banner).match(STATUS_CLASS)).toEqual(["bg-danger/10", "text-danger-ink"]);
  });

  it("does not hide an inline status colour, which a class regex alone would miss", () => {
    expect('color: "var(--color-success)", ring: "var(--color-danger-ink)"'.match(STATUS_CLASS)).toEqual([
      "var(--color-success)",
      "var(--color-danger-ink)",
    ]);
  });
});

describe("status colour is written only by its owner", () => {
  it("every file that writes a status class is exempt or pending migration", () => {
    const offenders = [...MATCHING]
      .filter(([file]) => !EXEMPT_FILES.has(file) && !PENDING.has(file))
      .map(([file, found]) => `${file}: ${[...new Set(found)].join(" ")}`);
    expect(offenders).toEqual([]);
  });

  it("every exemption still writes one, so the list cannot rot", () => {
    expect(EXEMPT.map((e) => e.file).filter((file) => !MATCHING.has(file))).toEqual([]);
  });

  it("every pending file still writes one: a task that finishes a file deletes its line", () => {
    expect(PENDING_MIGRATION.filter((file) => !MATCHING.has(file))).toEqual([]);
  });

  it("no file is both exempt and pending", () => {
    expect(PENDING_MIGRATION.filter((file) => EXEMPT_FILES.has(file))).toEqual([]);
  });

  it("each exemption says why", () => {
    expect(EXEMPT.filter((e) => e.why.trim() === "")).toEqual([]);
  });

  it("the pending list is sorted and unique, so tasks deleting lines in parallel merge cleanly", () => {
    expect(PENDING_MIGRATION).toEqual([...new Set(PENDING_MIGRATION)].sort());
  });
});
```

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`
Expected: FAIL in "every file that writes a status class is exempt or pending migration", with exactly the 35 offenders in Step 8, each followed by its classes (`AnalyticsScene.svelte`'s include `var(--color-success) var(--color-warning)`). The other eight tests pass. This failure is how the list is computed. If the offender set differs from Step 8 (another branch landed first), paste what the run prints, not this list.

- [ ] **Step 8: Paste the pending list and watch it pass**

Replace `[]` with:

<!-- prettier-ignore -->
```ts
const PENDING_MIGRATION: string[] = [
  "src/lib/components/AdherenceChart.svelte",
  "src/lib/components/DoseEditForm.svelte",
  "src/lib/components/InsightsCard.svelte",
  "src/lib/components/MedicationCard.svelte",
  "src/lib/components/MedicationForm.svelte",
  "src/lib/components/RefillsCard.svelte",
  "src/lib/components/SideEffectPicker.svelte",
  "src/lib/components/StatusBreakdownBar.svelte",
  "src/lib/components/TimelineEntry.svelte",
  "src/lib/components/dashboard/DoseActionForm.svelte",
  "src/lib/components/dashboard/DueCard.svelte",
  "src/lib/components/dashboard/StatusMarker.svelte",
  "src/lib/components/medication-form/InteractionWarningPanel.svelte",
  "src/lib/components/medication-form/MedicationScheduleSection.svelte",
  "src/lib/components/medication-form/MedicationStylePicker.svelte",
  "src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte",
  "src/lib/components/walkthrough/scenes/AnalyticsScene.svelte",
  "src/lib/components/walkthrough/scenes/MedicationsScene.svelte",
  "src/lib/components/walkthrough/scenes/SecurityScene.svelte",
  "src/routes/(app)/analytics/+page.svelte",
  "src/routes/(app)/medications/[id]/+page.svelte",
  "src/routes/(app)/settings/+page.svelte",
  "src/routes/(app)/settings/appearance/+page.svelte",
  "src/routes/(app)/settings/data/+page.svelte",
  "src/routes/(app)/settings/data/import/+page.svelte",
  "src/routes/(app)/settings/notifications/+page.svelte",
  "src/routes/(app)/settings/privacy/+page.svelte",
  "src/routes/(app)/settings/security/+page.svelte",
  "src/routes/+page.svelte",
  "src/routes/auth/2fa/+page.svelte",
  "src/routes/auth/login/+page.svelte",
  "src/routes/auth/register/+page.svelte",
  "src/routes/auth/reset-password/+page.svelte",
  "src/routes/auth/reset-password/confirm/+page.svelte",
  "src/routes/auth/verify/+page.svelte",
];
```

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`
Expected: PASS, 9 tests. The header's "The pending list, and who empties it" names the task that deletes each line.

Mutation proof (each one: break it, watch the named test fail, restore):

- Add `class="text-warning"` to an element in `src/lib/components/ui/GlassCard.svelte` → "every file … is exempt or pending" names `src/lib/components/ui/GlassCard.svelte: text-warning`.
- Delete the `AdherenceChart.svelte` line → the same test names it.
- Add `"src/lib/components/ui/GlassCard.svelte"` to `PENDING_MIGRATION` (sorted) → "every pending file still writes one" names it.
- Add `{ file: "src/lib/components/ui/Modal.svelte", why: "x" }` to `EXEMPT` → "every exemption still writes one" names it.
- Delete the template-literal arm (`|\{`[^`]\*-error`\}`) from `FIELD_ERROR_OPEN` → "hides a field-error line in each of its spellings" fails, and the scan names `src/lib/components/medication-form/MedicationNotificationFields.svelte`.
- Replace `maskFieldErrors`'s body with `source.replace(FIELD_ERROR_OPEN, "")` (no `bg-` guard) → "leaves a banner that happens to carry an -error id" fails.
- Delete the `|var\(--color-…\)` arm from `STATUS_CLASS` → "does not hide an inline status colour…" fails.
- Swap two adjacent `PENDING_MIGRATION` lines → "the pending list is sorted and unique…" fails.

- [ ] **Step 9: Commit**

<!-- prettier-ignore -->
```bash
npx prettier --write tests/unit/status-colour-owner.test.ts
git add tests/unit/status-colour-owner.test.ts
git commit -m "test(status): fail on a status colour written outside its owner"
```

- [ ] **Step 10: Gates**

Run, in order:

1. `npx vitest run tests/unit/status-tone.test.ts tests/unit/status-colour-owner.test.ts tests/unit/theme-tokens.test.ts tests/unit/theme-css.test.ts`. Expected: PASS.
2. `npx vitest run`. Expected: 0 failed.
3. `npm run check`. Expected: 0 errors, warnings ≤ 27.
4. `npm run lint`. Expected: 0 errors, warnings ≤ 115.
5. `npm run format:check`. Expected: clean (each commit step ran `prettier --write` on its own files first).

### Task 2: `Button`, `IconButton` and `Toggle` primitives

Three new components in `src/lib/components/ui/`. `danger` hovers with `hover:brightness-110`, not `hover:opacity-90`: at 90% opacity its label measures 4.24:1 in a dark dialog, which is the variant's only site (step 2.6 measures both). The task changes no existing component. The only existing test file it edits is `timeline-entry-ssr.test.ts`, whose `compiledRule()` helper moves into a shared module; its assertions are unchanged.

Everything below was built and run in a throwaway copy of `925be44` (with a stub of T1's `status-tone.ts`). All 202 test files passed, `svelte-check` gave 0 errors and 27 warnings, `eslint .` gave 0 errors and 115 warnings, and `prettier --check .` was clean. Every mutation listed was run, and the named test failed.

**Files**

- Create: `src/lib/components/ui/Button.svelte`, `src/lib/components/ui/IconButton.svelte`, `src/lib/components/ui/Toggle.svelte`
- Create: `tests/unit/helpers/compiled-rule.ts`, `tests/unit/helpers/ButtonGallery.svelte`, `tests/unit/button-ssr.test.ts` (node), `tests/unit/button-mount.svelte.test.ts` (jsdom)
- Modify: `tests/unit/timeline-entry-ssr.test.ts` (the imports at `:15-18` and `:20` and the helper at `:131-159` move out), `tests/unit/helpers/axe-ssr.ts` (appends `withoutComments`), `tests/unit/theme-tokens.test.ts` (adds a Button hover describe), `tests/unit/status-colour-owner.test.ts` (adds Button.svelte to T1's `EXEMPT`)

**Interfaces**

- Consumes:
  - Task 1's scan test `tests/unit/status-colour-owner.test.ts`, whose `EXEMPT: { file: string; why: string }[]` is two-way. Task 1 could not list `Button.svelte`, because the file did not exist yet.
  - In `theme-tokens.test.ts`, the existing `SCHEMES`, `DARK`, `alphaOf`, `compositeOver` and `contrastRatio`.
- Produces:
  - `Button.svelte` (the full `Props` type is in 2.3): `variant?: "primary" | "secondary" | "ghost" | "danger"` (default `"secondary"`), `size?: "md" | "sm"` (`h-11` / `h-9`, default `"md"`), `href?` (renders `<a>`), `type?: "button" | "submit" | "reset"` (default `"button"`, ignored with `href`), `block?`, `pending?`, `pendingLabel?` (default `"Saving…"`), `disabled?` (real, button only), `ariaDisabled?` (keeps focus), `shape?: "rect" | "pill"` (default `"rect"`), `ref?: HTMLButtonElement | HTMLAnchorElement | null` (`$bindable`), `class?` (layout only), `children`, and the rest of the HTML attributes. Its `<script module>` exports `FOCUS_RING` and `DISABLED_LOOK`.
  - `IconButton.svelte`: `label: string` (required; it is the `aria-label`), `size?: "md" | "sm"` (`size-11` / `size-9`, default `"md"`), `variant?: "ghost" | "secondary"` (default `"ghost"`), `href?`, `type?: "button" | "submit"` (default `"button"`), `ref?` (`$bindable`), `class?`, `children` (the icon, which the caller marks `aria-hidden`), and rest.
  - `Toggle.svelte`: `pressed: boolean`, `size?: "md" | "sm"` (`h-11` / `h-9`, default `"sm"`), `shape?: "rect" | "pill"` (default `"rect"`), `class?`, `children`, and rest (`onclick`, `name`, `value`, `aria-*`). Always `type="button"`; renders `aria-pressed`. On: `border border-accent-ink bg-accent/15 text-accent-ink`. Off: `border border-border-strong text-text-secondary hover:bg-surface-overlay`.
  - `tests/unit/helpers/compiled-rule.ts`: `compiledCss(candidates: string[]): Promise<string>` and `compiledRule(candidate: string): Promise<string | null>`.
  - `tests/unit/helpers/axe-ssr.ts`: `withoutComments(html: string): string`. Every later task imports it from here; none defines its own.

- [ ] **2.1 Share the CSS compiler and the comment stripper (refactor, no behaviour change).**

  Create `tests/unit/helpers/compiled-rule.ts`. `compiledRule` moves verbatim from `timeline-entry-ssr.test.ts:131-159`; only the stylesheet path gains one `../`, and the compile is split out as `compiledCss`, which the Button test needs whole.

<!-- prettier-ignore -->
```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";

const require = createRequire(import.meta.url);
const APP_CSS = fileURLToPath(new URL("../../../src/app.css", import.meta.url));

/**
 * The whole stylesheet Tailwind builds from the real src/app.css for these
 * candidates: the utilities they generate plus app.css's own unlayered rules,
 * such as the data-density="compact" overrides.
 */
export async function compiledCss(candidates: string[]): Promise<string> {
  const compiler = await compile(readFileSync(APP_CSS, "utf8"), {
    base: dirname(APP_CSS),
    loadStylesheet: async (id: string) => {
      if (id !== "tailwindcss") throw new Error(`unexpected @import ${id}`);
      const path = require.resolve("tailwindcss/index.css");
      return { path, base: dirname(path), content: readFileSync(path, "utf8") };
    },
  });
  return compiler.build(candidates);
}

/**
 * Compile a class name against the real src/app.css and return the rule
 * Tailwind generates for it, or null if it generates none. Reading the
 * compiled CSS rather than the class string is the point: an arbitrary
 * variant with a typo is still a perfectly good class name, it just produces
 * no CSS, and a test of the string would pass while the controls never hid.
 */
export async function compiledRule(candidate: string): Promise<string | null> {
  const css = await compiledCss([candidate]);
  const selector = "." + candidate.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return null;
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
  }
  return null;
}
```

In `tests/unit/timeline-entry-ssr.test.ts`:

- delete the imports at `:15-18` (`readFileSync`, `createRequire`, `dirname`, `fileURLToPath`) and `:20` (`compile`);
- add `import { compiledRule } from "./helpers/compiled-rule";` after `:21`;
- delete `:131-159` (the doc comment, `require`, `APP_CSS` and `compiledRule`), so `const HOVER_MEDIA` follows the closing `});` of the describe above it.

Append to `tests/unit/helpers/axe-ssr.ts` (36 lines at HEAD):

<!-- prettier-ignore -->
```ts

/**
 * SSR markup with Svelte's hydration comments removed. A rendered snippet
 * arrives bracketed by them (`<a …><!---->Clear filters<!----></a>`), so a
 * regex that means "the label is this element's direct text" reads this.
 */
export function withoutComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}
```

Run `npx vitest run tests/unit/timeline-entry-ssr.test.ts`. Expect PASS, 15 tests (the same 15 as before).
Commit: `test: share compiledRule and a comment stripper between SSR tests`

- [ ] **2.2 Failing tests.**

  Create the fixture `tests/unit/helpers/ButtonGallery.svelte`. A real `.svelte` caller is needed: a page's label is a compiled snippet, and only a compiled snippet carries the hydration markers that pages will really emit (`createRawSnippet` on the server pushes its string bare). It also gives axe every case at once.

<!-- prettier-ignore -->
```svelte
<!--
  Every Button, IconButton and Toggle case in one tree, for
  tests/unit/button-ssr.test.ts. A real .svelte caller, so each label is a
  compiled snippet exactly as a page's is, and axe sees every case at once.
  Each control carries data-case, passed through the primitive's rest props.
-->
<script lang="ts">
  import Button from "$lib/components/ui/Button.svelte";
  import IconButton from "$lib/components/ui/IconButton.svelte";
  import Toggle from "$lib/components/ui/Toggle.svelte";

  const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
  const SIZES = ["md", "sm"] as const;
</script>

{#snippet cross()}
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
    <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" />
  </svg>
{/snippet}

{#each VARIANTS as variant (variant)}
  {#each SIZES as size (size)}
    <Button {variant} {size} data-case="{variant}-{size}">Save changes</Button>
  {/each}
{/each}
<Button href="/log" data-case="link">Clear filters</Button>
<Button type="submit" data-case="submit">Save</Button>
<Button pending={false} data-case="idle">Save changes</Button>
<Button variant="danger" pending={true} pendingLabel="Deleting…" data-case="pending"
  >Delete permanently</Button
>
<Button disabled data-case="disabled">Unavailable</Button>
<Button variant="danger" ariaDisabled data-case="aria-disabled">Delete</Button>
<Button variant="primary" block data-case="block">Sign in</Button>
<Button shape="pill" size="sm" aria-label="Remove Headache" data-case="pill"
  >Headache <span aria-hidden="true">&times;</span></Button
>
<IconButton label="Close menu" data-case="icon-md">{@render cross()}</IconButton>
<IconButton label="Remove colour" size="sm" variant="secondary" data-case="icon-sm"
  >{@render cross()}</IconButton
>
<IconButton label="Settings" href="/settings" data-case="icon-link">{@render cross()}</IconButton>
<div role="group" aria-label="Schedule">
  <Toggle pressed={true} data-case="toggle-on">Interval</Toggle>
  <Toggle pressed={false} data-case="toggle-off">Fixed time</Toggle>
  <Toggle pressed={false} size="md" shape="pill" data-case="toggle-pill">Headache</Toggle>
</div>
```

Create `tests/unit/button-ssr.test.ts`. Expected classes are written out from the decided recipes (2.3, 2.4), never imported from the component, so a change to a recipe has to change both files.

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// Button, IconButton and Toggle: the decided class recipes, the link/button
// split, the pending cell, both disabled modes, the focus ring, and the
// fixed heights that compact density cannot shrink.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import { createRawSnippet, type Component, type ComponentProps } from "svelte";
import Button from "$lib/components/ui/Button.svelte";
import IconButton from "$lib/components/ui/IconButton.svelte";
import Toggle from "$lib/components/ui/Toggle.svelte";
import ButtonGallery from "./helpers/ButtonGallery.svelte";
import { evaluatedRules, runAxe, ssrDocument, withoutComments } from "./helpers/axe-ssr";
import { compiledCss, compiledRule } from "./helpers/compiled-rule";
import { accessibleName, textOf } from "./helpers/dom-names";

const label = (text: string) => createRawSnippet(() => ({ render: () => text }));

function ssr<P extends Record<string, unknown>>(component: Component<P>, props: P): Element {
  const doc = ssrDocument(render(component, { props }).body);
  const el = doc.querySelector("main > *");
  expect(el, "nothing rendered").not.toBeNull();
  return el!;
}

const classes = (el: Element) => new Set(el.classList);

const RING = [
  "focus-visible:outline-2",
  "focus-visible:outline-offset-2",
  "focus-visible:outline-accent-ink",
];
const DISABLED_LOOK = [
  "disabled:cursor-not-allowed",
  "disabled:opacity-50",
  "aria-disabled:cursor-not-allowed",
  "aria-disabled:opacity-50",
];
const BASE = [
  "inline-flex",
  "items-center",
  "justify-center",
  "gap-2",
  "text-sm",
  "font-medium",
  "whitespace-nowrap",
  "transition-colors",
  ...RING,
  ...DISABLED_LOOK,
];
const SIZE = { md: ["h-11", "px-4"], sm: ["h-9", "px-3"] } as const;
const RECT = "rounded-lg";
const VARIANT = {
  primary: ["bg-accent", "text-accent-fg", "hover:opacity-90"],
  secondary: ["border", "border-border-strong", "text-text-primary", "hover:bg-surface-overlay"],
  ghost: ["text-text-secondary", "hover:bg-surface-overlay", "hover:text-text-primary"],
  danger: ["bg-danger", "text-danger-fg", "hover:brightness-110"],
} as const;

describe("Button", () => {
  for (const variant of ["primary", "secondary", "ghost", "danger"] as const) {
    for (const size of ["md", "sm"] as const) {
      it(`draws ${variant} at ${size} with exactly the decided classes`, () => {
        const el = ssr(Button, { variant, size, children: label("Save") });
        expect(classes(el)).toEqual(new Set([...BASE, ...SIZE[size], RECT, ...VARIANT[variant]]));
      });
    }
  }

  it("defaults to a secondary, md <button type=button>", () => {
    const el = ssr(Button, { children: label("Save") });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(classes(el)).toEqual(new Set([...BASE, ...SIZE.md, RECT, ...VARIANT.secondary]));
  });

  it("draws shape=pill as rounded-full in place of rounded-lg", () => {
    const el = ssr(Button, { shape: "pill", size: "sm", children: label("Headache") });
    expect(classes(el)).toEqual(
      new Set([...BASE, ...SIZE.sm, "rounded-full", ...VARIANT.secondary]),
    );
  });

  it("passes type=submit and rest attributes through to the button", () => {
    const el = ssr(Button, {
      type: "submit",
      name: "intent",
      value: "archive",
      "aria-describedby": "hint",
      children: label("Archive"),
    });
    expect(el.getAttribute("type")).toBe("submit");
    expect(el.getAttribute("name")).toBe("intent");
    expect(el.getAttribute("value")).toBe("archive");
    expect(el.getAttribute("aria-describedby")).toBe("hint");
  });

  it("renders an <a href> with no type and no disabled when given href", () => {
    const el = ssr(Button, { href: "/log", type: "submit", disabled: true, children: label("Go") });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("href")).toBe("/log");
    expect(el.hasAttribute("type")).toBe(false);
    expect(el.hasAttribute("disabled")).toBe(false);
  });

  it("appends w-full for block and the caller's class, keeping the recipe", () => {
    const el = ssr(Button, { block: true, class: "mt-4", children: label("Sign in") });
    expect(classes(el)).toEqual(
      new Set([...BASE, ...SIZE.md, RECT, ...VARIANT.secondary, "w-full", "mt-4"]),
    );
  });

  it("puts a label with no pending state directly in the element", () => {
    // A real .svelte caller, because a page's label is a compiled snippet, and
    // Svelte 5.57's SSR brackets a rendered snippet in hydration comments:
    // <a href="/log" class="…"><!--[0--><!---->Clear filters<!----><!--]--><!----></a>.
    // Comments, never an element: the label is still the anchor's only content.
    const html = render(ButtonGallery).body;
    const link = ssrDocument(html).querySelector('[data-case="link"]')!;
    expect(link.tagName).toBe("A");
    expect(link.childElementCount).toBe(0);
    expect(textOf(link)).toBe("Clear filters");
    // log-pagination-ssr.test.ts's own pattern, once the comments are gone.
    expect(withoutComments(html)).toMatch(/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/);
  });

  it("with pending=false, holds both labels in one grid cell and hides the pending one", () => {
    const el = ssr(Button, { pending: false, children: label("Save changes") });
    expect(el.hasAttribute("aria-busy")).toBe(false);
    const idle = el.querySelector('[data-part="label"]')!;
    const busy = el.querySelector('[data-part="pending"]')!;
    expect(idle.parentElement).toBe(busy.parentElement);
    expect([...idle.parentElement!.classList]).toContain("inline-grid");
    for (const part of [idle, busy]) {
      expect([...part.classList]).toEqual(expect.arrayContaining(["col-start-1", "row-start-1"]));
    }
    expect(idle.classList.contains("invisible")).toBe(false);
    expect(idle.hasAttribute("aria-hidden")).toBe(false);
    expect(busy.classList.contains("invisible")).toBe(true);
    expect(busy.getAttribute("aria-hidden")).toBe("true");
    expect(accessibleName(el)).toBe("Save changes");
  });

  it("with pending=true, shows the spinner and pendingLabel, aria-busy, and keeps the label's width", () => {
    const el = ssr(Button, {
      variant: "danger",
      pending: true,
      pendingLabel: "Deleting…",
      children: label("Delete permanently"),
    });
    expect(el.getAttribute("aria-busy")).toBe("true");
    const idle = el.querySelector('[data-part="label"]')!;
    const busy = el.querySelector('[data-part="pending"]')!;
    expect(idle.classList.contains("invisible")).toBe(true);
    expect(idle.getAttribute("aria-hidden")).toBe("true");
    expect(textOf(idle)).toBe("Delete permanently");
    expect(busy.classList.contains("invisible")).toBe(false);
    expect(busy.hasAttribute("aria-hidden")).toBe(false);
    const spinner = busy.querySelector(".animate-spin");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(accessibleName(el)).toBe("Deleting…");
  });

  it("says Saving… (one character, U+2026) when no pendingLabel is given", () => {
    const el = ssr(Button, { pending: true, children: label("Save") });
    expect(accessibleName(el)).toBe("Saving…");
  });

  it("disabled is the real attribute and nothing else", () => {
    const el = ssr(Button, { disabled: true, children: label("Save") });
    expect(el.hasAttribute("disabled")).toBe(true);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
  });

  it("ariaDisabled is aria-disabled=true and never disabled, so focus stays", () => {
    for (const href of [undefined, "/log"]) {
      const el = ssr(Button, { href, ariaDisabled: true, children: label("Delete") });
      expect(el.getAttribute("aria-disabled")).toBe("true");
      expect(el.hasAttribute("disabled")).toBe(false);
    }
  });

  it("renders neither disabled mode by default", () => {
    const el = ssr(Button, { children: label("Save") });
    expect(el.hasAttribute("disabled")).toBe(false);
    expect(el.hasAttribute("aria-disabled")).toBe(false);
    expect(el.hasAttribute("aria-busy")).toBe(false);
  });
});

const ICON_BASE = [
  "inline-flex",
  "shrink-0",
  "items-center",
  "justify-center",
  "rounded-lg",
  "transition-colors",
  ...RING,
  ...DISABLED_LOOK,
];

describe("IconButton", () => {
  const icon = createRawSnippet(() => ({ render: () => `<svg aria-hidden="true"></svg>` }));

  it("names itself with aria-label from the required label, ghost at size-11 by default", () => {
    const el = ssr(IconButton, { label: "Close menu", children: icon });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("aria-label")).toBe("Close menu");
    expect(classes(el)).toEqual(new Set([...ICON_BASE, "size-11", ...VARIANT.ghost]));
  });

  it("draws sm secondary at size-9", () => {
    const el = ssr(IconButton, {
      label: "Remove colour",
      size: "sm",
      variant: "secondary",
      children: icon,
    });
    expect(classes(el)).toEqual(new Set([...ICON_BASE, "size-9", ...VARIANT.secondary]));
  });

  it("renders a named link with no type when given href", () => {
    const el = ssr(IconButton, { label: "Settings", href: "/settings", children: icon });
    expect(el.tagName).toBe("A");
    expect(el.getAttribute("aria-label")).toBe("Settings");
    expect(el.hasAttribute("type")).toBe(false);
  });

  it("will not compile without a label", () => {
    // @ts-expect-error label is required: an icon has no text to name it.
    const props: ComponentProps<typeof IconButton> = { children: icon };
    expect(props).toBeDefined();
  });
});

describe("Toggle", () => {
  const ON = ["border", "border-accent-ink", "bg-accent/15", "text-accent-ink"];
  const OFF = ["border", "border-border-strong", "text-text-secondary", "hover:bg-surface-overlay"];
  const TOGGLE_BASE = [
    "inline-flex",
    "items-center",
    "justify-center",
    "gap-2",
    "px-3",
    "text-sm",
    "font-medium",
    "whitespace-nowrap",
    "transition-colors",
    ...RING,
    ...DISABLED_LOOK,
  ];

  it("pressed: aria-pressed=true, type=button, the on recipe, sm rect by default", () => {
    const el = ssr(Toggle, { pressed: true, children: label("Interval") });
    expect(el.tagName).toBe("BUTTON");
    expect(el.getAttribute("type")).toBe("button");
    expect(el.getAttribute("aria-pressed")).toBe("true");
    expect(classes(el)).toEqual(new Set([...TOGGLE_BASE, "h-9", "rounded-lg", ...ON]));
  });

  it("not pressed: aria-pressed=false and the off recipe", () => {
    const el = ssr(Toggle, { pressed: false, children: label("Fixed time") });
    expect(el.getAttribute("aria-pressed")).toBe("false");
    expect(classes(el)).toEqual(new Set([...TOGGLE_BASE, "h-9", "rounded-lg", ...OFF]));
  });

  it("stays type=button even when a type reaches it through a spread", () => {
    // Inside a <form>, a toggle that became a submit would post the form.
    const stray = { type: "submit" } as Record<string, unknown>;
    const props = { pressed: false, children: label("Interval"), ...stray };
    const el = ssr(Toggle, props as ComponentProps<typeof Toggle>);
    expect(el.getAttribute("type")).toBe("button");
  });

  it("draws md at h-11 and pill as rounded-full", () => {
    const el = ssr(Toggle, {
      pressed: false,
      size: "md",
      shape: "pill",
      children: label("Nausea"),
    });
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-11", "rounded-full"]));
    expect(el.classList.contains("rounded-lg")).toBe(false);
  });
});

describe("every primitive in the gallery", () => {
  const gallery = () => ssrDocument(render(ButtonGallery).body);

  it("draws the focus-visible ring, and every ring class compiles to a rule", async () => {
    const cases = [...gallery().querySelectorAll("[data-case]")];
    expect(cases.length).toBe(22);
    for (const el of cases) {
      expect([...el.classList], el.getAttribute("data-case")!).toEqual(
        expect.arrayContaining(RING),
      );
    }
    expect(await compiledRule("focus-visible:outline-2")).toMatch(
      /&:focus-visible \{[^}]*outline-width: 2px/,
    );
    expect(await compiledRule("focus-visible:outline-offset-2")).toMatch(
      /&:focus-visible \{[^}]*outline-offset: 2px/,
    );
    expect(await compiledRule("focus-visible:outline-accent-ink")).toMatch(
      /&:focus-visible \{[^}]*outline-color: var\(--color-accent-ink\)/,
    );
    expect(await compiledRule("aria-disabled:opacity-50")).toMatch(
      /&\[aria-disabled="true"\] \{[^}]*opacity: 50%/,
    );
    expect(await compiledRule("disabled:opacity-50")).toMatch(/&:disabled \{[^}]*opacity: 50%/);
  });

  it("cannot be restyled through class, which is why shape is a prop", async () => {
    // Tailwind v4 emits same-property utilities in name order, whatever order
    // the class attribute lists them in; the later rule wins. An appended
    // rounded-full sits before rounded-lg, so it loses.
    const css = await compiledCss(["rounded-lg", "rounded-full"]);
    expect(css.indexOf(".rounded-full {")).toBeGreaterThan(-1);
    expect(css.indexOf(".rounded-full {")).toBeLessThan(css.indexOf(".rounded-lg {"));
  });

  it("keeps a fixed height under compact density, which rewrites py-2.5 but none of these", async () => {
    const css = await compiledCss(["py-2.5", "h-11", "h-9", "size-11", "size-9"]);
    const rewritten = new Set(
      [...css.matchAll(/\[data-density="compact"\]([^{]*)\{/g)].flatMap(([, selector]) =>
        [...selector.matchAll(/\.((?:[\w-]|\\.)+)/g)].map(([, c]) => c.replace(/\\(.)/g, "$1")),
      ),
    );
    // The mechanism this guards against is real: compact rewrites py-2.5.
    expect(rewritten).toContain("py-2.5");
    for (const el of gallery().querySelectorAll("[data-case]")) {
      const list = [...el.classList];
      expect(
        list.filter((t) => rewritten.has(t)),
        el.getAttribute("data-case")!,
      ).toEqual([]);
      expect(
        list.filter((t) => /^p[ytb]?-/.test(t)),
        el.getAttribute("data-case")!,
      ).toEqual([]);
      expect(
        list.filter((t) => /^(h|size)-(9|11)$/.test(t)),
        el.getAttribute("data-case")!,
      ).toHaveLength(1);
    }
    expect(await compiledRule("h-11")).toMatch(/height: calc\(var\(--spacing\) \* 11\)/);
    expect(await compiledRule("h-9")).toMatch(/height: calc\(var\(--spacing\) \* 9\)/);
    expect(await compiledRule("size-11")).toMatch(/height: calc\(var\(--spacing\) \* 11\)/);
    expect(await compiledRule("size-9")).toMatch(/height: calc\(var\(--spacing\) \* 9\)/);
  });

  it("passes axe: button-name, link-name, aria-allowed-attr, aria-valid-attr-value, aria-prohibited-attr, aria-hidden-focus, nested-interactive", async () => {
    const rules = [
      "button-name",
      "link-name",
      "aria-allowed-attr",
      "aria-valid-attr-value",
      "aria-prohibited-attr",
      "aria-hidden-focus",
      "nested-interactive",
    ];
    const results = await runAxe(gallery(), rules);
    expect(results.violations).toEqual([]);
    const ran = evaluatedRules(results);
    for (const rule of rules) expect(ran, `${rule} evaluated nothing`).toContain(rule);
  });
});
```

The compact-density proof is measured against the real `app.css`, not stated. At HEAD, the selectors under `[data-density="compact"]` are `main`, `.space-y-6 > * + *`, `.space-y-4 > * + *`, `.p-5`, `.p-6` and `.py-2\.5` (`app.css:218-243`). `h-11` compiles to `height: calc(var(--spacing) * 11)` and no compact rule names it.

Create `tests/unit/button-mount.svelte.test.ts` (jsdom, client svelte). It is a `.svelte.test.ts` so that props can be a `$state` the test changes. On the client, `createRawSnippet` must render one element, so the labels are `<span>`s.

<!-- prettier-ignore -->
```ts
// Button and Toggle mounted for real (jsdom, client svelte). A `.svelte.test.ts`
// so props are a `$state` the test can change: a pending flip must keep the
// same element, and so the same focus, or a keyboard user's Save loses focus
// the moment it is pressed.
import { describe, it, expect, afterEach, vi } from "vitest";
import { createRawSnippet, flushSync, mount, unmount, type ComponentProps } from "svelte";
import Button from "$lib/components/ui/Button.svelte";
import IconButton from "$lib/components/ui/IconButton.svelte";
import Toggle from "$lib/components/ui/Toggle.svelte";

const label = (text: string) => createRawSnippet(() => ({ render: () => `<span>${text}</span>` }));

let app: ReturnType<typeof mount> | undefined;
afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  document.body.innerHTML = "";
});

describe("Button, mounted", () => {
  it("keeps the same focused element while pending flips, and moves aria-busy with it", () => {
    const props = $state({ pending: false, children: label("Save changes") });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.focus();

    props.pending = true;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");

    props.pending = false;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("keeps the same element when pending goes from undefined to a boolean", () => {
    // A caller that only starts passing pending once a submit begins must not
    // swap the element out from under the keyboard focus.
    const props: ComponentProps<typeof Button> = $state({
      children: label("Delete permanently"),
    });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.focus();

    props.pending = true;
    flushSync();
    expect(document.querySelector("button")).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  it("forwards onclick, and a real disabled button never fires it", () => {
    const onclick = vi.fn();
    const props = $state({ disabled: false, onclick, children: label("Save") });
    app = mount(Button, { target: document.body, props });
    flushSync();
    const button = document.querySelector("button")!;
    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);

    props.disabled = true;
    flushSync();
    button.click();
    expect(onclick).toHaveBeenCalledTimes(1);
  });
});

describe("ref", () => {
  // bind:this on a component yields the instance, not its element. These
  // hand the element back for the focus moves MobileHeader, the colour
  // picker's + and SideEffectPicker's chips make.
  for (const href of [undefined, "/log"]) {
    it(`binds Button's rendered ${href ? "<a>" : "<button>"}`, () => {
      const props: ComponentProps<typeof Button> = $state({
        href,
        ref: null,
        children: label("Save"),
      });
      app = mount(Button, { target: document.body, props });
      flushSync();
      expect(props.ref).toBe(document.querySelector(href ? "a" : "button"));
    });
  }

  it("binds IconButton's rendered <button>", () => {
    const props: ComponentProps<typeof IconButton> = $state({
      label: "Toggle menu",
      ref: null,
      children: label("≡"),
    });
    app = mount(IconButton, { target: document.body, props });
    flushSync();
    expect(props.ref).toBe(document.querySelector('button[aria-label="Toggle menu"]'));
  });
});

describe("Toggle, mounted", () => {
  it("reports the caller's pressed state through aria-pressed as it changes", () => {
    const props = $state({
      pressed: false,
      onclick: () => {
        props.pressed = !props.pressed;
      },
      children: label("Interval"),
    });
    app = mount(Toggle, { target: document.body, props });
    flushSync();
    const toggle = document.querySelector("button")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    toggle.click();
    flushSync();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.classList.contains("text-accent-ink")).toBe(true);
  });
});
```

Run `npx vitest run tests/unit/button-ssr.test.ts tests/unit/button-mount.svelte.test.ts`. Expect FAIL:

- `button-ssr`: `Error: Cannot find module '$lib/components/ui/Button.svelte' imported from …/tests/unit/button-ssr.test.ts`
- `button-mount`: `Error: Failed to resolve import "$lib/components/ui/Button.svelte" from "tests/unit/button-mount.svelte.test.ts". Does the file exist?`

- [ ] **2.3 Implement `src/lib/components/ui/Button.svelte`.**

  The template structure is the decision here, so it is given in full:
  - The `pending` branch sits **inside** the element. A caller can go from `pending` undefined to `true` (T7's `DestructiveConfirm` passes its optional `pending` straight through) and keep the same focused element.
  - `{...rest}` comes first, so the managed attributes after it win: `href`, `type`, `disabled`, `class`, `aria-disabled` and `aria-busy`. Callers use `ariaDisabled`, never a raw `aria-disabled`.
  - `bind:this={ref}` sits on both the `<a>` and the `<button>`.
  - The ESLint disable stops `svelte/no-navigation-without-resolve` adding two warnings for the dynamic `href`, so lint stays at 115. `resolve()` belongs at the call site, and each call-site `<a href>` that becomes `<Button href>` stops warning there, so later tasks may see the count fall.

<!-- prettier-ignore -->
```svelte
<script lang="ts" module>
  /** The focus ring every button primitive draws: 2px accent-ink, offset 2px. */
  export const FOCUS_RING =
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink";
  /** A real `disabled` and an `aria-disabled` look the same: about half opacity. */
  export const DISABLED_LOOK =
    "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLAnchorAttributes, HTMLButtonAttributes } from "svelte/elements";

  type Props = {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "md" | "sm";
    href?: string;
    type?: "button" | "submit" | "reset";
    block?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    disabled?: boolean;
    ariaDisabled?: boolean;
    /** rounded-lg, or rounded-full for a pill. */
    shape?: "rect" | "pill";
    /** The rendered <button> or <a>, for a caller that hands focus to it. */
    ref?: HTMLButtonElement | HTMLAnchorElement | null;
    /**
     * Layout only: margins, flex-1, self-*, shrink-0, w-*, border-dashed.
     * Appended, but it cannot override the recipe: Tailwind v4 orders
     * same-property utilities by name, not by class order, so `rounded-full`
     * here loses to `rounded-lg`. Use `variant`, `size` and `shape`.
     */
    class?: string;
    children: Snippet;
  } & Omit<
    HTMLButtonAttributes & HTMLAnchorAttributes,
    "type" | "href" | "class" | "disabled" | "children"
  >;

  let {
    variant = "secondary",
    size = "md",
    href,
    type = "button",
    block = false,
    pending,
    pendingLabel = "Saving…",
    disabled = false,
    ariaDisabled = false,
    shape = "rect",
    ref = $bindable(null),
    class: className = "",
    children,
    ...rest
  }: Props = $props();

  // Fixed heights, never padding: data-density="compact" rewrites .py-2.5
  // (app.css), which is how "Save Changes" fell to 32px beside a 36px button.
  const SIZES = { md: "h-11 px-4", sm: "h-9 px-3" } as const;
  const SHAPES = { rect: "rounded-lg", pill: "rounded-full" } as const;
  const VARIANTS = {
    primary: "bg-accent text-accent-fg hover:opacity-90",
    secondary: "border border-border-strong text-text-primary hover:bg-surface-overlay",
    ghost: "text-text-secondary hover:bg-surface-overlay hover:text-text-primary",
    danger: "bg-danger text-danger-fg hover:brightness-110",
  } as const;

  const classes = $derived([
    "inline-flex items-center justify-center gap-2 text-sm font-medium whitespace-nowrap transition-colors",
    FOCUS_RING,
    DISABLED_LOOK,
    SIZES[size],
    SHAPES[shape],
    VARIANTS[variant],
    block && "w-full",
    className,
  ]);
  const CELL = "col-start-1 row-start-1 inline-flex items-center justify-center gap-2";
</script>

<!-- Without `pending` the children sit directly in the element, with no
     wrapper. With it, the label and the pending label share one grid cell,
     so a pressed button keeps its width (DoseActionForm's technique). The
     branch is INSIDE the element: a caller that starts with pending
     undefined and later sets it keeps the same focused element. -->
{#snippet content()}
  {#if pending === undefined}
    {@render children()}
  {:else}
    <span class="inline-grid">
      <span
        data-part="label"
        class={[CELL, pending && "invisible"]}
        aria-hidden={pending ? "true" : undefined}>{@render children()}</span
      >
      <span
        data-part="pending"
        class={[CELL, !pending && "invisible"]}
        aria-hidden={pending ? undefined : "true"}
        ><span
          class="size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  {/if}
{/snippet}

<!-- eslint-disable svelte/no-navigation-without-resolve -- a primitive renders the href its
     caller passes; resolve() belongs at the call site, which knows the route. -->
{#if href !== undefined}
  <a
    bind:this={ref}
    {...rest}
    {href}
    class={classes}
    aria-disabled={ariaDisabled ? "true" : undefined}
    aria-busy={pending ? "true" : undefined}>{@render content()}</a
  >
{:else}
  <button
    bind:this={ref}
    {...rest}
    {type}
    {disabled}
    class={classes}
    aria-disabled={ariaDisabled ? "true" : undefined}
    aria-busy={pending ? "true" : undefined}>{@render content()}</button
  >
{/if}
```

- [ ] **2.4 Implement `IconButton.svelte` and `Toggle.svelte`.** Both import `FOCUS_RING` and `DISABLED_LOOK` from `./Button.svelte`, so the ring has one spelling.

  `IconButton.svelte`:
  - Props are those in Interfaces, with `Omit<HTMLButtonAttributes & HTMLAnchorAttributes, "type" | "href" | "class" | "children" | "aria-label">`. `aria-label` is omitted because `label` owns it.
  - Defaults: `size = "md"`, `variant = "ghost"`, `type = "button"`, `ref = $bindable(null)`.
  - Classes: `"inline-flex shrink-0 items-center justify-center rounded-lg transition-colors"`, `FOCUS_RING`, `DISABLED_LOOK`, then `{ md: "size-11", sm: "size-9" }[size]`, then the variant (ghost and secondary are the same strings as Button's), then `className`.
  - The template is the same `{#if href}` split, under the same ESLint disable comment:

<!-- prettier-ignore -->
```svelte
{#if href !== undefined}
  <a bind:this={ref} {...rest} {href} class={classes} aria-label={label}>{@render children()}</a>
{:else}
  <button bind:this={ref} {...rest} {type} class={classes} aria-label={label}
    >{@render children()}</button
  >
{/if}
```

`Toggle.svelte`:

- Props are those in Interfaces, with `Omit<HTMLButtonAttributes, "type" | "class" | "children" | "aria-pressed">`. `px-3` at both sizes, as all four of today's toggle recipes use. The off state's `border-border-strong` (today's toggles use `border-glass-border`) gives the schedule-mode and weekday toggles a 3:1 control boundary.
- Defaults: `size = "sm"`, `shape = "rect"`.
- Classes: `"inline-flex items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap transition-colors"`, `FOCUS_RING`, `DISABLED_LOOK`, `{ md: "h-11", sm: "h-9" }[size]`, `{ rect: "rounded-lg", pill: "rounded-full" }[shape]`, then `pressed ? "border border-accent-ink bg-accent/15 text-accent-ink" : "border border-border-strong text-text-secondary hover:bg-surface-overlay"`, then `className`.
- `type` comes after `{...rest}`, so nothing can turn a toggle into a submit:

<!-- prettier-ignore -->
```svelte
<button {...rest} type="button" class={classes} aria-pressed={pressed ? "true" : "false"}
  >{@render children()}</button
>
```

- [ ] **2.5 Run** `npx vitest run tests/unit/button-ssr.test.ts tests/unit/button-mount.svelte.test.ts`. Expect PASS, 39 tests (32 + 7).

  For the record, the gallery's link renders exactly:
  `<a data-case="link" href="/log" class="… h-11 px-4 rounded-lg border border-border-strong text-text-primary hover:bg-surface-overlay"><!--[0--><!---->Clear filters<!----><!--]--><!----></a>`

- [ ] **2.6 Hover contrast, measured.** Primary hovers with `hover:opacity-90`, which fades the fill **and** the label 90% over the backdrop. Danger hovers with `hover:brightness-110`. In `tests/unit/theme-tokens.test.ts`, insert this immediately before the `/**` that opens "Tinted chips: `bg-danger/20 text-danger-ink` and friends" (`:316` at HEAD; T1's edits may move it).

<!-- prettier-ignore -->
```ts
/** CSS `brightness(k)`: every sRGB channel times k, clamped. Filter functions run in sRGB. */
function brighten(hex: string, k: number): string {
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Button's hover states (src/lib/components/ui/Button.svelte). `primary`
 * hovers with `hover:opacity-90`, which composites the fill AND the label 90%
 * over whatever is behind the button. Logged-out pages run the @theme accent,
 * so that pair is measured over the three backdrops a Button sits on.
 * `danger` hovers with `hover:brightness-110`, because 90% opacity took
 * #111111 on #ef4444 to 4.24:1 in dark. Only those two variants have a fill.
 */
describe.each(SCHEMES)("$name — Button hover states keep a legible label", ({ T }) => {
  const glass = alphaOf(T["--color-glass"]);
  const BACKDROPS: Record<string, string> = {
    page: T["--color-surface"],
    card: compositeOver(glass.alpha, T["--color-surface"], glass.overlay),
    dialog: T["--color-surface-raised"],
  };
  const atOpacity = (fill: string, fg: string, base: string) =>
    contrastRatio(compositeOver(0.9, base, T[fg]), compositeOver(0.9, base, T[fill]));

  for (const [where, base] of Object.entries(BACKDROPS)) {
    it(`primary at 90% opacity over ${where}`, () => {
      const ratio = atOpacity("--color-accent", "--color-accent-fg", base);
      expect(ratio, `hovered primary is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("danger brightened to 110%", () => {
    const ratio = contrastRatio(
      brighten(T["--color-danger-fg"], 1.1),
      brighten(T["--color-danger"], 1.1),
    );
    expect(ratio, `hovered danger is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// Guard the guard: 90% opacity, the hover danger first had, fails in a dark dialog.
it("would have failed danger at 90% opacity in a dark dialog", () => {
  const dialog = DARK["--color-surface-raised"];
  const ratio = contrastRatio(
    compositeOver(0.9, dialog, DARK["--color-danger-fg"]),
    compositeOver(0.9, dialog, DARK["--color-danger"]),
  );
  expect(ratio).toBeLessThan(4.5);
});
```

Run `npx vitest run tests/unit/theme-tokens.test.ts`. Expect PASS with 9 more tests than before: 4 per scheme, plus the guard.

- These rows pass at their first run. They guard tokens that already exist; nothing in T2 makes them pass.
- Measured values, for page, card and dialog in turn:
  - primary hovered: 5.82, 5.76 and 5.74 in dark; 5.19, 5.19 and 5.12 in light;
  - danger brightened: 5.63 in dark and 5.76 in light;
  - danger at 90% opacity: 4.24, 4.27 and 4.26 in dark.

- [ ] **2.7 Exempt the danger variant.** In `tests/unit/status-colour-owner.test.ts`, add this to `EXEMPT`:

<!-- prettier-ignore -->
```ts
  {
    file: "src/lib/components/ui/Button.svelte",
    why: "The danger variant (bg-danger text-danger-fg), used only inside DestructiveConfirm.",
  },
```

Run `npx vitest run tests/unit/status-colour-owner.test.ts`. Expect PASS.

- Without the entry, "every file that writes a status class is exempt or pending" fails and names `src/lib/components/ui/Button.svelte`.
- `IconButton.svelte` and `Toggle.svelte` write no status class, so they need no entry.

- [ ] **2.8 Mutation proofs.** Break each line, run the named file, see the named test fail, then restore it. Every one was run.

  | Break this                                                                                                                                                | Expect this to FAIL                                                                                                                                             |
  | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `SIZES.md` `"h-11 px-4"` → `"py-2.5 px-4"`                                                                                                                | `draws {primary,secondary,ghost,danger} at md…`, `defaults to a secondary, md…`, `appends w-full…`, and `keeps a fixed height under compact density…` (7 tests) |
  | Wrap the whole `{#if href}…{/if}` block in `{#key pending === undefined}…{/key}`, so the element remounts when `pending` goes from undefined to a boolean | `keeps the same element when pending goes from undefined to a boolean`                                                                                          |
  | Drop `aria-busy={pending ? "true" : undefined}` from the `<button>`                                                                                       | `with pending=true, shows the spinner…`, `keeps the same focused element while pending flips…`, and `keeps the same element when pending goes from undefined…`  |
  | `pendingLabel = "Saving…"` → `"Saving..."`                                                                                                                | `says Saving… (one character, U+2026)…`                                                                                                                         |
  | Drop `bind:this={ref}` from the `<a>`                                                                                                                     | `binds Button's rendered <a>`                                                                                                                                   |
  | `SHAPES.pill` → `"rounded-lg"`                                                                                                                            | `draws shape=pill as rounded-full in place of rounded-lg`                                                                                                       |
  | `danger` hover back to `hover:opacity-90`                                                                                                                 | `draws danger at md…` and `draws danger at sm…` (with the guard in 2.6 recording why)                                                                           |
  | Remove `FOCUS_RING` from Toggle's `classes`                                                                                                               | both Toggle recipe tests and `draws the focus-visible ring…`                                                                                                    |
  | Toggle: `<button {...rest} type="button"` → `<button type="button" {...rest}`                                                                             | `stays type=button even when a type reaches it through a spread`                                                                                                |
  | IconButton: `label: string` → `label?: string`                                                                                                            | `npm run check`: `tests/unit/button-ssr.test.ts … Unused '@ts-expect-error' directive.` (the vitest case is compile-time only)                                  |
  | `app.css:162`, the light arm's `--color-accent: #4f46e5` → `#5e57ea` (5.21:1 at rest, 4.33:1 hovered)                                                     | `'light' — Button hover states…` › `primary at 90% opacity over {page,card,dialog}`; the resting `--color-accent-fg on --color-accent` row still passes         |

- [ ] **2.9 Gates, then commit.**
  - `npx vitest run tests/unit/button-ssr.test.ts tests/unit/button-mount.svelte.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts tests/unit/timeline-entry-ssr.test.ts`: PASS.
  - `npx vitest run`: PASS, with two more files than after T1.
  - `npm run check`: 0 errors, 27 warnings (unchanged).
  - `npm run lint`: 0 errors, 115 warnings. Without the two disable comments it would be 118.
  - `npm run format:check`: clean.

  Commit: `feat(ui): add Button, IconButton and Toggle primitives`

### Task 3: the `Alert` primitive

One new component. It owns the banner's box, icon, headline and announcement rule, and reads every colour from T1's owner. It adds no contrast rows: T1's "every status tone is legible over the backdrops its element is drawn on" describe already reads `TONE_CLASSES.alert` and measures the headline, the icon, the body (`text-secondary`) and `text-primary` over card, page and dialog in both schemes. The lowest of those is 4.97:1 (the wrong headline on the page, in light).

**Files**

- Create: `src/lib/components/ui/Alert.svelte`, `tests/unit/helpers/AlertGallery.svelte`, `tests/unit/alert-ssr.test.ts` (node)

**Interfaces**

- Consumes: `type Tone` and `toneClass(tone, element)` from `$lib/utils/status-tone` (T1), using only the `"alert"` and `"text"` elements.
- Produces: `Alert.svelte`, whose full props are in 3.2: `tone: Tone`; `title: string` (the headline; a one-sentence message is a title and nothing else); `id?` (rendered as the first attribute); `live?: "assertive" | "off"` (default assertive for `wrong`, otherwise off); `tabindex?: -1`; `class?` (the call site owns outer margin); `children?` (the body); `action?`. Assertive is `role="alert"`, a neutral tone is `role="note"`, and the other tones carry no role: the caller's persistent `role="status"` wrapper announces them. `tabindex` is `-1` only, not `number`: Svelte warns `a11y_no_noninteractive_tabindex` on any non-static `tabindex` on a `<div>`, and the narrow type plus one `svelte-ignore` keeps `check` at 27. Alert has no element `ref`; every focus hand-off finds it by `[role="alert"]` or `id`, scoped to its form. Its DOM is the shape Task 8's `alertTitled` assumes:
  - a root `<div>`, with `id` as its first attribute;
  - its first element child is the `aria-hidden` icon `<svg>`;
  - then `<div class="min-w-0 flex-1">`, holding the title `<p>`, the optional body, then the optional action.

- [ ] **3.1 Failing tests.** Create `tests/unit/helpers/AlertGallery.svelte`. Its action is a `<button>`, not a link, so the fixture adds no `svelte/no-navigation-without-resolve` warning.

<!-- prettier-ignore -->
```svelte
<!--
  Every Alert tone, title-only and with a body and an action, for
  tests/unit/alert-ssr.test.ts: a real .svelte caller, so the body and the
  action are compiled snippets as a page's are, and axe sees all eight.
-->
<script lang="ts">
  import Alert from "$lib/components/ui/Alert.svelte";
  import type { Tone } from "$lib/utils/status-tone";

  const TONES: Tone[] = ["happened", "wrong", "needs-you", "neutral"];
</script>

{#each TONES as tone (tone)}
  <Alert {tone} title="Settings saved." />
  <Alert {tone} title="Verify your email to get reminders by email.">
    We sent a link to your address.
    {#snippet action()}
      <button type="submit">Resend</button>
    {/snippet}
  </Alert>
{/each}
```

Create `tests/unit/alert-ssr.test.ts`. Tone classes are read from `toneClass`, so T1's opacities are the single statement. The icon paths are pinned literally: they are the mockup's (`buttons-alerts.html`), copied exactly.

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// Alert: one box per tone with an aria-hidden icon and a headline, an
// optional body and action, no outer margin, and the announcement rule —
// errors interrupt, needs-you never claims role="alert".
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import { createRawSnippet, type ComponentProps } from "svelte";
import Alert from "$lib/components/ui/Alert.svelte";
import { toneClass, type Tone } from "$lib/utils/status-tone";
import AlertGallery from "./helpers/AlertGallery.svelte";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const TONES: Tone[] = ["happened", "wrong", "needs-you", "neutral"];
const snippet = (html: string) => createRawSnippet(() => ({ render: () => html }));

function renderAlert(props: ComponentProps<typeof Alert>): { html: string; box: Element } {
  const html = render(Alert, { props }).body;
  const box = ssrDocument(html).querySelector("main > div");
  expect(box, "no alert rendered").not.toBeNull();
  return { html, box: box! };
}

const tokens = (classes: string) => classes.split(/\s+/).filter(Boolean);

describe("Alert announces by tone", () => {
  const ROLE: Record<Tone, string | null> = {
    wrong: "alert",
    happened: null,
    "needs-you": null,
    neutral: "note",
  };
  for (const tone of TONES) {
    it(`gives ${tone} ${ROLE[tone] ? `role="${ROLE[tone]}"` : "no role"} by default`, () => {
      expect(renderAlert({ tone, title: "x" }).box.getAttribute("role")).toBe(ROLE[tone]);
    });
  }

  it("lets live override the default in both directions", () => {
    expect(renderAlert({ tone: "wrong", title: "x", live: "off" }).box.hasAttribute("role")).toBe(
      false,
    );
    expect(
      renderAlert({ tone: "happened", title: "x", live: "assertive" }).box.getAttribute("role"),
    ).toBe("alert");
    expect(
      renderAlert({ tone: "neutral", title: "x", live: "assertive" }).box.getAttribute("role"),
    ).toBe("alert");
  });

  it("never makes needs-you a role=alert unless the caller asks", () => {
    // MedicationForm's focus fallback looks for [role="alert"]; a warning
    // that claimed the role caught the focus meant for the real error.
    const { html } = renderAlert({ tone: "needs-you", title: "Possible interaction" });
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("aria-live");
  });
});

describe("Alert markup", () => {
  it("renders id as the first attribute, ahead of role", () => {
    const { html, box } = renderAlert({
      tone: "wrong",
      title: "Too many attempts",
      id: "form-error",
    });
    expect(box.getAttributeNames()[0]).toBe("id");
    expect(html).toMatch(/<div id="form-error"[^>]*role="alert"/);
  });

  for (const tone of TONES) {
    it(`draws the ${tone} box from toneClass(tone, "alert") and owns no outer margin`, () => {
      const { box } = renderAlert({ tone, title: "x" });
      expect(new Set(box.classList)).toEqual(
        new Set([
          ...tokens("flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm"),
          ...tokens(toneClass(tone, "alert")),
        ]),
      );
    });
  }

  it("appends the call site's class, which is where margin lives", () => {
    const { box } = renderAlert({ tone: "happened", title: "Saved.", class: "mt-4" });
    expect([...box.classList]).toContain("mt-4");
  });

  const GLYPHS: Record<Tone, { circles: number; paths: string[] }> = {
    happened: { circles: 0, paths: ["M20 6 9 17l-5-5"] },
    wrong: { circles: 1, paths: ["M12 8v5M12 16.5v.01"] },
    "needs-you": { circles: 0, paths: ["M12 3 2.5 20h19L12 3Z", "M12 10v4M12 17v.01"] },
    neutral: { circles: 1, paths: ["M12 11v5M12 8v.01"] },
  };
  for (const tone of TONES) {
    it(`gives ${tone} its own 18px aria-hidden icon in the tone's text colour`, () => {
      const svg = renderAlert({ tone, title: "x" }).box.firstElementChild;
      expect(svg?.tagName, "the icon is not the box's first child").toBe("svg");
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("width")).toBe("18");
      expect(svg!.getAttribute("height")).toBe("18");
      expect(svg!.getAttribute("viewBox")).toBe("0 0 24 24");
      expect(svg!.getAttribute("stroke-width")).toBe("2.2");
      expect([...svg!.classList]).toEqual(expect.arrayContaining(tokens(toneClass(tone, "text"))));
      expect(svg!.querySelectorAll("circle").length).toBe(GLYPHS[tone].circles);
      expect([...svg!.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual(
        GLYPHS[tone].paths,
      );
    });
  }

  for (const tone of TONES) {
    it(`sets the ${tone} headline in semibold ${tone === "neutral" ? "primary text" : "the tone's text colour"}`, () => {
      const { box } = renderAlert({ tone, title: "Couldn't save." });
      const headline = box.querySelector("p")!;
      expect(textOf(headline)).toBe("Couldn't save.");
      const expected = tone === "neutral" ? ["text-text-primary"] : tokens(toneClass(tone, "text"));
      expect([...headline.classList]).toEqual(
        expect.arrayContaining(["font-semibold", ...expected]),
      );
    });
  }

  it("is the headline and nothing else when given only a title", () => {
    const { box } = renderAlert({ tone: "happened", title: "Settings saved." });
    expect(textOf(box)).toBe("Settings saved.");
    expect(box.querySelectorAll("p")).toHaveLength(1);
    expect(box.querySelector(".text-\\[13px\\]")).toBeNull();
  });

  it("puts the body in 13px secondary text and the action after it", () => {
    const { box } = renderAlert({
      tone: "needs-you",
      title: "Verify your email.",
      children: snippet("<span>We sent a link.</span>"),
      action: snippet(`<a href="/settings/notifications">Resend</a>`),
    });
    const body = box.querySelector(".text-\\[13px\\]")!;
    expect([...body.classList]).toContain("text-text-secondary");
    expect(textOf(body)).toBe("We sent a link.");
    const link = box.querySelector("a")!;
    expect(textOf(link)).toBe("Resend");
    expect(body.compareDocumentPosition(link) & 4 /* FOLLOWING */).toBeTruthy();
    expect(body.contains(link)).toBe(false);
  });

  it("carries tabindex=-1 only when asked", () => {
    expect(renderAlert({ tone: "wrong", title: "x" }).box.hasAttribute("tabindex")).toBe(false);
    expect(
      renderAlert({ tone: "wrong", title: "x", tabindex: -1 }).box.getAttribute("tabindex"),
    ).toBe("-1");
  });
});

describe("every Alert in the gallery", () => {
  it("passes axe: aria-roles, aria-allowed-role, aria-hidden-focus, button-name", async () => {
    const doc = ssrDocument(render(AlertGallery).body);
    expect(doc.querySelectorAll("main > div")).toHaveLength(8);
    const rules = ["aria-roles", "aria-allowed-role", "aria-hidden-focus", "button-name"];
    const results = await runAxe(doc, rules);
    expect(results.violations).toEqual([]);
    const ran = evaluatedRules(results);
    for (const rule of rules) expect(ran, `${rule} evaluated nothing`).toContain(rule);
  });
});
```

The axe rule set is the set that actually evaluates on this markup. `aria-allowed-attr` and `aria-prohibited-attr` were tried and found nothing to check, so including them would be vacuous.

Run `npx vitest run tests/unit/alert-ssr.test.ts`. Expect FAIL: `Error: Cannot find module '$lib/components/ui/Alert.svelte' imported from …/tests/unit/alert-ssr.test.ts`.

- [ ] **3.2 Implement `src/lib/components/ui/Alert.svelte`.** Exact copy:
  - The `role` derivation and its comment, which carries the Global Constraint that a wrong Alert never sits inside a `role="status"` wrapper.
  - The attribute order: `{id}` first. With no spread on the root, Svelte emits attributes in template order.
  - The icon paths.
  - The two-line comment pair before the `<div>`. The explanation must be its own comment: ESLint's `svelte/no-unused-svelte-ignore` reads every word after the code as another code, which gave 9 errors when they shared one comment.

<!-- prettier-ignore -->
```svelte
<script lang="ts">
  import type { Snippet } from "svelte";
  import { toneClass, type Tone } from "$lib/utils/status-tone";

  let {
    tone,
    title,
    id,
    live,
    tabindex,
    class: className = "",
    children,
    action,
  }: {
    tone: Tone;
    /** The headline. A one-sentence message is a title and nothing else. */
    title: string;
    /** Rendered as the FIRST attribute: tests match `<div id="form-error" … role="alert">`. */
    id?: string;
    /** Errors interrupt; every other tone is polite. */
    live?: "assertive" | "off";
    /** -1 only: focusable by script (MedicationForm focuses its crash error), never by Tab. */
    tabindex?: -1;
    /** The call site owns outer margin; Alert has none. */
    class?: string;
    /** Optional body, in secondary text. */
    children?: Snippet;
    /** Optional action, e.g. the Resend form. */
    action?: Snippet;
  } = $props();

  // Assertive is role="alert". needs-you is never an alert: MedicationForm's
  // focus fallback looks for [role="alert"], and a warning must not catch it.
  // happened and needs-you are announced by the caller's persistent
  // role="status" wrapper, which exists before its content changes. A wrong
  // Alert must never sit inside that wrapper: it announces itself, and nested
  // in a polite region it is read twice.
  const role = $derived(
    (live ?? (tone === "wrong" ? "assertive" : "off")) === "assertive"
      ? "alert"
      : tone === "neutral"
        ? "note"
        : undefined,
  );
</script>

<!-- tabindex is typed -1: focusable by script, never a Tab stop. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  {id}
  class={[
    "flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm",
    toneClass(tone, "alert"),
    className,
  ]}
  {role}
  {tabindex}
>
  <svg
    class={["mt-px shrink-0", toneClass(tone, "text")]}
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {#if tone === "happened"}
      <path d="M20 6 9 17l-5-5" />
    {:else if tone === "wrong"}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    {:else if tone === "needs-you"}
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4M12 17v.01" />
    {:else}
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    {/if}
  </svg>
  <div class="min-w-0 flex-1">
    <p
      class={["font-semibold", tone === "neutral" ? "text-text-primary" : toneClass(tone, "text")]}
    >
      {title}
    </p>
    {#if children}
      <div class="text-text-secondary mt-0.5 text-[13px]">{@render children()}</div>
    {/if}
    {#if action}
      <div class="mt-2">{@render action()}</div>
    {/if}
  </div>
</div>
```

`<Alert tone="wrong" title="Too many attempts" id="form-error" />` renders exactly:
`<div id="form-error" class="flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm border border-danger-ink/35 bg-danger/10" role="alert"><svg class="mt-px shrink-0 text-danger-ink" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><!--[1--><circle cx="12" cy="12" r="9"></circle><path d="M12 8v5M12 16.5v.01"></path><!--]--></svg> <div class="min-w-0 flex-1"><p class="font-semibold text-danger-ink">Too many attempts</p> <!--[-1--><!--]--> <!--[-1--><!--]--></div></div>`

The title is a plain `{title}` expression inside the `<p>`, so it carries no hydration markers.

- [ ] **3.3 Run** `npx vitest run tests/unit/alert-ssr.test.ts`. Expect PASS, 24 tests.

- [ ] **3.4 Mutation proofs.** Each one was run.

  | Break this                                                                                    | Expect this to FAIL                                                                                  |
  | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | `tone === "wrong" ? "assertive"` → `tone === "wrong" \|\| tone === "needs-you" ? "assertive"` | `gives needs-you no role by default` and `never makes needs-you a role=alert unless the caller asks` |
  | `tone === "neutral" ? "note"` → `? undefined`                                                 | `gives neutral role="note" by default`                                                               |
  | Move `{id}` below `class={[…]}`                                                               | `renders id as the first attribute, ahead of role`                                                   |
  | Prepend `mb-3` to the box's literal                                                           | all four `draws the … box from toneClass(tone, "alert") and owns no outer margin`                    |
  | Swap the happened `<path d>` to the wrong glyph                                               | `gives happened its own 18px aria-hidden icon…`                                                      |
  | Drop `aria-hidden="true"` from the `<svg>`                                                    | the four icon tests, and the axe test (`aria-hidden-focus evaluated nothing`)                        |

- [ ] **3.5 Gates, then commit.**
  - `npx vitest run tests/unit/alert-ssr.test.ts`: PASS.
  - `npx vitest run`: PASS, with one more file.
  - `npm run check`: 0 errors, 27 warnings. Without the `svelte-ignore` it is 28, because Svelte warns on any non-static `tabindex` on a `<div>`.
  - `npm run lint`: 0 errors, 115 warnings.
  - `npm run format:check`: clean.
  - No `status-colour-owner` change: `Alert.svelte` writes no status literal of its own.

  Commit: `feat(ui): add the Alert primitive`

### Task 4: Dose statuses take one meaning each

Skipped is neutral everywhere, missed is red everywhere, overdue stays amber and taken stays green. Today the dashboard draws missed exactly like skipped (`status-marker-ssr.test.ts:73-74` pins that on purpose), the Log page draws skipped amber, Analytics draws skipped amber, and side-effect chips say how bad only through colour. This task moves every dose-status surface onto the owner from T1 and gives each coloured thing a word or a glyph.

Dose controls are fenced: `DoseActionForm`, the Log page's ✎ and ×, and DoneList's Edit and Remove change **colour classes only**. Their sizes, `type`, `aria-disabled` handling, forms and write paths stay byte-for-byte. The tests that pin them stay green unedited, except the one colour assertion at `dose-action-form.test.ts:167`.

**Comments count.** The T1 scan reads source text, including comments. No comment written in this task may spell a status class (`text-…`, `bg-…`, `border-…` followed by `warning`, `success`, `danger`, `danger-ink` or `info`), or the file will still match the scan and cannot leave `PENDING_MIGRATION`.

**Files:**

- Modify: `src/lib/components/dashboard/StatusMarker.svelte`
  - `:1-3`: import `toneClass`, `toneOf` from `$lib/utils/status-tone`;
  - `:9-16`: `RECIPES` reads the owner for the four tinted states;
  - `:58-70`: `missed` gets its own ✕ branch; `skipped` keeps the "–" line.
- Modify: `src/lib/components/dashboard/DueCard.svelte`
  - `:1-19`: the owner import;
  - `:45`: the overdue border comes from the owner, through T1's `border` element.
- Modify: `src/lib/components/dashboard/DoneList.svelte`
  - `:23-29`: the owner import;
  - `:53-81` (`view`): adds `statusClass`;
  - `:121-123`: the status word takes `v.statusClass`.
- Modify: `src/lib/components/TimelineEntry.svelte`
  - `:1-10`: imports (`SideEffect`, `StatusKey` types; `toneClass`, `toneOf`);
  - script: two lookup tables, `STATUS_CHIPS` and `SEVERITY`;
  - `:164-176`: the status chips;
  - `:186`: the relative time loses the accent;
  - `:240`: × loses its red hover;
  - `:258-268`: side-effect chips.
- Modify: `src/lib/components/dashboard/DoseActionForm.svelte:87` (the `danger` recipe only).
- Modify: `src/lib/components/StatusBreakdownBar.svelte`
  - `:1-17` (`<script module>`): imports the owner and exports `STATUS_BREAKDOWN_FILLS`;
  - `:43`, `:50`, `:57`, `:65`, `:69`, `:73`: the six fills.
- Modify: `src/lib/components/SideEffectPicker.svelte`
  - `:1-3`: imports;
  - `:54-58`: `severityOptions` gains `status`;
  - `:168-185`: the comment and the severity button's class. Nothing else in the file: its toggles and remove chips are T10's.
- Modify: `tests/unit/status-colour-owner.test.ts` (T1's scan): delete six entries from `PENDING_MIGRATION`:
  - `src/lib/components/dashboard/StatusMarker.svelte`
  - `src/lib/components/dashboard/DueCard.svelte`
  - `src/lib/components/TimelineEntry.svelte`
  - `src/lib/components/dashboard/DoseActionForm.svelte`
  - `src/lib/components/StatusBreakdownBar.svelte`
  - `src/lib/components/SideEffectPicker.svelte`

  `DoneList.svelte` has no status literal today, so it was never listed.

- Test: `tests/unit/status-marker-ssr.test.ts`:
  - `:9-17`: imports;
  - `:30`: the local `withoutComments` goes (the shared one replaces it);
  - `:20-27`: `SPEC`;
  - `:69-77`: the shape test;
  - one new `it`.
- Test: `tests/unit/done-list-ssr.test.ts`:
  - `:18-28`: imports;
  - `:179`: a rename;
  - two new `it`s.
- Test: `tests/unit/timeline-entry-ssr.test.ts`:
  - `:21`: imports;
  - `:41-77`: `makeDose` / `renderRow` take overrides;
  - a new `describe`, appended after `:298`.
- Test: `tests/unit/dose-action-form.test.ts:162-168`.
- Create: `tests/unit/status-breakdown-bar-ssr.test.ts`.
- Test: `tests/unit/accessible-pickers-ssr.test.ts`:
  - `:21-30`: imports;
  - two new `it`s inside `describe("SideEffectPicker")` (`:341-391`).
- **Not edited: `tests/unit/theme-tokens.test.ts`.**
  - T1's derived describe ("every status tone is legible over the backdrops its element is drawn on") already measures every pair this task paints, because it reads `TONE_CLASSES` rather than restating them:
    - chips over `card`, `cardHover` and `modalGlass`, which covers TimelineEntry's chips and SideEffectPicker's severity chips;
    - markers over `card`, which covers the missed ✕;
    - text over `cardHover`.

    DoneList's "Missed" word, danger-ink on the resting Done card, is in TEXT_TOKENS (`surfaces()` includes glass-on-surface).

  - The hand-written CHIPS rows (the "side effect severity: …" and "StatusMarker: …" rows, and the comment calling missed "untinted") stay as they are. They measure fixed token pairs, so they stay green. T13 Step 5 deletes that whole describe once T4 and T5 have landed.
  - `tests/unit/theme-tokens.test.ts` is still run below as a regression check.

- Test: `tests/e2e/analytics.test.ts:24-25`: two locators, kept at the same strength (e2e does not run in CI, but it must not go vacuous).

**Existing tests that pin markup in these files, and what happens to each:**

| File               | Test                                                                                                                                | Change                                                                                                                                                                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| StatusMarker       | `status-marker-ssr.test.ts:20-27` `SPEC`                                                                                            | `missed` moves from the neutral ring to the `wrong` marker. The four tinted states are read from the owner by **tone name**, so the test pins the decision (missed → `wrong`) and the owner's own test pins the class strings.                         |
| StatusMarker       | `status-marker-ssr.test.ts:69-77`                                                                                                   | Reversed on purpose. "A missed row is rendered exactly like a skip" becomes "all six shapes are distinct", plus a new test that missed is a two-stroke cross.                                                                                          |
| StatusMarker       | `status-marker-ssr.test.ts:79-85` (axe `aria-prohibited-attr`)                                                                      | Unchanged. It re-runs over the new glyph.                                                                                                                                                                                                              |
| StatusMarker       | `done-list-ssr.test.ts:134,169,181`, `due-card-ssr.test.ts`, `walkthrough-stage.svelte.test.ts`, `walkthrough-video.svelte.test.ts` | Read only `role="img"` and aria-labels. Unchanged.                                                                                                                                                                                                     |
| DueCard            | `due-card-ssr.test.ts:248-252` (`border-accent-ink/50`, `border-warning/50`)                                                        | **Unedited.** T1's needs-you `border` value is exactly `border-warning/50`, so it stays green. That is the look pin.                                                                                                                                   |
| DueCard            | `due-card-ssr.test.ts:312-325` (axe)                                                                                                | Unchanged.                                                                                                                                                                                                                                             |
| DoneList           | `done-list-ssr.test.ts:179-185` "renders a missed row the same way, with Missed"                                                    | Renamed to "renders a missed row with Missed and a Remove". Assertions kept; the colour moves to new tests.                                                                                                                                            |
| DoneList           | `done-list-ssr.test.ts:215-221` (axe)                                                                                               | Unchanged. It covers the new word class.                                                                                                                                                                                                               |
| DoneList           | `done-list-undo.test.ts`                                                                                                            | Behaviour only. Unchanged.                                                                                                                                                                                                                             |
| TimelineEntry      | `timeline-entry-ssr.test.ts:92-110` (no dimmed text)                                                                                | Unchanged. It now also covers the chips.                                                                                                                                                                                                               |
| TimelineEntry      | `timeline-entry-ssr.test.ts:112-118` (`textContent` contains "Skipped" / "Missed")                                                  | Unchanged. "– Skipped" still contains "Skipped". The new tests pin the exact chip text.                                                                                                                                                                |
| TimelineEntry      | `timeline-entry-ssr.test.ts:212-244` (sizes, positioning), `:262-297`                                                               | Unchanged. × and ✎ keep `size-8 pointer-coarse:size-11`.                                                                                                                                                                                               |
| TimelineEntry      | `timeline-entry-delete.test.ts`                                                                                                     | Behaviour only. Unchanged.                                                                                                                                                                                                                             |
| TimelineEntry      | `tests/e2e/analytics.test.ts:24-25` `text=/^Skipped$/`, `text=/^Missed$/` (count 0)                                                 | The chip's text is now "– Skipped" / "✕ Missed", so these locators would match nothing even if a skipped row appeared, and the test would go vacuous. Change them to `text=/^–\s?Skipped$/` and `text=/^✕\s?Missed$/`.                                 |
| DoseActionForm     | `dose-action-form.test.ts:167` `["min-h-11", "text-danger-ink"]`                                                                    | Becomes `["min-h-11", "text-text-secondary"]`, plus `not.toMatch(/danger/)` on the class string. `min-h-11` is untouched.                                                                                                                              |
| DoseActionForm     | `dose-edit-form-lock.test.ts:141-158`, `dose-action-form.test.ts:362-372` pass `variant: "danger"`                                  | Unchanged. The variant keeps its name: renaming it would touch `dashboard/+page.svelte:244` and both tests for no behavioural gain, and the fence asks for colour-only changes.                                                                        |
| StatusBreakdownBar | `walkthrough-demo-facts.test.ts:269-283` (the real bar against `AnalyticsScene`)                                                    | **Stays green unedited.** `STATUS_BREAKDOWN` has 0 skipped, so no neutral segment is drawn on either side. The taken fill (`bg-success`) and missed fill (`bg-danger`) and the legend text are unchanged. Task 12 moves the stage onto the same fills. |
| SideEffectPicker   | `accessible-pickers-ssr.test.ts:341-391`                                                                                            | Unchanged. The border test at `:378-391` excludes severity buttons by their `aria-label`.                                                                                                                                                              |
| SideEffectPicker   | `accessible-pickers-focus.svelte.test.ts`                                                                                           | Focus only. Unchanged.                                                                                                                                                                                                                                 |
| SideEffectPicker   | `theme-tokens.test.ts` hand-written rows `"side effect severity: severe"` / `"…: moderate"` / `"…: mild"`                           | Not edited. They measure fixed pairs and stay green. The recipes the picker now paints are measured by T1's derived chip rows over `modalGlass`. T13 Step 5 deletes the hand-written describe.                                                         |

**Interfaces:**

- **Consumes (T1):**
  - `toneOf(status: StatusKey): Tone`
  - `toneClass(tone: Tone, element: ToneElement): string`, including T1's sixth element, `"border"` (needs-you → `border-warning/50`)
  - `type StatusKey`
  - the `PENDING_MIGRATION` list in `tests/unit/status-colour-owner.test.ts`, whose entries are repo-relative paths
  - T1's derived contrast describe in `theme-tokens.test.ts`
- **Produces:**
  - `STATUS_BREAKDOWN_FILLS: { readonly taken: string; readonly skipped: string; readonly missed: string }`, exported from `StatusBreakdownBar.svelte`'s `<script module>` next to `statusBreakdownSegments` (which is unchanged). T12's `AnalyticsScene` reads it.
  - `StatusMarker` draws `missed` as a ✕ in the `wrong` marker. Every walkthrough stage part that mounts `StatusMarker` follows automatically.
  - `DoseActionForm`'s `variant="danger"` renders neutral.

---

- [ ] **Step 1: Write the failing marker and Done-list tests**

(a) `tests/unit/status-marker-ssr.test.ts`. Add `import { toneClass } from "$lib/utils/status-tone";` to the imports, and take `withoutComments` from the shared `./helpers/axe-ssr` import (Task 2) in place of the local copy at `:30`; that copy also trimmed, so its two callers, `outerTag` and `glyphOf`, read `withoutComments(html).trim()`. Replace `SPEC` (`:20-27`):

<!-- prettier-ignore -->
```ts
/** The marker label table. A new state fails the first test until it is added here.
 *  Tinted states name their TONE; the owner's own test pins the class strings. */
const SPEC: Record<StatusMarkerState, { label: string; classes: string[] }> = {
  taken: { label: "Taken", classes: toneClass("happened", "marker").split(" ") },
  overdue: { label: "Overdue", classes: toneClass("needs-you", "marker").split(" ") },
  "due-now": { label: "Due now", classes: ["ring-2", "ring-accent-ink"] },
  upcoming: { label: "Upcoming", classes: ["border", "border-border-strong"] },
  skipped: { label: "Skipped", classes: toneClass("neutral", "marker").split(" ") },
  missed: { label: "Missed", classes: toneClass("wrong", "marker").split(" ") },
};
```

Replace the body of `"gives every state its own shape, so status never rests on colour alone"` (`:69-77`). Add the cross test after it:

<!-- prettier-ignore -->
```ts
  it("gives every state its own shape, so status never rests on colour alone", () => {
    const glyphs = new Map(STATUS_MARKER_STATES.map((s) => [s, glyphOf(renderMarker(s))]));
    // Missed used to share the skip's dash. A skip is a decision; a missed
    // dose is something that went wrong, and it now looks it.
    expect(new Set(glyphs.values()).size).toBe(STATUS_MARKER_STATES.length);
    expect(glyphs.get("due-now")).toContain("bg-accent-ink");
    expect(glyphs.get("upcoming")).toBe("");
  });

  it("draws missed as a two-stroke cross and skipped as a single dash", () => {
    const strokes = (s: StatusMarkerState) => (glyphOf(renderMarker(s)).match(/<line\b/g) ?? []).length;
    expect(strokes("missed")).toBe(2);
    expect(strokes("skipped")).toBe(1);
  });
```

(b) `tests/unit/done-list-ssr.test.ts`. Add `import { toneClass } from "$lib/utils/status-tone";`. Rename `:179`'s title to `"renders a missed row with Missed and a Remove"`; its assertions stay. Append inside `describe("DoneList")`, before the axe test:

<!-- prettier-ignore -->
```ts
  /** The status word beside the dose text ("Skipped" or "Missed"). */
  const statusWord = (li: Element, word: string) =>
    [...li.querySelectorAll("p span")].find((s) => textOf(s) === word)!;

  it("draws a missed row red: the wrong-tone marker and the word Missed", () => {
    const li = items(renderList(ROWS))[2];
    const marker = li.querySelector('[role="img"]')!;
    expect([...marker.classList]).toEqual(
      expect.arrayContaining(toneClass("wrong", "marker").split(" ")),
    );
    expect([...statusWord(li, "Missed").classList]).toEqual(
      expect.arrayContaining(toneClass("wrong", "text").split(" ")),
    );
  });

  it("keeps a skipped row's word neutral, so skipped and missed no longer look alike", () => {
    const word = statusWord(items(renderList(ROWS))[1], "Skipped");
    expect([...word.classList]).toEqual(
      expect.arrayContaining(toneClass("neutral", "text").split(" ")),
    );
    expect(word.className).not.toMatch(/danger/);
  });
```

These tests read the DOM through `ssrDocument` and `textOf`, and DOM text ignores Svelte's `<!--…-->` hydration markers. The one raw-HTML reader here, `status-marker-ssr.test.ts`'s `glyphOf`, strips them through the shared `withoutComments`.

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/status-marker-ssr.test.ts tests/unit/done-list-ssr.test.ts`

Expected, 4 failures:

- `draws the missed marker with its colour and ring classes from the table`: `expected [ 'inline-flex', …, 'border-border-strong', 'text-text-secondary' ] to deeply equal ArrayContaining […, 'bg-danger/20', 'text-danger-ink']`;
- `gives every state its own shape…`: `expected 5 to be 6`;
- `draws missed as a two-stroke cross…`: `expected 1 to be 2`;
- `draws a missed row red…`: fails on the marker's classes first.

- [ ] **Step 3: Implement StatusMarker, DoneList and DueCard**

`StatusMarker.svelte`:

- `RECIPES` (`:9-16`) becomes:
  - `taken: toneClass(toneOf("dose-taken"), "marker")`
  - `overdue: toneClass(toneOf("dose-overdue"), "marker")`
  - `skipped: toneClass(toneOf("dose-skipped"), "marker")`
  - `missed: toneClass(toneOf("dose-missed"), "marker")`

  `"due-now"` and `upcoming` keep their literal rings. The comment above it becomes: "Shape first, colour as reinforcement. The four statuses take the owner's marker recipe; due-now and upcoming are not statuses and keep their rings."

- The `{:else if marker === "skipped" || marker === "missed"}` branch (`:58`) splits:
  - `skipped` keeps the existing single `<line x1="3" y1="6" x2="9" y2="6" />`.
  - A new `{:else if marker === "missed"}` draws the same `svg` (`class="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"`) with `<line x1="3.5" y1="3.5" x2="8.5" y2="8.5" />` and `<line x1="8.5" y1="3.5" x2="3.5" y2="8.5" />`.

`DoneList.svelte`:

- In `view()`, add `statusClass: toneClass(toneOf(dose.status === "missed" ? "dose-missed" : "dose-skipped"), "text")`.
- `:122` becomes `<span class="shrink-0 {v.statusClass}">{v.statusWord}</span>`.

The Edit button, the `DoseActionForm` call and the row layout are fenced and unchanged.

`DueCard.svelte:45`: `const border = $derived(top.state === "due-now" ? "border-accent-ink/50" : toneClass(toneOf("dose-overdue"), "border"));`.

- `toneOf("dose-overdue")` is `"needs-you"`, so this is `toneClass("needs-you", "border")` asked through the status key, the way every component asks.
- It renders `border-warning/50`, unchanged.
- The due-now accent stays a literal: accent is not a status colour.

- [ ] **Step 4: Run the scan, expect the stale-entry FAIL**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL on assertion (2), the stale-entry check, naming `src/lib/components/dashboard/StatusMarker.svelte` and `src/lib/components/dashboard/DueCard.svelte`. Delete both from `PENDING_MIGRATION`.

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run tests/unit/status-marker-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/due-card-ssr.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-stage.svelte.test.ts`

Expected: PASS. `due-card-ssr.test.ts:248-252` passes unedited.

**Mutation proofs:**

- Set `RECIPES.missed` back to the skipped recipe: `draws the missed marker…` fails.
- Render `missed` through the dash branch: both shape tests fail.
- Make `statusClass` always use `"dose-skipped"`: `draws a missed row red…` fails.
- Make the DueCard overdue border `toneClass(…, "alert")`: `due-card-ssr.test.ts:251` fails.

- [ ] **Step 6: Commit**

`git commit -m "feat(dashboard): draw a missed dose red with a cross, from the status-tone owner"`

---

- [ ] **Step 7: Write the failing Log-row tests**

`tests/unit/timeline-entry-ssr.test.ts`:

- Add these imports:

<!-- prettier-ignore -->
```ts
import { toneClass } from "$lib/utils/status-tone";
import { accessibleName, textOf } from "./helpers/dom-names";
```

- `makeDose(status)` becomes `makeDose(status, overrides: Partial<DoseLogWithMedication> = {})`, spreading `...overrides` last.
- `renderRow(status)` becomes `renderRow(status, overrides = {})` and passes them through. Every existing call keeps working.
- Append:

<!-- prettier-ignore -->
```ts
describe("status and severity chips say what they mean in words, coloured by the status owner", () => {
  const chipNamed = (doc: Document, name: string) =>
    [...doc.querySelectorAll('[role="listitem"] span')].find((s) => accessibleName(s) === name);
  const has = (el: Element, recipe: string) =>
    expect(tokens(el)).toEqual(expect.arrayContaining(recipe.split(" ")));

  it("draws a skipped dose as a neutral '– Skipped' chip, with the dash hidden from screen readers", () => {
    const chip = chipNamed(renderRow("skipped"), "Skipped");
    expect(chip, "no Skipped chip").toBeDefined();
    expect(textOf(chip!)).toBe("– Skipped");
    expect(chip!.querySelector('[aria-hidden="true"]')?.textContent).toBe("–");
    has(chip!, toneClass("neutral", "chip"));
    expect(tokens(chip!)).not.toContain("uppercase");
  });

  it("draws a missed dose as a red '✕ Missed' chip", () => {
    const chip = chipNamed(renderRow("missed"), "Missed");
    expect(chip, "no Missed chip").toBeDefined();
    expect(textOf(chip!)).toBe("✕ Missed");
    expect(chip!.querySelector('[aria-hidden="true"]')?.textContent).toBe("✕");
    has(chip!, toneClass("wrong", "chip"));
  });

  it("names each side effect's severity in words: mild and moderate neutral, severe red", () => {
    const doc = renderRow("taken", {
      sideEffects: [
        { name: "Nausea", severity: "mild" },
        { name: "Dizziness", severity: "moderate" },
        { name: "Headache", severity: "severe" },
      ],
    });
    const chips = [...doc.querySelectorAll('[role="listitem"] span')].filter((s) =>
      / · (Mild|Moderate|Severe)$/.test(textOf(s)),
    );
    expect(chips.map(textOf)).toEqual(["Nausea · Mild", "Dizziness · Moderate", "Headache · Severe"]);
    has(chips[0], toneClass("neutral", "chip"));
    has(chips[1], toneClass("neutral", "chip"));
    has(chips[2], toneClass("wrong", "chip"));
    expect(chips[1].className).not.toMatch(/warning/);
  });

  it("prints the relative time since in neutral text, not the accent", () => {
    const since = renderRow("taken").querySelector('[role="listitem"] time')!.parentElement!;
    expect(tokens(since)).toContain("text-text-secondary");
    expect(tokens(since)).not.toContain("text-accent-ink");
  });

  it("gives × a neutral hover: removing a dose is undoable, so it is not red", () => {
    const x = renderRow("taken").querySelector('button[aria-label^="Delete dose of"]')!;
    expect(tokens(x)).toContain("hover:text-text-primary");
    expect(x.getAttribute("class")).not.toMatch(/danger/);
  });
});
```

Then, in `tests/e2e/analytics.test.ts:24-25`, change the two locators to `page.locator("text=/^–\\s?Skipped$/")` and `page.locator("text=/^✕\\s?Missed$/")`. The comment above them becomes "The Skipped/Missed chips…".

- [ ] **Step 8: Run, expect FAIL**

Run: `npx vitest run tests/unit/timeline-entry-ssr.test.ts`

Expected, 5 failures:

- `draws a skipped dose…`: `expected 'Skipped' to be '– Skipped'`;
- `draws a missed dose…`: `expected 'Missed' to be '✕ Missed'`;
- `names each side effect's severity…`: `expected [] to deeply equal [ 'Nausea · Mild', … ]`;
- `prints the relative time…`: `expected [ 'text-accent-ink', 'font-medium' ] to include 'text-text-secondary'`;
- `gives × a neutral hover…`: `expected [ …, 'hover:text-danger-ink', … ] to include 'hover:text-text-primary'`.

- [ ] **Step 9: Implement TimelineEntry**

In the script, below the imports:

<!-- prettier-ignore -->
```ts
  // Each coloured chip also says what it is: a glyph (hidden from screen
  // readers, which get the word) and the word itself.
  const STATUS_CHIPS: Record<"skipped" | "missed", { glyph: string; word: string; status: StatusKey }> = {
    skipped: { glyph: "–", word: "Skipped", status: "dose-skipped" },
    missed: { glyph: "✕", word: "Missed", status: "dose-missed" },
  };
  const SEVERITY: Record<SideEffect["severity"], { word: string; status: StatusKey }> = {
    mild: { word: "Mild", status: "side-effect-mild" },
    moderate: { word: "Moderate", status: "side-effect-moderate" },
    severe: { word: "Severe", status: "side-effect-severe" },
  };
```

**Markup:**

- **`:164-176`** collapses to one branch:
  - `{#if dose.status === "skipped" || dose.status === "missed"}{@const chip = STATUS_CHIPS[dose.status]}`
  - then `<span class="ml-2 rounded-md px-2 py-0.5 text-xs font-semibold {toneClass(toneOf(chip.status), 'chip')}"><span aria-hidden="true">{chip.glyph}</span> {chip.word}</span>`
  - The literal space between the glyph span and the word is what makes `textOf` read "– Skipped". `uppercase` and `tracking-wider` go: the mockup's chips are sentence case, 6px radius and weight 600.
- **`:186`**: `text-accent-ink` becomes `text-text-secondary`. `font-medium` stays.
- **`:240`**: `hover:text-danger-ink` becomes `hover:text-text-primary`. Every other token on × is unchanged.
- **`:259-267`**: the side-effect span becomes `<span class="rounded-md px-2 py-0.5 text-xs font-semibold {toneClass(toneOf(SEVERITY[effect.severity].status), 'chip')}">{effect.name} · {SEVERITY[effect.severity].word}</span>`. The `·` is U+00B7 with a space each side.

- [ ] **Step 10: Run the scan, expect the stale-entry FAIL, then remove the entry**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/TimelineEntry.svelte`. Delete it from `PENDING_MIGRATION`.

- [ ] **Step 11: Run, expect PASS**

Run: `npx vitest run tests/unit/timeline-entry-ssr.test.ts tests/unit/timeline-entry-delete.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS. Every pre-existing test in both files passes unedited.

**Mutation proofs:**

- Map `SEVERITY.severe.status` to `"side-effect-moderate"`: the severity test fails.
- Drop `aria-hidden` from the glyph span: both chip tests fail. `chipNamed` finds no span named "Skipped", because its accessible name becomes "– Skipped".
- Put `text-accent-ink` back on the relative time: its test fails.

- [ ] **Step 12: Commit**

`git commit -m "feat(log): neutral skipped, red missed and severity words on log rows"`

---

- [ ] **Step 13: Write the failing DoseActionForm assertion**

`tests/unit/dose-action-form.test.ts:166-167`. The `danger` lines of `"gives chip and danger their own fixed-height recipes"` become:

<!-- prettier-ignore -->
```ts
    const danger = setup({ props: { variant: "danger" } }).button;
    // Removing a dose is undoable (the Undo offer and the trash), so the one
    // `danger` caller, the edit dialog's Remove this dose, is neutral.
    expect([...danger.classList]).toEqual(expect.arrayContaining(["min-h-11", "text-text-secondary"]));
    expect(danger.className).not.toMatch(/danger/);
```

- [ ] **Step 14: Run, expect FAIL**

Run: `npx vitest run tests/unit/dose-action-form.test.ts`

Expected: FAIL in `gives chip and danger their own fixed-height recipes`: `expected [ …, 'text-danger-ink', … ] to deeply equal ArrayContaining [ 'min-h-11', 'text-text-secondary' ]`.

- [ ] **Step 15: Implement**

Only the `danger` string in `DoseActionForm.svelte` (`:87`) changes, to `"min-h-11 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-overlay hover:text-text-primary"`. `min-h-11`, the button's markup, `aria-disabled`, the grid-cell pending label and the write path are untouched.

The variant keeps its name (see the table above). Any comment added here must not spell the old class.

- [ ] **Step 16: Run the scan, remove the entry, run PASS**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/dashboard/DoseActionForm.svelte`. Delete it from `PENDING_MIGRATION`.

Run: `npx vitest run tests/unit/dose-action-form.test.ts tests/unit/dose-edit-form-lock.test.ts tests/unit/dashboard-remove-undo.test.ts tests/unit/dashboard-remove-focus.svelte.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS.

**Mutation proof:** restore `text-danger-ink` in the recipe, and the updated assertion fails.

- [ ] **Step 17: Commit**

`git commit -m "fix(dashboard): removing a dose is undoable, so Remove this dose is neutral"`

---

- [ ] **Step 18: Write the failing breakdown-bar tests**

Create `tests/unit/status-breakdown-bar-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import StatusBreakdownBar, {
  STATUS_BREAKDOWN_FILLS,
  statusBreakdownSegments,
} from "$lib/components/StatusBreakdownBar.svelte";
import { toneClass } from "$lib/utils/status-tone";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

// 6 / 3 / 1 of 10: whole percentages, so the split needs no tolerance.
const COUNTS = { takenEvents: 6, skippedEvents: 3, missedEvents: 1, expectedTotal: 10 };
const fill = (el: Element) => [...el.classList].find((c) => c.startsWith("bg-"));

function card() {
  const doc = ssrDocument(render(StatusBreakdownBar, { props: COUNTS }).body);
  const [bar, legend] = doc.querySelector("h2")!.nextElementSibling!.children;
  return { bar, legend };
}

describe("StatusBreakdownBar", () => {
  it("takes its fills from the status owner: taken happened, skipped neutral, missed wrong", () => {
    expect(STATUS_BREAKDOWN_FILLS).toEqual({
      taken: toneClass("happened", "bar"),
      skipped: toneClass("neutral", "bar"),
      missed: toneClass("wrong", "bar"),
    });
  });

  it("draws the bar's segments in taken, skipped, missed order with those fills", () => {
    const { bar } = card();
    expect([...bar.children].map(fill)).toEqual([
      STATUS_BREAKDOWN_FILLS.taken,
      STATUS_BREAKDOWN_FILLS.skipped,
      STATUS_BREAKDOWN_FILLS.missed,
    ]);
    expect([...bar.children].map((el) => (el as HTMLElement).style.width)).toEqual(["60%", "30%", "10%"]);
  });

  it("gives the legend's dots the same fills and keeps its words", () => {
    const { legend } = card();
    const dots = [...legend.querySelectorAll('[aria-hidden="true"]')].map(fill);
    expect(dots).toEqual([STATUS_BREAKDOWN_FILLS.taken, STATUS_BREAKDOWN_FILLS.skipped, STATUS_BREAKDOWN_FILLS.missed]);
    expect([...legend.children].map(textOf)).toEqual(["Taken 6", "Skipped 3", "Missed 1", "10 expected"]);
  });

  it("splits the bar exactly as before", () => {
    expect(statusBreakdownSegments(COUNTS)).toEqual({ takenPct: 60, skippedPct: 30, missedPct: 10 });
  });
});
```

- [ ] **Step 19: Run, expect FAIL**

Run: `npx vitest run tests/unit/status-breakdown-bar-ssr.test.ts`

Expected: FAIL. `STATUS_BREAKDOWN_FILLS` is not exported yet.

- Under vite's transform the import is `undefined`, so the first test reports `expected undefined to deeply equal { taken: 'bg-success', … }` and the segment and legend tests throw reading `.taken`.
- If the transform instead rejects the missing export, the whole file fails to load. Either is the red phase.
- `splits the bar exactly as before` is the one test that may pass now. It pins existing behaviour, so it is not the red phase.

- [ ] **Step 20: Implement**

In `StatusBreakdownBar.svelte`'s `<script module>`, add `import { toneClass, toneOf } from "$lib/utils/status-tone";` and:

<!-- prettier-ignore -->
```ts
  // The segment and legend fills, exported for the same reason as the split:
  // the walkthrough draws this bar without mounting it.
  export const STATUS_BREAKDOWN_FILLS = {
    taken: toneClass(toneOf("dose-taken"), "bar"),
    skipped: toneClass(toneOf("dose-skipped"), "bar"),
    missed: toneClass(toneOf("dose-missed"), "bar"),
  } as const;
```

The three segments become `class="h-full {STATUS_BREAKDOWN_FILLS.taken}"` (and the same for `skipped` and `missed`). The three legend dots become `class="inline-block h-2 w-2 rounded-full {STATUS_BREAKDOWN_FILLS.…}"`.

The DOM shape, the `title` attributes, the legend's text and `statusBreakdownSegments` are unchanged. `walkthrough-demo-facts.test.ts`'s `breakdownOf` walks exactly that shape.

- [ ] **Step 21: Run the scan, remove the entry, run PASS**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/StatusBreakdownBar.svelte`. Delete it from `PENDING_MIGRATION`.

Run: `npx vitest run tests/unit/status-breakdown-bar-ssr.test.ts tests/unit/walkthrough-demo-facts.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS. `draws the bar and legend the real StatusBreakdownBar draws for the same counts` passes unedited.

**Mutation proofs:**

- Set `skipped` to `toneOf("dose-overdue")`: the first two tests fail.
- Change the split's rounding: the last test fails.

- [ ] **Step 22: Commit**

`git commit -m "feat(analytics): skipped doses take the neutral bar segment"`

---

- [ ] **Step 23: Write the failing severity-picker tests**

`tests/unit/accessible-pickers-ssr.test.ts`. Add `import { toneClass } from "$lib/utils/status-tone";`. Append inside `describe("SideEffectPicker")`:

<!-- prettier-ignore -->
```ts
  const graded = renderSideEffects([
    { name: "Nausea", severity: "mild" },
    { name: "Rash", severity: "moderate" },
    { name: "Headache", severity: "severe" },
  ]);
  const pressedFor = (name: string) =>
    graded.querySelector<HTMLButtonElement>(
      `button[aria-label$="severity for ${name}"][aria-pressed="true"]`,
    )!;

  it("colours a chosen severity by the status table: mild and moderate neutral, severe red", () => {
    const neutral = toneClass("neutral", "chip").split(" ");
    expect(pressedFor("Nausea").textContent!.trim()).toBe("Mild");
    expect([...pressedFor("Nausea").classList]).toEqual(expect.arrayContaining(neutral));
    expect(pressedFor("Rash").textContent!.trim()).toBe("Mod");
    expect([...pressedFor("Rash").classList]).toEqual(expect.arrayContaining(neutral));
    expect(pressedFor("Headache").textContent!.trim()).toBe("Severe");
    expect([...pressedFor("Headache").classList]).toEqual(
      expect.arrayContaining(toneClass("wrong", "chip").split(" ")),
    );
    // Moderate used to be amber. Nothing in the picker is amber now.
    expect(graded.body.innerHTML).not.toMatch(/\b(?:text|bg|border)-warning\b/);
  });

  it("keeps an unchosen severity the chosen one's width: a transparent border, no status colour", () => {
    const unpressed = [
      ...graded.querySelectorAll('button[aria-label*="severity for"][aria-pressed="false"]'),
    ];
    expect(unpressed).toHaveLength(6);
    for (const button of unpressed) {
      expect([...button.classList]).toEqual(expect.arrayContaining(["border", "border-transparent"]));
      expect(button.className, button.outerHTML).not.toMatch(/warning|danger|success/);
    }
  });
```

No contrast row is added. T1's derived describe already measures the wrong and neutral chips over `modalGlass`, the backdrop this picker paints on: 5.45 and 8.75 in dark, 5.15 and 8.33 in light. The old hand-written "side effect severity" rows stay until T13 Step 5.

- [ ] **Step 24: Run, expect FAIL**

Run: `npx vitest run tests/unit/accessible-pickers-ssr.test.ts`

Expected, 2 failures:

- `colours a chosen severity…`: `expected [ …, 'bg-text-secondary/30', 'text-text-primary' ] to deeply equal ArrayContaining [ 'border', 'border-border-strong', 'text-text-secondary' ]`;
- `keeps an unchosen severity…`: `expected [ …, 'text-text-muted', … ] to deeply equal ArrayContaining [ 'border', 'border-transparent' ]`.

- [ ] **Step 25: Implement**

`SideEffectPicker.svelte`:

- Add `import { toneClass, toneOf, type StatusKey } from "$lib/utils/status-tone";`.
- `severityOptions` (`:54-58`) becomes `Array<{ value: SideEffect["severity"]; label: string; status: StatusKey }>`, with `status` set to `"side-effect-mild"`, `"side-effect-moderate"` and `"side-effect-severe"`. The labels stay "Mild", "Mod" and "Severe": this task changes colours only.
- The severity button's class (`:178-185`) becomes `"min-h-6 rounded-xs border px-2 py-0.5 text-xs font-medium transition-colors {effect.severity === opt.value ? toneClass(toneOf(opt.status), 'chip') : 'border-transparent text-text-muted hover:text-text-secondary'}"`. The transparent border keeps an unchosen button the same width as a chosen one, so choosing a severity does not shift the row.
- Rewrite the comment at `:168-172` to say what is now true. Mild and moderate share the neutral look and differ only by their word; severe is red; a chosen severity is bordered. `aria-pressed` is still the only programmatic state, which is why it stays. Do not spell a status class in it.
- The common-effect toggles (`:98-107`), the custom remove chips (`:118-129`) and Add (`:147-154`) are T10's and are not touched.

- [ ] **Step 26: Run the scan, remove the entry, run PASS**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/SideEffectPicker.svelte`. Delete it from `PENDING_MIGRATION`.

Run: `npx vitest run tests/unit/accessible-pickers-ssr.test.ts tests/unit/accessible-pickers-focus.svelte.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS, both themes. `theme-tokens.test.ts` is unedited.

**Mutation proofs:**

- Map moderate's `status` to `"needs-you"` (a StatusKey whose tone is needs-you): the first test fails, both on Rash's neutral classes and on the amber regex.
- Drop `border-transparent`: the second test fails.

- [ ] **Step 27: Commit**

`git commit -m "feat(side-effects): the severity picker follows the status colours"`

- [ ] **Step 28: Task gates**

Run each in turn:

1. `npx vitest run tests/unit/status-marker-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/due-card-ssr.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/dose-action-form.test.ts tests/unit/status-breakdown-bar-ssr.test.ts tests/unit/accessible-pickers-ssr.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts`
2. `npx vitest run`
3. `npm run check`
4. `npm run lint`
5. `npm run format:check`

Expected:

- vitest: 0 failed, both runs;
- check: 0 errors, warnings ≤ 27;
- lint: 0 errors, warnings ≤ 115;
- prettier: clean.

`git grep -nE "\b(text|bg|border|ring)-(warning|success|danger|danger-ink|info)(/[0-9]+)?\b" -- src/lib/components/dashboard/StatusMarker.svelte src/lib/components/dashboard/DueCard.svelte src/lib/components/dashboard/DoneList.svelte src/lib/components/TimelineEntry.svelte src/lib/components/dashboard/DoseActionForm.svelte src/lib/components/StatusBreakdownBar.svelte src/lib/components/SideEffectPicker.svelte` prints nothing.

### Task 5: Refills and stock read "Reorder soon", by one rule

Today "running low" has three rules on one medications card:

- a red or amber "Nd left" chip, copied from RefillsCard as `refillChipClass` (`MedicationCard.svelte:24-29`);
- a hard-coded `daysUntilRefill <= 7` amber stats line (`:185`);
- a separate "Low: N" chip (`:167-171`).

The 8–14 day "watch" tier uses `info`, which looks like the accent.

After this task:

- `critical` and `warning` are amber and read "Reorder soon · N days left". Nothing has gone wrong yet; you need to reorder.
- `watch` is neutral and reads "N days left".
- Stock at or below the user's own `inventoryAlertThreshold` is the **same** amber chip, not a second one.
- The card's stats row keeps its days of supply, `~Nd supply left`, now neutral: it loses only its amber and its hard-coded `<= 7` rule.
- One pure function, `refillChip`, decides the chip. It lives with RefillsCard's other exported rules, so the dashboard, the medications card and (in Task 12) the walkthrough all read one rule.
- The words "Reorder soon" are one constant, `REORDER_SOON` in `src/lib/utils/dashboard-copy.ts`, which `refillChip` and Task 6's refill insight both read.

`classifyRefillSeverity` and `REFILL_THRESHOLDS` (`src/lib/server/inventory.ts:14-26`) are unchanged.

**Files:**

- Modify: `src/lib/components/RefillsCard.svelte`:
  - `<script module>` `:1-27`: imports the owner and `REORDER_SOON`; `refillSeverityClass` and `refillSeverityLabel` go through the owner; `refillDaysLabel` is unchanged; adds `refillDosesLabel`, `RefillChipInput`, `RefillChip` and `refillChip`;
  - `:43-60`: each row's label words come from `refillChip`.
- Modify: `src/lib/utils/dashboard-copy.ts`: adds `REORDER_SOON`.
- Modify: `src/lib/components/MedicationCard.svelte`:
  - imports;
  - delete `refillChipClass` (`:24-29`);
  - replace the `refillChip` / `lowStockChip` deriveds (`:49-57`) with one `chip`;
  - `:149-173`: one chip;
  - `:184-188`: the stats line loses its amber ternary.
- Modify: `src/routes/(app)/medications/[id]/+page.svelte`:
  - imports (`:1-10`);
  - the ±N span (`:193-199`) only.

  Its banners (`:66-90`), Adjust (`:170-175`) and Archive (`:239-245`) are Task 10's. **This file stays in `PENDING_MIGRATION`.**

- Modify: `tests/unit/status-colour-owner.test.ts`: delete `src/lib/components/RefillsCard.svelte` and `src/lib/components/MedicationCard.svelte` from `PENDING_MIGRATION`.
- Create: `tests/unit/refills-card-ssr.test.ts`. No test covers RefillsCard today.
- Create: `tests/unit/medication-card-stock-ssr.test.ts`.
- Create: `tests/unit/medication-inventory-history-ssr.test.ts`. Task 10 extends it for that page's banners and buttons.
- Test: `tests/unit/medication-card-targets-ssr.test.ts`: the comment at `:30` and the assertion at `:173`.
- **Not edited: `tests/unit/theme-tokens.test.ts`.**
  - T1's derived describe measures what this task paints:
    - the needs-you and neutral chips over `card` / `cardHover`, which is the MedicationCard chip;
    - the needs-you alert box over the page `surface`, with its text ink, which is the amber RefillsCard row and its `text-warning` label.

    The glass neutral row is TEXT_TOKENS' glass-on-surface.

  - The six hand-written "medications refill chip …" rows stay: T13 Step 3 deletes the two `--color-info` ones while retiring the token, and Step 5 deletes the rest.

**Existing tests that pin markup in these files, and what happens to each:**

| File             | Test                                                                                                                                                                            | Change                                                                                                                                                                                                                                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RefillsCard      | none in `tests/unit`. `walkthrough-demo-facts.test.ts:335-347` ("the Refills card and the refill badge") reads only the `severity` data, never classes or words                 | Unchanged and green. `StageRefills` follows through the exports: its one `watch` row (8 days) turns from the info tint to `bg-glass` + secondary text, with the same words.                                                                                                                                                          |
| MedicationCard   | `medication-card-targets-ssr.test.ts:164-175` ("sits in the flow beside the card's link…") checks `html.indexOf("3d left") < linkEnd`                                           | "3d left" no longer exists, so `indexOf` returns -1 and the check would pass **vacuously**. It becomes `const chipAt = html.indexOf("Reorder soon · 3 days left"); expect(chipAt).toBeGreaterThan(-1); expect(chipAt).toBeLessThan(linkEnd);`. The comment at `:30` becomes `("Muted" and a critical "Reorder soon · 3 days left")`. |
| MedicationCard   | `medication-card-targets-ssr.test.ts`, the rest (Log button form, size, border, `role="status"`, h1)                                                                            | Unchanged.                                                                                                                                                                                                                                                                                                                           |
| MedicationCard   | `medication-card-targets-dom.test.ts` (Log behaviour, the name column's shrink chain at `:240-265`), `medication-card-focus.svelte.test.ts`, `medications-reorder-lock.test.ts` | Unchanged. The chip is not in the name's ancestor chain.                                                                                                                                                                                                                                                                             |
| MedicationCard   | `theme-tokens.test.ts` CHIPS rows "medications refill chip (watch / warning / critical)" + "…hovered" over `card` / `cardHover`                                                 | Not edited. They measure fixed token pairs and stay green. T13 deletes them (Steps 3 and 5).                                                                                                                                                                                                                                         |
| medications/[id] | `inventory-event-types.test.ts` (the `EVENT_LABELS` source block), `time.test.ts:202` (a comment), `app-action-auth-guard.test.ts` (the actions)                                | Unchanged.                                                                                                                                                                                                                                                                                                                           |

**Interfaces:**

- **Consumes (T1):**
  - `toneOf`
  - `toneClass`
  - `refillStatus(severity: RefillSeverity): StatusKey`
  - `type Tone`
  - the scan test's `PENDING_MIGRATION`
- **Produces**, from `src/lib/utils/dashboard-copy.ts` (Task 6's `buildInsights` imports it too; that module is client-reachable and imports only `./time` and types, so server code may read it):

<!-- prettier-ignore -->
```ts
/** The words for a refill that needs you: RefillsCard's rows and the medications card's chip (both through refillChip) and the refill insight's lead (buildInsights). */
export const REORDER_SOON = "Reorder soon";
```

- **Produces**, from `RefillsCard.svelte`'s `<script module>` (the dashboard renders the card; Task 12's `MedicationsScene` and `StageRefills` import these):

<!-- prettier-ignore -->
```ts
export function refillSeverityClass(severity: RefillSeverity): string; // the row box
export function refillSeverityLabel(severity: RefillSeverity): string; // the label's text colour
export function refillDaysLabel(days: number | null): string;          // unchanged
export function refillDosesLabel(count: number): string;              // <=0 "None left", 1 "1 dose left", n "n doses left"
export type RefillChipInput = {
  severity: RefillSeverity;
  daysUntilRefill: number | null;
  inventoryCount: number | null;
  inventoryAlertThreshold: number | null;
};
export type RefillChip = { tone: Tone; glyph: "▲" | null; text: string };
export function refillChip(input: RefillChipInput): RefillChip | null;
```

Also produced:

- `MedicationCard` renders the chip as `<span data-stock-chip …>`. The attribute is the test hook, the same pattern as `data-edit`.

---

- [ ] **Step 1: Write the failing RefillsCard tests**

Create `tests/unit/refills-card-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// RefillsCard's exported rules, which MedicationCard and the walkthrough also
// read, and the card they draw. `node` is load-bearing: see
// tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import RefillsCard, {
  refillChip,
  refillDaysLabel,
  refillDosesLabel,
  refillSeverityClass,
  refillSeverityLabel,
  type RefillChip,
  type RefillChipInput,
} from "$lib/components/RefillsCard.svelte";
import { toneClass } from "$lib/utils/status-tone";
import type { RefillForecastEntry, RefillSeverity } from "$lib/types";
import { ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

const SEVERITIES: RefillSeverity[] = ["critical", "warning", "watch", "ok"];
const STATUS_LITERAL = /\b(?:text|bg|border)-(?:info|danger|danger-ink)(?:\/\d+)?\b/;

const input = (over: Partial<RefillChipInput>): RefillChipInput => ({
  severity: "ok",
  daysUntilRefill: null,
  inventoryCount: null,
  inventoryAlertThreshold: null,
  ...over,
});
const amber = (text: string): RefillChip => ({ tone: "needs-you", glyph: "▲", text });

describe("refillChip: the one rule for a refill or stock chip", () => {
  const CASES: [string, Partial<RefillChipInput>, RefillChip | null][] = [
    ["critical", { severity: "critical", daysUntilRefill: 2, inventoryCount: 4 }, amber("Reorder soon · 2 days left")],
    ["critical, one day", { severity: "critical", daysUntilRefill: 1, inventoryCount: 2 }, amber("Reorder soon · 1 day left")],
    ["critical, out today", { severity: "critical", daysUntilRefill: 0, inventoryCount: 0 }, amber("Reorder soon · Out today")],
    ["warning", { severity: "warning", daysUntilRefill: 6, inventoryCount: 12, inventoryAlertThreshold: 5 }, amber("Reorder soon · 6 days left")],
    ["watch", { severity: "watch", daysUntilRefill: 10, inventoryCount: 20, inventoryAlertThreshold: 5 }, { tone: "neutral", glyph: null, text: "10 days left" }],
    ["ok", { severity: "ok", daysUntilRefill: 30, inventoryCount: 60, inventoryAlertThreshold: 5 }, null],
    ["ok, at the alert threshold", { severity: "ok", daysUntilRefill: 30, inventoryCount: 5, inventoryAlertThreshold: 5 }, amber("Reorder soon · 30 days left")],
    ["ok, one above the threshold", { severity: "ok", daysUntilRefill: 30, inventoryCount: 6, inventoryAlertThreshold: 5 }, null],
    ["watch, below the threshold", { severity: "watch", daysUntilRefill: 12, inventoryCount: 3, inventoryAlertThreshold: 5 }, amber("Reorder soon · 12 days left")],
    ["low, no forecast", { inventoryCount: 4, inventoryAlertThreshold: 5 }, amber("Reorder soon · 4 doses left")],
    ["low, no forecast, one dose", { inventoryCount: 1, inventoryAlertThreshold: 5 }, amber("Reorder soon · 1 dose left")],
    ["empty, threshold 0", { inventoryCount: 0, inventoryAlertThreshold: 0 }, amber("Reorder soon · None left")],
    ["untracked", { inventoryAlertThreshold: 5 }, null],
    ["no threshold, no forecast", { inventoryCount: 4 }, null],
  ];
  for (const [name, over, expected] of CASES) {
    it(name, () => expect(refillChip(input(over))).toEqual(expected));
  }

  it("counts doses in words", () => {
    expect([0, 1, 4].map(refillDosesLabel)).toEqual(["None left", "1 dose left", "4 doses left"]);
  });

  it("keeps the days wording", () => {
    expect([null, -1, 0, 1, 10].map(refillDaysLabel)).toEqual([
      "Refill needed", "Out today", "Out today", "1 day left", "10 days left",
    ]);
  });
});

describe("the row tint and label colour", () => {
  it("are amber for both critical and warning: nothing has gone wrong yet, you need to reorder", () => {
    for (const s of ["critical", "warning"] as const) {
      expect(refillSeverityClass(s)).toBe(toneClass("needs-you", "alert"));
      expect(refillSeverityLabel(s)).toBe(toneClass("needs-you", "text"));
    }
  });

  it("are neutral for watch and ok, a glass row like the dashboard's other cards", () => {
    for (const s of ["watch", "ok"] as const) {
      expect(refillSeverityClass(s)).toBe("border-glass-border bg-glass");
      expect(refillSeverityLabel(s)).toBe(toneClass("neutral", "text"));
    }
  });

  it("never return the info or danger colours", () => {
    for (const s of SEVERITIES) {
      expect(`${refillSeverityClass(s)} ${refillSeverityLabel(s)}`).not.toMatch(STATUS_LITERAL);
    }
  });
});

describe("RefillsCard", () => {
  const entry = (id: string, severity: RefillSeverity, days: number, count: number): RefillForecastEntry => ({
    medicationId: id, medicationName: id, colour: "#e46b6b",
    inventoryCount: count, dailyRate: 1, daysUntilRefill: days, severity,
  });
  const doc = ssrDocument(
    render(RefillsCard, {
      props: {
        entries: [entry("Ibuprofen", "critical", 2, 2), entry("Lisinopril", "warning", 6, 6), entry("Vitamin D", "watch", 10, 10)],
      },
    }).body,
  );
  const rows = [...doc.querySelectorAll<HTMLAnchorElement>("section a")];
  const label = (a: Element) => a.querySelector(":scope > span:last-child")!;
  const has = (el: Element, recipe: string) =>
    expect([...el.classList]).toEqual(expect.arrayContaining(recipe.split(" ")));

  it("says Reorder soon on an amber row for critical and warning, with ▲ hidden from screen readers", () => {
    for (const [i, days] of [[0, 2], [1, 6]]) {
      has(rows[i], toneClass("needs-you", "alert"));
      has(label(rows[i]), toneClass("needs-you", "text"));
      expect(accessibleName(label(rows[i]))).toBe(`Reorder soon · ${days} days left`);
      expect(textOf(label(rows[i]))).toBe(`▲ Reorder soon · ${days} days left`);
      expect(label(rows[i]).querySelector('[aria-hidden="true"]')?.textContent).toBe("▲");
    }
    expect(accessibleName(rows[0])).toBe("Ibuprofen Reorder soon · 2 days left");
  });

  it("draws the watch row neutral with only the days left", () => {
    has(rows[2], "border-glass-border bg-glass");
    has(label(rows[2]), toneClass("neutral", "text"));
    expect(accessibleName(label(rows[2]))).toBe("10 days left");
    expect(label(rows[2]).querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it("paints no info or danger anywhere", () => {
    expect(doc.body.innerHTML).not.toMatch(STATUS_LITERAL);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run tests/unit/refills-card-ssr.test.ts`

Expected: FAIL.

- `refillChip` and `refillDosesLabel` are not exported yet, so every `refillChip` case throws `TypeError: refillChip is not a function`. If the transform rejects the missing export, the whole file fails to load instead.
- Once loaded, the tint tests fail on `expected 'border-danger-ink/40 bg-danger/5' to be 'border border-warning/35 bg-warning/10'`.
- The card tests fail on the label text: `expected '2 days left' to be 'Reorder soon · 2 days left'`.
- `keeps the days wording` passes now. It pins existing behaviour.

- [ ] **Step 3: Implement RefillsCard**

In the `<script module>`, import `toneClass`, `toneOf`, `refillStatus` and `type Tone` from `$lib/utils/status-tone`, and `type RefillSeverity` from `$lib/types`.

- `refillSeverityClass(severity)`: `const tone = toneOf(refillStatus(severity)); return tone === "neutral" ? "border-glass-border bg-glass" : toneClass(tone, "alert");`. The neutral row stays glass, not the neutral Alert's raised surface, because it is a card-like link among the dashboard's glass cards.
- `refillSeverityLabel(severity)`: `toneClass(toneOf(refillStatus(severity)), "text")`.
- `refillDaysLabel`: unchanged.
- Add `REORDER_SOON` to `src/lib/utils/dashboard-copy.ts` exactly as in **Produces**, and import it here. `MedicationCard` does not import it: it gets the words only through `refillChip`, and an unused import would add a lint warning.
- Add the types and `refillDosesLabel` exactly as in **Produces**.

`refillChip` is the rule. Its body is pinned by the table above:

<!-- prettier-ignore -->
```ts
  /**
   * The one rule for "is this running low?", shared by the dashboard's Refills
   * rows, the medications card's chip and the walkthrough. Amber when the
   * forecast tier needs you OR the count is at or below the user's own alert
   * threshold; neutral "N days left" for the watch tier; nothing otherwise.
   * Days when there is a forecast, doses when there is not.
   */
  export function refillChip(input: RefillChipInput): RefillChip | null {
    const { severity, daysUntilRefill, inventoryCount, inventoryAlertThreshold } = input;
    const low =
      inventoryCount !== null &&
      inventoryAlertThreshold !== null &&
      inventoryCount <= inventoryAlertThreshold;
    const tone: Tone | null = low ? toneOf("stock-low") : severity === "ok" ? null : toneOf(refillStatus(severity));
    if (tone === null) return null;
    if (tone !== "needs-you") return { tone, glyph: null, text: refillDaysLabel(daysUntilRefill) };
    const left =
      daysUntilRefill === null && inventoryCount !== null
        ? refillDosesLabel(inventoryCount)
        : refillDaysLabel(daysUntilRefill);
    return { tone, glyph: "▲", text: `${REORDER_SOON} · ${left}` };
  }
```

Extend the module comment at `:4-6` to say these rules also decide the medications card's chip.

**Markup.** Inside `{#each entries as entry …}`, before the `<a>`:

- add `{@const label = refillChip({ severity: entry.severity, daysUntilRefill: entry.daysUntilRefill, inventoryCount: entry.inventoryCount, inventoryAlertThreshold: null })}`;
- the label span's content becomes `{#if label?.glyph}<span aria-hidden="true">{label.glyph}</span>{" "}{/if}{label?.text ?? refillDaysLabel(entry.daysUntilRefill)}`.

  The space must be the expression `{" "}`. A probe against Svelte 5.57's server compiler showed that a literal space before `{/if}`, a space inside the glyph span, and `&#32;` are all dropped at an `{#if}` edge. Only `{" "}` reaches the HTML, so without it "▲" sits flush against "Reorder". The TimelineEntry chips are unaffected: their space sits inside the chip span, not at a block edge, and renders.

The threshold is `null` because `RefillForecastEntry` carries none and the forecast already lists only non-`ok` tiers. The `??` fallback is unreachable from `getRefillForecast` and keeps a row from ever rendering empty.

The row and label class expressions are unchanged, so `StageRefills` follows without an edit.

- [ ] **Step 4: Run the scan, remove the entry, run PASS**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/RefillsCard.svelte`. Delete it from `PENDING_MIGRATION`.

Run: `npx vitest run tests/unit/refills-card-ssr.test.ts tests/unit/walkthrough-demo-facts.test.ts tests/unit/walkthrough-stage.svelte.test.ts tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS. The walkthrough suites pass unedited.

**Mutation proofs:**

- `<=` to `<` in `low`: "ok, at the alert threshold" fails.
- Delete the `low ?` branch: the three "low…" cases and "watch, below the threshold" fail.
- Map `warning` to neutral in `refillSeverityClass`: "are amber for both…" fails.
- Prefer doses over days: "ok, at the alert threshold" fails ("5 doses left").
- Replace `{" "}` with a literal space: "says Reorder soon on an amber row…" fails on `textOf` ("▲Reorder soon · 2 days left").

- [ ] **Step 5: Commit**

`git commit -m "feat(refills): critical and warning tiers read Reorder soon in amber"`

---

- [ ] **Step 6: Write the failing medications-card tests**

Create `tests/unit/medication-card-stock-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// The medications card's one stock chip. `node` is load-bearing: see
// tests/unit/medication-card-targets-ssr.test.ts's header.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { MedicationWithStats } from "$lib/types";
import MedicationCard from "../../src/lib/components/MedicationCard.svelte";
import { toneClass } from "$lib/utils/status-tone";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { doseWriteContext } from "./helpers/dashboard-context";
import { ssrDocument } from "./helpers/axe-ssr";
import { accessibleName, textOf } from "./helpers/dom-names";

type Listed = MedicationWithStats & { sparkline: number[]; refillSeverity: "critical" | "warning" | "watch" | "ok" };
type Stock = Pick<Listed, "refillSeverity" | "daysUntilRefill" | "inventoryCount" | "inventoryAlertThreshold">;

const STATUS = /\b(?:text|bg|border|ring)-(?:warning|success|danger|danger-ink|info)(?:\/\d+)?\b/;

function card(stock: Stock): Document {
  const medication: Listed = {
    ...BASE_MEDICATION_ROW,
    lowInventoryEpisodeAt: null,
    lastTakenAt: null,
    weeklyDoseCount: 14,
    avgDailyConsumption: 2,
    expectedDailyDoses: 3,
    sparkline: [1, 2, 3, 2, 3, 3, 2, 3, 3, 3, 2, 3, 3, 3],
    ...stock,
  };
  return ssrDocument(
    render(MedicationCard, {
      props: { medication, timezone: "UTC", timeFormat: "24h" },
      context: doseWriteContext(),
    }).body,
  );
}
const chips = (doc: Document) => [...doc.querySelectorAll("[data-stock-chip]")];
const has = (el: Element, recipe: string) =>
  expect([...el.classList]).toEqual(expect.arrayContaining(recipe.split(" ")));

const CRITICAL: Stock = { refillSeverity: "critical", daysUntilRefill: 3, inventoryCount: 9, inventoryAlertThreshold: 2 };
const WARNING: Stock = { refillSeverity: "warning", daysUntilRefill: 7, inventoryCount: 21, inventoryAlertThreshold: 2 };
const WATCH: Stock = { refillSeverity: "watch", daysUntilRefill: 10, inventoryCount: 20, inventoryAlertThreshold: 5 };
const FINE: Stock = { refillSeverity: "ok", daysUntilRefill: 60, inventoryCount: 120, inventoryAlertThreshold: 5 };

describe("the medication card's stock chip", () => {
  it("is one amber Reorder soon chip for a critical forecast, ▲ hidden from screen readers", () => {
    const doc = card(CRITICAL);
    expect(chips(doc)).toHaveLength(1);
    const [chip] = chips(doc);
    expect(accessibleName(chip)).toBe("Reorder soon · 3 days left");
    // The space after ▲ is visible text; Svelte drops a literal one at an {#if} edge.
    expect(textOf(chip)).toBe("▲ Reorder soon · 3 days left");
    expect(chip.querySelector('[aria-hidden="true"]')?.textContent).toBe("▲");
    has(chip, toneClass("needs-you", "chip"));
  });

  it("is the same chip, not a second Low one, when stock is at the user's alert threshold", () => {
    const doc = card({ refillSeverity: "ok", daysUntilRefill: 30, inventoryCount: 5, inventoryAlertThreshold: 5 });
    expect(chips(doc)).toHaveLength(1);
    expect(accessibleName(chips(doc)[0])).toBe("Reorder soon · 30 days left");
    expect(textOf(doc.body)).not.toContain("Low:");
  });

  it("counts doses in the chip, and only there, when there is no forecast", () => {
    const doc = card({ refillSeverity: "ok", daysUntilRefill: null, inventoryCount: 4, inventoryAlertThreshold: 5 });
    expect(accessibleName(chips(doc)[0])).toBe("Reorder soon · 4 doses left");
    expect(textOf(doc.body).split("4 doses left")).toHaveLength(2);
  });

  it("is a neutral N days left chip for the watch tier", () => {
    const [chip] = chips(card(WATCH));
    expect(accessibleName(chip)).toBe("10 days left");
    expect(chip.querySelector('[aria-hidden="true"]')).toBeNull();
    has(chip, toneClass("neutral", "chip"));
  });

  it("has no chip when supply is fine, and keeps the days of supply in the stats row", () => {
    const doc = card(FINE);
    expect(chips(doc)).toHaveLength(0);
    expect(textOf(doc.body)).toContain("~60d supply left");
    expect(textOf(doc.body)).not.toContain("doses left");
  });

  it("puts no status colour anywhere on the card except the chip, at any tier", () => {
    for (const stock of [CRITICAL, WARNING, WATCH, FINE]) {
      const doc = card(stock);
      const coloured = [...doc.querySelectorAll("[class]")].filter(
        (el) => STATUS.test(el.getAttribute("class")!) && !el.closest("[data-stock-chip]"),
      );
      expect(coloured.map((el) => el.outerHTML), stock.refillSeverity).toEqual([]);
    }
  });
});
```

Then edit `tests/unit/medication-card-targets-ssr.test.ts`:

- `:30`: the comment becomes `// Both status chips on at once ("Muted" and a critical "Reorder soon · 3 days left"), because`.
- `:173`: becomes the three lines given in the table above (a `-1` guard, then `< linkEnd`).

The `:173` assertion matches raw HTML, so it was probed against Svelte 5.57's server output. `{chip.text}` is one text expression and renders contiguously: `<!--[0--><span aria-hidden="true">▲</span> <!--]-->Reorder soon · 3 days left</span>`. So `indexOf` needs no comment stripping. If a later Svelte splits it, strip comments from `html` once at the top of that `describe` with the shared `withoutComments` (`./helpers/axe-ssr`), so every index in the test is taken on the same string.

- [ ] **Step 7: Run, expect FAIL**

Run: `npx vitest run tests/unit/medication-card-stock-ssr.test.ts tests/unit/medication-card-targets-ssr.test.ts`

Expected:

- `chips(doc)` finds no `[data-stock-chip]`, so the `toHaveLength(1)` tests fail with `expected [] to have a length of 1 but got +0`;
- `puts no status colour…` lists the old chip and the stats span (`<span class="text-warning">`);
- the targets test fails on `expected -1 to be greater than -1`.

`has no chip when supply is fine…` passes already. It guards the days-of-supply line this task keeps.

- [ ] **Step 8: Implement MedicationCard**

- Imports: `import { refillChip } from "$components/RefillsCard.svelte";` and `import { toneClass } from "$lib/utils/status-tone";`.
- Delete `refillChipClass` (`:24-29`).
- Replace the `refillChip` / `lowStockChip` deriveds (`:49-57`) with:

<!-- prettier-ignore -->
```ts
  // One chip, decided by RefillsCard's one rule: amber "Reorder soon" when the
  // forecast tier or the user's own alert threshold says so, neutral days left
  // for the watch tier, nothing otherwise.
  const chip = $derived(
    refillChip({
      severity: medication.refillSeverity ?? "ok",
      daysUntilRefill: medication.daysUntilRefill,
      inventoryCount: medication.inventoryCount,
      inventoryAlertThreshold: medication.inventoryAlertThreshold,
    }),
  );
```

- `:149`: `{#if muted || refillChip || lowStockChip}` becomes `{#if muted || chip}`.
- `:159-171` (the refill chip and the "Low" chip) become one:

<!-- prettier-ignore -->
```svelte
          {#if chip}
            <span
              data-stock-chip
              class="rounded-md px-2 py-1 text-xs font-semibold {toneClass(chip.tone, 'chip')}"
              >{#if chip.glyph}<span aria-hidden="true">{chip.glyph}</span>{" "}{/if}{chip.text}</span
            >
          {/if}
```

`{" "}` and not a literal space: see the note in Step 3. The test's `textOf(chip) === "▲ Reorder soon · 3 days left"` pins it.

- `:184-188`: the `~{medication.daysUntilRefill}d supply left` span keeps its text and its `daysUntilRefill !== null` guard and loses only `class={medication.daysUntilRefill <= 7 ? "text-warning" : ""}`. It takes the stats row's own `text-text-secondary` (`:177`), so the days of supply are a neutral count, and "running low" has one rule: the chip.

The Muted chip, the Log form and button, the adherence bar and the sparkline are untouched.

- [ ] **Step 9: Run the scan, remove the entry, run PASS**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`

Expected: FAIL naming `src/lib/components/MedicationCard.svelte`. Delete it from `PENDING_MIGRATION`.

Run: `npx vitest run tests/unit/medication-card-stock-ssr.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medication-card-targets-dom.test.ts tests/unit/medication-card-focus.svelte.test.ts tests/unit/medications-reorder-lock.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS, both themes.

**Mutation proofs:**

- Restore the `daysUntilRefill <= 7 ? "text-warning"` ternary on the supply span: "puts no status colour…" fails at the critical (3 days) and warning (7 days) tiers.
- Render the chip only when `severity !== "ok"`: "is the same chip, not a second Low one" fails.
- Replace the supply line with `refillDosesLabel(inventoryCount)`: "has no chip when supply is fine…" fails.
- Drop `{" "}` after the glyph: the critical-chip test fails on `textOf`.

- [ ] **Step 10: Commit**

`git commit -m "feat(medications): one stock chip, decided by one rule"`

---

- [ ] **Step 11: Write the failing inventory-history test**

Create `tests/unit/medication-inventory-history-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
// @vitest-environment node
//
// The medication page's inventory history. A refill is not "good" and a dose
// is not "bad": every delta is neutral and the sign carries the direction.
// `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";

// MedicationForm and the page's two inventory forms use:enhance, which is
// SvelteKit client runtime and not what this asserts.
vi.mock("$app/forms", () => ({ enhance: () => ({ destroy() {} }) }));

import Page from "../../src/routes/(app)/medications/[id]/+page.svelte";
import { toneClass } from "$lib/utils/status-tone";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

// `user` and `preferences`: copy the two literals from
// tests/unit/medication-card-targets-ssr.test.ts:197-222 verbatim.
const user = { /* … as there … */ };
const preferences = { /* … as there … */ };
// `Medication` is drizzle-inferred and has `lowInventoryEpisodeAt`, which
// BASE_MEDICATION_ROW lacks; tests are type-checked, so `npm run check` needs it.
const MEDICATION = { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null };

const event = (id: string, eventType: string, quantityChange: number) => ({
  id,
  eventType,
  quantityChange,
  previousCount: 10,
  newCount: 10 + quantityChange,
  note: null,
  createdAt: new Date("2026-05-01T08:00:00.000Z"),
});

describe("inventory history", () => {
  it("prints every change in neutral text, with its sign", () => {
    const doc = ssrDocument(
      render(Page, {
        props: {
          data: {
            user,
            preferences,
            medication: MEDICATION,
            schedules: [],
            inventoryHistory: [event("e1", "refill", 30), event("e2", "dose_taken", -1), event("e3", "correction", 0)],
          },
          form: null,
        },
      }).body,
    );
    const deltas = [...doc.querySelectorAll('ol[role="list"] > li p.font-medium > span')];
    expect(deltas.map(textOf)).toEqual(["+30", "-1", "0"]);
    for (const delta of deltas) {
      expect([...delta.classList]).toEqual(expect.arrayContaining(toneClass("neutral", "text").split(" ")));
      expect(delta.className).not.toMatch(/success|warning|text-text-muted/);
    }
  });
});
```

If `render` throws for a field MedicationForm reads, add only that field to the `data` above, the way `accessible-pickers-ssr.test.ts:284` renders MedicationForm with nothing but `formValues`.

- [ ] **Step 12: Run, expect FAIL**

Run: `npx vitest run tests/unit/medication-inventory-history-ssr.test.ts`

Expected: FAIL, `expected [ 'ml-1', 'text-xs', 'font-semibold', 'text-success' ] to deeply equal ArrayContaining [ 'text-text-secondary' ]`.

- [ ] **Step 13: Implement**

In `src/routes/(app)/medications/[id]/+page.svelte`:

- add `import { toneClass } from "$lib/utils/status-tone";`;
- the span at `:193-199` becomes `<span class="ml-1 text-xs font-semibold {toneClass('neutral', 'text')}">`;
- its text (`{event.quantityChange > 0 ? "+" : ""}{event.quantityChange}`) is unchanged.

Nothing else in the file changes. The success/danger banners, Adjust and Archive are T10's, so **this file stays in `PENDING_MIGRATION`**. The scan still matches it on `:68-86`, `:172` and `:242`.

- [ ] **Step 14: Run, expect PASS**

Run: `npx vitest run tests/unit/medication-inventory-history-ssr.test.ts tests/unit/inventory-event-types.test.ts tests/unit/status-colour-owner.test.ts`

Expected: PASS. The scan passes with the page still listed.

**Mutation proof:** restore the success/warning ternary, and the test fails.

- [ ] **Step 15: Commit**

`git commit -m "feat(medications): inventory history deltas are neutral; the sign carries the direction"`

- [ ] **Step 16: Task gates**

Run each in turn:

1. `npx vitest run tests/unit/refills-card-ssr.test.ts tests/unit/medication-card-stock-ssr.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medication-inventory-history-ssr.test.ts tests/unit/walkthrough-demo-facts.test.ts tests/unit/theme-tokens.test.ts tests/unit/status-colour-owner.test.ts`
2. `npx vitest run`
3. `npm run check`
4. `npm run lint`
5. `npm run format:check`

Expected:

- vitest: 0 failed, both runs;
- check: 0 errors, warnings ≤ 27;
- lint: 0 errors, warnings ≤ 115;
- prettier: clean.

`git grep -nE "\b(text|bg|border)-(warning|success|danger|danger-ink|info)(/[0-9]+)?\b" -- src/lib/components/RefillsCard.svelte src/lib/components/MedicationCard.svelte` prints nothing.

### Task 6: Analytics

Analytics stops judging numbers. The headline numbers, their trends and sparklines, the per-medication trends and the side-effect counts all become neutral. Insights get a `signal` and a glyph instead of a colour-only dot; only the refill insight is amber. The period buttons become `Toggle`. Depends on Task 5, which adds `REORDER_SOON`.

**Files:**

- Modify: `src/lib/types.ts:52-61` (`Insight`)
- Modify: `src/lib/server/analytics.ts:532-622` (`buildInsights`)
- Modify: `src/lib/components/InsightsCard.svelte` (all 30 lines)
- Modify: `src/routes/(app)/analytics/+page.svelte:1-11` (imports), `:78-93` (period pill), `:114-174` (stat cards), `:280-302` (side effects)
- Modify: `src/lib/components/AdherenceChart.svelte:36-40` (trend span)
- Modify: `tests/unit/analytics.test.ts:146-160`, `:241-251`, `:268-288`
- Modify: `tests/unit/status-colour-owner.test.ts` (`PENDING_MIGRATION`)
- Create: `tests/unit/insights-card-ssr.test.ts`
- Create: `tests/unit/analytics-page-ssr.test.ts`

**Every reader of `Insight.severity`:** the grep across `src/` and `tests/` finds exactly four.

- `src/lib/types.ts:59` declares it.
- `src/lib/server/analytics.ts` writes it at `:540`, `:554`, `:561`, `:575`, `:588`, `:597`, `:608` and `:616`, and sorts on it at `:621-622`.
- `src/lib/components/InsightsCard.svelte:8-12, 22` reads it.
- `tests/unit/analytics.test.ts` asserts it at `:157`, `:245` and `:286`.

Nothing else reads it. `/api/v1` (`src/lib/server/api/`), `export-pdf.ts`, `export-csv.ts` and the sync serializer never carry insights: their `severity` hits are side-effect severities. `analytics/page-data.ts:216` only calls `buildInsights`, and `tests/unit/analytics-page-load.test.ts` asserts the _inputs_ it passes (`refillCriticalCount`), never the output. The walkthrough draws no InsightsCard.

**Interfaces:**

- Consumes (T1, `$lib/utils/status-tone`):
  - `toneOf("insight-needs-you")` → `"needs-you"` and `toneOf("insight-info")` → `"neutral"`;
  - `toneClass(tone, "text" | "chip" | "bar")`. The pinned values used here are needs-you text `text-warning`, neutral text `text-text-secondary`, neutral chip `border border-border-strong text-text-secondary` and neutral bar `bg-border-strong`.
- Consumes (T5): `REORDER_SOON = "Reorder soon"` from `$lib/utils/dashboard-copy`. `buildInsights` and its test both import it, so the insight and the refill chip share one spelling.
- Consumes (T2, `$components/ui/Toggle.svelte`): `{ pressed, size = "sm", shape = "rect", class?, children, ...rest }`. It is always `type="button"` and renders `aria-pressed`. On is `border border-accent-ink bg-accent/15 text-accent-ink`; off is `border border-border-strong text-text-secondary`; `sm` is `h-9`.
- Produces (`src/lib/types.ts`):

<!-- prettier-ignore -->
```ts
export type InsightSignal = "needs-you" | "down" | "up" | "info";
export type Insight = {
  id: string;
  signal: InsightSignal;
  /** A short bold lead-in the card prints before `text`, followed by a colon. Only refill-warning has one. */
  lead?: string;
  text: string;
};
```

- Produces (`buildInsights`):
  - **Signals:** adherence-trend is `up` when delta > 0 and `down` otherwise. highest-adherence-med is `up`, lowest-adherence-med `down`, worst-day `info`, peak-hour `info`, refill-warning `needs-you`, side-effects `info` and streak `up`.
  - **Order:** needs-you, then down, then up, then info. The sort is stable, so ties keep push order. Then `.slice(0, 5)` as today.
  - **Refill copy:** `lead: REORDER_SOON`. The text is `"1 medication runs out within 7 days"` or `` `${n} medications run out within 7 days` ``, so the card reads "Reorder soon: 2 medications run out within 7 days", as in `status-colours.html:477-479`. The old "needs a refill" after "Reorder soon:" said the same thing twice. Both halves are about supply, never medical advice.
- Produces (page decisions, which T12 mirrors on the stage):
  - KPI numbers are `text-text-primary text-3xl font-bold`.
  - Trend spans are `text-xs` + `toneClass("neutral", "text")`.
  - Sparkline wrappers are `toneClass("neutral", "text")` + `mt-2`.
  - Each period is a `<Toggle>` at the default `sm`/`rect`, inside the unchanged pill `div`.
- **Decision on sparkline colour: neutral `text-text-secondary`, not a medication colour and not the accent.**
  - Each headline sparkline sums every medication, so no single medication's colour is honest.
  - The accent means due now, selected, or the main action.
  - `--color-text-secondary` clears 4.5:1 on glass in both themes (`theme-tokens.test.ts` TEXT_TOKENS × `glass-on-surface`), so the line clears the 3:1 non-text minimum.
- **Decision on side-effect frequency:** bars use `toneClass("neutral", "bar")` on the existing `bg-surface-overlay` track, the same pair as T4's skipped segment in `StatusBreakdownBar`. Chips use `toneClass("neutral", "chip")` + `rounded-full px-2.5 py-0.5 text-xs`.

- [ ] **Step 1: Write the failing `buildInsights` tests.** In `tests/unit/analytics.test.ts`:
  - At `:156-159`, replace `severity: "positive"` with `signal: "up"`.
  - Replace the refill test at `:241-251` and the ordering test at `:268-288`.
  - Add the decline test and the signal table.

<!-- prettier-ignore -->
```ts
it("signals a decline as down", () => {
  const insights = buildInsights({
    ...baseInputs,
    avgAdherence: 60,
    prevAvgAdherence: 80,
    medStats: [
      { medicationName: "A", adherence: 80, expectedTotal: 30 },
      { medicationName: "B", adherence: 80, expectedTotal: 30 },
    ],
  });
  expect(insights.find((i) => i.id === "adherence-trend")).toMatchObject({
    signal: "down",
    text: expect.stringContaining("declined 20%"),
  });
});

// One fixture per rule: buildInsights slices to five, so a single fixture firing all
// eight would hide three of them.
const ONLY: Record<string, Partial<InsightInputs>> = {
  "highest-adherence-med": { medStats: [{ medicationName: "Best", adherence: 95, expectedTotal: 30 }, { medicationName: "Worst", adherence: 50, expectedTotal: 30 }] },
  "lowest-adherence-med": { medStats: [{ medicationName: "Best", adherence: 95, expectedTotal: 30 }, { medicationName: "Worst", adherence: 50, expectedTotal: 30 }] },
  "worst-day": { dayOfWeek: [5, 5, 5, 5, 5, 5, 0].map((count, dayOfWeek) => ({ dayOfWeek, count })) },
  "peak-hour": { hourly: [{ hour: 8, count: 5 }, { hour: 12, count: 1 }, { hour: 20, count: 1 }] },
  "refill-warning": { refillCriticalCount: 2 },
  "side-effects": { sideEffectsCount: 5, topSideEffect: "Drowsiness" },
  streak: { streak: 7 },
};
it.each([
  ["highest-adherence-med", "up"],
  ["lowest-adherence-med", "down"],
  ["worst-day", "info"],
  ["peak-hour", "info"],
  ["refill-warning", "needs-you"],
  ["side-effects", "info"],
  ["streak", "up"],
] as const)("signals %s as %s", (id, signal) => {
  expect(buildInsights({ ...baseInputs, ...ONLY[id] }).find((i) => i.id === id)?.signal).toBe(signal);
});

it("leads the refill insight with the refill chip's own Reorder soon, and says the supply runs out", () => {
  expect(buildInsights({ ...baseInputs, refillCriticalCount: 1 }).find((i) => i.id === "refill-warning")).toEqual({
    id: "refill-warning",
    signal: "needs-you",
    lead: REORDER_SOON,
    text: "1 medication runs out within 7 days",
  });
  expect(buildInsights({ ...baseInputs, refillCriticalCount: 3 }).find((i) => i.id === "refill-warning")?.text).toBe(
    "3 medications run out within 7 days",
  );
});

it("gives no other insight a lead-in", () => {
  for (const [id, inputs] of Object.entries(ONLY)) {
    if (id === "refill-warning") continue;
    for (const insight of buildInsights({ ...baseInputs, ...inputs })) expect(insight.lead, insight.id).toBeUndefined();
  }
});

it("orders needs-you, then down, then up, then info, and slices to 5", () => {
  const insights = buildInsights({
    ...baseInputs,
    avgAdherence: 60,
    prevAvgAdherence: 80,
    medStats: [
      { medicationName: "A", adherence: 95, expectedTotal: 30 },
      { medicationName: "B", adherence: 50, expectedTotal: 30 },
    ],
    hourly: [{ hour: 8, count: 5 }, { hour: 12, count: 1 }],
    sideEffectsCount: 4,
    topSideEffect: "Nausea",
    refillCriticalCount: 2,
    streak: 5,
  });
  // Pushed: trend(down) highest(up) lowest(down) peak(info) refill(needs-you) side-effects(info) streak(up).
  expect(insights.map((i) => i.id)).toEqual([
    "refill-warning",
    "adherence-trend",
    "lowest-adherence-med",
    "highest-adherence-med",
    "streak",
  ]);
});
```

- [ ] **Step 2: Run the tests and watch them fail.** Run `npx vitest run tests/unit/analytics.test.ts`. Expect FAIL:
  - "expected { id: 'adherence-trend', …(2) } to match object { signal: 'up', … }";
  - the signal table reads `undefined` for every row;
  - the order test gets `[ 'adherence-trend', 'lowest-adherence-med', 'refill-warning', … ]`, because the old `warning` rank puts the refill third.

  The test imports `REORDER_SOON` from `$lib/utils/dashboard-copy` (Task 5). The refill test's `lead: REORDER_SOON` is the one assertion that the insight and the chip say the same words.

- [ ] **Step 3: Implement the type and `buildInsights`.**
  - In `src/lib/types.ts:52-61`, write the `InsightSignal` and `Insight` declarations from Interfaces. Keep the comment above them, which explains why the type lives in `$lib/types`.
  - In `src/lib/server/analytics.ts`, every `severity:` in `buildInsights` becomes the `signal:` given in Interfaces. Refill-warning (`:594-603`) gains `lead: REORDER_SOON`, imported from `$lib/utils/dashboard-copy` (a client-reachable module with no server or `.svelte` imports), and the new text.
  - Replace the `order` constant and the return at `:621-622` with this:

<!-- prettier-ignore -->
```ts
const SIGNAL_RANK: Record<InsightSignal, number> = { "needs-you": 0, down: 1, up: 2, info: 3 };
return out.sort((a, b) => SIGNAL_RANK[a.signal] - SIGNAL_RANK[b.signal]).slice(0, 5);
```

Import `InsightSignal` beside `Insight` at `:506`.

- [ ] **Step 4: Run and prove by mutation.** Run `npx vitest run tests/unit/analytics.test.ts`. Expect PASS. Then break each line and watch its test fail:
  - Swap the `"needs-you"` and `down` ranks: "orders needs-you, then down…" fails.
  - Set highest-adherence-med to `"info"`: the "signals highest-adherence-med as up" row fails.
  - Delete `lead`: the refill test fails.
  - Write the lead as the literal `"Reorder Soon"`: the refill test fails against `REORDER_SOON`.

  Restore each.

- [ ] **Step 5: Write the failing InsightsCard SSR test.** Create `tests/unit/insights-card-ssr.test.ts`. The `// @vitest-environment node` header is load-bearing; its explanatory comment is the same as `appearance-page-ssr.test.ts`'s.

<!-- prettier-ignore -->
```ts
const STATUS_TOKEN = /^(?:[\w-]+:)*(?:text|bg|border|ring|fill|stroke|from|to|outline|divide|decoration)-(?:warning|success|danger|danger-ink|danger-fg|info)(?:\/\d+)?$/;
const INSIGHTS: Insight[] = [
  { id: "refill-warning", signal: "needs-you", lead: "Reorder soon", text: "2 medications run out within 7 days" },
  { id: "lowest-adherence-med", signal: "down", text: "Lowest adherence: Ibuprofen (31%)" },
  { id: "highest-adherence-med", signal: "up", text: "Highest adherence: Vitamin D (44%)" },
  { id: "peak-hour", signal: "info", text: "Most consistent dosing time is 08:00" },
];
const docOf = (insights: Insight[]) => ssrDocument(render(InsightsCard, { props: { insights } }).body);
const items = () => [...docOf(INSIGHTS).querySelectorAll("li")];
/** What a screen reader reads: the item without its aria-hidden glyph. */
function spoken(li: Element): string {
  const clone = li.cloneNode(true) as Element;
  clone.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
  return textOf(clone);
}

it("renders nothing without insights", () => {
  expect(docOf([]).querySelector("h2")).toBeNull();
});
it("marks each insight with a hidden glyph: ▲ needs you, ↓ down, ↑ up, • info", () => {
  const glyphs = items().map((li) => li.firstElementChild!);
  expect(glyphs.map(textOf)).toEqual(["▲", "↓", "↑", "•"]);
  for (const g of glyphs) expect(g.getAttribute("aria-hidden")).toBe("true");
});
it("says the actionable insight in words, with a bold Reorder soon: lead-in", () => {
  const [refill, ...rest] = items();
  expect(spoken(refill)).toBe("Reorder soon: 2 medications run out within 7 days");
  const lead = [...refill.querySelectorAll("span")].find((s) => textOf(s) === "Reorder soon:");
  expect([...lead!.classList]).toEqual(expect.arrayContaining(["font-semibold", "text-warning"]));
  for (const li of rest) expect(spoken(li)).not.toContain("Reorder soon");
});
it("colours only the actionable insight, amber, and draws no colour-only dot", () => {
  const [refill, ...rest] = items();
  expect([...refill.firstElementChild!.classList]).toContain("text-warning");
  for (const li of rest) {
    expect([...li.firstElementChild!.classList]).toContain("text-text-secondary");
    expect([li, ...li.querySelectorAll("*")].flatMap((el) => [...el.classList].filter((t) => STATUS_TOKEN.test(t)))).toEqual([]);
  }
  const filled = items().flatMap((li) => [...li.querySelectorAll("*")]).filter((el) => [...el.classList].some((t) => t.startsWith("bg-")));
  expect(filled).toEqual([]);
});
it("passes axe's listitem and aria-hidden-focus rules", async () => {
  const results = await runAxe(docOf(INSIGHTS), ["listitem", "aria-hidden-focus"]);
  expect(results.violations).toEqual([]);
  expect(evaluatedRules(results)).toEqual(new Set(["listitem", "aria-hidden-focus"]));
});
```

The imports are `render` (svelte/server), `InsightsCard`, `type Insight`, `ssrDocument`/`runAxe`/`evaluatedRules` (`./helpers/axe-ssr`) and `textOf` (`./helpers/dom-names`).

- [ ] **Step 6: Run the test and watch it fail.** Run `npx vitest run tests/unit/insights-card-ssr.test.ts`. Expect FAIL with "expected [ '', '', '', '' ] to deeply equal [ '▲', '↓', '↑', '•' ]": the old dot is an empty span.
- [ ] **Step 7: Implement `InsightsCard.svelte`.**
  - Drop `dotClass`.
  - Import `toneClass` and `toneOf` from `$lib/utils/status-tone`, and `type InsightSignal` from `$lib/types`.
  - Pin `const GLYPH: Record<InsightSignal, string> = { "needs-you": "▲", down: "↓", up: "↑", info: "•" };` and `toneFor = (s) => toneOf(s === "needs-you" ? "insight-needs-you" : "insight-info")`.
  - Comment it: the glyph says which way an insight points and is aria-hidden because the sentence already says it ("improved", "Lowest", "Reorder soon:"); only the actionable insight is coloured.
  - Each item:

<!-- prettier-ignore -->
```svelte
{@const ink = toneClass(toneFor(insight.signal), "text")}
<li class="flex items-start gap-3 text-sm">
  <span class="w-3 shrink-0 text-center {ink}" aria-hidden="true">{GLYPH[insight.signal]}</span>
  <span class="text-text-primary"
    >{#if insight.lead}<span class="font-semibold {ink}">{insight.lead}:</span>{" "}{/if}{insight.text}</span
  >
</li>
```

The space after the lead is `{" "}`: Svelte 5.57 drops a literal space at an `{#if}` edge (Task 5 Step 3), and "says the actionable insight in words" pins it.

- [ ] **Step 8: Run and prove by mutation.** Run `npx vitest run tests/unit/insights-card-ssr.test.ts tests/unit/analytics.test.ts`. Expect PASS. Then break each line and watch its test fail:
  - Remove `aria-hidden="true"`: the glyph test fails.
  - Make the lead's class `toneClass("neutral", "text")`: the lead-in test fails.
  - Put back a `bg-warning` dot: the dot test fails.
  - Replace `{" "}` with a literal space: the lead-in test fails on "Reorder soon:2 medications…".

  Restore each.

- [ ] **Step 9: Commit.** Message: `feat(analytics): insights carry a signal and a glyph, not a colour-only dot`.
- [ ] **Step 10: Write the failing analytics page SSR test.** Create `tests/unit/analytics-page-ssr.test.ts` with the `node` docblock.
  - Import `Page` from `../../src/routes/(app)/analytics/+page.svelte` and `type ComponentProps` from `svelte`.
  - `$app/navigation` needs no mock; `log-pagination-ssr.test.ts` imports a page that uses it.
  - The fixture is cast once, as `walkthrough-demo-facts.test.ts:300-320` casts its composer inputs, because the page's `PageData` is drizzle-inferred.
  - `user` and `preferences` are copied from `log-pagination-ssr.test.ts:35-63`.

<!-- prettier-ignore -->
```ts
const data = {
  user,
  preferences,
  insights: [],
  medications: [],
  selectedMedIds: [],
  period: 90,
  from: "",
  to: "",
  streak: 12,
  avgAdherence: 42,
  totalDoses: 118,
  trends: {
    adherence: { direction: "down", percent: 4 },
    doses: { direction: "up", percent: 9 },
    perMedication: [{ medicationId: "m1", trend: { direction: "down", percent: 6 } }],
  },
  dailyAdherence: [
    { date: "2026-10-14", doseCount: 2, expected: 3, adherence: 67 },
    { date: "2026-10-15", doseCount: 3, expected: 3, adherence: 100 },
  ],
  dailyCounts: [],
  medStats: [{ medicationId: "m1", medicationName: "Ibuprofen", colour: "#ef4444", adherence: 31, doseCount: 28, expectedTotal: 90 }],
  // All zero, so StatusBreakdownBar (T4's) renders nothing and the whole-page scan is about this page.
  statusBreakdown: { takenEvents: 0, skippedEvents: 0, missedEvents: 0, expectedTotal: 0 },
  dayOfWeek: [],
  hourly: [],
  scheduledHours: [],
  scheduleVariance: null,
  sideEffects: {
    frequency: [{ name: "Nausea", count: 4 }, { name: "Headache", count: 2 }],
    byMedication: [{ medication: "Ibuprofen", effects: [{ name: "Nausea", count: 4 }] }],
  },
} as unknown as ComponentProps<typeof Page>["data"];
const doc = ssrDocument(render(Page, { props: { data } }).body);
const tokensOf = (el: Element) => [...el.classList];

it("renders no status colour when nothing on the page needs you", () => {
  expect([...doc.querySelectorAll("*")].flatMap((el) => tokensOf(el).filter((t) => STATUS_TOKEN.test(t)))).toEqual([]);
});
it("prints the three headline numbers in plain text, never the accent", () => {
  for (const n of ["12", "42%", "118"]) {
    const p = [...doc.querySelectorAll("p")].find((el) => textOf(el) === n);
    expect(tokensOf(p!), n).toContain("text-text-primary");
    expect(tokensOf(p!), n).not.toContain("text-accent-ink");
  }
});
it("shows every trend as a neutral arrow and percentage", () => {
  for (const t of ["↓4%", "↑9%", "↓6%"]) {
    const span = [...doc.querySelectorAll("span")].find((el) => textOf(el) === t);
    expect(tokensOf(span!), t).toContain("text-text-secondary");
  }
});
it("draws both headline sparklines in the neutral ink", () => {
  for (const label of ["Daily adherence over period", "Daily doses over period"]) {
    const svg = doc.querySelector(`svg[aria-label="${label}"]`);
    expect(tokensOf(svg!.parentElement!), label).toContain("text-text-secondary");
  }
});
it("offers the four periods as Toggles, only the current one pressed", () => {
  const toggles = [...doc.querySelectorAll("button")].filter((b) => ["7d", "30d", "90d", "1y"].includes(textOf(b)));
  expect(toggles.map(textOf)).toEqual(["7d", "30d", "90d", "1y"]);
  expect(toggles.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false"]);
  for (const b of toggles) {
    expect(b.getAttribute("type")).toBe("button");
    expect(tokensOf(b)).toContain("h-9");
    expect(tokensOf(b)).not.toContain("bg-accent");
  }
  expect(tokensOf(toggles[2])).toEqual(expect.arrayContaining(["border-accent-ink", "bg-accent/15", "text-accent-ink"]));
  expect(tokensOf(toggles[0])).toEqual(expect.arrayContaining(["border-border-strong", "text-text-secondary"]));
});
it("draws side-effect frequency as neutral bars and chips", () => {
  const card = [...doc.querySelectorAll("h2")].find((h) => textOf(h) === "Side Effects")!.parentElement!;
  const fills = [...card.querySelectorAll("[style*='width']")];
  expect(fills).toHaveLength(2);
  for (const f of fills) expect(tokensOf(f)).toContain("bg-border-strong");
  const chip = [...card.querySelectorAll("span")].find((s) => textOf(s) === "Nausea (4)");
  expect(tokensOf(chip!)).toEqual(expect.arrayContaining(["border-border-strong", "text-text-secondary"]));
});
it("passes axe on names and ARIA", async () => {
  const rules = ["button-name", "aria-allowed-attr", "aria-valid-attr-value", "role-img-alt"];
  const results = await runAxe(doc, rules);
  expect(results.violations).toEqual([]);
  expect(evaluatedRules(results)).toEqual(new Set(rules));
});
```

`STATUS_TOKEN` is the same literal as in Step 5.

- [ ] **Step 11: Run the test and watch it fail.** Run `npx vitest run tests/unit/analytics-page-ssr.test.ts`. Expect FAIL:
  - the scan finds `text-success`, `text-danger-ink`, `text-warning`, `bg-warning/70` and `bg-warning/10`;
  - the KPI test finds `text-accent-ink` and no `text-text-primary` on "12";
  - the Toggle test finds no `h-9` and the old `bg-accent`.
- [ ] **Step 12: Implement the page and AdherenceChart.**
  - In `src/routes/(app)/analytics/+page.svelte`:
    - Import `Toggle` from `$components/ui/Toggle.svelte` and `toneClass` from `$lib/utils/status-tone`.
    - Add `const NEUTRAL_TEXT = toneClass("neutral", "text");`.
    - `:79-92`: the `{#each PERIODS as p (p.value)}` body becomes `<Toggle pressed={data.period === p.value} onclick={() => setPeriod(p.value)}>{p.label}</Toggle>`. Shorten the `:80-81` comment to: aria-pressed comes from Toggle, which states the selection beyond its colour.
    - `:116`, `:120`, `:148`: the KPI `<p>` becomes `text-text-primary text-3xl font-bold`.
    - `:126-130` and `:154-158`: the trend span becomes `class="text-xs {NEUTRAL_TEXT}"`. The arrow and percent are unchanged.
    - `:137` and `:164`: the sparkline wrapper becomes `class="{NEUTRAL_TEXT} mt-2"`.
    - `:282`: the bar becomes `class="h-full rounded-full {toneClass('neutral', 'bar')}"`.
    - `:299`: the chip becomes `class="rounded-full px-2.5 py-0.5 text-xs {toneClass('neutral', 'chip')}"`.
  - In `src/lib/components/AdherenceChart.svelte`, import `toneClass`. `:37` becomes `class="text-xs {toneClass('neutral', 'text')}"`.
- [ ] **Step 13: Shrink the PENDING list.** In `tests/unit/status-colour-owner.test.ts`, delete `src/lib/components/AdherenceChart.svelte`, `src/lib/components/InsightsCard.svelte` and `src/routes/(app)/analytics/+page.svelte` from `PENDING_MIGRATION`. None of them matches the scan any more.
- [ ] **Step 14: Run and prove by mutation.** Run `npx vitest run tests/unit/analytics-page-ssr.test.ts tests/unit/status-colour-owner.test.ts tests/unit/insights-card-ssr.test.ts tests/unit/analytics.test.ts`. Expect PASS. Then break each line and watch its test fail:
  - Restore `text-success` on `:120`: the scan and KPI tests fail, and so does the owner scan (a file outside PENDING now matches).
  - Make AdherenceChart's trend `text-danger-ink`: "shows every trend…" fails on "↓6%".
  - Put back the hand-written period `<button>`: the Toggle test fails.

  Restore each.

- [ ] **Step 15: Run the gates.**
  - Run `npx vitest run tests/unit/analytics.test.ts tests/unit/insights-card-ssr.test.ts tests/unit/analytics-page-ssr.test.ts tests/unit/status-colour-owner.test.ts`.
  - Run `npx vitest run`.
  - Run `npm run check`: expect 0 errors and at most 27 warnings.
  - Run `npm run lint`: expect 0 errors and at most 115 warnings. The new `(p.value)` key can only lower the count.
  - Run `npm run format:check`: expect it clean.

  Commit: `feat(analytics): neutral headline numbers, trends and side-effect counts; period toggles`.

### Task 7: Guarded permanent deletions, and the Privacy, Data and Import pages on `Button` and `Alert`

The four deletions nothing can undo — Privacy's **Delete dose history** and **Delete archived medications**, Data's **Delete account**, and Import's **Replace everything** — get one server guard and one confirmation dialog. The dialog states what will go, with server counts. Every account types a word. An account with a password also enters it. The same work moves all three pages onto `Button` and `Alert`, so all three leave `PENDING_MIGRATION`.

- [ ] **7.0 Make sure PGlite is installed in this worktree.** Run `ls node_modules/@electric-sql/pglite`. If it is missing, run `npm install --no-save @electric-sql/pglite` **outside the Bash sandbox** (inside it, npm fails with a misleading EPERM). This task's counts test lives in `tests/unit/pg/`; without PGlite, `tests/unit/pg/*` fail to import and `npm run check` reports 3 errors, so the 0-error gate cannot be met.

**Before starting:**

- T1 (`status-tone.ts` and the scan test with `PENDING_MIGRATION`), T2 (`Button`) and T3 (`Alert`) must already be merged on the branch.
- Read at HEAD (`925be44`) before editing:
  - `src/routes/(app)/settings/privacy/+page.{svelte,server.ts}`
  - `src/routes/(app)/settings/data/+page.{svelte,server.ts}`
  - `src/routes/(app)/settings/data/import/+page.{svelte,server.ts}`
  - `src/lib/server/auth/reauth.ts`
  - `src/lib/components/ui/Modal.svelte`
  - `src/routes/api/v1/auth/reauth/+server.ts`
  - `docs/api-v1-contract.md:132-162` and `:517-533`

#### Decisions this task makes

Each decision has its reason.

**The guard's behaviour (D1–D2)**

- **D1. The guard checks the word first, and reads the account only after.** A wrong or missing word returns before any database read and before `confirmReauth`. So a mistyped word costs nothing from the per-account reauth budget (`reauth:<userId>`, 10 per 15 minutes).
  - A row whose `passwordHash` is null counts as "no password". A missing row counts the same way. A request with `locals.user` always has a row, because sessions cascade from `users`, and a missing row would delete nothing anyway, since every delete is scoped by `userId`.
  - `accountHasPassword(userId)` is the one reader of that fact. The guard and all three page loads call it, so "does this account have a password" has one owner. Today the import load answers it inline, at `import/+page.server.ts:70-74`.
- **D2. A guard failure is returned as `fail(400, { error })`.** That is the bare-string shape `actionErrorMessage` (`utils/form-errors.ts:49`) already reads. CLAUDE.md says a call site never re-reads `result.data`, so the dialog's message comes from `actionErrorMessage(result)`.
  - This replaces `wipeDosesError` and `wipeArchivedError` on Privacy, and `deleteError` on Data.
  - The import action's failure key `importError` becomes `error` everywhere (`import/+page.server.ts:189-293`: 11 renamed sites, plus the three replace-check sites the guard replaces). Without that, a commit refused from inside the dialog (a rate limit, say) would show `actionErrorMessage`'s fallback text instead of the server's message.
  - `revokeError` is unchanged. Revoke is not a deletion and has no dialog.

**How the dialog behaves (D3–D6)**

- **D3. Only a `failure` stays in the dialog.** A failure leaves the dialog open, shows the message as a wrong-tone `Alert`, and clears the password.
  - Every other result is applied with `update()` first, and only then is the dialog closed. That covers success, redirect, and `error` (a crash, an expired session, or no response).
  - An `error` result goes to `+error.svelte`, as it does on these pages today.
  - Applying before closing means the danger button stays pending until the page actually shows the outcome. It also means a closed dialog's opener may already be gone, which D10 covers.
- **D4. When there is nothing to delete, the entry button is not rendered.** Privacy renders its two entries only when `counts.doseLogs > 0` or `counts.archivedMedications > 0`. Otherwise the summary builder's zero sentence is shown as muted text.
  - Without this, the dialog would read "This deletes 0 doses for 0 medications."
  - Account deletion always offers its entry, because the account itself goes.
- **D5. Import's replace counts come from the preview, not the page load.** `preview.summary.medicationsDeleted` and `dosesDeleted` are the planner's own count of what this exact commit deletes (`server/import/plan.ts:278-279`). The page already prints them in its "Replace mode will first delete …" line.
  - A load-time count would be a second, staler number for the same thing on the same screen.
  - The dialog cannot open without a matching preview. Its entry button uses the same `canCommit` condition the commit button uses today.
- **D6. The copy is decided here.** The builders live in a client-reachable module (`$lib/utils/destructive-confirm.ts`), and counts are formatted with `new Intl.NumberFormat("en-GB")`. "en-GB" matches `formatUserDate`'s default. A bare `toLocaleString()` would vary with the viewer's browser.

| Builder                      | Input              | Output                                                                                                           |
| ---------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `doseHistorySummary`         | 1204 doses, 6 meds | `This deletes 1,204 doses for 6 medications.`                                                                    |
|                              | 1, 1               | `This deletes 1 dose for 1 medication.`                                                                          |
|                              | 0 doses            | `There is no dose history to delete.`                                                                            |
| `archivedMedicationsSummary` | 2 meds, 340 doses  | `This deletes 2 archived medications and the 340 doses logged for them.`                                         |
|                              | 1, 1               | `This deletes 1 archived medication and the 1 dose logged for it.`                                               |
|                              | 1, 0               | `This deletes 1 archived medication. No doses were logged for it.`                                               |
|                              | 3, 0               | `This deletes 3 archived medications. No doses were logged for them.`                                            |
|                              | 0 meds             | `There are no archived medications to delete.`                                                                   |
| `accountDeletionSummary`     | 6 meds, 1204 doses | `This deletes your account and settings, 6 medications and 1,204 doses.`                                         |
|                              | 1, 1               | `This deletes your account and settings, 1 medication and 1 dose.`                                               |
| `replaceSummary`             | 6, 1204            | `This deletes 6 medications and 1,204 doses, with their schedules and inventory history, then imports the file.` |
|                              | 1, 1               | `This deletes 1 medication and 1 dose, with their schedules and inventory history, then imports the file.`       |
|                              | 0 meds             | `Your account has no medications, so nothing is deleted before the file is imported.`                            |

The dialog also renders `This can't be undone.` as its own paragraph after the summary.

The page success lines keep today's words but now format their numbers:

- `Removed 1,204 dose log entries.` / `Removed 1 dose log entry.`
- `Removed 2 archived medications.` / `Removed 1 archived medication.`
- `Revoked 3 sessions.` / `Revoked 1 session.` (unchanged)

| Dialog         | title                          | confirmLabel                  | word    | Pending label |
| -------------- | ------------------------------ | ----------------------------- | ------- | ------------- |
| Dose history   | `Delete dose history?`         | `Delete dose history`         | DELETE  | `Deleting…`   |
| Archived       | `Delete archived medications?` | `Delete archived medications` | DELETE  | `Deleting…`   |
| Account        | `Delete your account?`         | `Delete account`              | DELETE  | `Deleting…`   |
| Import replace | `Replace all your data?`       | `Replace all data`            | REPLACE | `Replacing…`  |

The server messages are unified:

- `Type DELETE to confirm.` / `Type REPLACE to confirm.`
- `Password is required to confirm this action.`

These replace three old strings:

- Data's `Password is required to delete your account.`
- Import's `Enter your password to replace all data.`
- Import's `Type REPLACE to confirm replacing all your data.`

**Colours and live regions (D7–D8)**

- **D7. How the Import page's colours change.** The spec's own rule for this is that "Danger zone" headings become neutral and "red stays on the actions inside the confirmation". In other words, red marks the irreversible action, not text that describes it.
  - **"Replace everything" radio card, `import/+page.svelte:188-197`:** becomes neutral. That means `border-glass-border` like the Merge card, with a default-colour title.
    - Choosing the radio is reversible, because you can switch back to Merge. The step that can't be undone is now the dialog's danger button.
    - The card keeps its words "Cannot be undone.", so the meaning still has a word.
  - **The preview's "Replace mode will first delete N medications and M dose entries." line, `:308-313`:** becomes `Alert tone="needs-you"`. It is an import-preview warning you must act on, which the spec's table makes amber.
  - **The preview warnings list, `:328-334`:** becomes one needs-you `Alert`, titled `Check before importing`, with the list as its body.
  - **The "Import complete" list's "were replaced" line, `:118-122`:** becomes neutral. It reports something that has already happened, and it sits inside a green Alert.
- **D8. An error `Alert` (`role="alert"`) is never placed inside a persistent `role="status"` wrapper.** Only happened Alerts go inside the wrapper.
  - Nesting an assertive region inside a polite one double-announces in some screen readers.
  - `role="alert"` is the one live role that announces reliably when it is inserted, so an error needs no pre-existing region.

**Where the dialog's forms sit (D9–D10)**

- **D9. Every `<form>` that holds a `DestructiveConfirm` sits outside every `GlassCard`.** `GlassCard` is `backdrop-blur-xl` (`ui/GlassCard.svelte:11`), and `backdrop-filter` makes the card the containing block for Modal's `fixed inset-0` scrim (`Modal.svelte:96`). Inside a card, the scrim would be clipped to the card and stack under later page content.
  - Privacy's and Data's dialog forms go after the page container's closing `</div>`, where Data's `Modal` sits today (`data/+page.svelte:109`).
  - Import's whole page is one form, so its dialog is a direct child of that form. It sits right after the hidden `mapping` input and before the first `GlassCard`. That tree position also makes the dialog's danger button the form's **default button** while it is open, so Enter in the word field submits the dialog (guarded), not "Preview again".
  - The mount test pins both properties.
- **D10. What happens to focus after a successful deletion.**
  - Privacy: a wipe that empties its section removes its entry button (D4). Modal then finds the opener disconnected and parks focus on the page `h1` without scrolling. That is its existing `focusIfLost(returnFocus, pageHeading)` path, so the page needs no code for it.
  - Data: deleting the account redirects to `/`.
  - Import: the import form is replaced by the outcome when the commit succeeds, which happens after a replace and after a merge alike, and the dialog unmounts with it. The import submit callback therefore calls `focusIfLost(pageHeading)` after any successful commit. Both functions come from `$components/dose-writes/focus-after`, so this adds no `h1` lookup.

**JavaScript (D11)**

- **D11. The four deletions need JavaScript, because a `Modal` opens them.** Account deletion already did. The two Privacy wipes used to post as plain forms. This is accepted.

**Files**

- Create:
  - `src/lib/utils/destructive-confirm.ts`
  - `src/lib/server/auth/destructive-guard.ts`
  - `src/lib/components/ui/DestructiveConfirm.svelte`
  - `src/lib/components/ui/destructive-dialog.svelte.ts`
- Create tests:
  - `tests/unit/destructive-summary.test.ts`
  - `tests/unit/destructive-guard.test.ts`
  - `tests/unit/destructive-confirm.svelte.test.ts`
  - `tests/unit/destructive-dialog.test.ts`
  - `tests/unit/destructive-actions.test.ts`
  - `tests/unit/pg/destructive-counts.test.ts`
  - `tests/unit/destructive-pages-ssr.test.ts`
  - `tests/unit/destructive-pages-mount.svelte.test.ts`
- Modify:
  - The six page and server files above
  - `src/routes/api/v1/auth/reauth/+server.ts`
  - `src/lib/server/api/commands.ts` (one comment)
  - `docs/api-v1-contract.md`
  - `CLAUDE.md`
- Modify tests:
  - `tests/unit/app-action-auth-guard.test.ts`
  - `tests/unit/mobile-nav-link-names-ssr.test.ts`
  - `tests/unit/pg/dose-trash-wipe.test.ts`
  - `tests/unit/status-colour-owner.test.ts` (remove 3 entries from `PENDING_MIGRATION`)

**Existing tests that pin these pages or actions**

No other test renders these three pages or posts these four actions. This was checked by grep for each route path, each action name and each visible label.

- **`tests/unit/mobile-nav-link-names-ssr.test.ts:153-177`** renders all three pages and pins the back link's name and position. Its Data and Privacy fixtures gain the new load fields (7.3 step 1, 7.4 step 1). Its assertions are unchanged.
- **`tests/unit/app-action-auth-guard.test.ts:229,240,241`** post bodies that must pass validation. Those bodies gain `confirmWord: "DELETE"`. The assertion, a 401 before any dependency runs, is unchanged.
  - The import `commit` case (`:234`) stays without fields. Its `enforceLimit` is `never()` and runs before the upload is read, so a guardless action still fails there.
- **`tests/unit/pg/dose-trash-wipe.test.ts:254-262`** runs the real `deleteAccount`. Its body gains `confirmWord: "DELETE"`. Its seeded `u1` has no `passwordHash`, so the word alone passes, which also exercises the passwordless path on real Postgres. The assertions (302 to `/`, the trash cascade) are unchanged.
- **`tests/unit/focus-trap.test.ts:68-79`** builds its own fixture that only mentions "Delete Permanently" by name. It needs no change. The property it pins, that a `disabled` button is not a trap stop, still holds for other dialogs.

**Interfaces**

- Consumes:
  - T2's `Button` (`variant`, `size`, `href`, `type`, `ariaDisabled`, `disabled`, `pending`, `pendingLabel`, rest props including `onclick` and `formaction`)
  - T3's `Alert` (`tone`, `title`, `class`, children)
  - T1's `PENDING_MIGRATION` list
  - `Modal` (`open`, `onclose`, `title`, `returnFocus`, children)
  - `confirmReauth`, `reauthMessage` and `type ReauthPurpose` from `$lib/server/auth/reauth`
  - `actionErrorMessage` from `$lib/utils/form-errors`
  - `focusIfLost` and `pageHeading` from `$components/dose-writes/focus-after`
- Produces:

<!-- prettier-ignore -->
```ts
// src/lib/utils/destructive-confirm.ts — client-reachable, NO imports
export type DestructiveWord = "DELETE" | "REPLACE";
export function formatCount(n: number): string;                 // en-GB grouping
export function doseHistorySummary(c: { doses: number; medications: number }): string;
export function archivedMedicationsSummary(c: { medications: number; doses: number }): string;
export function accountDeletionSummary(c: { medications: number; doses: number }): string;
export function replaceSummary(c: { medications: number; doses: number }): string;

// src/lib/server/auth/destructive-guard.ts
export type { DestructiveWord } from "$lib/utils/destructive-confirm";
export async function accountHasPassword(userId: string): Promise<boolean>;
export async function checkDestructiveGuard(
  userId: string,
  formData: FormData,
  opts: { word: DestructiveWord; purpose: ReauthPurpose },
): Promise<{ ok: true } | { ok: false; error: string }>;

// src/lib/components/ui/destructive-dialog.svelte.ts
export type DestructiveDialog = {
  readonly open: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  show(): void;                              // open, with no error
  close(): void;                             // close (DestructiveConfirm refuses while pending)
  begin(): void;                             // a submit from the dialog started: pending, error cleared
  settle(result: ActionResult): boolean;     // failure → error = actionErrorMessage(result), pending off, true; else false
  finish(): void;                            // pending off, closed
  submit: SubmitFunction;                    // begin → settle-or-(update, finish) for a form that holds only the dialog
};
export function createDestructiveDialog(): DestructiveDialog;

// src/lib/components/ui/DestructiveConfirm.svelte, rendered INSIDE the <form> it submits
type Props = {
  open: boolean;
  onclose: () => void;
  title: string;                    // "Delete dose history?"
  summary: string;                  // "This deletes 1,204 doses for 6 medications." (counts from the server)
  word: DestructiveWord;
  hasPassword: boolean;
  confirmLabel: string;             // the danger button's label
  pending?: boolean;
  error?: string | null;            // shown as an Alert tone "wrong" inside the dialog
  returnFocus?: () => HTMLElement | null;
  formaction?: string;              // passed to the danger button; Import's form has no action, so it needs "?/commit"
};
```

---

#### 7.1 The copy module and the server guard

**Files:**

- `src/lib/utils/destructive-confirm.ts`
- `src/lib/server/auth/destructive-guard.ts`
- `tests/unit/destructive-summary.test.ts`
- `tests/unit/destructive-guard.test.ts`

- [ ] **Step 1: Write the failing copy test.** Create `tests/unit/destructive-summary.test.ts` (the default jsdom environment is fine, since the module is pure). Write one `it` per builder, asserting every row of the D6 table verbatim. Then add:

<!-- prettier-ignore -->
```ts
it("groups thousands the en-GB way whatever the runtime locale", () => {
  expect(formatCount(0)).toBe("0");
  expect(formatCount(1204)).toBe("1,204");
  expect(formatCount(1_000_000)).toBe("1,000,000");
});
it("has no imports, because DestructiveConfirm and every page read it", () => {
  const src = readFileSync("src/lib/utils/destructive-confirm.ts", "utf8");
  expect(src).not.toMatch(/^\s*import\s/m);
});
```

- [ ] **Step 2: Write the failing guard test.** Create `tests/unit/destructive-guard.test.ts`. Use `// @vitest-environment node` and the **fake-db** seam: `vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock)`.
  - **Why fake-db and not PGlite:** the guard is one read of `users.password_hash` followed by a branch in TypeScript. Nothing about it is decided by the database. CLAUDE.md's rule sends that to the fake.
  - Mock `$lib/server/auth/reauth` as `{ confirmReauth: vi.fn(), reauthMessage: vi.fn(() => "REAUTH MESSAGE") }`, created with `vi.hoisted`. `reauthMessage`'s own wording is pinned in `auth-reauth.test.ts`. Here the test proves that the guard delegates to it.
  - In `beforeEach`, reset the fake and the mocks. Seed the account per case:
    - `fakeDb.seed(users, [{ passwordHash: "$argon2id$x" }])` for a password account;
    - `[{ passwordHash: null }]` for a passwordless account;
    - `[]` for no row.
  - Build `FormData` with a helper `fd({ confirmWord?, password? })`.

<!-- prettier-ignore -->
```ts
const DOSES = { word: "DELETE", purpose: "wipe_dose_history" } as const;

it("refuses a missing word before reading the account or spending a password attempt", async () => {
  seedPassword();
  expect(await checkDestructiveGuard("u1", fd({ password: "hunter2" }), DOSES))
    .toEqual({ ok: false, error: "Type DELETE to confirm." });
  expect(confirmReauth).not.toHaveBeenCalled();
  expect(fakeDb.attempted).toEqual([]);            // no select at all
});
it("refuses a wrong word, case-sensitively, naming the word it wants", async () => {
  seedPasswordless();
  for (const typed of ["delete", "Delete", "DELET", "DELETE!"])
    expect(await checkDestructiveGuard("u1", fd({ confirmWord: typed }), DOSES))
      .toEqual({ ok: false, error: "Type DELETE to confirm." });
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE" }),
    { word: "REPLACE", purpose: "import_replace_data" }))
    .toEqual({ ok: false, error: "Type REPLACE to confirm." });
});
it("trims the typed word", async () => {
  seedPasswordless();
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "  DELETE \n" }), DOSES)).toEqual({ ok: true });
});
it("asks a password account for its password without spending an attempt", async () => {
  seedPassword();
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE" }), DOSES))
    .toEqual({ ok: false, error: "Password is required to confirm this action." });
  expect(confirmReauth).not.toHaveBeenCalled();
});
it("re-authenticates a password account for the purpose given, and reports a refusal through reauthMessage", async () => {
  seedPassword();
  const refusal = { ok: false, rateLimited: true, retryAfterMs: 60_000 };
  confirmReauth.mockResolvedValueOnce(refusal);
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE", password: "hunter2" }), DOSES))
    .toEqual({ ok: false, error: "REAUTH MESSAGE" });
  expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "wipe_dose_history");
  expect(reauthMessage).toHaveBeenCalledWith(refusal);
});
it("passes a password account with the word and a confirmed password", async () => {
  seedPassword();
  confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE", password: "hunter2" }), DOSES))
    .toEqual({ ok: true });
});
it("passes an account with no password on the word alone, and never calls confirmReauth", async () => {
  seedPasswordless();
  expect(await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE", password: "ignored" }), DOSES))
    .toEqual({ ok: true });
  expect(confirmReauth).not.toHaveBeenCalled();
});
it("reads the password state of the user it was given", async () => {
  seedPasswordless();
  await checkDestructiveGuard("u1", fd({ confirmWord: "DELETE" }), DOSES);
  const read = fakeDb.attempted.find((c) => c.op === "select" && c.table === "users");
  expect(predicateIncludes(read?.predicate, "u1")).toBe(true);
});
describe("accountHasPassword", () => {
  it("is true for a hash, false for null and for no row", async () => { /* three seeds, three expects */ });
});
```

- [ ] **Step 3: Run the two tests and confirm they fail.** Run `npx vitest run tests/unit/destructive-summary.test.ts tests/unit/destructive-guard.test.ts`. Expect both files to FAIL with `Failed to resolve import "../../src/lib/utils/destructive-confirm"` (and the same for `destructive-guard`).

- [ ] **Step 4: Implement the copy module.** Create `src/lib/utils/destructive-confirm.ts` with the signatures above and exactly the D6 copy. Use one module-level `const NUMBER = new Intl.NumberFormat("en-GB")` and a local `plural(n, one, many)`. Add a header comment saying why it has no imports: `DestructiveConfirm` and the pages are client code.

- [ ] **Step 5: Implement the server guard.** Create `src/lib/server/auth/destructive-guard.ts`. The order of the checks is the point, so here is the body:

<!-- prettier-ignore -->
```ts
export async function accountHasPassword(userId: string): Promise<boolean> {
  const [account] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return Boolean(account?.passwordHash);
}

export async function checkDestructiveGuard(userId, formData, { word, purpose }) {
  // The word first: a refused word reads nothing and spends no reauth attempt.
  if (String(formData.get("confirmWord") ?? "").trim() !== word) {
    return { ok: false, error: `Type ${word} to confirm.` };
  }
  if (!(await accountHasPassword(userId))) return { ok: true };
  const password = String(formData.get("password") ?? "");
  if (!password) return { ok: false, error: "Password is required to confirm this action." };
  const reauth = await confirmReauth(userId, password, purpose);
  return reauth.ok ? { ok: true } : { ok: false, error: reauthMessage(reauth) };
}
```

- Give the module a header comment covering three things:
  - It is the one gate on the four browser deletions. The callers are privacy `wipeDoseHistory` and `wipeArchivedMedications`, data `deleteAccount`, and import `commit` in replace mode.
  - An account with no password passes on the word alone. Before this, `confirmReauth` could never succeed for such an account, so it could not run three of the four.
  - `/api/v1` deliberately does not use this guard. Point to `docs/api-v1-contract.md`.

- [ ] **Step 6: Run the tests and confirm they pass.** Run the same command as step 3. Expect PASS.
  - **Mutation proofs.** Make each change below, confirm the named test fails, then revert:
    - Move the word check below the `accountHasPassword` read. "refuses a missing word before reading…" fails, because `fakeDb.attempted` is no longer empty.
    - Drop `.trim()`. "trims the typed word" fails.
    - Use `.toUpperCase()` on the typed word. "refuses a wrong word, case-sensitively…" fails.
    - Delete the `if (!password)` line. "asks a password account…" fails, because `confirmReauth` is called.
    - Hard-code `"Incorrect password."` in place of `reauthMessage(reauth)`. "…reports a refusal through reauthMessage" fails.
    - Pass `"delete_account"` as the purpose. "…for the purpose given" fails.
    - Replace the `accountHasPassword` branch with an unconditional `confirmReauth`. "passes an account with no password…" fails.
    - Change the formatter to `toLocaleString()`. Run under `LANG=de_DE.UTF-8 npx vitest run tests/unit/destructive-summary.test.ts`, and "groups thousands the en-GB way" fails.

- [ ] **Step 7: Commit.** Run `git add` on the four files, then commit with the message `feat(auth): one server guard for the deletions nothing can undo`.

---

#### 7.2 `DestructiveConfirm` and its dialog state

**Files:**

- `src/lib/components/ui/DestructiveConfirm.svelte`
- `src/lib/components/ui/destructive-dialog.svelte.ts`
- `tests/unit/destructive-confirm.svelte.test.ts`
- `tests/unit/destructive-dialog.test.ts`

- [ ] **Step 1: Write the failing component test.** Create `tests/unit/destructive-confirm.svelte.test.ts`. It uses jsdom and the client runtime, and is a `.svelte.test.ts` so that props can be a `$state` object.
  - Mount the component **into a `<form>`**: `mount(DestructiveConfirm, { target: form, props })`. Rendering inside the form it submits is the component's rule.
  - Register a submit spy on the form: `form.addEventListener("submit", onsubmit)`, where `onsubmit = vi.fn((e) => e.preventDefault())`.
  - Default props:
    - `title: "Delete dose history?"`
    - `summary: "This deletes 1,204 doses for 6 medications."`
    - `word: "DELETE"`
    - `hasPassword: true`
    - `confirmLabel: "Delete dose history"`
    - `pending: false`
    - `error: null`
    - `open: false`
    - `onclose: vi.fn(() => (props.open = false))`
  - Use a `settle()` helper (`flushSync` plus three `tick`s), as in `modal-return-focus.svelte.test.ts`.
  - Use a `type(input, value)` helper that sets `.value`, dispatches `input`, then calls `flushSync()`.
  - Let `danger` be the button whose text includes `confirmLabel`.

<!-- prettier-ignore -->
```ts
it("says what goes, with the server's counts, and that it can't be undone", async () => {
  await openFrom(opener);
  const dialog = q('[role="dialog"]');
  expect(dialog.getAttribute("aria-label")).toBe("Delete dose history?");
  expect(dialog.querySelector("h2")!.textContent).toBe("Delete dose history?");
  expect(dialog.textContent).toContain("This deletes 1,204 doses for 6 medications.");
  expect(dialog.textContent).toContain("This can't be undone.");
});
it("names its inputs confirmWord and password, labelled, with the right autocomplete", async () => {
  await openFrom(opener);
  const word = q<HTMLInputElement>('input[name="confirmWord"]');
  expect([word.type, word.getAttribute("autocomplete"), word.getAttribute("autocapitalize")])
    .toEqual(["text", "off", "characters"]);
  expect(word.labels![0].textContent!.replace(/\s+/g, " ").trim()).toBe("Type DELETE to confirm");
  const pw = q<HTMLInputElement>('input[name="password"]');
  expect([pw.type, pw.getAttribute("autocomplete")]).toEqual(["password", "current-password"]);
  expect(pw.labels![0].textContent!.trim()).toBe("Your password");
});
it("asks an account with no password for the word alone", async () => {
  props.hasPassword = false; await openFrom(opener);
  expect(form.querySelector('input[name="password"]')).toBeNull();
  type(q('input[name="confirmWord"]'), "DELETE");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});
it("keeps its one danger button aria-disabled, not disabled, until the word and the password are in", async () => {
  await openFrom(opener);
  expect(form.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  expect(danger().classList).toContain("bg-danger");
  expect(danger().disabled).toBe(false);
  expect(danger().getAttribute("aria-disabled")).toBe("true");
  type(q('input[name="confirmWord"]'), "DELETE");
  expect(danger().getAttribute("aria-disabled")).toBe("true");      // password still empty
  type(q('input[name="password"]'), "hunter2");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});
it("matches the word case-sensitively after trimming, as the server does", async () => {
  props.hasPassword = false; await openFrom(opener);
  type(q('input[name="confirmWord"]'), "delete");
  expect(danger().getAttribute("aria-disabled")).toBe("true");
  type(q('input[name="confirmWord"]'), "  DELETE ");
  expect(danger().getAttribute("aria-disabled")).not.toBe("true");
});
it("submits nothing while not ready, and submits once with itself as submitter when ready", async () => {
  await openFrom(opener);
  danger().click();
  expect(onsubmit).not.toHaveBeenCalled();
  type(q('input[name="confirmWord"]'), "DELETE"); type(q('input[name="password"]'), "hunter2");
  danger().click();
  expect(onsubmit).toHaveBeenCalledTimes(1);
  expect((onsubmit.mock.calls[0][0] as SubmitEvent).submitter).toBe(danger());
});
it("closes from Cancel and from Escape without submitting", async () => {
  await openFrom(opener);
  const cancel = buttonByText(form, "Cancel");
  expect(cancel.getAttribute("type")).toBe("button");
  cancel.click(); await settle();
  expect(props.onclose).toHaveBeenCalledTimes(1);
  await openFrom(opener);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle();
  expect(props.onclose).toHaveBeenCalledTimes(2);
  expect(onsubmit).not.toHaveBeenCalled();
});
it("moves focus to the word field on open and back to the opener on close", async () => {
  await openFrom(opener);
  expect(document.activeElement).toBe(q('input[name="confirmWord"]'));
  props.open = false; await settle();
  expect(document.activeElement).toBe(opener);
});
it("lets Tab reach the word, the password, Cancel and the not-ready danger button, in that order", async () => {
  await openFrom(opener);
  // The list Modal's Tab trap cycles through; aria-disabled keeps the danger button in it.
  expect(collectFocusable(q('[role="dialog"]')).map((el) => el.getAttribute("name") ?? el.getAttribute("type")))
    .toEqual(["confirmWord", "password", "button", "submit"]);
  expect(danger().getAttribute("aria-disabled")).toBe("true");
});
it("shows an error as a wrong-tone Alert inside the dialog, and clears the password", async () => {
  await openFrom(opener);
  type(q('input[name="password"]'), "wrong");
  props.error = "Incorrect password."; await settle();
  const alert = q('[role="dialog"] [role="alert"]');
  expect(alert.textContent).toContain("Incorrect password.");
  expect(q<HTMLInputElement>('input[name="password"]').value).toBe("");
});
it("while pending, shows the pending label, submits nothing, and will not close", async () => {
  await openFrom(opener); fillReady();
  props.pending = true; await settle();
  expect(danger().getAttribute("aria-busy")).toBe("true");
  expect(danger().textContent).toContain("Deleting…");
  danger().click();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(onsubmit).not.toHaveBeenCalled();
  expect(props.onclose).not.toHaveBeenCalled();
});
it("says Replacing… for REPLACE", async () => { /* word: "REPLACE", pending → "Replacing…" */ });
it("starts empty each time it opens", async () => {
  await openFrom(opener); fillReady();
  props.open = false; await settle(); await openFrom(opener);
  expect(q<HTMLInputElement>('input[name="confirmWord"]').value).toBe("");
  expect(danger().getAttribute("aria-disabled")).toBe("true");
});
it("passes formaction to its submit", async () => {
  props.formaction = "?/commit"; await openFrom(opener);
  expect(danger().getAttribute("formaction")).toBe("?/commit");
});
it("renders nothing of its own while closed", () => {
  mountClosed();
  expect(form.innerHTML.replace(/<!--.*?-->/g, "").trim()).toBe("");
});
```

- **Imports** beyond the component: `collectFocusable` from `$lib/utils/focus-trap`.
- **About `openFrom`:** the opener button sits outside the form. `openFrom` focuses it, sets `props.open = true`, then calls `settle()`.
- **About `aria-disabled`:** the assertions read only "is `true`" or "is not `true`". T2's Button decides whether a false value renders `aria-disabled="false"` or drops the attribute.

- [ ] **Step 2: Write the failing dialog-state test.** Create `tests/unit/destructive-dialog.test.ts` (jsdom). Results are `ActionResult` literals, and `update` is a `vi.fn`.

<!-- prettier-ignore -->
```ts
const FAILED = { type: "failure", status: 400, data: { error: "Incorrect password." } } as ActionResult;
const DONE = { type: "success", status: 200, data: { wipeDosesOk: true, removed: 3 } } as ActionResult;

function submitWith(d: DestructiveDialog, result: ActionResult, update = vi.fn(async () => {})) {
  const after = d.submit({} as never) as (o: unknown) => Promise<void>;
  return { update, done: after({ result, update }) };
}

it("show opens with no error; close closes", () => { /* show → open true, error null; close → false */ });
it("a submit marks it pending and clears the last error", () => { /* after a failure: begin() → pending true, error null */ });
it("keeps a failure in the dialog with the server's message, and does not apply it", async () => {
  const d = createDestructiveDialog(); d.show();
  const { update, done } = submitWith(d, FAILED); await done;
  expect(update).not.toHaveBeenCalled();
  expect([d.open, d.pending, d.error]).toEqual([true, false, "Incorrect password."]);
});
it("gives a failure with no message a message", async () => {
  /* { type: "failure", status: 400 } → error "Something went wrong — please try again." */
});
it("applies a success before it closes, staying pending until the page has the result", async () => {
  const d = createDestructiveDialog(); d.show();
  const update = vi.fn(async () => { expect([d.open, d.pending]).toEqual([true, true]); });
  await submitWith(d, DONE, update).done;
  expect(update).toHaveBeenCalledTimes(1);
  expect([d.open, d.pending]).toEqual([false, false]);
});
it("applies a redirect and an error result rather than holding them", async () => {
  /* { type: "redirect", status: 302, location: "/" } and
     { type: "error", status: 500, error: { message: "x" } } each → update called, closed */
});
it("still settles when applying the result throws", async () => {
  /* update rejects → `done` rejects, and pending is false, open is false */
});
```

- [ ] **Step 3: Run the two tests and confirm they fail.** Run `npx vitest run tests/unit/destructive-confirm.svelte.test.ts tests/unit/destructive-dialog.test.ts`. Expect FAIL because the modules do not resolve.

- [ ] **Step 4: Implement the dialog state.** Create `src/lib/components/ui/destructive-dialog.svelte.ts`. Its body is short, and the order matters (D3):

<!-- prettier-ignore -->
```ts
export function createDestructiveDialog(): DestructiveDialog {
  let open = $state(false);
  let pending = $state(false);
  let error = $state<string | null>(null);
  const dialog: DestructiveDialog = {
    get open() { return open; },
    get pending() { return pending; },
    get error() { return error; },
    show: () => { error = null; open = true; },
    close: () => { open = false; },
    begin: () => { pending = true; error = null; },
    settle: (result) => {
      if (result.type !== "failure") return false;
      pending = false;
      error = actionErrorMessage(result);
      return true;
    },
    finish: () => { pending = false; open = false; },
    submit: () => {
      dialog.begin();
      return async ({ result, update }) => {
        if (dialog.settle(result)) return;
        try { await update(); } finally { dialog.finish(); }
      };
    },
  };
  return dialog;
}
```

- [ ] **Step 5: Implement the component.** Create `src/lib/components/ui/DestructiveConfirm.svelte` with the `Props` in Interfaces. These are the decisions; the markup follows from them.
  - **Root element.** The root is `<Modal open {title} onclose={requestClose} {returnFocus}>`. Nothing renders outside it, so a closed dialog adds no box to a `space-y-*` parent.
  - **Request close.** `requestClose = () => { if (!pending) onclose(); }`. Both Escape (through Modal) and Cancel go through it.
  - **Contents, in order:**
    1. `<h2 class="mb-2 text-lg font-semibold">{title}</h2>`
    2. `<p class="text-text-secondary text-sm">{summary}</p>`
    3. `<p class="text-text-secondary mt-1 text-sm">This can't be undone.</p>`
    4. `{#if error}<Alert class="mt-4" tone="wrong" title={error} />{/if}`
    5. The word field, then (when `hasPassword`) the password field, inside `mt-4 space-y-3`.
    6. A `mt-6 flex justify-end gap-3` row holding `<Button variant="ghost" ariaDisabled={pending} onclick={requestClose}>Cancel</Button>` and the danger button.
  - **Field ids** come from `const uid = $props.id()`, giving `${uid}-word` and `${uid}-password`. Ids stay unique when a page holds two dialogs.
  - **The word field.**
    - `<label for=…>Type <strong>{word}</strong> to confirm</label>`
    - `<input id=… name="confirmWord" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" required bind:value={typed}>`
  - **The password field.**
    - `<label for=…>Your password</label>`
    - `<input … name="password" type="password" autocomplete="current-password" required bind:value={password}>`
  - **Input classes.** Copy the existing input recipe with **accent** focus, not today's `focus:border-danger-ink` (`data/+page.svelte:129`): `border-border-strong bg-surface-raised text-text-primary focus:border-accent-ink focus:ring-accent-ink h-11 w-full rounded-lg border px-3 text-sm focus:ring-1 focus:outline-none`. A `danger-*` class here would put this new file into the owner scan's offender list.
  - **Readiness.** `const ready = $derived(typed.trim() === word && (!hasPassword || password.length > 0))`.
  - **The danger button.**
    - `<Button variant="danger" type="submit" {formaction} ariaDisabled={!ready} {pending} pendingLabel={word === "REPLACE" ? "Replacing…" : "Deleting…"} onclick={guard}>{confirmLabel}</Button>`
    - `guard = (e: MouseEvent) => { if (!ready || pending) e.preventDefault(); }`
    - Implicit submission (Enter in a field) clicks the default button. So this one guard covers Enter too, while it is the form's first submit button (D9).
  - **Two effects. Neither one reads what it writes.**
    - `$effect(() => { if (!open) { typed = ""; password = ""; } })`
    - `$effect(() => { if (error) password = ""; })`
  - **Header comment.** It should cover three things:
    - Render it inside the `<form>` it submits.
    - That form must not sit inside a `GlassCard` (D9).
    - The server's `checkDestructiveGuard` is the real gate. This dialog is the explanation.

- [ ] **Step 6: Run the tests and confirm they pass.** Run the command from step 3. Expect PASS.
  - **Mutation proofs.** Make each change below, confirm the named test fails, then revert:
    - Drop `onclick={guard}`. "submits nothing while not ready…" fails.
    - Use real `disabled={!ready}`. "…aria-disabled, not disabled…" fails, because `.disabled` is true, and "lets Tab reach…" fails, because a disabled button leaves the Tab order.
    - Delete the `if (!open)` effect. "starts empty each time it opens" fails.
    - Delete the `if (error)` effect. "…clears the password" fails.
    - Call `onclose` directly instead of `requestClose`. "while pending… will not close" fails.
    - Wrap the Modal in a `<div>`. "renders nothing of its own while closed" fails.
    - In the dialog state, swap `finish()` before `update()`. "applies a success before it closes…" fails.
    - Delete `if (dialog.settle(result)) return;`. "keeps a failure in the dialog…" fails.
    - Remove `try/finally`. "still settles when applying the result throws" fails.

- [ ] **Step 7: Commit.** Commit the four files with the message `feat(ui): DestructiveConfirm, one dialog for deletions nothing can undo`.

---

#### 7.3 Privacy: both wipes guarded, the page on `Button` and `Alert`

**Files:**

- `src/routes/(app)/settings/privacy/+page.server.ts`
- `src/routes/(app)/settings/privacy/+page.svelte`
- Create `tests/unit/destructive-actions.test.ts`
- Create `tests/unit/pg/destructive-counts.test.ts`
- Create `tests/unit/destructive-pages-ssr.test.ts`
- Create `tests/unit/destructive-pages-mount.svelte.test.ts`
- `tests/unit/app-action-auth-guard.test.ts`
- `tests/unit/mobile-nav-link-names-ssr.test.ts`
- `tests/unit/status-colour-owner.test.ts`

- [ ] **Step 1: Update the existing fixtures and bodies.** These edits are not new assertions.
  - In `app-action-auth-guard.test.ts`, change lines 240 and 241 to `fields: { confirmWord: "DELETE", password: "hunter2" }`. Extend the comment at `:12-15` with one sentence: a wipe's valid body now carries the typed word.
  - In `mobile-nav-link-names-ssr.test.ts:160-166`, add `doseMedications: 0, archivedDoses: 0` to the privacy `counts`, and add `hasPassword: true` beside it.

- [ ] **Step 2: Write the failing action tests.** Create `tests/unit/destructive-actions.test.ts` with `// @vitest-environment node`, because the import cases in 7.5 post a real `File` and jsdom's `File` and undici's `FormData` are different realms. Use fake-db.
  - Mock `$lib/server/auth/reauth` as `{ confirmReauth: vi.fn(), reauthMessage: () => "Incorrect password." }`.
  - Mock `$lib/server/api/wipe` as `{ wipeDoseHistory: vi.fn(async () => ({ deleted: 1204 })), wipeArchivedMedications: vi.fn(async () => ({ deleted: 2 })) }`.
  - Mock `$lib/server/auth/lucia` as `{ lucia: { invalidateSession: vi.fn(async () => {}), invalidateUserSessions: vi.fn(async () => {}), createBlankSessionCookie: () => ({ name: "auth_session", value: "", attributes: {} }) } }`.
  - Mock `$lib/server/audit` as `{ logAudit: vi.fn(async () => {}) }`.
  - Use a helper `call(actions, name, fields)` that posts a `FormData` request with `locals: { user: { id: "u1" }, session: { id: "s1" } }` and a `cookies: { set: vi.fn() }`.
  - Write one `describe` per action. 7.4 and 7.5 append theirs.

<!-- prettier-ignore -->
```ts
describe.each([
  ["wipeDoseHistory", wipe.wipeDoseHistory, "wipe_dose_history", { wipeDosesOk: true, removed: 1204 }],
  ["wipeArchivedMedications", wipe.wipeArchivedMedications, "wipe_archived_medications", { wipeArchivedOk: true, removed: 2 }],
] as const)("privacy ?/%s", (name, wipeFn, purpose, okResult) => {
  it("refuses a direct POST without the word, for a password account, deleting nothing", async () => {
    seedPassword();
    expect(await call(privacy.actions, name, { password: "hunter2" }))
      .toMatchObject({ status: 400, data: { error: "Type DELETE to confirm." } });
    expect(wipeFn).not.toHaveBeenCalled();
    expect(confirmReauth).not.toHaveBeenCalled();
  });
  it("refuses a direct POST without the word, for an account with no password", async () => {
    seedPasswordless();
    expect(await call(privacy.actions, name, {}))
      .toMatchObject({ status: 400, data: { error: "Type DELETE to confirm." } });
    expect(wipeFn).not.toHaveBeenCalled();
  });
  it("refuses a password account that typed the word but sent no password", async () => {
    seedPassword();
    expect(await call(privacy.actions, name, { confirmWord: "DELETE" }))
      .toMatchObject({ status: 400, data: { error: "Password is required to confirm this action." } });
    expect(wipeFn).not.toHaveBeenCalled();
  });
  it("runs for a password account with the word and a confirmed password", async () => {
    seedPassword(); confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
    expect(await call(privacy.actions, name, { confirmWord: "DELETE", password: "hunter2" })).toEqual(okResult);
    expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", purpose);
    expect(wipeFn).toHaveBeenCalledWith("u1");
  });
  it("now runs for an account with no password, on the word alone", async () => {
    seedPasswordless();
    expect(await call(privacy.actions, name, { confirmWord: "DELETE" })).toEqual(okResult);
    expect(confirmReauth).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write the failing PGlite counts test.** Create `tests/unit/pg/destructive-counts.test.ts`.
  - **Why PGlite and not fake-db:** `count(distinct …)`, the join to archived medications and the per-user scope are SQL semantics that a fixture cannot evaluate. CLAUDE.md sends those to PGlite.
  - Setup:
    - `// @vitest-environment node`
    - `vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock)`
    - `vi.mock("$lib/server/auth/lucia", () => ({ lucia: {} }))`
    - `vi.mock("$lib/server/preferences", () => ({ getOrCreatePreferences: async () => ({ exportFormat: "pdf" }), updatePreferences: async () => ({}) }))`
  - Seed in `beforeEach`, in this order, after `pgDb.reset()`:
    - users: `u1` (no password) and `u2`
    - medications: `m1` active, `m2` archived and `m3` active, all owned by `u1`; `m4` archived, owned by `u2`
    - doses: three on `m1`, two on `m2`, four on `m4` (with `userId: "u2"`)

<!-- prettier-ignore -->
```ts
it("counts the dose history and the medications it spans, for this user only", async () => {
  const data = await privacyLoad({ locals: { user: { id: "u1" } } } as never);
  expect(data).toMatchObject({
    counts: { doseLogs: 5, doseMedications: 2, activeMedications: 2, archivedMedications: 1, archivedDoses: 2 },
    hasPassword: false,
  });
});
it("reports hasPassword for an account with a hash", async () => {
  await pgDb.seedUser({ id: "u3", email: "u3@example.com", passwordHash: "$argon2id$x" });
  expect((await privacyLoad({ locals: { user: { id: "u3" } } } as never)).hasPassword).toBe(true);
});
```

- [ ] **Step 4: Write the failing SSR test.** Create `tests/unit/destructive-pages-ssr.test.ts` with `// @vitest-environment node`. It uses `render` from `svelte/server`, reads `.body`, and parses with `ssrDocument`.
  - Fixture: `PRIVACY = { user, preferences, hasPassword: true, counts: { activeMedications: 4, archivedMedications: 2, doseLogs: 1204, doseMedications: 6, archivedDoses: 340, sessions: 3, auditLogs: 9 } }`.
  - Helpers:
    - `button(doc, text)` finds the `button` whose trimmed text equals `text`.
    - `STATUS = /\b(?:text|bg|border)-(?:warning|success|danger|danger-ink)\b/`.

<!-- prettier-ignore -->
```ts
describe("privacy page", () => {
  it("opens each wipe from a secondary button that is in no form", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const label of ["Delete dose history", "Delete archived medications"]) {
      const b = button(doc, label);
      expect(b.getAttribute("type")).toBe("button");
      expect([...b.classList]).toEqual(expect.arrayContaining(["h-11", "border-border-strong"]));
      expect(b.className).not.toMatch(STATUS);
      expect(b.closest("form")).toBeNull();
    }
  });
  it("offers no wipe when there is nothing to wipe, and says so", () => {
    const doc = page(PrivacyPage, { ...PRIVACY, counts: { ...PRIVACY.counts, doseLogs: 0, doseMedications: 0, archivedMedications: 0, archivedDoses: 0 } }, null);
    expect(doc.body.textContent).toContain("There is no dose history to delete.");
    expect(doc.body.textContent).toContain("There are no archived medications to delete.");
    expect(doc.querySelectorAll("button")).toHaveLength(1);   // Revoke only
  });
  it("keeps each dialog's form empty while closed and outside every GlassCard", () => {
    const doc = page(PrivacyPage, PRIVACY, null);
    for (const action of ["?/wipeDoseHistory", "?/wipeArchivedMedications"]) {
      const f = doc.querySelector(`form[action="${action}"]`)!;
      expect(f.querySelector("input, button")).toBeNull();
      expect(f.closest(".backdrop-blur-xl")).toBeNull();
    }
  });
  it("draws the Danger zone heading neutral", () => {
    const h = [...page(PrivacyPage, PRIVACY, null).querySelectorAll("h2")].find((e) => e.textContent === "Danger zone")!;
    expect(h.className).not.toMatch(STATUS);
  });
  it("makes the exports, Revoke and 'Go to delete account' secondary", () => {
    /* a[href="/api/export?format=pdf"], a[href="/api/export?format=csv"], a[href="/api/audit"],
       a[href="/settings/data"] and the submit "Revoke other sessions":
       classList contains h-11 and border-border-strong, className not STATUS */
  });
  it("announces a wipe's outcome as a happened Alert in its persistent status region", () => {
    const doc = page(PrivacyPage, PRIVACY, { wipeDosesOk: true, removed: 1204 });
    const region = [...doc.querySelectorAll('[role="status"]')].find((r) => r.textContent!.includes("Removed"))!;
    expect(region.textContent).toContain("Removed 1,204 dose log entries.");
    expect(region.querySelector('svg[aria-hidden="true"]')).not.toBeNull();   // the Alert's icon
    const one = page(PrivacyPage, PRIVACY, { wipeArchivedOk: true, removed: 1 });
    expect(one.body.textContent).toContain("Removed 1 archived medication.");
  });
  it("renders a Revoke failure as role=alert outside any status region", () => {
    const alert = page(PrivacyPage, PRIVACY, { revokeError: "Incorrect password." }).querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain("Incorrect password.");
    expect(alert.closest('[role="status"]')).toBeNull();
  });
  it("passes axe's structural rules", async () => {
    const rules = ["button-name", "link-name", "label", "aria-allowed-attr", "aria-prohibited-attr"];
    const results = await runAxe(page(PrivacyPage, PRIVACY, { wipeDosesOk: true, removed: 3 }), rules);
    expect(results.violations).toEqual([]);
    for (const r of rules) expect(evaluatedRules(results).has(r), r).toBe(true);
  });
});
```

- [ ] **Step 5: Write the failing mount test.** Create `tests/unit/destructive-pages-mount.svelte.test.ts` (jsdom, client runtime).
  - Mock `$app/forms` as in `dose-write.svelte.test.ts`: `enhance: (form, submit) => { h.submits.set(form.getAttribute("action") ?? "(none)", submit); return { destroy() {} }; }`.
  - Mount the page with `props = $state({ data, form: null })`.

<!-- prettier-ignore -->
```ts
describe("privacy page", () => {
  it("opens the dose-history dialog inside its form, outside every GlassCard, with the counted summary", async () => {
    mountPage(PrivacyPage, PRIVACY);
    clickButton("Delete dose history"); await settle();
    const dialog = q('[role="dialog"]');
    expect(dialog.getAttribute("aria-label")).toBe("Delete dose history?");
    expect(dialog.textContent).toContain("This deletes 1,204 doses for 6 medications.");
    expect(dialog.closest("form")!.getAttribute("action")).toBe("?/wipeDoseHistory");
    expect(dialog.closest(".backdrop-blur-xl")).toBeNull();
    expect(dialog.querySelector('input[name="password"]')).not.toBeNull();   // hasPassword: true
  });
  it("opens the archived dialog with its own summary", async () => {
    /* "Delete archived medications" → aria-label "Delete archived medications?",
       text "This deletes 2 archived medications and the 340 doses logged for them." */
  });
  it("keeps a refused wipe in the dialog with the server's words", async () => {
    mountPage(PrivacyPage, PRIVACY); clickButton("Delete dose history"); await settle();
    const after = h.submits.get("?/wipeDoseHistory")!({} as never) as (o: unknown) => Promise<void>;
    await after({ result: { type: "failure", status: 400, data: { error: "Incorrect password." } }, update: vi.fn() });
    await settle();
    expect(q('[role="dialog"] [role="alert"]').textContent).toContain("Incorrect password.");
  });
});
```

- [ ] **Step 6: Run the tests and confirm they fail.** Run:

<!-- prettier-ignore -->
```sh
npx vitest run tests/unit/destructive-actions.test.ts tests/unit/pg/destructive-counts.test.ts \
  tests/unit/destructive-pages-ssr.test.ts tests/unit/destructive-pages-mount.svelte.test.ts
```

Expect these failures:

- The actions test fails the "refuses … without the word" cases. `wipeDoseHistory` is called, because today's `requirePassword` accepts the password alone.
- The actions test fails the "now runs for an account with no password" cases. They return `Password is required…`.
- The counts test fails: `doseMedications` and `archivedDoses` are undefined.
- The SSR test fails "opens each wipe from a secondary button…", because there is no `type="button"` "Delete dose history". It also fails "draws the Danger zone heading neutral", because of `text-warning`.
- The mount test fails because there is no dialog.

- [ ] **Step 7: Implement the server side.** Edit `src/routes/(app)/settings/privacy/+page.server.ts`.
  - **The load (`:14-40`).**
    - Fold the dose count into one query: `db.select({ value: count(), medications: countDistinct(doseLogs.medicationId) }).from(doseLogs).where(eq(doseLogs.userId, userId))`.
    - Add the archived-dose count: `db.select({ value: count() }).from(doseLogs).innerJoin(medications, eq(doseLogs.medicationId, medications.id)).where(and(eq(doseLogs.userId, userId), eq(medications.isArchived, true)))`.
    - Add `accountHasPassword(userId)` to the same `Promise.all`.
    - Return `counts.doseMedications`, `counts.archivedDoses` and `hasPassword`. The existing count keys are unchanged.
  - **The two wipe actions (`:61-84`).** Keep the 401 line first. Then:
    - `const guard = await checkDestructiveGuard(userId, formData, { word: "DELETE", purpose: "wipe_dose_history" })` (or `"wipe_archived_medications"`)
    - `if (!guard.ok) return fail(400, { error: guard.error })`
    - Then the wipe, unchanged.
  - **`requirePassword` (`:42-52`)** stays, now used by `revokeOtherSessions` only. Add one line to its comment: revoking sessions is not one of the four deletions, so it keeps the password-only gate. An account with no password still cannot use it; that is a separate follow-up (Out of scope).

- [ ] **Step 8: Implement the page.** Edit `src/routes/(app)/settings/privacy/+page.svelte`.
  - **Script.** Remove `wipeDosesPassword` and `wipeArchivedPassword` (`:9-10`). Add the following, and keep `revokePassword`:
    - `const doseHistory = createDestructiveDialog(), archived = createDestructiveDialog();`
    - `const removedLabel = (n: number, one: string, many: string) => …` for the two success lines, built with `formatCount`.
  - **Export links (`:73-90`).** Each becomes `<Button variant="secondary" href=…>`, with the same labels.
  - **Revoke region (`:103-113`).**
    - The persistent `<div role="status">` holds only `{#if form?.revokeOk}<Alert class="mb-3" tone="happened" title={`Revoked ${form.removed} session${form.removed === 1 ? "" : "s"}.`} />{/if}`.
    - The error becomes `{#if form?.revokeError}<Alert class="mb-3" tone="wrong" title={form.revokeError} />{/if}` as the region's next sibling (D8).
    - The submit (`:135-140`) becomes `<Button variant="secondary" type="submit">Revoke other sessions</Button>`.
  - **Danger zone heading (`:145`).** Drop `text-warning`.
  - **Each wipe section (`:148-192`, `:194-239`).**
    - The forms go. Keep the `h3` and the paragraph.
    - The persistent `<div role="status">` holds only the happened Alert (`class="mb-2"`, title from `removedLabel`).
    - Then `{#if data.counts.doseLogs > 0}<Button variant="secondary" onclick={doseHistory.show}>Delete dose history</Button>{:else}<p class="text-text-muted text-sm">{doseHistorySummary({ doses: 0, medications: 0 })}</p>{/if}`. Do the same for the archived section, with `archivedMedications` and `archivedMedicationsSummary`.
  - **"Go to delete account" (`:247-252`).** Becomes `<Button variant="secondary" href="/settings/data">Go to delete account</Button>`.
  - **After the page container's closing `</div>` (D9)**, add the two dialog forms:

<!-- prettier-ignore -->
```svelte
<form method="POST" action="?/wipeDoseHistory" use:enhance={doseHistory.submit}>
  <DestructiveConfirm
    open={doseHistory.open}
    onclose={doseHistory.close}
    title="Delete dose history?"
    summary={doseHistorySummary({ doses: data.counts.doseLogs, medications: data.counts.doseMedications })}
    word="DELETE"
    hasPassword={data.hasPassword}
    confirmLabel="Delete dose history"
    pending={doseHistory.pending}
    error={doseHistory.error}
  />
</form>
<!-- …and ?/wipeArchivedMedications with `archived`, "Delete archived medications?",
     archivedMedicationsSummary({ medications: data.counts.archivedMedications, doses: data.counts.archivedDoses }) -->
```

- **Result.** After these edits the page holds no status-token class. Delete `src/routes/(app)/settings/privacy/+page.svelte` from `PENDING_MIGRATION` in `tests/unit/status-colour-owner.test.ts`. The scan is two-way: a stale entry fails it.

- [ ] **Step 9: Run the tests and confirm they pass.** Run the step 6 command, plus `tests/unit/app-action-auth-guard.test.ts`, `tests/unit/mobile-nav-link-names-ssr.test.ts` and `tests/unit/status-colour-owner.test.ts`. Expect PASS.
  - **Mutation proofs.** Make each change below, confirm the named test fails, then revert:
    - Delete the guard call in `wipeDoseHistory`. Both "refuses a direct POST without the word…" cases fail.
    - Swap `countDistinct` for `count`. The counts test fails (`doseMedications` 5).
    - Drop `eq(medications.isArchived, true)`. The counts test fails (`archivedDoses` 5).
    - Drop the user scope. The counts test fails (`doseLogs` 9).
    - Move one dialog form inside the Danger zone `GlassCard`. The SSR "…outside every GlassCard" test and the mount test both fail.
    - Put the revoke error Alert inside the status `div`. "renders a Revoke failure … outside any status region" fails.

- [ ] **Step 10: Commit.** Commit with the message `feat(privacy): guard both wipes with a typed word and a counted summary, on Button and Alert`.

---

#### 7.4 Data: account deletion guarded, the page on `Button` and `Alert`

**Files:**

- `src/routes/(app)/settings/data/+page.server.ts`
- `src/routes/(app)/settings/data/+page.svelte`
- The four new test files, each extended
- `tests/unit/app-action-auth-guard.test.ts`
- `tests/unit/mobile-nav-link-names-ssr.test.ts`
- `tests/unit/pg/dose-trash-wipe.test.ts`
- `tests/unit/status-colour-owner.test.ts`

- [ ] **Step 1: Update the existing bodies and fixtures.**
  - In `app-action-auth-guard.test.ts:229`, change the fields to `{ confirmWord: "DELETE", password: "hunter2" }`.
  - In `pg/dose-trash-wipe.test.ts:260`, change the body to `new URLSearchParams({ confirmWord: "DELETE", password: "correct horse battery staple" })`. Extend the comment at `:24-25` to say that `u1` has no password, so the guard passes on the word and the mocked `confirmReauth` is never reached.
  - In `mobile-nav-link-names-ssr.test.ts:153`, change the Data fixture to `{ user, preferences, counts: { medications: 0, doses: 0 }, hasPassword: true }`.

- [ ] **Step 2: Write the failing tests.** Extend all four new files.
  - **`destructive-actions.test.ts`:** add `describe("data ?/deleteAccount")`. Assert the delete as `fakeDb.attempted.some((c) => c.op === "delete" && c.table === "users")`.

<!-- prettier-ignore -->
```ts
it("refuses a direct POST without the word, for both kinds of account, deleting nothing", async () => {
  for (const seed of [seedPassword, seedPasswordless]) {
    fakeDb.reset(); seed();
    expect(await call(data.actions, "deleteAccount", { password: "hunter2" }))
      .toMatchObject({ status: 400, data: { error: "Type DELETE to confirm." } });
    expect(deletedUser()).toBe(false);
    expect(lucia.invalidateUserSessions).not.toHaveBeenCalled();
  }
});
it("refuses a password account with the word but no password", async () => {
  /* → "Password is required to confirm this action.", no delete */
});
it("deletes a password account with the word and a confirmed password, and redirects home", async () => {
  seedPassword(); confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
  await expect(call(data.actions, "deleteAccount", { confirmWord: "DELETE", password: "hunter2" }))
    .rejects.toMatchObject({ status: 302, location: "/" });
  expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "delete_account");
  expect(deletedUser()).toBe(true);
});
it("now deletes an account with no password on the word alone", async () => {
  /* passwordless, { confirmWord: "DELETE" } → 302, deletedUser() true, confirmReauth not called */
});
```

- **`pg/destructive-counts.test.ts`:** add `it("counts what deleting the account removes")`. It calls `dataLoad({ locals: { user: { id: "u1" } } })` and expects `toMatchObject({ counts: { medications: 3, doses: 5 }, hasPassword: false })`.
- **`destructive-pages-ssr.test.ts`:** add `describe("data page")` with `DATA = { user, preferences, counts: { medications: 6, doses: 1204 }, hasPassword: false }`:
  - "Save Format is the primary submit": `button[type=submit]` has the text `Save Format`, and `classList` contains `bg-accent` and `h-11`.
  - "the downloads and Import Data are secondary links": `a[href="/api/export"]`, `a[href="/api/export/full"]` and `a[href="/settings/data/import"]` each have `h-11` and `border-border-strong`.
  - "Delete My Account is a secondary button in no form": `type="button"`, `border-border-strong`, `closest("form") === null`.
  - "the Danger Zone heading is neutral": the className does not match `STATUS`.
  - "the account dialog's form is empty while closed and outside every GlassCard": `form[action="?/deleteAccount"]`.
  - "Settings saved. is a happened Alert in the persistent status region": with `form: { success: true }`, the first `[role="status"]` contains `Settings saved.`.
  - axe, with the five rules used for Privacy.
- **`destructive-pages-mount.svelte.test.ts`:** add `describe("data page")`:
  - "opens the account dialog with its counted summary, asking a passwordless account for the word alone". Click `Delete My Account`, then check:
    - `aria-label` is `Delete your account?`;
    - the text contains `This deletes your account and settings, 6 medications and 1,204 doses.`;
    - the dialog's form action is `?/deleteAccount`;
    - there is no `input[name="password"]`;
    - there is no `.backdrop-blur-xl` ancestor.

- [ ] **Step 3: Run the tests and confirm they fail.** Run the four files plus `tests/unit/pg/dose-trash-wipe.test.ts`. Expect these failures:
  - The actions test: "refuses … without the word" fails for the password account, because the delete runs. Today the server never checked the word.
  - The actions test: "now deletes an account with no password" fails with `Password is required to delete your account.`.
  - The counts, SSR and mount tests fail on missing fields and markup.
  - `dose-trash-wipe` still passes. The old action ignores `confirmWord`.

- [ ] **Step 4: Implement the server side.** Edit `src/routes/(app)/settings/data/+page.server.ts`.
  - **The load (`:12-15`).** Use one `Promise.all` of four things:
    - `getOrCreatePreferences(userId)`
    - `count()` from `medications` where `userId` matches
    - `count()` from `doseLogs` where `userId` matches
    - `accountHasPassword(userId)`
  - It returns `{ preferences, counts: { medications, doses }, hasPassword }`.
  - **`deleteAccount` (`:33-59`).** Replace `:37-48` with the guard (`word: "DELETE", purpose: "delete_account"`) and `fail(400, { error: guard.error })`. The rest (audit, sessions, delete, cookie, redirect) is unchanged.

- [ ] **Step 5: Implement the page.** Edit `src/routes/(app)/settings/data/+page.svelte`.
  - **Script (`:2-10`).** Remove the `Modal` import and `showDeleteConfirm`, `deleteConfirmText` and `deletePassword`. Add `const account = createDestructiveDialog();`.
  - **Status region (`:24-28`).** Keep the persistent region and put `<Alert tone="happened" title="Settings saved." />` inside it.
  - **Save Format (`:52-57`).** Becomes `<Button variant="primary" type="submit">Save Format</Button>`.
  - **Download Export, Download Full Backup (JSON) and Import Data (`:61-72`, `:86-91`).** Each becomes `<Button variant="secondary" href=…>`.
  - **Danger Zone heading (`:95`).** Drop `text-danger-ink`.
  - **Delete My Account (`:99-105`).** Becomes `<Button variant="secondary" onclick={account.show}>Delete My Account</Button>`.
  - **The `Modal` block (`:109-158`).** Replace it with the following, still after the container, as today:

<!-- prettier-ignore -->
```svelte
<form method="POST" action="?/deleteAccount" use:enhance={account.submit}>
  <DestructiveConfirm
    open={account.open}
    onclose={account.close}
    title="Delete your account?"
    summary={accountDeletionSummary(data.counts)}
    word="DELETE"
    hasPassword={data.hasPassword}
    confirmLabel="Delete account"
    pending={account.pending}
    error={account.error}
  />
</form>
```

- **Result.** Delete `src/routes/(app)/settings/data/+page.svelte` from `PENDING_MIGRATION`.

- [ ] **Step 6: Run the tests and confirm they pass.** Run the step 3 command plus `app-action-auth-guard`, `mobile-nav-link-names-ssr` and `status-colour-owner`. Expect PASS.
  - **Mutation proof.** Delete the guard call in `deleteAccount`. "refuses a direct POST without the word, for both kinds of account" fails. Revert.

- [ ] **Step 7: Commit.** Commit with the message `feat(data): account deletion takes the word for every account, on Button and Alert`.

---

#### 7.5 Import: replace mode guarded, the page on `Button` and `Alert`

**Files:**

- `src/routes/(app)/settings/data/import/+page.server.ts`
- `src/routes/(app)/settings/data/import/+page.svelte`
- `destructive-actions.test.ts`, `destructive-pages-ssr.test.ts` and `destructive-pages-mount.svelte.test.ts`, each extended
- `tests/unit/status-colour-owner.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **`destructive-actions.test.ts`:** add `describe("import ?/commit")` and these mocks:
    - `$lib/server/auth/rate-limit` → `rateLimitSurface({ primitive: async () => ({ allowed: true, retryAfterMs: 0 }) })`
    - `$lib/server/import/pipeline` → `{ buildPlanFromFile: vi.fn(async () => ({ ok: true, plan: PLAN })) }`
    - `$lib/server/import/plan` → `{ planIsEmpty: () => false }`
    - `$lib/server/import/apply` → `{ applyImport: vi.fn(async () => ({ summary: PLAN.summary, importId: "i1" })) }`
  - `PLAN` is `{ format: "json", mode: "replace", summary: { medicationsCreated: 1, dosesCreated: 2, medicationsDeleted: 6, dosesDeleted: 1204 }, warnings: [], unmatchedNames: [], medications: [] }`, cast to `never`.
  - Posts carry a `file: new File(["{}"], "backup.json", { type: "application/json" })` plus `mode`.

<!-- prettier-ignore -->
```ts
it("refuses a replace posted without the word, for both kinds of account, writing nothing", async () => {
  for (const seed of [seedPassword, seedPasswordless]) {
    fakeDb.reset(); seed();
    expect(await call(dataImport.actions, "commit", { mode: "replace", password: "hunter2" }))
      .toMatchObject({ status: 400, data: { error: "Type REPLACE to confirm." } });
  }
  expect(applyImport).not.toHaveBeenCalled();
});
it("refuses a password account's replace with the word but no password — it used to need only the password", async () => {
  seedPassword();
  expect(await call(dataImport.actions, "commit", { mode: "replace", confirmWord: "REPLACE" }))
    .toMatchObject({ status: 400, data: { error: "Password is required to confirm this action." } });
  expect(applyImport).not.toHaveBeenCalled();
});
it("replaces for a password account with REPLACE and a confirmed password", async () => {
  seedPassword(); confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
  expect(await call(dataImport.actions, "commit", { mode: "replace", confirmWord: "REPLACE", password: "hunter2" }))
    .toEqual({ imported: PLAN.summary, importId: "i1" });
  expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "import_replace_data");
});
it("replaces for an account with no password on REPLACE, now posted as confirmWord", async () => {
  seedPasswordless();
  expect(await call(dataImport.actions, "commit", { mode: "replace", confirmPhrase: "REPLACE" }))
    .toMatchObject({ status: 400, data: { error: "Type REPLACE to confirm." } });   // the old field no longer counts
  expect(await call(dataImport.actions, "commit", { mode: "replace", confirmWord: "REPLACE" }))
    .toEqual({ imported: PLAN.summary, importId: "i1" });
});
it("asks nothing of a merge", async () => {
  seedPassword();
  expect(await call(dataImport.actions, "commit", { mode: "merge" })).toEqual({ imported: PLAN.summary, importId: "i1" });
  expect(confirmReauth).not.toHaveBeenCalled();
});
it("reports every other failure under `error` too, so the dialog shows the server's words", async () => {
  expect(await call(dataImport.actions, "commit", { mode: "merge", file: "" }))
    .toMatchObject({ status: 400, data: { error: "Choose a file to import." } });
});
```

- **`destructive-pages-ssr.test.ts`:** add `describe("import page")` with `IMPORT = { user, preferences, medications: [], hasPassword: true, maxBytes: 5_242_880, timezone: "UTC" }`:
  - "announces Import complete from a status region that is always there".
    - With `form: null`: `#import-outcome[role=status]` exists, is empty, and is not inside a `form`.
    - With `form: { imported: { medicationsCreated: 2, medicationsReused: 1, dosesCreated: 1204, dosesSkipped: 3, inventoryEventsCreated: 0, medicationsDeleted: 4, dosesDeleted: 900 }, importId: "i1" }`: the region contains `Import complete` and `1204 dose entries added`.
    - The `li` holding `4 medications and 900 dose entries were replaced` has a className that does not match `STATUS`.
  - "after an import, View medications is primary and Back to Data is ghost": `a[href="/medications"]` has `bg-accent` and `h-11`. The `a` whose text is `Back to Data` has `h-11` and no `border`.
  - "a failure is a role=alert outside the preview-ready status region": with `form: { error: "That file is over the 5 MB limit." }`.
  - "the Replace everything card is neutral and still says it can't be undone": the `label` containing `Replace everything` has a subtree whose classNames do not match `STATUS`, and its text contains `Cannot be undone.`.
  - "a replace preview flags its deletions and its warnings as needs-you Alerts, not alerts". With `form.preview = { format: "json", mode: "replace", summary: {…, medicationsDeleted: 6, dosesDeleted: 1204 }, warnings: ["1 row was skipped (bad date)."], unmatchedNames: [], createdNames: [], reusedNames: [], empty: false }`:
    - the text contains `Replace mode will first delete 6 medications and`;
    - the text contains `Check before importing` and the warning;
    - `doc.querySelector('[role="alert"]')` is null.
  - "Preview is a secondary submit and Import is a primary submit, in merge mode": `formaction` is `?/preview`, then `?/commit`. Classes are `border-border-strong` and `bg-accent`.
  - axe, with the same five rules.
- **`destructive-pages-mount.svelte.test.ts`:** add `describe("import page")`. Mount with `form: { preview: REPLACE_PREVIEW }`, then click `input[value="replace"]` and settle.

<!-- prettier-ignore -->
```ts
it("swaps Import for a secondary 'Replace all data' that opens the dialog with the preview's counts", async () => {
  const entry = button("Replace all data");
  expect([entry.getAttribute("type"), entry.disabled]).toEqual(["button", false]);
  entry.click(); await settle();
  const dialog = q('[role="dialog"]');
  expect(dialog.getAttribute("aria-label")).toBe("Replace all your data?");
  expect(dialog.textContent).toContain(
    "This deletes 6 medications and 1,204 doses, with their schedules and inventory history, then imports the file.");
  expect(q('input[name="confirmWord"]').labels![0].textContent!.replace(/\s+/g, " ").trim()).toBe("Type REPLACE to confirm");
});
it("puts the dialog's submit first in the form, posting to ?/commit, outside every GlassCard", async () => {
  button("Replace all data").click(); await settle();
  const form = q("form");
  const danger = button("Replace all data", '[role="dialog"]');
  expect(form.querySelector('button[type="submit"]')).toBe(danger);      // the default button: Enter submits the dialog
  expect(danger.getAttribute("formaction")).toBe("?/commit");
  expect(danger.closest(".backdrop-blur-xl")).toBeNull();
});
it("keeps a refused replace in the dialog", async () => {
  /* open; h.submits.get("(none)")!(…) then after({ result: failure { error: "Incorrect password." }, update })
     → update not called, '[role="dialog"] [role="alert"]' contains "Incorrect password." */
});
it("after a successful replace, announces it and parks focus on the page heading", async () => {
  button("Replace all data").click(); await settle(); fillReady("REPLACE", "hunter2");
  const after = h.submits.get("(none)")!({} as never) as (o: unknown) => Promise<void>;
  await after({
    result: { type: "success", status: 200, data: { imported: IMPORTED, importId: "i1" } },
    update: async () => { props.form = { imported: IMPORTED, importId: "i1" }; flushSync(); },
  });
  await settle();
  expect(q("#import-outcome").textContent).toContain("Import complete");
  expect(document.activeElement).toBe(q("h1"));
});
```

- [ ] **Step 2: Run the tests and confirm they fail.** Run the three files. Expect these failures:
  - "refuses a replace posted without the word" fails for the password account, because `applyImport` is called. Today the password alone sufficed.
  - "…with the word but no password" fails on `importError: "Enter your password…"`.
  - "reports every other failure under `error`" fails on `importError`.
  - The SSR and mount tests fail on markup.

- [ ] **Step 3: Implement the server side.** Edit `src/routes/(app)/settings/data/import/+page.server.ts`.
  - Delete `REPLACE_PHRASE` (`:25`).
  - **The load (`:64-86`).** Replace the inline `users` select with `accountHasPassword(userId)`. Rewrite the comment at `:79-82`: every account types REPLACE in the dialog, and an account with a password also enters it (`checkDestructiveGuard`).
  - **The replace check (`:235-257`).** Replace it with:

<!-- prettier-ignore -->
```ts
if (options.mode === "replace") {
  const guard = await checkDestructiveGuard(userId, upload.formData, { word: "REPLACE", purpose: "import_replace_data" });
  if (!guard.ok) return fail(400, { error: guard.error });
}
```

- **The other failure keys.** Rename every remaining `importError:` key to `error:` (`:189`, `:194`, `:199`, `:206`, `:222`, `:227`, `:232`, `:266`, `:272`, `:282`, `:293`).
- **Imports.** Drop the now-unused `users`, `confirmReauth` and `reauthMessage` imports.
- **Order.** The limiter order is unchanged. The guard still runs after `importAttempt` and before `importCommit`, so a mistyped password still spends no commit.

- [ ] **Step 4: Implement the page.** Edit `src/routes/(app)/settings/data/import/+page.svelte`.
  - **Script.**
    - Remove `password` and `confirmPhrase` (`:14-15`) and `replaceConfirmed` (`:70-72`).
    - `canCommit` becomes `preview !== null && !preview.empty && !needsMapping && !submitting`. Both the merge submit and the replace entry use it.
    - Add `const replaceDialog = createDestructiveDialog();`.
    - Replace `submitHandler` (`:79-87`) with the following. The order matters (D3, D10):

<!-- prettier-ignore -->
```ts
function submitHandler() {
  const signatureAtSubmit = currentSignature;
  // The dialog is modal: while it is open its submit is the only one reachable.
  const fromDialog = replaceDialog.open;
  submitting = true;
  if (fromDialog) replaceDialog.begin();
  return async ({
    result,
    update,
  }: {
    result: ActionResult;
    update: (opts?: { reset?: boolean }) => Promise<void>;
  }) => {
    if (fromDialog && replaceDialog.settle(result)) {
      submitting = false;
      return;
    }
    try {
      await update({ reset: false });
    } finally {
      if (fromDialog) replaceDialog.finish();
      previewSignature = signatureAtSubmit;
      submitting = false;
    }
    // A successful commit replaces the form, and the control that had focus with it.
    if (result.type === "success") {
      await tick();
      focusIfLost(pageHeading);
    }
  };
}
```

- **Outcome (`:103-138`).**
  - Before `{#if imported}`, add `<div id="import-outcome" role="status">{#if imported}<Alert tone="happened" title="Import complete"><ul class="space-y-1">…the same <li>s…</ul></Alert>{/if}</div>`.
  - The "were replaced" `li` loses `text-danger-ink` (D7).
  - The `{#if imported}` branch is now just `<div class="flex gap-3"><Button variant="primary" href="/medications">View medications</Button><Button variant="ghost" href="/settings/data">Back to Data</Button></div>`. The `GlassCard` and its `text-success` heading go.
  - Leave the empty region inside `space-y-6`, as Data's region (`data/+page.svelte:24`) already is.
- **The form.** Directly after `<input type="hidden" name="mapping">` (`:141`) and before the first `GlassCard` (D9), add:

<!-- prettier-ignore -->
```svelte
<DestructiveConfirm
  open={replaceDialog.open}
  onclose={replaceDialog.close}
  title="Replace all your data?"
  summary={replaceSummary({
    medications: preview?.summary.medicationsDeleted ?? 0,
    doses: preview?.summary.dosesDeleted ?? 0,
  })}
  word="REPLACE"
  hasPassword={data.hasPassword}
  confirmLabel="Replace all data"
  formaction="?/commit"
  pending={replaceDialog.pending}
  error={replaceDialog.error}
/>
```

- **The Replace everything card (`:188-197`).** The `label` becomes `border-glass-border`, and the title `span` drops `text-danger-ink` (D7).
- **The confirmation box (`:200-228`).** Delete it. Its fields now live in the dialog.
- **The status region (`:271-279`).**
  - It keeps only `{#if preview && !form?.error}<p class="sr-only">Import preview ready…</p>{/if}`.
  - After it, as a sibling, comes `{#if form?.error}<Alert tone="wrong" title={form.error} />{/if}` (D8).
- **The replace callout (`:308-313`).** Becomes `<Alert class="mt-3" tone="needs-you" title={`Replace mode will first delete ${preview.summary.medicationsDeleted} medications and ${preview.summary.dosesDeleted} dose entries.`} />`.
- **The warnings (`:328-334`).** Become `<Alert class="mt-3" tone="needs-you" title="Check before importing"><ul class="list-disc space-y-1 pl-4">{#each preview.warnings as warning}<li>{warning}</li>{/each}</ul></Alert>`. Keep the `each` unkeyed, as it is today: two identical warnings would make a keyed each throw, and the lint baseline already counts it.
- **The buttons (`:378-399`).**
  - Preview becomes `<Button variant="secondary" type="submit" formaction="?/preview" disabled={submitting}>`.
  - Then `{#if mode === "replace"}<Button variant="secondary" disabled={!canCommit} onclick={replaceDialog.show}>Replace all data</Button>{:else}<Button variant="primary" type="submit" formaction="?/commit" disabled={!canCommit}>Import</Button>{/if}`.
  - Real `disabled` stays, as today, keeping each site's semantics.
- **Result.** Delete `src/routes/(app)/settings/data/import/+page.svelte` from `PENDING_MIGRATION`.

- [ ] **Step 5: Run the tests and confirm they pass.** Run the step 2 command plus `status-colour-owner`, `mobile-nav-link-names-ssr` and `app-action-auth-guard`. Expect PASS.
  - **Mutation proofs.** Make each change below, confirm the named test fails, then revert:
    - Move `<DestructiveConfirm>` below the button row. "puts the dialog's submit first in the form…" fails.
    - Move it into the first `GlassCard`. The same test fails on `.backdrop-blur-xl`.
    - Delete the `focusIfLost(pageHeading)` line. "…parks focus on the page heading" fails.
    - Restore the `account?.passwordHash` branch that skips the word. "refuses a replace posted without the word, for both kinds of account" fails.
    - Drop the `{#if imported}` Alert out of `#import-outcome`. "announces Import complete from a status region that is always there" fails.

- [ ] **Step 6: Commit.** Commit with the message `feat(import): replace mode takes REPLACE and the password, on Button and Alert`.

---

#### 7.6 Write down the browser/API difference

**Files:**

- `src/routes/api/v1/auth/reauth/+server.ts`
- `src/lib/server/api/commands.ts`
- `docs/api-v1-contract.md`
- `CLAUDE.md`

- [ ] **Step 1: Rewrite the reauth endpoint's comments.**
  - In `src/routes/api/v1/auth/reauth/+server.ts:12-13`, say that the browser doors ask for a typed word for every account plus the password where there is one (`checkDestructiveGuard`).
  - Replace `:44-47`, which claims "the same position the browser is in", with the difference, stated as decided on 2026-10-16:
    - The browser lets an account with no password delete on the typed word alone.
    - This door keeps requiring a password-minted token and takes no word.
    - So an OAuth-only account cannot wipe through the API, and a stolen bearer token alone never can.
- [ ] **Step 2: Correct the commands comment.** In `src/lib/server/api/commands.ts:136-140`, change "guards with a password prompt" to "guards with a typed word and, where the account has one, the password".
- [ ] **Step 3: Correct the API contract.** In `docs/api-v1-contract.md`, rewrite two passages:
  - `:154-157` ("matching the web privacy page, which likewise offers them no alternative confirmation")
  - `:519-526` ("the browser has always demanded a password … the same position it is in on the web privacy page")

  Each must state the deliberate difference in the terms above. Keep everything else in those paragraphs.

- [ ] **Step 4: Add the CLAUDE.md bullet.** In `CLAUDE.md`, add one bullet under "Key Patterns", after the `actionErrorMessage` bullet:

<!-- prettier-ignore -->
```md
- **`checkDestructiveGuard` (`src/lib/server/auth/destructive-guard.ts`) is the one gate on the four browser deletions nothing can undo** — Privacy's two wipes, Data's account deletion and Import's replace mode. Each action calls it after its 401 check and before any write: a typed word (`DELETE`, or `REPLACE`), trimmed and case-sensitive, for every account, and `confirmReauth` only where the account has a password, checked word first so a mistyped word spends no reauth attempt. Posting the form directly therefore skips nothing, and an account with no password runs all four on the word alone, which `confirmReauth` alone had made impossible. Its failure is `fail(400, { error })`, the shape `actionErrorMessage` reads. The UI half is `ui/DestructiveConfirm.svelte`, rendered inside the form it submits, and that form must sit outside every `GlassCard`: `backdrop-blur-xl` makes the card the containing block for Modal's `fixed` scrim. **`/api/v1` differs on purpose**: its two wipes still redeem a password-minted reauth token and take no word, so an OAuth-only account cannot wipe through the API and a stolen bearer token alone never can (`docs/api-v1-contract.md`).
```

- [ ] **Step 5: Format and commit.** Run `npm run format:check`. Then commit with the message `docs: record that browser deletions take a typed word and the API does not`.

---

#### 7.7 Gates

- [ ] **Step 1: Run this task's tests.** Expect all to pass:

<!-- prettier-ignore -->
```sh
npx vitest run tests/unit/destructive-summary.test.ts tests/unit/destructive-guard.test.ts \
  tests/unit/destructive-confirm.svelte.test.ts tests/unit/destructive-dialog.test.ts \
  tests/unit/destructive-actions.test.ts tests/unit/pg/destructive-counts.test.ts \
  tests/unit/destructive-pages-ssr.test.ts tests/unit/destructive-pages-mount.svelte.test.ts \
  tests/unit/app-action-auth-guard.test.ts tests/unit/mobile-nav-link-names-ssr.test.ts \
  tests/unit/pg/dose-trash-wipe.test.ts tests/unit/status-colour-owner.test.ts
```

The file count must include `tests/unit/pg/*`. If PGlite is missing, they fail to import and the run proves less than it says.

- [ ] **Step 2: Run the whole suite.** Run `npx vitest run`. Expect 0 failures.
- [ ] **Step 3: Type-check.** Run `npm run check`. Expect 0 errors and no more than 27 warnings.
- [ ] **Step 4: Lint.** Run `npm run lint`. Expect 0 errors and no more than 115 warnings.
- [ ] **Step 5: Check formatting.** Run `npm run format:check`. Expect it to be clean. (The browser checks for the four dialogs are rows in Task 13's preview pass.)

### Task 8: Settings pages — profile, security, notifications, appearance → `Button` / `Alert`, neutral states

Every file below was read at `925be44`; `file:line` anchors are HEAD's.

**Files**

- Modify: `src/routes/(app)/settings/+page.svelte`, `src/routes/(app)/settings/security/+page.svelte`, `src/routes/(app)/settings/notifications/+page.svelte`, `src/routes/(app)/settings/appearance/+page.svelte`
- Create: `tests/unit/helpers/alert-dom.ts`, `tests/unit/settings-pages-ssr.test.ts` (node), `tests/unit/settings-pages-mount.svelte.test.ts` (jsdom)
- Modify (tests): `tests/unit/helpers/axe-ssr.ts` (adds `expectAxeClean`), `tests/unit/form-errors-aria-ssr.test.ts`, `tests/unit/appearance-page-ssr.test.ts`, `tests/unit/status-colour-owner.test.ts` (PENDING removals)

**Interfaces**

- Consumes: `Button`, `Alert` (T2, T3); `toneClass`, `toneOf` from `$lib/utils/status-tone` (T1); `actionErrorMessage(result, fallback)` (`src/lib/utils/form-errors.ts:30`).
- Produces (test seams T9 reuses):
  - `tests/unit/helpers/alert-dom.ts`: `alertTitled(root: ParentNode, title: string): HTMLElement | null` and `expectClasses(el: Element, classes: string): void`.
  - `tests/unit/helpers/axe-ssr.ts`: `expectAxeClean(doc: Document, rules: string[]): Promise<void>`.
  - `assertiveAlert(id: string, message: string): RegExp`, local to `form-errors-aria-ssr.test.ts`.

**Decisions** (spec table and Button/Alert rules applied per site)

| Site (HEAD anchor)                                                         | Today                                                                                                   | After                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Profile success `settings/+page.svelte:21-27`                              | `<p bg-success/10>` in a persistent `role="status"`                                                     | same wrapper, `<Alert tone="happened" title="Settings saved successfully." class="mb-4" />`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Profile Save `:62-67`                                                      | `py-2.5` accent                                                                                         | `<Button variant="primary" type="submit">Save Changes</Button>` (no pending: the site had no loading state)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Profile `timezone-error` `:55-59`                                          | field error                                                                                             | **unchanged** (spec non-goal; the T1 scan masks it)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Security success x3 `security/+page.svelte:29-35, 78-89`                   | green `<p>` in persistent `role="status"`                                                               | same wrappers, `Alert tone="happened" class="mb-4"`, copy unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `totp-error` `:94-102`                                                     | `<p id="totp-error" bg-danger/10 role="alert">`                                                         | `<Alert tone="wrong" id="totp-error" title={form.totpError} class="mb-4" />` — `describedBy="totp-error"` on the three inputs stays                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Update Password `:63-68`, Verify `:135-140`, Set Up 2FA `:206-211`         | accent `py-2.5`                                                                                         | `Button variant="primary" type="submit"`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Disable 2FA `:179-184`, Sign Out `:286-291`                                | red outline                                                                                             | `Button variant="secondary" type="submit"` (reversible)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Revoke `:252-258`                                                          | red outline, ~28px                                                                                      | `<Button variant="secondary" size="sm" type="submit" aria-label="Revoke session {i + 1}">Revoke</Button>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2FA "Enabled" chip `:147-149`                                              | `bg-success/10 text-success rounded-full`                                                               | `class="{toneClass(toneOf('state'), 'chip')} rounded-md px-2 py-0.5 text-xs font-semibold"` (spec: chip radius 6px, weight 600)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| "Current" session chip `:233-238`                                          | accent                                                                                                  | **unchanged** (spec: selected/current stays accent)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `sessionError` (server `+page.server.ts:95,106`)                           | **never rendered** — a refused revoke was silent                                                        | `{#if form?.sessionError}<Alert tone="wrong" title={form.sessionError} class="mb-4" />` at the top of the Active Sessions card                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `sessionRevoked` (`+page.server.ts:110`)                                   | never rendered                                                                                          | persistent `<div role="status">` at the top of that card, `Alert tone="happened" title="Session revoked."`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Sign Out failure `:275-285`                                                | callback handles only `success`; every other result silent                                              | callback: `signOutError = null` on submit; `success` → `goto("/auth/login")`; anything else → `signOutError = actionErrorMessage(result, "Couldn't sign out — please try again.")`, drawn as `{#if signOutError}<Alert tone="wrong" title={signOutError} class="mt-4" />` under the form. No pending (no loading state today).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Notifications save `notifications/+page.svelte:149-155`                    | green `<p>` in page-level `role="status"`                                                               | same region, now carries **both** "happened" outcomes: `form?.success` → `Alert "Notification settings saved."`; `form?.resendOk && form.alreadyVerified` → `Alert "Email already verified."`; `form?.resendOk` → `Alert "Verification email sent."` with body `Check your inbox (and spam folder).`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Email-unverified panel `:157-185`                                          | amber box; `role="status"` on its first line; resend ok/error lines in no live region (never announced) | `GlassCard` > `<Alert tone="needs-you" title="Verify your email to enable email reminders.">` whose `action` snippet is the `?/resendVerification` form with `<Button variant="secondary" size="sm" type="submit">Resend verification email</Button>`; the old `role="status"` goes (static content present at load is never announced, and a live region around the form re-announces the button). `form?.resendError` → `<Alert tone="wrong" title={form.resendError} class="mt-3" />` inside the same card. The resend **success** lives in the page-level region, not the panel, because `alreadyVerified` reloads `data.emailVerified = true`, which unmounts the panel at the moment it has something to say.                                                            |
| Email not configured `:186-195`                                            | neutral box `role="status"`                                                                             | `<Alert tone="neutral" title="Email is not configured on this deployment, so email reminders won't be sent." />` (role `note`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Save Changes `:273-278`                                                    | accent `py-2.5` (32px under compact)                                                                    | `Button variant="primary" type="submit"`; no pending (none today)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Push Enable/Disable `:307-316`                                             | Enable accent, Disable red                                                                              | `<Button variant={pushEnabled ? "secondary" : "primary"} size="sm" onclick={togglePush} disabled={pushLoading} pending={pushLoading} pendingLabel="Updating…">{pushEnabled ? "Disable" : "Enable"}</Button>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| "Push notifications are active…" `:318-320`                                | `text-success`                                                                                          | `toneClass(toneOf("state"), "text")`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Push service `dd` `:340-342`                                               | green / amber by value                                                                                  | `class={toneClass(toneOf("state"), "text")}` for both values; the words carry it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Both push preferences off `:374-379`                                       | `text-warning` line                                                                                     | `<Alert tone="needs-you" title="Both push preferences above are off, so real reminders won't be sent to these devices.">A test notification will still arrive.</Alert>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Send test `:398-406`                                                       | accent, "Sending..."                                                                                    | `<Button variant="secondary" size="sm" type="submit" disabled={testing \|\| !data.pushHealth.vapidConfigured \|\| data.pushHealth.deviceCount === 0} pending={testing} pendingLabel="Sending…">Send test notification</Button>` — secondary sm as drawn in `buttons-alerts.html` ("Proposed · any density"); real `disabled` kept                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Test result region `:409-432`                                              | one `role="status"` holding error, success, confirm, timeout lines                                      | `form?.testError` moves OUT, above the region: `<Alert tone="wrong" title={form.testError} />` (an assertive region nested in a polite one is what `Toast.svelte:204-209` removed). Region keeps the muted "Enable push…" hint, then `form?.testOk` → `<Alert tone="happened" title={form.testMessage}>` whose body is "Waiting for this device to confirm it displayed…" (awaiting) or "Confirmed displayed on this device." (confirmed); `confirmationTimedOut` → `<Alert tone="needs-you" title="This device didn't confirm it displayed the notification.">Check notification permissions for this site in your browser and operating system.</Alert>`. Class `space-y-1` → `space-y-2`. Update the comment at `:409-410` to say errors are assertive and live outside it. |
| Appearance no-JS Saves `appearance/+page.svelte:408-413, 453-458, 505-510` | accent `py-2`                                                                                           | `<Button variant="primary" size="sm" type="submit" class="mt-2">` (labels unchanged)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Appearance no-JS feedback `:415-419, 460-464, 512-516`                     | `<p text-success / text-danger-ink>`                                                                    | `<Alert tone={feedback.ok ? "happened" : "wrong"} title={feedback.text} class="mt-2" />`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Stale comment `appearance/+page.svelte:366-372`                            | says Toast items carry `role="alert"`; cites `notifications:406-408`                                    | replace with the exact text in step 8.5                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

- [ ] **8.1 Test seams.** Create `tests/unit/helpers/alert-dom.ts`; add `expectAxeClean` to `tests/unit/helpers/axe-ssr.ts`.

<!-- prettier-ignore -->
```ts
// tests/unit/helpers/alert-dom.ts
import { expect } from "vitest";

/**
 * The `Alert` (src/lib/components/ui/Alert.svelte) whose headline contains
 * `title`. Its root is a <div> whose FIRST element child is the aria-hidden
 * icon, so the root is the innermost such div whose text holds the title.
 */
export function alertTitled(root: ParentNode, title: string): HTMLElement | null {
  const roots = [...root.querySelectorAll<HTMLElement>("div")].filter((el) => {
    const icon = el.firstElementChild;
    return icon?.localName === "svg" && icon.getAttribute("aria-hidden") === "true"
      && (el.textContent ?? "").includes(title);
  });
  return roots.at(-1) ?? null;
}

/** Every class in the space-separated `classes` is on `el`. */
export function expectClasses(el: Element, classes: string): void {
  for (const c of classes.split(/\s+/).filter(Boolean)) {
    expect(el.classList.contains(c), `no "${c}" on <${el.localName} class="${el.getAttribute("class")}">`).toBe(true);
  }
}

// tests/unit/helpers/axe-ssr.ts — appended
export async function expectAxeClean(doc: Document, rules: string[]): Promise<void> {
  const results = await runAxe(doc, rules);
  const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
  expect(offenders, offenders.join("\n")).toEqual([]);
  for (const rule of rules) expect(evaluatedRules(results).has(rule), `${rule} evaluated nothing`).toBe(true);
}
```

No commit yet; the helpers land with 8.2.

- [ ] **8.2 Profile — failing tests.** Create `tests/unit/settings-pages-ssr.test.ts` (`// @vitest-environment node`, header comment citing `appearance-page-ssr.test.ts` for why). Fixtures `user` and `preferences` copied from `form-errors-aria-ssr.test.ts:233-262`. Pages render through `Page as Component<{ data: unknown; form: unknown }>` exactly as `mobile-nav-link-names-ssr.test.ts:182-185` does, so fixtures carry only what the markup reads.

<!-- prettier-ignore -->
```ts
const page = (Page: unknown, data: unknown, form: unknown = null) =>
  ssrDocument(render(Page as Component<{ data: unknown; form: unknown }>, { props: { data, form } }).body);
const submitOf = (doc: Document, action: string) =>
  doc.querySelector<HTMLButtonElement>(`form[action="${action}"] button[type="submit"]`)!;

describe("/settings (profile)", () => {
  const data = { user, preferences };

  it("announces a save from the status region that was already mounted", () => {
    const idle = page(Profile, data).querySelector('[role="status"]');
    expect(idle, "the region must exist before the result does").not.toBeNull();
    expect(textOf(idle!)).toBe("");
    const alert = alertTitled(page(Profile, data, { success: true }), "Settings saved successfully.");
    expect(alert).not.toBeNull();
    expect(alert!.closest('[role="status"]')).not.toBeNull();
    expect(alert!.getAttribute("role")).toBeNull();
    expectClasses(alert!, toneClass("happened", "alert"));
  });

  it("draws Save Changes as a fixed-height primary submit, not padding", () => {
    const save = page(Profile, data).querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    expect(accessibleName(save)).toBe("Save Changes");
    expectClasses(save, "h-11 bg-accent text-accent-fg");
    expect(save.classList.contains("py-2.5")).toBe(false);
  });

  it("passes axe after a save", async () => {
    await expectAxeClean(page(Profile, data, { success: true }),
      ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role"]);
  });
});
```

Run `npx vitest run tests/unit/settings-pages-ssr.test.ts`. Expect FAIL: `expected null not to be null` (first test) and `no "h-11" on <button …>` (second); axe passes or fails on `aria-hidden-focus evaluated nothing`.

- [ ] **8.3 Profile — implement.** In `src/routes/(app)/settings/+page.svelte` import `Alert` and `Button` from `$lib/components/ui/`; apply the two profile rows of the table. Remove `src/routes/(app)/settings/+page.svelte` from `PENDING_MIGRATION` in `tests/unit/status-colour-owner.test.ts` (the only remaining literal is the masked `timezone-error` line). Run the file and `tests/unit/status-colour-owner.test.ts tests/unit/form-errors-aria-ssr.test.ts` → PASS (form-errors' `/settings` cases are untouched: `<p id="timezone-error"…role="alert">` is unchanged).

Mutation proofs: put the `{#if form?.success}` outside the `role="status"` div → "announces a save…" fails on `closest`; restore `py-2.5` without `Button` → "fixed-height" fails.

Commit: `refactor(settings): profile save and banner through Button and Alert`

- [ ] **8.4 Security — failing tests.** In `form-errors-aria-ssr.test.ts`, add the helper and change `:306`:

<!-- prettier-ignore -->
```ts
/**
 * An assertive `Alert`: its id first, role="alert", the aria-hidden icon,
 * and then the message as the first text — the same "message directly
 * inside the alert" property the old `<div>`/`<p>` regexes held, with the
 * icon (and Svelte's comment markers) the only things allowed before it.
 */
function assertiveAlert(id: string, message: string): RegExp {
  return new RegExp(
    String.raw`<div id="${id}"[^>]*\brole="alert"[^>]*>\s*(?:<!--[\s\S]*?-->\s*)*<svg\b[^>]*\baria-hidden="true"[^>]*>[\s\S]*?</svg>\s*(?:<[^>]+>\s*)*` + message,
  );
}

// :306, was /<p id="totp-error"[^>]*role="alert"/ — now also pins the message
expect(html).toMatch(assertiveAlert("totp-error", "Incorrect password"));
```

The rest of that describe (`describedBy` on the three inputs, `expectNoErrorWiring` with `form: null`) is unchanged and must stay green: the sessions status region added below carries no `-error"` id.

In `settings-pages-ssr.test.ts` add `describe("/settings/security")` with `base = { user, preferences, sessions: SESSIONS, currentSessionId: "s1", twoFactorEnabled: false }`, `SESSIONS = [{ id: "s1", expiresAt: new Date("2026-11-01T00:00:00Z") }, { id: "s2", expiresAt: new Date("2026-11-02T00:00:00Z") }]`, and `sessionsCard(doc)` = the parent of the `h2` whose text is "Active Sessions" (GlassCard's root).

<!-- prettier-ignore -->
```ts
it.each([
  ["Password updated successfully.", { passwordSuccess: true }],
  ["Two-factor authentication enabled successfully.", { totpEnabled: true }],
  ["Two-factor authentication disabled.", { totpDisabled: true }],
])("announces %s from its card's persistent status region", (title, form) => {
  const alert = alertTitled(page(Security, base, form), title)!;
  expect(alert.closest('[role="status"]')).not.toBeNull();
  expect(alert.getAttribute("role")).toBeNull();
  expectClasses(alert, toneClass("happened", "alert"));
});

it.each([
  // [name, action, variant classes, height, data override, form]
  ["Update Password", "?/changePassword", "bg-accent text-accent-fg", "h-11", {}, null],
  ["Set Up 2FA", "?/setupTwoFactor", "bg-accent text-accent-fg", "h-11", {}, null],
  ["Verify", "?/verifyTwoFactor", "bg-accent text-accent-fg", "h-11", {}, { totpSetup: { qrCode: "data:image/png;base64,AA==", secret: "ABC" } }],
  ["Disable 2FA", "?/disableTwoFactor", "border-border-strong text-text-primary", "h-11", { twoFactorEnabled: true }, null],
  ["Sign Out", "?/logout", "border-border-strong text-text-primary", "h-11", {}, null],
])("draws %s as a Button of the right kind", (name, action, variant, height, over, form) => {
  const submit = submitOf(page(Security, { ...base, ...over }, form), action);
  expect(accessibleName(submit)).toBe(name);
  expectClasses(submit, `${variant} ${height}`);
});

it("names each Revoke by its session and draws it as a 36px secondary", () => {
  const revoke = submitOf(page(Security, base), "?/revokeSession");
  expect(revoke.getAttribute("aria-label")).toBe("Revoke session 2");
  expect(textOf(revoke)).toBe("Revoke");
  expectClasses(revoke, "h-9 border-border-strong text-text-primary");
});

it("shows 2FA 'Enabled' as a neutral state chip", () => {
  const doc = page(Security, { ...base, twoFactorEnabled: true });
  const chip = [...doc.querySelectorAll("span")].find((s) => textOf(s) === "Enabled")!;
  expectClasses(chip, toneClass("neutral", "chip"));
});

it("reports a refused revoke, which the action returned and the page never drew", () => {
  const doc = page(Security, base, { sessionError: "Session not found" });
  const alert = alertTitled(doc, "Session not found")!;
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.closest('[role="status"]'), "an error never sits in the polite region").toBeNull();
  expect(sessionsCard(doc).contains(alert)).toBe(true);
});

it("announces a revoke from a region the Active Sessions card always renders", () => {
  expect(sessionsCard(page(Security, base)).querySelector('[role="status"]')).not.toBeNull();
  const doc = page(Security, base, { sessionRevoked: true });
  const alert = alertTitled(sessionsCard(doc), "Session revoked.")!;
  expect(alert.closest('[role="status"]')).not.toBeNull();
});

it("passes axe with 2FA on and a refused revoke", async () => {
  await expectAxeClean(page(Security, { ...base, twoFactorEnabled: true }, { sessionError: "Session not found" }),
    ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role", "nested-interactive"]);
});
```

Create `tests/unit/settings-pages-mount.svelte.test.ts` (jsdom; the `.svelte.` infix is load-bearing, see `log-page-mount.svelte.test.ts:1-6`). Mocks, hoisted once:

<!-- prettier-ignore -->
```ts
type Sent = { action: string; finish: (result: ActionResult) => Promise<void> };
const sent = vi.hoisted(() => [] as Sent[]);
const goto = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock("$app/navigation", () => ({ goto }));
vi.mock("$lib/components/ui/Toast.svelte", () => ({ showToast: vi.fn() }));
// SvelteKit's enhance reduced to its two-phase contract (log-page-mount.svelte.test.ts:44-75):
// the SubmitFunction runs on submit (it is undefined for a bare use:enhance), and the
// callback it returns runs when the test calls finish(result).
vi.mock("$app/forms", () => ({ enhance: (form: HTMLFormElement, submit?: SubmitFunction) => { /* as there */ } }));
```

<!-- prettier-ignore -->
```ts
describe("Sign Out", () => {
  it("shows a failed sign-out as an assertive Alert and stays on the page", async () => {
    const target = mountSecurity(); // data: base with sessions: []
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({ type: "error", status: 500,
      error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" } });
    flushSync();
    const alert = alertTitled(target, "Something went wrong on our end. (reference a3f10c9e)");
    expect(alert?.getAttribute("role")).toBe("alert");
    expect(goto).not.toHaveBeenCalled();
  });

  it("says it could not sign out when the request never completed", async () => {
    const target = mountSecurity();
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({ type: "error", error: new TypeError("Failed to fetch") });
    flushSync();
    expect(alertTitled(target, "Couldn't sign out — please try again.")).not.toBeNull();
  });

  it("clears an earlier failure on the next try and goes to /auth/login on success", async () => {
    const target = mountSecurity();
    buttonNamed(target, "Sign Out").click();
    await sent.at(-1)!.finish({ type: "error", error: new TypeError("Failed to fetch") });
    flushSync();
    buttonNamed(target, "Sign Out").click();
    flushSync();
    expect(alertTitled(target, "Couldn't sign out")).toBeNull();
    await sent.at(-1)!.finish({ type: "success", status: 200, data: { loggedOut: true } });
    expect(goto).toHaveBeenCalledWith("/auth/login");
  });
});
```

`afterEach`: unmount, `sent.length = 0`, `goto.mockClear()`, `document.body.innerHTML = ""`.

Run both files. Expect FAIL: the totp regex (`expected '<p id="totp-error"…' to match /<div id="totp-error"…/`), `alertTitled(...)` null for every success/session case, `no "border-border-strong"` on Disable 2FA / Sign Out / Revoke, and the mount suite's `expected null to be 'alert'`.

- [ ] **8.5a Security — implement** per the table. Add `import { actionErrorMessage } from "$lib/utils/form-errors";`, `Alert`, `Button`, `toneClass`, `toneOf`; `let signOutError = $state<string | null>(null);` and `const SIGN_OUT_FAILED = "Couldn't sign out — please try again.";`. Remove `src/routes/(app)/settings/security/+page.svelte` from `PENDING_MIGRATION`. Run `settings-pages-ssr`, `settings-pages-mount.svelte`, `form-errors-aria-ssr`, `security-revoke-session`, `status-colour-owner` → PASS.

Mutation proofs: delete the `signOutError = actionErrorMessage(…)` line → the first two mount tests fail; drop `signOutError = null` from the submit function → the third fails; render `{#if form?.sessionError}` nowhere → "reports a refused revoke" fails; move it inside the sessions `role="status"` region → the same test fails on `closest`; swap the chip back to `bg-success/10 text-success` → "neutral state chip" fails (and the scan test).

Commit: `fix(security): show refused revokes and failed sign-outs; neutral 2FA state`

- [ ] **8.6 Notifications — failing tests.** In `settings-pages-ssr.test.ts` add `describe("/settings/notifications")` with

<!-- prettier-ignore -->
```ts
const notif = (over: Record<string, unknown> = {}) => ({
  user, preferences, vapidPublicKey: "", emailVerified: true, emailConfigured: true,
  pushHealth: { deviceCount: 0, lastReminderAt: null, oldestRegisteredAt: null, vapidConfigured: true },
  mutedMedications: [], ...over,
});
const pageRegion = (doc: Document) => doc.querySelector('[role="status"]')!; // first in DOM: the page-level one
// The first status region after the Send test form. `el.DOCUMENT_POSITION_*`, not
// `Node.*`: this file runs in node, where only the JSDOM window has a Node global.
const testRegion = (doc: Document) =>
  [...doc.querySelectorAll('[role="status"]')].find((el) =>
    el.compareDocumentPosition(doc.querySelector('form[action="?/sendTest"]')!) & el.DOCUMENT_POSITION_PRECEDING)!;
```

Tests (names and the assertions that matter):

<!-- prettier-ignore -->
```ts
it("announces a save from the page-level region", () => {
  expect(textOf(pageRegion(page(Notifications, notif())))).toBe("");
  const alert = alertTitled(pageRegion(page(Notifications, notif(), { success: true })), "Notification settings saved.")!;
  expectClasses(alert, toneClass("happened", "alert"));
});

it("draws the unverified address as a needs-you Alert whose action is the resend form", () => {
  const doc = page(Notifications, notif({ emailVerified: false }));
  const alert = alertTitled(doc, "Verify your email to enable email reminders.")!;
  expect(alert.getAttribute("role")).toBeNull();
  expect(alert.closest('[role="status"], [role="alert"]'), "a live region would re-announce the button").toBeNull();
  expectClasses(alert, toneClass("needs-you", "alert"));
  const resend = alert.querySelector<HTMLButtonElement>('form[action="?/resendVerification"] button[type="submit"]')!;
  expect(accessibleName(resend)).toBe("Resend verification email");
  expectClasses(resend, "h-9 border-border-strong");
});

it("announces a sent verification email from the page-level region", () => {
  const doc = page(Notifications, notif({ emailVerified: false }), { resendOk: true, alreadyVerified: false });
  const alert = alertTitled(pageRegion(doc), "Verification email sent.")!;
  expect(textOf(alert)).toContain("Check your inbox (and spam folder).");
});

it("still announces 'already verified' once the reload has removed the panel", () => {
  const doc = page(Notifications, notif({ emailVerified: true }), { resendOk: true, alreadyVerified: true });
  expect(alertTitled(doc, "Verify your email")).toBeNull();
  expect(alertTitled(pageRegion(doc), "Email already verified.")).not.toBeNull();
});

it("reports a failed resend assertively, outside every polite region", () => {
  const doc = page(Notifications, notif({ emailVerified: false }), { resendError: "Too many requests. Try again in 5 minutes." });
  const alert = alertTitled(doc, "Too many requests. Try again in 5 minutes.")!;
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.closest('[role="status"]')).toBeNull();
});

it("states what the server cannot do neutrally", () => {
  const off = page(Notifications, notif({ emailConfigured: false }));
  expect(alertTitled(off, "Email is not configured on this deployment")!.getAttribute("role")).toBe("note");
  for (const [vapidConfigured, words] of [[false, "Not configured on this deployment"], [true, "Configured"]] as const) {
    const doc = page(Notifications, notif({ pushHealth: { ...notif().pushHealth, vapidConfigured } }));
    const dd = [...doc.querySelectorAll("dd")].find((d) => textOf(d) === words)!;
    expectClasses(dd, toneClass("neutral", "text"));
  }
});

it("asks for action when both push preferences are off and a device is registered", () => {
  const doc = page(Notifications, notif({
    preferences: { ...preferences, overduePushReminders: false, lowInventoryPushAlerts: false },
    pushHealth: { ...notif().pushHealth, deviceCount: 1 },
  }));
  const alert = alertTitled(doc, "Both push preferences above are off")!;
  expect(alert.getAttribute("role")).toBeNull();
  expect(textOf(alert)).toContain("A test notification will still arrive.");
});

it("keeps a failed test out of the polite test region, and a sent one inside it", () => {
  const failed = page(Notifications, notif({ pushHealth: { ...notif().pushHealth, deviceCount: 1 } }), { testError: "Too many test notifications. Try again in 1 minutes." });
  const error = alertTitled(failed, "Too many test notifications.")!;
  expect(error.getAttribute("role")).toBe("alert");
  expect(error.closest('[role="status"]')).toBeNull();
  const ok = page(Notifications, notif({ pushHealth: { ...notif().pushHealth, deviceCount: 1 } }), { testOk: true, testMessage: "Sent to 1 device." });
  expect(testRegion(ok).contains(alertTitled(ok, "Sent to 1 device."))).toBe(true);
});

it("draws Save Changes at 44px primary and Send test at 36px secondary with its pending words", () => {
  const doc = page(Notifications, notif());
  expectClasses(submitOf(doc, "?/savePrefs"), "h-11 bg-accent text-accent-fg");
  const send = submitOf(doc, "?/sendTest");
  expect(accessibleName(send)).toBe("Send test notification");
  expectClasses(send, "h-9 border-border-strong");
  expect(send.hasAttribute("disabled"), "no device registered").toBe(true);
  expect(send.textContent).toContain("Sending…");
});

it("passes axe with every banner showing", async () => {
  await expectAxeClean(page(Notifications, notif({
    emailVerified: false,
    preferences: { ...preferences, overduePushReminders: false, lowInventoryPushAlerts: false },
    pushHealth: { ...notif().pushHealth, deviceCount: 1 },
  }), { testError: "Push failed." }),
  ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role", "nested-interactive"]);
});
```

In `settings-pages-mount.svelte.test.ts` add `describe("push card and test confirmation")`. Before each: `Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription } }), addEventListener: vi.fn(), removeEventListener: vi.fn() } })` and `Object.defineProperty(window, "PushManager", { configurable: true, value: class {} })`; `data = notif({ vapidPublicKey: "BAAA", pushHealth: { …, deviceCount: 1, vapidConfigured: true } })`; props are a `$state({ data, form: null })` so a test can set `props.form`. Await `vi.waitFor(() => buttonNamed(target, subscription ? "Disable" : "Enable"))` for `checkPushStatus()`.

<!-- prettier-ignore -->
```ts
it("draws Disable as a secondary Button and the active state in neutral words", async () => {
  subscription = { endpoint: "https://push.test/1" };
  const target = mountNotifications();
  const disable = await vi.waitFor(() => buttonNamed(target, "Disable"));
  expectClasses(disable, "h-9 border-border-strong text-text-primary");
  const active = [...target.querySelectorAll("p")].find((p) => textOf(p) === "Push notifications are active on this device.")!;
  expectClasses(active, toneClass("neutral", "text"));
});

it("draws Enable as the primary Button", async () => {
  subscription = null;
  expectClasses(await vi.waitFor(() => buttonNamed(mountNotifications(), "Enable")), "h-9 bg-accent text-accent-fg");
});

it("shows Sending… while a test is in flight, then asks for action when the device never confirms", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  subscription = { endpoint: "https://push.test/1" };
  const target = mountNotifications();
  await vi.waitFor(() => buttonNamed(target, "Disable"));
  const send = buttonNamed(target, "Send test notification");
  send.click();
  flushSync();
  expect(send.getAttribute("aria-busy")).toBe("true");
  expect(send.disabled).toBe(true);
  props.form = { testOk: true, testMessage: "Sent to 1 device." };
  await sent.at(-1)!.finish({ type: "success", status: 200, data: props.form });
  flushSync();
  const ok = alertTitled(target, "Sent to 1 device.")!;
  expect(textOf(ok)).toContain("Waiting for this device to confirm it displayed…");
  vi.advanceTimersByTime(10_000);
  flushSync();
  const late = alertTitled(target, "This device didn't confirm it displayed the notification.")!;
  expect(late.getAttribute("role")).toBeNull();
  expectClasses(late, toneClass("needs-you", "alert"));
  expect(late.closest('[role="status"]'), "announced politely by the test region").not.toBeNull();
});
```

`afterEach` also `vi.useRealTimers()` and deletes the two defined properties. Run both files. Expect FAIL: `alertTitled` null across the board, `no "h-9"` on Send test, `no "border-border-strong"` on Disable, `expected null not to be null` for the timed-out Alert.

- [ ] **8.6a Notifications — implement** per the table. Imports: `Alert`, `Button`, `toneClass`, `toneOf`. The resend outcome branches in the page-level region, in this order (no conditional children, so no empty body is drawn):

<!-- prettier-ignore -->
```svelte
<div role="status">
  {#if form?.success}
    <Alert tone="happened" title="Notification settings saved." />
  {:else if form?.resendOk && form.alreadyVerified}
    <Alert tone="happened" title="Email already verified." />
  {:else if form?.resendOk}
    <Alert tone="happened" title="Verification email sent.">Check your inbox (and spam folder).</Alert>
  {/if}
</div>
```

The `action` snippet holds the resend `<form method="POST" action="?/resendVerification" use:enhance>` unchanged apart from its `Button`. Replace the panel's comment at `:158-161` with: "Kept in its own card so the resend form does not nest inside the preferences form. Not a live region: it is on screen from the first paint, and a region around the Resend button would re-announce it. The resend's success is announced from the page-level region above, which outlives this panel when the reload finds the address already verified." Remove `src/routes/(app)/settings/notifications/+page.svelte` from `PENDING_MIGRATION`. Run `settings-pages-ssr`, `settings-pages-mount.svelte`, `mobile-nav-link-names-ssr` (its back-link case renders this page), `push-test-notification`, `status-colour-owner` → PASS.

Mutation proofs: move the resend success into the panel → "still announces 'already verified'…" fails; put `form?.testError` back inside the test region → "keeps a failed test out…" fails; wrap the needs-you Alert in `role="status"` → the resend test fails on `closest`; delete the `{#if confirmationTimedOut}` Alert → the mount timeout test fails; set Disable back to `variant="danger"` → the Disable test fails.

Commit: `fix(notifications): announce resend results; neutral push state; Button and Alert`

- [ ] **8.7 Appearance — failing tests.** In `tests/unit/appearance-page-ssr.test.ts` (keeping every existing assertion):
  - `:137` "ships the no-JS save buttons…": also parse `body` with `ssrDocument` and require every one of the 6 `button[type="submit"]` to carry `h-9 bg-accent text-accent-fg` (`expectClasses`).
  - `:149` "renders exactly one polite live region, outside every form": run the count and the before-the-first-`<form>` check over `[body, successBody, validationErrorBody, rateLimitedBody]` — a feedback Alert must not add a `role="status"`.
  - `:160` "renders success feedback…": add `const alert = alertTitled(ssrDocument(successBody), "Display Density saved.")!; expect(alert.getAttribute("role")).toBeNull(); expectClasses(alert, toneClass("happened", "alert")); expect(alert.closest('form[action="?/uiDensity"]')).not.toBeNull();`
  - `:170` and `:174`: the same lookup for "Invalid enum value." and "Too many changes. Try again in 30 seconds.", each with `role === "alert"` and `toneClass("wrong", "alert")`.
  - New: `it("passes axe with a refused no-JS save", …)` → `expectAxeClean(ssrDocument(rateLimitedBody), ["button-name", "aria-hidden-focus", "aria-allowed-role"])`.

  The `saved\.` count of 1 at `:164` stays as is (the Alert must not repeat its title). Run → FAIL: `no "h-9"` on the first submit, `alertTitled` null.

- [ ] **8.7a Appearance — implement.** Replace the three `<button>`s and three feedback `<p>`s per the table. Replace the comment at `:366-372` with exactly:

<!-- prettier-ignore -->
```svelte
  <!-- Single polite region for the per-control "saved" outcome, outside every
       form so a control is not re-announced when its own result changes.
       Failures go to a toast instead, and the Toast stack is a polite region
       of its own (role="status" on its container; its items no longer carry
       role="alert"), so each outcome is announced once, from one place.
       appearance-page-ssr.test.ts pins that this is the page's only
       role="status" and that it precedes the first form. -->
```

Remove `src/routes/(app)/settings/appearance/+page.svelte` from `PENDING_MIGRATION`. Run `appearance-page-ssr`, `appearance-bundle-boundary` (Alert, Button and the owner module must stay zod-free), `appearance-actions`, `mobile-nav-link-names-ssr`, `status-colour-owner` → PASS.

Mutation proofs: wrap the success Alert in `<div role="status">` → the "exactly one polite live region" loop fails on `successBody`; revert one Save to the old `<button>` → the `h-9` check fails; render the failure through `tone="happened"` → the `:170`/`:174` role checks fail.

Commit: `refactor(appearance): no-JS saves and feedback through Button and Alert`

- [ ] **8.8 Gates.** Run `npx vitest run tests/unit/settings-pages-ssr.test.ts tests/unit/settings-pages-mount.svelte.test.ts tests/unit/form-errors-aria-ssr.test.ts tests/unit/appearance-page-ssr.test.ts tests/unit/status-colour-owner.test.ts` → all PASS. Then `npx vitest run` (whole suite, PASS), `npm run check` (0 errors, ≤ 27 warnings), `npm run lint` (0 errors, ≤ 115 warnings), `npm run format:check` (clean). No e2e selector changes: the only role/name the e2e suite reads on these pages is `/settings/appearance`'s heading (`tests/e2e/accessibility.test.ts:74,123`), unchanged.

### Task 9: Auth and public pages — login, register, 2fa, reset-password, reset-password/confirm, verify, landing header, both error pages, `EmptyState`, `OnboardingWelcome`

**Files**

- Modify: `src/routes/auth/login/+page.svelte`, `src/routes/auth/register/+page.svelte`, `src/routes/auth/2fa/+page.svelte`, `src/routes/auth/reset-password/+page.svelte`, `src/routes/auth/reset-password/confirm/+page.svelte`, `src/routes/auth/verify/+page.svelte`, `src/routes/+page.svelte`, `src/routes/+error.svelte`, `src/routes/(app)/+error.svelte`, `src/lib/components/EmptyState.svelte`, `src/lib/components/OnboardingWelcome.svelte`, `CLAUDE.md` (the EmptyState bullet only)
- Create: `tests/unit/auth-pages-ssr.test.ts` (node), `tests/unit/empty-state-onboarding-ssr.test.ts` (node), `tests/unit/onboarding-welcome.svelte.test.ts` (jsdom)
- Modify (tests): `tests/unit/form-errors-aria-ssr.test.ts`, `tests/unit/log-pagination-ssr.test.ts`, `tests/unit/error-page-ssr.test.ts`, `tests/unit/landing-hero-ssr.test.ts`, `tests/unit/status-colour-owner.test.ts`

**Interfaces**

- Consumes: `Button`, `Alert`, `toneClass` (T1–T3); `withoutComments` from `tests/unit/helpers/axe-ssr.ts` (T2); `alertTitled`, `expectClasses`, `expectAxeClean`, `assertiveAlert` (T8).
- Produces: `EmptyState`'s `action` prop narrows to `{ href: string; label: string }` (the `onclick` field and the `<button>` branch at `EmptyState.svelte:37-45` are deleted: no caller passes `onclick` — the three callers, `log/+page.svelte:295-307` and `medications/+page.svelte:93-99`, all pass `href`).

**Decisions**

| Site (HEAD anchor)                                                                                      | After                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submits: login `:118-124`, register `:153-159`, 2fa `:66-72`, reset `:73-79`, confirm `:73-79`          | `<Button variant="primary" type="submit" block disabled={loading} pending={loading} pendingLabel="…">` with the current words and U+2026: "Signing in…", "Creating account…", "Verifying…", "Sending…", "Updating…". Labels unchanged: "Sign in", "Create account", "Verify", "Send reset link", "Set new password". Real `disabled` kept (today's semantics).                                                                                                  |
| `form-error` banners: login `:46-54`, register `:53-61`, 2fa `:28-36`, reset `:38-46`, confirm `:22-30` | `<Alert tone="wrong" id="form-error" title={…} class="mb-4" />` (assertive by default). The inputs' `aria-describedby="form-error"` and the `page.status` invalid logic are untouched.                                                                                                                                                                                                                                                                          |
| Field errors (`<p id="email-error"…>` etc.)                                                             | **unchanged** (spec non-goal; masked by the T1 scan)                                                                                                                                                                                                                                                                                                                                                                                                            |
| OAuth warnings, login `:34-44`                                                                          | `Alert tone="needs-you"`, **no `role="alert"`** (spec). Conflict: title "An account with that email already exists.", body "Please sign in with your password, then link your OAuth provider from settings." Unverified: title "Your social-login provider returned an unverified email address.", body "Verify the email with your provider and try again." Class `mb-4`. Not wrapped in a live region: it arrives with the page load from the OAuth redirect. |
| OAuth links, login `:134-143`                                                                           | `<Button variant="secondary" href="/auth/callback/google" block>Continue with Google</Button>` (and GitHub). Their border moves from the decorative `glass-border` to `border-strong`, as WCAG 1.4.11 requires of a control.                                                                                                                                                                                                                                    |
| Reset sent, reset `:23-30`                                                                              | **Now announced** (spec). A persistent `<div role="status">` sits above `{#if form?.success}` and holds `{#if form?.success}<Alert tone="happened" title="Check your email for a reset link.">If an account exists for that address, you'll receive instructions shortly.</Alert>{/if}`; the `{#if form?.success}` branch below keeps only the "Back to sign in" paragraph. Tone `happened`: it confirms the request the user just made.                        |
| Verify `:13-27`                                                                                         | Keeps its `h1` (the page needs one; an `Alert` headline is not a heading). `h1` class takes `toneClass("happened", "text")` / `toneClass("wrong", "text")`; the ✓ / ✗ glyph `<p>`s gain `aria-hidden="true"` (the heading already says it). "Go to Dashboard" → `<Button variant="primary" href="/dashboard" class="mt-6">`.                                                                                                                                    |
| Landing header `+page.svelte:30-41`                                                                     | `<Button variant="ghost" size="sm" href="/auth/login">Sign in</Button>`, `<Button variant="primary" size="sm" href="/auth/register">Get Started</Button>`. Hero CTAs `:63-74` stay bespoke (spec).                                                                                                                                                                                                                                                              |
| Landing feature tiles `+page.svelte:121, 132`                                                           | `bg-success/15` and `bg-warning/15` → `bg-accent/15`, matching the first tile: decorative backgrounds behind an emoji, which said "it happened" and "this needs you" about nothing.                                                                                                                                                                                                                                                                             |
| Error pages: `+error.svelte:29-34`, `(app)/+error.svelte:31-36`                                         | `<Button variant="primary" href="/dashboard" class="mt-6">Back to dashboard</Button>`. The status numeral stays `text-accent-ink` (accent, not a status token).                                                                                                                                                                                                                                                                                                 |
| `EmptyState.svelte:29-46`                                                                               | `{#if action}<Button variant="primary" href={action.href} class="mt-4">{action.label}</Button>{/if}`                                                                                                                                                                                                                                                                                                                                                            |
| `OnboardingWelcome.svelte`                                                                              | "Add your first medication" `:17-22` → `Button primary href`; "Learn more first" `:23-29` → `Button variant="ghost"` (it was a bare text button with no height); Back `:52-58`, `:104-110` → `ghost`; Next `:59-65` → `primary`; "Get started" `:111-116` → `Button primary href`. All `md`. Step dots `:122-141` stay bespoke (spec).                                                                                                                          |

- [ ] **9.1 Auth form pages — failing tests.** In `form-errors-aria-ssr.test.ts` change the three `form-error` assertions to T8's helper, which now also pins the message:
  - `:115` (register) and `:209` (the `describe.each` for reset / confirm / 2fa): `expect(html).toMatch(assertiveAlert("form-error", "Too many attempts"));`
  - `:162` (login, was `/<div id="form-error"[^>]*role="alert"/`): the same call.

  Field-error regexes (`<p id="…-error"[^>]*role="alert"…`) at `:100`, `:150` and `:275` are unchanged. `expectNoErrorWiring` still holds: neither `Button` nor `Alert` renders `aria-describedby`, `aria-invalid` or an `-error"` id unasked.

  Create `tests/unit/auth-pages-ssr.test.ts` (node; `$app/state` mocked with the hoisted `pageState` exactly as `form-errors-aria-ssr.test.ts:15-16`):

<!-- prettier-ignore -->
```ts
const LOGIN_DATA = { user: null, hasOAuth: false, oauthError: null };
const SUBMITS = [
  { page: "/auth/login", html: () => render(Login, { props: { data: LOGIN_DATA, form: null } }).body, label: "Sign in", pending: "Signing in…" },
  { page: "/auth/register", html: () => render(Register, { props: { form: null } }).body, label: "Create account", pending: "Creating account…" },
  { page: "/auth/2fa", html: () => render(TwoFactor, { props: { form: null } }).body, label: "Verify", pending: "Verifying…" },
  { page: "/auth/reset-password", html: () => render(ResetPassword, { props: { form: null } }).body, label: "Send reset link", pending: "Sending…" },
  { page: "/auth/reset-password/confirm", html: () => render(ResetConfirm, { props: { data: { user: null, token: "t" }, form: null } }).body, label: "Set new password", pending: "Updating…" },
];

describe.each(SUBMITS)("$page submit", ({ html, label, pending }) => {
  const submit = () => {
    const buttons = ssrDocument(html()).querySelectorAll<HTMLButtonElement>('button[type="submit"]');
    expect(buttons).toHaveLength(1);
    return buttons[0];
  };
  it("is one full-width 44px primary, named exactly what the e2e suite clicks", () => {
    expect(accessibleName(submit())).toBe(label); // tests/e2e/helpers/auth.ts:26,50
    expectClasses(submit(), "w-full h-11 bg-accent text-accent-fg");
  });
  it("carries its pending words with a real ellipsis", () => {
    expect(submit().textContent).toContain(pending);
    expect(submit().textContent).not.toContain("...");
  });
});

describe("/auth/login", () => {
  it.each([["/auth/callback/google", "Continue with Google"], ["/auth/callback/github", "Continue with GitHub"]])(
    "offers %s as a full-width secondary Button link", (href, name) => {
      const link = ssrDocument(render(Login, { props: { data: { ...LOGIN_DATA, hasOAuth: true }, form: null } }).body)
        .querySelector(`a[href="${href}"]`)!;
      expect(textOf(link)).toBe(name);
      expectClasses(link, "w-full h-11 border-border-strong text-text-primary");
    });

  it.each([
    ["oauth_email_conflict", "An account with that email already exists.", "Please sign in with your password, then link your OAuth provider from settings."],
    ["oauth_email_unverified", "Your social-login provider returned an unverified email address.", "Verify the email with your provider and try again."],
  ])("draws %s as a needs-you Alert that does not interrupt", (code, title, body) => {
    const doc = ssrDocument(render(Login, { props: { data: { ...LOGIN_DATA, oauthError: code }, form: null } }).body);
    const alert = alertTitled(doc, title)!;
    expect(alert.getAttribute("role")).toBeNull();
    expect(doc.querySelector('[role="alert"]'), "needs-you is never role=alert").toBeNull();
    expectClasses(alert, toneClass("needs-you", "alert"));
    expect(textOf(alert)).toContain(body);
  });
});

describe("/auth/reset-password", () => {
  it("announces the sent link from a status region that exists before it", () => {
    const idle = ssrDocument(render(ResetPassword, { props: { form: null } }).body).querySelector('[role="status"]');
    expect(idle).not.toBeNull();
    expect(textOf(idle!)).toBe("");
    const doc = ssrDocument(render(ResetPassword, { props: { form: { success: true } } }).body);
    const alert = alertTitled(doc, "Check your email for a reset link.")!;
    expect(alert.closest('[role="status"]')).not.toBeNull();
    expect(alert.getAttribute("role")).toBeNull();
    expectClasses(alert, toneClass("happened", "alert"));
    expect(textOf(alert)).toContain("If an account exists for that address, you'll receive instructions shortly.");
    expect(doc.querySelector("form")).toBeNull();
  });
});

describe("axe on the auth pages", () => {
  const RULES = ["button-name", "link-name", "aria-hidden-focus", "aria-allowed-role"];
  it.each([
    ["login, failed, with an OAuth warning", () => render(Login, { props: { data: { ...LOGIN_DATA, hasOAuth: true, oauthError: "oauth_email_conflict" }, form: { errors: { form: ["Invalid email or password"] } } } }).body],
    ["register, throttled", () => render(Register, { props: { form: { errors: { form: ["Too many attempts. Try again in 15 minutes."] } } } }).body],
    ["2fa, refused", () => render(TwoFactor, { props: { form: { error: "Invalid code, try again" } } }).body],
    ["reset-password, refused", () => render(ResetPassword, { props: { form: { error: "Email is required." } } }).body],
    ["reset-password/confirm, refused", () => render(ResetConfirm, { props: { data: { user: null, token: "t" }, form: { error: "Passwords do not match" } } }).body],
  ])("%s passes", async (_label, html) => {
    await expectAxeClean(ssrDocument(html()), RULES);
  });
  it("reset-password, sent, passes", async () => {
    await expectAxeClean(ssrDocument(render(ResetPassword, { props: { form: { success: true } } }).body),
      ["link-name", "aria-hidden-focus", "aria-allowed-role"]);
  });
});
```

Run `npx vitest run tests/unit/auth-pages-ssr.test.ts tests/unit/form-errors-aria-ssr.test.ts`. Expect FAIL: `expected '<div id="form-error" class="bg-danger/10 …">Too many attempts…' to match /<div id="form-error"…<svg…/`, `no "h-11" on <button …>`, `expected 'Signing in...' to contain 'Signing in…'`, `alertTitled` null.

- [ ] **9.2 Auth form pages — implement** per the table (login, register, 2fa, reset-password, confirm). Remove the five files from `PENDING_MIGRATION` (their remaining literals are the masked field-error lines). Run the two files plus `register-hero-ssr` (its `alt !== ""` image filter ignores the Alert's svg) and `status-colour-owner` → PASS. The e2e names hold: `tests/e2e/auth.test.ts:25`, `global-setup.ts:29` and `helpers/auth.ts:26` click `button "Sign in"`, `helpers/auth.ts:50` `button "Create account"`; the pending span is `aria-hidden` at rest, so neither name changes. `smoke.test.ts` reads only the `h1`s.

Mutation proofs: `pendingLabel="Signing in..."` → "real ellipsis" fails; drop `block` → `w-full` fails; give the conflict Alert `live="assertive"` → "does not interrupt" fails; move the reset Alert's `role="status"` wrapper inside `{#if form?.success}` → "exists before it" fails on `idle`.

Commit: `refactor(auth): Button submits and Alert banners on the sign-in pages; announce a sent reset link`

- [ ] **9.3 Verify page — failing test, implement.** Add to `auth-pages-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
describe("/auth/verify", () => {
  it.each([
    [{ verified: true }, "Email Verified", "happened", "✓"],
    [{ verified: false, error: "Invalid or expired token" }, "Verification Failed", "wrong", "✗"],
  ] as const)("colours the heading from the owner and hides the glyph (%o)", (data, heading, tone, glyph) => {
    const doc = ssrDocument(render(Verify, { props: { data } }).body);
    const h1 = doc.querySelector("h1")!;
    expect(textOf(h1)).toBe(heading);
    expectClasses(h1, toneClass(tone, "text"));
    expect(textOf(doc.querySelector('[aria-hidden="true"]')!)).toBe(glyph);
    expectClasses(doc.querySelector('a[href="/dashboard"]')!, "h-11 bg-accent text-accent-fg");
  });
  it("passes axe", async () => {
    await expectAxeClean(ssrDocument(render(Verify, { props: { data: { verified: false, error: "Missing token" } } }).body),
      ["link-name", "aria-hidden-focus"]);
  });
});
```

Run → FAIL (`no "h-11"`, glyph lookup null). Implement per the table; remove `src/routes/auth/verify/+page.svelte` from `PENDING_MIGRATION`. Run → PASS. Mutation: drop `aria-hidden` from the ✓ → the glyph lookup fails.

Commit: `refactor(verify): owner-coloured result and a Button back to the dashboard`

- [ ] **9.4 Landing header — failing test, implement.** Append to `tests/unit/landing-hero-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
describe("the landing header", () => {
  const header = () => ssrDocument(render(LandingPage).body).querySelector("header")!;
  it("signs in through a ghost Button link and starts through a primary one, both 36px", () => {
    const signIn = header().querySelector('a[href="/auth/login"]')!;
    expect(textOf(signIn)).toBe("Sign in");
    expectClasses(signIn, "h-9 text-text-secondary");
    const start = header().querySelector('a[href="/auth/register"]')!;
    expect(textOf(start)).toBe("Get Started");
    expectClasses(start, "h-9 bg-accent text-accent-fg");
  });
  it("passes axe link-name", async () => {
    await expectAxeClean(ssrDocument(render(LandingPage).body), ["link-name"]);
  });
});
```

Run → FAIL (`no "h-9"`). Implement the header and the two tile backgrounds; remove `src/routes/+page.svelte` from `PENDING_MIGRATION`. Run `landing-hero-ssr`, `register-hero-ssr`, `status-colour-owner` → PASS. Mutation: restore the header's `px-4 py-2` `<a>` → the 36px test fails.

Commit: `refactor(landing): header actions through Button; tiles drop status colours`

- [ ] **9.5 Error pages — failing test, implement.** Add to the `describe.each` in `tests/unit/error-page-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
it("offers the way back as a 44px primary Button link", () => {
  const link = ssrDocument(renderWith(Page, { status: 404, error: { message: "Not found" } })).querySelector('a[href="/dashboard"]')!;
  expect(textOf(link)).toBe("Back to dashboard");
  expectClasses(link, "h-11 bg-accent text-accent-fg");
});
it("passes axe link-name", async () => {
  await expectAxeClean(ssrDocument(renderWith(Page, { status: 500, error: null })), ["link-name"]);
});
```

Run → FAIL (`no "h-11"`). Implement both pages. Run → PASS (the four existing cases are untouched). Neither file is in `PENDING_MIGRATION`. Mutation: restore the root page's `inline-block … py-2.5` anchor → fails for "the root error page" only, proving both files are covered.

Commit: `refactor(errors): Back to dashboard through Button on both error pages`

- [ ] **9.6 EmptyState — failing tests, implement.** In `tests/unit/log-pagination-ssr.test.ts`, import `withoutComments` from `./helpers/axe-ssr` (Task 2; Svelte's hydration markers are not content, and a Button's children sit between them) and apply it in exactly the two `EmptyState` cases, same regexes otherwise: `:287` `const afterForm = withoutComments(html.slice(html.indexOf("</form>")));` and `:296` `expect(withoutComments(html)).toMatch(/<a\b[^>]*href="\/dashboard"[^>]*>\s*Log a dose\s*<\/a>/);`. (The filter-bar link at `:262` is Task 11's; it reuses this import.)

Create `tests/unit/empty-state-onboarding-ssr.test.ts` (node; `withoutComments` and `ssrDocument` from `./helpers/axe-ssr`):

<!-- prettier-ignore -->
```ts
describe("EmptyState", () => {
  it("renders its action as a 44px primary Button link whose text is the label", () => {
    const html = withoutComments(render(EmptyState, { props: { title: "No doses match these filters", action: { href: "/log", label: "Clear filters" } } }).body);
    expect(html).toMatch(/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/);
    expect(html).not.toContain("<button");
    expectClasses(ssrDocument(html).querySelector('a[href="/log"]')!, "h-11 bg-accent text-accent-fg");
  });
  it("renders no action without one", () => {
    expect(ssrDocument(render(EmptyState, { props: { title: "Nothing" } }).body).querySelector("a, button")).toBeNull();
  });
});
```

Run → the new EmptyState test FAILS (`no "h-11"`); the two edited `log-pagination-ssr` cases still PASS against the old markup, which has no markers. Implement `EmptyState` per the table with `action?: { href: string; label: string }`; update `CLAUDE.md:67` to read `` `action` (`{ href, label }`, drawn as a primary `Button` link) ``. Run `empty-state-onboarding-ssr`, `log-pagination-ssr`, `npm run check` (the narrowed type compiles against all three callers) → PASS. Mutation proofs: revert the `<a>` to its old classes → `no "h-11"`; drop `withoutComments` from the `:287` case after the implementation → that case fails on the `<!---->` markers, which is why the edit is needed at all.

Commit: `refactor(empty-state): action through Button; drop the unused onclick branch`

- [ ] **9.7 OnboardingWelcome — failing tests, implement.** Append to `empty-state-onboarding-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
describe("OnboardingWelcome (first step, as SSR draws it)", () => {
  const doc = () => ssrDocument(render(OnboardingWelcome).body);
  it("draws its two first-step actions as 44px Buttons", () => {
    const add = doc().querySelector('a[href="/medications/new"]')!;
    expect(textOf(add)).toBe("Add your first medication");
    expectClasses(add, "h-11 bg-accent text-accent-fg");
    const more = buttonNamed(doc(), "Learn more first");
    expect(more.type).toBe("button");
    expectClasses(more, "h-11 text-text-secondary");
  });
  it("leaves the step dots bespoke", () => {
    const dots = doc().querySelectorAll('button[aria-label^="Go to step"]');
    expect(dots).toHaveLength(3);
    for (const dot of dots) expectClasses(dot, "h-6 min-w-6");
  });
  it("passes axe", async () => {
    await expectAxeClean(doc(), ["button-name", "link-name", "nested-interactive"]);
  });
});
```

Create `tests/unit/onboarding-welcome.svelte.test.ts` (jsdom; steps 1 and 2 are reachable only by clicking, which is why `dashboard-chrome-copy.test.ts` reads source for their copy):

<!-- prettier-ignore -->
```ts
it("walks the steps with a ghost Back and a primary Next, then a primary Get started link", () => {
  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(OnboardingWelcome, { target });
  flushSync();
  buttonNamed(target, "Learn more first").click();
  flushSync();
  expectClasses(buttonNamed(target, "Back"), "h-11 text-text-secondary");
  const next = buttonNamed(target, "Next");
  expect(next.type).toBe("button");
  expectClasses(next, "h-11 bg-accent text-accent-fg");
  next.click();
  flushSync();
  const start = target.querySelector('a[href="/medications/new"]')!;
  expect(textOf(start)).toBe("Get started");
  expectClasses(start, "h-11 bg-accent text-accent-fg");
  expectClasses(buttonNamed(target, "Back"), "h-11 text-text-secondary");
  unmount(app);
});
```

Run → FAIL (`no "h-11"`). Implement per the table. Run both files plus `dashboard-chrome-copy` (step 2's copy strings are untouched) and `dashboard-page-ssr` (`:339` "Welcome to MedTracker") → PASS. Neither component is in `PENDING_MIGRATION`. Mutation: revert "Learn more first" to its bare `<button class="text-text-secondary …">` → the first SSR test fails on `h-11`.

Commit: `refactor(onboarding): steps' actions through Button`

- [ ] **9.8 Gates.** Run `npx vitest run tests/unit/auth-pages-ssr.test.ts tests/unit/form-errors-aria-ssr.test.ts tests/unit/landing-hero-ssr.test.ts tests/unit/register-hero-ssr.test.ts tests/unit/error-page-ssr.test.ts tests/unit/log-pagination-ssr.test.ts tests/unit/empty-state-onboarding-ssr.test.ts tests/unit/onboarding-welcome.svelte.test.ts tests/unit/dashboard-chrome-copy.test.ts tests/unit/status-colour-owner.test.ts` → PASS. Then `npx vitest run` (PASS), `npm run check` (0 errors, ≤ 27 warnings), `npm run lint` (0 errors, ≤ 115 warnings), `npm run format:check` (clean).

**PENDING_MIGRATION after T8 and T9** — removed (spelled exactly as T1 lists them): `src/routes/(app)/settings/+page.svelte`, `src/routes/(app)/settings/security/+page.svelte`, `src/routes/(app)/settings/notifications/+page.svelte`, `src/routes/(app)/settings/appearance/+page.svelte` (T8); `src/routes/auth/login/+page.svelte`, `src/routes/auth/register/+page.svelte`, `src/routes/auth/2fa/+page.svelte`, `src/routes/auth/reset-password/+page.svelte`, `src/routes/auth/reset-password/confirm/+page.svelte`, `src/routes/auth/verify/+page.svelte`, `src/routes/+page.svelte` (T9). Never listed (no status token at HEAD): both `+error.svelte`, `EmptyState.svelte`, `OnboardingWelcome.svelte`.

### Task 10: Medications and forms

Migrate the medication pages and the medication/dose form controls to `Button`, `IconButton`, `Toggle` and `Alert`. Scope the MedicationForm focus fallback to its own form. Every line cited below was read at `925be44`. Depends on Task 5, which neutralises `medications/[id]`'s ±N and creates the test file Step 1 extends.

**Files:**

- Modify: `src/routes/(app)/medications/+page.svelte` (the "+ Add Medication" link only, :85-89)
- Modify: `src/routes/(app)/medications/[id]/+page.svelte` (the outcome banners :64-90, Mark as refilled :122-127, Adjust :170-175, Archive/Unarchive :226-246)
- Modify: `src/lib/components/MedicationForm.svelte` (:64-65, the enhance callback :129-162, the crash message :249-258, the submit :260-266)
- Modify: `src/lib/components/medication-form/InteractionWarningPanel.svelte` (the whole file, 18 lines)
- Modify: `src/lib/components/medication-form/MedicationIdentityFields.svelte` (:19-30, a wrapper only)
- Modify: `src/lib/components/medication-form/MedicationScheduleSection.svelte` (modes :49-83, Remove :134-142, "+ Add time" :146-152, weekdays :163-178)
- Modify: `src/lib/components/medication-form/MedicationStylePicker.svelte` (+ :158-166, × :190-195)
- Modify: `src/lib/components/SideEffectPicker.svelte` (effect chips :96-108, custom chips :118-129, Add :147-154, `removeButtons` :71)
- Modify: `src/lib/components/DoseEditForm.svelte` (Cancel :245-251, and the form-level banner :238-242; Save is not touched)
- Modify: `tests/unit/status-colour-owner.test.ts` (PENDING_MIGRATION removals, per step)
- Modify: `tests/unit/form-errors-enhance-callbacks.test.ts`
  - three tests added to `describe("MedicationForm")` (:306-362);
  - one test added to `describe("DoseEditForm")` (:117-304).
- Modify: `tests/unit/dose-edit-form-lock.test.ts` (adds one describe)
- Modify: `tests/unit/medication-inventory-history-ssr.test.ts`. T5 creates this file, and its T5 Files list says "T10 may extend it for that page's banners and buttons". T10 adds three describes.
- Create: `tests/unit/medication-form-controls-ssr.test.ts`

**Interfaces:**

- Consumes:
  - From T2: `Button` (including `shape`), `IconButton` and `Toggle`, with the props Task 2 lists.
  - From T2 as well: the bindable `ref` on `Button` and `IconButton`. `bind:this` on a component yields the instance, not its element, and three focus hand-offs need the element: MedicationStylePicker's +, the SideEffectPicker custom chips, and in T11 MobileHeader's toggle.
  - From T3: `Alert` (`tone`, `title`, `id`, `tabindex`, `class`, children). This task relies on `role`, `id`, `tabindex` and the tone classes all sitting on the Alert's root element, and on the Alert rendering no text besides `title` and children (no sr-only prefix): `form-errors-enhance-callbacks.test.ts:317-320` compares `textContent.trim()` to the message.
  - From T2: Button's inactive label is `invisible` and `aria-hidden`, so `getByRole("button", { name: "Add Medication" })` never reads "Saving…".
  - From T1, in tests only: `toneClass` and `type Tone` from `$lib/utils/status-tone`.
  - From T1: the `PENDING_MIGRATION` list in `tests/unit/status-colour-owner.test.ts`.
  - From T5: the inventory-history ±N on `medications/[id]` must already be neutral. That is T5's change, and this task leaves it alone.
- Produces: no public API. Inside `MedicationForm.svelte` it adds `const ACTION_ERROR_ID = "medication-form-error"`.

**The fence. Each of these is untouched, and stated here so a reviewer can check:**

- The medications list's ↑/↓ reorder (`medications/+page.svelte:111-138`) and its `reorder` SubmitFunction (:33-72).
- MedicationCard's Log button. This task does not open `MedicationCard.svelte` at all.
- DoseEditForm's Save (:252-261) and its `save` SubmitFunction (:82-138).
- DoseEditForm's field-error paragraphs (:167-227). Its form-level banner (:238-242) is migrated in Step 4: it is not part of the fenced Save.
- SideEffectPicker's Mild/Mod/Severe buttons (:167-189). Their colours are T4's.
- The inventory-history ±N (`[id]/+page.svelte:193-200`), which is T5's.
- `EVENT_LABELS` (`[id]/+page.svelte:14-22`), which `inventory-event-types.test.ts` reads from source.
- Every `<input>`, `<select>` and field-error `<p>`. Inputs are a spec non-goal.
- The Tooltip "i" buttons, which are bespoke per the spec.

**What already pins this markup, and how each pin fares:**

| Test                                                                                                                   | What it pins                                                                                                                                                                                   | Change                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `form-errors-enhance-callbacks.test.ts:312-324, :326-333, :335-348`                                                    | After a crash there is exactly one `[role="alert"]`, its `textContent.trim()` equals the message, it is `document.activeElement`, and the submit's `.disabled === false`                       | **Unedited.** Alert puts `role="alert"` and `tabindex="-1"` on its root and holds no other text. The submit keeps a real `disabled={loading}`. The interaction panel stops being an alert.                                                                  |
| `form-errors-enhance-callbacks.test.ts:350-361`                                                                        | A failure still calls `update()`                                                                                                                                                               | Unedited                                                                                                                                                                                                                                                    |
| `form-errors-enhance-callbacks.test.ts:158-166, :213-262, :278-285` (DoseEditForm)                                     | The form-level message is `form.querySelector('[role="alert"]:not([id])')`. Its `textContent.trim()` equals the message, it is `document.activeElement`, and it is null again after a success. | **Unedited.** The Alert carries no `id`, puts `role="alert"` and `tabindex="-1"` on its root, and holds only the title. `focusFirstProblem` (`DoseEditForm.svelte:64-70`) already queries inside the form.                                                  |
| `accessible-pickers-ssr.test.ts:119-125, :252-260`                                                                     | `button[aria-label="Add secondary colour"]` exists, sits outside the Primary colour group, and is inside the `stylePickerLegend` fieldset                                                      | Unedited. IconButton renders `label` as `aria-label` on a `<button>` at the same place in the DOM.                                                                                                                                                          |
| `accessible-pickers-ssr.test.ts:348-354`                                                                               | Every SideEffectPicker control's group is "Side Effects"                                                                                                                                       | Unedited                                                                                                                                                                                                                                                    |
| `accessible-pickers-ssr.test.ts:363-376`                                                                               | "Remove Rash" has no `aria-pressed`, and its first `span` is an `aria-hidden` "×". The common chips are `aria-pressed` "true" or "false".                                                      | Unedited. Button renders children directly when `pending` is undefined, so the first `span` is still the glyph. Hydration comments are not elements; this was verified by compiling a sample in server mode. Toggle renders `aria-pressed`.                 |
| `accessible-pickers-ssr.test.ts:378-393`                                                                               | Unpressed chips and "Add" carry `border-border-strong` and not `border-glass-border`                                                                                                           | Unedited. Toggle's off state and Button secondary both carry `border-border-strong`.                                                                                                                                                                        |
| `accessible-pickers-ssr.test.ts:216-227, :274-339`                                                                     | Only `colour`, `colourSecondary` and `pattern` are named fields, and every copy agrees                                                                                                         | Unedited. No new control carries a `name`.                                                                                                                                                                                                                  |
| `accessible-pickers-focus.svelte.test.ts:71-86`                                                                        | Focus moves from + to the checked secondary radio, and from × back to +                                                                                                                        | Unedited. It is the proof that `bind:ref={addSecondaryButton}` works.                                                                                                                                                                                       |
| `accessible-pickers-focus.svelte.test.ts:150-200`                                                                      | After removing a custom chip, focus lands on the next chip, else the previous one, else the text field. If the parent declines the removal, focus stays.                                       | Unedited. It is the proof that `bind:ref={removeButtons[name]}` works.                                                                                                                                                                                      |
| `dose-edit-form-lock.test.ts:205-214`                                                                                  | Save is `aria-disabled` and never `disabled`, and carries `min-h-11`                                                                                                                           | Unedited. Save is fenced.                                                                                                                                                                                                                                   |
| `medication-card-targets-ssr.test.ts:191-250`, `medications-reorder-lock.test.ts`                                      | The reorder arrows: ids, names, `disabled`, sizes, and the lock                                                                                                                                | Unedited. Fenced and not touched.                                                                                                                                                                                                                           |
| `inventory-event-types.test.ts`                                                                                        | The `EVENT_LABELS` block, read from source                                                                                                                                                     | Unedited                                                                                                                                                                                                                                                    |
| e2e `medication-lifecycle.test.ts:36,47,49,62,67,78,81` and `schedule-editor.test.ts:41,43,75,104,105,136,138,147-150` | `getByRole("button", { name })` for "Add Medication", "Update Medication", "Fixed time", "As needed (PRN)", `/archive/i`, and exact "Mon", "Wed", "Fri"                                        | The names are unchanged. Button hides the inactive "Saving…" label from assistive tech. `/archive/i` still matches only Archive on an active medication, because Unarchive is not rendered then. Not run in CI. The new SSR tests below pin the same names. |

The contrast of the Toggle "on" state at these sites is already covered by `theme-tokens.test.ts:265-277`. That test checks accent/15 with `accentInkFor` over `card` (MedicationForm's GlassCard) and over `surface-raised` (DoseEditForm's Modal panel, `Modal.svelte:101`), and `ACCENT_CHIP_ALPHA` is 0.15 (`theme-css.ts:155`). The Alert backdrops (needs-you, happened and wrong, each over `card`) are T1's rows.

- [ ] **Step 1: The medication pages' actions and outcomes, starting with the failing test**

  Extend `tests/unit/medication-inventory-history-ssr.test.ts`, which T5 created. It already has:
  - `// @vitest-environment node`;
  - the `$app/forms` mock;
  - `Page`, the detail page;
  - `user` and `preferences`;
  - `MEDICATION` (`BASE_MEDICATION_ROW` with `lowInventoryEpisodeAt: null`, which `npm run check` needs);
  - `toneClass`, `ssrDocument` and `textOf`.

  Add imports for:
  - `ListPage` from `../../src/routes/(app)/medications/+page.svelte`;
  - `type ComponentProps` from `svelte`;
  - `type Tone` from `$lib/utils/status-tone`;
  - `doseWriteContext` from `./helpers/dashboard-context`;
  - `runAxe` and `evaluatedRules` from `./helpers/axe-ssr`;
  - `buttonNamed` from `./helpers/dom-names`.

  Then append:

<!-- prettier-ignore -->
```ts
const FOCUS_RING = "focus-visible:outline-accent-ink";
const classes = (el: Element | null | undefined) => [...(el?.classList ?? [])];
const toneTokens = (tone: Tone) => toneClass(tone, "alert").split(" ");

function detail(form: ComponentProps<typeof Page>["form"] = null, medication = MEDICATION) {
  return ssrDocument(
    render(Page, {
      props: { data: { user, preferences, medication, schedules: [], inventoryHistory: [] }, form },
    }).body,
  );
}
const inventoryCard = (doc: Document) =>
  [...doc.querySelectorAll("h2")].find((h) => textOf(h) === "Inventory")!.parentElement!;

describe("a medication's inventory and archive actions", () => {
  it("makes Mark as refilled the one primary action, 44px with the focus ring", () => {
    const refill = buttonNamed(detail(), "Mark as refilled");
    expect(refill.getAttribute("type")).toBe("submit");
    expect(classes(refill)).toEqual(expect.arrayContaining(["bg-accent", "text-accent-fg", "h-11", FOCUS_RING]));
  });

  it.each(["Adjust", "Archive"])("draws %s as a neutral secondary Button, never amber or red", (name) => {
    const button = buttonNamed(detail(), name);
    expect(classes(button)).toEqual(
      expect.arrayContaining(["border-border-strong", "text-text-primary", "h-11", FOCUS_RING]),
    );
    expect(button.className).not.toMatch(/warning|danger/);
  });

  it("draws Unarchive the same way on an archived medication", () => {
    const doc = detail(null, { ...MEDICATION, isArchived: true, archivedAt: new Date("2026-02-01T00:00:00.000Z") });
    const button = buttonNamed(doc, "Unarchive");
    expect(classes(button)).toEqual(expect.arrayContaining(["border-border-strong", "h-11"]));
    expect(classes(button)).not.toContain("border-accent-ink");
    expect(classes(button)).not.toContain("text-accent-ink");
  });
});

describe("the refill and adjustment outcomes", () => {
  it("keeps both status regions mounted, and silent, when there is nothing to report", () => {
    const regions = inventoryCard(detail()).querySelectorAll('[role="status"]');
    expect(regions).toHaveLength(2);
    for (const region of regions) expect(textOf(region)).toBe("");
  });

  it.each([
    ["refill", { refillOk: true, newCount: 40 }, "Refill recorded. New count: 40."],
    ["adjustment", { adjustOk: true, newCount: 12, quantityChange: -3 }, "Adjustment recorded. New count: 12 (-3)."],
  ] as const)("reports a recorded %s as a success Alert inside its status region", (_kind, form, message) => {
    const doc = detail(form);
    const region = [...inventoryCard(doc).querySelectorAll('[role="status"]')].find((r) => textOf(r) === message);
    expect(region, `no status region says "${message}"`).toBeDefined();
    const box = region!.firstElementChild!;
    expect(classes(box)).toEqual(expect.arrayContaining(toneTokens("happened")));
    expect(box.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(doc.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([
    ["refill", { refillError: "Quantity must be a positive whole number." }],
    ["adjustment", { adjustError: "New count must be a whole number, 0 or greater." }],
  ] as const)("states a refused %s as an error Alert, outside the status regions", (_kind, form) => {
    const alerts = detail(form).querySelectorAll('[role="alert"]');
    expect(alerts).toHaveLength(1);
    expect(textOf(alerts[0])).toBe(Object.values(form)[0]);
    expect(alerts[0].closest('[role="status"]')).toBeNull();
    expect(classes(alerts[0])).toEqual(expect.arrayContaining(toneTokens("wrong")));
  });

  it("passes axe: button-name, aria-allowed-attr", async () => {
    const rules = ["button-name", "aria-allowed-attr"];
    const results = await runAxe(detail({ refillError: "Quantity must be a positive whole number." }), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});

describe("the medications list header", () => {
  it("makes + Add Medication the page's primary action: a 36px link with the focus ring", () => {
    const doc = ssrDocument(
      render(ListPage, {
        props: { data: { user, preferences, medications: [], archived: [] } },
        context: doseWriteContext(),
      }).body,
    );
    const add = [...doc.querySelectorAll('a[href="/medications/new"]')].find((a) => textOf(a) === "+ Add Medication");
    expect(add, "no + Add Medication link").toBeDefined();
    expect(classes(add)).toEqual(expect.arrayContaining(["bg-accent", "text-accent-fg", "h-9", FOCUS_RING]));
  });
});
```

Run `npx vitest run tests/unit/medication-inventory-history-ssr.test.ts`. Expect T5's case to pass and the new ones to FAIL:

- "Mark as refilled" and "+ Add Medication" do not include `h-11` and `h-9`. They are still `px-4 py-2`.
- Adjust's `className` matches `/warning/`, and Archive's matches `/danger/`.
- The success box lacks `border-success/30`.
- The error case expects length 1 and gets `[]`, because today's error is a `<p>` with no role inside `role="status"`.
- The "keeps both status regions mounted" test already passes at HEAD. It is a guard: deleting a wrapper fails it.

Implement:

- `medications/+page.svelte:85-89` becomes `<Button variant="primary" size="sm" href="/medications/new">+ Add Medication</Button>`.
- `[id]/+page.svelte:122-127` becomes `<Button variant="primary" type="submit" class="self-end">Mark as refilled</Button>`.
- `[id]/+page.svelte:170-175` becomes `<Button type="submit" class="self-end">Adjust</Button>`, which is secondary md.
- `[id]/+page.svelte:227-232` and `:240-245` become `<Button type="submit">Unarchive</Button>` and `<Button type="submit">Archive</Button>`.
- `[id]/+page.svelte:64-90`: each `role="status"` wrapper stays mounted and now holds only the success Alert:
  - `<Alert tone="happened" class="mb-4" title={`Refill recorded. New count: ${form.newCount}.`} />`
  - `<Alert tone="happened" class="mb-4" title={`Adjustment recorded. New count: ${form.newCount} (${form.quantityChange > 0 ? "+" : ""}${form.quantityChange}).`} />`

  The copy is byte-for-byte today's.

- Each error renders immediately AFTER its wrapper, as `{#if form?.refillError}<Alert tone="wrong" class="mb-4" title={form.refillError} />{/if}` (and the same for `adjustError`).
- Extend the comment at :64-65: "A failure is an Alert with role=alert, which announces itself; inside the polite region it would be read twice."

Then run `npx vitest run tests/unit/status-colour-owner.test.ts`. Expect it to FAIL on "every pending file still writes one: a task that finishes a file deletes its line", naming `src/routes/(app)/medications/[id]/+page.svelte`. Its last literals, the banners, Adjust and Archive, are gone, and T5 already neutralised the ±N. Delete that entry and re-run. Expect it to PASS.

Run `npx vitest run tests/unit/medication-inventory-history-ssr.test.ts tests/unit/medication-card-targets-ssr.test.ts tests/unit/medications-reorder-lock.test.ts tests/unit/inventory-event-types.test.ts`. Expect it to PASS.

Mutation proofs:

- Restore `border-warning text-warning` on Adjust. "draws Adjust as a neutral secondary Button" must fail.
- Move `{#if form?.refillError}` back inside the wrapper. "states a refused refill … outside the status regions" must fail.

Commit: `refactor(medications): Button and Alert for the detail page's actions and outcomes`

- [ ] **Step 2: Fix MedicationForm's submit, crash message and focus fallback, and make the interaction notice an Alert, starting with the failing tests**

  In `tests/unit/form-errors-enhance-callbacks.test.ts`, add a helper beside `submit()`:

<!-- prettier-ignore -->
```ts
/** A button's name as assistive tech gets it: its text without hidden or invisible parts. */
function spokenName(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll('[aria-hidden="true"], .invisible').forEach((n) => n.remove());
  return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
}
```

Add these three tests to `describe("MedicationForm")`:

<!-- prettier-ignore -->
```ts
it("moves focus to its own message for a group-level failure, never to an alert elsewhere on the page", async () => {
  const elsewhere = document.body.insertBefore(document.createElement("p"), document.body.firstChild);
  elsewhere.setAttribute("role", "alert");
  elsewhere.tabIndex = -1;
  try {
    mountForm({ errors: { colour: ["Choose a colour"] } });
    await submit(failure(400, { errors: { colour: ["Choose a colour"] } }));
    expect(document.activeElement).toBe(target.querySelector("#colour-error"));
  } finally {
    elsewhere.remove();
  }
});

it("moves focus to its own invalid field, never to one elsewhere on the page", async () => {
  const elsewhere = document.body.insertBefore(document.createElement("input"), document.body.firstChild);
  elsewhere.setAttribute("aria-invalid", "true");
  try {
    mountForm({ errors: { name: ["Name is required"] } });
    await submit(failure(400, { errors: { name: ["Name is required"] } }));
    expect(document.activeElement).toBe(target.querySelector("#name"));
  } finally {
    elsewhere.remove();
  }
});

it("says Saving… on a disabled, busy submit while the request runs, and hands it back after a crash", async () => {
  mountForm();
  const button = () => target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(spokenName(button())).toBe("Add Medication");
  const formElement = target.querySelector("form")!;
  const action = new URL("http://localhost/medications/new");
  const formData = new FormData(formElement);
  const after = await captured.submit!({
    action, formData, formElement, controller: new AbortController(), submitter: null, cancel: () => {},
  });
  flushSync();
  expect(button().disabled).toBe(true);
  expect(button().getAttribute("aria-busy")).toBe("true");
  expect(spokenName(button())).toBe("Saving…");

  if (typeof after === "function") {
    await after({ action, formData, formElement, result: CRASH, update: vi.fn(async () => {}) });
  }
  flushSync();
  await tick();
  expect(button().disabled).toBe(false);
  expect(button().getAttribute("aria-busy")).not.toBe("true");
  expect(spokenName(button())).toBe("Add Medication");
});
```

Create `tests/unit/medication-form-controls-ssr.test.ts` (`// @vitest-environment node`). Set it up with:

- the same `$app/forms` mock;
- `classes`, `FOCUS_RING` and `toneTokens` as in Step 1;
- a `spoken(el)` that returns `aria-label` when there is one, else `spokenName` as above;
- `parse = ssrDocument`.

Its first two describes:

<!-- prettier-ignore -->
```ts
describe("MedicationForm's submit", () => {
  const form = (props: ComponentProps<typeof MedicationForm> = {}) => ssrDocument(render(MedicationForm, { props }).body);

  it.each([
    [{}, "Add Medication"],
    [{ medication: { ...BASE_MEDICATION_ROW, lowInventoryEpisodeAt: null } }, "Update Medication"],
  ] as const)("is a full-width 44px primary Button named %#", (props, name) => {
    const submits = form(props).querySelectorAll('form button[type="submit"]');
    expect(submits).toHaveLength(1);
    expect(spoken(submits[0])).toBe(name);
    expect(classes(submits[0])).toEqual(expect.arrayContaining(["bg-accent", "text-accent-fg", "w-full", "h-11", FOCUS_RING]));
    expect(submits[0].hasAttribute("disabled")).toBe(false);
  });

  it("gives every other control in the form an explicit type=button, so no picker submits it", () => {
    const doc = form({ formValues: { scheduleMode: "fixed_time", colourSecondary: "#f59e0b" } });
    const buttons = [...doc.querySelectorAll("form button")];
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) expect(["button", "submit"], b.outerHTML).toContain(b.getAttribute("type"));
    expect(buttons.filter((b) => b.getAttribute("type") === "submit")).toHaveLength(1);
  });
});

describe("InteractionWarningPanel", () => {
  const panel = (warnings: string[]) => ssrDocument(render(InteractionWarningPanel, { props: { warnings } }).body);

  it("says it needs you without interrupting: a needs-you Alert in a status region, never role=alert", () => {
    const doc = panel(["Aspirin may increase bleeding risk."]);
    expect(doc.querySelector('[role="alert"]')).toBeNull();
    const region = doc.querySelector('[role="status"]')!;
    expect(classes(region.firstElementChild)).toEqual(expect.arrayContaining(toneTokens("needs-you")));
    expect(textOf(region)).toContain("Experimental interaction notice");
    expect(textOf(region)).toContain("Aspirin may increase bleeding risk.");
    expect(textOf(region)).toContain("This check may miss interactions and may produce false positives.");
  });

  it("keeps its status region mounted, and empty, while there is nothing to say", () => {
    const region = panel([]).querySelector('[role="status"]');
    expect(region).not.toBeNull();
    expect(textOf(region!)).toBe("");
  });
});
```

Run `npx vitest run tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/medication-form-controls-ssr.test.ts`. Expect it to FAIL:

- The two decoy tests: `expected <p role="alert"> to be <p id="colour-error">`, and the same for `<input>`. `MedicationForm.svelte:154-155` queries `document`.
- The pending test: `aria-busy` is `null`, and the name reads "Saving..." in ASCII.
- The SSR submit lacks `h-11`.
- The panel test finds a `[role="alert"]`, and the empty render has no `[role="status"]`.
- "gives every other control … type=button" already passes. It is a guard: give "+ Add time" `type="submit"` and it fails.

Implement in `MedicationForm.svelte`:

- Delete `actionErrorEl` (:65). Add `const ACTION_ERROR_ID = "medication-form-error";`.
- The after-callback takes `{ formElement, result, update }`.
- Error branch (:139-140): `await tick(); formElement.querySelector<HTMLElement>(`#${ACTION_ERROR_ID}`)?.focus();`.
- Failure branch (:154-155): `formElement.querySelector` for both `[aria-invalid="true"]` and `[role="alert"]`.
- Extend the comment at :148-153: "Scoped to this form, as DoseEditForm's `focusFirstProblem` is. A page-wide query took the first alert on the page, which was the interaction notice, not this form's message."
- :249-258 becomes `{#if actionError}<Alert tone="wrong" id={ACTION_ERROR_ID} title={actionError} tabindex={-1} />{/if}`.
- :260-266 becomes `<Button variant="primary" type="submit" block disabled={loading} pending={loading}>{medication ? "Update Medication" : "Add Medication"}</Button>`. The `pendingLabel` default is "Saving…". `disabled` stays real, as `form-errors-enhance-callbacks.test.ts:323` requires.

Implement in `InteractionWarningPanel.svelte`:

- The root becomes an always-mounted `<div role="status">`.
- Inside it: `{#if warnings.length > 0}<Alert tone="needs-you" title="Experimental interaction notice" class="mt-2">…</Alert>{/if}`.
- The children are today's `{#each warnings as warning}<p>{warning}</p>{/each}` followed by today's footer `<p class="text-text-muted mt-2 text-xs">`, with the text unchanged.
- The eyebrow's `text-warning … uppercase` classes go. Its words become the title.

Implement in `MedicationIdentityFields.svelte:19-30`: wrap `<Input>` and `<InteractionWarningPanel>` in one `<div>`, with this comment: "The notice's status region is always mounted. As a direct child of the form's `space-y-5` it would add a 20px gap even when empty."

Run `npx vitest run tests/unit/status-colour-owner.test.ts`. Expect it to FAIL on "every pending file still writes one", naming `src/lib/components/MedicationForm.svelte` and `src/lib/components/medication-form/InteractionWarningPanel.svelte`. Delete both entries and re-run. Expect it to PASS.

Run `npx vitest run tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/medication-form-controls-ssr.test.ts tests/unit/accessible-pickers-ssr.test.ts tests/unit/form-errors-field-errors.test.ts`. Expect it to PASS, including the unedited crash tests at :312-348.

Mutation proofs:

- Change either `formElement.querySelector` at :154-155 back to `document.querySelector`. The matching decoy test must fail.
- Drop `pending={loading}`. The `aria-busy` assertion must fail.
- Put `role="alert"` back on the panel. The panel test must fail.

Commit: `fix(medication-form): scope the failure focus to the form; Button, Alert and a polite interaction notice`

- [ ] **Step 3: Schedule and colour controls, starting with the failing tests**

  Append two describes to `tests/unit/medication-form-controls-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
describe("MedicationScheduleSection's controls", () => {
  const schedule = (p: Partial<ComponentProps<typeof ScheduleSection>> = {}) =>
    ssrDocument(render(ScheduleSection, {
      props: { mode: "fixed_time", intervalHours: "", fixedTimes: ["08:00"], daysOfWeek: [], errors: {}, ...p },
    }).body);
  const MODE_GROUP = '[role="group"][aria-label="Schedule"]';

  it("offers the three modes as Toggles, only the current one pressed", () => {
    const modes = [...schedule().querySelectorAll(`${MODE_GROUP} button`)];
    expect(modes.map(spoken)).toEqual(["Interval", "Fixed time", "As needed (PRN)"]);
    expect(modes.map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
    for (const b of modes) {
      expect(b.getAttribute("type")).toBe("button");
      expect(classes(b)).toEqual(expect.arrayContaining(["h-9", FOCUS_RING]));
    }
    expect(classes(modes[1])).toEqual(expect.arrayContaining(["border-accent-ink", "bg-accent/15", "text-accent-ink"]));
    for (const b of [modes[0], modes[2]]) {
      expect(classes(b)).toContain("border-border-strong");
      expect(classes(b)).not.toContain("border-glass-border");
    }
  });

  it("offers the seven days as Toggles, pressed from daysOfWeek", () => {
    const days = [...schedule({ daysOfWeek: [1, 3, 5] }).querySelectorAll("button[aria-pressed]")].filter(
      (b) => !b.closest(MODE_GROUP),
    );
    expect(days.map(spoken)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(days.filter((b) => b.getAttribute("aria-pressed") === "true").map(spoken)).toEqual(["Mon", "Wed", "Fri"]);
    for (const b of days) expect(classes(b)).toContain("h-9");
  });

  it("removes a time with a neutral secondary Button, disabled only while one row is left", () => {
    const removes = (doc: Document) => [...doc.querySelectorAll('button[aria-label="Remove this time"]')];
    expect(removes(schedule()).map((b) => b.hasAttribute("disabled"))).toEqual([true]);
    const two = removes(schedule({ fixedTimes: ["08:00", "20:00"] }));
    expect(two.map((b) => b.hasAttribute("disabled"))).toEqual([false, false]);
    for (const b of two) {
      expect(b.getAttribute("type")).toBe("button");
      expect(classes(b)).toEqual(expect.arrayContaining(["border-border-strong", "h-9", FOCUS_RING]));
      expect(b.className).not.toMatch(/danger/);
    }
  });

  it("adds a time with a secondary sm Button", () => {
    const add = [...schedule().querySelectorAll("button")].find((b) => spoken(b) === "+ Add time")!;
    expect(add.getAttribute("type")).toBe("button");
    expect(classes(add)).toEqual(expect.arrayContaining(["border-border-strong", "h-9", FOCUS_RING]));
  });
});

describe("MedicationStylePicker's add and remove buttons", () => {
  const picker = (secondary: string | null) =>
    ssrDocument(render(StylePicker, {
      props: { selectedColour: "#6366f1", selectedColourSecondary: secondary, selectedPattern: secondary ? "stripes" : "solid", errors: {} },
    }).body);

  it.each([
    [null, "Add secondary colour"],
    ["#f59e0b", "Remove secondary colour"],
  ] as const)("draws %s's button as a 36px IconButton with a hidden glyph", (secondary, label) => {
    const b = picker(secondary).querySelector(`button[aria-label="${label}"]`)!;
    expect(b.getAttribute("type")).toBe("button");
    expect(classes(b)).toEqual(expect.arrayContaining(["size-9", "border-border-strong", FOCUS_RING]));
    expect(b.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it("draws Remove secondary colour neutrally, because removing a colour can be undone", () => {
    const remove = picker("#f59e0b").querySelector('button[aria-label="Remove secondary colour"]')!;
    expect(remove.className).not.toMatch(/danger/);
  });
});
```

Run `npx vitest run tests/unit/medication-form-controls-ssr.test.ts`. Expect it to FAIL:

- Unpressed modes carry `border-glass-border`.
- There is no `h-9` on the modes or weekdays (they are `py-2` and `py-1.5`).
- Remove's `className` matches `/danger/` through `hover:text-danger-ink`.
- +/× lack `size-9` (they are `h-8 w-8`), and × matches `/danger/`.

Implement in `MedicationScheduleSection.svelte`:

- :50-82 becomes three `<Toggle pressed={mode === "interval"} onclick={() => (mode = "interval")} class="flex-1">Interval</Toggle>`, and the same for "Fixed time" and "As needed (PRN)".
- :165-176 becomes `<Toggle pressed={daysOfWeek.includes(value)} onclick={() => toggleDay(value)}>{short}</Toggle>`.
- :134-142 becomes `<Button size="sm" disabled={fixedTimes.length <= 1} aria-label="Remove this time" onclick={() => removeFixedTime(idx)}>Remove</Button>`. It is secondary per the spec ("removing a schedule row"). It keeps the visible word over an IconButton, keeps the real `disabled`, and loses the red hover.
- :146-152 becomes `<Button size="sm" class="mt-2" onclick={addFixedTime}>+ Add time</Button>`.

Implement in `MedicationStylePicker.svelte`:

- :159-165 becomes `<IconButton label="Add secondary colour" size="sm" variant="secondary" class="border-dashed" bind:ref={addSecondaryButton} onclick={addSecondary}><span aria-hidden="true" class="text-lg">+</span></IconButton>`.

  `border-dashed` works whatever the class order, because Tailwind v4's `border` sets `border-style: var(--tw-border-style)`. It reads as an empty slot beside the 32px swatches.

- :190-194 becomes `<IconButton label="Remove secondary colour" size="sm" variant="secondary" onclick={removeSecondary}><span aria-hidden="true">&times;</span></IconButton>`, which is solid and neutral.
- `addSecondaryButton`'s declared type (:50) stays as it is. svelte2tsx checks a component binding only from value to prop, so `HTMLButtonElement | undefined` into IconButton's `ref: HTMLButtonElement | HTMLAnchorElement | null` type-checks. This was verified in svelte-check's bundled transform, which emits `() => x = __sveltets_2_any(null)` for the reverse.

Run `npx vitest run tests/unit/status-colour-owner.test.ts`. Expect it to FAIL on "every pending file still writes one", naming `src/lib/components/medication-form/MedicationScheduleSection.svelte` and `src/lib/components/medication-form/MedicationStylePicker.svelte`.

What remains in those files is field-error paragraphs, which T1's mask covers (quoted or template ids, across lines, without a `bg-` fill):

- `<p id="schedules-error"`, multi-line at :107-111 and :180-184;
- `<p id="colour-error"` at :262.

Delete both entries and re-run. Expect it to PASS.

Run `npx vitest run tests/unit/medication-form-controls-ssr.test.ts tests/unit/accessible-pickers-ssr.test.ts tests/unit/accessible-pickers-focus.svelte.test.ts tests/unit/tooltip-labelling.test.ts`. Expect it to PASS.

Mutation proofs:

- Drop `disabled={fixedTimes.length <= 1}`. "disabled only while one row is left" must fail.
- Drop `bind:ref={addSecondaryButton}`. `accessible-pickers-focus.svelte.test.ts:81-86` must fail.

Commit: `refactor(medication-form): Toggle, Button and IconButton for the schedule and colour controls`

- [ ] **Step 4: Side-effect chips and the dose editor's Cancel and form-level banner, starting with the failing tests**

  Append to `tests/unit/medication-form-controls-ssr.test.ts`:

<!-- prettier-ignore -->
```ts
describe("SideEffectPicker's chips", () => {
  const doc = ssrDocument(render(SideEffectPicker, {
    props: { value: [{ name: "Nausea", severity: "mild" }, { name: "Rash", severity: "moderate" }], onchange: () => {} },
  }).body);

  it("draws the common effects as pill Toggles", () => {
    const toggles = [...doc.querySelectorAll("button[aria-pressed]")].filter((b) => !b.hasAttribute("aria-label"));
    expect(toggles.map(spoken)).toEqual(["Nausea", "Headache", "Dizziness", "Drowsiness", "Dry mouth", "Fatigue", "Insomnia", "Appetite change"]);
    for (const t of toggles) expect(classes(t)).toEqual(expect.arrayContaining(["rounded-full", "h-9", FOCUS_RING]));
  });

  it("draws a custom effect as a removable action, not as a pressed toggle", () => {
    const chip = doc.querySelector('button[aria-label="Remove Rash"]')!;
    expect(chip.getAttribute("type")).toBe("button");
    expect(chip.hasAttribute("aria-pressed")).toBe(false);
    expect(classes(chip)).toEqual(expect.arrayContaining(["border-border-strong", "rounded-full", "h-9", FOCUS_RING]));
    for (const pressedCue of ["border-accent-ink", "bg-accent/15", "text-accent-ink"]) {
      expect(classes(chip)).not.toContain(pressedCue);
    }
  });

  it("adds a custom effect with a secondary sm Button, disabled while the field is empty", () => {
    const add = [...doc.querySelectorAll("button")].find((b) => spoken(b) === "Add")!;
    expect(classes(add)).toEqual(expect.arrayContaining(["border-border-strong", "h-9"]));
    expect(add.hasAttribute("disabled")).toBe(true);
  });
});
```

In `tests/unit/dose-edit-form-lock.test.ts`, add after `describe("DoseEditForm under the layout's write lock")`:

<!-- prettier-ignore -->
```ts
describe("DoseEditForm's Cancel", () => {
  it("is a 44px ghost Button beside the fenced Save, and closes without submitting", () => {
    const { save, form } = mountEditForm();
    const cancel = [...form.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancel")!;
    expect(cancel.getAttribute("type")).toBe("button");
    expect([...cancel.classList]).toEqual(expect.arrayContaining(["h-11", "text-text-secondary", "focus-visible:outline-accent-ink"]));
    expect([...cancel.classList]).not.toContain("border");
    // The fence (spec, "The fence: dose controls"): Save's markup is not this migration's.
    expect(save.className).toBe(
      "bg-accent text-accent-fg min-h-11 flex-1 rounded-lg py-2.5 text-sm font-medium transition-opacity hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
    );
    cancel.click();
    expect(onclose).toHaveBeenCalledOnce();
  });
});
```

In `tests/unit/form-errors-enhance-callbacks.test.ts`, add `import { toneClass } from "$lib/utils/status-tone";`, and inside `describe("DoseEditForm")` add:

<!-- prettier-ignore -->
```ts
it("draws its form-level message as an error Alert, still the form's one id-less alert", async () => {
  await submit(CRASH);
  const alert = formAlert()!;
  expect([...alert.classList]).toEqual(expect.arrayContaining(toneClass("wrong", "alert").split(" ")));
  expect(alert.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect(target.querySelector("form")!.querySelectorAll('[role="alert"]:not([id])')).toHaveLength(1);
});
```

Run `npx vitest run tests/unit/medication-form-controls-ssr.test.ts tests/unit/dose-edit-form-lock.test.ts tests/unit/form-errors-enhance-callbacks.test.ts`. Expect it to FAIL:

- The chips are `rounded-lg` with no `h-9`.
- "Remove Rash" carries `border-accent-ink`, which is the "on" recipe.
- Cancel lacks `h-11` and carries `border`.
- The DoseEditForm banner is `bg-danger/10 text-danger-ink` with no `border-danger-ink/35` and no icon.
- The Save literal assertion already passes. It is the fence's guard.

Implement in `SideEffectPicker.svelte`:

- :98-107 becomes `<Toggle shape="pill" pressed={isSelected(name)} onclick={() => toggle(name)}>{name}</Toggle>`.
- :119-128 becomes `<Button size="sm" shape="pill" bind:ref={removeButtons[name]} aria-label="Remove {name}" onclick={() => removeCustom(name)}>{name} <span aria-hidden="true">&times;</span></Button>`.

  It is a secondary pill: the same shape as the toggles beside it, but with none of a pressed toggle's cues (no `aria-pressed`, no accent border or tint), and its `×` and "Remove …" name say it deletes. The shape comes from `shape="pill"`, never from `class`: Tailwind v4 orders same-property utilities by name, so an appended `rounded-full` loses to `rounded-lg`.

- :71 becomes `const removeButtons = $state<Record<string, HTMLButtonElement | null>>({});`. Binding a component prop to a member of a plain object warns `binding_property_non_reactive` in dev. `bind:this` was exempt from that warning, and a component binding is not. `removeCustom` (:78-85) is unchanged.
- :147-154 becomes `<Button size="sm" disabled={!customInput.trim()} onclick={addCustom}>Add</Button>`.

Implement in `DoseEditForm.svelte`:

- :245-251 becomes `<Button variant="ghost" class="flex-1" onclick={onclose}>Cancel</Button>`. That is md, so 44px beside Save's `min-h-11`.
- :238-242 becomes `{#if formError}<Alert tone="wrong" title={formError} tabindex={-1} />{/if}`.
  - It has NO `id`: the form's own tests find it as `[role="alert"]:not([id])` (:158-159).
  - The comment at :234-237 stays.
  - The form's `space-y-4` spaces it, so it needs no margin.
- Save (:252-261), the field errors and `save` are unchanged.

`PENDING_MIGRATION`:

- `DoseEditForm.svelte`: :239 was its only unmasked literal. The field errors at :168, :188, :206 and :224 are `<p id="…-error">` with no `bg-` fill, which T1's mask covers. Run the scan and expect it to FAIL on "every pending file still writes one", naming `src/lib/components/DoseEditForm.svelte`. Delete the entry and re-run. Expect it to PASS.
- `SideEffectPicker.svelte` left the list in T4, which took its severity literals. The chips this step touches carry only accent and neutral tokens, so it adds no literal back.

Run `npx vitest run tests/unit/medication-form-controls-ssr.test.ts tests/unit/dose-edit-form-lock.test.ts tests/unit/accessible-pickers-ssr.test.ts tests/unit/accessible-pickers-focus.svelte.test.ts tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/begin-dose-write.test.ts tests/unit/status-colour-owner.test.ts`. Expect it to PASS. The DoseEditForm tests at `form-errors-enhance-callbacks.test.ts:213-285` and `dose-edit-form-lock.test.ts` pass unedited.

Mutation proofs:

- Give the custom chip `variant="primary"`, or the old on-recipe. "not as a pressed toggle" must fail.
- Drop `shape="pill"` from the custom chip. The same test must fail on `rounded-full`.
- Drop `bind:ref={removeButtons[name]}`. `accessible-pickers-focus.svelte.test.ts:150-161` must fail.
- Give the DoseEditForm Alert `id="form-error"`. `form-errors-enhance-callbacks.test.ts:225-238` ("answers a crash in place") must fail, because `formAlert()` is null.

Commit: `refactor(dose-edit): ghost Cancel and an error Alert; pill Toggles and removable side-effect chips`

- [ ] **Step 5: Gates**

  Run `npx vitest run tests/unit/medication-inventory-history-ssr.test.ts tests/unit/medication-form-controls-ssr.test.ts tests/unit/form-errors-enhance-callbacks.test.ts tests/unit/dose-edit-form-lock.test.ts tests/unit/status-colour-owner.test.ts`. Expect PASS.

  Then run `npx vitest run`, `npm run check`, `npm run lint` and `npm run format:check`. Expect:
  - 0 failures;
  - check 0 errors and at most 27 warnings;
  - lint 0 errors and at most 115 warnings;
  - format clean.

  Expect exactly the header pending table's Task 10 set to have left `PENDING_MIGRATION` in this task, six files:
  - `src/routes/(app)/medications/[id]/+page.svelte`
  - `src/lib/components/MedicationForm.svelte`
  - `src/lib/components/medication-form/InteractionWarningPanel.svelte`
  - `src/lib/components/medication-form/MedicationScheduleSection.svelte`
  - `src/lib/components/medication-form/MedicationStylePicker.svelte`
  - `src/lib/components/DoseEditForm.svelte`

  `git grep -nE "\b(text|bg|border|ring)-(warning|success|danger|danger-ink|danger-fg|info)(/[0-9]+)?\b"` over those six files should print only field-error `<p id="…-error">` lines.

### Task 11: Log page controls and app chrome

Migrate `/log`'s filter and pagination controls to `Button`, the mobile menu's toggle and close and the shortcuts overlay's close to `IconButton`, and align MedicationFilterSelect.

**Files:**

- Modify: `src/routes/(app)/log/+page.svelte` (Apply :273-278, Clear filters :283-289, Previous :337-343, Next :347-353)
- Modify: `src/lib/components/MobileHeader.svelte` (the toggle, :29-41)
- Modify: `src/lib/components/Sidebar.svelte` (the close button, :79-95)
- Modify: `src/lib/components/KeyboardShortcuts.svelte` (the close button, :152-166)
- Modify: `src/lib/components/MedicationFilterSelect.svelte` (the trigger :58-67, Clear filter :113-119)
- Modify: `tests/unit/log-pagination-ssr.test.ts`
- Modify: `tests/unit/quick-log-target.test.ts`
- Create: `tests/unit/app-chrome-icon-buttons-ssr.test.ts`
- Create: `tests/unit/medication-filter-select.test.ts`

**Interfaces:**

- Consumes:
  - From T2: `Button` (`href`, `size`, `type`, and through `rest` `onclick`, `rel`, `aria-label`).
  - From T2: `IconButton` (`label`, `size`, and through `rest` `onclick`, `aria-expanded`, `aria-controls`, `class`), plus its bindable `ref` for MobileHeader's toggle. IconButton's `type` defaults to `"button"` (Task 2 pins it); the call-site tests here pin it again.
  - From T2: `withoutComments` in `tests/unit/helpers/axe-ssr.ts`, which T9 Step 9.6 already imports into `log-pagination-ssr.test.ts`.
- Produces: nothing.

**`PENDING_MIGRATION`:** none of these five files contains a status-token literal at `925be44`. This was checked against the scan regex. T11 edits no list, and must not add one.

**The fence, and bespoke neighbours, untouched:**

- `TimelineEntry`'s ✎ and × (`TimelineEntry.svelte`, not opened).
- The edit `Modal` and `DoseEditForm` on `/log` (T10 owns Cancel).
- `(app)/+layout.svelte` entirely: its full-screen scrim, its `menuToggle` (:41) and `closeMenu` focus return (:73). The layout needs no edit; see the `ref` note below.
- MobileHeader's avatar link (:51-57) and Sidebar's avatar link (:121-137), both bespoke.
- Sidebar's nav links (:99-114).
- KeyboardShortcuts' 1–9, `n`, `/` and `?` handling (:30-110) and its focus effect (:114-116), which keeps finding the close with `helpEl.querySelector("button")`.
- The `/log` filter `<select>`s and `<input>`s.
- The `/log` EmptyState actions (:293-308), which are T9's.
- Tooltip, and the onboarding step dots.

**What already pins this markup, and how each pin fares:**

| Test                                                                       | What it pins                                                                                                                                                                                                     | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `log-pagination-ssr.test.ts:215-226`                                       | Previous/Next's opening tags contain `border-border-strong` and not `border-glass-border`                                                                                                                        | Unedited. Button secondary carries `border border-border-strong`.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `log-pagination-ssr.test.ts:228-234`                                       | The landmark's label, and `aria-label="Go to previous page"` / `"Go to next page"`                                                                                                                               | Unedited. `aria-label` and `rel` pass through `rest`.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `log-pagination-ssr.test.ts:172-213`                                       | The hrefs keep every filter                                                                                                                                                                                      | Unedited                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `log-pagination-ssr.test.ts:259-265`                                       | `/<a\b[^>]*href="\/log"[^>]*>\s*Clear filters\s*<\/a>/`: "Clear filters" is the anchor's whole content                                                                                                           | **Changes to the same strength.** The regex is unchanged. Only its subject is passed through `withoutComments` first: Task 2's shared helper, which T9 Step 9.6 imports here and uses at :287 and :296. A component's rendered children always carry Svelte's `<!---->` hydration markers; this was verified by compiling a sample, where the caller's snippet pushes `` `<!---->Clear filters` ``. Comments are not content, so the anchor's content is still exactly the label. |
| `log-pagination-ssr.test.ts:279-298`                                       | EmptyState's "Clear filters" and "Log a dose" actions                                                                                                                                                            | T9's, already wrapped in `withoutComments` there. T11 leaves them alone.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `log-page-mount.svelte.test.ts:222-225, :268-337, :387-402`                | `form[method="GET"] a[href="/log"]` is focusable; `onclick` arms the refocus (the modifier and middle-button cases); `a[rel="next"]` and `a[rel="prev"]` hrefs track navigation                                  | Unedited. Button renders `<a href>` inside the form and passes `onclick` and `rel` through.                                                                                                                                                                                                                                                                                                                                                                                       |
| `mobile-nav-focus.test.ts:115-119, :139-141, :200-218, :255-275, :325-362` | Both buttons are found by `aria-label` ("Toggle menu", "Close menu"); `aria-expanded` is "false"/"true"; `aria-controls` is present only while open; close sits inside the Tab trap; focus returns to the toggle | Unedited. :266-275, :325-335 and :351-362 are what prove `bind:ref={toggle}` hands the layout the real element.                                                                                                                                                                                                                                                                                                                                                                   |
| `mobile-nav-link-names-ssr.test.ts:103-123`                                | The avatar links' names                                                                                                                                                                                          | Unedited; not touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `quick-log-target.test.ts:55-206`                                          | The shortcut keys, the guards, and `?` closing the overlay                                                                                                                                                       | Unedited                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `theme-tokens.test.ts:512`                                                 | A prose reference to `MedicationFilterSelect.svelte:86`                                                                                                                                                          | Not an assertion. The `hover:bg-surface-overlay` it cites (Clear filter's popover rows) is kept.                                                                                                                                                                                                                                                                                                                                                                                  |

- [ ] **Step 1: The `/log` filter bar and pagination, starting with the failing test**

  In `tests/unit/log-pagination-ssr.test.ts`:
  - At :260, wrap the subject: `const form = withoutComments(filterForm(renderAt(`/log?${query}`, { filters: { ...NO_FILTERS, ...active } })));`. `withoutComments` is the shared helper T9 imported.
  - The matcher at :262-264 is unchanged, character for character.
  - Add after `filterForm` (:154-158):

<!-- prettier-ignore -->
```ts
const tokens = (tag: string | undefined) => (tag?.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
```

Then add:

<!-- prettier-ignore -->
```ts
describe("the filter bar's and the pagination's controls are the shared Button", () => {
  const html = renderAt(`/log?status=missed&page=2`, {
    page: 2,
    hasMore: true,
    filters: { ...NO_FILTERS, status: "missed" },
  });

  it.each([
    ["Apply", () => filterForm(html).match(/<button\b[^>]*type="submit"[^>]*>/)?.[0], "h-9"],
    ["Clear filters", () => anchorWith(filterForm(html), /href="\/log"/), "h-9"],
    ["Previous", () => anchorWith(html, /rel="prev"/), "h-11"],
    ["Next", () => anchorWith(html, /rel="next"/), "h-11"],
  ])("draws %s at a fixed height with the control boundary and the focus ring", (_name, tag, height) => {
    expect(tokens(tag())).toEqual(
      expect.arrayContaining([height, "border-border-strong", "focus-visible:outline-accent-ink"]),
    );
  });

  it("passes axe: button-name, link-name", async () => {
    const rules = ["button-name", "link-name"];
    const results = await runAxe(ssrDocument(html), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
```

Run `npx vitest run tests/unit/log-pagination-ssr.test.ts`. Expect FAIL on the four `it.each` cases: there is no `h-9` or `h-11`, and Apply and Clear are `px-3 py-2`. The :259-265 cases still pass on the old anchor, which has no markers to strip.

Implement in `log/+page.svelte`:

- :273-278 becomes `<Button type="submit" size="sm">Apply</Button>`.
- :283-289 becomes `<Button href="/log" size="sm" onclick={armRefocusAfterClear}>Clear filters</Button>`. `text-center` goes; Button centres. The comment at :280-282 stays.
- :337-343 becomes `<Button href={previousPageHref} rel="prev" aria-label="Go to previous page">Previous</Button>`.
- :347-353 becomes `<Button href={nextPageHref} rel="next" aria-label="Go to next page">Next</Button>`.

The sizes:

- Apply and Clear are `sm` (36px), matching the `px-3 py-2 text-sm` fields beside them.
- Pagination is `md` (44px). Today it is about 36px, set by padding.

Run `npx vitest run tests/unit/log-pagination-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts`. Expect PASS.

Mutation proofs:

- Restore Apply's old `<button class="… px-3 py-2 …">`. The Apply case must fail.
- Drop `onclick={armRefocusAfterClear}`. `log-page-mount.svelte.test.ts:271-281` must fail.
- After implementing, remove `withoutComments(` from :260. The six :259-265 cases must fail on the `<!---->` markers, which is why the edit is needed at all.

Commit: `refactor(log): shared Button for the filter bar and pagination`

- [ ] **Step 2: The mobile menu's toggle and close, starting with the failing test**

  Create `tests/unit/app-chrome-icon-buttons-ssr.test.ts` (`// @vitest-environment node`). It needs:
  - `vi.mock("$app/stores", () => ({ page: readable({ url: new URL("http://localhost/dashboard") }) }))`, as at `mobile-nav-link-names-ssr.test.ts:25-27`;
  - `user` copied from there (:42-50);
  - `MobileHeader` and `Sidebar` imported dynamically after the mock.

<!-- prettier-ignore -->
```ts
const FOCUS_RING = "focus-visible:outline-accent-ink";

function expectIconButton(button: Element | null, size: "size-9" | "size-11") {
  expect(button, "button not rendered").not.toBeNull();
  expect(button!.getAttribute("type")).toBe("button");
  expect([...button!.classList]).toEqual(expect.arrayContaining([size, FOCUS_RING]));
  expect(button!.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
}

describe("the mobile menu's IconButtons", () => {
  const header = ssrDocument(render(MobileHeader, {
    props: { user, menuOpen: false, menuId: "mobile-nav", ontoggle: () => {} },
  }).body);
  const mobileSidebar = ssrDocument(render(Sidebar, { props: { user, mobile: true, ondismiss: () => {} } }).body);

  it("draws the toggle as a 44px IconButton whose icon is hidden", () => {
    expectIconButton(header.querySelector('button[aria-label="Toggle menu"]'), "size-11");
  });

  it("draws the close button the same way, and only in the mobile sidebar", () => {
    expectIconButton(mobileSidebar.querySelector('button[aria-label="Close menu"]'), "size-11");
    const desktop = ssrDocument(render(Sidebar, { props: { user } }).body);
    expect(desktop.querySelector('button[aria-label="Close menu"]')).toBeNull();
  });

  it("passes axe: button-name", async () => {
    for (const doc of [header, mobileSidebar]) {
      const results = await runAxe(doc, ["button-name"]);
      expect(results.violations.flatMap((v) => v.nodes.map((n) => n.html))).toEqual([]);
      expect(evaluatedRules(results).has("button-name")).toBe(true);
    }
  });
});
```

Run `npx vitest run tests/unit/app-chrome-icon-buttons-ssr.test.ts`. Expect FAIL:

- Both buttons are `h-9 w-9`, so there is no `size-11`.
- The toggle's `<svg>` has no `aria-hidden` (`MobileHeader.svelte:38`).

Both 44px, because the two controls exist only at touch widths (`md:hidden`), where 44px is the floor the dose controls already use. The header is `h-14` and the brand row is about 76px, so both fit.

Implement:

- `MobileHeader.svelte:29-41` becomes `<IconButton label="Toggle menu" bind:ref={toggle} onclick={ontoggle} aria-expanded={menuOpen} aria-controls={menuOpen ? menuId : undefined}><svg aria-hidden="true" class="h-5 w-5" …>…</svg></IconButton>`. It is ghost md. The comment at :25-28 stays. The `toggle` prop's type stays, because the binding is checked value→prop only (as in T10 Step 3).
- `Sidebar.svelte:79-95` becomes `<IconButton label="Close menu" class="mr-3 shrink-0" onclick={ondismiss}>{svg as today, aria-hidden kept}</IconButton>`. `mr-3` and `shrink-0` set properties the base does not, so they hold whatever the class order.

Run `npx vitest run tests/unit/app-chrome-icon-buttons-ssr.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/mobile-nav-link-names-ssr.test.ts tests/unit/app-layout-dose-writes.test.ts tests/unit/toast-undo.svelte.test.ts`. Expect PASS.

Mutation proof: drop `bind:ref={toggle}`. `mobile-nav-focus.test.ts:266-275` ("closes the menu and returns focus to the toggle") must fail.

Commit: `refactor(nav): IconButton for the mobile menu's toggle and close`

- [ ] **Step 3: The shortcuts overlay's Close, starting with the failing test**

  In `tests/unit/quick-log-target.test.ts`, inside `describe("KeyboardShortcuts guards")` (:117), add:

<!-- prettier-ignore -->
```ts
it("opens with focus on a type=button Close whose icon is hidden, which closes it", async () => {
  mountWithChip();
  press("?");
  await tick();
  await tick();
  const overlay = () => document.querySelector('[aria-label="Keyboard shortcuts"]');
  const close = overlay()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!;
  expect(document.activeElement).toBe(close);
  expect(close.getAttribute("type")).toBe("button");
  expect(close.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect([...close.classList]).toEqual(expect.arrayContaining(["size-9", "focus-visible:outline-accent-ink"]));
  close.click();
  flushSync();
  expect(overlay()).toBeNull();
});
```

Run `npx vitest run tests/unit/quick-log-target.test.ts`. Expect FAIL: `getAttribute("type")` is `null` and the svg has no `aria-hidden` (`KeyboardShortcuts.svelte:152-165`).

Implement: :152-166 becomes `<IconButton label="Close" size="sm" onclick={() => (showHelp = false)}><svg aria-hidden="true" class="h-5 w-5" …>…</svg></IconButton>`. It is ghost, 36px in a desktop dialog header. The focus effect at :114-116 is unchanged.

Run `npx vitest run tests/unit/quick-log-target.test.ts`. Expect PASS.

Mutation proof: remove `aria-hidden="true"` from the svg. The new test must fail.

Commit: `fix(shortcuts): give the help overlay's Close a type and a hidden icon`

- [ ] **Step 4: MedicationFilterSelect, starting with the failing tests**

  **Decision: the trigger stays bespoke, aligned to the primitives. Clear filter becomes a ghost `Button`.** There are two reasons the trigger cannot be a `Button` or a `Toggle`:
  1. Its resting look carries state: an accent boundary while a filter is applied. No Button variant has that, and a call-site `class` cannot add it. Tailwind v4 orders same-property utilities by name, so `border-accent-ink…` is emitted before `border-border-strong` and loses. This was measured with the repo's `src/app.css` and Tailwind compile: `border-accent-ink/60` came at offset 5230 and `border-border-strong` at 5467. That same conflict has hidden this trigger's own cue since it was written. Today it carries both classes (:60-63), and the border-strong one wins.
  2. `Toggle` forces `aria-pressed` onto a disclosure that must say `aria-expanded`.

  Create `tests/unit/medication-filter-select.test.ts` (jsdom by default; `mount`, `flushSync`):

<!-- prettier-ignore -->
```ts
const MEDS = [
  { id: "m1", name: "Ibuprofen", colour: "#ef4444", isArchived: false },
  { id: "m2", name: "Metformin", colour: "#10b981", isArchived: false },
];
// mountSelect(selectedIds) mounts into a fresh host, registers unmount, and returns { target, trigger, onchange }.

it("keeps a bespoke trigger at the shared 36px height, with aria-expanded, its chevron and the focus ring", () => {
  const { trigger } = mountSelect([]);
  expect(trigger.getAttribute("type")).toBe("button");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(trigger.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  expect([...trigger.classList]).toEqual(expect.arrayContaining(["h-9", "focus-visible:outline-accent-ink"]));
  trigger.click();
  flushSync();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
});

it("draws an applied filter with the accent boundary instead of, not beside, the neutral one", () => {
  const filtered = [...mountSelect(["m1"]).trigger.classList];
  expect(filtered).toContain("border-accent-ink");
  expect(filtered).not.toContain("border-border-strong");
  const all = [...mountSelect([]).trigger.classList];
  expect(all).toContain("border-border-strong");
  expect(all).not.toContain("border-accent-ink");
});

it("offers Clear filter as a full-width ghost Button that clears the selection", () => {
  const { target, trigger, onchange } = mountSelect(["m1"]);
  trigger.click();
  flushSync();
  const clear = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Clear filter")!;
  expect(clear.getAttribute("type")).toBe("button");
  expect([...clear.classList]).toEqual(expect.arrayContaining(["h-9", "w-full", "text-text-secondary", "focus-visible:outline-accent-ink"]));
  expect([...clear.classList]).not.toContain("border");
  clear.click();
  flushSync();
  expect(onchange).toHaveBeenCalledWith([]);
});
```

Run `npx vitest run tests/unit/medication-filter-select.test.ts`. Expect FAIL:

- The trigger is `py-1.5` with no `h-9` and no focus ring.
- Filtered, it carries both `border-border-strong` and `border-accent-ink/60`.
- Clear filter is `py-1.5 text-xs`.

Implement in `MedicationFilterSelect.svelte`:

- The trigger's class (:60-63) becomes `bg-glass text-text-primary flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium backdrop-blur-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-ink {selected.length > 0 ? 'border-accent-ink' : 'border-border-strong'}`.
  - This uses full `border-accent-ink`, the Toggle-on boundary. It clears 3:1 as a control boundary, since `border-accent-ink` is asserted at 4.5:1 or better on every surface in `theme-tokens.test.ts:248-256`.
  - `bind:this={triggerEl}`, `aria-expanded` and the chevron are unchanged.
  - Add a comment giving reasons 1 and 2.
- :113-119 becomes `<Button variant="ghost" size="sm" block class="mt-1" onclick={clear}>Clear filter</Button>`. It is ghost per the spec ("Low emphasis: … Clear filter").

Run `npx vitest run tests/unit/medication-filter-select.test.ts`. Expect PASS.

Mutation proof: restore the old trigger class. The first two tests must fail.

Commit: `fix(analytics): a fixed-height filter trigger whose filtered border shows; ghost Clear filter`

- [ ] **Step 5: Gates**

  Run `npx vitest run tests/unit/log-pagination-ssr.test.ts tests/unit/log-page-mount.svelte.test.ts tests/unit/app-chrome-icon-buttons-ssr.test.ts tests/unit/mobile-nav-focus.test.ts tests/unit/quick-log-target.test.ts tests/unit/medication-filter-select.test.ts tests/unit/status-colour-owner.test.ts`. Expect PASS.

  Then run `npx vitest run`, `npm run check`, `npm run lint` and `npm run format:check`. Expect:
  - 0 failures;
  - check 0 errors and at most 27 warnings;
  - lint 0 errors and at most 115 warnings;
  - format clean.

  The `PENDING_MIGRATION` list is unchanged by this task.

### Task 12: Walkthrough follow-through

The landing-page walkthrough draws pages by hand. Wherever it draws a surface T4–T11 changed, it must draw the new version, so this task depends on Tasks 2, 4, 5, 6, 7, 8, 10 and 11: it copies the recipes they landed. Every status colour comes from the owner's pure `toneOf`/`toneClass`. Every drawn button or toggle comes from one hand copy of the primitives' resting classes, which a test holds to the primitives. Nothing on the stage imports `Button`, `IconButton`, `Toggle` or `Alert`, and no part gains a `transition-*` or `animate-*` class.

**Inventory: every stage file at HEAD that draws a changed surface.** The "Scan" column says where T1's scan lists the file: four walkthrough files are in `PENDING_MIGRATION` and T12 must clear them (the header's pending table). `FieldBox` and `StageUndoOffer` are in T1's permanent `EXEMPT` and are not edited.

| Stage file:line                                     | Draws                                                                           | Changed by              | Scan                                                                                             | Edit                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `scenes/AnalyticsScene.svelte:36-57, 108, 111, 116` | stat cards: `style:color` accent-ink, success and warning; trend `text-success` | T6                      | PENDING (`:111`, and the inline `var(--color-success)` / `var(--color-warning)` at `:44`, `:52`) | neutral, mirroring T6                                      |
| `scenes/AnalyticsScene.svelte:168`                  | per-medication trend                                                            | T6                      | PENDING                                                                                          | neutral                                                    |
| `scenes/AnalyticsScene.svelte:30-34, 190-199`       | breakdown legend dots and segments, `bg-warning` skipped                        | T4                      | PENDING                                                                                          | T4's `STATUS_BREAKDOWN_FILLS`                              |
| `scenes/AnalyticsScene.svelte:78-86`                | period pill, filled accent                                                      | T6                      | —                                                                                                | `stageToggle`                                              |
| `scenes/MedicationsScene.svelte:72-79`              | refill chip `bg-info/15 text-info` "8d left"                                    | T5                      | PENDING (the last `text-info` reader in `src/`)                                                  | T5's `refillChip`                                          |
| `scenes/MedicationsScene.svelte:107-109`            | "~Nd supply left", `text-warning` when `supplyDays <= 7`                        | T5                      | PENDING                                                                                          | the same words, neutral, as MedicationCard's stats row     |
| `scenes/MedicationsScene.svelte:20-23`              | "+ Add Medication"                                                              | T10                     | —                                                                                                | `stageButton("primary", "sm")`                             |
| `scenes/SecurityScene.svelte:43-46`                 | 2FA "Enabled" `bg-success/10 text-success`                                      | T8                      | PENDING                                                                                          | T8's neutral state chip                                    |
| `scenes/SecurityScene.svelte:32-35, 55-58, 84-87`   | Update Password; Disable 2FA and Revoke in red                                  | T8                      | PENDING (`:56`, `:85`)                                                                           | `stageButton`, T8's variants                               |
| `scenes/DataScene.svelte:12-13, 30-39, 53`          | Save Format, then three `border-glass-border` outline buttons                   | T7                      | —                                                                                                | `stageButton`                                              |
| `parts/DoseEntry.svelte:36`                         | time since in `text-accent-ink`                                                 | T4                      | —                                                                                                | T4's `text-text-secondary`                                 |
| `parts/DoseEntry.svelte:40-47`                      | side-effect chip, mild recipe, no severity word                                 | T4                      | —                                                                                                | T4's chip "Upset stomach · Mild", from the seeded severity |
| `scenes/HistoryScene.svelte:89, 92`                 | Apply, Clear filters                                                            | T11                     | —                                                                                                | `stageButton("secondary", "sm")`, as `log/+page.svelte`    |
| `scenes/AnalyticsScene.svelte:75-77`                | "All medications" trigger                                                       | T11                     | —                                                                                                | none: T11 keeps the trigger bespoke                        |
| `scenes/PhoneScene.svelte:133`                      | menu toggle box (`h-9 w-9 rounded-lg text-text-secondary`)                      | T11                     | —                                                                                                | `size-11`, as MobileHeader's md IconButton                 |
| `parts/dashboard/StageDueCard.svelte:44`            | `border-warning/50` overdue border                                              | T4                      | PENDING                                                                                          | `toneClass(toneOf("dose-overdue"), "border")`, as DueCard  |
| `parts/dashboard/StageRefills.svelte:36-38`         | label words from `refillDaysLabel`                                              | T5                      | — (reads the exports)                                                                            | words from `refillChip`, as RefillsCard                    |
| `parts/dashboard/StageUndoOffer.svelte:18`          | Toast's Undo offer                                                              | none (Toast unchanged)  | EXEMPT (T1)                                                                                      | none                                                       |
| `parts/FieldBox.svelte:31`                          | Input's required asterisk                                                       | none (field marks kept) | EXEMPT (T1)                                                                                      | none                                                       |

**Not edited, on purpose:**

- `StageDoneList` draws markers with the real `StatusMarker`, so T4's colours arrive by import. Its only status word is "Skipped", which stays neutral. `StageDone.dose.status` is `"taken" | "skipped"` (`demo-dashboard.ts:31`), so no missed row can be drawn.
- The demo History has no skipped or missed row (`demo-data.ts:352-387` are all taken).
- AnalyticsScene draws no InsightsCard.
- `StageDashboardHeader`, `StageLaterList`, `StageChips` and `AppShell` draw no status colour.
- Every `use:mark` stays on the element it is on today, so `REQUIRED_MARKS`, the timeline and the stage's mark registry are untouched.

**Files:**

- Create: `src/lib/components/walkthrough/parts/stage-controls.ts`
- Modify: `src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`, `MedicationsScene.svelte`, `SecurityScene.svelte`, `DataScene.svelte`, `HistoryScene.svelte` and `PhoneScene.svelte`. Lines are as in the inventory.
- Modify: `src/lib/components/walkthrough/parts/DoseEntry.svelte:9-14, 36, 40-47`
- Modify: `src/lib/components/walkthrough/demo-data.ts:340, 367, 377, 381, 385` (side effects)
- Modify: `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte:44`
- Modify: `src/lib/components/walkthrough/parts/dashboard/StageRefills.svelte:9-13, 36-38`
- Modify: `tests/unit/walkthrough-demo-facts.test.ts`, at `:98-111` (`breakdownOf`), `:166-201` (History), `:220-231` (Security), `:258-273` (breakdown) and `:334-347` (Refills), plus a new "the stage's drawn controls" block
- Modify: `tests/unit/due-card-ssr.test.ts`, adding a test after `:248-253`
- Modify: `tests/unit/timeline-entry-ssr.test.ts`, adding a describe after `:115`
- Modify: `tests/unit/status-colour-owner.test.ts` (`PENDING_MIGRATION` only; `EXEMPT` already holds `FieldBox` and `StageUndoOffer`)
- Modify: `CLAUDE.md`, the walkthrough bullet under "Reusable Components"

**Interfaces:**

- Consumes:
  - T1: `toneOf` and `toneClass`, with statuses `dose-overdue`, `side-effect-mild|moderate|severe` and `state`, and elements `text`, `chip` and the sixth element `border` (needs-you `border-warning/50`).
  - T2: `Button` (`variant`, `size`) and `Toggle` (`pressed`, `size`), in the tests only.
  - T4:
    - `STATUS_BREAKDOWN_FILLS` (`{ taken, skipped, missed }`) from `StatusBreakdownBar.svelte`'s `<script module>`;
    - TimelineEntry's time since, `text-text-secondary font-medium`;
    - TimelineEntry's side-effect chip, `rounded-md px-2 py-0.5 text-xs font-semibold {toneClass(toneOf(<side-effect status>), "chip")}` with text `{name} · {Mild|Moderate|Severe}` (U+00B7);
    - DueCard's `toneClass(toneOf("dose-overdue"), "border")`.
  - T5, from `RefillsCard.svelte`'s `<script module>`:
    - `refillChip({ severity, daysUntilRefill, inventoryCount, inventoryAlertThreshold }): { tone, glyph: "▲" | null, text } | null`;
    - MedicationCard's chip markup: `<span class="rounded-md px-2 py-1 text-xs font-semibold {toneClass(chip.tone, 'chip')}">{#if chip.glyph}<span aria-hidden="true">{chip.glyph}</span>{" "}{/if}{chip.text}</span>`;
    - MedicationCard's stats row, which keeps "~Nd supply left" and drops its `<= 7` amber;
    - RefillsCard's label words, `refillChip(...)?.text` with the same glyph span and `{" "}`.
  - T6: the page decisions listed in Task 6's Interfaces.
  - T8 (its decisions table):
    - Update Password is `Button` primary `md`; Disable 2FA is secondary `md`; Revoke is secondary `sm`;
    - "Enabled" is `toneClass(toneOf('state'), 'chip')` + `rounded-md px-2 py-0.5 text-xs font-semibold`.
  - T7: Data's Save Format is primary `md`; Download Export, Download Full Backup (JSON) and Import Data are secondary `md`.
  - T10: "+ Add Medication" is primary `sm`.
  - T11: Apply and Clear filters are secondary `sm`; MobileHeader's toggle is a ghost `md` IconButton (`size-11`); the analytics "All medications" trigger stays bespoke.
- Produces (`src/lib/components/walkthrough/parts/stage-controls.ts`, pure, no imports):

<!-- prettier-ignore -->
```ts
export type StageButtonVariant = "primary" | "secondary" | "ghost";
export type StageControlSize = "md" | "sm";
/** Button's classes for these props at rest: no variant-prefixed (hover:, focus-visible:, disabled:, aria-disabled:) or transition token. */
export function stageButton(variant: StageButtonVariant, size?: StageControlSize /* "md" */): string;
/** Toggle's classes for these props at rest, by the same rule. */
export function stageToggle(pressed: boolean, size?: StageControlSize /* "sm" */): string;
```

The values are Task 2's Button recipe at rest:

- base: `inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap`;
- `md`: `h-11 px-4`; `sm`: `h-9 px-3`;
- primary: `bg-accent text-accent-fg`; secondary: `border border-border-strong text-text-primary`; ghost: `text-text-secondary`.

`stageToggle` copies Toggle.svelte's resting tokens as T2 landed them: base `inline-flex items-center justify-center gap-2 px-3 text-sm font-medium whitespace-nowrap rounded-lg`; `sm` `h-9` (default), `md` `h-11`; on `border border-accent-ink bg-accent/15 text-accent-ink`; off `border border-border-strong text-text-secondary`.

- [ ] **Step 1: Write the failing stage-controls tests.** In `tests/unit/walkthrough-demo-facts.test.ts`, add the imports and these helpers:

<!-- prettier-ignore -->
```ts
const STATUS_TOKEN = /^(?:[\w-]+:)*(?:text|bg|border|ring|fill|stroke|from|to|outline|divide|decoration)-(?:warning|success|danger|danger-ink|danger-fg|info)(?:\/\d+)?$/;
const LABEL = createRawSnippet(() => ({ render: () => "<span>Label</span>" }));
/** Class tokens at rest: no variant-prefixed or transition token, sorted. */
const resting = (el: Element) => [...el.classList].filter((t) => !t.includes(":") && !t.startsWith("transition")).sort();
const split = (classes: string) => classes.split(/\s+/).filter(Boolean).sort();
const first = (body: string) => ssrDocument(body).querySelector("main > *")!;
const statusTokens = (root: Element) => [root, ...root.querySelectorAll("*")].flatMap((el) => [...el.classList].filter((t) => STATUS_TOKEN.test(t)));
/** The one drawn element whose own text is `label`: the innermost span or div that reads it (HistoryScene draws divs). */
function drawnControl(body: string, label: string): Element {
  const found = [...ssrDocument(body).querySelectorAll("span, div")].filter(
    (el) => textOf(el) === label && ![...el.children].some((c) => textOf(c) === label),
  );
  expect(found, label).toHaveLength(1);
  return found[0];
}
```

Then add the describe block:

<!-- prettier-ignore -->
```ts
describe("the stage's drawn controls", () => {
  it.each([["primary", "md"], ["primary", "sm"], ["secondary", "md"], ["secondary", "sm"], ["ghost", "md"], ["ghost", "sm"]] as const)(
    "stageButton(%s, %s) is Button's look at rest",
    (variant, size) => {
      expect(split(stageButton(variant, size))).toEqual(resting(first(render(Button, { props: { variant, size, children: LABEL } }).body)));
    },
  );
  it.each([[true, "sm"], [false, "sm"], [true, "md"], [false, "md"]] as const)(
    "stageToggle(%s, %s) is Toggle's look at rest",
    (pressed, size) => {
      expect(split(stageToggle(pressed, size))).toEqual(resting(first(render(Toggle, { props: { pressed, size, children: LABEL } }).body)));
    },
  );

  // Each row: the variant and size the real page passes. If a page task
  // landed a different one, the row and the scene both follow the page.
  const security = () => render(SecurityScene).body;
  const data = () => render(DataScene, { props: { hover: false } }).body;
  const history = () => render(HistoryScene, { props: { checked: true, filtered: 1, timeFormat: "24h" } }).body;
  const DRAWN = [
    { scene: "Security", body: security, label: "Update Password", look: stageButton("primary") },
    { scene: "Security", body: security, label: "Disable 2FA", look: stageButton("secondary") },
    { scene: "Security", body: security, label: "Revoke", look: stageButton("secondary", "sm") },
    { scene: "Data", body: data, label: "Save Format", look: stageButton("primary") },
    { scene: "Data", body: data, label: "Download Export", look: stageButton("secondary") },
    { scene: "Data", body: data, label: "Download Full Backup (JSON)", look: stageButton("secondary") },
    { scene: "Data", body: data, label: "Import Data", look: stageButton("secondary") },
    { scene: "Medications", body: () => render(MedicationsScene, { props: { load: 10, tick: 0 } }).body, label: "+ Add Medication", look: stageButton("primary", "sm") },
    { scene: "Analytics", body: () => render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body, label: "90d", look: stageToggle(true) },
    { scene: "Analytics", body: () => render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body, label: "7d", look: stageToggle(false) },
    { scene: "History", body: history, label: "Apply", look: stageButton("secondary", "sm") },
    { scene: "History", body: history, label: "Clear filters", look: stageButton("secondary", "sm") },
  ];
  it.each(DRAWN)("$scene draws $label as its page's control", ({ body, label, look }) => {
    const el = drawnControl(body(), label);
    expect(resting(el)).toEqual(expect.arrayContaining(split(look)));
    expect(statusTokens(el)).toEqual([]);
  });
});
```

`textOf` is already imported (`:62`). The new imports are:

- `createRawSnippet` from `svelte`;
- `Button` and `Toggle` from `$lib/components/ui/`;
- `stageButton` and `stageToggle`;
- `DataScene`, `MedicationsScene` and `HistoryScene`.
- [ ] **Step 2: Run the tests and watch them fail.** Run `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`. Expect FAIL: "Failed to resolve import "$lib/components/walkthrough/parts/stage-controls"".
- [ ] **Step 3: Create `stage-controls.ts`.** Create it with the signatures and values from Interfaces. Its header comment says why it exists:
  - the stage may not import the focusable primitives, so their resting classes are copied here once;
  - no interactive or transition token is copied, because nothing on the stage is interactive or moves by CSS;
  - `walkthrough-demo-facts.test.ts` renders each primitive and fails if a copy drifts.

  Rerun. Expect the primitive rows to PASS and the `DRAWN` rows to FAIL. For example, "Disable 2FA" lacks `h-11`, `border-border-strong` and `text-text-primary`, and carries `border-danger-ink/30` and `text-danger-ink`.

- [ ] **Step 4: Draw the controls with the primitives' look.** Every `use:mark` stays where it is. Copy no hover or transition class.
  - **SecurityScene** (Task 8's decisions table):
    - `:32-35` becomes `class="{stageButton('primary')} self-start"`.
    - `:55-58` becomes `class={stageButton("secondary")}`.
    - `:84-87` becomes `class={stageButton("secondary", "sm")}`.
  - **DataScene:**
    - Delete the `outline` constant (`:12-13`).
    - `:30-33` becomes `"{stageButton('primary')} self-start"`.
    - `:36` becomes `"{stageButton('secondary')} {hover ? 'bg-surface-overlay' : ''}"`. That is Button secondary's hover, drawn as the cursor lands.
    - `:39` and `:53` become `stageButton("secondary")`.
  - **MedicationsScene `:20-23`:** `stageButton("primary", "sm")`, as Task 10's "+ Add Medication".
  - **AnalyticsScene `:79-85`:** each span becomes `class={stageToggle(period === "90d")}`. The pill `div` at `:78` is unchanged.
  - **Task 11's controls:**
    - HistoryScene `:89` "Apply" becomes `<div class={stageButton("secondary", "sm")}>Apply</div>`, and `:92` "Clear filters" becomes `<div class={stageButton("secondary", "sm")} style:opacity={filtered}>Clear filters</div>`, keeping its fade. Both were `{control} text-text-secondary!`; `log/+page.svelte` now renders both as `Button size="sm"` (secondary).
    - AnalyticsScene `:75-77` "All medications" is unchanged: Task 11 keeps MedicationFilterSelect's trigger bespoke.
    - PhoneScene `:133`: `h-9 w-9` becomes `size-11`, because MobileHeader's toggle is now a ghost `md` IconButton.

  Rerun `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`. Expect PASS.

- [ ] **Step 5: Prove by mutation and commit.** Each mutation fails its test:
  - In `stage-controls.ts`, make secondary `border-glass-border`: "stageButton(secondary, md) is Button's look at rest" fails.
  - Put back SecurityScene's red "Disable 2FA": its `DRAWN` row fails.
  - Put HistoryScene's Apply back on `{control}`: its `DRAWN` row fails (no `h-9`).

  Restore each. Commit: `feat(walkthrough): draw stage controls with the primitives' resting look`.

- [ ] **Step 6: Write the failing status-colour fidelity tests.**
  - **walkthrough-demo-facts: the breakdown legend.** `breakdownOf` (`:98-111`) returns each legend entry as `{ dot: [...(el.querySelector("span")?.classList ?? [])].find((c) => c.startsWith("bg-")), text: textOf(el) }`. Today it returns text only, which could not see the skipped dot: `STATUS_BREAKDOWN.skippedEvents` is 0, so no skipped segment is ever drawn. "draws the bar and legend the real StatusBreakdownBar draws" (`:258-273`) keeps its `toEqual` against the real card, now at that strength.
  - **walkthrough-demo-facts: the Analytics stat cards.** Add this test:

<!-- prettier-ignore -->
```ts
it("draws the stat cards with no status or accent colour, as the page does", () => {
  const doc = ssrDocument(render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body);
  const grid = doc.querySelector(".grid.grid-cols-3")!;
  expect(statusTokens(grid)).toEqual([]);
  expect(grid.innerHTML).not.toMatch(/color:\s*var\(--color-(?:success|warning|danger|danger-ink|info|accent-ink)\)/);
  for (const t of ["↑3%", "↑2%"]) expect([...drawnControl(grid.outerHTML, t).classList], t).toContain("text-text-secondary");
  expect([...grid.querySelectorAll("svg")].map((s) => [...s.parentElement!.classList].includes("text-text-secondary"))).toEqual([true, true]);
  const perMedication = [...doc.querySelectorAll("p")].find((p) => textOf(p) === "Per-Medication Adherence (90 days)")!.parentElement!;
  expect(statusTokens(perMedication)).toEqual([]);
});
```

- **walkthrough-demo-facts: Medications** (in "the Refills card and the refill badge", `:334`). Add "draws each card's chip and stats row as MedicationCard does":
  - Render `MedicationsScene` (`{ load: 10, tick: 0 }`).
  - For each medication, compute `chip = refillChip({ severity: classifyRefillSeverity(m.supplyDays), daysUntilRefill: m.supplyDays, inventoryCount: null, inventoryAlertThreshold: null })`. With no threshold and a forecast, `refillChip` never reads the count, so the demo needs no stock figure.
  - When `chip` is non-null, `drawnControl(body, chip.text)` has resting tokens containing `split(\`rounded-md px-2 py-1 text-xs font-semibold ${toneClass(chip.tone, "chip")}\`)`.
  - When `chip` is null, no span's text ends in "days left".
  - Every card's stats row contains a span whose text is `` `~${m.supplyDays}d supply left` ``, as MedicationCard keeps it.
  - `statusTokens(doc.body)` is `[]`: Ibuprofen's 8 days is `watch`, which is neutral, and the supply line is neutral at every count.
- **walkthrough-demo-facts: Security** (`:220`). Add "draws the 2FA state as T8's neutral chip": `drawnControl(render(SecurityScene).body, "Enabled")` has resting tokens containing `split(\`${toneClass(toneOf("state"), "chip")} rounded-md px-2 py-0.5 text-xs font-semibold\`)`, and its `statusTokens`is`[]`.
- **walkthrough-demo-facts: History** (`:166`). Add "gives the side effect the severity scripts/seed-demo.ts seeds":
  - Read `scripts/seed-demo.ts` the way `:145-158` does.
  - Match it with `/\{ name: "([^"]+)", severity: "(\w+)" as const \}/`.
  - Assert every `sideEffect` in `LOG_ALL` and `LOG_WITH_SIDE_EFFECTS` equals `{ name, severity }`.
- **walkthrough-demo-facts: StageRefills against RefillsCard** (beside the Refills tests). Add "draws each row as RefillsCard draws it, for every tier":
  - Use four synthetic `RefillForecastEntry` rows: critical (2 days), warning (6), watch (8) and ok (30), each with `inventoryCount` and `dailyRate` filled.
  - Render `RefillsCard({ entries })` and `StageRefills({ entries })`.
  - Pair the rows: `section a` with `.space-y-2 > div`.
  - For each pair, assert `textOf` is equal.
  - For each pair, assert that `[row, ...row.querySelectorAll("*")].map(resting)` is equal position by position.

  The stage's documented difference (`StageRefills.svelte:2-7`) is exactly the hover and transition classes, which `resting` drops. After T5, the critical and warning rows read "▲ Reorder soon · N days left" on the card, so this test fails until StageRefills takes its words from `refillChip` too. That is why T5's "follows without an edit" holds only for the demo's one watch row.

- **due-card-ssr.test.ts** (after `:253`). Add "is bordered on the landing page's walkthrough exactly as here":
  - For `TODAY_CARD`, `OVERDUE_CARD` and `EARLIER_CARD`, render `StageDueCard` (`{ card, now: NOW, todayStart: TODAY_START, tz: TZ, timeFormat: "24h", pending: null }`).
  - Take `ssrDocument(body).querySelector("main > div")`.
  - Assert its sorted class tokens equal `cardItem(renderCard(card))`'s. Both are `bg-glass rounded-xl border p-3 backdrop-blur-xl` plus the edge: `border-accent-ink/50` when due now, and `toneClass(toneOf("dose-overdue"), "border")` (`border-warning/50`) otherwise.

  `useMark` is a no-op without its context (`marks.ts:35-37`), so no registry is needed.

- **timeline-entry-ssr.test.ts** (a new describe after `:115`). Add "the landing page's walkthrough draws this row's time-since and side-effect chip as it does":
  - For each severity in `["mild", "moderate", "severe"]`, render TimelineEntry with `makeDose("taken")` and `sideEffects: [{ name: "Upset stomach", severity }]`.
  - Render `DoseEntry` with `{ medication: MEDICATION_BY_ID.ibu, time: "14:12", since: "17h 50m ago", sideEffect: { name: "Upset stomach", severity } }`.
  - Compare `paint(el)` between the two, where `paint` = class tokens matching `/^(?:text|bg|border|ring)-/`, minus the size utilities `/^text-(?:xs|sm|base|lg|\d?xl)$/`, plus a bare `border`:
    - the time-since, which is `time[datetime]`'s parent in the row and the span whose text is `"17h 50m ago"` in the stage;
    - the chip, which is `.pl-7 > span` in both.
  - Also compare the chip's text with `.sr-only` nodes removed. Both read "Upset stomach · Mild" (or `· Moderate` / `· Severe`).

New imports:

- **`walkthrough-demo-facts`:**
  - `toneClass` and `toneOf` (`$lib/utils/status-tone`);
  - the default export and `refillChip` (`$components/RefillsCard.svelte`);
  - `StageRefills`;
  - `LOG_WITH_SIDE_EFFECTS`, beside `LOG_ALL`.
- **`due-card-ssr`:** `StageDueCard`, `toneClass` and `toneOf`.
- **`timeline-entry-ssr`:** `DoseEntry` and `MEDICATION_BY_ID`, imported after its `vi.mock` calls like the file's other imports.

These tests read the parsed DOM (`ssrDocument`, `textOf`, `classList`). The one raw-HTML check, the stat cards' `innerHTML` regex, is a negative match on an inline style, which a comment cannot satisfy. So Svelte 5.57's `<!---->` markers around rendered snippets cannot affect them, and none of them needs `withoutComments`. The same holds for Task 6's two SSR tests.

- [ ] **Step 7: Run the tests and watch them fail.** Run `npx vitest run tests/unit/walkthrough-demo-facts.test.ts tests/unit/due-card-ssr.test.ts tests/unit/timeline-entry-ssr.test.ts`. Expect these failures:
  - the breakdown legend: `dot: 'bg-warning'` against `STATUS_BREAKDOWN_FILLS.skipped` (`bg-border-strong`);
  - the stat cards: `text-success`, plus `color: var(--color-success)` in `innerHTML`;
  - Medications: the chip test finds no span "8 days left" (the scene prints "8d left" in `bg-info/15 text-info`), and `statusTokens` finds `bg-info/15` and `text-info`;
  - Security: `bg-success/10` and `text-success`, and no `rounded-md` / `font-semibold`;
  - the seed fact: `"Upset stomach"` is a string, not `{ name, severity }`;
  - DoseEntry: `text-accent-ink` against T4's `text-text-secondary`, and "Upset stomach" against "Upset stomach · Mild";
  - StageRefills: the critical and warning rows' text, "2 days left" against "▲ Reorder soon · 2 days left". The watch and ok rows already match.

  StageDueCard PASSES on arrival. T4 and the stage both draw `border-warning/50`, T4 through the owner and the stage by hand. It is a guard, proven by mutation in Step 10. The scan still lists the stage's literal until Step 8.

- [ ] **Step 8: Draw the status colours from the owner.** The scenes import `toneOf` and `toneClass` from `$lib/utils/status-tone`.
  - **AnalyticsScene:**
    - Drop `color` from `stats` (`:36-57`).
    - `:108` becomes `class="text-text-primary text-3xl font-bold tabular-nums"`, with no `style:color`.
    - `:111` and `:168` become `class="text-xs {NEUTRAL}"`, where `const NEUTRAL = toneClass("neutral", "text")`.
    - `:114-122`: the wrapper becomes `class="{NEUTRAL} mt-2"`, with no `style:color`. Keep `style:clip-path`.
    - `:30-34` and `:192`/`:195`/`:198`: import `STATUS_BREAKDOWN_FILLS` beside `statusBreakdownSegments` from `$components/StatusBreakdownBar.svelte` (`:7`). The legend's `dot` values become `STATUS_BREAKDOWN_FILLS.taken`, `.skipped` and `.missed`, and the three segments use the same fills. The scene no longer spells a fill itself, so the two cannot drift.
  - **demo-data.ts:**
    - `import type { SideEffect } from "$lib/types"`.
    - `LoggedDose.sideEffect?: SideEffect` (`:340`).
    - `DemoMedication` and every `supplyDays` are unchanged: the stats row keeps "~Nd supply left", and the chip passes no stock figure.
    - The four literals at `:367`, `:377`, `:381` and `:385` become `{ name: "Upset stomach", severity: "mild" }`, with a comment: as scripts/seed-demo.ts:281 seeds it.
  - **DoseEntry:**
    - The prop type becomes `sideEffect?: SideEffect`.
    - `:36`: `text-accent-ink` becomes `text-text-secondary` (T4's TimelineEntry `:186`). Keep `font-medium tabular-nums`.
    - `:40-47`: the chip becomes `<span class="rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap {toneClass(toneOf(SEVERITY[sideEffect.severity].status), 'chip')}">{sideEffect.name} · {SEVERITY[sideEffect.severity].word}</span>`. `SEVERITY` is a local copy of T4's TimelineEntry table (`mild` → "Mild"/`side-effect-mild`, and so on): TimelineEntry declares it in its instance script, so it cannot be imported. The timeline-entry-ssr test holds the copy to the row.
  - **HistoryScene `:40`:** unchanged; the prop now carries the object.
  - **MedicationsScene:**
    - Import `refillChip` from `$components/RefillsCard.svelte`, a leaf with no handlers that the stage already imports through `StageRefills`. Import `STAGE_REFILLS` from `../stage-dashboard`.
    - In the `{#each}`, add `{@const refill = STAGE_REFILLS.find((r) => r.medicationId === medication.id)}`. `STAGE_REFILLS` is the tier literal the demo-facts test already holds to `classifyRefillSeverity`; the scene cannot call that server function.
    - Then add `{@const chip = refillChip({ severity: refill?.severity ?? "ok", daysUntilRefill: medication.supplyDays, inventoryCount: null, inventoryAlertThreshold: null })}`. The demo draws no alert threshold (every seeded threshold in `seed-demo.ts`, 14, 7, 14, 6 and 21, is below its medication's count), and with a forecast and no threshold `refillChip` never reads the count.
    - `:72-79` becomes `{#if chip}` around T5's MedicationCard chip, minus `data-stock-chip`: `<span class="rounded-md px-2 py-1 text-xs font-semibold whitespace-nowrap {toneClass(chip.tone, 'chip')}">{#if chip.glyph}<span aria-hidden="true">{chip.glyph}</span>{" "}{/if}{chip.text}</span>`. Ibuprofen draws "8 days left" in the neutral chip.
    - `:107-109` keeps `~{medication.supplyDays}d supply left` and loses only the `{medication.supplyDays <= 7 ? 'text-warning' : ''}` condition, leaving `class="whitespace-nowrap"`: T5's stats row, neutral.
  - **SecurityScene `:43-46`:** `class="{toneClass(toneOf('state'), 'chip')} rounded-md px-2 py-0.5 text-xs font-semibold whitespace-nowrap"`. This is T8's page chip (its decisions table) plus the stage's `whitespace-nowrap`.
  - **StageDueCard `:44`:** `const border = $derived(top.state === "due-now" ? "border-accent-ink/50" : toneClass(toneOf("dose-overdue"), "border"));`. This is the expression T4 gives DueCard `:45`; the due-now edge is accent, not status.
  - **StageRefills:**
    - Import `refillChip` beside the existing three (`:9-13`).
    - In the `{#each}`, add `{@const label = refillChip({ severity: entry.severity, daysUntilRefill: entry.daysUntilRefill, inventoryCount: null, inventoryAlertThreshold: null })}`.
    - The label span's content (`:36-38`) becomes `{#if label?.glyph}<span aria-hidden="true">{label.glyph}</span>{" "}{/if}{label?.text ?? refillDaysLabel(entry.daysUntilRefill)}`, exactly RefillsCard's after T5, `{" "}` included.
    - `inventoryCount` is `null` because the stage's `Entry` carries none. Every forecast row has a `daysUntilRefill` (`classifyRefillSeverity(null)` is `ok`, which the forecast never lists), and with no threshold `refillChip` reads the count only when the days are null.
- [ ] **Step 9: Move the walkthrough out of the PENDING list.** In `tests/unit/status-colour-owner.test.ts`, delete the four walkthrough lines from `PENDING_MIGRATION`:
  - `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`
  - `src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`
  - `src/lib/components/walkthrough/scenes/MedicationsScene.svelte`
  - `src/lib/components/walkthrough/scenes/SecurityScene.svelte`

  `EXEMPT` is not edited. It already holds `walkthrough/parts/FieldBox.svelte` and `walkthrough/parts/dashboard/StageUndoOffer.svelte` (T1 Step 7), and both still write their status class, so the two-way check stays green.

- [ ] **Step 10: Run and prove by mutation.** Run `npx vitest run tests/unit/walkthrough-demo-facts.test.ts tests/unit/due-card-ssr.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/status-colour-owner.test.ts`. Expect PASS. Each mutation fails its test:
  - AnalyticsScene's skipped dot back to `bg-warning`: the breakdown test fails.
  - `style:color="var(--color-success)"` back on the adherence number: the stat-card test fails.
  - MedicationsScene's chip back to `bg-info/15 text-info`: the Medications test fails, and so does the owner scan.
  - `text-warning` back on MedicationsScene's supply span: the Medications test fails on `statusTokens`.
  - A literal space in place of StageRefills' `{" "}`: the StageRefills test fails at the critical row ("▲Reorder soon").
  - StageRefills' label `<span>` without `shrink-0`, or its words back to `refillDaysLabel` alone: the StageRefills test fails, at the critical row for the words.
  - StageDueCard's overdue branch as `toneClass(toneOf("dose-overdue"), "alert")`: the due-card-ssr test fails (`bg-warning/10` is not on DueCard).
  - DoseEntry's chip as `toneClass("needs-you", "chip")`: the timeline-entry-ssr test fails at "mild".

  Restore each.

- [ ] **Step 11: Confirm the walkthrough tests that pin structure pass unedited.** Each still holds for the reason given:
  - `walkthrough-dashboard-fidelity.test.ts`:
    - the rendered-text oracle (`:577-669`) is unchanged, because no Due, Done, Later or chips text moved, and `:623` still mirrors StageDoneList's "Skipped";
    - "draws no control, heading, list or landmark, and no animate-_ or transition-_ class" (`:727`, `:885`) holds because `resting` strips transitions;
    - the Auckland byte-identity tests hold because nothing reads a clock.
  - `walkthrough-stage.svelte.test.ts` holds: the mark set is unchanged, nothing is focusable, and no heading, landmark or list is added.
  - `walkthrough-timeline.test.ts` and `walkthrough-marks.svelte.test.ts` hold: no mark key moved.
  - `walkthrough-video.svelte.test.ts` and `walkthrough-video-ssr.test.ts` hold: no new `role="img"`, and the accent and date format are untouched.
- [ ] **Step 12: Update CLAUDE.md's walkthrough bullet.** Under "Reusable Components":
  - After "…and the rules `RefillsCard` exports from `<script module>` (`AnalyticsScene` likewise reuses `StatusBreakdownBar`'s).", add: "Status colour on the stage comes only from `utils/status-tone.ts`'s `toneOf`/`toneClass`, and a drawn button or toggle takes the primitives' resting classes from `parts/stage-controls.ts`: the stage never imports `Button`, `IconButton`, `Toggle` or `Alert`."
  - After the sentence on `walkthrough-demo-facts.test.ts`, add: "It also holds `stage-controls.ts` to the primitives' rendered classes, every drawn control to the variant its page uses, and StageRefills' rows to RefillsCard's for all four tiers; `due-card-ssr.test.ts` and `timeline-entry-ssr.test.ts` hold StageDueCard's border and DoseEntry's time-since and side-effect chip to the real components."
- [ ] **Step 13: Run the gates.**
  - Run `npx vitest run tests/unit/walkthrough-*.test.ts tests/unit/walkthrough-*.svelte.test.ts tests/unit/due-card-ssr.test.ts tests/unit/timeline-entry-ssr.test.ts tests/unit/status-colour-owner.test.ts`.
  - Run `npx vitest run`.
  - Run `npm run check`: expect 0 errors and at most 27 warnings. The `LoggedDose.sideEffect` type change has exactly one consumer, `DoseEntry`.
  - Run `npm run lint`: expect 0 errors and at most 115 warnings.
  - Run `npm run format:check`: expect it clean.

  Commit: `feat(walkthrough): draw status colours from the status-tone owner`.

### Task 13: Retire `--color-info`, empty the pending list, CLAUDE.md, CHANGELOG, final gates and the preview pass

Runs after T1–T12 have merged into the branch. It changes no behaviour. It removes what the migration made dead, writes the rule down, and checks the whole branch against the spec's anti-goals.

**Files:**

- Modify: `src/app.css` (`:45-52`, the `--color-info` comment and declaration in `@theme`; `:175`, the light arm's declaration)
- Modify: `src/lib/appearance/theme-css.ts` (`:64` in `DARK_TOKENS`, `:91` in `LIGHT_TOKENS`)
- Modify: `tests/unit/theme-tokens.test.ts` (TEXT_TOKENS `:160-165`; CHIPS rows `:342-343`; the hand-written CHIPS describe, pruned by rule in Step 5; one assertion in the parsing describe at `:143-149`). These line numbers are HEAD's. T1's import and two helpers shift everything below `:16` by about 20 lines, so find each anchor by its content.
- Modify: `tests/unit/status-colour-owner.test.ts` (delete `PENDING_MIGRATION` and every assertion that reads it)
- Modify: `CLAUDE.md` (Styling: `:116` gains a sibling, `:117` is replaced, `:120` is updated)
- Modify: `CHANGELOG.md` (`[Unreleased]`: new items at the top of Security `:10`, Changed `:31` and Fixed `:43`; amend `:51`)
- Not a file: the preview-pass checklist goes into the PR body (Steps 11 and 12).

**Interfaces:**

- Consumes: T1's owner, contrast describe and scan test; every task's deletions from `PENDING_MIGRATION`; T2's `Button.svelte` `EXEMPT` entry; T7's `checkDestructiveGuard` and `DestructiveConfirm`.
- Produces: no code API. Removes the `--color-info` token and the `info` Tailwind colour.

- [ ] **Step 1: Precondition: nothing is pending**

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`, then read `PENDING_MIGRATION`.
Expected: PASS, and the list is `[]`. If a file is still listed, stop. The task that owns it (the header's "The pending list, and who empties it") is unfinished. Do not move the file to `EXEMPT` to get past this step.

- [ ] **Step 2: Precondition: nothing reads `info`**

<!-- prettier-ignore -->
```bash
git grep -n -E "color-info|\b(text|bg|border|ring|fill|stroke|from|to|outline|divide|decoration)-info\b" -- src tests
```

Expected: exactly these lines: `src/app.css:50` (a comment mentioning `bg-info/15`), `src/app.css:52`, `src/app.css:175`, `src/lib/appearance/theme-css.ts:64`, `src/lib/appearance/theme-css.ts:91`, and in `tests/unit/theme-tokens.test.ts` the TEXT_TOKENS entry and the two "medications refill chip (watch)" CHIPS rows (`:165` and `:342-343` at HEAD, shifted by T1). The scan already forbids `*-info` classes in `src/**/*.{svelte,ts}`, so any extra hit is a `var(--color-info)` or a non-scanned file. If one appears, stop: the spec retires the token only "if nothing reads it". Report the reader instead of deleting it.

- [ ] **Step 3: Pin the retirement, and watch it fail**

In the parsing describe (`theme-tokens.test.ts:143-149`), add:

<!-- prettier-ignore -->
```ts
  it("has no --color-info: neutral replaced it as a status colour", () => {
    // Its hue sat next to the accent's, so the refill "watch" tier and a
    // selected control looked the same. The owner scan rejects *-info classes.
    expect(T["--color-info"]).toBeUndefined();
  });
```

Run: `npx vitest run tests/unit/theme-tokens.test.ts -t "has no --color-info"`
Expected: FAIL twice: dark `expected '#a5a8f8' to be undefined`, light `expected '#3a44c4' to be undefined`.

- [ ] **Step 4: Remove the token**

- `src/app.css:45-52`: delete the comment block that begins "Neutral/informational." and the `--color-info: #a5a8f8;` line. `:175`: delete `--color-info: #3a44c4;`.
- `src/lib/appearance/theme-css.ts`: delete `"--color-info": "#a5a8f8",` (`:64`) and `"--color-info": "#3a44c4",` (`:91`).
- `tests/unit/theme-tokens.test.ts`: delete the TEXT_TOKENS entry and its comment (`:164-165`). Delete the two `--color-info` CHIPS rows (`:342-343`). Rewrite the stale comment at `:160-161` as `// success and warning are the happened and needs-you text (TONE_CLASSES).`
- `CLAUDE.md:117`: the "`--color-info` is deliberately a separate token…" bullet now describes a token that does not exist. Replace it with:

<!-- prettier-ignore -->
```md
- **There is no `--color-info`, on purpose.** It was the neutral "watch" colour, and its hue sat next to the accent's, so the refill watch tier and a selected control looked the same. The status-colour work retired it: neutral statuses are `text-text-secondary` with a `border-strong` outline, from `TONE_CLASSES`. Do not bring back a fifth status hue. The owner scan rejects any `*-info` class in `src/`, and `theme-tokens.test.ts` asserts the token is gone from both arms.
```

Run: `npx vitest run tests/unit/theme-tokens.test.ts tests/unit/theme-css.test.ts`
Expected: PASS. `theme-css.test.ts`'s "carries exactly the tokens the app.css light arm overrides" still passes, because both tables and the light arm lost the same key.

- [ ] **Step 5: Prune hand-written chip rows the owner now produces**

<!-- prettier-ignore -->
```bash
git grep -n -E "bg-(warning/15|danger/15|danger/20|warning/20|success/20|text-secondary/30)" -- src ':!src/lib/utils/status-tone.ts'
```

Expected: no output. T4 moved StatusMarker, TimelineEntry and SideEffectPicker onto the owner, and T5 moved MedicationCard. Every remaining row in the hand-written describe "$name — tinted chips are legible over the backdrop they actually paint on" now either names markup that no longer exists or repeats a pair the derived describe measures. Delete that describe. Move its two-sentence opening rationale ("The opaque surfaces above are not what these render on…") onto the derived describe's comment.

If the grep does print a line, keep exactly the rows naming that class and that site, and delete the rest.

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

<!-- prettier-ignore -->
```bash
npx prettier --write src/app.css src/lib/appearance/theme-css.ts tests/unit/theme-tokens.test.ts CLAUDE.md
git add src/app.css src/lib/appearance/theme-css.ts tests/unit/theme-tokens.test.ts CLAUDE.md
git commit -m "refactor(theme): retire --color-info now that no status uses it"
```

- [ ] **Step 7: Delete the pending list**

In `tests/unit/status-colour-owner.test.ts`:

- Delete `PENDING_MIGRATION`, its comment, and `const PENDING`.
- Delete these tests: "every pending file still writes one…", "no file is both exempt and pending", and "the pending list is sorted and unique…".
- Rename the first test to "every file that writes a status class is exempt". Its filter becomes `([file]) => !EXEMPT_FILES.has(file)`.
- In the file comment, change "Both lists below are two-way" to "The exemption list is two-way".

Run: `npx vitest run tests/unit/status-colour-owner.test.ts`
Expected: PASS, 6 tests.

Mutation proof: add `class="bg-success/10"` to `src/lib/components/ui/GlassCard.svelte` → "every file that writes a status class is exempt" names it. Restore.

<!-- prettier-ignore -->
```bash
npx prettier --write tests/unit/status-colour-owner.test.ts
git add tests/unit/status-colour-owner.test.ts
git commit -m "test(status): every page reads the owner, so drop the migration list"
```

- [ ] **Step 8: CLAUDE.md**

The `:117` replacement already landed in Step 4. Both edits below are in "## Styling" (`:112`).

1. Insert after `:116` (the "A colour splits three ways by ROLE" bullet). Before pasting, read `EXEMPT` in the scan test and make the parenthesis name exactly what it holds:

<!-- prettier-ignore -->
```md
- **`src/lib/utils/status-tone.ts` is the single owner of status colour, and `tests/unit/status-colour-owner.test.ts` holds the line.** Amber means _this needs you_. Red means _something went wrong, or this can't be undone_. Green only confirms _something happened_ and never judges a number. Everything else is neutral: counts, percentages, trends, current states and reversible "turn it off" actions. The accent keeps "due now" and "selected" and is not a status colour. `STATUS_TONE` encodes the spec's table (`docs/superpowers/specs/2026-10-16-status-colours-button-alert-design.md`). `TONE_CLASSES` turns a tone into literal classes per element (`text`, `chip`, `marker`, `bar`, `alert`, `border`). A component asks `toneClass(toneOf(status), element)` and never writes `text-warning` itself. With no owner, each component chose its own amber. Skipped was grey on the dashboard and amber on Log and Analytics, missed was grey on one and red on the others, and a 35% average adherence printed green. Refill thresholds stay with `classifyRefillSeverity`; `refillStatus` only names the tier. The scan rejects `warning`, `success`, `danger`, `danger-ink`, `danger-fg` and `info` behind any colour utility, with any variant and any opacity, or read inline as `var(--color-…)`, in `src/**/*.{svelte,ts}`, unless the file is in `EXEMPT` (the owner, `Button`'s danger variant, `Toast` and `Input`, which the spec keeps as they are, and the two walkthrough parts that copy those two, `FieldBox` and `StageUndoOffer`). The list is two-way, so a stale exemption fails as loudly as a new offender. Field-error lines (`<p id="…-error">` with no fill) are masked rather than exempted; a banner that happens to carry an `-error` id is not masked. **Opacities belong to the contrast test, not to taste.** `theme-tokens.test.ts` reads `TONE_CLASSES` and measures every tone × element over each backdrop that element is drawn on, in both schemes. That is why the happened chip is `/10`: at `/15` it is 4.33:1 on a hovered card in dark. `Button`'s `danger` variant appears only inside `DestructiveConfirm`, because nothing reversible is red.
```

2. Replace `:120` (the `theme-tokens.test.ts` bullet) with:

<!-- prettier-ignore -->
```md
- `tests/unit/theme-tokens.test.ts` parses `src/app.css` (both `@theme` and the `prefers-contrast` block), reads the accent presets from `entryFor("accentColor").presets` in the appearance registry, and reads every status tint from `TONE_CLASSES`, so it cannot drift from what ships. It asserts text tokens, fills and control boundaries, and every tone × element the owner can produce over each backdrop that element actually composites onto. A new place an element is drawn belongs in that describe's `BACKDROPS`, with its real DOM nesting. A new tint belongs in `TONE_CLASSES`, where it is measured without anyone adding a row.
```

If Step 5 kept any hand-written chip rows, append to that bullet: "The few hand-written tints that are not statuses keep their own rows in the CHIPS table."

3. Under "## Reusable Components" (`:64`), add one line for `Button` / `IconButton` / `Toggle` and one for `Alert` (Tasks 2 and 3 add none). Give the name, the props that matter, and the rule it enforces. `Button`: "fixed heights (`md` `h-11`, `sm` `h-9`), never padding; `class` is for layout only, because Tailwind v4 orders same-property utilities by name, so use `variant`, `size` and `shape`; `danger` only inside `DestructiveConfirm`". `Alert`: "four tones; errors are `role="alert"` and never sit inside a `role="status"` wrapper; needs-you is never an alert; owns no outer margin". `DestructiveConfirm` already has Task 7's Key Patterns bullet (7.6 Step 4); do not repeat it.

- [ ] **Step 9: CHANGELOG**

Under `## [Unreleased]`, add these items at the top of each section, as tight lists (no blank line between items). Each claim must be true of the merged branch. Run the check beside it, and drop or reword any claim that fails.

| Claim                                                   | Check                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| four deletions take the word and password on the server | `git grep -n "checkDestructiveGuard(" -- src/routes` → 4 call sites (privacy ×2, data, import)                                  |
| import replace now checks both                          | `git grep -n confirmPhrase -- src` → nothing                                                                                    |
| OAuth-only accounts can use them                        | T7's guard test for an account with no `passwordHash` passes                                                                    |
| reversible actions not red                              | `git grep -n 'variant="danger"' -- src` → only `src/lib/components/ui/DestructiveConfirm.svelte`                                |
| one "Reorder soon" chip, no "Low" chip                  | `git grep -n ">Low: " -- src/lib/components/MedicationCard.svelte` → nothing (HEAD has it at `:169`)                            |
| warnings no longer alerts; lookup scoped                | `git grep -n "document.querySelector<HTMLElement>('\[role=\"alert\"\]')" -- src/lib/components/MedicationForm.svelte` → nothing |
| walkthrough scenes redrawn                              | `git diff main --stat -- src/lib/components/walkthrough/scenes` lists the scenes named                                          |

Security:

<!-- prettier-ignore -->
```md
- **A permanent deletion cannot skip its confirmation.** Deleting dose history, deleting archived medications, replacing all data on import and deleting the account each ask for a typed word (DELETE, or REPLACE for the import). Where the account has a password, they ask for that too. The server checks both on every browser request, so posting the form directly skips neither. Import's replace mode used to check only the password. The `/api/v1` wipes are unchanged: they still take a password-issued re-authentication token and no typed word, so a stolen bearer token alone still cannot wipe anything.
```

Changed:

<!-- prettier-ignore -->
```md
- **Each status colour has one meaning.** Amber means something needs you, red means something went wrong or cannot be undone, green only confirms that something happened, and everything else is neutral. Every coloured status also carries a word or a glyph. A skipped dose is now neutral and a missed dose red on the dashboard, the log and analytics alike, where the three used to disagree. Both urgent refill tiers are amber and the 8–14-day tier is neutral. A medication at or below its stock alert shows one "Reorder soon" chip rather than a second "Low" one. A severe side effect is red; mild and moderate are neutral. Analytics stat cards, trends, side-effect counts and insights are neutral, so a 35% average adherence no longer prints green; the one actionable insight, a refill, is amber. "Enabled", "active" and the "Danger zone" headings in settings are neutral.
- **Buttons and banners are components.** `Button`, `IconButton`, `Toggle` and `Alert` replace about thirty hand-written button recipes and forty hand-written banners. Every button has a visible keyboard focus ring and a fixed height of 44px or 36px, so compact density no longer shrinks "Save Changes" below "Send test". Reversible actions are no longer red: Sign out, Archive, Disable two-factor, Disable push, Revoke. Red is kept for the button that confirms a permanent deletion. Removing a dose can be undone, so "Remove this dose" and the log's × are neutral too.
- **The landing-page walkthrough shows the new colours** in its history, analytics, medications, security and data scenes.
- `--color-info` is retired. Its hue sat next to the accent's, so the refill "watch" tier read as a selected control.
```

Fixed:

<!-- prettier-ignore -->
```md
- **Accounts without a password can use the four permanent deletions.** Deleting dose history, deleting archived medications and deleting the account all demanded a password. An account created through Google, GitHub or Sign in with Apple has none, so those users could not run them at all. The typed word now confirms them on its own.
- **Every failure banner is announced the same way.** All are now assertive; seven of twelve were polite. The reset-password confirmation, the notifications page's resend result and "Import complete" are now announced at all.
- **The medication form focuses its own error.** After a failed save it looked for the first `role="alert"` on the whole page, which could be the drug-interaction warning above the form. Warnings are no longer alerts, and the lookup stays inside the form.
```

Amend `:51` (Fixed). The same unreleased version now removes the token it describes raising. From:

<!-- prettier-ignore -->
```md
… rather than the nearest opaque surface, which raised `--color-info` to `#a5a8f8` (4.71:1 on a hovered card) and `--color-danger-ink` to `#f98686` (5.00:1 in the same place).
```

to:

<!-- prettier-ignore -->
```md
… rather than the nearest opaque surface, which raised `--color-danger-ink` to `#f98686` (5.00:1 on a hovered card).
```

<!-- prettier-ignore -->
```bash
npx prettier --write CLAUDE.md CHANGELOG.md
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: name the status-colour owner in CLAUDE.md and the changelog"
```

- [ ] **Step 10: Audit the anti-goals across the whole branch**

Each line is a spec anti-goal or a hard constraint, checked mechanically. The tests cover them individually; this checks that no task undid another's work.

<!-- prettier-ignore -->
```bash
# The fence: the write path is untouched.
git diff main --stat -- src/lib/components/dose-writes/                       # expect: no output
# The fence: the dose-control tests changed only where a colour is asserted.
git diff main -- tests/unit/dose-action-form.test.ts tests/unit/due-card-ssr.test.ts \
  tests/unit/done-list-ssr.test.ts tests/unit/status-marker-ssr.test.ts \
  tests/unit/timeline-entry-ssr.test.ts tests/unit/timeline-entry-delete.test.ts \
  tests/unit/quick-log-bar.test.ts tests/unit/medication-card-targets-ssr.test.ts \
  tests/unit/toast-undo.svelte.test.ts tests/unit/dose-edit-form-lock.test.ts \
  tests/unit/medications-reorder-lock.test.ts
#   expect: no hunk touches a size (min-h-11 / h-11 / size-11 / size-8), focus,
#   lock or submit-path assertion. The hunks are colour assertions, chip-text
#   assertions (Tasks 4, 5), the moved compiledRule import (Task 2) and new
#   describes (Tasks 4, 10, 12); Task 10's Cancel describe pins Save's class unchanged.
# No primitive takes the dose-write lock.
git grep -n -E "beginDoseWrite\(|lock\.acquire\(" -- src/lib/components/ui     # expect: no output
# Red only inside the permanent-deletion confirmation.
git grep -n 'variant="danger"' -- src                                           # expect: DestructiveConfirm.svelte only
# Every non-dose button is a primitive: no padding-sized button recipe is left (spec Goal 3).
git grep -n -E '(bg-accent text-accent-fg|hover:bg-surface-overlay|border-danger-ink)[^"]* py-' \
  -- src ':!src/lib/components/walkthrough'
#   expect only: DoseEditForm.svelte's Save (fenced), MedicationFilterSelect.svelte's
#   option rows, and medications/+page.svelte's archived-medication row links (list rows).
# Every permanent deletion is guarded on the server.
git grep -n "checkDestructiveGuard(" -- src/routes                              # expect: 4 call sites
# The reauth comment no longer claims browser/API parity (spec, guarded deletions).
git grep -n "same position the browser is in" -- src/routes/api/v1/auth/reauth  # expect: no output
```

Any unexpected output is a defect in the task that owns that file. Fix it there with its own test, not here.

- [ ] **Step 11: Write the preview-pass checklist (Jamie performs it on the PR's preview)**

This is the spec's third gate ("Constraints from the codebase"). jsdom cannot measure rendered contrast, and this machine has no working local app, so the pass runs on the PR's Vercel preview. Signing in is a human step. The PR records the result. Step 12 pastes this into the PR body, and Jamie fills it in:

<!-- prettier-ignore -->
```md
## Preview pass

**Before signing in.** Check which database the preview uses: Vercel → Project → Settings → Environment Variables → `DATABASE_URL` (Preview). The PR's Neon branch (`neon_workflow.yml`) is not wired to Vercel, so Preview may point at production. Either way, use only the public demo account (`demo@medtracker.app`, credentials on the landing page). **Never press an enabled danger button.** Open each deletion dialog, check its states, then Cancel. If you log a dose to see a toast, press its Undo.

**Switching theme.** Logged-out pages follow the device: in DevTools, Rendering → "Emulate CSS media feature prefers-color-scheme". Signed in: Settings → Appearance → Theme → System, then the same DevTools switch. Restore the demo account's original Theme and Density when you finish.

**On every page, in both themes:**
- Tab through the controls. Every button shows a 2px accent ring, offset from the button.
- Amber appears only on something you should act on. Red appears only on a failure, a missed dose, a severe side effect, or a deletion's confirm button.
- Every coloured status also has a word or a glyph.
- Nothing sits on a jumped or clipped label while pending.

| Page | Check | Light | Dark |
|---|---|---|---|
| `/auth/login` | `?error=oauth_email_conflict` shows an amber needs-you Alert with a triangle icon. A wrong password shows a red Alert with a circled "!". Field-error lines are unchanged. Submit is a full-width primary Button. | ☐ | ☐ |
| `/auth/register` | The form error is a red Alert (try the demo email). The primary Button shows its pending label while submitting. | ☐ | ☐ |
| `/dashboard` | An overdue Due card has an amber edge and a "!" marker; due now is accent. Done: taken ✓ green, skipped "–" neutral, missed ✕ red. Refills: critical and warning rows amber with "Reorder soon", watch neutral. The edit dialog's "Remove this dose" is neutral, not red. A log's toast is green with Undo. | ☐ | ☐ |
| `/medications` | Each card shows at most one refill chip: amber at ≤7 days or at/below its alert threshold, neutral at 8–14 days, no "Low: N". The "~Nd supply left" line is neutral at every count. Archive is a secondary (bordered) Button. With Density → Compact, Save-style buttons stay 44px and small ones 36px. | ☐ | ☐ |
| `/log` | Skipped rows are neutral and missed rows red, each with its word. Severe side effects are red; mild and moderate are neutral. The "time since" is neutral. The × is neutral. Filters and pagination are Buttons with focus rings. | ☐ | ☐ |
| `/analytics` | Streak, average adherence and total doses are neutral, with neutral sparklines. Trends are neutral with ↑/↓. The breakdown bar shows taken green, skipped neutral, missed red. Side-effect frequency is neutral. Insights use neutral glyphs, except one amber "Reorder soon:" when a refill is due. The period buttons are Toggles (accent when pressed). | ☐ | ☐ |
| `/settings/appearance` | Each control saves and announces its status line. Buttons and focus rings render. | ☐ | ☐ |
| `/settings/privacy` | "Danger zone" headings are neutral. Each Delete opens from a secondary Button. The dialog's scrim covers the whole viewport, not the card. The dialog shows counts. The red button stays disabled-looking until DELETE and the password are both typed, and is then enabled. (A refused password is pinned by the mount tests; pressing the enabled button to see it is exactly what the rule above forbids.) **Cancel.** Focus returns to the entry button. | ☐ | ☐ |
| `/settings/data` | Delete account follows the same dialog rules, scrim included. **Cancel.** Export buttons are secondary/primary Buttons. | ☐ | ☐ |
| `/settings/data/import` | Replace mode asks for REPLACE plus the password, in a full-viewport dialog. Enter in the word field does not run "Preview again". **Cancel.** If you have an export file to hand, its preview warnings render as an amber Alert. Do not confirm a replace. | ☐ | ☐ |

Logged out, `/`: the walkthrough's History, Analytics, Medications, Security and Data shots draw the new colours and the 44px / 36px controls, and nothing clips. ☐ light ☐ dark

Optional, if time allows: `/medications/[id]` (inventory ±N neutral; Archive/Adjust secondary), `/settings/security` ("Enabled" neutral; Disable/Revoke secondary) and `/settings/notifications` ("not configured" neutral; "push off" amber).

Anything that fails: note the page, the theme and a screenshot here, and open a follow-up rather than patching in this PR.
```

- [ ] **Step 12: Final gates, then push and open the PR**

1. `npx vitest run tests/unit/status-tone.test.ts tests/unit/status-colour-owner.test.ts tests/unit/theme-tokens.test.ts tests/unit/theme-css.test.ts`. Expected: PASS.
2. `npx vitest run`. Expected: 0 failed.
3. `npm run check`. Expected: 0 errors, warnings ≤ 27.
4. `npm run lint`. Expected: 0 errors, warnings ≤ 115.
5. `npm run format:check`. Expected: clean.
6. `DATABASE_URL=postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require npm run build`. Expected: exit 0. This is the same invocation as `ci.yml:99-106` and the PR template's last box. It is the only gate that runs Tailwind's real source scan over the owner's literals.
7. Record the final `npm run check` and `npm run lint` warning counts. Lint may have fallen below 115 as links moved to `Button`; it must not be above it.
8. Push `feat/status-colours` and open the PR with the template (`.github/PULL_REQUEST_TEMPLATE.md`). Tick its five testing boxes from items 1–6, and state the warning counts from item 7. Paste Step 11's checklist under a `## Preview pass` heading. No Claude or AI attribution anywhere in the body.

## Notes for the executor

- **Pending states go only where a loading state existed at HEAD** (Tasks 7–10): the five auth submits, MedicationForm's submit, Send test, the push toggle and `DestructiveConfirm`'s danger button. Every other migrated button gains its fixed height and no `pending`.
- **A test about Svelte's SSR markers must render a real `.svelte` caller** (Tasks 2–12). `createRawSnippet` on the server pushes its string with no leading marker, so `render(Button, { children: createRawSnippet(…) })` does not show what a page emits. Task 2's `ButtonGallery.svelte` exists for this.

## Out of scope (follow-ups)

- **Three accent presets fall below 4.5:1 while hovered.** Signed in, the accent is the user's preset, and `hover:opacity-90` takes `#ef4444` with `#111` to 4.24–4.34:1 (both themes), `#3b82f6` with `#111` to 4.36–4.38:1 (dark) and `#64748b` with white to 3.90–3.96:1 (light) and 4.44:1 over a dark dialog. This is true of all 26 existing `hover:opacity-90` accent buttons at HEAD; `Button`'s primary only inherits it, and it is untested because the row would fail. The fix belongs to the accent derivation: solve `readableForeground` against the 90% composite, or hover with a filter chosen per foreground.
- **The Mac app** (the separate `medtracker-mac` repo) ports `buildInsights`' strings and its "warning → positive → info" order 1:1 (`docs/superpowers/specs/2026-07-25-macos-app-design.md:221`). It needs Task 6's `signal`, the needs-you → down → up → info order, the `lead`, and the "run(s) out within 7 days" wording. Nothing in `/api/v1` carries insights.
- **MedicationFilterSelect's Clear filter drops focus to `<body>`** (pre-existing). The button unmounts itself on click, because `{#if selected.length > 0}` turns false while it is focused, and the popover stays open. Hand focus to `triggerEl` after `clear()`, as the reorder and StylePicker already do.
- **`revokeOtherSessions` still requires a password** (`privacy/+page.server.ts:42-52`), so an OAuth-only account cannot revoke its other sessions from Privacy. It is not one of the four deletions.
- **Notifications' `savePrefs` failure (`fail(400, { errors })`) is still not drawn.** It is unreachable from a checkbox-only form.
- **`DoseActionForm`'s `danger` variant now renders neutral.** A rename (for example to `remove`) touches `dashboard/+page.svelte:244` and two tests, and the fence asked for colour-only changes.
- **SideEffectPicker's severity button still says "Mod"** where the Log chips say "Moderate". Aligning it would change the button's `aria-label` to "Moderate severity for …".
- **The walkthrough's Lisinopril says "~27d supply left"** while `scripts/seed-demo.ts` seeds 28 doses at one a day, which the real forecast shows as 28 (pre-existing). Nothing in this plan needs the stage's stock figures, so it is left as it is.
- **Import: a dialog commit refused with a refreshed `preview`** ("still need a decision", "nothing importable") shows its message in the dialog but does not update the page's preview. The dialog opens only on a matching, non-empty, fully mapped preview, so neither failure is expected there.
