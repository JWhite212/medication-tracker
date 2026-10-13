# Landing-Page Walkthrough Redraw Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redraw the landing-page walkthrough's dashboard and phone scenes to match the dashboard as it ships. Correct every caption, number and date the video now gets wrong, and fix the "Last logged … ago ago" reminder copy.

**Architecture:** The walkthrough stays one stateless stage: a pure function of time T, driven by `timeline.ts`.

- **Parts.** New scene-only parts copy the real dashboard's layout and reuse its pure leaves: `MedicationGlyph`, `StatusMarker`, the `dashboard-copy.ts` helpers, and the rules `RefillsCard`/`StatusBreakdownBar` export from `<script module>`.
- **Data.** One demo dose list, `DEMO_DOSES`, is the oracle:
  - the four `StageMoment`s (desktop before and after the log, phone before and after the tap) are written-out literals, and the fidelity test proves them equal to `composeDashboardPageData` run over `DEMO_DOSES`;
  - the History and Medications scenes keep their hand-written facts, and `walkthrough-demo-facts.test.ts` checks them against `DEMO_DOSES`.
- **Tests.**
  - The real composer and the real copy helpers are the oracle for both the scenes' data and their rendered text.
  - A Proxy-recorded `REQUIRED_MARKS` list and a stage mount test make a missing or misplaced mark fail loudly.

**Tech Stack:** SvelteKit 2.70, Svelte 5.57 runes, TypeScript, Tailwind CSS v4, Vitest 4.1 (jsdom by default; `// @vitest-environment node` for server imports), `svelte/server` `render()` for SSR assertions.

**Spec:** `docs/superpowers/specs/2026-10-12-walkthrough-redraw-design.md`. Executors read both the spec and this plan; where they conflict, the spec decides, except for the deviations listed below.

## Global Constraints

- **The stage contains no focusable element, heading or landmark.**
  - No `a[href]`, `area[href]`, `button`, `input`, `select`, `textarea`, `summary`, `details`, `iframe`, `audio[controls]`, `video[controls]`, `[contenteditable]` or any `[tabindex]`.
  - No part adds `h1`–`h6`, `section`, `nav`, `main` or `ul` landmarks.
  - The whole stage is `aria-hidden`.
- **No part copies an `animate-*` or `transition-*` class.** Motion comes only from Frame values, which are pure functions of T. The spinner's rotation is the `Frame.*.pending` angle in degrees.
- **A state variant the real control gets from an attribute** (`aria-disabled:`, `hover:`) is written out as a plain class in the part.
- **Every visible dashboard string in the stage comes from a real helper.**
  - From `$lib/utils/dashboard-copy`: `dashboardHeaderCopy`, `headerEyebrow`, `rowStatusLine`, `formatSlotTime`, `formatDoseLabel`, `laterUntil`, `doneCoversLine`, `doneDoseText`, `tookItAtLabel` and `toastForLog`.
  - From `$lib/utils/time`: `formatUserTime`, `formatUserDate` and `lastLoggedPhrase`.
  - The Refills and status-bar rules exported from `RefillsCard.svelte` and `StatusBreakdownBar.svelte`.

  The helpers are called with the moment's `now`/`todayStart`, `WALKTHROUGH_TZ` ("UTC") and the stage's `timeFormat`. They are never called with `new Date()` or the visitor's zone.

- **The Undo offer's wording** comes from `toastForLog` over the AFTER moment's Done row (`stageLogToast` in `stage-dashboard.ts`). The stage cannot use `logToastFromReload` because that needs a reloaded page payload. The fidelity test proves the two give the same text.
- **Story clocks:** `DESKTOP_NOW` is 2026-09-24T08:02Z and `PHONE_NOW` is 2026-09-24T10:12Z, in UTC.
- **SCENES** keeps its 12 scenes and 43.5s, renamed `MyDay`→`Today` and `QuickLog`→`LogNow`. `T_LOG = CUES.LogNow + 1.45` and `T_TAP = CUES.Reminders + 3.0`.
- **Beat timing**, the same on the desktop (t = `T_LOG`) and the phone (t = `T_TAP`):
  - `pending` on [t, t+0.4);
  - `logged` rises over [t+0.4, t+0.7];
  - `offer` rises from t+0.5 over 0.3s, and is exactly 0 at the next hard cut (`CUES.Medications` on the desktop, `CUES.Outro` on the phone).
- **Every marked element is mounted at every T.**
  - No `{#if}`, `{#key}` or `{#each}` whose condition depends on T, or on any Frame value, may wrap an element carrying `use:mark`.
  - Collapse and grow are height, opacity or transform.
  - A condition fixed by the payload for the whole loop, such as StageDueCard's `{#if row.logNow}`, is allowed: the registered set cannot change with T, and T9's mount test asserts that.
  - Measured rects describe the before-log layout.
- **Copy (exact, from the spec):**
  - **Caption 01:** "Today" / "What's due now, what's done and what's next." / "Every row on the page decided by one matcher, on the server".
  - **Caption 02:** "Log now" / "One tap to log, and Undo for ten minutes." / "Single-fire writes, re-checked under a row lock on the server".
  - **Caption 04 line:** "When each medication was last taken, always current."
  - **Caption 10 tech:** "Web Push on a half-hourly daytime sweep, with idempotent dedupe keys".
  - **Landing copy:** "Under a minute, ten features, from the first dose of the day to an overdue reminder."
  - **No-event email:** "is due — not yet logged."
- **Tests never pin a literal clock string from the spec.** They compare against helper output. Any literal time tolerates ICU's optional leading zero, `/^0?8:02$/`.
- **Svelte 5.57 `render()` from `svelte/server` is lazy.** Every SSR assertion reads `.body` (or `.head`). A jsdom `mount()` needs `flushSync()` before asserting that actions ran.
- **Every new or changed test is proven by mutation.** Break the production line it guards, run the named test, see it FAIL, then restore it. Record each mutation in the task report.
- **`tests/unit/reminders.test.ts` keeps its bespoke fake** (CLAUDE.md's named exception). Do not move it to fake-db.
- **Commits:** Conventional Commits, with NO Claude/AI attribution of any kind: no Co-Authored-By, no session links, no "Generated with". The pre-commit hook runs eslint and prettier; never use `--no-verify`. Never push. Never switch branches.
- **Gates at the end of every task.** Each task states its exact expected vitest totals; the base is 190 files / 2853 tests.
  - `npx vitest run`, run twice, naming any failing test;
  - `npm run check`: 0 errors, ≤ 27 warnings;
  - `npm run lint`: 0 errors, ≤ 115 warnings;
  - `npm run format:check`: clean.
- **Packages** resolve from `../../../node_modules`; there is no `node_modules` in the worktree.

## Review Focus

These are the five conditions most likely to bite a real person that no ordinary test would exercise. Each one's test lives in the task named.

1. **A visitor whose own clock and timezone are far from the story.**
   - Someone in Auckland on 2027-03-01 must see exactly the same strings as someone in London on the story day. No part may read `new Date()`, `Date.now()` or the visitor's zone.
   - Test: render the scenes and the whole stage. Then render them again with Date faked to 2027-03-01T09:30+13:00 and `process.env.TZ` set to `Pacific/Auckland` (asserting the zone took effect), and assert the text is byte-identical (T7 desktop, T8 phone).
2. **The loop seam, and pausing at any moment.**
   - A pause during the log must never leave a stuck spinner, or a half-state that outlives its window.
   - Test, over every 20ms sample:
     - `pending` is null outside [t, t+0.4);
     - `logged` and `offer` stay in [0, 1];
     - across the seam, `pending` and `offer` at T=0 equal their values at T=TOTAL_DURATION−ε;
     - `logged` is 0 at T=0 and through 1.2s, which is when production measures marks;
     - both seam frames are title frames, so neither surface is on screen across the jump (T7 desktop, T8 phone).
3. **A person who reads the screen-reader text instead of watching.**
   - The sr-only figcaption must say only true things.
   - Test: the figcaption list equals LOWER_THIRDS' "title: line" pairs, and no caption mentions "My Day", "next due" or "Vercel Cron" (T6).
4. **A real reminder recipient whose last event was moments ago, or never.**
   - The push and email must read naturally in every case.
   - Test: five inputs through the real sweep and the real email sender (T2): the four `formatTimeSince` branches (30s, 5m, 2h 3m, 25h) plus a null `lastEventAt`.
5. **A narrow phone, at 375px.**
   - The phone scene must keep Log now inside its 732px content box and above the home indicator, with no visible row cut through its text.
   - Test: the T10 browser screenshot. The T8 render check asserts that the Later rows shown are exactly the first `PHONE_LATER_ROWS`.

## Spec deviations

Each is argued in the task that owns it.

- **Analytics' "pool missed" mutation is equivalent on the demo data.** No demo medication over-resolves, so the mutation cannot fail T4's demo-vs-real check. T3's unit mutation proves pooling is caught instead, and T4 records the equivalence.
- **The Analytics bar and Security's expiry dates are never on camera.** They sit at stage y ≈ 1106 and 1000, below the 984px window. T10 verifies them by DOM text in the browser rather than by screenshot.
- **The spec's "wrap the new Done row's mark in `{#if logged}`" mutation has nothing to wrap.** The Done section carries one mark, `d.done`, mounted at every T. T9 substitutes wrapping `o.offer` in a T-dependent `{#if}`, plus another T-dependent `{#if}` around a marked element.
- **Two shipped components gain `<script module>` exports** (`StatusBreakdownBar` and `RefillsCard`), so the stage uses their rules instead of copying them. Both keep byte-identical markup, and their tasks prove it.

## File Structure

**Create:**

- `src/lib/server/analytics/status-breakdown.ts` (T3): the pure per-medication fold, `calculateAdherence` and `calculateOveruse`.
- `tests/unit/analytics-status-breakdown.test.ts` (T3): the pure fold, with `$lib/server/db` mocked to throw.
- `src/lib/components/walkthrough/demo-dashboard.ts` (T5): the `StageMoment` type and the four moments.
- `src/lib/components/walkthrough/stage-dashboard.ts`:
  - T7: `WALKTHROUGH_DATE_FORMAT`, `beatRow`, `stageLogToast` and `STAGE_REFILLS`;
  - T8 adds `lastEventBefore`.
- `src/lib/components/walkthrough/parts/dashboard/{StageDashboardHeader,StageDueCard,StageDoneList,StageLaterList,StageChips,StageRefills,StageUndoOffer,StageCollapse}.svelte` (T7). `StageCollapse` grows and collapses by an `fr` grid row, with its content always mounted.
- `tests/unit/walkthrough-dashboard-fidelity.test.ts` (T5; T7 and T8 extend it).
- `tests/unit/walkthrough-demo-facts.test.ts` (T4).
- `tests/unit/walkthrough-marks.svelte.test.ts`:
  - T6: `MARKS_CONTEXT` registration;
  - T8: `p.vitdLog` sits on the phone's Log now, and the phone registers nothing besides its root.
- `tests/unit/walkthrough-stage.svelte.test.ts` (T9).
- `tests/unit/walkthrough-video.svelte.test.ts` (T9: reduced motion, jsdom).
- `tests/unit/walkthrough-video-ssr.test.ts` (T9: the accent, `// @vitest-environment node`).

**Modify:**

- `src/lib/utils/dashboard-copy.ts` (T1).
- `src/lib/components/dashboard/{DashboardHeader,LaterList,DoneList,DueCard}.svelte` (T1).
- `src/lib/utils/time.ts`:
  - T2: `formatTimeSince` gains `now`, and `lastLoggedPhrase` is added;
  - T7: `formatDueIn` is deleted.
- `src/lib/server/reminders.ts` and `src/lib/server/email.ts` (T2).
- `src/lib/server/analytics.ts` (T3).
- `src/lib/components/StatusBreakdownBar.svelte` (T4). This is a shipped component: its segment rule moves into an exported `statusBreakdownSegments` in `<script module>`, so AnalyticsScene draws the bar by the card's own rule without mounting its `<h2>`.
- `src/lib/components/RefillsCard.svelte` (T7). This is a shipped component: its three label and severity functions move into `<script module>` exports, so StageRefills uses the card's own rules.
- `src/lib/components/walkthrough/demo-data.ts` (T4, T8).
- `src/lib/components/walkthrough/scenes/{AnalyticsScene,SecurityScene}.svelte` (T4).
- `src/lib/components/walkthrough/timeline.ts` (T6, T7, T8).
- `src/lib/components/walkthrough/marks.ts` (T6).
- `src/routes/+page.svelte` (T6).
- `src/lib/components/walkthrough/scenes/DashboardScene.svelte` (T7).
- `src/lib/components/walkthrough/WalkthroughStage.svelte` (T7, T8).
- `src/lib/components/walkthrough/scenes/PhoneScene.svelte` (T8).
- `src/lib/components/walkthrough/WalkthroughVideo.svelte` (T9).
- `CLAUDE.md` and `CHANGELOG.md` (T10).
- Tests:
  - `tests/unit/walkthrough-timeline.test.ts` (T6, T7, T8);
  - `tests/unit/reminders.test.ts` and `tests/unit/email.test.ts` (T2);
  - `tests/unit/time.test.ts` (T2, T7);
  - `tests/unit/dashboard-copy.test.ts` (T1).

**Delete:**

- `src/lib/components/walkthrough/parts/{MyDaySection,SummaryAndRefills,StatusMark,StageToast}.svelte` (T8).
- demo-data's `DAY_GROUPS`, `daySlots` and their types (T8).
- `formatDueIn` and its tests (T7).

---

### Task 1: Move the dashboard's inline strings into dashboard-copy helpers

Four dashboard components compose five visible strings inline:

- the header's date eyebrow;
- the Later row's "in 3 hours";
- the Done row's "for 08:00" and "500mg ×2";
- the Due card's "Took it at 09:05".

The walkthrough's stage parts (T7, T8) must render the same strings, and the fidelity test must compare them against the code that produces them. So each string moves into a pure helper in `src/lib/utils/dashboard-copy.ts`, and the real component calls it.

The move is **behaviour-neutral**. The components' existing SSR tests stay green and are **not edited**. Each new helper gets unit tests in the existing `tests/unit/dashboard-copy.test.ts`, and every test is proven by mutation.

**Files:**

- Modify: `src/lib/utils/dashboard-copy.ts`:
  - `:2`, the `./time` import;
  - five new exports inserted before `:114` (the `toastForLog` doc comment).
- Modify: `src/lib/components/dashboard/DashboardHeader.svelte`:
  - `:3-4`, the imports;
  - `:22-24`, the `eyebrow` derived.
- Modify: `src/lib/components/dashboard/LaterList.svelte`:
  - `:3-4`, the imports;
  - `:22-27`, the private `until` is deleted;
  - `:57`, its call site.
- Modify: `src/lib/components/dashboard/DoneList.svelte`:
  - `:26`, the import;
  - `:59-61`, the `covers` map is deleted;
  - `:68-70`, the `dose` field;
  - `:74`, `coversText`.
- Modify: `src/lib/components/dashboard/DueCard.svelte`:
  - `:9-11`, the import list;
  - `:144`, the Took it at label.
- Test: `tests/unit/dashboard-copy.test.ts`:
  - `:1-13`, the imports;
  - 16 new tests appended after `:370`.
- **Must stay byte-for-byte unedited:**
  - `tests/unit/dashboard-header-ssr.test.ts`
  - `tests/unit/later-list-ssr.test.ts`
  - `tests/unit/done-list-ssr.test.ts`
  - `tests/unit/due-card-ssr.test.ts`
  - `tests/unit/dashboard-page-ssr.test.ts`
  - `tests/unit/dose-toasts.test.ts`

**Interfaces:**

- **Consumes** nothing from earlier tasks. It uses existing code only:
  - from `$lib/utils/time`:
    - `formatUserDate(date: Date, timezone: string, dateFormat?: DateFormat, opts?: { weekday?: boolean; year?: boolean }): string`;
    - `formatDuration(ms: number, opts?: { style?: "short" | "long"; maxUnits?: 1 | 2 }): string`;
    - `type DateFormat`;
    - `type TimeFormat`.
  - from `dashboard-copy.ts` itself: `formatSlotTime(at: Date, todayStart: Date, tz: string, timeFormat: TimeFormat): string`.
- **Produces** five exports from `$lib/utils/dashboard-copy`. T7's and T8's stage parts and the fidelity test call them, so the spellings and types are fixed:
  - `headerEyebrow(serverNow: Date, tz: string, dateFormat: DateFormat): string`. It is `formatUserDate(serverNow, tz, dateFormat, { weekday: true, year: false })`.
  - `laterUntil(expectedTime: string, serverNow: Date): string`. It is `` `in ${formatDuration(Date.parse(expectedTime) - serverNow.getTime(), { style: "long", maxUnits: 1 })}` ``.
  - `doneCoversLine(covers: readonly string[], todayStart: Date, tz: string, timeFormat: TimeFormat): string | null`:
    - `null` when `covers` is empty;
    - otherwise `"for "` plus each ISO instant through `formatSlotTime`, joined with `", "`, **in the order given**. The composer already sorts `covers` ascending (`server/dashboard/page-data.ts:217-219`).
  - `doneDoseText(dose: { dosageAmount: string; dosageUnit: string; quantity: number; status: string }): string`. It is `` `${dosageAmount}${dosageUnit}` `` plus `` ` ×${quantity}` `` only when `status === "taken" && quantity > 1`. The sign is U+00D7.
  - `tookItAtLabel(time: string): string`. It is `` `Took it at ${time}` ``. `time` is the row's **already-formatted slot time**, as DueCard's `view.time` = `formatSlotTime(new Date(row.expectedTime), todayStart, tz, timeFormat)`. It is never `row.tookItAt`.

- [ ] **Step 1: Write the failing tests**

Two edits to `tests/unit/dashboard-copy.test.ts`.

(a) Replace the import block at the top of the file (lines 1-13).

Old:

```ts
import { describe, it, expect } from "vitest";
import {
  dashboardHeaderCopy,
  formatDoseLabel,
  formatSlotTime,
  rowStatusLine,
  toastForDoseRemoved,
  toastForLog,
  toastForSkip,
  toastForTookItAt,
} from "$lib/utils/dashboard-copy";
import type { DashboardStatus, DueRow } from "$lib/types";
import type { TimeFormat } from "$lib/utils/time";
```

New:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  dashboardHeaderCopy,
  doneCoversLine,
  doneDoseText,
  formatDoseLabel,
  formatSlotTime,
  headerEyebrow,
  laterUntil,
  rowStatusLine,
  toastForDoseRemoved,
  toastForLog,
  toastForSkip,
  toastForTookItAt,
  tookItAtLabel,
} from "$lib/utils/dashboard-copy";
import type { DashboardStatus, DueRow } from "$lib/types";
import { formatUserDate, type TimeFormat } from "$lib/utils/time";
```

(b) Append this block at the very end of the file, after the closing `});` of `describe("toastForDoseRemoved", …)`, with one blank line between them.

These tests rely on the file's existing `TZ = "UTC"`, `TODAY_START = 2026-04-16T00:00Z` and `at()`.

They follow the file's rule that every pinned 24h time has a **two-digit hour**, because en-GB prints "9:05", not "09:05". The one 12h case tolerates an optional leading zero.

```ts
describe("headerEyebrow", () => {
  // Noon UTC on Thursday 24 September 2026.
  const NOON = at("2026-09-24T12:00:00.000Z");

  it("is formatUserDate with a weekday and no year, in every date format", () => {
    for (const dateFormat of ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const) {
      expect(headerEyebrow(NOON, TZ, dateFormat)).toBe(
        formatUserDate(NOON, TZ, dateFormat, { weekday: true, year: false }),
      );
    }
  });

  it("lets the preference order the fields, and never adds a year to a named month", () => {
    // en-GB's short September is "Sept" on ICU 72+ and "Sep" before it. This
    // runs in the viewer's browser, so the shape is pinned, not the spelling.
    expect(headerEyebrow(NOON, TZ, "DD/MM/YYYY")).toMatch(/^Thu 24 Sept?$/);
    expect(headerEyebrow(NOON, TZ, "MM/DD/YYYY")).toMatch(/^Thu, Sep 24$/);
    // ISO is assembled field by field, and always carries its year.
    expect(headerEyebrow(NOON, TZ, "YYYY-MM-DD")).toBe("Thu, 2026-09-24");
  });

  it("names the day in the user's zone, not the server's", () => {
    // 23:30 UTC on the 24th is already Friday the 25th in Auckland (NZST, +12).
    const late = at("2026-09-24T23:30:00.000Z");
    expect(headerEyebrow(late, "UTC", "YYYY-MM-DD")).toBe("Thu, 2026-09-24");
    expect(headerEyebrow(late, "Pacific/Auckland", "YYYY-MM-DD")).toBe("Fri, 2026-09-25");
  });
});

describe("laterUntil", () => {
  const SERVER_NOW = at("2026-04-16T13:00:00.000Z");
  const until = (expectedTime: string) => laterUntil(expectedTime, SERVER_NOW);

  it("says how far off a Later row is, in words", () => {
    expect(until("2026-04-16T20:00:00.000Z")).toBe("in 7 hours");
    expect(until("2026-04-16T14:00:00.000Z")).toBe("in 1 hour");
    expect(until("2026-04-16T13:45:00.000Z")).toBe("in 45 minutes");
  });

  it("shows one unit, floored, like every duration on the page", () => {
    expect(until("2026-04-16T14:30:00.000Z")).toBe("in 1 hour");
    expect(until("2026-04-16T20:59:00.000Z")).toBe("in 7 hours");
  });

  it("measures from the page's serverNow, never the device clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(at("2027-03-01T00:00:00.000Z"));
      expect(until("2026-04-16T20:00:00.000Z")).toBe("in 7 hours");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("doneDoseText", () => {
  const text = (quantity: number, status = "taken") =>
    doneDoseText({ dosageAmount: "500", dosageUnit: "mg", quantity, status });

  it("is the medication's dose, with no multiplier for a single dose", () => {
    expect(text(1)).toBe("500mg");
    expect(
      doneDoseText({ dosageAmount: "2.5", dosageUnit: "ml", quantity: 1, status: "taken" }),
    ).toBe("2.5ml");
  });

  it("adds ×n to a taken dose of more than one", () => {
    expect(text(2)).toBe("500mg ×2");
    expect(text(4)).toBe("500mg ×4");
  });

  it("never shows a quantity on a skipped or missed row", () => {
    expect(text(3, "skipped")).toBe("500mg");
    expect(text(2, "missed")).toBe("500mg");
  });
});

describe("doneCoversLine", () => {
  const line = (covers: string[], timeFormat: TimeFormat = "24h") =>
    doneCoversLine(covers, TODAY_START, TZ, timeFormat);

  it("is null when the dose resolved no slot beyond its own minute", () => {
    expect(line([])).toBeNull();
  });

  it("lists the slots the dose resolved, prefixing yesterday's", () => {
    expect(
      line(["2026-04-15T22:30:00.000Z", "2026-04-16T10:55:00.000Z", "2026-04-16T11:00:00.000Z"]),
    ).toBe("for yesterday 22:30, 10:55, 11:00");
  });

  it("keeps the order it is given: the composer sorts covers, this only words them", () => {
    expect(line(["2026-04-16T11:00:00.000Z", "2026-04-16T10:55:00.000Z"])).toBe("for 11:00, 10:55");
  });

  it("follows the 12h preference", () => {
    expect(line(["2026-04-16T13:31:00.000Z"], "12h")).toMatch(/^for 0?1:31 pm$/);
  });

  it("decides 'yesterday' against todayStart, in the user's zone", () => {
    // Midnight on 16 April in London (BST) is 23:00Z on the 15th.
    const londonStart = at("2026-04-15T23:00:00.000Z");
    expect(doneCoversLine(["2026-04-15T21:00:00.000Z"], londonStart, "Europe/London", "24h")).toBe(
      "for yesterday 22:00",
    );
  });
});

describe("tookItAtLabel", () => {
  it("names the instant Took it at records", () => {
    expect(tookItAtLabel("11:00")).toBe("Took it at 11:00");
  });

  it("carries an Earlier row's day, because its time arrives already prefixed", () => {
    const time = formatSlotTime(at("2026-04-15T22:00:00.000Z"), TODAY_START, TZ, "24h");
    expect(tookItAtLabel(time)).toBe("Took it at yesterday 22:00");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/dashboard-copy.test.ts`

Expected: FAIL with `Tests  16 failed | 35 passed (51)`.

- **The failures.** Every failure is a `TypeError` naming the missing export:
  - `headerEyebrow is not a function` ×3;
  - `laterUntil is not a function` ×3;
  - `doneDoseText is not a function` ×3;
  - `doneCoversLine is not a function` ×5;
  - `tookItAtLabel is not a function` ×2.
- **Everything else passes.** The 35 existing tests in the file still pass.

- [ ] **Step 3: Implement the five helpers**

Two edits to `src/lib/utils/dashboard-copy.ts`.

(a) Line 2.

Old:

```ts
import { formatDuration, formatUserTime, type TimeFormat } from "./time";
```

New:

```ts
import {
  formatDuration,
  formatUserDate,
  formatUserTime,
  type DateFormat,
  type TimeFormat,
} from "./time";
```

(b) Insert the five helpers directly above the `toastForLog` doc comment. That puts them between the closing `}` of `dashboardHeaderCopy` and the toast builders.

Old (unique):

```ts
/**
 * Log now / chip success toast, built from the reloaded data: `covers` are
```

New:

```ts
/**
 * The header's date eyebrow, "Thu 24 Sept". The date preference decides the
 * field order and the month's form; this decides the fields: a weekday, and
 * no year.
 */
export function headerEyebrow(serverNow: Date, tz: string, dateFormat: DateFormat): string {
  return formatUserDate(serverNow, tz, dateFormat, { weekday: true, year: false });
}

/**
 * A Due row's backdating button, "Took it at 11:00". `time` arrives formatted
 * by `formatSlotTime`, so an Earlier row's already reads "yesterday 22:00".
 */
export function tookItAtLabel(time: string): string {
  return `Took it at ${time}`;
}

/**
 * A Done row's dose, "500mg", with "×4" added for a taken dose of more than
 * one. A skip or a missed entry is one event whatever its quantity.
 */
export function doneDoseText(dose: {
  dosageAmount: string;
  dosageUnit: string;
  quantity: number;
  status: string;
}): string {
  const multiplier = dose.status === "taken" && dose.quantity > 1 ? ` ×${dose.quantity}` : "";
  return `${dose.dosageAmount}${dose.dosageUnit}${multiplier}`;
}

/**
 * The slots a Done row's dose resolved, as facts with no verdict: "for
 * yesterday 22:30, 10:55". Null when it resolved none beyond its own minute.
 * Kept in the order given: the composer sorts `covers`.
 */
export function doneCoversLine(
  covers: readonly string[],
  todayStart: Date,
  tz: string,
  timeFormat: TimeFormat,
): string | null {
  if (covers.length === 0) return null;
  const times = covers.map((iso) => formatSlotTime(new Date(iso), todayStart, tz, timeFormat));
  return `for ${times.join(", ")}`;
}

/** How far off a Later row is, "in 3 hours": long style, one unit, floored. */
export function laterUntil(expectedTime: string, serverNow: Date): string {
  const ms = Date.parse(expectedTime) - serverNow.getTime();
  return `in ${formatDuration(ms, { style: "long", maxUnits: 1 })}`;
}

/**
 * Log now / chip success toast, built from the reloaded data: `covers` are
```

The module doc comment says the file "imports only `./time` and types". That stays true, so the comment is not edited.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/dashboard-copy.test.ts`

Expected: PASS, `Tests  51 passed (51)`.

- [ ] **Step 5: DashboardHeader calls `headerEyebrow`**

Two edits to `src/lib/components/dashboard/DashboardHeader.svelte`.

(a) Lines 3-4.

Old:

```svelte
  import { formatUserDate, type DateFormat, type TimeFormat } from "$lib/utils/time";
  import { dashboardHeaderCopy } from "$lib/utils/dashboard-copy";
```

New:

```svelte
import type {(DateFormat, TimeFormat)} from "$lib/utils/time"; import {(dashboardHeaderCopy,
headerEyebrow)} from "$lib/utils/dashboard-copy";
```

(b) Lines 22-24.

Old:

```svelte
  const eyebrow = $derived(
    formatUserDate(serverNow, timezone, dateFormat, { weekday: true, year: false }),
  );
```

New:

```svelte
const eyebrow = $derived(headerEyebrow(serverNow, timezone, dateFormat));
```

Why `import type` and not inline `type` specifiers: once `formatUserDate` goes, both remaining names are types. An import holding only inline `type` specifiers is kept as a side-effect import under `verbatimModuleSyntax`. `DueCard.svelte:4` already uses this form.

- [ ] **Step 6: LaterList calls `laterUntil`**

Three edits to `src/lib/components/dashboard/LaterList.svelte`.

(a) Lines 3-4.

Old:

```svelte
  import { formatDuration, type TimeFormat } from "$lib/utils/time";
  import { formatSlotTime } from "$lib/utils/dashboard-copy";
```

New:

```svelte
import type {TimeFormat} from "$lib/utils/time"; import {(formatSlotTime, laterUntil)} from "$lib/utils/dashboard-copy";
```

(b) Delete the private `until` function at lines 22-27.

Old:

```svelte
  } = $props();

  /** "in 3 hours": long style, one unit, measured on the server's clock. */
  function until(row: LaterRow): string {
    const ms = Date.parse(row.expectedTime) - serverNow.getTime();
    return `in ${formatDuration(ms, { style: "long", maxUnits: 1 })}`;
  }
</script>
```

New:

```svelte
  } = $props();
</script>
```

(c) Line 57. The new line is wrapped the way prettier-plugin-svelte prints it. The `>` placement keeps the span's text free of whitespace, so the rendered text is unchanged.

Old:

```svelte
<span class="text-text-secondary shrink-0 text-sm">{until(row)}</span>
```

New:

```svelte
<span class="text-text-secondary shrink-0 text-sm">{laterUntil(row.expectedTime, serverNow)}</span>
```

`LaterRow` is still imported, because the `rows` prop uses it.

- [ ] **Step 7: DoneList calls `doneDoseText` and `doneCoversLine`**

Four edits to `src/lib/components/dashboard/DoneList.svelte`.

(a) Line 26. `formatSlotTime` was used only by the `covers` map that (b) deletes.

Old:

```svelte
import {(formatDoseLabel, formatSlotTime)} from "$lib/utils/dashboard-copy";
```

New:

```svelte
import {(doneCoversLine, doneDoseText, formatDoseLabel)} from "$lib/utils/dashboard-copy";
```

(b) Lines 58-62.

Old:

```svelte
const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time; const covers =
row.covers.map((iso) => formatSlotTime(new Date(iso), todayStart, timezone, timeFormat), ); const
skipped = dose.status === "skipped";
```

New:

```svelte
const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time; const skipped = dose.status
=== "skipped";
```

(c) Lines 68-70. The dose's fields are spread out explicitly: `dose` is a `DoseLogWithMedication`, and the amount and unit live on `dose.medication`.

Old:

```svelte
dose: `${med.dosageAmount}${med.dosageUnit}${dose.status === "taken" && dose.quantity > 1
  ? ` ×${dose.quantity}`
  : ""}`,
```

New:

```svelte
      dose: doneDoseText({
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        quantity: dose.quantity,
        status: dose.status,
      }),
```

(d) Line 74. The comment above it stays.

Old:

```svelte
coversText: covers.length > 0 ? `for ${covers.join(", ")}` : null,
```

New:

```svelte
coversText: doneCoversLine(row.covers, todayStart, timezone, timeFormat),
```

- [ ] **Step 8: DueCard calls `tookItAtLabel`**

Two edits to `src/lib/components/dashboard/DueCard.svelte`.

(a) The import list, lines 9-11.

Old:

```svelte
toastForSkip, toastForTookItAt, } from "$lib/utils/dashboard-copy";
```

New:

```svelte
toastForSkip, toastForTookItAt, tookItAtLabel, } from "$lib/utils/dashboard-copy";
```

(b) Line 144, inside the `row.tookItAt !== null` branch.

Old:

```svelte
label={`Took it at ${view.time}`}
```

New:

```svelte
label={tookItAtLabel(view.time)}
```

`srContext` and the button's other props are unchanged. The accessible name stays "Took it at 11:00: Metformin 500mg".

- [ ] **Step 9: Prove the move is behaviour-neutral, with the component tests unedited**

**The component tests are unedited.**

Run: `git diff --exit-code -- tests/unit/dashboard-header-ssr.test.ts tests/unit/later-list-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/due-card-ssr.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/dose-toasts.test.ts`

Expected: no output, exit code 0.

**They pass.**

Run: `npx vitest run tests/unit/dashboard-copy.test.ts tests/unit/dashboard-header-ssr.test.ts tests/unit/later-list-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/due-card-ssr.test.ts tests/unit/dashboard-page-ssr.test.ts tests/unit/dose-toasts.test.ts`

Expected: PASS, `Test Files  7 passed (7)` and `Tests  111 passed (111)`.

**No inline composition is left in a component.**

Run: `grep -nE 'Took it at \$\{|for \$\{covers|year: false|function until|×\$\{dose' src/lib/components/dashboard/*.svelte`

Expected: no output, exit code 1.

- [ ] **Step 10: Mutation proofs**

**Setup.** Record the checksum before you start: `shasum -a 256 src/lib/utils/dashboard-copy.ts`.

**For each mutation:**

1. Make the one-line edit in `src/lib/utils/dashboard-copy.ts`.
2. Run the mutation command, `MUT`:
   `npx vitest run tests/unit/dashboard-copy.test.ts tests/unit/dashboard-header-ssr.test.ts tests/unit/later-list-ssr.test.ts tests/unit/done-list-ssr.test.ts tests/unit/due-card-ssr.test.ts`
3. Confirm that **every** named test FAILS.
4. Revert the edit by hand.

**Do not use `git checkout` to revert.** The file is uncommitted, so `git checkout` would discard the whole implementation.

**Why the component tests matter.** Where a component test is listed, its failure is the proof that the component really calls the helper. Every component's wiring is proven by at least one mutation: the header by M1 and M2, the Later list by M17 and M18, the Done list by M9, M11 and M12, and the Due card by M5.

The test names below are `file > describe > it`. They were verified against the real code.

_`headerEyebrow`:_

- **M1.** `{ weekday: true, year: false }` → `{ weekday: true, year: true }`. Fails:
  - `dashboard-copy.test.ts > headerEyebrow`:
    - "is formatUserDate with a weekday and no year, in every date format";
    - "lets the preference order the fields, and never adds a year to a named month";
  - `dashboard-header-ssr.test.ts > DashboardHeader`: "renders the eyebrow date and dashboardHeaderCopy for …", all five (`due`, `caught-up`, `all-done`, `none-today`, `as-needed-only`).
- **M2.** `{ weekday: true, year: false }` → `{ weekday: false, year: false }`. Fails:
  - all three `headerEyebrow` tests;
  - the same five `dashboard-header-ssr.test.ts` tests.
- **M3.** `formatUserDate(serverNow, tz, dateFormat, …)` → `formatUserDate(serverNow, "UTC", dateFormat, …)`. Fails: `headerEyebrow > names the day in the user's zone, not the server's`.
- **M4.** `formatUserDate(serverNow, tz, dateFormat, …)` → `formatUserDate(serverNow, tz, "DD/MM/YYYY", …)`. Fails: all three `headerEyebrow` tests.

_`tookItAtLabel`:_

- **M5.** ``return `Took it at ${time}`;`` → ``return `Taken at ${time}`;``. Fails:
  - `dashboard-copy.test.ts > tookItAtLabel`:
    - "names the instant Took it at records";
    - "carries an Earlier row's day, because its time arrives already prefixed";
  - `due-card-ssr.test.ts > DueCard`:
    - "Took it at posts the slot's instant as takenAt";
    - "offers Skip only where the row's skipAt is set, even though it posts the slot";
    - "puts Log now first in tab order, then Took it at and Skip, row by row";
    - "names an Earlier row's buttons with its day";
    - "keeps every dose control at least 44px tall, and Log now 48px × 104px".

_`doneDoseText`:_

- **M6.** `dose.quantity > 1` → `dose.quantity >= 1`. Fails: `doneDoseText > is the medication's dose, with no multiplier for a single dose`.
- **M7.** `dose.quantity > 1` → `dose.quantity > 2`. Fails: `doneDoseText > adds ×n to a taken dose of more than one`.
- **M8.** `dose.status === "taken" && dose.quantity > 1 ?` → `dose.quantity > 1 ?`. Fails: `doneDoseText > never shows a quantity on a skipped or missed row`.
- **M9.** `` ` ×${dose.quantity}` `` → `` ` x${dose.quantity}` `` (Latin x). Fails:
  - `doneDoseText > adds ×n to a taken dose of more than one`;
  - `done-list-ssr.test.ts > DoneList > shows a taken dose's time, marker, glyph, name, dose and quantity`.

_`doneCoversLine`:_

- **M10.** `if (covers.length === 0) return null;` → `if (covers.length === 0) return "";`. Fails: `doneCoversLine > is null when the dose resolved no slot beyond its own minute`. DoneList's `{#if}` treats `""` as falsy, so only the helper test can see this.
- **M11.** ``return `for ${times.join(", ")}`;`` → ``return `for ${times.join(" and ")}`;``. Fails:
  - `doneCoversLine`:
    - "lists the slots the dose resolved, prefixing yesterday's";
    - "keeps the order it is given: the composer sorts covers, this only words them";
  - `done-list-ssr.test.ts > DoneList > states which slots a dose covered, with yesterday's prefixed`.
- **M12.** `formatSlotTime(new Date(iso), todayStart, tz, timeFormat)` → `formatUserTime(new Date(iso), tz, timeFormat)`. Fails:
  - `doneCoversLine`:
    - "lists the slots the dose resolved, prefixing yesterday's";
    - "decides 'yesterday' against todayStart, in the user's zone";
  - `done-list-ssr.test.ts > DoneList > states which slots a dose covered, with yesterday's prefixed`.
- **M13.** `formatSlotTime(new Date(iso), todayStart, tz, timeFormat)` → `formatSlotTime(new Date(iso), todayStart, "UTC", timeFormat)`. Fails: `doneCoversLine > decides 'yesterday' against todayStart, in the user's zone`.
- **M14.** `formatSlotTime(new Date(iso), todayStart, tz, timeFormat)` → `formatSlotTime(new Date(iso), todayStart, tz, "24h")`. Fails: `doneCoversLine > follows the 12h preference`.
- **M15.** `const times = covers.map((iso) =>` → `const times = [...covers].sort().map((iso) =>`. Fails: `doneCoversLine > keeps the order it is given: the composer sorts covers, this only words them`.

_`laterUntil`:_

- **M16.** `{ style: "long", maxUnits: 1 }` → `{ style: "long", maxUnits: 2 }`. Fails: `laterUntil > shows one unit, floored, like every duration on the page`.
- **M17.** `{ style: "long", maxUnits: 1 }` → `{ style: "short", maxUnits: 1 }`. Fails:
  - all three `laterUntil` tests;
  - `later-list-ssr.test.ts > LaterList > renders one 40px line per slot: time, hollow marker, glyph, name, dose, and how far off`.
- **M18.** `Date.parse(expectedTime) - serverNow.getTime()` → `Date.parse(expectedTime) - Date.now()`. Fails:
  - `laterUntil > measures from the page's serverNow, never the device clock`, which fails whatever today's date is;
  - the other two `laterUntil` tests;
  - the same `later-list-ssr.test.ts` test as M17.

**After the last revert:**

- `shasum -a 256 src/lib/utils/dashboard-copy.ts` prints the recorded checksum.
- `MUT` passes: `Test Files  5 passed (5)`, `Tests  94 passed (94)`.

- [ ] **Step 11: Run the gates**

- `npx vitest run`, **run it twice**. Expected each time: `Test Files  190 passed (190)` and `Tests  2869 passed (2869)`, which is the baseline 2853 plus 16. Name any failing test.
- `npm run check`. Expected: `0 ERRORS 27 WARNINGS`.
- `npm run lint`. Expected: `✖ 115 problems (0 errors, 115 warnings)`. That is the baseline, and the six changed files lint clean on their own.
- `npm run format:check`. Expected: `All matched files use Prettier code style!`.

- [ ] **Step 12: Commit**

```bash
git add src/lib/utils/dashboard-copy.ts \
  src/lib/components/dashboard/DashboardHeader.svelte \
  src/lib/components/dashboard/LaterList.svelte \
  src/lib/components/dashboard/DoneList.svelte \
  src/lib/components/dashboard/DueCard.svelte \
  tests/unit/dashboard-copy.test.ts
git commit -F - <<'MSG'
refactor(dashboard): move five inline strings into dashboard-copy

DashboardHeader, LaterList, DoneList and DueCard composed the date
eyebrow, "in 3 hours", "for 08:00", "500mg ×2" and "Took it at 09:05"
inline. They now call headerEyebrow, laterUntil, doneCoversLine,
doneDoseText and tookItAtLabel, so the landing-page walkthrough can
render the same strings from the same code and a test can compare them.

Behaviour-neutral: the components' SSR tests pass unedited, and a
mutation of each helper fails both its own test and its component's.
MSG
```

The pre-commit hook runs eslint and prettier. Never use `--no-verify`. Do not push.

#### Notes for the reviewer

- **How this was verified.** The whole task ran in a scratch copy of the worktree at `311758f`, without touching tracked files:
  - every step's expected output above was observed there: 16 failed / 35 passed, then 51 passed, 111 passed, and 94 passed;
  - all 18 mutations failed exactly the tests listed;
  - the full suite ran twice at 190 files / 2869 tests;
  - `check` gave 0 errors / 27 warnings, `lint` 0 errors / 115 warnings, and `format:check` was clean.

  The code blocks above are what prettier prints. Step 6(c)'s wrapped `<span>` is prettier-plugin-svelte's own layout.

- **The spec's DoneList line references are swapped.** Its table gives `doneCoversLine` "DoneList.svelte:68-70" and `doneDoseText` "59-61, 74". In the real file:
  - the `covers` map is 59-61 and `coversText` is 74;
  - the dose text is 68-70.

  This task uses the real lines.

- **The eyebrow is pinned by shape, not spelling.**
  - `headerEyebrow` delegates to the locale. On this Node (ICU 78.3), en-GB prints "Thu 24 Sept", while ICU before 72 prints "Sep". It runs in the viewer's browser.
  - So the test pins `/^Thu 24 Sept?$/` and the exact `formatUserDate` equality, never the literal.
  - The ISO case is exact, "Thu, 2026-09-24", because `isoDate` assembles it per field.
  - **T7 and T8's fidelity tests should do the same:** compare against `headerEyebrow(...)` output, not a quoted date.
- **`tookItAtLabel` takes the formatted `expectedTime`, not `tookItAt`.**
  - `DueCard`'s label is `` `Took it at ${view.time}` ``, where `view.time = formatSlotTime(new Date(row.expectedTime), …)`. The posted `takenAt` is `row.tookItAt`.
  - T7's `StageDueCard` must pass the formatted **slot** time to stay faithful.
- **`laterUntil` is not `relativeTo`.**
  - Under a minute it says "in less than a minute", not "now". That is what LaterList did, and the move keeps it.
  - It is unreachable on the dashboard, because a Later row is always more than an hour ahead.
  - It is deliberately not "unified" with `relativeTo`. That would not be behaviour-neutral.
- **The covers order is the composer's.**
  - `doneCoversLine` formats in the order given, and a test pins it (M15).
  - `toastForLog`, by contrast, sorts its covers itself.
  - Both are as before the move.
- **The `/log` page's day headings stay as they are.** `src/routes/(app)/log/+page.svelte:147` also calls `formatUserDate(…, { weekday: true, year: false })`. That is a different job: a day-group heading rendered from a UTC day key. It is deliberately not routed through `headerEyebrow`, which is the dashboard header's eyebrow only.
- **The device-clock test.** The header assigns no Review Focus test to T1. The `laterUntil` test "measures from the page's serverNow, never the device clock" fakes only `Date`, to 2027-03-01. It is the helper-level half of Review Focus 1, so T7 and T8 can rely on the helpers never reading the visitor's clock.
- **The test file runs under jsdom, its default.**
  - It has no `@vitest-environment` docblock, and adding one is not needed: nothing here imports server code or renders.
  - `vi.useFakeTimers({ toFake: ["Date"] })` is restored in a `finally`, so a failing assertion cannot leak a frozen clock into later tests.

#### Interface notes (deviations from the planning contract)

None. All five contract names and signatures work against the real code as written.

- **`doneDoseText`'s parameter.** It takes a flat `{ dosageAmount, dosageUnit, quantity, status }`. That fits T5's `StageDone.dose` directly. `DoneList` builds it from `dose.medication` plus `dose.quantity`/`dose.status`.
- **Equivalent forms.** The implementations of `laterUntil` and `doneCoversLine` bind one intermediate `const` (`ms`, `times`) for line length. They are equivalent to the contract's one-line forms.

### Task 2: Fix the reminder push and email copy with lastLoggedPhrase

Every overdue reminder in production reads "Last logged 1d ago ago" or "Last logged just now ago". `formatTimeSince` already ends in "ago" (or returns "just now"), and two templates add another " ago":

- the push body (`reminders.ts:202`);
- the email (`email.ts:171`).

This task fixes that. It moves the sentence into one client-safe helper, `lastLoggedPhrase(lastEventAt, now)`, which takes the sweep's own tick instant. It then tests the copy through the real sweep and the real email sender. Today nothing can catch the bug: `reminders.test.ts` records only the push's `tag` and `renotify`, and `email.test.ts` throws away what it sends.

**Review Focus #4 is here:** a real reminder recipient whose last event was moments ago, or never. All five inputs (30s, 5m, 2h 3m, 25h and null) go through the real sweep (push body plus the sender's arguments) and through the real sender (the html handed to Resend).

**Files:**

- Modify: `src/lib/utils/time.ts:1-13`. `formatTimeSince` gains `now`. `lastLoggedPhrase` is added directly below it, before `export type TimeFormat`.
- Modify: `src/lib/server/email.ts`:
  - `:7`: a new import below `import { dev } ...`;
  - `:157-179`: `sendReminderEmail` takes `lastEventAt` and `now`.
- Modify: `src/lib/server/reminders.ts`:
  - `:12`: the import;
  - `:168-170`: `sinceLabel` is deleted;
  - `:190`: the email call;
  - `:201-203`: the push body.
- Test: `tests/unit/time.test.ts`:
  - `:2-12`: the import;
  - `:44-48`: one test appended to `describe("formatTimeSince")`;
  - a new `describe("lastLoggedPhrase")`, inserted before `describe("formatTime"` at `:50`.
- Test: `tests/unit/email.test.ts`:
  - `:3-19`: the Resend mock captures the payload;
  - `:39-42`: the reset;
  - `:88`: the existing call changes to the new signature;
  - `describe("sendReminderEmail copy")` is appended.
- Test: `tests/unit/reminders.test.ts`:
  - `:1`: `afterEach` is imported;
  - `:148` and `:162-166`: the email mock;
  - `:191` and `:197-206`: the push mock;
  - `:363`: the re-pin;
  - a new `describe`, inserted before `:595`.

  The file keeps its bespoke fake, CLAUDE.md's named exception. Do NOT move it to fake-db.

**Interfaces:**

- **Consumes:** nothing from earlier tasks. T2 depends on no other task.
- **Produces** (later tasks rely on these exact signatures):
  - `formatTimeSince(date: Date, now: Date = new Date()): string`, from `$lib/utils/time`.
    - Existing one-argument callers behave as before: `TimeSince.svelte` and `settings/notifications/+page.svelte`.
    - T4 calls it with `DESKTOP_NOW` for `MEDICATIONS[].lastTaken`.
  - `lastLoggedPhrase(lastEventAt: Date | null, now: Date): string`, from `$lib/utils/time`. It returns `"Not yet logged"` for null, else `` `Last logged ${formatTimeSince(lastEventAt, now)}` ``.
    - "just now" therefore yields `"Last logged just now"`.
    - T8 renders the phone banner body with it. T8's fidelity test compares against it.
  - `sendReminderEmail(email: string, medicationName: string, lastEventAt: Date | null, now: Date): Promise<EmailResult>`, from `src/lib/server/email.ts`. The `"never"` sentinel and `sinceLabel` no longer exist.

**Values from running the real code** (probe `tests/unit/zz-probe-plan-T2-sweep.test.ts`, since deleted, against base 311758f):

- **The current sweep sends**, with fake `Date` at 2026-09-24T10:12Z, an interval of `"0.005"` and the last event N before:

  | Last event                     | Push body                     | Email label   |
  | ------------------------------ | ----------------------------- | ------------- |
  | 30s before                     | `"Last logged just now ago"`  | `"just now"`  |
  | 5m before                      | `"Last logged 5m ago ago"`    | `"5m ago"`    |
  | 2h 3m before                   | `"Last logged 2h 3m ago ago"` | `"2h 3m ago"` |
  | 25h before                     | `"Last logged 1d ago ago"`    | `"1d ago"`    |
  | none (a fixed-time 08:00 slot) | `"Not yet logged"`            | `"never"`     |

- **`formatTimeSince` at the boundaries:**

  | Gap                                                         | Output        |
  | ----------------------------------------------------------- | ------------- |
  | 59s                                                         | "just now"    |
  | 60s                                                         | "1m ago"      |
  | 59m                                                         | "59m ago"     |
  | 60m                                                         | "1h 0m ago"   |
  | 23h59m                                                      | "23h 59m ago" |
  | 24h                                                         | "1d ago"      |
  | 25h                                                         | "1d ago"      |
  | 25h7m (the phone banner's gap, 23 Sep 09:05 → 24 Sep 10:12) | "1d ago"      |
  | an anchor 5m in the _future_                                | "just now"    |

  These are integer floors with no ICU, so they are safe to pin literally. The spec lists exactly these bodies as required.

- [ ] **Step 1: Write the failing `formatTimeSince(now)` and `lastLoggedPhrase` tests**

In `tests/unit/time.test.ts`, add `lastLoggedPhrase` to the import. Replace:

```ts
import {
  formatTimeSince,
  formatTime,
```

with:

```ts
import {
  formatTimeSince,
  lastLoggedPhrase,
  formatTime,
```

Then append one test to `describe("formatTimeSince")` and add a new `describe` before `describe("formatTime")`. Replace:

```ts
  it("formats exact hours", () => {
    const oneHourAgo = new Date("2026-04-15T13:30:00Z");
    expect(formatTimeSince(oneHourAgo)).toBe("1h 0m ago");
  });
});

describe("formatTime", () => {
```

with:

```ts
  it("formats exact hours", () => {
    const oneHourAgo = new Date("2026-04-15T13:30:00Z");
    expect(formatTimeSince(oneHourAgo)).toBe("1h 0m ago");
  });

  it("measures from the now it is given, not from the clock", () => {
    // The faked clock says 14:30, which would make this "5m ago". The
    // reminder sweep and the walkthrough each pass their own instant, so the
    // parameter has to win.
    const fiveMinutesBeforeTheClock = new Date("2026-04-15T14:25:00Z");
    const tenMinutesAfterIt = new Date("2026-04-15T14:35:00Z");
    expect(formatTimeSince(fiveMinutesBeforeTheClock, tenMinutesAfterIt)).toBe("10m ago");
  });
});

describe("lastLoggedPhrase", () => {
  // No fake timers, on purpose: every case passes `now`, so a version that
  // fell back to the wall clock would measure from whenever the suite runs
  // and fail all of them.
  const NOW = new Date("2026-09-24T10:12:00.000Z");
  const SECOND = 1_000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const before = (ms: number) => new Date(NOW.getTime() - ms);

  // Each pair straddles one of formatTimeSince's unit boundaries.
  it.each([
    { gap: "59s", ms: 59 * SECOND, expected: "Last logged just now" },
    { gap: "60s", ms: 60 * SECOND, expected: "Last logged 1m ago" },
    { gap: "59m", ms: 59 * MINUTE, expected: "Last logged 59m ago" },
    { gap: "60m", ms: 60 * MINUTE, expected: "Last logged 1h 0m ago" },
    { gap: "23h59m", ms: 23 * HOUR + 59 * MINUTE, expected: "Last logged 23h 59m ago" },
    { gap: "24h", ms: 24 * HOUR, expected: "Last logged 1d ago" },
  ])("$gap before now reads $expected", ({ ms, expected }) => {
    expect(lastLoggedPhrase(before(ms), NOW)).toBe(expected);
  });

  it('reads "Not yet logged" when nothing has ever been logged', () => {
    expect(lastLoggedPhrase(null, NOW)).toBe("Not yet logged");
  });
});

describe("formatTime", () => {
```

- [ ] **Step 2: Run the time tests and watch them fail**

Run: `npx vitest run tests/unit/time.test.ts`

Expected: FAIL, `Tests  8 failed | 33 passed (41)`.

- `formatTimeSince > measures from the now it is given, not from the clock`: `AssertionError: expected '5m ago' to be '10m ago'`. Today's function ignores its second argument.
- The six `lastLoggedPhrase > '59s' before now reads 'Last logged just now'` … `'24h' before now reads 'Last logged 1d ago'` cases, and `reads "Not yet logged" when nothing has ever been logged`: `TypeError: lastLoggedPhrase is not a function`.

- [ ] **Step 3: Give `formatTimeSince` a `now` and add `lastLoggedPhrase`**

In `src/lib/utils/time.ts`, replace:

```ts
export function formatTimeSince(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${diffDays}d ago`;
}
```

with:

```ts
/**
 * "just now", "5m ago", "2h 3m ago" or "1d ago": how long before `now` the
 * instant `date` was. Every result already reads as a complete phrase, so a
 * caller must never append its own "ago".
 *
 * `now` defaults to the wall clock, which is what the live counters want
 * (`TimeSince.svelte` re-renders every minute). A caller that already owns a
 * clock passes it: the reminder sweep decides "overdue" and writes the copy
 * from one tick instant.
 */
export function formatTimeSince(date: Date, now: Date = new Date()): string {
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ${diffMins % 60}m ago`;
  return `${diffDays}d ago`;
}

/**
 * The overdue reminder's "when was this last logged?" sentence: "Last logged
 * 5m ago", "Last logged just now", or "Not yet logged" when nothing ever was.
 * The push body is this string and the email lower-cases its first letter,
 * so the two channels cannot drift apart.
 *
 * It exists because both templates once wrapped `formatTimeSince` in
 * "Last logged … ago" themselves, and every overdue reminder read "Last
 * logged 1d ago ago" or "Last logged just now ago".
 *
 * "Logged", not "taken": the sweep's anchor is the last taken OR skipped dose,
 * so a reminder can follow a skip, and saying the dose was taken would be
 * false.
 *
 * `now` is required, never defaulted, so the sweep's one tick instant decides
 * both that the slot is overdue and how long ago the last event was.
 */
export function lastLoggedPhrase(lastEventAt: Date | null, now: Date): string {
  if (lastEventAt === null) return "Not yet logged";
  return `Last logged ${formatTimeSince(lastEventAt, now)}`;
}
```

- [ ] **Step 4: Run the time tests and watch them pass**

Run: `npx vitest run tests/unit/time.test.ts`

Expected: PASS, `Tests  41 passed (41)`.

- [ ] **Step 5: Write the failing email-copy tests**

In `tests/unit/email.test.ts`, make the Resend mock record what it is handed. Replace:

```ts
let nextSendThrows: Error | null = null;

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async () => {
        if (nextSendThrows) throw nextSendThrows;
        return nextSendResult;
      },
    };
  },
}));
```

with:

```ts
let nextSendThrows: Error | null = null;
// Every payload handed to `resend.emails.send`, so a test can read the html
// the recipient would actually get rather than only the result.
const sentPayloads: Array<{ to: string; subject: string; html: string }> = [];

vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string; subject: string; html: string }) => {
        sentPayloads.push(payload);
        if (nextSendThrows) throw nextSendThrows;
        return nextSendResult;
      },
    };
  },
}));
```

Reset it per test. Replace:

```ts
beforeEach(() => {
  nextSendResult = null;
  nextSendThrows = null;
});
```

with:

```ts
beforeEach(() => {
  nextSendResult = null;
  nextSendThrows = null;
  sentPayloads.length = 0;
});
```

**Move the existing leak test to the new signature, and append the copy tests.**

- _Why the existing test changes:_ `"yesterday"` was a free-text label, and the sender no longer accepts one. It now takes the anchor and the tick and builds the label itself.
- _What it still asserts:_ the same thing. The error message never echoes the recipient or the HTML.

Replace:

```ts
    const r = await sendReminderEmail("victim@example.test", "Aspirin", "yesterday");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain("victim@example.test");
      expect(r.message).not.toContain("<p>");
    }
  });
});
```

with:

```ts
    const r = await sendReminderEmail(
      "victim@example.test",
      "Aspirin",
      new Date("2026-09-23T10:12:00.000Z"),
      new Date("2026-09-24T10:12:00.000Z"),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).not.toContain("victim@example.test");
      expect(r.message).not.toContain("<p>");
    }
  });
});

describe("sendReminderEmail copy", () => {
  // The clause is `lastLoggedPhrase` with its first letter lower-cased. These
  // read the html actually handed to Resend: the template once added its own
  // " ago" to a label that already ended in one.
  const NOW = new Date("2026-09-24T10:12:00.000Z");
  const MINUTE = 60_000;

  it.each([
    { gap: "30 seconds", ms: 30_000, clause: "last logged just now" },
    { gap: "5 minutes", ms: 5 * MINUTE, clause: "last logged 5m ago" },
    { gap: "2 hours 3 minutes", ms: (2 * 60 + 3) * MINUTE, clause: "last logged 2h 3m ago" },
    { gap: "25 hours", ms: 25 * 60 * MINUTE, clause: "last logged 1d ago" },
  ])("$gap after the last event says $clause", async ({ ms, clause }) => {
    nextSendResult = { data: { id: "msg_r" }, error: null };

    const r = await sendReminderEmail(
      "u@example.test",
      "Ibuprofen",
      new Date(NOW.getTime() - ms),
      NOW,
    );

    expect(r).toEqual({ ok: true, id: "msg_r" });
    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].to).toBe("u@example.test");
    // The whole first paragraph, full stop included, so nothing can follow
    // the clause.
    expect(sentPayloads[0].html).toContain(`<p><strong>Ibuprofen</strong> is due — ${clause}.</p>`);
  });

  it('says "not yet logged" when nothing has ever been logged', async () => {
    nextSendResult = { data: { id: "msg_r" }, error: null };

    await sendReminderEmail("u@example.test", "Ibuprofen", null, NOW);

    expect(sentPayloads).toHaveLength(1);
    expect(sentPayloads[0].html).toContain(
      "<p><strong>Ibuprofen</strong> is due — not yet logged.</p>",
    );
  });
});
```

(The dash in both html strings is U+2014, the same character `email.ts` already uses.)

- [ ] **Step 6: Run the email tests and watch them fail**

Run: `npx vitest run tests/unit/email.test.ts`

Expected: FAIL, `Tests  6 failed | 12 passed (18)`.

- `EmailResult mapping > does not echo the recipient or HTML payload in the error message`, and the four `sendReminderEmail copy > '30 seconds' after the last event says 'last logged just now'` … `'25 hours' … 'last logged 1d ago'` cases: `TypeError: s.replace is not a function`. The old body hands the Date to `escHtml`.
- `sendReminderEmail copy > says "not yet logged" when nothing has ever been logged`: `TypeError: Cannot read properties of null (reading 'replace')`.

- [ ] **Step 7: Make `sendReminderEmail` build its clause from `lastLoggedPhrase`**

In `src/lib/server/email.ts`, add the import. Replace:

```ts
import { dev } from "$app/environment";
```

with:

```ts
import { dev } from "$app/environment";
import { lastLoggedPhrase } from "$lib/utils/time";
```

Then replace the whole function:

```ts
export async function sendReminderEmail(
  email: string,
  medicationName: string,
  /**
   * How long since the dose was last HANDLED — taken or skipped — or
   * "never". The caller's anchor counts skips, so the copy below says
   * "logged" rather than "taken": a reminder can follow a skip, and
   * claiming the dose was taken would be false.
   */
  lastLogged: string,
): Promise<EmailResult> {
  // A fixed-time schedule reminds even when nothing was ever logged, so the
  // caller can pass "never" — which does not read as a duration.
  const since =
    lastLogged === "never" ? "not logged yet" : `last logged ${escHtml(lastLogged)} ago`;
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p><strong>${escHtml(medicationName)}</strong> is due — ${since}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
```

with:

```ts
export async function sendReminderEmail(
  email: string,
  medicationName: string,
  /**
   * When the dose was last HANDLED — taken or skipped — or null when nothing
   * ever was (a fixed-time schedule reminds without an anchor).
   */
  lastEventAt: Date | null,
  /** The sweep's tick instant, the same one that found the slot overdue. */
  now: Date,
): Promise<EmailResult> {
  // The push body's sentence, mid-sentence here: "is due — last logged 5m
  // ago." `lastLoggedPhrase` owns the wording, including its "ago", so the
  // template adds nothing after it.
  const phrase = lastLoggedPhrase(lastEventAt, now);
  const since = phrase.charAt(0).toLowerCase() + phrase.slice(1);
  return safeSend({
    from: env.EMAIL_FROM ?? FROM_FALLBACK,
    to: email,
    subject: `Reminder: ${medicationName}`,
    html: `<p><strong>${escHtml(medicationName)}</strong> is due — ${escHtml(since)}.</p>
           <p>Log in to record your dose.</p>`,
  });
}
```

The no-event email changes from "is due — not logged yet." to "is due — not yet logged.", which the spec accepts.

- [ ] **Step 8: Run the email tests and watch them pass**

Run: `npx vitest run tests/unit/email.test.ts`

Expected: PASS, `Tests  18 passed (18)`.

- [ ] **Step 9: Write the failing sweep-copy tests in `reminders.test.ts`**

Keep the bespoke fake. Only the two channel mocks, one pin and one new `describe` change.

**1. Import `afterEach`.** Replace:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
```

with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

**2. Make the email mock record the sender's new arguments.** Replace:

```ts
const sentEmails: Array<{ to: string; medicationName: string; sinceLabel: string }> = [];
```

with:

```ts
// The sender's own arguments: it builds the "last logged" clause itself from
// the anchor and the sweep's tick, so those two instants are what the sweep
// owes it. The html is pinned in email.test.ts.
const sentEmails: Array<{
  to: string;
  medicationName: string;
  lastEventAt: Date | null;
  now: Date;
}> = [];
```

and replace:

```ts
  sendReminderEmail: async (to: string, medicationName: string, sinceLabel: string) => {
    sentEmails.push({ to, medicationName, sinceLabel });
    return emailResults.shift() ?? { ok: true, id: "msg-r" };
  },
```

with:

```ts
  sendReminderEmail: async (
    to: string,
    medicationName: string,
    lastEventAt: Date | null,
    now: Date,
  ) => {
    sentEmails.push({ to, medicationName, lastEventAt, now });
    return emailResults.shift() ?? { ok: true, id: "msg-r" };
  },
```

**3. Make the push mock record `title` and `body`.** Replace:

```ts
const sentPushes: Array<{ userId: string; tag: string; renotify?: boolean }> = [];
```

with:

```ts
// `title` and `body` are recorded so the copy is tested through the real
// sweep. With only `tag` and `renotify` here, the body read "Last logged 1d
// ago ago" in production and nothing could see it.
const sentPushes: Array<{
  userId: string;
  title: string;
  body: string;
  tag: string;
  renotify?: boolean;
}> = [];
```

and replace:

```ts
  sendPushNotification: async (userId: string, payload: { tag: string; renotify?: boolean }) => {
    if (nextSendPushThrows) {
      const err = nextSendPushThrows;
      nextSendPushThrows = null;
      throw err;
    }
    sentPushes.push({ userId, tag: payload.tag, renotify: payload.renotify });
```

with:

```ts
  sendPushNotification: async (
    userId: string,
    payload: { title: string; body: string; tag: string; renotify?: boolean },
  ) => {
    if (nextSendPushThrows) {
      const err = nextSendPushThrows;
      nextSendPushThrows = null;
      throw err;
    }
    sentPushes.push({
      userId,
      title: payload.title,
      body: payload.body,
      tag: payload.tag,
      renotify: payload.renotify,
    });
```

**4. Re-pin `:363`.**

- _Why it changes:_ the old pin said the label the sender received was not the `"never"` sentinel. The sentinel and the label are both deleted.
- _What it still asserts:_ the same claim. A medication with a last event is reported as having one. It now pins that the sender receives the aggregate's own instant, which is non-null. Its test, "still reminds when the last handled dose is older than the interval", keeps its meaning.

Replace:

```ts
expect(sentEmails[0].sinceLabel).not.toBe("never");
```

with:

```ts
// Was `sinceLabel` not "never". The sender no longer takes a label or a
// sentinel: it takes the anchor and builds its own clause. The claim is
// unchanged — a medication WITH a last event is reported as having one,
// and it is the aggregate's instant, not null.
expect(sentEmails[0].lastEventAt).toEqual(lastEventRows[0].lastEventAt);
```

**5. Add the copy cases, driven through the real sweep.** Replace:

```ts
describe("checkLowInventoryMedications — split prefs, mixed channels", () => {
```

with:

```ts
describe("checkOverdueMedications — the 'last logged' copy", () => {
  // These drive the real sweep, so they read the push the real template
  // builds and the arguments the real sender receives. Both templates once
  // appended " ago" to a label that already ended in "ago".
  //
  // Only `Date` is faked: the sweep reads its one tick instant with
  // `new Date()`, and dispatch's send timeout still needs a real setTimeout.
  const NOW = new Date("2026-09-24T10:12:00.000Z");
  const MINUTE = 60_000;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function overdueRow(schedule: Record<string, unknown>): Record<string, unknown> {
    return {
      scheduleId: "s1",
      intervalHours: null,
      timeOfDay: null,
      daysOfWeek: null,
      medicationId: "med-A",
      medicationName: "Ibuprofen",
      userId: "u1",
      userEmail: "user@example.com",
      userEmailVerified: true,
      userTimezone: "UTC",
      userOverdueEmailReminders: true,
      userOverduePushReminders: true,
      userLowInventoryEmailAlerts: true,
      userLowInventoryPushAlerts: false,
      medNotificationsEnabled: true,
      medNotifyOverdueEmail: null,
      medNotifyOverduePush: null,
      medNotifyLowInventoryEmail: null,
      medNotifyLowInventoryPush: null,
      ...schedule,
    };
  }

  it.each([
    { gap: "30 seconds", ms: 30_000, body: "Last logged just now" },
    { gap: "5 minutes", ms: 5 * MINUTE, body: "Last logged 5m ago" },
    { gap: "2 hours 3 minutes", ms: (2 * 60 + 3) * MINUTE, body: "Last logged 2h 3m ago" },
    { gap: "25 hours", ms: 25 * 60 * MINUTE, body: "Last logged 1d ago" },
  ])("a reminder $gap after the last event reads $body", async ({ ms, body }) => {
    // An 18-second interval, so every gap above is overdue and the cases
    // differ only in how long ago the last event was. The form door admits
    // it: `intervalHours` is `z.coerce.number().positive().max(72)`.
    const lastEventAt = new Date(NOW.getTime() - ms);
    scheduleRows.push(overdueRow({ scheduleKind: "interval", intervalHours: "0.005" }));
    lastEventRows.push({ medicationId: "med-A", lastEventAt });

    await checkOverdueMedications();

    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0]).toMatchObject({ title: "Ibuprofen overdue", body });
    expect(sentEmails).toEqual([
      { to: "user@example.com", medicationName: "Ibuprofen", lastEventAt, now: NOW },
    ]);
  });

  it('a reminder for a medication never logged reads "Not yet logged"', async () => {
    // Only a fixed-time slot is overdue with no anchor at all: the interval
    // branch of computeOverdueSlot returns null without one. 08:00 UTC is
    // before NOW and on the same civil day, so the 12-hour cap does not apply.
    scheduleRows.push(overdueRow({ scheduleKind: "fixed_time", timeOfDay: "08:00" }));

    await checkOverdueMedications();

    expect(sentPushes).toHaveLength(1);
    expect(sentPushes[0]).toMatchObject({ title: "Ibuprofen overdue", body: "Not yet logged" });
    expect(sentEmails).toEqual([
      { to: "user@example.com", medicationName: "Ibuprofen", lastEventAt: null, now: NOW },
    ]);
  });
});

describe("checkLowInventoryMedications — split prefs, mixed channels", () => {
```

- [ ] **Step 10: Run the reminder tests and watch them fail**

Run: `npx vitest run tests/unit/reminders.test.ts`

Expected: FAIL, `Tests  6 failed | 20 passed (26)`.

- `checkOverdueMedications — claim/complete with per-channel status > still reminds when the last handled dose is older than the interval`: `AssertionError: expected '8h 0m ago' to deeply equal <the 8-hours-ago Date>`.
- The four `checkOverdueMedications — the 'last logged' copy > a reminder '30 seconds' after the last event reads 'Last logged just now'` … `'25 hours' … 'Last logged 1d ago'` cases: `AssertionError: expected { userId: 'u1', …(4) } to match object { title: 'Ibuprofen overdue', …(1) }`. The diff shows the production bug:

  ```
  -   "body": "Last logged just now",
  +   "body": "Last logged just now ago",
  ```

- `… > a reminder for a medication never logged reads "Not yet logged"`. The push already passes; the email assertion fails with:

  ```
  -     "lastEventAt": null,
  +     "lastEventAt": "never",
  -     "now": 2026-09-24T10:12:00.000Z,
  +     "now": undefined,
  ```

- [ ] **Step 11: Make the sweep word both channels through `lastLoggedPhrase`**

In `src/lib/server/reminders.ts`, swap the import. Replace:

```ts
import { formatTimeSince } from "$lib/utils/time";
```

with:

```ts
import { lastLoggedPhrase } from "$lib/utils/time";
```

**Delete the `"never"` sentinel.** The "logged, not taken" rationale now lives in `lastLoggedPhrase`'s doc comment. Replace:

```ts
// "logged", not "taken": the anchor now counts skips, so a reminder can
// follow a skip and asserting the dose was taken would be false.
const sinceLabel = row.lastEventAt ? formatTimeSince(new Date(row.lastEventAt)) : "never";
```

with:

```ts
// Both channels word this through `lastLoggedPhrase`, from the anchor and
// the same tick `now` that found the slot overdue: one clock per tick.
const lastEventAt = row.lastEventAt ? new Date(row.lastEventAt) : null;
```

Replace:

```ts
out.email = await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);
```

with:

```ts
out.email = await sendReminderEmail(row.userEmail, row.medicationName, lastEventAt, now);
```

Replace:

```ts
            body: row.lastEventAt
              ? `Last logged ${formatTimeSince(new Date(row.lastEventAt))} ago`
              : "Not yet logged",
```

with:

```ts
            body: lastLoggedPhrase(lastEventAt, now),
```

`now` is the existing `const now = new Date();` at `reminders.ts:117`: the same instant `computeOverdueSlot` and `computeNagIndex` already use. The push fields (`title`/`body`/`url`/`tag`) are unchanged; only the body text changes, which the frozen wire format allows.

- [ ] **Step 12: Run all three files and watch them pass**

Run: `npx vitest run tests/unit/reminders.test.ts tests/unit/email.test.ts tests/unit/time.test.ts`

Expected: PASS, `Test Files  3 passed (3)` and `Tests  85 passed (85)`.

- [ ] **Step 13: Prove the tests by mutation**

**How to run each mutation:**

1. Make the one-line edit under **Break**.
2. Run the command, and confirm that every test named under **Must fail** is FAIL.
3. Make the reverse edit under **Restore**.

After all seven, re-run Step 12's command and expect `85 passed`.

**M1 (spec): restore the extra " ago" in the push.**

- **Break,** in `src/lib/server/reminders.ts`: `body: lastLoggedPhrase(lastEventAt, now),` → ``body: `${lastLoggedPhrase(lastEventAt, now)} ago`,``
- **Run:** `npx vitest run tests/unit/reminders.test.ts`
- **Must fail (5):** `checkOverdueMedications — the 'last logged' copy` >
  - `a reminder '30 seconds' after the last event reads 'Last logged just now'`;
  - `… '5 minutes' … 'Last logged 5m ago'`;
  - `… '2 hours 3 minutes' … 'Last logged 2h 3m ago'`;
  - `… '25 hours' … 'Last logged 1d ago'`;
  - `a reminder for a medication never logged reads "Not yet logged"`.
- **Restore:** the reverse edit.

**M2 (spec): restore the extra " ago" in the email.**

- **Break,** in `src/lib/server/email.ts`: `is due — ${escHtml(since)}.</p>` → `is due — ${escHtml(since)} ago.</p>`
- **Run:** `npx vitest run tests/unit/email.test.ts`
- **Must fail (5):** `sendReminderEmail copy` >
  - `'30 seconds' after the last event says 'last logged just now'`;
  - `'5 minutes' … 'last logged 5m ago'`;
  - `'2 hours 3 minutes' … 'last logged 2h 3m ago'`;
  - `'25 hours' … 'last logged 1d ago'`;
  - `says "not yet logged" when nothing has ever been logged`.
- **Restore:** the reverse edit.

**M3: `lastLoggedPhrase` falls back to the wall clock.**

- **Break,** in `src/lib/utils/time.ts`: ``return `Last logged ${formatTimeSince(lastEventAt, now)}`;`` → ``return `Last logged ${formatTimeSince(lastEventAt)}`;``
- **Run:** `npx vitest run tests/unit/time.test.ts tests/unit/email.test.ts tests/unit/reminders.test.ts`
- **Must fail (10):**
  - all six `lastLoggedPhrase > '59s' … '24h'` cases (received e.g. `'Last logged 18d ago'`);
  - the four `sendReminderEmail copy` clause cases.
- **Expected to stay green:** `reminders.test.ts`, which fakes `Date` to `NOW`, so it cannot see this mutation. `time.test.ts` and `email.test.ts` deliberately use no fake timers for exactly this reason.
- **Restore:** the reverse edit.

**M4: `formatTimeSince` ignores its `now`.**

- **Break,** in `src/lib/utils/time.ts`: `const diffMs = now.getTime() - date.getTime();` → `const diffMs = Date.now() - date.getTime();`
- **Run:** `npx vitest run tests/unit/time.test.ts`
- **Must fail (7):**
  - `formatTimeSince > measures from the now it is given, not from the clock` (`expected '5m ago' to be '10m ago'`);
  - the six `lastLoggedPhrase` boundary cases.
- **Restore:** the reverse edit.

**M5: the email stops lower-casing the phrase.**

- **Break,** in `src/lib/server/email.ts`: `const since = phrase.charAt(0).toLowerCase() + phrase.slice(1);` → `const since = phrase;`
- **Run:** `npx vitest run tests/unit/email.test.ts`
- **Must fail (5):** the same five `sendReminderEmail copy` tests as M2.
- **Restore:** the reverse edit.

**M6: the sweep hands the email no anchor.** This guards the re-pin.

- **Break,** in `src/lib/server/reminders.ts`: `sendReminderEmail(row.userEmail, row.medicationName, lastEventAt, now)` → `sendReminderEmail(row.userEmail, row.medicationName, null, now)`
- **Run:** `npx vitest run tests/unit/reminders.test.ts`
- **Must fail (5):**
  - `checkOverdueMedications — claim/complete with per-channel status > still reminds when the last handled dose is older than the interval` (`expected null to deeply equal <Date>`);
  - the four `the 'last logged' copy` interval cases.
- **Restore:** the reverse edit.

**M7: the sweep hands the email a different clock.**

- **Break,** in `src/lib/server/reminders.ts`: `sendReminderEmail(row.userEmail, row.medicationName, lastEventAt, now)` → `sendReminderEmail(row.userEmail, row.medicationName, lastEventAt, new Date(0))`
- **Run:** `npx vitest run tests/unit/reminders.test.ts`
- **Must fail (5):** all five `checkOverdueMedications — the 'last logged' copy` cases.
- **Restore:** the reverse edit.

Record the seven outcomes in the task report.

- [ ] **Step 14: Run the gates**

Run each gate:

- `npx vitest run`, twice.
  - Expected each time: `Test Files  190 passed (190)` and `Tests  2887 passed (2887)`.
  - That is T1's 2869 plus this task's 18 (time +8, email +5, reminders +5). T1 always lands first, and neither task adds a test file.
  - Name any failing test.
- `npm run check`. Expected: `0 ERRORS 27 WARNINGS`.
- `npm run lint`. Expected: `0 errors, 115 warnings`.
- `npm run format:check`. Expected: `All matched files use Prettier code style!`

- [ ] **Step 15: Commit**

```bash
git add src/lib/utils/time.ts src/lib/server/email.ts src/lib/server/reminders.ts tests/unit/time.test.ts tests/unit/email.test.ts tests/unit/reminders.test.ts
git commit -F - <<'EOF'
fix(reminders): stop overdue push and email reading "ago ago"

formatTimeSince already ends in "ago" (or is "just now"), and both the
push body and the reminder email appended another, so every overdue
reminder read "Last logged 1d ago ago" or "Last logged just now ago".

lastLoggedPhrase in utils/time now owns the sentence for both channels,
measured from the sweep's own tick instant: formatTimeSince takes an
optional now for that. sendReminderEmail takes the anchor and that
instant instead of a pre-formatted label and a "never" sentinel, and
lower-cases the phrase mid-sentence. The no-event email now reads "is
due — not yet logged.", matching the push.

The push mock in reminders.test.ts records title and body, and the
email mock records the sender's new arguments, so the copy is tested
through the real sweep. email.test.ts reads the html handed to Resend.

The pin that the email's label was not "never" becomes a pin that the
sender receives the aggregate's instant. The sentinel no longer exists,
and the claim (a medication with a last event is reported as having one)
is unchanged. The leak test's "yesterday" label becomes two instants for
the same reason.
EOF
```

#### Notes for the reviewer

**How this task was validated.**

- I applied every code block, in step order, to a throwaway copy of the worktree in the session scratchpad, with `node_modules` symlinked. Nothing in the worktree was edited.
- Every failure message, pass count, mutation outcome and gate figure quoted above comes from those runs:
  - 190 files and 18 tests above that copy's baseline. The copy was base 311758f without T1, so it read 2871 (2853 + 18). On the real branch T1 has landed, so Step 14 expects 2887 (2869 + 18);
  - `npm run check` 0 errors / 27 warnings;
  - `npm run lint` 0 errors / 115 warnings;
  - prettier clean.
- The pre-change sweep output in the values table came from a throwaway probe in the worktree, since deleted.

**The 18-second interval is a fixture choice.**

- No other schedule reaches "just now" or "5m ago" through the sweep:
  - **Fixed-time:** a slot is satisfied by any event within 1h before it (`FIXED_TIME_TOLERANCE_MS`). So an overdue fixed slot always has an anchor more than 1h old.
  - **Interval:** it fires only once `now − last > interval`.
- The form door's `positive().max(72)` admits `0.005`. Production can therefore send those two bodies, and they must read correctly.
- Using one interval for all four cases makes them differ only in the gap.

**The `now: NOW` assertion has a blind spot.**

- `Date` is faked in the sweep tests, so a second `new Date()` call in `reminders.ts` would also read `NOW`. "Two reads of one frozen clock" is indistinguishable from "one clock".
- M7 proves a _different_ clock is caught. The one-clock-per-tick rule otherwise rests on the code (`now` from `reminders.ts:117`) and on review.

**M3 is invisible to `reminders.test.ts` by construction.** That suite fakes `Date`. `time.test.ts` and `email.test.ts` carry no fake timers so that they catch it, and the comments there say so.

**A future anchor reads "Last logged just now".** That is `formatTimeSince`'s existing behaviour for a negative gap. The sweep can never send it: both branches of `computeOverdueSlot` return null when the anchor is at or after `now`. I did not add a case for it.

**`escHtml(since)` is new and defensive.** The clause holds only digits and fixed words, so the output is byte-identical. Escaping it keeps the template safe if `lastLoggedPhrase` ever gains interpolated text.

**`formatTimeSince` now has an optional second parameter.**

- That would break a point-free `.map(formatTimeSince)`, which would pass the index as `now`.
- No such caller exists. `grep` finds only:
  - `TimeSince.svelte`;
  - `settings/notifications/+page.svelte:350,359`;
  - `reminders.ts`, rewritten here.
- All of them pass one argument.

**`push-payload.test.ts:102-107` is unchanged.**

- Its hand-written "Last logged 3 hours ago" tests only `toNotification`'s pass-through, and is not a template.
- The spec cites it as evidence of the gap, not as something to fix. The sweep tests above are what close the gap.

**Literal pins.**

- The pinned bodies are `formatTimeSince`'s integer-floor outputs, which involve no ICU, and spec Section 3 requires them verbatim.
- No clock string is pinned, so the "no literal clock string" rule is untouched.

**Header Review Focus #4 miscounts.**

- It says "the five `formatTimeSince` branches plus null". `formatTimeSince` has four branches (just now / m / h m / d).
- With null that makes five inputs, which is what spec Section 3 lists and what both the sweep tests and the sender tests cover.

**The contract's push-body expression is computed once.** `lastLoggedPhrase(row.lastEventAt ? new Date(row.lastEventAt) : null, now)` becomes a local `lastEventAt`, shared by both channels. It is the same expression, evaluated once.

**`time.test.ts` coordination with T7.** T7 later removes `formatDueIn` from `time.test.ts`. This task adds `lastLoggedPhrase,` directly after `formatTimeSince,` in the import list, so T7's `  formatDueIn,` anchor stays unique.

### Task 3: Extract a pure foldDoseStatusBreakdown

**Why.** Spec Section 4: the Analytics scene's status bar must be checked against the real per-medication fold, and that check (T4) runs with no database. Today the fold is the body of the async `getDoseStatusBreakdown` in `analytics.ts`, a module that imports `db` at line 2. This task moves the fold, unchanged, into a new module that imports nothing. `getDoseStatusBreakdown` then returns it, and `calculateAdherence`/`calculateOveruse` move with it and are re-exported.

**This is a pure move.** Two things must not change:

- **Arithmetic.** No line of the loop or the return is altered. Step 4 diffs them byte for byte.
- **Existing tests.** No existing test file is edited. The PGlite suite (`tests/unit/pg/analytics-denominator.test.ts`) keeps proving the same rules through the real query, and Step 8 shows it now exercises the moved code.

**Files:**

- Create: `src/lib/server/analytics/status-breakdown.ts`
- Modify: `src/lib/server/analytics.ts`, line numbers at base `311758f`:
  - `:14-15`: add the import;
  - `:165-177`: the two ratio helpers become a re-export;
  - `:335-409`: the doc comment and body of `getDoseStatusBreakdown`.
- Test (create): `tests/unit/analytics-status-breakdown.test.ts`
- Must stay green **unedited**:
  - `tests/unit/analytics.test.ts`
  - `tests/unit/pg/analytics-denominator.test.ts`
  - `tests/unit/pg/export-pdf-breakdown.test.ts`
  - `tests/unit/export-pdf-report.test.ts`
  - `tests/unit/analytics-page-load.test.ts`
  - `tests/unit/analytics-legacy-interval.test.ts`
  - `tests/unit/analytics-lifecycle.test.ts`

**Interfaces:**

- **Consumes:** nothing from earlier tasks. From existing code, the rows `getPerMedicationStats` returns (`analytics.ts:196-333`). They carry `takenEvents`, `takenQuantity`, `skippedEvents` and `expectedTotal` among other fields, so they are structurally assignable to `MedicationStatusCounts`.
- **Produces** (exact, for T4 and anything later):

  ```ts
  // src/lib/server/analytics/status-breakdown.ts — imports nothing
  export type MedicationStatusCounts = {
    takenEvents: number;
    takenQuantity: number;
    skippedEvents: number;
    expectedTotal: number;
  };
  export type DoseStatusBreakdown = {
    takenEvents: number;
    takenQuantity: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
    adherencePercent: number;
    overusePercent: number;
  };
  export function calculateAdherence(taken: number, expected: number): number;
  export function calculateOveruse(taken: number, expected: number): number;
  export function foldDoseStatusBreakdown(
    stats: readonly MedicationStatusCounts[],
  ): DoseStatusBreakdown;
  ```

  - **`$lib/server/analytics` still exports** `calculateAdherence` and `calculateOveruse`, as the same function objects re-exported. `getDoseStatusBreakdown(userId, days, timezone?, filter?)` keeps its signature and now resolves to `DoseStatusBreakdown`, structurally identical to the old inferred type.
  - **Using it from T4.** Import from `$lib/server/analytics/status-breakdown` in a `// @vitest-environment node` test. No `$lib/server/db` mock is needed.
  - **T4's `STATUS_BREAKDOWN` is a subset.** It has `takenEvents`, `skippedEvents`, `missedEvents`, `expectedTotal` and `adherencePercent`, with no `takenQuantity` or `overusePercent`. So T4 compares it against those five fields picked from the fold's output, not the whole object.

**Review Focus:** none of the header's five items is assigned to T3.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/analytics-status-breakdown.test.ts`.

The `vi.mock` factory below **throws**. That is deliberate and is the module-boundary check, and neither alternative would catch the regression:

- **`unusedDb` would not catch it.** It throws only on property access, so a bare import would pass.
- **Importing the real `db` would not catch it either.** Under CI's placeholder `DATABASE_URL`, `neon()` constructs without error.

The factory references no top-level variable, because `vi.mock` is hoisted.

```ts
// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// The fold must stay callable without a database: the landing walkthrough's
// Analytics check feeds it demo figures. This factory THROWS, so if
// `status-breakdown.ts` ever reaches `$lib/server/db` — directly, or through a
// module that does — this file fails to load instead of quietly passing.
vi.mock("$lib/server/db", () => {
  throw new Error("analytics/status-breakdown.ts must not import $lib/server/db");
});

import {
  foldDoseStatusBreakdown,
  type MedicationStatusCounts,
} from "$lib/server/analytics/status-breakdown";

/** One medication's figures; every taken dose is ×1 unless overridden. */
function med(
  takenEvents: number,
  expectedTotal: number,
  overrides: Partial<MedicationStatusCounts> = {},
): MedicationStatusCounts {
  return { takenEvents, takenQuantity: takenEvents, skippedEvents: 0, expectedTotal, ...overrides };
}

/**
 * The pure half of `getDoseStatusBreakdown`. The PGlite suite
 * (`tests/unit/pg/analytics-denominator.test.ts`) proves the same rules
 * through the real query; these pin the arithmetic alone, with every field
 * compared, so a mutation that moves any one of them fails here.
 */
describe("foldDoseStatusBreakdown", () => {
  it("sums missed per medication, so one medication's surplus never settles another's debt", () => {
    // No PRN anywhere. `under` took 5 of 30 and `over` took 55 of 30, so a
    // pooled Σexpected − Σtaken reads 60 − 60 = 0 missed. 25 were missed.
    expect(foldDoseStatusBreakdown([med(5, 30), med(55, 30)])).toEqual({
      takenEvents: 60,
      takenQuantity: 60,
      skippedEvents: 0,
      missedEvents: 25,
      expectedTotal: 60,
      // Credited per medication: min(5, 30) + min(55, 30) = 35 of 60.
      adherencePercent: 58.3,
      // The surplus is visible rather than absorbed: 25 of 60.
      overusePercent: 41.7,
    });
  });

  it("counts a medication's own skips as resolved, not missed", () => {
    // 30 expected, 20 taken and 5 deliberately skipped leaves 5 missed, but
    // skipping is not adherence: the numerator is taken doses only.
    expect(foldDoseStatusBreakdown([med(20, 30, { skippedEvents: 5 })])).toEqual({
      takenEvents: 20,
      takenQuantity: 20,
      skippedEvents: 5,
      missedEvents: 5,
      expectedTotal: 30,
      adherencePercent: 66.7,
      overusePercent: 0,
    });
  });

  it("caps the adherence numerator but measures overuse on the uncapped surplus", () => {
    // Feeding the capped numerator to calculateOveruse would satisfy
    // taken <= expected forever, and export-pdf.ts's `> 0` gate would then
    // delete the overuse line for 45 doses against 30 expected.
    expect(foldDoseStatusBreakdown([med(45, 30)])).toEqual({
      takenEvents: 45,
      takenQuantity: 45,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 30,
      adherencePercent: 100,
      overusePercent: 50,
    });
  });

  it("keeps a PRN medication's doses in the counts and out of every ratio", () => {
    // The PRN medication expects nothing. Its 15 doses (18 units, some ×2)
    // and 2 skips stay in the factual counts, which is what the clinician
    // PDF prints as "Taken events"; they must not settle the scheduled
    // medication's 10 missed doses, and without the `expectedTotal > 0`
    // guard all 15 would read as surplus, i.e. 50% overuse.
    const prn = med(15, 0, { takenQuantity: 18, skippedEvents: 2 });
    expect(foldDoseStatusBreakdown([med(20, 30), prn])).toEqual({
      takenEvents: 35,
      takenQuantity: 38,
      skippedEvents: 2,
      missedEvents: 10,
      expectedTotal: 30,
      adherencePercent: 66.7,
      overusePercent: 0,
    });
  });

  it("lets a medication that expects nothing perturb no ratio on its own", () => {
    // Both ratios keep calculateAdherence/calculateOveruse's
    // "expected === 0 → 0" contract.
    expect(foldDoseStatusBreakdown([med(15, 0)])).toEqual({
      takenEvents: 15,
      takenQuantity: 15,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 0,
      adherencePercent: 0,
      overusePercent: 0,
    });
  });

  it("folds no medications to all zeros", () => {
    expect(foldDoseStatusBreakdown([])).toEqual({
      takenEvents: 0,
      takenQuantity: 0,
      skippedEvents: 0,
      missedEvents: 0,
      expectedTotal: 0,
      adherencePercent: 0,
      overusePercent: 0,
    });
  });
});
```

Every expected value above was produced by running the current `analytics.ts:374-408` loop, verbatim, with the real `calculateAdherence`/`calculateOveruse` (probe, deleted). They match the PGlite suite's own figures for the same shapes (58.3 / 41.7, 66.7, 100 / 50, 10 missed, 50% without the guard).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL, because the module does not exist yet:

```
 FAIL  tests/unit/analytics-status-breakdown.test.ts [ tests/unit/analytics-status-breakdown.test.ts ]
Error: Cannot find module '$lib/server/analytics/status-breakdown' imported from …/tests/unit/analytics-status-breakdown.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 3: Create the pure module**

Create `src/lib/server/analytics/status-breakdown.ts`. The file has three parts:

- **The ratio helpers** are `analytics.ts:165-177`, byte for byte.
- **The loop and the return** are `analytics.ts:374-408`, byte for byte.
- **The doc comment** above the fold keeps the pooling and numerator paragraphs of `analytics.ts:335-363` word for word. The `includeAsNeeded` paragraph stays behind on `getDoseStatusBreakdown` (Step 5), because it is about that function's call, not the arithmetic.

```ts
// The status breakdown's arithmetic, with no database: the per-medication
// fold `getDoseStatusBreakdown` applies to `getPerMedicationStats`' rows, and
// the two ratio helpers it is built on. It lives apart from `analytics.ts` so a
// caller holding figures but no database — the landing walkthrough's
// Analytics check — runs the real fold instead of restating it.
//
// Keep it pure. `tests/unit/analytics-status-breakdown.test.ts` mocks
// `$lib/server/db` to throw, so an import that reaches the database fails
// that suite at load.

/** The fields of one `getPerMedicationStats` row that the fold reads. */
export type MedicationStatusCounts = {
  takenEvents: number;
  takenQuantity: number;
  skippedEvents: number;
  expectedTotal: number;
};

export type DoseStatusBreakdown = {
  takenEvents: number;
  takenQuantity: number;
  skippedEvents: number;
  missedEvents: number;
  expectedTotal: number;
  adherencePercent: number;
  overusePercent: number;
};

// Visual adherence: capped at 100% so the bar never overshoots.
// Use calculateOveruse() for the over-100 overflow.
export function calculateAdherence(taken: number, expected: number): number {
  if (expected === 0) return 0;
  const raw = Math.round((taken / expected) * 1000) / 10;
  return Math.min(100, raw);
}

export function calculateOveruse(taken: number, expected: number): number {
  if (expected === 0) return 0;
  if (taken <= expected) return 0;
  return Math.round(((taken - expected) / expected) * 1000) / 10;
}

/**
 * User-level dose status breakdown — "expected but unresolved", aggregated
 * PER MEDICATION.
 *
 * The three derived values are summed from per-medication terms, never
 * computed once over pooled scalars. Pooling is not a simplification of this,
 * it is a different and wrong quantity: `expectedTotal` deliberately excludes
 * a PRN medication (it expects nothing) while `takenEvents` deliberately
 * includes it (those doses were really taken), so a pooled numerator and a
 * pooled denominator range over different medication sets and subtracting one
 * from the other is meaningless. Measured on the shipped version: a patient
 * who took 20 of 30 scheduled doses and 15 PRN doses was shown "Missed 0,
 * Adherence 100%, Overuse 16.7%" on the clinician PDF, beside the analytics
 * page's own 67% for the same window. It is not only PRN — two ordinary
 * scheduled medications reach it too, one's surplus settling the other's
 * debt, so the clamp has to move inside the sum rather than the PRN
 * medication being filtered out.
 *
 * Adherence takes a numerator capped per medication and overuse an uncapped
 * surplus; they must never share one. A capped numerator fed to
 * `calculateOveruse` satisfies `taken <= expected` unconditionally, so overuse
 * would be permanently 0 and `export-pdf.ts`'s `> 0` gate would delete the
 * line — a medication taken 45 times against 30 expected reporting nothing.
 */
export function foldDoseStatusBreakdown(
  stats: readonly MedicationStatusCounts[],
): DoseStatusBreakdown {
  // Factual event counts, over every medication, never capped or filtered.
  let takenEvents = 0;
  let takenQuantity = 0;
  let skippedEvents = 0;
  let expectedTotal = 0;
  // Per-medication terms. `creditedTaken + missedEvents <= expectedTotal`,
  // with equality when no medication over-resolves.
  let missedEvents = 0;
  let creditedTaken = 0;
  let surplusTaken = 0;

  for (const m of stats) {
    takenEvents += m.takenEvents;
    takenQuantity += m.takenQuantity;
    skippedEvents += m.skippedEvents;
    expectedTotal += m.expectedTotal;
    missedEvents += Math.max(0, m.expectedTotal - m.takenEvents - m.skippedEvents);
    creditedTaken += Math.min(m.takenEvents, m.expectedTotal);
    // The `expectedTotal > 0` guard is what keeps a PRN medication out of
    // the surplus: without it every as-needed dose reads as overuse, which
    // is worse than the pooled figure it replaces.
    surplusTaken += m.expectedTotal > 0 ? Math.max(0, m.takenEvents - m.expectedTotal) : 0;
  }

  return {
    takenEvents,
    takenQuantity,
    skippedEvents,
    missedEvents,
    expectedTotal,
    adherencePercent: calculateAdherence(creditedTaken, expectedTotal),
    // Routed back through calculateOveruse rather than open-coded, so the
    // "expected === 0 → 0" arm and the 0.1% rounding keep one owner.
    overusePercent: calculateOveruse(expectedTotal + surplusTaken, expectedTotal),
  };
}
```

- [ ] **Step 4: Run the new test, and prove the move is verbatim**

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

Then, **before** touching `analytics.ts`, so its line numbers are still the base ones, prove both blocks were copied byte for byte. Both commands must print their marker and no diff lines:

```bash
diff <(sed -n 374,408p src/lib/server/analytics.ts) <(sed -n 70,104p src/lib/server/analytics/status-breakdown.ts) && echo LOOP-VERBATIM
diff <(sed -n 165,177p src/lib/server/analytics.ts) <(sed -n 29,41p src/lib/server/analytics/status-breakdown.ts) && echo RATIOS-VERBATIM
```

Expected: `LOOP-VERBATIM` and `RATIOS-VERBATIM`. T1 and T2 do not touch `analytics.ts`, so these are still the base `311758f` line numbers. If `sed -n 374p` is not the line `  // Factual event counts, over every medication, never capped or filtered.`, find the same block by its content and diff that range instead.

- [ ] **Step 5: Point `analytics.ts` at the module**

Make three replacements in `src/lib/server/analytics.ts`.

**5a: the import (`:14-15`).** `getPerMedicationStats` (`:329-330`) still calls both ratio helpers, so they must be imported, not only re-exported. A bare `export { … } from` would leave both names unbound in this file.

Replace:

```ts
import { clampEffectiveDays, isActiveOn, lifecycleEnd } from "$lib/server/analytics/lifecycle";
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
```

With:

```ts
import { clampEffectiveDays, isActiveOn, lifecycleEnd } from "$lib/server/analytics/lifecycle";
import {
  calculateAdherence,
  calculateOveruse,
  foldDoseStatusBreakdown,
} from "$lib/server/analytics/status-breakdown";
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
```

**5b: the ratio helpers become a re-export (`:165-177`).** Replace:

```ts
// Visual adherence: capped at 100% so the bar never overshoots.
// Use calculateOveruse() for the over-100 overflow.
export function calculateAdherence(taken: number, expected: number): number {
  if (expected === 0) return 0;
  const raw = Math.round((taken / expected) * 1000) / 10;
  return Math.min(100, raw);
}

export function calculateOveruse(taken: number, expected: number): number {
  if (expected === 0) return 0;
  if (taken <= expected) return 0;
  return Math.round(((taken - expected) / expected) * 1000) / 10;
}
```

With:

```ts
// Both ratio helpers live in `analytics/status-breakdown.ts`, beside the fold
// that calls them. `getPerMedicationStats` below calls them too, and the
// re-export keeps every existing `$lib/server/analytics` import working.
export { calculateAdherence, calculateOveruse };
```

**5c: `getDoseStatusBreakdown` returns the fold (`:335-409`).** The `includeAsNeeded` paragraph stays here, reworded only to drop its dangling "therefore", whose antecedent paragraph moved in Step 3. Replace:

```ts
/**
 * User-level dose status breakdown — "expected but unresolved", aggregated
 * PER MEDICATION.
 *
 * The three derived values are summed from per-medication terms, never
 * computed once over pooled scalars. Pooling is not a simplification of this,
 * it is a different and wrong quantity: `expectedTotal` deliberately excludes
 * a PRN medication (it expects nothing) while `takenEvents` deliberately
 * includes it (those doses were really taken), so a pooled numerator and a
 * pooled denominator range over different medication sets and subtracting one
 * from the other is meaningless. Measured on the shipped version: a patient
 * who took 20 of 30 scheduled doses and 15 PRN doses was shown "Missed 0,
 * Adherence 100%, Overuse 16.7%" on the clinician PDF, beside the analytics
 * page's own 67% for the same window. It is not only PRN — two ordinary
 * scheduled medications reach it too, one's surplus settling the other's
 * debt, so the clamp has to move inside the sum rather than the PRN
 * medication being filtered out.
 *
 * `includeAsNeeded: true` therefore stays. A medication expecting nothing now
 * contributes 0 to every term by construction, so it cannot perturb a ratio,
 * while its doses stay in the honest counts. Flipping the flag would fix the
 * ratios by deleting real doses from the PDF's "Taken events" line instead.
 *
 * Adherence takes a numerator capped per medication and overuse an uncapped
 * surplus; they must never share one. A capped numerator fed to
 * `calculateOveruse` satisfies `taken <= expected` unconditionally, so overuse
 * would be permanently 0 and `export-pdf.ts`'s `> 0` gate would delete the
 * line — a medication taken 45 times against 30 expected reporting nothing.
 */
export async function getDoseStatusBreakdown(
  userId: string,
  days: number,
  timezone: string = "UTC",
  filter?: AnalyticsFilter,
) {
  const stats = await getPerMedicationStats(userId, days, timezone, filter, {
    includeAsNeeded: true,
  });

  // Factual event counts, over every medication, never capped or filtered.
  let takenEvents = 0;
  let takenQuantity = 0;
  let skippedEvents = 0;
  let expectedTotal = 0;
  // Per-medication terms. `creditedTaken + missedEvents <= expectedTotal`,
  // with equality when no medication over-resolves.
  let missedEvents = 0;
  let creditedTaken = 0;
  let surplusTaken = 0;

  for (const m of stats) {
    takenEvents += m.takenEvents;
    takenQuantity += m.takenQuantity;
    skippedEvents += m.skippedEvents;
    expectedTotal += m.expectedTotal;
    missedEvents += Math.max(0, m.expectedTotal - m.takenEvents - m.skippedEvents);
    creditedTaken += Math.min(m.takenEvents, m.expectedTotal);
    // The `expectedTotal > 0` guard is what keeps a PRN medication out of
    // the surplus: without it every as-needed dose reads as overuse, which
    // is worse than the pooled figure it replaces.
    surplusTaken += m.expectedTotal > 0 ? Math.max(0, m.takenEvents - m.expectedTotal) : 0;
  }

  return {
    takenEvents,
    takenQuantity,
    skippedEvents,
    missedEvents,
    expectedTotal,
    adherencePercent: calculateAdherence(creditedTaken, expectedTotal),
    // Routed back through calculateOveruse rather than open-coded, so the
    // "expected === 0 → 0" arm and the 0.1% rounding keep one owner.
    overusePercent: calculateOveruse(expectedTotal + surplusTaken, expectedTotal),
  };
}
```

With:

```ts
/**
 * User-level dose status breakdown — "expected but unresolved", aggregated
 * PER MEDICATION by `foldDoseStatusBreakdown` (`analytics/status-breakdown.ts`),
 * which says why pooling first is a different and wrong quantity.
 *
 * `includeAsNeeded: true` stays, because the fold makes it safe. A medication
 * expecting nothing contributes 0 to every term by construction, so it cannot
 * perturb a ratio, while its doses stay in the honest counts. Flipping the flag
 * would fix the ratios by deleting real doses from the PDF's "Taken events"
 * line instead.
 */
export async function getDoseStatusBreakdown(
  userId: string,
  days: number,
  timezone: string = "UTC",
  filter?: AnalyticsFilter,
) {
  const stats = await getPerMedicationStats(userId, days, timezone, filter, {
    includeAsNeeded: true,
  });
  return foldDoseStatusBreakdown(stats);
}
```

- [ ] **Step 6: Run every analytics suite, and confirm none was edited**

Run:

```bash
npx vitest run tests/unit/analytics-status-breakdown.test.ts tests/unit/analytics.test.ts tests/unit/pg/analytics-denominator.test.ts tests/unit/pg/export-pdf-breakdown.test.ts tests/unit/export-pdf-report.test.ts tests/unit/analytics-page-load.test.ts tests/unit/analytics-legacy-interval.test.ts tests/unit/analytics-lifecycle.test.ts
```

Expected: PASS, `Test Files  8 passed (8)` and `Tests  150 passed (150)`. The seven existing files are 144 tests at base `311758f`; the new file adds 6.

- `analytics.test.ts` still imports `calculateAdherence`/`calculateOveruse` from `$lib/server/analytics`, which proves the re-export.
- The PGlite suite still drives `getDoseStatusBreakdown` end to end.

Then run `git status --short -- src/lib/server tests`.

Expected: exactly these three lines. No existing test file appears.

```
 M src/lib/server/analytics.ts
?? src/lib/server/analytics/status-breakdown.ts
?? tests/unit/analytics-status-breakdown.test.ts
```

- [ ] **Step 7: Stage the change, so each mutation can be undone exactly**

```bash
git add src/lib/server/analytics/status-breakdown.ts src/lib/server/analytics.ts tests/unit/analytics-status-breakdown.test.ts
```

Each mutation below edits the working tree only. `git checkout -- <file>` then restores the staged version byte for byte, and `git diff --quiet -- <file> && echo restored` confirms it.

- [ ] **Step 8: Mutation 1. Pool missed as Σexpected − Σtaken**

In `src/lib/server/analytics/status-breakdown.ts`, in the returned object, change the line `    missedEvents,` to:

```ts
    missedEvents: expectedTotal - takenEvents,
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts tests/unit/pg/analytics-denominator.test.ts`

Expected: FAIL, `Tests  11 failed | 15 passed (26)`.

- **In the new file, five tests fail:**
  - `sums missed per medication, so one medication's surplus never settles another's debt` (`missedEvents` 0, expected 25);
  - `counts a medication's own skips as resolved, not missed` (10, expected 5);
  - `caps the adherence numerator but measures overuse on the uncapped surplus` (−15, expected 0);
  - `keeps a PRN medication's doses in the counts and out of every ratio` (−5, expected 10);
  - `lets a medication that expects nothing perturb no ratio on its own` (−15, expected 0).
- **In `pg/analytics-denominator.test.ts`, six tests under `the status breakdown aggregates per medication` fail.** That proves `getDoseStatusBreakdown` really delegates to the moved fold:
  - `counts a scheduled medication's own skipped doses as resolved, not missed`;
  - `does not let a PRN medication's doses erase another medication's misses`;
  - `does the same when the PRN medication has no schedule rows at all`;
  - `does not let one scheduled medication's overuse erase another's misses` (`expected +0 to be 25`);
  - `still reports a single medication's genuine overuse`;
  - `lets a medication that expects nothing perturb no ratio at all`.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 9: Mutation 2. Drop the `expectedTotal > 0` surplus guard**

Change:

```ts
surplusTaken += m.expectedTotal > 0 ? Math.max(0, m.takenEvents - m.expectedTotal) : 0;
```

to:

```ts
surplusTaken += Math.max(0, m.takenEvents - m.expectedTotal);
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL, `Tests  1 failed | 5 passed (6)`. The failing test is `keeps a PRN medication's doses in the counts and out of every ratio`, with this diff:

```
-   "overusePercent": 0,
+   "overusePercent": 50,
```

The PGlite suite's two PRN cases fail too, if it is added to the command.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 10: Mutation 3. Feed overuse the capped numerator**

Change:

```ts
    overusePercent: calculateOveruse(expectedTotal + surplusTaken, expectedTotal),
```

to:

```ts
    overusePercent: calculateOveruse(creditedTaken, expectedTotal),
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL, `Tests  2 failed | 4 passed (6)`:

- `sums missed per medication, so one medication's surplus never settles another's debt`: `overusePercent` 0, expected 41.7;
- `caps the adherence numerator but measures overuse on the uncapped surplus`: 0, expected 50.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 11: Mutation 4. Feed adherence the pooled, uncapped numerator**

Change:

```ts
    adherencePercent: calculateAdherence(creditedTaken, expectedTotal),
```

to:

```ts
    adherencePercent: calculateAdherence(takenEvents, expectedTotal),
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL, `Tests  2 failed | 4 passed (6)`:

- `sums missed per medication, so one medication's surplus never settles another's debt`: `adherencePercent` 100, expected 58.3;
- `keeps a PRN medication's doses in the counts and out of every ratio`: 100, expected 66.7.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 12: Mutation 5. Stop counting a medication's own skips as resolved**

Change:

```ts
missedEvents += Math.max(0, m.expectedTotal - m.takenEvents - m.skippedEvents);
```

to:

```ts
missedEvents += Math.max(0, m.expectedTotal - m.takenEvents);
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL, `Tests  1 failed | 5 passed (6)`. The failing test is `counts a medication's own skips as resolved, not missed`: `missedEvents` 10, expected 5.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 13: Mutation 6. Let the pure module reach the database**

Insert these two lines at the very top of `src/lib/server/analytics/status-breakdown.ts`. `schedules.ts` imports `db` at its line 3, so this is a transitive reach.

```ts
import { getSchedulesForUser } from "$lib/server/schedules";
export const loadSchedules = getSchedulesForUser;
```

Run: `npx vitest run tests/unit/analytics-status-breakdown.test.ts`

Expected: FAIL. The suite cannot load, so none of its six tests runs:

```
 FAIL  tests/unit/analytics-status-breakdown.test.ts [ tests/unit/analytics-status-breakdown.test.ts ]
Error: [vitest] There was an error when mocking a module. …
 ❯ src/lib/server/schedules.ts:3:1
Caused by: Error: analytics/status-breakdown.ts must not import $lib/server/db
 Test Files  1 failed (1)
      Tests  no tests
```

**Why the mutation uses the import.** An import that is never used, such as a bare `import { db } from "$lib/server/db";`, is erased by the TypeScript transform and does not trip the mock. That is correct: it loads no database at runtime either, so T4's test would still work.

Restore: `git checkout -- src/lib/server/analytics/status-breakdown.ts && git diff --quiet -- src/lib/server/analytics/status-breakdown.ts && echo restored`

- [ ] **Step 14: Run the gates**

Run each from the worktree root:

```bash
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **Both `vitest` runs** pass, with one more file and six more tests than at the start of this task. After T1 and T2 the suite starts this task at `190` files and `2887` tests (base 2853, plus T1's 16, plus T2's 18; neither adds a file). So each run ends with `Test Files  191 passed (191)` and `Tests  2893 passed (2893)`. Name any failing test.
- **`npm run check`:** `0 ERRORS`, with warnings ≤ 27 (exactly 27 measured on base + T3). `page-data.ts`'s `Resolved<typeof getDoseStatusBreakdown>` now resolves to `DoseStatusBreakdown` with no error.
- **`npm run lint`:** `0 errors`, with warnings ≤ 115 (exactly 115 measured; the three touched files add none).
- **`npm run format:check`:** `All matched files use Prettier code style!`

- [ ] **Step 15: Commit**

```bash
git add src/lib/server/analytics/status-breakdown.ts src/lib/server/analytics.ts tests/unit/analytics-status-breakdown.test.ts
git commit -F - <<'EOF'
refactor(analytics): move the status breakdown fold into a pure module

getDoseStatusBreakdown's per-medication fold moves, unchanged, into
analytics/status-breakdown.ts as foldDoseStatusBreakdown, beside
calculateAdherence and calculateOveruse. The module imports nothing, so
a caller holding figures but no database can run the real fold; the
landing walkthrough's Analytics check is the first.

analytics.ts re-exports both ratio helpers, and getDoseStatusBreakdown
returns the fold, so every existing import and test is unchanged. The
new node test pins missed-per-medication, the capped adherence
numerator, the uncapped overuse surplus and the PRN surplus guard, and
mocks the database to throw so the module cannot quietly grow a db
import.
EOF
git status --short
```

Expected: the commit succeeds. The pre-commit hook runs `eslint --fix` and `prettier --write` on the three staged files and changes nothing. `git status --short` then prints nothing for these paths. Never use `--no-verify`.

#### Notes for the reviewer

- **Probes run against the real code:**
  - A throwaway `tests/unit/zz-probe-plan-T3-values.test.ts` (deleted) ran a verbatim copy of `analytics.ts:374-408` with the real `calculateAdherence`/`calculateOveruse`. It produced every expected object in Step 1 and every mutated value quoted in Steps 8–12.
  - The whole task was then executed in a scratch export of `311758f` (`git archive` plus a `node_modules` symlink, outside the worktree):
    - Step 2's message;
    - 6/6 green;
    - the two `LOOP-VERBATIM`/`RATIOS-VERBATIM` diffs;
    - 150/150 on the eight analytics files, against 144/144 for the seven at base;
    - all six mutations, with the failing names quoted;
    - `vitest` 191 files / 2859 tests. That export had T3 alone, without T1 and T2, so it is 2853 + 6. In plan order T1 and T2 add 34 tests and no files first, which is why Step 14 expects 191 files / 2893 tests;
    - `check` 0 errors / 27 warnings;
    - `lint` 0 errors / 115 warnings;
    - `format:check` clean.
- **The import form in Step 5a is a deliberate deviation from the contract's literal statement** (see CONTRACT ISSUES). It uses `import { … }` plus `export { calculateAdherence, calculateOveruse };` with a `$lib/server/analytics/…` specifier, matching the `lifecycle` import on the line above.
- **The doc comment is split, which is a judgement call.**
  - **What moved:** the "pooling is a different and wrong quantity" and "never share one numerator" paragraphs move word for word with the code they explain. T4's implementer lands on `status-breakdown.ts`, not `analytics.ts`.
  - **What stayed:** the `includeAsNeeded: true` paragraph is about `getDoseStatusBreakdown`'s query, so it stays there. Its opening "therefore stays" became "stays, because the fold makes it safe", because the paragraph that "therefore" pointed back to now lives in another file.
  - **Code and comment:** no code comment inside the loop or the return changed.
- **The line references in the contract and spec are slightly off.** The contract says the loop and return are `analytics.ts:375-406`, and the spec says `:373-397`. At `311758f` they are `:374-408`, which Step 4's diff pins.
- **The boundary check is a throwing `vi.mock` factory, not a source regex.**
  - **What it catches:** transitive reaches (Mutation 6 goes through `schedules.ts`), which a regex over the file would miss.
  - **What it lets through, correctly:** an import erased because nothing uses it loads nothing, so T4 is unaffected.
  - **Why it is needed:** under CI's placeholder `DATABASE_URL` a real `db` import would not throw on its own, so without the mock this regression would be silent.
- **Delegation is proven behaviourally, not by a source scan.** Mutation 1 fails six PGlite tests that call `getDoseStatusBreakdown` through the real query. So the moved fold is demonstrably the code production runs, not a copy beside it.
- **The new test file is not in the header's File Structure**, which lists for T3 only "analytics tests, only if a re-export needs it". A new file is the natural home for the fold's own test, and no existing test is edited.
- **No identity test pins `$lib/server/analytics`'s `calculateAdherence` to the moved function.** Two cases are already caught:
  - **A local copy alongside the re-export** fails `npm run check`, measured: "Import declaration conflicts with local declaration of 'calculateAdherence'".
  - **A missing re-export** fails `analytics.test.ts`.

  The gap is a deliberate swap of the re-export for a local copy, which nothing would catch. That seemed too unlikely to justify importing `analytics.ts` (and so needing a db mock) in the new file.

- **CLAUDE.md is not edited.** Its `getDoseStatusBreakdown` bullet ("aggregates PER MEDICATION", the clamp inside the sum, `includeAsNeeded: true` stays, the two numerators) is still true word for word. T10 may name the new module there if it wants a pointer, but nothing is false without it.
- **PGlite is installed** at `../../../node_modules/@electric-sql/pglite`, so the `tests/unit/pg/` files in Steps 6 and 8 run here rather than skipping.

#### Interface notes (deviations from the planning contract)

- **The contract's re-export statement alone does not compile.** The contract gives `export { calculateAdherence, calculateOveruse } from "./analytics/status-breakdown";` as the whole change. A re-export-from does not bind the names inside `analytics.ts`, but `getPerMedicationStats` calls both at `analytics.ts:329-330`. On its own the statement fails `npm run check` (measured in the scratch export: 2 errors, "Cannot find name 'calculateAdherence'." and "Cannot find name 'calculateOveruse'.").
- **What the task uses instead** (Step 5a/5b) is an `import { calculateAdherence, calculateOveruse, foldDoseStatusBreakdown } from "$lib/server/analytics/status-breakdown";` plus `export { calculateAdherence, calculateOveruse };`.
- **What is unchanged:** every exported name, every type and every import path a consumer uses.

### Task 4: One demo dose list, schedules and story clocks; fix History order, Security dates and the Analytics bar

The walkthrough's demo facts become one list of instants. Every hand-written string that claims something about a dose is held to that list by a node test:

- the History scene's Today and Yesterday rows;
- the Medications scene's "Last taken" timers;
- the Security scene's session expiry dates;
- the Analytics scene's Dose Status Breakdown.

`demo-data.ts` gains these exports, which Task 5 builds the dashboard moments from:

- the two story clocks, `WALKTHROUGH_TZ` and `DEMO_STARTED_AT`;
- each medication's seeded schedule;
- `DEMO_DOSES` and `LOGGED_DOSE`.

The task also fixes three false details (spec Section 4):

- History's Yesterday group is drawn newest first.
- Security's expiry dates go through `formatUserDate`, so they read "22 Oct 2026".
- The Analytics bar shows the real per-medication fold: Taken 602 · Skipped 0 · Missed 118 · 720 expected, where it showed Skipped 113 · Missed 0 · 715 expected.

**One change lands outside the walkthrough.** `src/lib/components/StatusBreakdownBar.svelte`, the shipped analytics card, gains a `<script module>` exporting `statusBreakdownSegments`. Its segment rule moves there, so AnalyticsScene draws the bar by the card's own rule without mounting the card's `<h2>`. The card's markup does not change, and Step 10 proves it byte-identical. A reviewer scoping the PR must include this file. CONTRACT ISSUES 1 gives the exact line the plan header's File Structure needs for it.

**Prerequisite:** Tasks 1–3 are committed. This task uses Task 3's pure fold and Task 2's `formatTimeSince(date, now)`.

**Files:**

- Modify: `src/lib/components/walkthrough/demo-data.ts`
  - :1-29: the header comment, the import, and the `DemoMedication` type. The story-clock constants and `DemoSchedule` are added here.
  - :31-113: `MEDICATIONS`. One `schedule:` line is added per medication.
  - :122-196: the History section. `HISTORY_DAYS` moves up, `HISTORY.expected` and its `+3` term are removed, and `STATUS_BREAKDOWN` is added after `HISTORY`.
  - Before :258 (`// ── Dose history ──`): a new Doses section with `DemoDose`, `DEMO_DOSES` and `LOGGED_DOSE`.
  - :270-283: `LOG_ALL`, with Yesterday newest first.
  - :307-311: `storyClock` uses `WALKTHROUGH_TZ`. A new Security section with `SESSION_EXPIRIES` follows it.
- Modify: `src/lib/components/StatusBreakdownBar.svelte:1-17`, a shipped analytics component outside the walkthrough. The segment rule moves into an exported `statusBreakdownSegments` in a `<script module>`, and the markup is unchanged (Step 10). The header's File Structure → Modify list must carry this file; CONTRACT ISSUES 1 gives the line.
- Modify: `src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`
  - :5-26: the imports and the old pooled arithmetic.
  - :173-189: the Dose Status Breakdown card.
- Modify: `src/lib/components/walkthrough/scenes/SecurityScene.svelte:3-11`
- Create: `tests/unit/walkthrough-demo-facts.test.ts`
- Test (verify only, no edit): `tests/unit/walkthrough-timeline.test.ts`. No pin moves:
  - `HISTORY.total` stays 602 and `HISTORY.averageAdherence` stays 84, because the PRNG draw order is untouched.
  - No test reads the deleted `HISTORY.expected`.

**Interfaces:**

- Consumes:
  - From Task 3 (`src/lib/server/analytics/status-breakdown.ts`, no db import):
    ```ts
    export type MedicationStatusCounts = {
      takenEvents: number;
      takenQuantity: number;
      skippedEvents: number;
      expectedTotal: number;
    };
    export function foldDoseStatusBreakdown(
      stats: readonly MedicationStatusCounts[],
    ): DoseStatusBreakdown;
    ```
  - From Task 2 (`src/lib/utils/time.ts`): `formatTimeSince(date: Date, now: Date = new Date()): string`.
  - Existing, unchanged:
    - `expectedPerDayForSchedules(schedules: MedicationSchedule[]): number` (`$lib/server/analytics`);
    - `clampEffectiveDays(rangeFrom, rangeTo, startedAt, endedAt): number` (`$lib/server/analytics/lifecycle`);
    - `formatUserDate`, `formatUserTime`, `isoDayKey` and `shiftDayKey` (`$lib/utils/time`).
- Produces, from `src/lib/components/walkthrough/demo-data.ts`. Tasks 5, 7 and 8 rely on these exactly:

  ```ts
  export const WALKTHROUGH_TZ = "UTC";
  export const DESKTOP_NOW = new Date("2026-09-24T08:02:00.000Z");
  export const PHONE_NOW = new Date("2026-09-24T10:12:00.000Z");
  export const DEMO_STARTED_AT: Date; // DESKTOP_NOW − 90 × 86_400_000 = 2026-06-26T08:02:00.000Z
  export type DemoSchedule =
    | { kind: "interval"; intervalHours: string }
    | { kind: "fixed_time"; timesOfDay: string[] };
  // DemoMedication gains `schedule: DemoSchedule`:
  //   vitd interval "24", lis fixed_time ["08:00"], met interval "12",
  //   ibu interval "8", mag interval "24".
  export type DemoDose = {
    id: string;
    medicationId: MedicationId;
    takenAt: Date;
    quantity: number;
    status: "taken" | "skipped";
  };
  export const DEMO_DOSES: readonly DemoDose[]; // 10 doses, oldest first (below)
  export const LOGGED_DOSE: {
    readonly desktop: "dose-lis-20260924-0802";
    readonly phone: "dose-vitd-20260924-1012";
  };
  export const SESSION_EXPIRIES: readonly Date[]; // 2026-10-22T08:00Z, 2026-10-15T20:30Z
  export const STATUS_BREAKDOWN: {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
    adherencePercent: number;
  }; // { 602, 0, 118, 720, 83.6 }
  ```

  - `DEMO_DOSES` has 10 doses, all quantity 1 and status `"taken"`:
    - 23 Sep: lis 08:01, vitd 09:05, ibu 14:12, met 19:51, mag 22:05, ibu 22:14;
    - 24 Sep: ibu 06:10, met 07:48, lis 08:02 (`LOGGED_DOSE.desktop`) and vitd 10:12 (`LOGGED_DOSE.phone`).
  - Each id is `dose-<medId>-<yyyymmdd>-<hhmm>` of its own UTC instant.
  - From `src/lib/components/StatusBreakdownBar.svelte`, in its `<script module>`:
    `export function statusBreakdownSegments(counts: { takenEvents: number; skippedEvents: number; missedEvents: number }): { takenPct: number; skippedPct: number; missedPct: number }`.
  - **Removed:** `HISTORY.expected`. Its only reader was AnalyticsScene.

**Values the real code returns** (all from the probes below). The test pins none of the clock strings.

| Value                                                                                      | Result                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Per-medication `HISTORY.perMedication` taken / expected                                    | vitd 80/90, lis 88/90, met 161/180, ibu 198/270, mag 75/90                                                     |
| Sums                                                                                       | 602 taken, 720 expected                                                                                        |
| `clampEffectiveDays(DESKTOP_NOW − 90d, DESKTOP_NOW, DEMO_STARTED_AT, null)`                | 90                                                                                                             |
| The fold                                                                                   | missed 118, `adherencePercent` 83.6 (`calculateAdherence(602, 720)`)                                           |
| `StatusBreakdownBar` widths for 602/0/118                                                  | `bg-success` "83.6%" and `bg-danger` "16.400000000000006%". The skipped segment is omitted                     |
| Legend                                                                                     | "Taken 602", "Skipped 0", "Missed 118", "720 expected"                                                         |
| `formatUserDate(…, "UTC", "DD/MM/YYYY")`                                                   | "22 Oct 2026" and "15 Oct 2026"                                                                                |
| Every hand-written `LOG_ALL` `since` and every `MEDICATIONS[].lastTaken` / `lastTakenNext` | Equals `formatTimeSince` at `DESKTOP_NOW` / `DESKTOP_NOW + 60s`. Nothing there changes, only Yesterday's order |

- [ ] **Step 0: Confirm the prerequisites and record the baselines**

Run:

```bash
grep -n "export function foldDoseStatusBreakdown" src/lib/server/analytics/status-breakdown.ts
grep -n "export function formatTimeSince(date: Date, now" src/lib/utils/time.ts
```

Expected: one line from each. If either is missing, stop: Task 2 or Task 3 has not landed.

Run: `npx vitest run 2>&1 | tail -4`
Expected: everything passes. Note the file and test counts Task 3 ended on, because this task adds exactly 1 file and 10 tests.

Run: `npm run check 2>&1 | tail -2`
Expected: `0 errors` and no more than 27 warnings. Note the count; this task must not add to it.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/walkthrough-demo-facts.test.ts`:

```ts
// @vitest-environment node
//
// The walkthrough's demo facts against the one dose list (`DEMO_DOSES`) and
// against the real code that computes each fact in the app. The scenes'
// strings stay hand-written where the spec keeps them so, and this file is
// what stops them drifting from the instants and the analytics fold.
//
// `node` is load-bearing: the suite default is jsdom, under which `render()`
// from `svelte/server` throws before an assertion runs (see
// tests/unit/error-page-ssr.test.ts).
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";

// analytics.ts imports `db` for its queries; this file calls only its pure
// `expectedPerDayForSchedules`. unusedDb THROWS on any access, so an
// accidental query fails loudly. Do not "upgrade" it to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

import { expectedPerDayForSchedules } from "$lib/server/analytics";
import { clampEffectiveDays } from "$lib/server/analytics/lifecycle";
import {
  foldDoseStatusBreakdown,
  type MedicationStatusCounts,
} from "$lib/server/analytics/status-breakdown";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  formatTimeSince,
  formatUserDate,
  formatUserTime,
  isoDayKey,
  shiftDayKey,
} from "$lib/utils/time";
import {
  DEMO_DOSES,
  DEMO_STARTED_AT,
  DESKTOP_NOW,
  HISTORY,
  LOGGED_DOSE,
  LOG_ALL,
  MEDICATIONS,
  PHONE_NOW,
  SESSION_EXPIRIES,
  STATUS_BREAKDOWN,
  WALKTHROUGH_TZ,
  storyClock,
  type DemoDose,
  type DemoMedication,
} from "$lib/components/walkthrough/demo-data";
import AnalyticsScene from "$lib/components/walkthrough/scenes/AnalyticsScene.svelte";
import SecurityScene from "$lib/components/walkthrough/scenes/SecurityScene.svelte";
import StatusBreakdownBar from "$lib/components/StatusBreakdownBar.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

/** A medication's DemoSchedule as the medication_schedules rows seed-demo.ts writes. */
function scheduleRows(m: DemoMedication): MedicationSchedule[] {
  const base = {
    medicationId: m.id,
    userId: "demo",
    daysOfWeek: null,
    effectiveFrom: DEMO_STARTED_AT,
    effectiveTo: null,
    createdAt: DEMO_STARTED_AT,
  };
  if (m.schedule.kind === "interval") {
    return [
      {
        ...base,
        id: `${m.id}-0`,
        scheduleKind: "interval",
        timeOfDay: null,
        intervalHours: m.schedule.intervalHours,
        sortOrder: 0,
      },
    ];
  }
  return m.schedule.timesOfDay.map(
    (timeOfDay, i): MedicationSchedule => ({
      ...base,
      id: `${m.id}-${i}`,
      scheduleKind: "fixed_time",
      timeOfDay,
      intervalHours: null,
      sortOrder: i,
    }),
  );
}

/** The Dose Status Breakdown card under its title: the bar's segments, then the legend. */
function breakdownOf(doc: Document) {
  const title = [...doc.querySelectorAll("h2, p")].find(
    (el) => textOf(el) === "Dose Status Breakdown",
  );
  if (!title?.nextElementSibling) throw new Error("no Dose Status Breakdown card");
  const [bar, legend] = title.nextElementSibling.children;
  return {
    segments: [...bar.children].map((el) => ({
      fill: [...el.classList].find((c) => c.startsWith("bg-")),
      width: (el as HTMLElement).style.width,
    })),
    legend: [...legend.children].map(textOf),
  };
}

describe("DEMO_DOSES", () => {
  it("ids each dose dose-<med>-<yyyymmdd>-<hhmm> from its own instant, uniquely", () => {
    for (const dose of DEMO_DOSES) {
      const iso = dose.takenAt.toISOString();
      const stamp = `${iso.slice(0, 10).replace(/-/g, "")}-${iso.slice(11, 16).replace(":", "")}`;
      expect(dose.id).toBe(`dose-${dose.medicationId}-${stamp}`);
    }
    expect(new Set(DEMO_DOSES.map((d) => d.id)).size).toBe(DEMO_DOSES.length);
  });

  it("holds the dose each log beat writes, at that beat's story clock", () => {
    const byId = new Map(DEMO_DOSES.map((d) => [d.id, d]));
    expect(byId.get(LOGGED_DOSE.desktop)).toEqual({
      id: LOGGED_DOSE.desktop,
      medicationId: "lis",
      takenAt: DESKTOP_NOW,
      quantity: 1,
      status: "taken",
    });
    expect(byId.get(LOGGED_DOSE.phone)).toEqual({
      id: LOGGED_DOSE.phone,
      medicationId: "vitd",
      takenAt: PHONE_NOW,
      quantity: 1,
      status: "taken",
    });
  });
});

describe("the demo medications' schedules", () => {
  it("are the schedules scripts/seed-demo.ts seeds, medication by medication", () => {
    const seed = readFileSync(
      fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url)),
      "utf8",
    );
    // Each SEED_MEDS entry's `name: "…"` and the `schedule: { … }` literal
    // after it, with the literal's bare keys quoted so JSON can read it.
    const seeded = [...seed.matchAll(/name: "([^"]+)",[\s\S]*?schedule: (\{[^}]*\})/g)].map(
      ([, name, literal]) => ({
        name,
        schedule: JSON.parse(literal.replace(/([{,]\s*)(\w+):/g, '$1"$2":')),
      }),
    );
    expect(seeded).toEqual(MEDICATIONS.map((m) => ({ name: m.name, schedule: m.schedule })));
  });

  it("expect perDay doses a day, by the analytics denominator's own rule", () => {
    for (const m of MEDICATIONS) {
      expect(expectedPerDayForSchedules(scheduleRows(m)), m.id).toBe(m.perDay);
    }
  });
});

describe("the History scene", () => {
  it("lists DEMO_DOSES up to DESKTOP_NOW by day, newest first, as /log groups them", () => {
    // /log orders by takenAt descending, groups by day key in the user's
    // zone, and names today's and yesterday's keys.
    const todayKey = isoDayKey(DESKTOP_NOW, WALKTHROUGH_TZ);
    const yesterdayKey = shiftDayKey(todayKey, -1);
    const groups = new Map<string, DemoDose[]>();
    const logged = DEMO_DOSES.filter((d) => d.takenAt.getTime() <= DESKTOP_NOW.getTime()).sort(
      (a, b) => b.takenAt.getTime() - a.takenAt.getTime(),
    );
    for (const dose of logged) {
      const key = isoDayKey(dose.takenAt, WALKTHROUGH_TZ);
      groups.set(key, [...(groups.get(key) ?? []), dose]);
    }
    const expected = [...groups].map(([key, doses]) => ({
      label: key === todayKey ? "Today" : key === yesterdayKey ? "Yesterday" : key,
      doses: doses.map((d) => ({
        id: d.medicationId,
        time: formatUserTime(d.takenAt, WALKTHROUGH_TZ, "24h"),
        since: formatTimeSince(d.takenAt, DESKTOP_NOW),
      })),
    }));

    const shown = LOG_ALL.map((group) => ({
      label: group.label,
      doses: group.doses.map((d) => ({
        id: d.id,
        time: storyClock(d.time, "24h"),
        since: d.since,
      })),
    }));
    expect(shown).toEqual(expected);
  });
});

describe("the Medications scene", () => {
  it("times each medication's last taken dose as formatTimeSince does, at DESKTOP_NOW and a minute on", () => {
    const aMinuteOn = new Date(DESKTOP_NOW.getTime() + 60_000);
    for (const m of MEDICATIONS) {
      const taken = DEMO_DOSES.filter(
        (d) =>
          d.medicationId === m.id &&
          d.status === "taken" &&
          d.takenAt.getTime() <= DESKTOP_NOW.getTime(),
      );
      expect(taken.length, m.id).toBeGreaterThan(0);
      const latest = new Date(Math.max(...taken.map((d) => d.takenAt.getTime())));
      expect(m.lastTaken, m.id).toBe(formatTimeSince(latest, DESKTOP_NOW));
      expect(m.lastTakenNext, m.id).toBe(formatTimeSince(latest, aMinuteOn));
    }
  });
});

describe("the Security scene", () => {
  it("prints each session's expiry through formatUserDate, current session first", () => {
    expect(SESSION_EXPIRIES.length).toBeGreaterThan(0);
    const doc = ssrDocument(render(SecurityScene).body);
    const expiries = [...doc.querySelectorAll("p")]
      .map(textOf)
      .filter((text) => text.startsWith("Expires "));
    expect(expiries).toEqual(
      SESSION_EXPIRIES.map((d) => `Expires ${formatUserDate(d, WALKTHROUGH_TZ, "DD/MM/YYYY")}`),
    );
  });
});

describe("the Analytics scene's Dose Status Breakdown", () => {
  it("is the real per-medication fold over the demo history", () => {
    // getPerMedicationStats' default window for `days = 90`, read at DESKTOP_NOW.
    const windowFrom = new Date(DESKTOP_NOW.getTime() - 90 * 86_400_000);
    const counts: MedicationStatusCounts[] = MEDICATIONS.map((m, i) => {
      const { taken } = HISTORY.perMedication[i];
      // getPerMedicationStats' expectation: the schedule's daily rate times
      // the whole days of the window the medication's lifecycle covers.
      const days = clampEffectiveDays(windowFrom, DESKTOP_NOW, DEMO_STARTED_AT, null);
      const expectedTotal = Math.round(expectedPerDayForSchedules(scheduleRows(m)) * days);
      return { takenEvents: taken, takenQuantity: taken, skippedEvents: 0, expectedTotal };
    });
    const real = foldDoseStatusBreakdown(counts);
    expect(STATUS_BREAKDOWN).toEqual({
      takenEvents: real.takenEvents,
      skippedEvents: real.skippedEvents,
      missedEvents: real.missedEvents,
      expectedTotal: real.expectedTotal,
      adherencePercent: real.adherencePercent,
    });
  });

  // Pinned as well as derived: both sides of the test above read HISTORY, so
  // a new seed or draw order moves them together and only a literal notices.
  it("shows the totals the seed decides", () => {
    expect(STATUS_BREAKDOWN).toEqual({
      takenEvents: 602,
      skippedEvents: 0,
      missedEvents: 118,
      expectedTotal: 720,
      adherencePercent: 83.6,
    });
  });

  it("draws the bar and legend the real StatusBreakdownBar draws for the same counts", () => {
    const { takenEvents, skippedEvents, missedEvents, expectedTotal } = STATUS_BREAKDOWN;
    const real = breakdownOf(
      ssrDocument(
        render(StatusBreakdownBar, {
          props: { takenEvents, skippedEvents, missedEvents, expectedTotal },
        }).body,
      ),
    );
    const scene = breakdownOf(
      ssrDocument(render(AnalyticsScene, { props: { load: 10, heat: 1 } }).body),
    );
    expect(real.segments.length).toBeGreaterThan(0);
    expect(scene).toEqual(real);
  });
});
```

**Why the test is shaped this way:**

- **The seed test reads `scripts/seed-demo.ts` as text.** Importing it would run the script: `loadDotEnv()`, then `process.exit(1)` when `DATABASE_URL` is unset.
- **The fold test computes each expectation exactly as `getPerMedicationStats` does:** `Math.round(expectedPerDayForSchedules(rows) * clampEffectiveDays(window, startedAt))`. So it checks three things:
  - the demo's schedules;
  - `DEMO_STARTED_AT`;
  - the fold, against the real code.
- **The render test compares the scene with the real `StatusBreakdownBar` rendered from the same counts.** The real component is the oracle for the legend wording and the segment set.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`

Expected: FAIL, `Tests  10 failed (10)`. Nine fail because the new `demo-data` exports are still `undefined`, and the seed test fails because `m.schedule` is `undefined`:

| Test                                             | Message                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `ids each dose …`                                | `TypeError: DEMO_DOSES is not iterable`                                                          |
| `holds the dose each log beat writes …`          | `TypeError: Cannot read properties of undefined (reading 'map')`                                 |
| `are the schedules scripts/seed-demo.ts seeds …` | `AssertionError: expected [ { name: 'Vitamin D', …(1) }, …(4) ] to deeply equal [ … ]`           |
| `expect perDay doses a day …`                    | `TypeError: Cannot read properties of undefined (reading 'kind')`                                |
| `lists DEMO_DOSES up to DESKTOP_NOW …`           | `TypeError: Cannot read properties of undefined (reading 'filter')`                              |
| `times each medication's last taken dose …`      | `TypeError: Cannot read properties of undefined (reading 'getTime')`                             |
| `prints each session's expiry …`                 | `TypeError: Cannot read properties of undefined (reading 'length')`                              |
| `is the real per-medication fold …`              | `TypeError: Cannot read properties of undefined (reading 'getTime')`                             |
| `shows the totals the seed decides`              | `AssertionError: expected undefined to deeply equal { takenEvents: 602, …(4) }`                  |
| `draws the bar and legend …`                     | `TypeError: Cannot destructure property 'takenEvents' of 'STATUS_BREAKDOWN' as it is undefined.` |

If the file instead fails to import `$lib/server/analytics/status-breakdown`, Task 3 has not landed.

- [ ] **Step 3: Add the story clocks and `DemoSchedule` to `demo-data.ts`**

In `src/lib/components/walkthrough/demo-data.ts`, replace:

```ts
// The story clock is Thursday 24 September 2026, 08:02. Times are wall-clock
// strings formatted in UTC, so the video reads the same in every timezone.

import { formatUserTime, type TimeFormat } from "$lib/utils/time";

export type DemoMedication = {
  id: "vitd" | "lis" | "met" | "ibu" | "mag";
  name: string;
  amount: string;
  unit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  perDay: number;
```

with:

```ts
// The story is Thursday 24 September 2026, on two clocks: the desktop scenes
// at 08:02 (DESKTOP_NOW) and the phone at 10:12 (PHONE_NOW). Every instant is
// UTC and every string is formatted in WALKTHROUGH_TZ, never the visitor's
// zone, so the video reads the same everywhere.

import { formatUserTime, type TimeFormat } from "$lib/utils/time";

// ── Story clocks ──
/** The zone every walkthrough string is formatted in. */
export const WALKTHROUGH_TZ = "UTC";
/** The desktop scenes. Lisinopril's 08:00 dose is due, and is logged now. */
export const DESKTOP_NOW = new Date("2026-09-24T08:02:00.000Z");
/** The phone scene. Vitamin D's 09:05 dose is overdue, and is logged now. */
export const PHONE_NOW = new Date("2026-09-24T10:12:00.000Z");
/** Days of history behind the analytics shot, ending at DESKTOP_NOW. */
const HISTORY_DAYS = 90;
/**
 * When every demo medication, and each of its schedules, began: the start of
 * the 90-day analytics window. Any later and the lifecycle and schedule-edit
 * clips would drop slots from the dashboard and days from the denominator.
 */
export const DEMO_STARTED_AT = new Date(DESKTOP_NOW.getTime() - HISTORY_DAYS * 86_400_000);

/** A medication's schedule rows, as scripts/seed-demo.ts writes them. */
export type DemoSchedule =
  | { kind: "interval"; intervalHours: string }
  | { kind: "fixed_time"; timesOfDay: string[] };

export type DemoMedication = {
  id: "vitd" | "lis" | "met" | "ibu" | "mag";
  name: string;
  amount: string;
  unit: string;
  form: string;
  category: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  /** The same schedule scripts/seed-demo.ts gives this medication. */
  schedule: DemoSchedule;
  /** Expected doses a day under `schedule`, by the analytics denominator's rule. */
  perDay: number;
```

`HISTORY_DAYS` moves up here from the History section (Step 5 deletes the old line). `DEMO_STARTED_AT` reads it at module load, so it must be declared first. The value is exactly the contract's `DESKTOP_NOW.getTime() - 90 * 86_400_000`.

- [ ] **Step 4: Give each medication its seeded schedule**

Make five replacements in `MEDICATIONS`. Each `takeRate` value is unique, so each anchor matches once.

Vitamin D: replace

```ts
    perDay: 1,
    takeRate: 0.92,
```

with

```ts
    schedule: { kind: "interval", intervalHours: "24" },
    perDay: 1,
    takeRate: 0.92,
```

Lisinopril: replace

```ts
    perDay: 1,
    takeRate: 0.96,
```

with

```ts
    schedule: { kind: "fixed_time", timesOfDay: ["08:00"] },
    perDay: 1,
    takeRate: 0.96,
```

Metformin: replace

```ts
    perDay: 2,
    takeRate: 0.88,
```

with

```ts
    schedule: { kind: "interval", intervalHours: "12" },
    perDay: 2,
    takeRate: 0.88,
```

Ibuprofen: replace

```ts
    perDay: 3,
    takeRate: 0.7,
```

with

```ts
    schedule: { kind: "interval", intervalHours: "8" },
    perDay: 3,
    takeRate: 0.7,
```

Magnesium Glycinate: replace

```ts
    perDay: 1,
    takeRate: 0.85,
```

with

```ts
    schedule: { kind: "interval", intervalHours: "24" },
    perDay: 1,
    takeRate: 0.85,
```

- [ ] **Step 5: Drop the partial-day term and add `STATUS_BREAKDOWN`**

Make three replacements in the History section.

Replace:

```ts
// ── History ──
const HISTORY_DAYS = 90;
// Doses already logged on the story day (the last of the 90).
```

with:

```ts
// ── History ──
// Doses already logged on the story day (the last of the 90).
```

Replace:

```ts
  const total = sum(daily);
  // Today is only part-way through: three doses were due by 08:02.
  const expected = expectedPerDay * (HISTORY_DAYS - 1) + 3;

  return {
    daily,
    dailyAdherence,
    max: Math.max(...daily),
    total,
    expected,
    // Placeholder
```

with:

```ts
  const total = sum(daily);

  return {
    daily,
    dailyAdherence,
    max: Math.max(...daily),
    total,
    // Placeholder
```

The rest of that `// Placeholder, as in the design…` line is untouched.

Replace:

```ts
export const HISTORY = buildHistory();
```

with:

```ts
export const HISTORY = buildHistory();

/**
 * The analytics page's Dose Status Breakdown over `getPerMedicationStats`'
 * default 90-day window, read at DESKTOP_NOW. Every medication started at
 * DEMO_STARTED_AT, so each one expects `perDay × 90`, and the fold is PER
 * MEDICATION, as `getDoseStatusBreakdown` folds it:
 * - an untaken expected dose is Missed, never Skipped. Skipped counts explicit
 *   skips, and the demo history has none;
 * - adherence credits each medication with at most its own expectation.
 *
 * AnalyticsScene renders these fields and does no arithmetic of its own.
 * The real fold lives under $lib/server, which this client module cannot
 * import, so walkthrough-demo-facts.test.ts holds this to it instead.
 */
function buildStatusBreakdown() {
  let takenEvents = 0;
  let expectedTotal = 0;
  let missedEvents = 0;
  let creditedTaken = 0;
  for (const { taken, expected } of HISTORY.perMedication) {
    takenEvents += taken;
    expectedTotal += expected;
    missedEvents += Math.max(0, expected - taken);
    creditedTaken += Math.min(taken, expected);
  }
  return {
    takenEvents,
    skippedEvents: 0,
    missedEvents,
    expectedTotal,
    adherencePercent: Math.min(100, Math.round((creditedTaken / expectedTotal) * 1000) / 10),
  };
}

export const STATUS_BREAKDOWN: {
  takenEvents: number;
  skippedEvents: number;
  missedEvents: number;
  expectedTotal: number;
  adherencePercent: number;
} = buildStatusBreakdown();
```

`HISTORY.perMedication[i].expected` is already `m.perDay * HISTORY_DAYS`, which is the "90-day whole-day count".

- [ ] **Step 6: Add the one dose list**

Replace:

```ts
// ── Dose history ──
export type LoggedDose
```

with:

```ts
// ── Doses ──
export type DemoDose = {
  id: string;
  medicationId: MedicationId;
  takenAt: Date;
  quantity: number;
  status: "taken" | "skipped";
};

/** One taken unit at `iso` ("2026-09-24T08:02Z"), id'd `dose-<med>-<yyyymmdd>-<hhmm>`. */
function demoDose(medicationId: MedicationId, iso: string): DemoDose {
  const day = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 16).replace(":", "");
  return {
    id: `dose-${medicationId}-${day}-${time}`,
    medicationId,
    takenAt: new Date(iso),
    quantity: 1,
    status: "taken",
  };
}

/**
 * Every dose the story depends on, oldest first: the History scene's
 * Yesterday and Today groups, plus Vitamin D at PHONE_NOW, which the phone
 * logs on screen. Yesterday's Vitamin D 09:05 and Magnesium 22:05, and
 * today's Ibuprofen 06:10 and Metformin 07:48, are also the interval anchors
 * the dashboard projects today's slots from.
 *
 * LOG_ALL and each MEDICATIONS[].lastTaken stay hand-written;
 * walkthrough-demo-facts.test.ts holds both to this list.
 */
export const DEMO_DOSES: readonly DemoDose[] = [
  demoDose("lis", "2026-09-23T08:01Z"),
  demoDose("vitd", "2026-09-23T09:05Z"),
  demoDose("ibu", "2026-09-23T14:12Z"),
  demoDose("met", "2026-09-23T19:51Z"),
  demoDose("mag", "2026-09-23T22:05Z"),
  demoDose("ibu", "2026-09-23T22:14Z"),
  demoDose("ibu", "2026-09-24T06:10Z"),
  demoDose("met", "2026-09-24T07:48Z"),
  demoDose("lis", "2026-09-24T08:02Z"),
  demoDose("vitd", "2026-09-24T10:12Z"),
];

/** The dose each log beat writes: the desktop's Log now and the phone's tap. */
export const LOGGED_DOSE = {
  desktop: "dose-lis-20260924-0802",
  phone: "dose-vitd-20260924-1012",
} as const;

// ── Dose history ──
export type LoggedDose
```

**What the list holds.**

- The contract's extra "Vitamin D 23 Sep 09:05" and "Magnesium 23 Sep 22:05 if absent" are both already LOG_ALL Yesterday rows.
- The Lisinopril 08:02 beat dose is already LOG_ALL's first Today row.
- So the list is LOG_ALL's nine rows plus the phone's 10:12 dose.

**The instants.** `"2026-09-24T08:02Z"` is a valid ECMAScript date-time string: the time may stop at minutes, and must then carry its offset. `new Date` parses it to `2026-09-24T08:02:00.000Z`.

- [ ] **Step 7: Put Yesterday newest first, and add the session expiries**

Replace:

```ts
export const LOG_ALL: readonly DoseGroup[] = [
  {
    label: "Today",
    doses: [
      { id: "lis", time: "08:02", since: "just now" },
      { id: "met", time: "07:48", since: "14m ago" },
      { id: "ibu", time: "06:10", since: "1h 52m ago" },
    ],
  },
  {
    label: "Yesterday",
    doses: [
      { id: "mag", time: "22:05", since: "9h 57m ago" },
      { id: "ibu", time: "22:14", since: "9h 48m ago" },
```

with:

```ts
// Newest first within each day, as /log orders by takenAt descending.
export const LOG_ALL: readonly DoseGroup[] = [
  {
    label: "Today",
    doses: [
      { id: "lis", time: "08:02", since: "just now" },
      { id: "met", time: "07:48", since: "14m ago" },
      { id: "ibu", time: "06:10", since: "1h 52m ago" },
    ],
  },
  {
    label: "Yesterday",
    doses: [
      { id: "ibu", time: "22:14", since: "9h 48m ago" },
      { id: "mag", time: "22:05", since: "9h 57m ago" },
```

Replace:

```ts
  return formatUserTime(new Date(Date.UTC(2026, 8, 24, hours, minutes)), "UTC", format);
}

// ── Pages shown in the fake browser ──
```

with:

```ts
  return formatUserTime(new Date(Date.UTC(2026, 8, 24, hours, minutes)), WALKTHROUGH_TZ, format);
}

// ── Security ──
/**
 * The Security scene's session expiries, current session first. The scene
 * prints them through formatUserDate, as the real page does.
 */
export const SESSION_EXPIRIES: readonly Date[] = [
  new Date("2026-10-22T08:00Z"),
  new Date("2026-10-15T20:30Z"),
];

// ── Pages shown in the fake browser ──
```

- [ ] **Step 8: Run the test; only the two scene checks still fail**

Run: `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`

Expected: FAIL, `Tests  2 failed | 8 passed (10)`. The data is now right, and the two scenes still draw the old strings:

- **`the Security scene > prints each session's expiry through formatUserDate, current session first`** fails with `expected [ 'Expires 22/10/2026', …(1) ] to deeply equal [ 'Expires 22 Oct 2026', …(1) ]`.
- **`the Analytics scene's Dose Status Breakdown > draws the bar and legend the real StatusBreakdownBar draws for the same counts`** fails because the scene still draws its old pooled bar over the deleted `HISTORY.expected`. The diff shows:
  - the legend reads `"Skipped NaN"`, `"Missed 0"` and `"expected"`, where the real card reads `"Skipped 0"`, `"Missed 118"` and `"720 expected"`;
  - both scene segments have an empty width;
  - the second scene segment is `bg-warning`, where the real card's is `bg-danger`.

Do not run `npm run check` yet: AnalyticsScene still reads `HISTORY.expected` until Step 11.

- [ ] **Step 9: Export `StatusBreakdownBar`'s segment rule**

The scene cannot mount `StatusBreakdownBar`, because the card renders an `<h2>` and the stage has no headings (Global Constraints). It uses the card's own rule instead. `MedicalDisclaimer.svelte`'s `DISCLAIMER_TEXT` already crosses into the walkthrough this way.

In `src/lib/components/StatusBreakdownBar.svelte`, replace:

```svelte
<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";

  type Props = {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
  };

  let { takenEvents, skippedEvents, missedEvents, expectedTotal }: Props = $props();

  const total = $derived(Math.max(takenEvents + skippedEvents + missedEvents, 1));
  const takenPct = $derived(Math.round((takenEvents / total) * 1000) / 10);
  const skippedPct = $derived(Math.round((skippedEvents / total) * 1000) / 10);
  const missedPct = $derived(Math.max(0, 100 - takenPct - skippedPct));
</script>
```

with:

```svelte
<script lang="ts" module>
  // Exported so a surface that cannot mount this card still draws the bar by
  // the same rule: the landing-page walkthrough has no headings, and this
  // card renders an <h2>.
  export function statusBreakdownSegments(counts: {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
  }): { takenPct: number; skippedPct: number; missedPct: number } {
    const { takenEvents, skippedEvents, missedEvents } = counts;
    const total = Math.max(takenEvents + skippedEvents + missedEvents, 1);
    const takenPct = Math.round((takenEvents / total) * 1000) / 10;
    const skippedPct = Math.round((skippedEvents / total) * 1000) / 10;
    const missedPct = Math.max(0, 100 - takenPct - skippedPct);
    return { takenPct, skippedPct, missedPct };
  }
</script>

<script lang="ts">
  import GlassCard from "$components/ui/GlassCard.svelte";

  type Props = {
    takenEvents: number;
    skippedEvents: number;
    missedEvents: number;
    expectedTotal: number;
  };

  let { takenEvents, skippedEvents, missedEvents, expectedTotal }: Props = $props();

  const { takenPct, skippedPct, missedPct } = $derived(
    statusBreakdownSegments({ takenEvents, skippedEvents, missedEvents }),
  );
</script>
```

The markup below the scripts is unchanged. It still reads `takenPct`, `skippedPct` and `missedPct`, which the destructured `$derived` keeps reactive. svelte-check accepts this form, with no new warning.

- [ ] **Step 10: Prove the move is markup-neutral (throwaway, deleted before commit)**

`StatusBreakdownBar` has no unit test of its own. This step proves the move changes no output. It compares the committed component with the edited one over six prop sets, including both empty-card guards.

```bash
git show HEAD:src/lib/components/StatusBreakdownBar.svelte > tests/unit/zz-t4-bar-before.svelte
cat > tests/unit/zz-t4-bar-neutral.test.ts <<'EOF'
// @vitest-environment node
import { it, expect } from "vitest";
import { render } from "svelte/server";
import Before from "./zz-t4-bar-before.svelte";
import After from "$lib/components/StatusBreakdownBar.svelte";

it("renders byte-identical markup before and after the move", () => {
  for (const props of [
    { takenEvents: 602, skippedEvents: 0, missedEvents: 118, expectedTotal: 720 },
    { takenEvents: 0, skippedEvents: 0, missedEvents: 0, expectedTotal: 0 },
    { takenEvents: 5, skippedEvents: 0, missedEvents: 0, expectedTotal: 0 },
    { takenEvents: 20, skippedEvents: 3, missedEvents: 7, expectedTotal: 30 },
    { takenEvents: 1, skippedEvents: 1, missedEvents: 1, expectedTotal: 3 },
    { takenEvents: 0, skippedEvents: 4, missedEvents: 0, expectedTotal: 4 },
  ]) {
    expect(render(After, { props }).body).toBe(render(Before, { props }).body);
  }
});
EOF
npx vitest run tests/unit/zz-t4-bar-neutral.test.ts
rm tests/unit/zz-t4-bar-before.svelte tests/unit/zz-t4-bar-neutral.test.ts
```

Expected: `Tests  1 passed (1)`, then both files are gone. Confirm with `git status --short tests/unit`, which must list only `walkthrough-demo-facts.test.ts`.

- [ ] **Step 11: Draw the Analytics bar from `STATUS_BREAKDOWN`, with no arithmetic**

In `src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`, replace:

```svelte
  import Sparkline from "$components/Sparkline.svelte";
  import { DISCLAIMER_TEXT } from "$components/MedicalDisclaimer.svelte";
  import {
    ADHERENCE_TRENDS,
    HEATMAP_WEEKS,
    HISTORY,
    MEDICATIONS,
    heatmapIntensity,
  } from "../demo-data";
```

with:

```svelte
  import Sparkline from "$components/Sparkline.svelte";
  import { DISCLAIMER_TEXT } from "$components/MedicalDisclaimer.svelte";
  import { statusBreakdownSegments } from "$components/StatusBreakdownBar.svelte";
  import {
    ADHERENCE_TRENDS,
    HEATMAP_WEEKS,
    HISTORY,
    MEDICATIONS,
    STATUS_BREAKDOWN,
    heatmapIntensity,
  } from "../demo-data";
```

Replace:

```svelte
const skipped = HISTORY.expected - HISTORY.total; const takenPercent = Math.round((HISTORY.total /
HISTORY.expected) * 1000) / 10;
```

with:

```svelte
  // StatusBreakdownBar's own segment rule. The card itself cannot be mounted
  // here: it renders an <h2>, and the stage has no headings.
  const segments = statusBreakdownSegments(STATUS_BREAKDOWN);
  const legend = [
    { label: "Taken", value: STATUS_BREAKDOWN.takenEvents, dot: "bg-success" },
    { label: "Skipped", value: STATUS_BREAKDOWN.skippedEvents, dot: "bg-warning" },
    { label: "Missed", value: STATUS_BREAKDOWN.missedEvents, dot: "bg-danger" },
  ];
```

Replace:

```svelte
<div class="bg-surface-overlay flex h-3 w-full overflow-hidden rounded-full">
  <div class="bg-success h-full" style:width="{takenPercent}%"></div>
  <div class="bg-warning h-full" style:width="{100 - takenPercent}%"></div>
</div>
<div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
  {#each [["Taken", HISTORY.total, "bg-success"], ["Skipped", skipped, "bg-warning"], ["Missed", 0, "bg-danger"]] as [label, value, dot] (label)}
    <span class="flex items-center gap-1.5"
      ><span class="h-2 w-2 rounded-full {dot}"></span>{label} {value}</span
    >
  {/each}
  <span class="text-text-muted ml-auto">{HISTORY.expected} expected</span>
</div>
```

with:

```svelte
<div class="bg-surface-overlay flex h-3 w-full overflow-hidden rounded-full">
  {#if segments.takenPct > 0}
    <div class="bg-success h-full" style:width="{segments.takenPct}%"></div>
  {/if}
  {#if segments.skippedPct > 0}
    <div class="bg-warning h-full" style:width="{segments.skippedPct}%"></div>
  {/if}
  {#if segments.missedPct > 0}
    <div class="bg-danger h-full" style:width="{segments.missedPct}%"></div>
  {/if}
</div>
<div class="text-text-secondary flex flex-wrap gap-x-4 gap-y-1 text-xs">
  {#each legend as { label, value, dot } (label)}
    <span class="flex items-center gap-1.5"
      ><span class="h-2 w-2 rounded-full {dot}"></span>{label} {value}</span
    >
  {/each}
  <span class="text-text-muted ml-auto">{STATUS_BREAKDOWN.expectedTotal} expected</span>
</div>
```

**What this changes on screen.**

- The `{#if}` guards copy the real card's: a zero-width segment is not drawn, so the demo's Skipped segment disappears, as it would in the app.
- No `{#if}` wraps a marked element. This card has no `use:mark`; the scene's marks are `n.stats`, `n.heatTitle` and `n.heatGrid`.
- `HISTORY` is still imported, for the stat cards and the per-medication rows.

- [ ] **Step 12: Print the session expiries through `formatUserDate`**

In `src/lib/components/walkthrough/scenes/SecurityScene.svelte`, replace:

```svelte
  import { useMark } from "../marks";
  import FieldBox from "../parts/FieldBox.svelte";

  const mark = useMark();
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  const SESSIONS = [
    { n: 1, expires: "22/10/2026", current: true },
    { n: 2, expires: "15/10/2026", current: false },
  ];
```

with:

```svelte
  import { formatUserDate } from "$lib/utils/time";
  import { SESSION_EXPIRIES, WALKTHROUGH_TZ } from "../demo-data";
  import { useMark } from "../marks";
  import FieldBox from "../parts/FieldBox.svelte";

  const mark = useMark();
  const card = "border-glass-border bg-glass rounded-xl border p-6";
  // The real page formats each expiry with the user's dateFormat; the demo
  // account keeps the default.
  const SESSIONS = SESSION_EXPIRIES.map((expiresAt, i) => ({
    n: i + 1,
    expires: formatUserDate(expiresAt, WALKTHROUGH_TZ, "DD/MM/YYYY"),
    current: i === 0,
  }));
```

The markup is unchanged: it already renders `Expires {session.expires}`, and keys `{#each SESSIONS as session (session.n)}`.

- [ ] **Step 13: Run the test to verify it passes**

Run: `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`
Expected: PASS, `Tests  10 passed (10)`.

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`
Expected: PASS, with the same 20 tests as before and no edits.

- Its demo-data pins (`HISTORY.total` 602, `averageAdherence` 84, the heatmap's last cell on row 4, and `storyClock`) are untouched, because the PRNG draw order did not change.
- `storyClock` now formats in `WALKTHROUGH_TZ`, which is `"UTC"` as before.

Run: `grep -rn "HISTORY\.expected" src tests`
Expected: no output. The removed field has no reader left.

- [ ] **Step 14: Prove each new test by mutation**

Run every mutation below the same way:

1. Make the one edit.
2. Run `npx vitest run tests/unit/walkthrough-demo-facts.test.ts`.
3. Check that the named test fails, and only the tests named.
4. Restore the line exactly.
5. Re-run to green before the next mutation.

Each outcome below was observed against this exact code in the planning probe.

1. **Swap two Yesterday rows.** In `LOG_ALL`, put `{ id: "mag", time: "22:05", since: "9h 57m ago" },` back above `{ id: "ibu", time: "22:14", since: "9h 48m ago" },`.
   Expected: 1 failed, `the History scene > lists DEMO_DOSES up to DESKTOP_NOW by day, newest first, as /log groups them`.
2. **Restore "22/10/2026".** In SecurityScene, replace `expires: formatUserDate(expiresAt, WALKTHROUGH_TZ, "DD/MM/YYYY"),` with `expires: ["22/10/2026", "15/10/2026"][i],`.
   Expected: 1 failed, `the Security scene > prints each session's expiry through formatUserDate, current session first`, with `expected [ 'Expires 22/10/2026', …(1) ] to deeply equal [ 'Expires 22 Oct 2026', …(1) ]`.
3. **Pool missed (the spec's mutation). This one is an equivalent mutant: expect PASS.** In `buildStatusBreakdown`'s return, replace the line `missedEvents,` with `missedEvents: expectedTotal - takenEvents,`.
   Expected: `Tests  10 passed (10)`. Record it in the task report as equivalent.
   - **Why it cannot fail.** Pooling differs from the per-medication sum only when some medication takes more than it expects. No demo medication does (80/90, 88/90, 161/180, 198/270, 75/90), so pooled missed is also 118.
   - **The behaviour the spec wants guarded** is the shipped mistake: untaken doses counted as Skipped, from pooled totals. Mutations 4 and 6 break that, and fail.
4. **Count untaken as Skipped in the data (the bar's shipped bug).** In `buildStatusBreakdown`'s return, replace the two lines `skippedEvents: 0,` and `missedEvents,` with `skippedEvents: expectedTotal - takenEvents,` and `missedEvents: 0,`.
   Expected: 2 failed:
   - `the Analytics scene's Dose Status Breakdown > is the real per-medication fold over the demo history`;
   - `… > shows the totals the seed decides`.
5. **Restore "Missed 0" in the scene.** In AnalyticsScene's `legend`, replace `value: STATUS_BREAKDOWN.missedEvents` with `value: 0`.
   Expected: 1 failed, `the Analytics scene's Dose Status Breakdown > draws the bar and legend the real StatusBreakdownBar draws for the same counts`.
6. **Pool in the scene, as the old scene did.** In the `legend`, replace `value: STATUS_BREAKDOWN.skippedEvents` with `value: STATUS_BREAKDOWN.expectedTotal - STATUS_BREAKDOWN.takenEvents`.
   Expected: 1 failed, `… > draws the bar and legend the real StatusBreakdownBar draws for the same counts`.
7. **Segments not drawn by the card's rule.** Replace `const segments = statusBreakdownSegments(STATUS_BREAKDOWN);` with `const segments = { takenPct: 83.6, skippedPct: 0, missedPct: 16.4 };`.
   Expected: 1 failed, `… > draws the bar and legend the real StatusBreakdownBar draws for the same counts`. The real card draws 16.400000000000006%.
8. **Start the medications a day late.** In `DEMO_STARTED_AT`, replace `HISTORY_DAYS * 86_400_000` with `(HISTORY_DAYS - 1) * 86_400_000`.
   Expected: 1 failed, `… > is the real per-medication fold over the demo history`. `clampEffectiveDays` returns 89, so 712 are expected.
9. **A wrong timer.** Change Vitamin D's `lastTaken: "22h 57m ago",` to `lastTaken: "22h 56m ago",`.
   Expected: 1 failed, `the Medications scene > times each medication's last taken dose as formatTimeSince does, at DESKTOP_NOW and a minute on`, with `vitd: expected '22h 56m ago' to be '22h 57m ago'`.
10. **A schedule that drifts from the seed.** Change Metformin's `schedule: { kind: "interval", intervalHours: "12" },` to `intervalHours: "8"`.
    Expected: 3 failed:
    - `the demo medications' schedules > are the schedules scripts/seed-demo.ts seeds, medication by medication`;
    - `… > expect perDay doses a day, by the analytics denominator's own rule` (`met: expected 3 to be 2`);
    - `the Analytics scene's Dose Status Breakdown > is the real per-medication fold over the demo history`.
11. **A beat id that names no dose.** Change `phone: "dose-vitd-20260924-1012",` to `phone: "dose-vitd-20260924-1013",`.
    Expected: 1 failed, `DEMO_DOSES > holds the dose each log beat writes, at that beat's story clock`.
12. **An id that drops the time.** In `demoDose`, change ``id: `dose-${medicationId}-${day}-${time}`,`` to ``id: `dose-${medicationId}-${day}`,``.
    Expected: 2 failed:
    - `DEMO_DOSES > ids each dose dose-<med>-<yyyymmdd>-<hhmm> from its own instant, uniquely` (`expected 'dose-lis-20260923' to be 'dose-lis-20260923-0801'`);
    - `DEMO_DOSES > holds the dose each log beat writes, at that beat's story clock`.
13. **A new seed.** Change `seededRandom(20260924)` to `seededRandom(20260925)`.
    Expected: 1 failed, `the Analytics scene's Dose Status Breakdown > shows the totals the seed decides`, with `takenEvents: 592`. The derived fold test still passes, which is why the pin exists.
    `walkthrough-timeline.test.ts`'s existing seed pin fails too: `npx vitest run tests/unit/walkthrough-timeline.test.ts` names `walkthrough demo data > is seeded, so every visitor and every prerender sees the same numbers`.

After the last restore, run `git diff --stat`. It must show only this task's five files, with the intended changes.

- [ ] **Step 15: Run the gates**

Run: `npx vitest run`, twice.
Expected, both times: everything passes. The count is Task 3's plus 1 file and 10 tests. If any test fails, name it in the report; do not re-run until it is green.

Run: `npm run check 2>&1 | tail -2`
Expected: `0 errors`, and warnings no higher than at Step 0 (≤ 27).

Run: `npm run lint 2>&1 | tail -3`
Expected: 0 errors, ≤ 115 warnings.

Run: `npm run format:check`
Expected: `All matched files use Prettier code style!`

- [ ] **Step 16: Commit**

Run: `git status --short`
Expected: exactly these five paths, with `tests/unit/zz-t4-*` already gone:

- `M src/lib/components/StatusBreakdownBar.svelte`
- `M src/lib/components/walkthrough/demo-data.ts`
- `M src/lib/components/walkthrough/scenes/AnalyticsScene.svelte`
- `M src/lib/components/walkthrough/scenes/SecurityScene.svelte`
- `?? tests/unit/walkthrough-demo-facts.test.ts`

```bash
git add src/lib/components/walkthrough/demo-data.ts \
  src/lib/components/walkthrough/scenes/AnalyticsScene.svelte \
  src/lib/components/walkthrough/scenes/SecurityScene.svelte \
  src/lib/components/StatusBreakdownBar.svelte \
  tests/unit/walkthrough-demo-facts.test.ts
git commit -F - <<'EOF'
fix(walkthrough): hold the demo's History, timers, Security and Analytics to one dose list

demo-data gains the story clocks (WALKTHROUGH_TZ, DESKTOP_NOW 08:02,
PHONE_NOW 10:12, DEMO_STARTED_AT), each medication's schedule as
scripts/seed-demo.ts seeds it, DEMO_DOSES with the two log-beat doses
named by LOGGED_DOSE, SESSION_EXPIRIES and STATUS_BREAKDOWN.

Three details the video showed were false:

- History listed Yesterday's Magnesium 22:05 above Ibuprofen 22:14;
  /log orders by takenAt descending.
- Security hard-coded "22/10/2026"; the page prints formatUserDate,
  "22 Oct 2026".
- The Analytics bar labelled every untaken expected dose Skipped and
  showed Missed 0 over 715 expected (a +3 partial-day term). It now
  shows the per-medication fold, Taken 602, Skipped 0, Missed 118,
  720 expected, drawn by StatusBreakdownBar's own segment rule, which
  the card now exports because the stage cannot mount a card with an
  <h2>.

walkthrough-demo-facts.test.ts holds every hand-written fact to
DEMO_DOSES and to the real code: formatTimeSince, formatUserDate,
expectedPerDayForSchedules, clampEffectiveDays and
foldDoseStatusBreakdown. No existing pin moves: HISTORY.total stays
602, because the PRNG draw order is unchanged.
EOF
```

Expected: the pre-commit hook (eslint --fix, prettier --write) passes and changes nothing. If it reformats a file, run `git diff` to see what changed, then re-run Step 15's gates before trusting the commit.

#### Notes for the reviewer

- **The fold mutation the spec names is equivalent on this data.** That is mutation 3 in Step 14.
  - Every demo medication takes at most what it expects, so `Σ max(0, e − t)` equals `Σe − Σt` (118 either way). The probe ran it and the suite stayed green.
  - The test still guards the spec's intent: the old bar's quantity (untaken counted as Skipped, from pooled totals) fails at both the data (mutation 4) and the scene (mutation 6).
  - Making pooling observable would need a medication that over-resolves. That would change the analytics numbers the spec quotes.
- **`StatusBreakdownBar.svelte` is a shipped analytics component, and the only file outside the walkthrough this task changes.** Scope the review to include it; CONTRACT ISSUES 1 gives the header's File Structure line for it.
  - Step 10 proves the move byte-identical over six prop sets, including both empty-card guards.
  - The scene imports only the module function and never mounts the card, which `T9`'s stage scans should allow.
- **Assertions beyond the spec's list:**
  - LOG_ALL's `since` column (each row equals `formatTimeSince(takenAt, DESKTOP_NOW)`);
  - each medication's `lastTakenNext` (the same at `DESKTOP_NOW + 60s`);
  - `perDay` against `expectedPerDayForSchedules`.

  All held already, so they cost nothing today and catch the next hand edit.

- **A pre-existing inconsistency, deliberately not fixed.** The PRNG's draw for 23 Sep (vitd 0, lis 1, met 2, ibu 1, mag 1) disagrees with DEMO_DOSES' 23 Sep rows (vitd 1, lis 1, met 1, ibu 2, mag 1).
  - It shows only as one point on each 20px Medications sparkline and one heatmap cell.
  - Pinning that day the way `TAKEN_TODAY` pins the story day would move every analytics number the spec quotes: the pooled totals become 603 / 117.
  - Story day 24 Sep already agrees (lis 1, met 1, ibu 1).
- **`STATUS_BREAKDOWN.adherencePercent` (83.6) is rendered nowhere.** The real `StatusBreakdownBar` does not render adherence either; only the PDF does. It is kept because the contract fixes the type, and the fold test checks it.
- **`unusedDb` is mocked for one function.** `expectedPerDayForSchedules` lives in `analytics.ts`, which imports `db`, so the file mocks `$lib/server/db` with `unusedDb`, as `analytics.test.ts` does. It throws on any access.
- **The seed-schedule test parses `scripts/seed-demo.ts` with a narrow regex.** If the seed's object-literal style changes, it fails loudly (it compares against five entries); it never passes vacuously.
- **The legend changed from a tuple `{#each}` to a typed object array.** It renders the same text, and the render test compares it with the real card.
- **The 16.400000000000006% width is the real card's float, reproduced exactly.** Not prettifying it is the point: the scene draws what the app draws.
- **Left alone:** the Analytics date range "27/06/2026 to 24/09/2026" (out of scope, not shown false), and `DAY_LABEL`'s own `"UTC"`.
- **No Review Focus item is assigned to this task.** The Security strings pass the zone explicitly and read no clock, so they are visitor-independent by construction.

#### Interface notes (deviations from the planning contract)

1. **`StatusBreakdownBar` cannot be rendered in the stage.** Its card renders `<h2>Dose Status Breakdown</h2>`, and the Global Constraints forbid any heading in the stage. The spec's other branch, "use StatusBreakdownBar's formula", is taken. That touches a shipped production component that the draft header's File Structure and the contract both left out:
   - `src/lib/components/StatusBreakdownBar.svelte` gains an exported `statusBreakdownSegments` in a `<script module>`. It is a new name the contract does not list.
   - The alternatives were rejected because each creates a second owner of the rule:
     - restating the three lines in the scene ("arithmetic of its own");
     - adding segment fields to `STATUS_BREAKDOWN` (changing the contract's type).
   - **Header amendment, to apply verbatim when the plan is assembled.** This part cannot edit `header.md`. Under `## File Structure` → **Modify:**, directly after the `src/lib/components/walkthrough/scenes/{AnalyticsScene,SecurityScene}.svelte` (T4) line, add:
     ```markdown
     - `src/lib/components/StatusBreakdownBar.svelte` (T4: the segment rule moves into an exported `statusBreakdownSegments` in `<script module>`, so AnalyticsScene draws the bar by the card's own rule without mounting its `<h2>`; Step 10 proves the markup byte-identical).
     ```
   - **Contract amendment, for the same reason.** Under `## T4` in `contract.md`, after the `STATUS_BREAKDOWN` bullet, add:
     ```markdown
     - `src/lib/components/StatusBreakdownBar.svelte` gains, in a `<script module>`, `export function statusBreakdownSegments(counts: { takenEvents: number; skippedEvents: number; missedEvents: number }): { takenPct: number; skippedPct: number; missedPct: number }`. It is the card's existing segment rule, moved unchanged. AnalyticsScene imports it and never mounts the card.
     ```
2. **The spec's "pool missed" mutation is equivalent on this data** (Notes, first bullet). The task keeps it as a recorded run that is expected to pass, and adds mutations 4 and 6, which do fail.
3. **T4 consumes T2's `formatTimeSince(date, now)`**, though the contract's dependency table lists only T3. The run order (T1→T10) makes it available, and Step 0 checks for it.
4. **`DEMO_DOSES`' "mag 23 Sep 22:05 if absent" is already present**, as is "vitd 23 Sep 09:05". The list is LOG_ALL's nine rows plus the phone beat: 10 doses.
5. **`DEMO_STARTED_AT` is written `DESKTOP_NOW.getTime() - HISTORY_DAYS * 86_400_000`**, with `HISTORY_DAYS` (90) moved above it. The value is identical to the contract's expression. Every contract name is kept.

### Task 5: demo-dashboard.ts moments, checked against the real composer

**What this task delivers.**

- **`demo-dashboard.ts`** holds the four dashboard moments that the redrawn scenes (Tasks 7 and 8) draw. They are written out as values, because the stage is client code and must never import the server composer.
- **One node test** proves that each moment equals what the real `composeDashboardPageData` returns at that moment, given the inputs `loadDashboard` would hand it (spec D7, data half).
- **Shared helpers.** The test file also defines the helpers that Tasks 7 and 8 reuse when they add their render `describe` blocks to the same file.

**Files:**

- Create: `src/lib/components/walkthrough/demo-dashboard.ts`
- Test (create): `tests/unit/walkthrough-dashboard-fidelity.test.ts`
- Modify: none. The mutation steps break lines in `demo-dashboard.ts`, `src/lib/components/walkthrough/demo-data.ts` (Task 4's `LOGGED_DOSE`) and `src/lib/components/dashboard/dose-toasts.ts`, and restore each one before moving on.

**Interfaces:**

- **Consumes, from Task 4** (`src/lib/components/walkthrough/demo-data.ts`):
  - `WALKTHROUGH_TZ = "UTC"`;
  - `DESKTOP_NOW = new Date("2026-09-24T08:02:00.000Z")` and `PHONE_NOW = new Date("2026-09-24T10:12:00.000Z")`;
  - `DEMO_STARTED_AT = new Date(DESKTOP_NOW.getTime() - 90 * 86_400_000)`;
  - `MEDICATIONS: readonly DemoMedication[]`, whose `DemoMedication` now has `schedule: DemoSchedule`, where `DemoSchedule = { kind: "interval"; intervalHours: string } | { kind: "fixed_time"; timesOfDay: string[] }`;
  - `MEDICATION_BY_ID: Record<MedicationId, DemoMedication>` and `type MedicationId`;
  - `DEMO_DOSES: readonly DemoDose[]`, where `DemoDose = { id: string; medicationId: MedicationId; takenAt: Date; quantity: number; status: "taken" | "skipped" }`, with ids `dose-<medId>-<yyyymmdd>-<hhmm>`;
  - `LOGGED_DOSE = { desktop: "dose-lis-20260924-0802", phone: "dose-vitd-20260924-1012" } as const`.
- **Consumes, existing code:**
  - `composeDashboardPageData(input: DashboardCompositionInputs): Omit<DashboardPageData, "refillForecast">` and `type DashboardCompositionInputs` from `$lib/server/dashboard/page-data`. It imports only types and `utils/schedule`, so it needs no database.
  - `dashboardWindow(now: Date, tz: string): DashboardWindow` from `$lib/utils/schedule`.
  - `logToastFromReload(reloaded: unknown, doseId: string | null, fallback: LogToastFallback, tz: string, timeFormat: TimeFormat): string` from `$lib/components/dashboard/dose-toasts`.
  - `formatDoseLabel(name, dosageAmount, dosageUnit): string` from `$lib/utils/dashboard-copy`.
  - The types `DashboardStatus`, `DueCard`, `DoneRow`, `LaterRow`, `DoseLogWithMedication` and `Medication` from `$lib/types`, and `MedicationSchedule` from `$lib/server/schedules` (type-only).
- **Produces, from `src/lib/components/walkthrough/demo-dashboard.ts`** (Tasks 7 and 8 read these):
  - `type StageDone = Pick<DoneRow, "key" | "covers" | "dayLabel"> & { dose: { id: string; medicationId: string; takenAt: Date; quantity: number; status: "taken" | "skipped"; name: string; dosageAmount: string; dosageUnit: string; colour: string; colourSecondary: string | null; pattern: string } }`
  - `type StageMedication = { id: string; name: string; dosageAmount: string; dosageUnit: string; colour: string; colourSecondary: string | null; pattern: string }`
  - `type StageMoment = { now: Date; todayStart: Date; status: DashboardStatus; earlier: DueCard[]; today: DueCard[]; done: StageDone[]; later: LaterRow[]; medications: StageMedication[] }`
  - `DESKTOP_BEFORE`, `DESKTOP_AFTER`, `PHONE_BEFORE` and `PHONE_AFTER`, each a `StageMoment`
  - `PHONE_LATER_ROWS = 2`. It is provisional, and only Task 10 changes it: its Step 20 lowers it when a phone screenshot finds a Later row cut. No other task edits the value (see CONTRACT ISSUES).
- **Produces, from `tests/unit/walkthrough-dashboard-fidelity.test.ts`.** These are module-level exports. Tasks 7 and 8 add `describe` blocks to this same file and call them; no other file imports it. The contract names only `buildInputs` and `toStageMoment`. The rest are additions, recorded in CONTRACT ISSUES so the contract can list them.
  - `type ComposedPayload = ReturnType<typeof composeDashboardPageData>`
  - `buildInputs(now: Date, includeIds: readonly string[] | "all-at-or-before-now"): DashboardCompositionInputs`
  - `toStageMoment(payload: ComposedPayload): StageMoment`
  - `lastDosesOf(doses: readonly DoseLogWithMedication[]): DashboardCompositionInputs["lastDoses"]`
  - `expectedOfferText(after: ComposedPayload, doseId: string, timeFormat: TimeFormat): string`. This is the offer-text oracle: `logToastFromReload` over the AFTER payload. It throws when the payload has no Done row for `doseId`.
  - `type MomentCase = { name: string; moment: StageMoment; now: Date; include: readonly string[] | "all-at-or-before-now" }`
  - `MOMENTS: readonly MomentCase[]`, in the order `[DESKTOP_BEFORE, DESKTOP_AFTER, PHONE_BEFORE, PHONE_AFTER]`
  - `composeMoment(c: MomentCase): ComposedPayload`
  - `BEATS`: `[{ surface: "desktop", before: MOMENTS[0], after: MOMENTS[1], doseId: LOGGED_DOSE.desktop }, { surface: "phone", before: MOMENTS[2], after: MOMENTS[3], doseId: LOGGED_DOSE.phone }] as const`
- **Two notes for the render tasks:**
  - **The phone banner (Task 8)** is Vitamin D's last event in the 10:12 input: `buildInputs(PHONE_NOW, MOMENTS[2].include).lastDoses.find((d) => d.medicationId === "vitd")?.lastEventAt`. That is 2026-09-23T09:05Z.
  - **A `StageMoment` is not a valid `reloaded` argument for `logToastFromReload`.** Its Done rows have no `dose.medication`, and its `todayStart` is a `Date`, not a string, so `logToastFromReload` would quietly return its fallback sentence, with no covers. So `StageUndoOffer`'s message must be built with `toastForLog` over the `StageDone` row (label from `formatDoseLabel(dose.name, dose.dosageAmount, dose.dosageUnit)`, `covers.map((iso) => new Date(iso))`). The render check then compares that message with `expectedOfferText(composeMoment(after), doseId, timeFormat)`.

**What the composer returned** (probe of 2026-10-12, Node ICU, `"UTC"`). These are recorded so later tasks know the story; **no test pins any string below**. Clock strings print without a leading zero on this ICU, so any pinned time must use `/^0?9:05$/`.

| Moment                   | `status`                                                             | Due                                                                                        | Done (in order)                                  | Later (in order)                                       |
| ------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------ |
| `DESKTOP_BEFORE` (08:02) | due · dueCount 1 · doneToday 2 · totalToday 8 · loggedToday 2        | `today:lis` with one row: fixed_time 08:00, due-now, logNow ✓, tookItAt null, skipAt 08:00 | ibu 06:10, met 07:48                             | vitd 09:05, ibu 14:10, met 19:48, mag 22:05, ibu 22:10 |
| `DESKTOP_AFTER` (08:02)  | caught-up · 0 · 3 · 8 · 3 · next Vitamin D 1000IU 09:05, alsoCount 0 | none                                                                                       | ibu 06:10, met 07:48, lis 08:02 covering [08:00] | the same five                                          |
| `PHONE_BEFORE` (10:12)   | due · 1 · 3 · 8 · 3                                                  | `today:vitd` with one row: interval 09:05, overdue, logNow ✓, tookItAt 09:05, skipAt 09:05 | ibu 06:10, met 07:48, lis 08:02 covering [08:00] | ibu 14:10, met 19:48, mag 22:05, ibu 22:10             |
| `PHONE_AFTER` (10:12)    | caught-up · 0 · 4 · 8 · 4 · next Ibuprofen 200mg 14:10, alsoCount 0  | none                                                                                       | the same three, plus vitd 10:12 covering []      | the same four                                          |

The helper output at `"24h"` confirms every illustrative value in the spec, apart from ICU's dropped leading zero:

- the header: "1 dose due" / "2 of 8 done today", then "All caught up" / "Next: Vitamin D 1000IU at 9:05 · in 1 hour";
- the phone header: "1 dose due" / "3 of 8 done today", then "All caught up" / "Next: Ibuprofen 200mg at 14:10 · in 3 hours";
- the Due lines: "Due 8:00 · 2 minutes ago" and "Due 9:05 · 1 hour ago";
- the offers: "Lisinopril 10mg logged at 8:02 — counted for your 8:00 dose" and "Vitamin D 1000IU logged at 10:12".

At `"12h"` the next lines read "… at 9:05 am · in 1 hour" and "… at 2:10 pm · in 3 hours".

- [ ] **Step 1: Confirm Task 4's exports are in place**

Run:

```bash
grep -cE "^export const (WALKTHROUGH_TZ|DESKTOP_NOW|PHONE_NOW|DEMO_STARTED_AT|DEMO_DOSES|LOGGED_DOSE)\b|^export type (DemoSchedule|DemoDose)\b|^  schedule: DemoSchedule;" src/lib/components/walkthrough/demo-data.ts
```

Expected: `9`. If it prints anything else, stop: Task 4 has not landed, and this task's test cannot import what it needs.

- [ ] **Step 2: Write the failing test**

Create `tests/unit/walkthrough-dashboard-fidelity.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  composeDashboardPageData,
  type DashboardCompositionInputs,
} from "$lib/server/dashboard/page-data";
import { dashboardWindow } from "$lib/utils/schedule";
import { formatDoseLabel } from "$lib/utils/dashboard-copy";
import type { TimeFormat } from "$lib/utils/time";
import { logToastFromReload } from "$lib/components/dashboard/dose-toasts";
import type { DoseLogWithMedication, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  DEMO_DOSES,
  DEMO_STARTED_AT,
  DESKTOP_NOW,
  LOGGED_DOSE,
  MEDICATIONS,
  PHONE_NOW,
  WALKTHROUGH_TZ,
} from "$lib/components/walkthrough/demo-data";
import {
  DESKTOP_AFTER,
  DESKTOP_BEFORE,
  PHONE_AFTER,
  PHONE_BEFORE,
  PHONE_LATER_ROWS,
  type StageMoment,
} from "$lib/components/walkthrough/demo-dashboard";

/*
 * The walkthrough's dashboard, checked against the app (spec D7).
 *
 * The oracle is the real `composeDashboardPageData`, run over DEMO_DOSES at
 * each story moment with the inputs `loadDashboard` would hand it: the doses
 * in `dashboardWindow`'s fetch range (and never in the future), the
 * medications in their demo order, every schedule from `DemoMedication`, and
 * `getLastDosePerMedication`'s rule for the anchors. `page-data.ts` imports
 * only types and `utils/schedule`, so none of this needs a database.
 *
 * The helpers are exported so every describe block in this file, the render
 * checks included, builds its payloads the one way. Never import this file
 * from another test: vitest would run its cases twice.
 */

export type ComposedPayload = ReturnType<typeof composeDashboardPageData>;

const DEMO_USER_ID = "demo";

/** MEDICATIONS as rows, built the way dashboard-page-data.test.ts's `makeMed` builds them. */
function demoMedications(): Medication[] {
  return MEDICATIONS.map((m, index) => ({
    id: m.id,
    userId: DEMO_USER_ID,
    name: m.name,
    dosageAmount: m.amount,
    dosageUnit: m.unit,
    form: m.form,
    category: m.category,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
    pattern: m.pattern,
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    lowInventoryEpisodeAt: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder: index,
    isArchived: false,
    archivedAt: null,
    // At or before the analytics window's start, so neither the lifecycle
    // clip nor the schedule-edit clip drops a slot.
    startedAt: DEMO_STARTED_AT,
    endedAt: null,
    createdAt: DEMO_STARTED_AT,
    updatedAt: DEMO_STARTED_AT,
  }));
}

/** One schedule row per interval medication, one per fixed time otherwise. */
function demoSchedules(): Map<string, MedicationSchedule[]> {
  const byMed = new Map<string, MedicationSchedule[]>();
  for (const m of MEDICATIONS) {
    const shared = {
      medicationId: m.id,
      userId: DEMO_USER_ID,
      daysOfWeek: null,
      effectiveFrom: DEMO_STARTED_AT,
      effectiveTo: null,
      createdAt: DEMO_STARTED_AT,
    };
    const { schedule } = m;
    byMed.set(
      m.id,
      schedule.kind === "interval"
        ? [
            {
              ...shared,
              id: `schedule-${m.id}-0`,
              scheduleKind: "interval",
              timeOfDay: null,
              intervalHours: schedule.intervalHours,
              sortOrder: 0,
            },
          ]
        : schedule.timesOfDay.map((timeOfDay, k) => ({
            ...shared,
            id: `schedule-${m.id}-${k}`,
            scheduleKind: "fixed_time" as const,
            timeOfDay,
            intervalHours: null,
            sortOrder: k,
          })),
    );
  }
  return byMed;
}

/** A dose as `getDosesInRange` returns it. `loggedAt` is `takenAt`: every demo dose was logged as it was taken. */
function doseRow(
  d: {
    id: string;
    medicationId: string;
    takenAt: Date;
    quantity: number;
    status: DoseLogWithMedication["status"];
  },
  med: Medication,
): DoseLogWithMedication {
  return {
    id: d.id,
    userId: DEMO_USER_ID,
    medicationId: d.medicationId,
    quantity: d.quantity,
    status: d.status,
    takenAt: d.takenAt,
    loggedAt: d.takenAt,
    updatedAt: d.takenAt,
    notes: null,
    sideEffects: null,
    medication: {
      name: med.name,
      dosageAmount: med.dosageAmount,
      dosageUnit: med.dosageUnit,
      form: med.form,
      colour: med.colour,
      colourSecondary: med.colourSecondary,
      pattern: med.pattern,
    },
  };
}

/**
 * `getLastDosePerMedication`'s rule over a dose list: `lastTakenAt` is the
 * latest taken dose, `lastEventAt` the latest taken or skipped one, and a
 * medication with neither is left out.
 */
export function lastDosesOf(
  doses: readonly DoseLogWithMedication[],
): DashboardCompositionInputs["lastDoses"] {
  const byMed = new Map<string, { lastTakenAt: Date | null; lastEventAt: Date }>();
  for (const d of doses) {
    if (d.status === "missed") continue;
    const entry = byMed.get(d.medicationId) ?? { lastTakenAt: null, lastEventAt: d.takenAt };
    if (d.takenAt.getTime() > entry.lastEventAt.getTime()) entry.lastEventAt = d.takenAt;
    if (
      d.status === "taken" &&
      (entry.lastTakenAt === null || d.takenAt.getTime() > entry.lastTakenAt.getTime())
    ) {
      entry.lastTakenAt = d.takenAt;
    }
    byMed.set(d.medicationId, entry);
  }
  return [...byMed].map(([medicationId, entry]) => ({ medicationId, ...entry }));
}

/**
 * The composer's inputs at `now`: the DEMO_DOSES named by `includeIds` (or
 * all of them), cut to `takenAt <= now` and to `dashboardWindow`'s fetch
 * range, newest first as `getDosesInRange` orders them.
 */
export function buildInputs(
  now: Date,
  includeIds: readonly string[] | "all-at-or-before-now",
): DashboardCompositionInputs {
  if (includeIds !== "all-at-or-before-now") {
    for (const id of includeIds) {
      if (!DEMO_DOSES.some((d) => d.id === id)) throw new Error(`no DEMO_DOSES entry ${id}`);
    }
  }
  const window = dashboardWindow(now, WALKTHROUGH_TZ);
  const medications = demoMedications();
  const medById = new Map(medications.map((m) => [m.id, m]));
  const doses = DEMO_DOSES.filter(
    (d) => includeIds === "all-at-or-before-now" || includeIds.includes(d.id),
  )
    .filter(
      (d) =>
        d.takenAt.getTime() <= now.getTime() &&
        d.takenAt.getTime() >= window.doseFetchFrom.getTime() &&
        d.takenAt.getTime() < window.doseFetchTo.getTime(),
    )
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
    .map((d) => {
      const med = medById.get(d.medicationId);
      if (!med) throw new Error(`DEMO_DOSES names an unknown medication: ${d.medicationId}`);
      return doseRow(d, med);
    });
  return {
    medications,
    schedulesByMedId: demoSchedules(),
    doses,
    lastDoses: lastDosesOf(doses),
    now,
    timezone: WALKTHROUGH_TZ,
  };
}

/** The composer's payload, cut to exactly the fields a `StageMoment` holds. */
export function toStageMoment(payload: ComposedPayload): StageMoment {
  return {
    now: new Date(payload.now),
    todayStart: new Date(payload.todayStart),
    status: payload.status,
    earlier: payload.earlier,
    today: payload.today,
    done: payload.done.map((row) => {
      const { dose } = row;
      if (dose.status === "missed") throw new Error(`the stage draws no missed row: ${dose.id}`);
      const med = dose.medication;
      return {
        key: row.key,
        covers: row.covers,
        dayLabel: row.dayLabel,
        dose: {
          id: dose.id,
          medicationId: dose.medicationId,
          takenAt: dose.takenAt,
          quantity: dose.quantity,
          status: dose.status,
          name: med.name,
          dosageAmount: med.dosageAmount,
          dosageUnit: med.dosageUnit,
          colour: med.colour,
          colourSecondary: med.colourSecondary,
          pattern: med.pattern,
        },
      };
    }),
    later: payload.later,
    medications: payload.medications.map((m) => ({
      id: m.id,
      name: m.name,
      dosageAmount: m.dosageAmount,
      dosageUnit: m.dosageUnit,
      colour: m.colour,
      colourSecondary: m.colourSecondary,
      pattern: m.pattern,
    })),
  };
}

/**
 * The Undo offer's message by the production path: `logToastFromReload` over
 * the AFTER payload, as DueCard's Log now calls it. It throws when the
 * payload has no Done row for the dose, because `logToastFromReload` would
 * then return its plain fallback sentence and a check could pass on that.
 */
export function expectedOfferText(
  after: ComposedPayload,
  doseId: string,
  timeFormat: TimeFormat,
): string {
  const row = after.done.find((r) => r.dose.id === doseId);
  if (!row) throw new Error(`no Done row for ${doseId}: the offer would be the fallback sentence`);
  const med = row.dose.medication;
  return logToastFromReload(
    after,
    doseId,
    {
      label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
      quantity: 1,
      takenAt: row.dose.takenAt,
      todayStart: new Date(after.todayStart),
    },
    WALKTHROUGH_TZ,
    timeFormat,
  );
}

/** Every DEMO_DOSES id but one: a BEFORE moment's input lacks the dose its beat logs. */
function allExcept(doseId: string): string[] {
  return DEMO_DOSES.map((d) => d.id).filter((id) => id !== doseId);
}

export type MomentCase = {
  name: string;
  moment: StageMoment;
  now: Date;
  include: readonly string[] | "all-at-or-before-now";
};

export const MOMENTS: readonly MomentCase[] = [
  {
    name: "DESKTOP_BEFORE",
    moment: DESKTOP_BEFORE,
    now: DESKTOP_NOW,
    include: allExcept(LOGGED_DOSE.desktop),
  },
  {
    name: "DESKTOP_AFTER",
    moment: DESKTOP_AFTER,
    now: DESKTOP_NOW,
    include: "all-at-or-before-now",
  },
  {
    name: "PHONE_BEFORE",
    moment: PHONE_BEFORE,
    now: PHONE_NOW,
    include: allExcept(LOGGED_DOSE.phone),
  },
  { name: "PHONE_AFTER", moment: PHONE_AFTER, now: PHONE_NOW, include: "all-at-or-before-now" },
];

/** The composer's payload at one moment. */
export function composeMoment(c: MomentCase): ComposedPayload {
  return composeDashboardPageData(buildInputs(c.now, c.include));
}

export const BEATS = [
  { surface: "desktop", before: MOMENTS[0], after: MOMENTS[1], doseId: LOGGED_DOSE.desktop },
  { surface: "phone", before: MOMENTS[2], after: MOMENTS[3], doseId: LOGGED_DOSE.phone },
] as const;

describe("walkthrough dashboard moments: data", () => {
  it.each(MOMENTS)("$name equals the real composer's output at its moment", (c) => {
    expect(c.moment).toEqual(toStageMoment(composeMoment(c)));
  });

  it.each(BEATS)(
    "$surface: the AFTER input is the BEFORE input plus exactly the logged dose, taken ×1 at that moment",
    ({ before, after, doseId }) => {
      const beforeIds = buildInputs(before.now, before.include).doses.map((d) => d.id);
      const afterDoses = buildInputs(after.now, after.include).doses;
      const added = afterDoses.filter((d) => !beforeIds.includes(d.id));

      expect(after.now).toEqual(before.now);
      expect(beforeIds.every((id) => afterDoses.some((d) => d.id === id))).toBe(true);
      expect(added.map((d) => d.id)).toEqual([doseId]);
      // Log now records the moment it is tapped.
      expect(added[0]).toMatchObject({ quantity: 1, status: "taken", takenAt: after.now });
    },
  );

  it.each(BEATS)(
    "$surface: Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done",
    ({ before, after, doseId }) => {
      const loggedMed = DEMO_DOSES.find((d) => d.id === doseId)?.medicationId;

      expect(before.moment.earlier).toEqual([]);
      expect(before.moment.today.map((card) => card.medicationId)).toEqual([loggedMed]);
      expect(before.moment.today[0].rows[0].logNow).toBe(true);
      expect(before.moment.done.some((row) => row.dose.id === doseId)).toBe(false);

      // The whole Due section collapses with `logged`.
      expect([...after.moment.earlier, ...after.moment.today]).toEqual([]);
      expect(after.moment.done.filter((row) => row.dose.id === doseId)).toHaveLength(1);
    },
  );

  it.each(BEATS)(
    "$surface: a row in both halves of the beat is identical in both",
    ({ before, after }) => {
      for (const field of ["earlier", "today", "done", "later"] as const) {
        const beforeRows: ReadonlyArray<{ key: string }> = before.moment[field];
        const afterRows: ReadonlyArray<{ key: string }> = after.moment[field];
        for (const row of beforeRows) {
          const twin = afterRows.find((r) => r.key === row.key);
          if (twin) expect(twin).toEqual(row);
        }
      }
    },
  );

  it.each(BEATS)(
    "$surface: the offer oracle reads the logged dose's Done row, and refuses a payload without one",
    ({ before, after, doseId }) => {
      expect(() => expectedOfferText(composeMoment(before), doseId, "24h")).toThrow(/no Done row/);

      const payload = composeMoment(after);
      const row = payload.done.find((r) => r.dose.id === doseId);
      if (!row) throw new Error(`no Done row for ${doseId}`);
      const med = row.dose.medication;
      // What the toast says when it cannot see the Done row.
      const fallbackOnly = logToastFromReload(
        undefined,
        doseId,
        {
          label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
          quantity: 1,
          takenAt: row.dose.takenAt,
          todayStart: new Date(payload.todayStart),
        },
        WALKTHROUGH_TZ,
        "24h",
      );
      // The Done row's covers are exactly what the offer adds to that sentence.
      expect(expectedOfferText(payload, doseId, "24h") !== fallbackOnly).toBe(
        row.covers.length > 0,
      );
    },
  );

  it("lastDosesOf follows getLastDosePerMedication's rule", () => {
    const [vitd, lis, met] = demoMedications();
    const at = (iso: string) => new Date(iso);
    const rows = [
      doseRow(
        {
          id: "a",
          medicationId: vitd.id,
          takenAt: at("2026-09-23T09:05:00Z"),
          quantity: 1,
          status: "taken",
        },
        vitd,
      ),
      doseRow(
        {
          id: "b",
          medicationId: vitd.id,
          takenAt: at("2026-09-24T09:05:00Z"),
          quantity: 1,
          status: "skipped",
        },
        vitd,
      ),
      doseRow(
        {
          id: "c",
          medicationId: lis.id,
          takenAt: at("2026-09-24T08:00:00Z"),
          quantity: 1,
          status: "skipped",
        },
        lis,
      ),
      doseRow(
        {
          id: "d",
          medicationId: met.id,
          takenAt: at("2026-09-24T07:00:00Z"),
          quantity: 1,
          status: "missed",
        },
        met,
      ),
    ];

    expect(lastDosesOf(rows)).toEqual([
      {
        medicationId: vitd.id,
        lastTakenAt: at("2026-09-23T09:05:00Z"),
        lastEventAt: at("2026-09-24T09:05:00Z"),
      },
      { medicationId: lis.id, lastTakenAt: null, lastEventAt: at("2026-09-24T08:00:00Z") },
    ]);
  });

  it("PHONE_LATER_ROWS shows a non-empty prefix of the phone's Later list, before and after the tap", () => {
    expect(Number.isInteger(PHONE_LATER_ROWS)).toBe(true);
    expect(PHONE_LATER_ROWS).toBeGreaterThanOrEqual(1);
    expect(PHONE_LATER_ROWS).toBeLessThanOrEqual(
      Math.min(PHONE_BEFORE.later.length, PHONE_AFTER.later.length),
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`

Expected: FAIL, with no tests collected:

```
Error: Cannot find module '$lib/components/walkthrough/demo-dashboard' imported from …/tests/unit/walkthrough-dashboard-fidelity.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

- [ ] **Step 4: Write `demo-dashboard.ts`**

Create `src/lib/components/walkthrough/demo-dashboard.ts`. The instants, keys, states, actions and counts are literal, copied from the probe output in the table above. The label fields (name, dose, colours, pattern) come from `MEDICATION_BY_ID` through `label()`, so a colour is never written twice.

```ts
// The dashboard as the walkthrough draws it, at the four story moments: the
// desktop at 08:02 before and after Lisinopril's Log now, and the phone at
// 10:12 before and after Vitamin D's.
//
// These are values, not a computation. The stage is client code and never
// imports the server composer, so the moments are written out here, and
// tests/unit/walkthrough-dashboard-fidelity.test.ts runs the real
// composeDashboardPageData over DEMO_DOSES at each moment and asserts that
// each constant equals its output. Editing a row here, or changing the
// matcher in a way that would make the video untrue, fails that test.
//
// A row that appears in both halves of a before/after pair is the same
// object in both, so it is identical by construction: the scene grows a row
// only in AFTER, collapses a row only in BEFORE, and leaves the rest alone.

import type { DashboardStatus, DoneRow, DueCard, LaterRow } from "$lib/types";
import {
  DESKTOP_NOW,
  MEDICATION_BY_ID,
  MEDICATIONS,
  PHONE_NOW,
  type MedicationId,
} from "./demo-data";

export type StageDone = Pick<DoneRow, "key" | "covers" | "dayLabel"> & {
  dose: {
    id: string;
    medicationId: string;
    takenAt: Date;
    quantity: number;
    status: "taken" | "skipped";
    name: string;
    dosageAmount: string;
    dosageUnit: string;
    colour: string;
    colourSecondary: string | null;
    pattern: string;
  };
};

export type StageMedication = {
  id: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
};

/** The part of the dashboard payload the stage draws, at one instant. */
export type StageMoment = {
  now: Date;
  todayStart: Date;
  status: DashboardStatus;
  earlier: DueCard[];
  today: DueCard[];
  done: StageDone[];
  later: LaterRow[];
  medications: StageMedication[];
};

/** The story day's UTC midnight: `dashboardWindow(now, "UTC").todayStart` at both clocks. */
const STORY_DAY_START = new Date("2026-09-24T00:00:00.000Z");

/** The label fields every dashboard row carries, copied from the demo medication. */
function label(id: MedicationId): Omit<StageMedication, "id"> {
  const m = MEDICATION_BY_ID[id];
  return {
    name: m.name,
    dosageAmount: m.amount,
    dosageUnit: m.unit,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
    pattern: m.pattern,
  };
}

/** The chip list: every medication, in the demo's order. */
const STAGE_MEDICATIONS: StageMedication[] = MEDICATIONS.map((m) => ({ id: m.id, ...label(m.id) }));

function done(
  id: string,
  medicationId: MedicationId,
  takenAt: string,
  covers: string[],
): StageDone {
  return {
    key: id,
    covers,
    dayLabel: null,
    dose: {
      id,
      medicationId,
      takenAt: new Date(takenAt),
      quantity: 1,
      status: "taken",
      ...label(medicationId),
    },
  };
}

function later(medicationId: MedicationId, expectedTime: string): LaterRow {
  return {
    key: `${medicationId}:${expectedTime}`,
    medicationId,
    ...label(medicationId),
    expectedTime,
  };
}

// ── Rows, each shared by every moment that shows it ──

/** 08:02: Lisinopril's 08:00 slot, two minutes ago. Log now and Skip; Took it at is hidden beside Log now. */
const DUE_LISINOPRIL_0800: DueCard = {
  key: "today:lis",
  medicationId: "lis",
  ...label("lis"),
  rows: [
    {
      key: "lis:2026-09-24T08:00:00.000Z",
      kind: "fixed_time",
      expectedTime: "2026-09-24T08:00:00.000Z",
      state: "due-now",
      logNow: true,
      tookItAt: null,
      skipAt: "2026-09-24T08:00:00.000Z",
    },
  ],
};

/** 10:12: Vitamin D's 09:05 slot, 67 minutes ago, so overdue. Log now, Took it at 09:05 and Skip. */
const DUE_VITAMIN_D_0905: DueCard = {
  key: "today:vitd",
  medicationId: "vitd",
  ...label("vitd"),
  rows: [
    {
      key: "vitd:2026-09-24T09:05:00.000Z",
      kind: "interval",
      expectedTime: "2026-09-24T09:05:00.000Z",
      state: "overdue",
      logNow: true,
      tookItAt: "2026-09-24T09:05:00.000Z",
      skipAt: "2026-09-24T09:05:00.000Z",
    },
  ],
};

const DONE_IBUPROFEN_0610 = done("dose-ibu-20260924-0610", "ibu", "2026-09-24T06:10:00.000Z", []);
const DONE_METFORMIN_0748 = done("dose-met-20260924-0748", "met", "2026-09-24T07:48:00.000Z", []);
/** The desktop beat's dose. Two minutes after its slot, so it says "for 08:00". */
const DONE_LISINOPRIL_0802 = done("dose-lis-20260924-0802", "lis", "2026-09-24T08:02:00.000Z", [
  "2026-09-24T08:00:00.000Z",
]);
/** The phone beat's dose. The interval re-anchors on it, so it covers no other slot. */
const DONE_VITAMIN_D_1012 = done("dose-vitd-20260924-1012", "vitd", "2026-09-24T10:12:00.000Z", []);

const LATER_VITAMIN_D_0905 = later("vitd", "2026-09-24T09:05:00.000Z");
const LATER_IBUPROFEN_1410 = later("ibu", "2026-09-24T14:10:00.000Z");
const LATER_METFORMIN_1948 = later("met", "2026-09-24T19:48:00.000Z");
const LATER_MAGNESIUM_2205 = later("mag", "2026-09-24T22:05:00.000Z");
const LATER_IBUPROFEN_2210 = later("ibu", "2026-09-24T22:10:00.000Z");

// ── The four moments ──

export const DESKTOP_BEFORE: StageMoment = {
  now: DESKTOP_NOW,
  todayStart: STORY_DAY_START,
  status: { kind: "due", dueCount: 1, doneToday: 2, totalToday: 8, loggedToday: 2, next: null },
  earlier: [],
  today: [DUE_LISINOPRIL_0800],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
    LATER_IBUPROFEN_2210,
  ],
  medications: STAGE_MEDICATIONS,
};

export const DESKTOP_AFTER: StageMoment = {
  now: DESKTOP_NOW,
  todayStart: STORY_DAY_START,
  status: {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 3,
    totalToday: 8,
    loggedToday: 3,
    next: {
      name: "Vitamin D",
      dosageAmount: "1000",
      dosageUnit: "IU",
      expectedTime: "2026-09-24T09:05:00.000Z",
      alsoCount: 0,
    },
  },
  earlier: [],
  today: [],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
    LATER_IBUPROFEN_2210,
  ],
  medications: STAGE_MEDICATIONS,
};

export const PHONE_BEFORE: StageMoment = {
  now: PHONE_NOW,
  todayStart: STORY_DAY_START,
  status: { kind: "due", dueCount: 1, doneToday: 3, totalToday: 8, loggedToday: 3, next: null },
  earlier: [],
  today: [DUE_VITAMIN_D_0905],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802],
  later: [LATER_IBUPROFEN_1410, LATER_METFORMIN_1948, LATER_MAGNESIUM_2205, LATER_IBUPROFEN_2210],
  medications: STAGE_MEDICATIONS,
};

export const PHONE_AFTER: StageMoment = {
  now: PHONE_NOW,
  todayStart: STORY_DAY_START,
  status: {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 4,
    totalToday: 8,
    loggedToday: 4,
    next: {
      name: "Ibuprofen",
      dosageAmount: "200",
      dosageUnit: "mg",
      expectedTime: "2026-09-24T14:10:00.000Z",
      alsoCount: 0,
    },
  },
  earlier: [],
  today: [],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802, DONE_VITAMIN_D_1012],
  later: [LATER_IBUPROFEN_1410, LATER_METFORMIN_1948, LATER_MAGNESIUM_2205, LATER_IBUPROFEN_2210],
  medications: STAGE_MEDICATIONS,
};

/**
 * How many of the phone's Later rows PhoneScene shows: `later.slice(0, PHONE_LATER_ROWS)`.
 * The phone's content box is 732px tall and the home indicator covers its
 * bottom, so the list is cut at a whole row rather than through one. The
 * phone-before screenshot confirms the number; it is chosen, not derived.
 */
export const PHONE_LATER_ROWS = 2;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: PASS, `Tests  14 passed (14)`, with these names under `walkthrough dashboard moments: data`:

```
✓ 'DESKTOP_BEFORE' equals the real composer's output at its moment
✓ 'DESKTOP_AFTER' equals the real composer's output at its moment
✓ 'PHONE_BEFORE' equals the real composer's output at its moment
✓ 'PHONE_AFTER' equals the real composer's output at its moment
✓ 'desktop': the AFTER input is the BEFORE input plus exactly the logged dose, taken ×1 at that moment
✓ 'phone': the AFTER input is the BEFORE input plus exactly the logged dose, taken ×1 at that moment
✓ 'desktop': Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done
✓ 'phone': Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done
✓ 'desktop': a row in both halves of the beat is identical in both
✓ 'phone': a row in both halves of the beat is identical in both
✓ 'desktop': the offer oracle reads the logged dose's Done row, and refuses a payload without one
✓ 'phone': the offer oracle reads the logged dose's Done row, and refuses a payload without one
✓ lastDosesOf follows getLastDosePerMedication's rule
✓ PHONE_LATER_ROWS shows a non-empty prefix of the phone's Later list, before and after the tap
```

If a moment test fails, do not edit the expectation to match. Instead:

1. Read the diff to see which field the composer disagrees on.
2. Check that Task 4's `DEMO_DOSES` holds exactly the ten doses in the table's story, with the ids `LOGGED_DOSE` names.
3. Check that each `DemoMedication.schedule` matches `scripts/seed-demo.ts`.

- [ ] **Step 6: Stage the two new files, so each mutation below is undone with `git checkout --`**

```bash
git add src/lib/components/walkthrough/demo-dashboard.ts tests/unit/walkthrough-dashboard-fidelity.test.ts
```

`git checkout -- <path>` restores a file from the index. For these two new files, the index is the version just staged. For the two tracked files, it is HEAD.

- [ ] **Step 7: Mutation 1. Drop one Later row from a moment.**

In `src/lib/components/walkthrough/demo-dashboard.ts`, inside `DESKTOP_BEFORE`, replace:

```ts
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
    LATER_IBUPROFEN_2210,
  ],
```

with:

```ts
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748],
  later: [
    LATER_VITAMIN_D_0905,
    LATER_IBUPROFEN_1410,
    LATER_METFORMIN_1948,
    LATER_MAGNESIUM_2205,
  ],
```

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `1 failed | 13 passed`. The failing test is `'DESKTOP_BEFORE' equals the real composer's output at its moment`, and its diff shows `later` missing the `ibu:2026-09-24T22:10:00.000Z` row.

Restore: `git checkout -- src/lib/components/walkthrough/demo-dashboard.ts`

- [ ] **Step 8: Mutation 2. Move a card from `today` to `earlier`.**

In `src/lib/components/walkthrough/demo-dashboard.ts`, inside `DESKTOP_BEFORE`, replace:

```ts
  earlier: [],
  today: [DUE_LISINOPRIL_0800],
```

with:

```ts
  earlier: [DUE_LISINOPRIL_0800],
  today: [],
```

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `2 failed | 12 passed`. The failing tests are:

- `'DESKTOP_BEFORE' equals the real composer's output at its moment`: `earlier` and `today` are compared separately, so a card in the wrong sub-group fails even though the card itself is right;
- `'desktop': Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done`.

Restore: `git checkout -- src/lib/components/walkthrough/demo-dashboard.ts`

- [ ] **Step 9: Mutation 3. The beat's dose is not logged at the moment of the tap.**

In `src/lib/components/walkthrough/demo-data.ts`, in `LOGGED_DOSE`, replace:

```ts
  desktop: "dose-lis-20260924-0802",
```

with:

```ts
  desktop: "dose-met-20260924-0748",
```

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `3 failed | 11 passed`. The failing tests are:

- `'DESKTOP_BEFORE' equals the real composer's output at its moment`;
- `'desktop': the AFTER input is the BEFORE input plus exactly the logged dose, taken ×1 at that moment`: the added dose's `takenAt` is 07:48, not `DESKTOP_NOW`;
- `'desktop': Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done`.

Restore: `git checkout -- src/lib/components/walkthrough/demo-data.ts`

- [ ] **Step 10: Mutation 4. An empty or oversized phone Later prefix.**

In `src/lib/components/walkthrough/demo-dashboard.ts`, replace `export const PHONE_LATER_ROWS = 2;` with `export const PHONE_LATER_ROWS = 0;`.

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `1 failed | 13 passed`. The failing test is `PHONE_LATER_ROWS shows a non-empty prefix of the phone's Later list, before and after the tap`. The value `5` also fails it, because the phone list has 4 rows.

Restore: `git checkout -- src/lib/components/walkthrough/demo-dashboard.ts`

- [ ] **Step 11: Mutation 5. A row that differs between the two halves of a beat.**

In `src/lib/components/walkthrough/demo-dashboard.ts`, inside `DESKTOP_AFTER`, replace:

```ts
  today: [],
  done: [DONE_IBUPROFEN_0610, DONE_METFORMIN_0748, DONE_LISINOPRIL_0802],
```

with:

```ts
  today: [],
  done: [
    DONE_IBUPROFEN_0610,
    done("dose-met-20260924-0748", "met", "2026-09-24T07:48:00.000Z", ["2026-09-24T07:00:00.000Z"]),
    DONE_LISINOPRIL_0802,
  ],
```

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `2 failed | 12 passed`. The failing tests are:

- `'DESKTOP_AFTER' equals the real composer's output at its moment`;
- `'desktop': a row in both halves of the beat is identical in both`. The scene only grows or collapses rows, so a row that changes in place would be drawn wrong.

Restore: `git checkout -- src/lib/components/walkthrough/demo-dashboard.ts`

- [ ] **Step 12: Mutation 6. The offer path ignores the Done row's covers.**

In `src/lib/components/dashboard/dose-toasts.ts`, inside `logToastFromReload`, replace:

```ts
    covers: row.covers.map((iso) => new Date(iso)),
```

with:

```ts
    covers: [],
```

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts --reporter=verbose`

Expected: FAIL, `1 failed | 13 passed`. The failing test is `'desktop': the offer oracle reads the logged dose's Done row, and refuses a payload without one`. Lisinopril's row covers 08:00, so the offer must differ from the plain sentence. The phone case passes, because Vitamin D covers nothing.

Restore: `git checkout -- src/lib/components/dashboard/dose-toasts.ts`

- [ ] **Step 13: Confirm everything is restored**

Run: `git status --short && npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`

Expected:

- the status lists exactly `A  src/lib/components/walkthrough/demo-dashboard.ts` and `A  tests/unit/walkthrough-dashboard-fidelity.test.ts`;
- the test run reports `Tests  14 passed (14)`.

- [ ] **Step 14: Run the gates**

Run each, in order:

```bash
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **Both `vitest` runs pass**, with one more file and 14 more tests than at the end of Task 4. Name any failing test before doing anything else.
- **`npm run check`:** 0 errors, and at most 27 warnings.
- **`npm run lint`:** 0 errors, and at most 115 warnings. Neither new file adds a warning, because every helper the test file defines is used or exported.
- **`npm run format:check`:** clean.

- [ ] **Step 15: Commit**

```bash
git add src/lib/components/walkthrough/demo-dashboard.ts tests/unit/walkthrough-dashboard-fidelity.test.ts
git commit -F - <<'EOF'
feat(walkthrough): add the stage's dashboard moments, checked against the real composer

demo-dashboard.ts holds the four moments the redrawn dashboard and phone
scenes draw: the desktop at 08:02 before and after Lisinopril's Log now,
and the phone at 10:12 before and after Vitamin D's. They are written-out
values, because the stage is client code and never imports the composer.

walkthrough-dashboard-fidelity.test.ts runs the real
composeDashboardPageData over DEMO_DOSES at each moment, with the inputs
loadDashboard would pass, and asserts each moment equals its output. It
also checks the beats themselves:
- each AFTER input is its BEFORE input plus one dose, taken x1 at that
  moment;
- Log now sits on the only Due card;
- a row in both halves of a beat is identical.

The offer-text oracle (logToastFromReload over the AFTER payload) lives
here for the render checks that follow.
EOF
```

#### Notes for the reviewer

- **Task 4 is a hard dependency.**
  - **What this task imports from Task 4.** The test needs `DEMO_DOSES`, `LOGGED_DOSE`, `DEMO_STARTED_AT`, `WALKTHROUGH_TZ`, both story clocks and `DemoMedication.schedule`.
  - **How the literals were checked.** A typed stand-in for those exports produced and checked them. It held the ten doses, ids, `DemoDose` shape and `DemoSchedule` shape from the contract, which are also exactly what the Task 4 writer's own probe holds.
  - **If Task 4 differs**, Step 5's moment tests say so field by field. For example, an extra dose inside the fetch window, or a different id format, would show there.
- **"Literal data" is read as literal facts, with label fields shared.**
  - **Literal:** every instant, key, state, button, count and `next`, copied from the probe.
  - **Shared through `label()`:** name, dose, colour and pattern come from `MEDICATION_BY_ID`, so the demo palette is stated once.
  - **Still checked:** the comparison with the composer covers the shared fields too. A wrong colour in demo-data fails the moment tests, and no test can pass on a copied mistake.
- **Shared row objects make "a row in both is identical" true by construction for these literals.**
  - **Why the test still matters.** It guards against hand-writing a divergent row (mutation 5).
  - **The case it is really for.** After a future composer change, someone updates the literals to the new output, and the composer now changes a row in place. This test then fails on its own, and says the scenes' grow-and-collapse model no longer fits.
- **`lastDoses` comes from the filtered list, as the spec says, not all-time as `getLastDosePerMedication` does.**
  - **Why that is safe here.** Every medication has an in-window dose, so the maxima are the same either way.
  - **Why it is also correct.** The all-time version would see the phone's 10:12 dose at 08:02, a dose that does not exist yet at that point in the story.
  - **The ordering.** Doses are passed newest first, as `getDosesInRange` orders them. The matcher's tie-breaks are by id, and Done sorts itself, so the order does not change the output; it is mirrored anyway.
- **The test file exports its helpers.**
  - **Why.** Tasks 7 and 8 add `describe` blocks to this same file, and an unexported, unused helper would add a lint warning above the baseline.
  - **The guard.** The header comment says never to import the file elsewhere: vitest would run its cases twice.
  - **Precedent.** No existing test file exports anything. This is the first.
- **`PHONE_LATER_ROWS = 2` is a provisional estimate.** The usable content height is 732 − 34 ≈ 698px. Above the Later list:
  - the header (eyebrow, "Today", sentence and supporting line, with `space-y-1`) is about 112px;
  - the overdue Due card is about 150–174px. **Took it at 09:05** and **Skip** may wrap under the 48px Log now at 402px wide;
  - Done (heading plus three 52px rows) is about 192px;
  - three `gap-6` gaps are 72px.

  That leaves about 148–172px. The Later heading is 32px and each row 40px, so 2 rows fit in the worst case and 3 in the best. Task 10's screenshot decides; only the constant changes, and the bounds test still holds for any value up to 4.

- **Mutation 6 temporarily edits `dose-toasts.ts`**, a file this task does not otherwise touch. It is the production line that the offer oracle depends on, and Step 13 confirms it is restored.
- **Review Focus.** The header assigns none of the five items to this task. The moments are fixed `Date`s and ISO strings, and read no clock or zone. Review Focus 1 (a far-away visitor's clock) is tested in Tasks 7 and 8 over these moments.

#### Interface notes (deviations from the planning contract)

1. **The contract under-states what T5 gives later tasks.** Its T5 section names two test-file helpers, `buildInputs` and `toStageMoment`, with no return types. Later tasks rely on more than that:
   - T8 calls `MOMENTS[2]`, `MOMENTS[3]`, `composeMoment` and `expectedOfferText`.
   - T7 lists `buildInputs`'s meaning as an open issue in its own CONTRACT ISSUES.

   This task keeps every name the contract has. It adds the names below, and the contract's T5 section should list them as written here.
   - **In `demo-dashboard.ts`.** `PHONE_LATER_ROWS = 2` is provisional.
     - Only T10 changes it, in its Step 20, and that step can only lower it, after a phone screenshot finds a Later row cut.
     - No other task edits the value, and no test pins `2`. T5's bounds test accepts any value from 1 to 4.
   - **In `walkthrough-dashboard-fidelity.test.ts`, as module-level exports:**
     - `export type ComposedPayload = ReturnType<typeof composeDashboardPageData>;`
     - `buildInputs(now: Date, includeIds: readonly string[] | "all-at-or-before-now"): DashboardCompositionInputs`. A list picks those `DEMO_DOSES` ids, and an unknown id throws. Either way, the doses are then cut to `takenAt <= now` and to `dashboardWindow`'s fetch range, and sorted newest first. This is the meaning T7 assumed, so it settles T7's issue.
     - `toStageMoment(payload: ComposedPayload): StageMoment`. It throws on a missed Done row, because the stage never draws one.
     - `lastDosesOf(doses: readonly DoseLogWithMedication[]): DashboardCompositionInputs["lastDoses"]`. It applies `getLastDosePerMedication`'s rule to the doses already cut by `buildInputs`.
     - `type MomentCase = { name: string; moment: StageMoment; now: Date; include: readonly string[] | "all-at-or-before-now" }`.
     - `MOMENTS: readonly MomentCase[]`, with indexes 0 to 3 holding `DESKTOP_BEFORE`, `DESKTOP_AFTER`, `PHONE_BEFORE` and `PHONE_AFTER`. T8 reads `MOMENTS[2]` and `MOMENTS[3]` by index, so this order is part of the interface.
     - `composeMoment(c: MomentCase): ComposedPayload`.
     - `expectedOfferText(after: ComposedPayload, doseId: string, timeFormat: TimeFormat): string`. It throws when `after` has no Done row for `doseId`.
     - `BEATS`, declared `as const`: `[{ surface: "desktop", before: MOMENTS[0], after: MOMENTS[1], doseId: LOGGED_DOSE.desktop }, { surface: "phone", before: MOMENTS[2], after: MOMENTS[3], doseId: LOGGED_DOSE.phone }]`.

2. **A `StageMoment` is not a valid `reloaded` argument for `logToastFromReload`, and the contract does not say so.**
   - **Why.** That function needs `todayStart` as a string, and it reads the label from `dose.medication` (`dose-toasts.ts:31-43`). A `StageMoment` has a `Date` there and flat label fields instead.
   - **What happens.** The guard at `dose-toasts.ts:34` sends it to the fallback sentence, without covers, and nothing throws. Lisinopril's offer would lose "counted for your 8:00 dose" with no error.
   - **What the stage does instead.** It builds the offer with `toastForLog` over the `StageDone` row, and the render checks compare that with `expectedOfferText` over the composer's payload. T7's `stageLogToast` already works this way.
   - **What the contract needs.** A line saying this, beside `StageUndoOffer`'s `message` prop.
3. **Every top-level name in the test file belongs to T5.** T7 and T8 add their code to the same module, so declaring any of the names above a second time would not compile.
   - T7 and T8 as written declare none of them.
   - T7's `type DashboardPayload` is the same type as `ComposedPayload` under another name. That compiles, but T7 could use `ComposedPayload` instead.

### Task 6: Engine: scene renames, true captions, landing copy, REQUIRED_MARKS and MARKS_CONTEXT

This task changes no pixels on the stage. It renames two scenes, makes four captions and the landing line true, and adds the two guards the redraw tasks lean on:

- **`REQUIRED_MARKS`**: every mark key `computeFrame` reads, checked by recording real reads rather than grepping.
- **`MARKS_CONTEXT`**: the marks context key, exported so a test can mount part of the stage with its own registry.

`REQUIRED_MARKS` lists the **current** 28 keys. No mark key contains a scene name, so the scene renames rename no mark. T7 and T8 edit the list and the `MEASURED` fixture in the same commit that changes a read.

**Files:**

- Modify: `src/lib/components/walkthrough/timeline.ts`
  - `:16-18`: `SCENES`, two names.
  - after `:46`: `T_LOG` and `T_TAP`.
  - `:161-178`, `:194` and `:249`: `LOWER_THIRDS` 01, 02, 04 and 10.
  - before `:326`: `REQUIRED_MARKS`, above `computeFrame`'s doc comment.
  - `:343-348`: the key-moments block.
  - `:362-397`: the Today and LogNow shots.
  - `:513-514`: the phone touch.
  - `:525-531`, `:536-541`, `:559-560` and `:566-567`: the return values.
- Modify: `src/lib/components/walkthrough/marks.ts:11`, `:28` and `:33`.
- Modify: `src/lib/components/walkthrough/scenes/DashboardScene.svelte:3`. This is the comment only.
- Modify: `src/routes/+page.svelte:99`.
- Test, modify: `tests/unit/walkthrough-timeline.test.ts`.
  - `:2-19`: imports.
  - after `:32`: the helpers.
  - `:74-77`: the scenes describe.
  - `:89`, `:97`, `:136-138`, `:145`, `:158-159` and `:209`: pins and one insertion.
  - before `:222`: new `it`s and describes.
- Test, create: `tests/unit/walkthrough-marks.svelte.test.ts`.

Line numbers are at base `311758f`. T1–T5 do not modify any of these files. Every anchor in the test file avoids the demo-data import (`:20-25`) and the `walkthrough demo data` describe (`:252-288`), so the anchors still match even if an earlier task touched those lines.

**Interfaces:**

- **Consumes.** Nothing from T1–T5. It uses these existing names:
  - `DOSE_UNDO_WINDOW_MS` from `$lib/utils/dose-undo` (= `10 * 60_000`).
  - `ssrDocument(bodyHtml: string): Document` from `tests/unit/helpers/axe-ssr.ts`.
  - `textOf(el: Element): string` from `tests/unit/helpers/dom-names.ts`.
  - `createMarkRegistry(): MarkRegistry` from `marks.ts`.
  - `FieldBox.svelte`'s props `{ label: string; markKey?: string; … }`.
- **Produces.** Later tasks rely on these:
  - **Scene names.** `SceneName` becomes `"Title" | "Today" | "LogNow" | "Medications" | "Timers" | "AddMedication" | "History" | "Analytics" | "Security" | "Export" | "Reminders" | "Outro"`.
    - The cues (probed): `Title` 0, `Today` 2.5, `LogNow` 6, `Medications` 10, `Timers` 13.5, `AddMedication` 17, `History` 21, `Analytics` 24.5, `Security` 28.5, `Export` 32, `Reminders` 35.5, `Outro` 40.5. `TOTAL_DURATION` is 43.5.
  - **The beats.** `export const T_LOG = CUES.LogNow + 1.45;` (7.45) and `export const T_TAP = CUES.Reminders + 3.0;` (38.5).
    - `computeFrame` has no `tLog`/`tTap` locals any more. It reads `T_LOG` and `T_TAP`.
    - The desktop cursor's click ripple starts at exactly `T_LOG`, and the phone's `touch.press` is exactly 1 at `T_TAP`.
  - **`export const REQUIRED_MARKS: readonly string[]`**, in this order:
    - `"d.page"`, `"d.strip"`, `"d.morning"`, `"d.evening"`, `"d.night"`, `"d.quick"`, `"d.lisPill"`, `"o.toast"`;
    - `"m.card0"`–`"m.card3"`;
    - `"a.h1"`, `"a.name"`, `"a.dose"`, `"a.amount"`, `"a.unit"`, `"a.category"`;
    - `"l.h1"`, `"l.form"`, `"l.check"`;
    - `"n.stats"`, `"n.heatTitle"`, `"n.heatGrid"`;
    - `"s.twofa"`, `"x.export"`, `"x.download"`;
    - `"p.vitdLog"`.
  - **`export const MARKS_CONTEXT = Symbol("walkthrough-marks");`** in `marks.ts`. `provideMarks` and `useMark` use it, and nothing else defines a marks key.
  - **In `tests/unit/walkthrough-timeline.test.ts`.**
    - Two new module-level helpers sit beside `samples` and `MEASURED`:
      - `recordingMeasurements(base: Measurements, read: Set<string>): Measurements`;
      - `source(rel: string): string`, which returns a repo file with its whitespace squashed.
    - The `REQUIRED_MARKS` describe compares sorted lists. So T7 and T8 change only `REQUIRED_MARKS` and `MEASURED`, never the describe.
  - **Caption copy.** 01, 02, 04 and 10 are exactly as in Global Constraints. 03 and 05–09 are unchanged.

- [ ] **Step 1: Write the failing timeline tests**

Make these ten edits to `tests/unit/walkthrough-timeline.test.ts`, each an exact old → new replacement.

**1a. Imports.**

Old:

```ts
import { describe, it, expect } from "vitest";
import {
  CUES,
  LOWER_THIRDS,
  SCENES,
  STAGE_H,
  STAGE_W,
  TOTAL_DURATION,
  WIN_H,
  WIN_W,
  activeCaption,
```

New:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";
import {
  CUES,
  LOWER_THIRDS,
  REQUIRED_MARKS,
  SCENES,
  STAGE_H,
  STAGE_W,
  TOTAL_DURATION,
  T_LOG,
  T_TAP,
  WIN_H,
  WIN_W,
  activeCaption,
```

**1b. Helpers, after `samples`.**

Old:

```ts
/** Sample every 20ms across the loop. */
const samples = Array.from({ length: Math.ceil(TOTAL_DURATION / 0.02) }, (_, i) => i * 0.02);
```

New:

```ts
/** Sample every 20ms across the loop. */
const samples = Array.from({ length: Math.ceil(TOTAL_DURATION / 0.02) }, (_, i) => i * 0.02);

/**
 * The measurements, wrapped so every key read off them lands in `read`. Reads
 * are recorded rather than grepped from timeline.ts, because a key built at
 * runtime ("m.card" + i) never appears in the source as a literal.
 */
function recordingMeasurements(base: Measurements, read: Set<string>): Measurements {
  return new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === "string") read.add(key);
      return Reflect.get(target, key, receiver);
    },
    has(target, key) {
      if (typeof key === "string") read.add(key);
      return Reflect.has(target, key);
    },
  });
}

/** A repo file's text with whitespace squashed, so prettier's wrapping cannot matter. */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8").replace(
    /\s+/g,
    " ",
  );
}
```

**1c. Scene and beat pins, at the end of `describe("walkthrough scenes")`.**

Old:

```ts
    expect(TOTAL_DURATION).toBe(43.5);
  });
});
```

New:

```ts
    expect(TOTAL_DURATION).toBe(43.5);
  });

  // Spec D2: the same twelve scenes, durations and 43.5s loop. Two are renamed
  // for what they now show, the Today page and its Log now button.
  it("keeps twelve scenes and their durations, named for what each one shows", () => {
    expect(SCENES.map((s) => [s.name, s.dur])).toEqual([
      ["Title", 2.5],
      ["Today", 3.5],
      ["LogNow", 4],
      ["Medications", 3.5],
      ["Timers", 3.5],
      ["AddMedication", 4],
      ["History", 3.5],
      ["Analytics", 4],
      ["Security", 3.5],
      ["Export", 3.5],
      ["Reminders", 5],
      ["Outro", 3],
    ]);
  });

  it("keys the two log beats to their own scenes", () => {
    expect(T_LOG).toBeCloseTo(CUES.LogNow + 1.45, 9);
    expect(T_TAP).toBeCloseTo(CUES.Reminders + 3.0, 9);
    expect(T_LOG).toBeLessThan(CUES.Medications);
    expect(T_TAP).toBeLessThan(CUES.Outro);
  });
});
```

**1d. Shot list.** This is a changed pin: the scene was renamed (spec D2). It is the same instant with the same expectation.

Old:

```ts
expect(computeFrame(CUES.MyDay + 0.1, MEASURED).kind).toBe("desk");
```

New:

```ts
expect(computeFrame(CUES.Today + 0.1, MEASURED).kind).toBe("desk");
```

**1e. Pages.** A changed pin, for the same reason: same instant, same page.

Old:

```ts
expect(pageAt(CUES.QuickLog + 1)).toBe("dash");
```

New:

```ts
expect(pageAt(CUES.LogNow + 1)).toBe("dash");
```

**1f. The Lisinopril log.** A changed pin: the scene rename only.

- The offsets (+1 and +2.5) and every assertion are unchanged. The test still brackets the log, because `T_LOG` is +1.45.
- T7 replaces this test's `count`/`lisinoprilDone` assertions when it replaces `Frame.dashboard`.

Old:

```ts
  it("logs Lisinopril exactly once, during Quick Log", () => {
    const before = computeFrame(CUES.QuickLog + 1, MEASURED).dashboard;
    const after = computeFrame(CUES.QuickLog + 2.5, MEASURED).dashboard;
```

New:

```ts
  it("logs Lisinopril exactly once, during Log now", () => {
    const before = computeFrame(CUES.LogNow + 1, MEASURED).dashboard;
    const after = computeFrame(CUES.LogNow + 2.5, MEASURED).dashboard;
```

**1g. The click and tap instants,** inserted before the typing test.

Old:

```ts
  it("types the new medication a character at a time and never past its end", () => {
```

New:

```ts
  // T_LOG and T_TAP are the instants computeFrame animates around, not two
  // numbers that merely agree with it: the click lands on one, the tap on the other.
  it("clicks to log at T_LOG on the desktop and taps at T_TAP on the phone", () => {
    expect(computeFrame(T_LOG - 0.01, MEASURED).cursor?.ripple).toBeNull();
    expect(computeFrame(T_LOG, MEASURED).cursor?.ripple?.p).toBe(0);
    expect(computeFrame(T_TAP - 0.2, MEASURED).phone.touch?.press).toBe(0);
    expect(computeFrame(T_TAP, MEASURED).phone.touch?.press).toBe(1);
  });

  it("types the new medication a character at a time and never past its end", () => {
```

**1h. The cursor-per-scene table.** A changed pin: the scene rename only. The Today shot still has no cursor, and the LogNow shot still has one.

Old:

```ts
expect(withCursor(CUES.MyDay + 1)).toBe(false);
expect(withCursor(CUES.QuickLog + 1)).toBe(true);
```

New:

```ts
expect(withCursor(CUES.Today + 1)).toBe(false);
expect(withCursor(CUES.LogNow + 1)).toBe(true);
```

**1i. The caption window.** A changed pin: the scene rename only. The first scene after the title card is still where captions may begin.

Old:

```ts
      if (t < CUES.MyDay || t >= CUES.Outro) {
```

New:

```ts
      if (t < CUES.Today || t >= CUES.Outro) {
```

**1j. New captions tests, then three new describes, before `describe("camera helpers")`.**

- It contains the Review Focus 3 tests.
- `"quick log"` is banned alongside the three phrases the header names.
- The figcaption check renders the real component under SSR (`WalkthroughVideo.svelte:184-191` builds it from `LOWER_THIRDS`). It reads `.body`, because `render()` is lazy.

Old:

```ts
      expect(caption.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe("camera helpers", () => {
```

New:

```ts
      expect(caption.opacity).toBeLessThanOrEqual(1);
    }
  });

  // Spec Section 1's table, verbatim. Captions 03 and 05-09 were checked and are true.
  it("says what the redrawn walkthrough shows", () => {
    const byNumber = new Map(LOWER_THIRDS.map((l) => [l.number, l]));
    expect(byNumber.get("01")).toMatchObject({
      scene: "Today",
      until: "LogNow",
      title: "Today",
      line: "What's due now, what's done and what's next.",
      tech: "Every row on the page decided by one matcher, on the server",
    });
    expect(byNumber.get("02")).toMatchObject({
      scene: "LogNow",
      until: "Medications",
      title: "Log now",
      line: "One tap to log, and Undo for ten minutes.",
      tech: "Single-fire writes, re-checked under a row lock on the server",
    });
    expect(byNumber.get("04")).toMatchObject({
      title: "Live timers",
      line: "When each medication was last taken, always current.",
      tech: "Recomputed every minute, with a visibilitychange catch-up",
    });
    expect(byNumber.get("10")).toMatchObject({
      title: "Reminders",
      line: "Overdue reminders by push and email.",
      tech: "Web Push on a half-hourly daytime sweep, with idempotent dedupe keys",
    });
  });

  // Review Focus 3. Each phrase was true once and is not now: since #170 the
  // dashboard has no "My Day" grouping and calls its chips "Log something
  // else", no page has shown a next-due time since 0b8c95f, and the reminder
  // sweep is GitHub Actions' reminder-tick, with Vercel Cron a daily backstop.
  it("never names a feature the app no longer has", () => {
    for (const item of LOWER_THIRDS) {
      const said = `${item.title} ${item.line} ${item.tech}`.toLowerCase();
      for (const stale of ["my day", "quick log", "next due", "vercel cron"]) {
        expect(said, `caption ${item.number} says "${stale}"`).not.toContain(stale);
      }
    }
  });

  // Two captions make claims about the code. Each is tied to the thing it
  // describes, so changing that thing fails here until the caption follows.
  it("keeps its claims about the Undo window and the reminder sweep true", () => {
    const logNow = LOWER_THIRDS.find((l) => l.number === "02");
    expect(logNow?.line).toContain("Undo for ten minutes");
    expect(DOSE_UNDO_WINDOW_MS).toBe(10 * 60_000);
    const reminders = LOWER_THIRDS.find((l) => l.number === "10");
    expect(reminders?.tech).toContain("half-hourly daytime sweep");
    expect(source(".github/workflows/reminder-tick.yml")).toContain('cron: "*/30 6-22 * * *"');
  });
});

describe("REQUIRED_MARKS", () => {
  // A mark computeFrame reads but nobody registered sends the camera to the
  // wide shot and the cursor to the window centre, silently. The list is the
  // contract between computeFrame and the stage's use:mark registrations, so it
  // must be exactly the keys computeFrame reads: measured or not, because a key
  // read only on the fallback path is still a key the frame depends on.
  it("lists exactly the mark keys computeFrame reads, over the whole loop", () => {
    const read = new Set<string>();
    const bases: Measurements[] = [MEASURED, {}];
    for (const base of bases) {
      const measurements = recordingMeasurements(base, read);
      for (const t of samples) computeFrame(t, measurements);
    }
    expect([...read].sort()).toEqual([...REQUIRED_MARKS].sort());
  });

  it("lists each key once", () => {
    expect(new Set(REQUIRED_MARKS).size).toBe(REQUIRED_MARKS.length);
  });

  // Otherwise a framing test could be running on the wide-shot fallback.
  it("is exactly what the MEASURED fixture measures", () => {
    expect(Object.keys(MEASURED).sort()).toEqual([...REQUIRED_MARKS].sort());
  });
});

describe("the screen-reader text", () => {
  // Review Focus 3: the sr-only figcaption is the walkthrough for anyone not
  // watching it, and it is built from LOWER_THIRDS. Rendered, not read from
  // source, so a change to how the list is built is caught too.
  it("lists every lower third as its title and line, in order", () => {
    const doc = ssrDocument(render(WalkthroughVideo).body);
    const items = [...doc.querySelectorAll("figcaption ol > li")].map(textOf);
    expect(items).toEqual(LOWER_THIRDS.map((l) => `${l.title}: ${l.line}`));
  });
});

describe("the landing page", () => {
  // The sentence under "See it in action" claims the loop's length and feature count.
  it("says the walkthrough is under a minute and ten features, which it is", () => {
    const intro = /See it in action <\/h2> <p[^>]*> (.*?) <\/p>/.exec(
      source("src/routes/+page.svelte"),
    )?.[1];
    expect(intro).toBe(
      "Under a minute, ten features, from the first dose of the day to an overdue reminder.",
    );
    expect(TOTAL_DURATION).toBeLessThan(60);
    expect(LOWER_THIRDS).toHaveLength(10);
  });
});

describe("camera helpers", () => {
```

- [ ] **Step 2: Run the timeline tests to verify they fail**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: FAIL, `Tests  13 failed | 18 passed (31)`, probed at base. If an earlier task added tests to this file's `walkthrough demo data` describe, the passed count is higher by that many, and the 13 failures are the same. The failures:

| Test                                                                                          | Message                                                                                                             |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `walkthrough scenes > keeps twelve scenes and their durations, named for what each one shows` | `expected [ [ 'Title', 2.5 ], …(11) ] to deeply equal [ [ 'Title', 2.5 ], …(11) ]` (MyDay/QuickLog vs Today/LogNow) |
| `walkthrough scenes > keys the two log beats to their own scenes`                             | `expected undefined to be close to NaN`                                                                             |
| `computeFrame > shows each desktop page during its own scenes`                                | `expected 'data' to be 'dash'` (`CUES.LogNow` is undefined, so T is NaN)                                            |
| `computeFrame > logs Lisinopril exactly once, during Log now`                                 | `expected NaN to be +0`                                                                                             |
| `computeFrame > clicks to log at T_LOG on the desktop and taps at T_TAP on the phone`         | `expected undefined to be +0`                                                                                       |
| `computeFrame > only shows a cursor on the shots that click something`                        | `expected true to be false`                                                                                         |
| `lower thirds > says what the redrawn walkthrough shows`                                      | `expected { scene: 'MyDay', …(6) } to match object { scene: 'Today', …(4) }`                                        |
| `lower thirds > never names a feature the app no longer has`                                  | `caption 01 says "my day": expected 'my day today\'s doses, grouped by tim…' not to contain 'my day'`               |
| `lower thirds > keeps its claims about the Undo window and the reminder sweep true`           | `expected 'Log a dose with a single tap.' to contain 'Undo for ten minutes'`                                        |
| `REQUIRED_MARKS >` all three tests                                                            | a `TypeError`: `REQUIRED_MARKS` is not exported yet, so it is `undefined`                                           |
| `the landing page > says the walkthrough is under a minute and ten features, which it is`     | `expected 'Forty seconds, ten features, from the…' to be 'Under a minute, ten features, from th…'`                  |

**Which tests pass anyway, and why.**

- **`the screen-reader text`** passes now and after: it guards the figcaption's construction, and Step 12's mutation M7 is its proof.
- **The renamed shot-list and caption-window pins** pass vacuously here. NaN comparisons are false, so neither the `title` branch nor the `continue` is taken, and the assertions still hold. They are pins, kept for meaning.

- [ ] **Step 3: Rename the scenes and export the two beats in `timeline.ts`**

Make these nine replacements in `src/lib/components/walkthrough/timeline.ts`.

**3a. `SCENES`.**

Old:

```ts
  { name: "Title", dur: 2.5 },
  { name: "MyDay", dur: 3.5 },
  { name: "QuickLog", dur: 4 },
```

New:

```ts
  { name: "Title", dur: 2.5 },
  { name: "Today", dur: 3.5 },
  { name: "LogNow", dur: 4 },
```

**3b. The two beats, after `TOTAL_DURATION`.**

Old:

```ts
export const CUES: Readonly<Record<SceneName, number>> = derived.cues;
export const TOTAL_DURATION = derived.total;
```

New:

```ts
export const CUES: Readonly<Record<SceneName, number>> = derived.cues;
export const TOTAL_DURATION = derived.total;

// The two log beats. The desktop cursor clicks to log Lisinopril at T_LOG, and
// the phone's fingertip taps to log Vitamin D at T_TAP. Exported so the tests
// and the scenes key off the same instants computeFrame animates around.
export const T_LOG = CUES.LogNow + 1.45;
export const T_TAP = CUES.Reminders + 3.0;
```

**3c. Key moments.** The `tLog` and `tTap` locals go.

Old:

```ts
// Key moments, all keyed to scene cues.
const tLog = c.QuickLog + 1.45;
const tCheck = c.History + 1.3;
const tDownload = c.Export + 1.5;
const tTap = c.Reminders + 3.0;
const A = c.AddMedication;
```

New:

```ts
// Key moments, all keyed to scene cues. The two log beats are T_LOG and T_TAP.
const tCheck = c.History + 1.3;
const tDownload = c.Export + 1.5;
const A = c.AddMedication;
```

**3d. The Today and LogNow shots.**

- The LogNow camera's `lerpCam(...)` is now one line, because prettier joins it once `QuickLog` becomes the shorter `LogNow`.
- The local `myDayScroll` becomes `todayScroll`.

Old:

```ts
  if (T < c.MyDay || T >= c.Outro) {
    kind = "title";
  } else if (T >= c.Reminders) {
    kind = "phone";
  } else if (T < c.MyDay + 0.9) {
    camera = lerpCam(WIDE, zoom(WIDE, 1.04), MOTION.drift(T, c.MyDay, 0.9));
  } else if (T < c.QuickLog) {
    // Open on the summary and morning group, then pan down the timeline.
    const myDayScroll = dPage ? Math.max(0, Math.min(dPage.h - 900, 220)) : 0;
    const p = MOTION.move(T, c.MyDay + 1.1, c.QuickLog - c.MyDay - 1.2);
    scroll = myDayScroll * p;
    const from = fitCamera(unionRects(R("d.strip"), R("d.morning")), 28, 1.9);
    const to = fitCamera(
      unionRects(R("d.evening", myDayScroll), R("d.night", myDayScroll)),
      28,
      1.9,
    );
    camera = lerpCam(from, to, p);
  } else if (T < c.Medications) {
    scroll = quickScroll;
    const base = fitCamera(unionRects(R("d.quick", quickScroll), R("o.toast")), 30, 2.0);
    camera = lerpCam(
      base,
      zoom(base, 1.05),
      MOTION.drift(T, c.QuickLog, c.Medications - c.QuickLog),
    );
    const pill = at(R("d.lisPill", quickScroll), 0.42, 0.62);
    cursorPath = {
      keys: [
        [c.QuickLog, { x: pill.x + 230, y: pill.y + 170 }],
        [c.QuickLog + 1.05, pill],
        [tLog + 0.35, pill],
        [tLog + 1.3, { x: pill.x + 70, y: pill.y + 95 }],
      ],
      clicks: [tLog],
    };
  } else if (T < c.Timers) {
```

New:

```ts
  if (T < c.Today || T >= c.Outro) {
    kind = "title";
  } else if (T >= c.Reminders) {
    kind = "phone";
  } else if (T < c.Today + 0.9) {
    camera = lerpCam(WIDE, zoom(WIDE, 1.04), MOTION.drift(T, c.Today, 0.9));
  } else if (T < c.LogNow) {
    // Open on the summary and morning group, then pan down the timeline.
    const todayScroll = dPage ? Math.max(0, Math.min(dPage.h - 900, 220)) : 0;
    const p = MOTION.move(T, c.Today + 1.1, c.LogNow - c.Today - 1.2);
    scroll = todayScroll * p;
    const from = fitCamera(unionRects(R("d.strip"), R("d.morning")), 28, 1.9);
    const to = fitCamera(
      unionRects(R("d.evening", todayScroll), R("d.night", todayScroll)),
      28,
      1.9,
    );
    camera = lerpCam(from, to, p);
  } else if (T < c.Medications) {
    scroll = quickScroll;
    const base = fitCamera(unionRects(R("d.quick", quickScroll), R("o.toast")), 30, 2.0);
    camera = lerpCam(base, zoom(base, 1.05), MOTION.drift(T, c.LogNow, c.Medications - c.LogNow));
    const pill = at(R("d.lisPill", quickScroll), 0.42, 0.62);
    cursorPath = {
      keys: [
        [c.LogNow, { x: pill.x + 230, y: pill.y + 170 }],
        [c.LogNow + 1.05, pill],
        [T_LOG + 0.35, pill],
        [T_LOG + 1.3, { x: pill.x + 70, y: pill.y + 95 }],
      ],
      clicks: [T_LOG],
    };
  } else if (T < c.Timers) {
```

**3e. The phone touch.**

Old:

```ts
        opacity: MOTION.enter(T, tTap - 0.4, 0.2) * (1 - MOTION.enter(T, tTap + 0.1, 0.3)),
        press: T < tTap ? MOTION.enter(T, tTap - 0.15, 0.15) : 1 - MOTION.enter(T, tTap, 0.15),
```

New:

```ts
        opacity: MOTION.enter(T, T_TAP - 0.4, 0.2) * (1 - MOTION.enter(T, T_TAP + 0.1, 0.3)),
        press: T < T_TAP ? MOTION.enter(T, T_TAP - 0.15, 0.15) : 1 - MOTION.enter(T, T_TAP, 0.15),
```

**3f. `Frame.dashboard`.** The values are unchanged; T7 replaces this object.

Old:

```ts
      count: T >= tLog + 0.15 ? 3 : 2,
      lisinoprilDone: MOTION.enter(T, tLog + 0.15, 0.3),
      labelGone: MOTION.enter(T, tLog + 0.15, 0.3),
      entry: MOTION.enter(T, tLog + 0.2, 0.4),
      pillHover: T >= c.QuickLog + 1.0 && T < tLog + 0.45,
      pillPress: pressAt(T, tLog),
      flash: T >= tLog && T < tLog + 0.6 ? MOTION.enter(T, tLog, 0.6) : 0,
```

New:

```ts
      count: T >= T_LOG + 0.15 ? 3 : 2,
      lisinoprilDone: MOTION.enter(T, T_LOG + 0.15, 0.3),
      labelGone: MOTION.enter(T, T_LOG + 0.15, 0.3),
      entry: MOTION.enter(T, T_LOG + 0.2, 0.4),
      pillHover: T >= c.LogNow + 1.0 && T < T_LOG + 0.45,
      pillPress: pressAt(T, T_LOG),
      flash: T >= T_LOG && T < T_LOG + 0.6 ? MOTION.enter(T, T_LOG, 0.6) : 0,
```

**3g. The top-level `toast`.** T7 removes it.

Old:

```ts
    toast:
      T < tLog + 0.2
        ? 0
        : T < tLog + 5.2
          ? MOTION.enter(T, tLog + 0.2, 0.3)
          : 1 - MOTION.enter(T, tLog + 5.2, 0.3),
```

New:

```ts
    toast:
      T < T_LOG + 0.2
        ? 0
        : T < T_LOG + 5.2
          ? MOTION.enter(T, T_LOG + 0.2, 0.3)
          : 1 - MOTION.enter(T, T_LOG + 5.2, 0.3),
```

**3h. `Frame.phone`.** T8 replaces these two fields.

Old:

```ts
      vitaminDDone: MOTION.enter(T, tTap, 0.3),
      toast: T < tTap + 0.15 ? 0 : MOTION.enter(T, tTap + 0.15, 0.3),
```

New:

```ts
      vitaminDDone: MOTION.enter(T, T_TAP, 0.3),
      toast: T < T_TAP + 0.15 ? 0 : MOTION.enter(T, T_TAP + 0.15, 0.3),
```

**3i. `titleScale`.**

Old:

```ts
      T < c.MyDay
        ? 1 + 0.03 * MOTION.drift(T, 0, c.MyDay)
```

New:

```ts
      T < c.Today
        ? 1 + 0.03 * MOTION.drift(T, 0, c.Today)
```

- [ ] **Step 4: Make captions 01, 02, 04 and 10 true**

Make these three replacements in `LOWER_THIRDS`. In 01 and 02, `scene`/`until` change as well as the copy, because `SceneName` no longer has `MyDay`/`QuickLog`.

**4a. Captions 01 and 02.**

Old:

```ts
  {
    scene: "MyDay",
    until: "QuickLog",
    delay: 0.9,
    number: "01",
    title: "My Day",
    line: "Today's doses, grouped by time of day.",
    tech: "Interval, fixed-time and as-needed schedules",
  },
  {
    scene: "QuickLog",
    until: "Medications",
    delay: 0.15,
    number: "02",
    title: "Quick Log",
    line: "Log a dose with a single tap.",
    tech: "Server-first SvelteKit form actions",
  },
```

New:

```ts
  {
    scene: "Today",
    until: "LogNow",
    delay: 0.9,
    number: "01",
    title: "Today",
    line: "What's due now, what's done and what's next.",
    tech: "Every row on the page decided by one matcher, on the server",
  },
  {
    scene: "LogNow",
    until: "Medications",
    delay: 0.15,
    number: "02",
    title: "Log now",
    line: "One tap to log, and Undo for ten minutes.",
    tech: "Single-fire writes, re-checked under a row lock on the server",
  },
```

**4b. Caption 04's line.**

Old:

```ts
    line: "Last taken and next due for every medication.",
```

New:

```ts
    line: "When each medication was last taken, always current.",
```

**4c. Caption 10's tech line.**

Old:

```ts
    tech: "Web Push via Vercel Cron, with idempotent dedupe keys",
```

New:

```ts
    tech: "Web Push on a half-hourly daytime sweep, with idempotent dedupe keys",
```

- [ ] **Step 5: List the marks `computeFrame` reads**

Insert `REQUIRED_MARKS` between `pressAt` and `computeFrame`'s doc comment.

- **The keys.** These are exactly the 28 keys a Proxy recorded `computeFrame` reading over the whole loop at base, with MEASURED and with `{}` alike.
- **The order.** Grouped by page; the tests compare sorted lists.

Old:

```ts
/**
 * Everything on screen at time T, given element rects measured from the
```

New:

```ts
/**
 * Every mark key computeFrame reads. A key missing from the measurements is not
 * an error: the camera falls back to the wide shot and the cursor to the window
 * centre. So tests/unit/walkthrough-timeline.test.ts records every key
 * computeFrame actually reads over the whole loop, and fails unless the set is
 * exactly this list. A change that reads a new key lists it here and registers
 * it in the stage with use:mark.
 */
export const REQUIRED_MARKS: readonly string[] = [
  // Dashboard, and the toast in the app shell's overlay
  "d.page",
  "d.strip",
  "d.morning",
  "d.evening",
  "d.night",
  "d.quick",
  "d.lisPill",
  "o.toast",
  // Medications
  "m.card0",
  "m.card1",
  "m.card2",
  "m.card3",
  // Add medication
  "a.h1",
  "a.name",
  "a.dose",
  "a.amount",
  "a.unit",
  "a.category",
  // History
  "l.h1",
  "l.form",
  "l.check",
  // Analytics
  "n.stats",
  "n.heatTitle",
  "n.heatGrid",
  // Security and export
  "s.twofa",
  "x.export",
  "x.download",
  // Phone
  "p.vitdLog",
];

/**
 * Everything on screen at time T, given element rects measured from the
```

- [ ] **Step 6: The landing line and the scene comment**

`src/routes/+page.svelte:99`. The loop is 43.5s; the rest of the sentence is kept.

Old:

```svelte
Forty seconds, ten features, from the first dose of the day to an overdue reminder.
```

New:

```svelte
Under a minute, ten features, from the first dose of the day to an overdue reminder.
```

`src/lib/components/walkthrough/scenes/DashboardScene.svelte:3` is the scene rename in a comment. The stage still draws the Quick Log bar until T7.

Old:

```svelte
// logged from the Quick Log bar during the QuickLog shot.
```

New:

```svelte
// logged from the Quick Log bar during the LogNow shot.
```

- [ ] **Step 7: Run the timeline tests to verify they pass, and that no old name is left**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: PASS, `Tests  31 passed (31)`, probed. If an earlier task added tests here, the count is that many higher, with 0 failed.

Run: `grep -rnE '\bMyDay\b|\bQuickLog\b|\btLog\b|\btTap\b' src tests`

Expected: no output, exit status 1.

- `MyDaySection`, `QuickLogBar` and `findQuickLogForm` are whole words, so they do not match.
- At base this grep matched exactly the lines Steps 1, 3, 4 and 6 change.

- [ ] **Step 8: Write the failing `MARKS_CONTEXT` test**

Create `tests/unit/walkthrough-marks.svelte.test.ts`.

- **What it mounts.** `FieldBox` is a stage part that takes its mark key as a prop, and T7 and T8 do not touch it. So the test chooses a key no scene uses, and survives the redraw.
- **Why `flushSync()` before asserting.** Without it the registry is empty: actions run only on flush. This was probed.

```ts
// The suite's default jsdom environment: use:mark is an action, and actions run
// only in a mounted client component, once effects flush.
import { afterEach, describe, it, expect } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { MARKS_CONTEXT, createMarkRegistry } from "$lib/components/walkthrough/marks";
import FieldBox from "$lib/components/walkthrough/parts/FieldBox.svelte";

let target: HTMLElement | undefined;
let app: ReturnType<typeof mount> | undefined;

afterEach(() => {
  if (app) unmount(app);
  app = undefined;
  target?.remove();
  target = undefined;
});

describe("MARKS_CONTEXT", () => {
  // Exported so a test can mount part of the stage with its own registry, as
  // this one does. FieldBox takes its key as a prop, so the test picks a key no
  // scene uses.
  it("is the context key use:mark registers under, and unmounting unregisters", () => {
    const registry = createMarkRegistry();
    target = document.body.appendChild(document.createElement("div"));
    app = mount(FieldBox, {
      target,
      props: { label: "Name", markKey: "probe.field" },
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    flushSync();
    expect([...registry.keys()]).toEqual(["probe.field"]);
    expect(target.contains(registry.get("probe.field") ?? null)).toBe(true);

    unmount(app);
    app = undefined;
    expect(registry.size).toBe(0);
  });
});
```

- [ ] **Step 9: Run it to verify it fails**

Run: `npx vitest run tests/unit/walkthrough-marks.svelte.test.ts`

Expected: FAIL in `MARKS_CONTEXT > is the context key use:mark registers under, and unmounting unregisters`, with `AssertionError: expected [] to deeply equal [ 'probe.field' ]`. `MARKS_CONTEXT` is `undefined`, so `useMark` finds no registry under its private key.

- [ ] **Step 10: Export the key from `marks.ts`**

Make three replacements in `src/lib/components/walkthrough/marks.ts`.

Old:

```ts
const CONTEXT_KEY = Symbol("walkthrough-marks");
```

New:

```ts
// Exported, like dose-write-lock's DOSE_WRITE_LOCK, so a test can mount a
// marked component with `context: new Map([[MARKS_CONTEXT, registry]])`.
export const MARKS_CONTEXT = Symbol("walkthrough-marks");
```

Old:

```ts
setContext(CONTEXT_KEY, registry);
```

New:

```ts
setContext(MARKS_CONTEXT, registry);
```

Old:

```ts
const registry = getContext<MarkRegistry | undefined>(CONTEXT_KEY);
```

New:

```ts
const registry = getContext<MarkRegistry | undefined>(MARKS_CONTEXT);
```

Run: `grep -n "CONTEXT_KEY" src/lib/components/walkthrough/marks.ts`. Expected: no output.

- [ ] **Step 11: Run it to verify it passes**

Run: `npx vitest run tests/unit/walkthrough-marks.svelte.test.ts`

Expected: PASS, `Tests  1 passed (1)`.

- [ ] **Step 12: Prove each new test by mutation**

For each mutation:

1. Make the one change.
2. Run the command.
3. See the named test fail.
4. Undo the change exactly.

Never use `git checkout --` to undo: it would discard the whole task. M1–M9 were run against probe copies while planning, with the outcomes shown. M10 and M11 follow directly from the assertion.

- **M1. A read nobody listed** (the header's mutation). In `timeline.ts`'s Today pan:
  - Change `    const from = fitCamera(unionRects(R("d.strip"), R("d.morning")), 28, 1.9);` to `    const from = fitCamera(unionRects(R("d.strip"), R("d.morning"), R("d.new")), 28, 1.9);`.
  - Run `npx vitest run tests/unit/walkthrough-timeline.test.ts`.
  - FAIL: `REQUIRED_MARKS > lists exactly the mark keys computeFrame reads, over the whole loop`. The diff shows `+   "d.new",`.
  - Undo.
- **M2. A listed key nobody reads.**
  - In `REQUIRED_MARKS`, add the line `  "d.new",` after `  "p.vitdLog",`.
  - Run the same command.
  - FAIL: `REQUIRED_MARKS > lists exactly the mark keys computeFrame reads, over the whole loop` and `REQUIRED_MARKS > is exactly what the MEASURED fixture measures`.
  - Undo.
- **M3. The click leaves T_LOG.**
  - Change `      clicks: [T_LOG],` to `      clicks: [T_LOG + 0.1],`.
  - Run the same command.
  - FAIL: `computeFrame > clicks to log at T_LOG on the desktop and taps at T_TAP on the phone`.
  - Undo.
- **M4. The tap leaves T_TAP.**
  - Change `        press: T < T_TAP ? MOTION.enter(T, T_TAP - 0.15, 0.15) : 1 - MOTION.enter(T, T_TAP, 0.15),` to `        press: T < T_TAP + 0.1 ? MOTION.enter(T, T_TAP - 0.05, 0.15) : 1 - MOTION.enter(T, T_TAP + 0.1, 0.15),`.
  - Run the same command.
  - FAIL: the same test as M3.
  - Undo.
- **M5. Caption 01 regresses.**
  - In `LOWER_THIRDS`, change `    title: "Today",` to `    title: "My Day",`.
  - Run the same command.
  - FAIL: `lower thirds > says what the redrawn walkthrough shows` and `lower thirds > never names a feature the app no longer has`.
  - Undo.
- **M6. Caption 10 regresses.**
  - Change `    tech: "Web Push on a half-hourly daytime sweep, with idempotent dedupe keys",` to `    tech: "Web Push via Vercel Cron, with idempotent dedupe keys",`.
  - Run the same command.
  - FAIL: `lower thirds > says what the redrawn walkthrough shows`, `lower thirds > never names a feature the app no longer has` and `lower thirds > keeps its claims about the Undo window and the reminder sweep true`.
  - Undo.
- **M7. The figcaption drops the line** (Review Focus 3).
  - In `src/lib/components/walkthrough/WalkthroughVideo.svelte:188`, change `        <li>{item.title}: {item.line}</li>` to `        <li>{item.title}</li>`.
  - Run the same command.
  - FAIL: `the screen-reader text > lists every lower third as its title and line, in order`, with `expected [ 'Today', 'Log now', …(8) ] to deeply equal [ …(10) ]`.
  - Undo.
- **M8. The landing line regresses.**
  - In `src/routes/+page.svelte:99`, change `Under a minute` back to `Forty seconds`.
  - Run the same command.
  - FAIL: `the landing page > says the walkthrough is under a minute and ten features, which it is`.
  - Undo.
- **M9. `useMark` reads another key.**
  - In `marks.ts`, change `getContext<MarkRegistry | undefined>(MARKS_CONTEXT)` to `getContext<MarkRegistry | undefined>(Symbol("walkthrough-marks"))`.
  - Run `npx vitest run tests/unit/walkthrough-marks.svelte.test.ts`.
  - FAIL: `MARKS_CONTEXT > is the context key use:mark registers under, and unmounting unregisters`, with `expected [] to deeply equal [ 'probe.field' ]`.
  - Undo.
- **M10. Unmounting no longer unregisters.**
  - In `marks.ts`'s `destroy()`, delete the line `        if (registry && current && registry.get(current) === node) registry.delete(current);`.
  - Run the same command as M9.
  - FAIL: the same test, with `expected 1 to be +0`.
  - Undo.
- **M11. The claims move under the caption.**
  - In `src/lib/utils/dose-undo.ts`, change `export const DOSE_UNDO_WINDOW_MS = 10 * 60_000;` to `export const DOSE_UNDO_WINDOW_MS = 15 * 60_000;`.
  - Run `npx vitest run tests/unit/walkthrough-timeline.test.ts`.
  - FAIL: `lower thirds > keeps its claims about the Undo window and the reminder sweep true`.
  - Undo.
  - Then, in `.github/workflows/reminder-tick.yml`, change `    - cron: "*/30 6-22 * * *"` to `    - cron: "*/15 6-22 * * *"`, run the same command, see the same test fail, and undo.

After the last undo, check the state:

- Run `git diff --stat`. Expected: exactly these files changed:
  - `src/lib/components/walkthrough/marks.ts`
  - `src/lib/components/walkthrough/scenes/DashboardScene.svelte`
  - `src/lib/components/walkthrough/timeline.ts`
  - `src/routes/+page.svelte`
  - `tests/unit/walkthrough-timeline.test.ts`

  plus the untracked `tests/unit/walkthrough-marks.svelte.test.ts`. `WalkthroughVideo.svelte`, `dose-undo.ts` and `reminder-tick.yml` must NOT be listed.

- Run `npx vitest run tests/unit/walkthrough-timeline.test.ts tests/unit/walkthrough-marks.svelte.test.ts`. Expected: PASS, `Tests  32 passed (32)` at base.

- [ ] **Step 13: Run the gates**

Run each, from the worktree root:

```bash
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **`npx vitest run`, both times:** all pass. The totals are T5's totals plus 1 file and 12 tests: 11 in `walkthrough-timeline.test.ts` (20 → 31 at base) and 1 in the new file. Name any failing test.
- **`npm run check`:** 0 errors, warnings ≤ 27. The new test code type-checked clean in probe copies:
  - `render(WalkthroughVideo)` needs no options, because every prop is optional;
  - `new Map([[MARKS_CONTEXT, registry]])` fits `mount`'s `context`.
- **`npm run lint`:** 0 errors, warnings ≤ 115.
  - The four `svelte/no-navigation-without-resolve` warnings in `src/routes/+page.svelte` are pre-existing.
  - `eslint --stdin` reported nothing for the new test, `timeline.ts` and `marks.ts` text.
- **`npm run format:check`:** clean. Every block above is already in prettier's output; this was verified with `prettier --stdin-filepath`.

- [ ] **Step 14: Commit**

```bash
git add src/lib/components/walkthrough/timeline.ts src/lib/components/walkthrough/marks.ts src/lib/components/walkthrough/scenes/DashboardScene.svelte src/routes/+page.svelte tests/unit/walkthrough-timeline.test.ts tests/unit/walkthrough-marks.svelte.test.ts
git commit -m "fix(walkthrough): true captions, renamed scenes, REQUIRED_MARKS" -m "- SCENES: MyDay is now Today and QuickLog is now LogNow. Durations and the
  43.5s loop are unchanged.
- timeline.ts exports T_LOG and T_TAP, the two beats computeFrame animates
  around, and REQUIRED_MARKS, every mark key it reads. A Proxy records
  computeFrame's reads over the whole loop and must equal the list, as must
  the MEASURED fixture.
- Captions 01, 02, 04 and 10 describe the app as it ships: no My Day
  grouping, no next-due time, and reminders driven by the half-hourly
  reminder-tick sweep rather than Vercel Cron. The sr-only figcaption is
  checked against them by rendering it.
- The landing page says 'Under a minute': the loop is 43.5s.
- marks.ts exports its context key as MARKS_CONTEXT.

Changed test pins, all for the scene rename only, at the same offsets
and with the same expectations: CUES.MyDay and CUES.QuickLog become
CUES.Today and CUES.LogNow in the shot-list, page, Lisinopril-log,
cursor-per-scene and caption-window tests, and the Lisinopril test's
title says Log now."
```

The pre-commit hook runs lint-staged (eslint and prettier). Never use `--no-verify`, and add no attribution trailer of any kind.

#### Notes for the reviewer

- **Review Focus 3 renders the real figcaption.**
  - **What renders.** `WalkthroughVideo` is rendered with `svelte/server` inside the existing `// @vitest-environment node` timeline file. Under SSR `full` is false, so only the title card and the figcaption render. T7 and T8 change neither, so the test only requires that the stage keeps importing cleanly under SSR.
  - **It is a guard.** It passes before and after this task. The red test for Review Focus 3 is "never names a feature the app no longer has", and M7 proves the guard.
- **Three judgement calls beyond the header's list**, each cheap to drop:
  - **`"quick log"` is banned as well**, besides "My Day", "next due" and "Vercel Cron". The dashboard has had no "Quick Log" since #170, and `dashboard-chrome-copy.test.ts` already bans it from the dashboard's source.
  - **A claims test.** It ties caption 02's "Undo for ten minutes" to `DOSE_UNDO_WINDOW_MS`, and caption 10's "half-hourly daytime sweep" to `reminder-tick.yml`'s `cron: "*/30 6-22 * * *"`. It is deliberately brittle: changing either schedule should force the caption to follow.
  - **A new test file**, `tests/unit/walkthrough-marks.svelte.test.ts`, which the header's File Structure does not list. Without it, `MARKS_CONTEXT` has no test at this commit, and T9's stage test depends on it being the key `useMark` really reads. It mounts `FieldBox`, which no later task edits.
- **The Proxy sweep.** It records `get` and `has` for string keys, and runs over both `MEASURED` and `{}`.
  - At base both give the same 28 keys, equal to `Object.keys(MEASURED)`; this was probed.
  - The `{}` pass catches a key read only on a fallback path.
- **Formatting.** Prettier joins the LogNow camera's `lerpCam(...)` onto one line once `QuickLog` becomes `LogNow`. Step 3d's text is already in that form; leaving it on four lines would fail `format:check`.
- **`myDayScroll` → `todayScroll`** is cosmetic, in a branch T7 rewrites.
- **Comments are true at this commit.** The `REQUIRED_MARKS` doc comment and the test comments do not name the T9 stage mount test, which does not exist yet. T9 may extend them.
- **For T7's writer.**
  - `DashboardScene.svelte:3` now reads "during the LogNow shot", so anchor on that, or rewrite the file.
  - `walkthrough-timeline.test.ts`'s Lisinopril test is now titled "logs Lisinopril exactly once, during Log now" and uses `CUES.LogNow + 1` and `CUES.LogNow + 2.5`.
- **For T9's writer.** At this commit the stage also registers keys `computeFrame` never reads:
  - `d.afternoon` and `d.lisLog`;
  - `d.today`;
  - `m.stats0`–`m.stats3`;
  - `p.morning`, `p.afternoon`, `p.evening` and `p.night`.

  They come from `MyDaySection`, `DashboardScene:103` and `MedicationsScene:82`. Nothing here asserts registration. Whatever survives T7 and T8 (at least `m.stats0`–`m.stats3`) belongs in T9's explicit unread list.

### Task 7: Redraw the desktop dashboard scene

The desktop scene stops drawing the deleted dashboard (the "Dashboard" title, the "2 doses today" strip, My Day, coloured pills, the green flash and a 5-second toast). It draws the dashboard as it ships, from the two StageMoments T5 proved equal to the real composer: the header, Lisinopril's due-now card, Done today, Later today, the neutral chips and Refills. The LogNow shot taps the card's **Log now**, shows its spinner, collapses Due, crossfades the header, grows the Done row, and raises the one Undo offer, which stays until the cut to Medications.

Every part is a span-drawn picture of a real component. Every visible dashboard string comes from a real helper, and a render test proves it against the composer's own payload.

**One change lands outside the walkthrough.** `src/lib/components/RefillsCard.svelte`, the shipped dashboard card, gains a `<script module>` exporting its three row rules: `refillSeverityClass`, `refillSeverityLabel` and `refillDaysLabel`. They move there unchanged, so `StageRefills` draws "8 days left" by the card's own rule without mounting the card's link and `<h2>`. The card's markup does not change, and Step 18 proves it byte-identical. This is the pattern T4 uses for `StatusBreakdownBar`'s `statusBreakdownSegments`. A reviewer scoping the PR must include this file; CONTRACT ISSUES gives the line the header's File Structure needs.

**Files:**

Line ranges are at base `311758f`. T1–T6 shift some of them, so every edit below is anchored on quoted text, not on a line number.

- Create: `src/lib/components/walkthrough/stage-dashboard.ts`, which holds `WALKTHROUGH_DATE_FORMAT`, `beatRow`, `stageLogToast` and `STAGE_REFILLS`.
- Create: `src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte`, a grow/collapse wrapper drawn with height and opacity, never `{#if}`.
- Create: `src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageDoneList.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageLaterList.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageChips.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageRefills.svelte`
- Create: `src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte`
- Modify: `src/lib/components/RefillsCard.svelte`:
  - `:1-27`: the three row rules move, unchanged, into an exported `<script lang="ts" module>`, together with the `RefillForecastEntry` type import;
  - `:41-52`: the markup's three calls take the exported names. Nothing else in the markup changes.
- Modify: `src/lib/components/walkthrough/timeline.ts`:
  - `:285-295`: `Frame.dashboard`, and the top-level `toast` is deleted;
  - T6's `REQUIRED_MARKS` array;
  - `:350-353`: `dQuick`/`quickScroll` are deleted;
  - `:377-397`: the Today and LogNow shots;
  - `:524-541`: the returned `dashboard` and `toast`.
- Modify: `src/lib/components/walkthrough/scenes/DashboardScene.svelte:1-128`. The whole file is replaced, which deletes the Quick Log label map and the `formatDueIn` import.
- Modify: `src/lib/components/walkthrough/WalkthroughStage.svelte`:
  - `:11` and `:15`: the imports;
  - `:38-41`: the offer message;
  - `:50`: the desktop layer's `data-stage-surface`;
  - `:66-68`: the overlay snippet.
- Modify: `src/lib/utils/time.ts`:
  - `:654-657`: `formatDuration`'s doc drops `formatDueIn`;
  - `:700-713`: `formatDueIn` is deleted.
- Delete: `formatDueIn` (above), and its `describe` in `tests/unit/time.test.ts:190-220`, with its import at `:7`.
- **Not deleted here:** `parts/MyDaySection.svelte`, `parts/SummaryAndRefills.svelte`, `parts/StatusMark.svelte`, `parts/StageToast.svelte`, demo-data's `DAY_GROUPS`/`daySlots`, and `Frame.phone`'s `vitaminDDone`/`toast`. `PhoneScene.svelte` still renders all of them until T8 redraws it, and the build stays green.
- Test: `tests/unit/walkthrough-timeline.test.ts`:
  - `:3-19`: the imports;
  - `:34-44`: MEASURED;
  - `:136-143`: the Lisinopril test;
  - `:168-187`: the progress test;
  - new tests.
- Test: `tests/unit/walkthrough-dashboard-fidelity.test.ts`. Its imports are merged, and the desktop render half is appended.
- Test: `tests/unit/time.test.ts:7, 190-220`.

**Interfaces:**

- **Consumes:**
  - **T1** (`$lib/utils/dashboard-copy`):
    - `headerEyebrow(serverNow: Date, tz: string, dateFormat: DateFormat): string`
    - `laterUntil(expectedTime: string, serverNow: Date): string`
    - `doneCoversLine(covers: readonly string[], todayStart: Date, tz: string, timeFormat: TimeFormat): string | null`
    - `doneDoseText(dose: { dosageAmount: string; dosageUnit: string; quantity: number; status: string }): string`
    - `tookItAtLabel(time: string): string`
  - **Already in the module:** `formatSlotTime`, `rowStatusLine`, `dashboardHeaderCopy`, `formatDoseLabel`, `toastForLog`.
  - **T4** (`walkthrough/demo-data`):
    - `WALKTHROUGH_TZ = "UTC"` and `LOGGED_DOSE.desktop` (`"dose-lis-20260924-0802"`);
    - `MEDICATIONS`, which still carries `refillWatch` and `supplyDays`.

    `DESKTOP_NOW` and `DEMO_DOSES` reach this task only through T5's `MOMENTS`, never directly.

  - **T5** (`walkthrough/demo-dashboard`): `StageMoment`, `StageDone`, `StageMedication`, `DESKTOP_BEFORE` and `DESKTOP_AFTER`.
  - **T5's test-file exports** in `walkthrough-dashboard-fidelity.test.ts`, which this task calls and never re-implements:
    - `type ComposedPayload = ReturnType<typeof composeDashboardPageData>`;
    - `MOMENTS` and `composeMoment(c: MomentCase): ComposedPayload`. The desktop payloads are `composeMoment(MOMENTS[0])` and `composeMoment(MOMENTS[1])`, the construction T5's data half already proves equal to `DESKTOP_BEFORE` and `DESKTOP_AFTER`, so this task builds no second one;
    - `expectedOfferText(after: ComposedPayload, doseId: string, timeFormat: TimeFormat): string`, the offer-text oracle. It is `logToastFromReload` over the AFTER payload, and it throws when that payload has no Done row for the dose.
  - **T6** (`walkthrough/timeline`):
    - the scene names `Today` and `LogNow`;
    - `export const T_LOG = CUES.LogNow + 1.45`;
    - `export const REQUIRED_MARKS: readonly string[]`;
    - the Proxy-recording sweep test and the `Object.keys(MEASURED)` test in `walkthrough-timeline.test.ts`.

- **Produces** (T8 and T9 rely on these exact names):
  - **The new Frame slice.** `Frame["dashboard"]` is `{ pending: number | null; logged: number; offer: number }`. The top-level `Frame.toast` is gone, and `Frame.phone` is untouched.
  - **The new desktop marks.** `REQUIRED_MARKS` now lists `d.header`, `d.due`, `d.logNow`, `d.done`, `d.later`, `d.chips` and `o.offer`, and no longer lists `d.strip`, `d.morning`, `d.evening`, `d.night`, `d.quick`, `d.lisPill` or `o.toast`.
  - **`stage-dashboard.ts`:**
    - `WALKTHROUGH_DATE_FORMAT: DateFormat` (`"DD/MM/YYYY"`);
    - `beatRow(moment: StageMoment, doseId: string): StageDone`, which throws when the row is missing;
    - `stageLogToast(moment: StageMoment, doseId: string, timeFormat: TimeFormat): string`;
    - `STAGE_REFILLS`.
  - **`RefillsCard.svelte`'s `<script module>`**, the card's own row rules, moved unchanged:
    - `refillSeverityClass(severity: RefillForecastEntry["severity"]): string`;
    - `refillSeverityLabel(severity: RefillForecastEntry["severity"]): string`;
    - `refillDaysLabel(days: number | null): string`.
  - **`StageCollapse`:** `{ factor: number; children: Snippet }`. At 1 it is natural, with no style. At 0 it has zero height and `opacity: 0`. Its content is always mounted.
  - **`StageDashboardHeader`:** `{ before: DashboardStatus; after: DashboardStatus; logged: number; now: Date; tz: string; timeFormat: TimeFormat; dateFormat?: DateFormat (default WALKTHROUGH_DATE_FORMAT); mark?: string }`
  - **`StageDueCard`:** `{ card: DueCard; now: Date; todayStart: Date; tz: string; timeFormat: TimeFormat; pending: number | null; logNowMark?: string }`. This is the contract's own shape.
  - **`StageDoneList`:** `{ before: StageDone[]; after: StageDone[]; logged: number; todayStart: Date; tz: string; timeFormat: TimeFormat; mark?: string }`. It draws `after`'s rows, and a row `before` lacks grows with `logged`.
  - **`StageLaterList`:** `{ rows: LaterRow[]; now: Date; todayStart: Date; tz: string; timeFormat: TimeFormat; mark?: string }`
  - **`StageChips`:** `{ medications: StageMedication[]; mark?: string }`
  - **`StageRefills`:** `{ entries: readonly Pick<RefillForecastEntry, "medicationId" | "medicationName" | "colour" | "daysUntilRefill" | "severity">[] }`
  - **`StageUndoOffer`:** `{ message: string; opacity: number; mark?: string }`. It is **not self-positioned**: the caller puts it where Toast's stack sits.
  - **Section markers.** Every part carries `data-stage-section` on its own root: `header`, `done`, `later`, `chips` or `offer`. `due` is the scene's, on the element that holds the cards. A scene needs no wrapper marker of its own. Each counted row carries `data-stage-row`.
  - **The desktop layer.** WalkthroughStage's desktop layer carries `data-stage-surface="desktop"`. T8 should give the phone layer `data-stage-surface="phone"`.
  - **The fidelity file's module-scope helpers**, which T8's phone half reuses:
    - `hiddenHere`, `drawn`, `squash`, `visibleText` and `drawnRows`;
    - `type SectionName` and `expectedSections(p: ComposedPayload, timeFormat: TimeFormat)`;
    - `renderDashboardScene(state, timeFormat)` and `renderStage(T, timeFormat)`;
    - `FORBIDDEN`.

    The file declares no payload type of its own. A payload is T5's `ComposedPayload`, built with T5's `composeMoment`, so T8 types its phone oracle `p: ComposedPayload`.

- [ ] **Step 1: Write the failing timeline tests**

In `tests/unit/walkthrough-timeline.test.ts`, add `BROWSER_BAR`, `T_LOG`, `type Camera` and `type Rect` to the import from `"$lib/components/walkthrough/timeline"`. Add only the names T6 has not already imported. The import then holds these names, among T6's others:

```ts
import {
  BROWSER_BAR,
  CUES,
  LOWER_THIRDS,
  SCENES,
  STAGE_H,
  STAGE_W,
  TOTAL_DURATION,
  T_LOG,
  WIN_H,
  WIN_W,
  activeCaption,
  clampCamera,
  computeFrame,
  fitCamera,
  trackPath,
  unionRects,
  type Camera,
  type Measurements,
  type Rect,
} from "$lib/components/walkthrough/timeline";
```

Replace the MEASURED comment and its first eight entries. This old text:

```ts
// A plausible measured layout, so framing code runs its real branches rather
// than the wide-shot fallback.
const MEASURED: Measurements = {
  "d.page": { x: 288, y: 0, w: 1152, h: 1500 },
  "d.strip": { x: 528, y: 88, w: 672, h: 54 },
  "d.morning": { x: 528, y: 290, w: 672, h: 170 },
  "d.evening": { x: 528, y: 580, w: 672, h: 80 },
  "d.night": { x: 528, y: 672, w: 672, h: 110 },
  "d.quick": { x: 528, y: 810, w: 672, h: 150 },
  "d.lisPill": { x: 720, y: 850, w: 120, h: 36 },
  "o.toast": { x: 1250, y: 830, w: 170, h: 46 },
```

becomes the following. Every entry from `"m.card0"` down stays as it is.

```ts
// A plausible measured layout, so framing code runs its real branches rather
// than the wide-shot fallback. The dashboard rects are the before-log layout
// in the 1440x900 shell: the header at 32-144, the Due card at 168-290
// (Log now at its right edge), Done today at 314-452, Later today at 476-710
// and the chips at 734-920. The offer sits at the shell's bottom right.
const MEASURED: Measurements = {
  "d.page": { x: 288, y: 0, w: 1152, h: 1500 },
  "d.header": { x: 528, y: 32, w: 672, h: 112 },
  "d.due": { x: 528, y: 168, w: 672, h: 122 },
  "d.logNow": { x: 1083, y: 181, w: 104, h: 48 },
  "d.done": { x: 528, y: 314, w: 672, h: 138 },
  "d.later": { x: 528, y: 476, w: 672, h: 234 },
  "d.chips": { x: 528, y: 734, w: 672, h: 186 },
  "o.offer": { x: 1040, y: 770, w: 384, h: 114 },
```

Directly after MEASURED's closing `};`, add:

```ts
/** A MEASURED rect in window space, where computeFrame's R() puts it. */
function inWindow(key: string, scroll = 0): Rect {
  const r = MEASURED[key]!;
  return { x: r.x, y: r.y + BROWSER_BAR - scroll, w: r.w, h: r.h };
}

function expectCamera(actual: Camera, expected: Camera): void {
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.s).toBeCloseTo(expected.s, 6);
}
```

Replace the whole `it` block that asserts `before.count` and `after.lisinoprilDone`. At base it is `it("logs Lisinopril exactly once, during Quick Log", …)`, lines 136-143. After T6 it reads `it("logs Lisinopril exactly once, during Log now", () => {`, with `CUES.LogNow + 1` and `CUES.LogNow + 2.5`: T6 renamed both the title and the cues, so search for the post-T6 title. Replace it with these four tests:

```ts
it("logs Lisinopril once, from Log now: pending, then logged, then the Undo offer until the cut", () => {
  const at = (t: number) => computeFrame(t, MEASURED).dashboard;
  // The window edges themselves, which the 20ms samples step over.
  expect(at(T_LOG - 1e-6).pending).toBeNull();
  expect(at(T_LOG).pending).toBe(0);
  expect(at(T_LOG + 0.2).pending).toBeCloseTo(96, 6);
  expect(at(T_LOG + 0.4).pending).toBeNull();
  expect(at(T_LOG + 0.4).logged).toBe(0);
  expect(at(T_LOG + 0.7).logged).toBe(1);
  expect(at(T_LOG + 0.5).offer).toBe(0);
  expect(at(T_LOG + 0.8).offer).toBe(1);
  expect(at(CUES.Medications - 1e-6).offer).toBe(1);
  expect(at(CUES.Medications).offer).toBe(0);
  // Fully visible long enough to read before the cut.
  expect(CUES.Medications - (T_LOG + 0.8)).toBeGreaterThanOrEqual(1.5);
  for (const t of samples) {
    const d = at(t);
    expect(d.pending !== null, `pending at ${t}`).toBe(t >= T_LOG && t < T_LOG + 0.4);
    if (t < T_LOG + 0.4) expect(d.logged, `logged at ${t}`).toBe(0);
    if (t >= T_LOG + 0.7) expect(d.logged, `logged at ${t}`).toBe(1);
    if (t < T_LOG + 0.5) expect(d.offer, `offer at ${t}`).toBe(0);
    if (t >= T_LOG + 0.8 && t < CUES.Medications) expect(d.offer, `offer at ${t}`).toBe(1);
    if (t >= CUES.Medications) expect(d.offer, `offer at ${t}`).toBe(0);
  }
});

// Review Focus 2: a pause can land on any frame, and the loop restarts at
// T=0, so no part of the log may outlive its window.
it("never leaves the log half-done: no spinner outside its window, and the seam matches", () => {
  for (const t of samples) {
    const d = computeFrame(t, MEASURED).dashboard;
    if (t < T_LOG || t >= T_LOG + 0.4) expect(d.pending, `pending at ${t}`).toBeNull();
    for (const v of [d.logged, d.offer]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
  const first = computeFrame(0, MEASURED);
  const last = computeFrame(TOTAL_DURATION - 1e-6, MEASURED);
  expect(last.dashboard.pending).toBe(first.dashboard.pending);
  expect(last.dashboard.offer).toBe(first.dashboard.offer);
  // `logged` cannot match across the seam: it is 1 at the end of the loop
  // and 0 at its start. It is 0 from T=0 through 1.2s, while
  // WalkthroughVideo measures the marks (on mount, then 0.3s and 1.2s
  // later), so they describe the before-log layout. Both ends are title
  // frames, so the dashboard is off screen across the jump.
  expect(first.dashboard.logged).toBe(0);
  expect(computeFrame(1.2, MEASURED).dashboard.logged).toBe(0);
  expect([first.kind, last.kind]).toEqual(["title", "title"]);
});

it("opens Today on the header and the Due card, then pans to Later and the chips", () => {
  const open = computeFrame(CUES.Today + 1.0, MEASURED);
  expect(open.scroll).toBe(0);
  expectCamera(
    open.camera,
    clampCamera(fitCamera(unionRects(inWindow("d.header"), inWindow("d.due")), 28, 1.9)),
  );
  // MEASURED's page is 1500px tall, so the pan scrolls its 220px cap.
  const end = computeFrame(CUES.LogNow - 1e-6, MEASURED);
  expect(end.scroll).toBe(220);
  expectCamera(
    end.camera,
    clampCamera(fitCamera(unionRects(inWindow("d.later", 220), inWindow("d.chips", 220)), 28, 1.9)),
  );
});

it("taps Log now, holds on the header, Due and Done through the update, then frames the offer", () => {
  const hold = clampCamera(
    fitCamera(unionRects(inWindow("d.header"), inWindow("d.due"), inWindow("d.done")), 28, 2.0),
  );
  for (const t of [CUES.LogNow, T_LOG, T_LOG + 0.7]) {
    const frame = computeFrame(t, MEASURED);
    expect(frame.scroll).toBe(0);
    expectCamera(frame.camera, hold);
  }
  expectCamera(
    computeFrame(T_LOG + 1.3, MEASURED).camera,
    clampCamera(fitCamera(inWindow("o.offer"), 40, 2.0)),
  );
  const logNow = inWindow("d.logNow");
  const tap = computeFrame(T_LOG + 0.1, MEASURED).cursor;
  expect(tap?.x).toBeCloseTo(logNow.x + logNow.w * 0.5, 6);
  expect(tap?.y).toBeCloseTo(logNow.y + logNow.h * 0.55, 6);
  expect(tap?.ripple).not.toBeNull();
});
```

In `it("keeps every progress value within 0..1", …)`, replace these four lines:

```ts
        f.dashboard.lisinoprilDone,
        f.dashboard.entry,
        f.dashboard.flash,
        f.toast,
```

with these two. `f.phone.vitaminDDone` and `f.phone.toast` stay until T8.

```ts
        f.dashboard.logged,
        f.dashboard.offer,
```

**Why existing pins change.**

- The deleted test asserted `count` and `lisinoprilDone`, which no longer exist. The app has no count and no green flash, and the new pins assert the spec's replacements: `pending`, `logged` and `offer`.
- The progress test keeps its meaning, "every 0..1 Frame value stays in 0..1", over the fields that now exist.
- MEASURED changes because T6's `Object.keys(MEASURED) === REQUIRED_MARKS` test requires the fixture to name exactly the keys `computeFrame` reads.

- [ ] **Step 2: Run the timeline tests to verify they fail**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: FAIL, with:

- `logs Lisinopril once, from Log now…`: `expected undefined to be null`;
- `never leaves the log half-done…`: `expected undefined to be null`, because `Frame.dashboard.pending` does not exist yet;
- `opens Today on the header…` and `taps Log now…`: camera mismatches, because the old code reads `d.strip`/`d.quick` and falls back to WIDE;
- `keeps every progress value within 0..1`: `undefined` is not a number;
- T6's MEASURED-equals-REQUIRED_MARKS test: `REQUIRED_MARKS` still lists `d.strip` … `o.toast`.

- [ ] **Step 3: Replace `Frame.dashboard` and the top-level `toast` in the `Frame` type**

In `src/lib/components/walkthrough/timeline.ts`, replace:

```ts
dashboard: {
  count: number;
  lisinoprilDone: number;
  labelGone: number;
  entry: number;
  pillHover: boolean;
  pillPress: number;
  flash: number;
  pulse: number;
}
toast: number;
```

with:

```ts
dashboard: {
  /** Log now's spinner angle in degrees on [T_LOG, T_LOG + 0.4), else null. */
  pending: number | null;
  /** 0 → 1 as the log's reload lands: Due collapses, the header crossfades, Done grows. */
  logged: number;
  /** The Undo offer's opacity: 0 → 1 after the log, and exactly 0 from the cut to Medications. */
  offer: number;
}
```

- [ ] **Step 4: Update `REQUIRED_MARKS`**

Replace T6's whole `REQUIRED_MARKS` declaration, from `export const REQUIRED_MARKS` through its closing `];`, with the following. Keep T6's doc comment above it.

```ts
export const REQUIRED_MARKS: readonly string[] = [
  "d.page",
  "d.header",
  "d.due",
  "d.logNow",
  "d.done",
  "d.later",
  "d.chips",
  "o.offer",
  "m.card0",
  "m.card1",
  "m.card2",
  "m.card3",
  "a.h1",
  "a.category",
  "a.name",
  "a.dose",
  "a.amount",
  "a.unit",
  "l.form",
  "l.h1",
  "l.check",
  "n.stats",
  "n.heatTitle",
  "n.heatGrid",
  "s.twofa",
  "x.export",
  "x.download",
  "p.vitdLog",
];
```

- [ ] **Step 5: Redraw the Today and LogNow shots in `computeFrame`**

In `computeFrame`, replace everything from the line `const dPage = M["d.page"];` down to, but not including, the line `} else if (T < c.Timers) {`. At base that region runs from `dPage` through the old QuickLog branch, and it includes:

- `dQuick` and `quickScroll`;
- the shot-list declarations;
- the title and phone branches;
- the Today drift;
- the Today pan;
- the LogNow branch with its pill cursor.

The replacement is:

```ts
  const dPage = M["d.page"];

  // ── Shot list: hard cuts, and each shot drifts or pans ──
  let kind: ShotKind = "desk";
  let page: DesktopPage = "dash";
  let scroll = 0;
  let camera = WIDE;
  let cursorPath: { keys: Array<readonly [number, Point]>; clicks: number[] } | null = null;

  if (T < c.Today || T >= c.Outro) {
    kind = "title";
  } else if (T >= c.Reminders) {
    kind = "phone";
  } else if (T < c.Today + 0.9) {
    camera = lerpCam(WIDE, zoom(WIDE, 1.04), MOTION.drift(T, c.Today, 0.9));
  } else if (T < c.LogNow) {
    // Open on the header and Lisinopril's due-now card, then pan down through
    // Done and Later to the chips, which are on screen here and never tapped.
    const todayScroll = dPage ? Math.max(0, Math.min(dPage.h - 900, 220)) : 0;
    const p = MOTION.move(T, c.Today + 1.1, c.LogNow - c.Today - 1.2);
    scroll = todayScroll * p;
    const from = fitCamera(unionRects(R("d.header"), R("d.due")), 28, 1.9);
    const to = fitCamera(unionRects(R("d.later", todayScroll), R("d.chips", todayScroll)), 28, 1.9);
    camera = lerpCam(from, to, p);
  } else if (T < c.Medications) {
    // Hold on the header, Due and Done through the tap and the update. All
    // three are measured before the log: the collapse only moves content up,
    // and the new Done row is shorter than the Due section it replaces, so
    // the whole change happens inside this frame. Then move to the Undo
    // offer: framing the header and the offer together would be wider than
    // WIDE, and the text would be too small to read.
    const hold = fitCamera(unionRects(R("d.header"), R("d.due"), R("d.done")), 28, 2.0);
    const offer = fitCamera(R("o.offer"), 40, 2.0);
    const settled = lerpCam(
      offer,
      zoom(offer, 1.04),
      MOTION.drift(T, T_LOG + 1.3, c.Medications - T_LOG - 1.3),
    );
    camera = lerpCam(hold, settled, MOTION.move(T, T_LOG + 0.7, 0.6));
    const logNow = at(R("d.logNow"), 0.5, 0.55);
    cursorPath = {
      keys: [
        [c.LogNow, { x: logNow.x + 230, y: logNow.y + 170 }],
        [c.LogNow + 1.05, logNow],
        [T_LOG + 0.35, logNow],
        [T_LOG + 1.3, { x: logNow.x + 70, y: logNow.y + 95 }],
      ],
      clicks: [T_LOG],
    };
```

`pressAt` stays, because the cursor's `press` still uses it.

- [ ] **Step 6: Replace the returned `dashboard` and `toast`**

In the object `computeFrame` returns, replace this, from `dashboard: {` through the end of the `toast:` ternary:

```ts
    dashboard: {
      count: T >= T_LOG + 0.15 ? 3 : 2,
      lisinoprilDone: MOTION.enter(T, T_LOG + 0.15, 0.3),
      labelGone: MOTION.enter(T, T_LOG + 0.15, 0.3),
      entry: MOTION.enter(T, T_LOG + 0.2, 0.4),
      pillHover: T >= c.LogNow + 1.0 && T < T_LOG + 0.45,
      pillPress: pressAt(T, T_LOG),
      flash: T >= T_LOG && T < T_LOG + 0.6 ? MOTION.enter(T, T_LOG, 0.6) : 0,
      // Tailwind's animate-pulse (2s cycle) on the "Due now" label, driven by
      // T so it stays frame-accurate and pauses with the video.
      pulse: kind === "desk" && page === "dash" ? 0.75 + 0.25 * Math.cos(Math.PI * T) : 1,
    },
    toast:
      T < T_LOG + 0.2
        ? 0
        : T < T_LOG + 5.2
          ? MOTION.enter(T, T_LOG + 0.2, 0.3)
          : 1 - MOTION.enter(T, T_LOG + 5.2, 0.3),
```

with:

```ts
    dashboard: {
      // Log now reads "Logging…" for 0.4s. Its spinner turns with T rather
      // than with a CSS animation, so a paused frame is a still frame.
      pending: T >= T_LOG && T < T_LOG + 0.4 ? ((360 * (T - T_LOG)) / 0.75) % 360 : null,
      logged: MOTION.enter(T, T_LOG + 0.4, 0.3),
      // No five-second timer, as in the app: the offer stays until the hard
      // cut to Medications, which implies time has passed.
      offer: T >= c.Medications ? 0 : MOTION.enter(T, T_LOG + 0.5, 0.3),
    },
```

The `phone: { … }` object below it is unchanged; T8 owns it.

- [ ] **Step 7: Run the timeline tests to verify they pass**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: PASS, every test in the file, including T6's sweep and MEASURED tests.

The values these pins rely on, which the probe measured:

- `T_LOG = 7.45`;
- `CUES.Medications − (T_LOG + 0.8) = 1.75`, which is at least 1.5;
- `computeFrame(T_LOG + 0.2).dashboard.pending ≈ 96`;
- `logged` is exactly `1` at `T_LOG + 0.7`, and `offer` is exactly `1` at `T_LOG + 0.8`. easeOut's cube underflows, so those are exact equalities.

- [ ] **Step 8: Write the failing desktop render tests**

Open `tests/unit/walkthrough-dashboard-fidelity.test.ts`, which T5 wrote under `// @vitest-environment node`. Merge these imports into its existing import statements. Add only the names T5 does not already import, and never add a second import line for a module T5 already imports from.

```ts
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import {
  dashboardHeaderCopy,
  doneCoversLine,
  doneDoseText,
  formatDoseLabel,
  formatSlotTime,
  headerEyebrow,
  laterUntil,
  rowStatusLine,
  tookItAtLabel,
} from "$lib/utils/dashboard-copy";
import { formatUserTime, type TimeFormat } from "$lib/utils/time";
import { LOGGED_DOSE, WALKTHROUGH_TZ } from "$lib/components/walkthrough/demo-data";
import { WALKTHROUGH_DATE_FORMAT } from "$lib/components/walkthrough/stage-dashboard";
import { T_LOG, computeFrame, type Frame } from "$lib/components/walkthrough/timeline";
import DashboardScene from "$lib/components/walkthrough/scenes/DashboardScene.svelte";
import WalkthroughStage from "$lib/components/walkthrough/WalkthroughStage.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
```

T5 already imports `formatDoseLabel`, `LOGGED_DOSE` and `WALKTHROUGH_TZ`, and has `import type { TimeFormat } from "$lib/utils/time";`, which becomes `import { formatUserTime, type TimeFormat } from "$lib/utils/time";`.

`ComposedPayload`, `MOMENTS`, `composeMoment` and `expectedOfferText` are T5's exports in this same file; do not import them. This half builds its payloads and its offer text only through them, so the file has one construction of each. Then append this at the end of the file:

```ts
// ── T7: the desktop scene, rendered ──────────────────────────────────────
//
// The data half above proves DESKTOP_BEFORE and DESKTOP_AFTER equal the
// composer's payload. This half proves the scene SHOWS them: every
// section's visible text equals the real copy helpers' output over the
// composer's own payload, called with the moment's `now` and `todayStart`,
// WALKTHROUGH_TZ and the stage's time format.

/**
 * The desktop beat's two payloads, straight from the composer, built the one
 * way T5's data half builds them. That half proves `toStageMoment` of each
 * equals DESKTOP_BEFORE and DESKTOP_AFTER, so this half re-proves nothing.
 */
const DESKTOP_BEFORE_PAYLOAD = composeMoment(MOMENTS[0]);
const DESKTOP_AFTER_PAYLOAD = composeMoment(MOMENTS[1]);

type SectionName = "header" | "due" | "done" | "later" | "chips";

/**
 * Whether the stage hides `el` itself: fully transparent (a collapse or a
 * crossfade at 0), hidden, or the `invisible` layer DoseActionForm keeps
 * behind a button's label. SSR inline styles are all jsdom has, and they are
 * exactly what the stage draws with.
 */
function hiddenHere(el: Element): boolean {
  const style = (el as HTMLElement).style;
  return (
    style.opacity === "0" || style.visibility === "hidden" || el.classList.contains("invisible")
  );
}

/** Drawn: neither `el` nor any ancestor is hidden. */
function drawn(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    if (hiddenHere(node)) return false;
  }
  return true;
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * What a viewer can read in `el`: every drawn text node in document order,
 * joined with spaces. Joining nodes rather than reading textContent keeps
 * two adjacent elements from running their words together.
 */
function visibleText(el: Element): string {
  if (!drawn(el)) return "";
  const clone = el.cloneNode(true) as Element;
  for (const node of [...clone.querySelectorAll("*")]) if (hiddenHere(node)) node.remove();
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(clone, doc.defaultView!.NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    parts.push(node.nodeValue ?? "");
  }
  return squash(parts.join(" "));
}

/** The drawn `[data-stage-row]` elements in a section. */
function drawnRows(section: Element): number {
  if (!drawn(section)) return 0;
  return [...section.querySelectorAll("[data-stage-row]")].filter(drawn).length;
}

/**
 * Each section's text as the app renders it, from the composer's payload
 * and the real helpers: the oracle. The page's own rules decide what
 * appears (Earlier and Today sub-headings, the as-needed-only titles); the
 * stage draws only what the demo needs, so a payload that needs more fails
 * here rather than drawing something false.
 */
function expectedSections(
  p: ComposedPayload,
  timeFormat: TimeFormat,
): Record<SectionName, { text: string[]; rows: number | null }> {
  const now = new Date(p.now);
  const todayStart = new Date(p.todayStart);
  const tz = WALKTHROUGH_TZ;
  const asNeededOnly = p.status.kind === "as-needed-only";
  const header = dashboardHeaderCopy(p.status, now, tz, timeFormat);

  const due: string[] = [];
  if (p.earlier.length > 0) due.push("Earlier");
  for (const [group, cards] of [
    ["earlier", p.earlier],
    ["today", p.today],
  ] as const) {
    if (group === "today" && p.earlier.length > 0 && cards.length > 0) due.push("Today");
    for (const card of cards) {
      card.rows.forEach((row, index) => {
        const slot = new Date(row.expectedTime);
        if (index === 0) due.push(card.name, `${card.dosageAmount}${card.dosageUnit}`);
        due.push(
          rowStatusLine({ state: row.state, expectedTime: slot }, now, todayStart, tz, timeFormat),
        );
        if (row.logNow) due.push("Log now");
        if (row.tookItAt !== null) {
          due.push(tookItAtLabel(formatSlotTime(slot, todayStart, tz, timeFormat)));
        }
        if (row.skipAt !== null) due.push("Skip");
      });
    }
  }

  const done = p.done.flatMap((row) => {
    const med = row.dose.medication;
    const covers = doneCoversLine(row.covers, todayStart, tz, timeFormat);
    return [
      ...(row.dayLabel === "yesterday" ? ["Yesterday"] : []),
      formatUserTime(new Date(row.dose.takenAt), tz, timeFormat),
      med.name,
      doneDoseText({
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        quantity: row.dose.quantity,
        status: row.dose.status,
      }),
      ...(row.dose.status === "skipped" ? ["Skipped"] : []),
      ...(covers ? [covers] : []),
      row.dose.status === "taken" ? "Edit" : "Remove skip",
    ];
  });

  const later = p.later.flatMap((row) => [
    formatSlotTime(new Date(row.expectedTime), todayStart, tz, timeFormat),
    row.name,
    `${row.dosageAmount}${row.dosageUnit}`,
    laterUntil(row.expectedTime, now),
  ]);

  return {
    header: {
      text: [
        headerEyebrow(now, tz, WALKTHROUGH_DATE_FORMAT),
        "Today",
        header.sentence,
        ...(header.supporting ? [header.supporting] : []),
      ],
      rows: null,
    },
    due: { text: due, rows: [...p.earlier, ...p.today].reduce((n, c) => n + c.rows.length, 0) },
    done: { text: [asNeededOnly ? "Logged today" : "Done today", ...done], rows: p.done.length },
    later: { text: later.length > 0 ? ["Later today", ...later] : [], rows: p.later.length },
    chips: {
      text: [
        asNeededOnly ? "Log a dose" : "Log something else",
        ...p.medications.flatMap((m) => [
          "−",
          formatDoseLabel(m.name, m.dosageAmount, m.dosageUnit),
          "+",
        ]),
      ],
      rows: p.medications.length,
    },
  };
}

function renderDashboardScene(state: Frame["dashboard"], timeFormat: TimeFormat): string {
  return render(DashboardScene, { props: { state, timeFormat } }).body;
}

function renderStage(T: number, timeFormat: TimeFormat): string {
  return render(WalkthroughStage, {
    props: { frame: computeFrame(T, {}), time: T, full: true, timeFormat },
  }).body;
}

/** Anything a part must never draw: a control, a heading, a list or a landmark. */
const FORBIDDEN =
  "a[href], area[href], button, input, select, textarea, summary, details, iframe, " +
  "audio[controls], video[controls], [contenteditable], [tabindex], form, " +
  "h1, h2, h3, h4, h5, h6, section, nav, main, header, footer, aside, ul, ol, li";

describe("the desktop scene against the app: rendered text", () => {
  describe.each(["24h", "12h"] as const)("in %s time", (timeFormat) => {
    it.each([
      { moment: "before the log", T: T_LOG - 0.1, payload: DESKTOP_BEFORE_PAYLOAD },
      { moment: "after the log", T: T_LOG + 1.0, payload: DESKTOP_AFTER_PAYLOAD },
    ])("$moment, every section reads what the helpers say", ({ T, payload }) => {
      const doc = ssrDocument(renderDashboardScene(computeFrame(T, {}).dashboard, timeFormat));
      for (const [name, want] of Object.entries(expectedSections(payload, timeFormat))) {
        const section = doc.querySelector(`[data-stage-section="${name}"]`);
        expect(section, `${name} is mounted`).not.toBeNull();
        expect(visibleText(section!), name).toBe(squash(want.text.join(" ")));
        if (want.rows !== null) expect(drawnRows(section!), `${name} rows`).toBe(want.rows);
      }
    });

    it("hides the Undo offer before the log, then words it as Log now's reload would", () => {
      // T5's oracle: logToastFromReload over the reloaded payload, as Log now
      // calls it. It throws when that payload has no Done row for the dose,
      // so the expectation is never the plain fallback sentence.
      const message = expectedOfferText(DESKTOP_AFTER_PAYLOAD, LOGGED_DOSE.desktop, timeFormat);
      for (const [T, want] of [
        [T_LOG - 0.1, ""],
        [T_LOG + 1.0, squash(`${message} Undo ×`)],
      ] as const) {
        const doc = ssrDocument(renderStage(T, timeFormat));
        const offer = doc.querySelector(
          '[data-stage-surface="desktop"] [data-stage-section="offer"]',
        );
        expect(offer, "the offer is mounted").not.toBeNull();
        expect(visibleText(offer!), `offer at ${T}`).toBe(want);
      }
    });
  });

  it("reads Logging… while the log is pending, the spinner turned by Frame, not by CSS", () => {
    const state = computeFrame(T_LOG + 0.2, {}).dashboard;
    expect(state.pending).not.toBeNull();
    const doc = ssrDocument(renderDashboardScene(state, "24h"));
    const due = doc.querySelector('[data-stage-section="due"]')!;
    const text = visibleText(due);
    expect(text).toContain("Logging…");
    expect(text).not.toContain("Log now");
    const spinners = [...due.querySelectorAll<HTMLElement>("span")].filter(
      (el) => drawn(el) && el.style.transform.startsWith("rotate("),
    );
    expect(spinners.map((el) => el.style.transform)).toEqual([`rotate(${state.pending}deg)`]);
  });

  it("draws no control, heading, list or landmark, and no animate-* or transition-* class", () => {
    for (const T of [T_LOG - 0.1, T_LOG + 0.2, T_LOG + 1.0]) {
      const desktop = ssrDocument(renderStage(T, "24h")).querySelector(
        '[data-stage-surface="desktop"]',
      );
      expect(desktop, "the desktop surface is rendered").not.toBeNull();
      expect(desktop!.querySelector('[data-stage-section="due"]')).not.toBeNull();
      expect(
        [...desktop!.querySelectorAll(FORBIDDEN)].map((el) => el.tagName),
        `at ${T}`,
      ).toEqual([]);
      const moving = [...desktop!.querySelectorAll("*")]
        .flatMap((el) => [...el.classList])
        .filter(
          (c) => c.startsWith("animate-") || c === "transition" || c.startsWith("transition-"),
        );
      expect(moving, `at ${T}`).toEqual([]);
    }
  });
});

// Review Focus 1: a visitor whose own clock and zone are far from the story
// must see exactly what a visitor in London on the story day sees. Nothing
// in the scene may read `new Date()`, `Date.now()` or the runtime's zone.
describe("the desktop stage for a visitor far from the story", () => {
  it("renders byte-identical markup in Auckland on 1 March 2027", () => {
    const renderAll = () => [
      renderDashboardScene(computeFrame(T_LOG - 0.1, {}).dashboard, "24h"),
      renderDashboardScene(computeFrame(T_LOG + 0.2, {}).dashboard, "24h"),
      renderDashboardScene(computeFrame(T_LOG + 1.0, {}).dashboard, "12h"),
      renderStage(T_LOG + 1.0, "24h"),
    ];
    const here = renderAll();
    const zone = process.env.TZ;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2027-03-01T09:30:00+13:00"));
      process.env.TZ = "Pacific/Auckland";
      // The zone change took: this runtime now reads local time in Auckland.
      expect(new Date(0).getHours()).toBe(12);
      const there = renderAll();
      there.forEach((body, i) => expect(body === here[i], `render ${i}`).toBe(true));
    } finally {
      vi.useRealTimers();
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
```

- [ ] **Step 9: Run the render tests to verify they fail**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`

Expected: FAIL. The file does not load, with `Failed to resolve import "$lib/components/walkthrough/stage-dashboard"`, so every test in it fails, T5's included. This step creates that module next.

- [ ] **Step 10: Create `stage-dashboard.ts`**

Create `src/lib/components/walkthrough/stage-dashboard.ts`:

```ts
// What the dashboard scenes need beyond the StageMoments themselves: the
// date format the stage renders labels in, the Done row a beat logs, the
// Undo offer's message for it, and the Refills rows. Nothing here reads a
// clock or the visitor's zone; every instant comes from a moment.

import type { DateFormat, TimeFormat } from "$lib/utils/time";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";
import { MEDICATIONS, WALKTHROUGH_TZ } from "./demo-data";
import type { StageDone, StageMoment } from "./demo-dashboard";

/** The default preference (`user_preferences.dateFormat`), which a new account sees. */
export const WALKTHROUGH_DATE_FORMAT: DateFormat = "DD/MM/YYYY";

/**
 * The Done row for the dose a beat logs. It throws rather than returning
 * undefined: a stage drawn from a moment that lacks its own beat dose is a
 * broken fixture, and SSR or the fidelity test should say so loudly.
 */
export function beatRow(moment: StageMoment, doseId: string): StageDone {
  const row = moment.done.find((r) => r.dose.id === doseId);
  if (!row) throw new Error(`walkthrough: no Done row for ${doseId}`);
  return row;
}

/**
 * The Undo offer's message after a beat: `toastForLog` over the AFTER
 * moment's Done row for that dose. That is exactly what Log now's
 * `logToastFromReload` builds from the reloaded page, so the offer states
 * which slots the dose actually covered ("— counted for your 8:00 dose").
 */
export function stageLogToast(moment: StageMoment, doseId: string, timeFormat: TimeFormat): string {
  const { dose, covers } = beatRow(moment, doseId);
  return toastForLog({
    label: formatDoseLabel(dose.name, dose.dosageAmount, dose.dosageUnit),
    quantity: dose.quantity,
    takenAt: dose.takenAt,
    covers: covers.map((iso) => new Date(iso)),
    todayStart: moment.todayStart,
    tz: WALKTHROUGH_TZ,
    timeFormat,
  });
}

/**
 * The Refills card's rows: each medication the demo marks `refillWatch`,
 * with its supply in days. 8 days is RefillsCard's "watch" tier
 * (`inventory.ts`: critical ≤ 3d, warning ≤ 7d, watch ≤ 14d).
 */
export const STAGE_REFILLS = MEDICATIONS.filter((m) => m.refillWatch).map((m) => ({
  medicationId: m.id,
  medicationName: m.name,
  colour: m.colour,
  daysUntilRefill: m.supplyDays,
  severity: "watch" as const,
}));
```

- [ ] **Step 11: Create `StageCollapse.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte`:

```svelte
<script lang="ts">
  // Draws its content at `factor` × its natural height, without measuring
  // anything: a one-row grid whose row is `factor`fr sizes that row to
  // factor × the content's height, because the content's overflow-hidden box
  // has no minimum size of its own. 1 is the natural layout, with no style at
  // all; 0 is zero height and fully transparent.
  //
  // The content is mounted at every factor, so a mark inside it is registered
  // at every T, and its offsetTop and offsetHeight are the natural ones
  // whatever the factor: measured geometry never depends on T.
  import type { Snippet } from "svelte";

  let { factor, children }: { factor: number; children: Snippet } = $props();
</script>

<div
  class="grid"
  style:grid-template-rows={factor >= 1 ? undefined : `${factor}fr`}
  style:opacity={factor >= 1 ? undefined : factor}
>
  <div class="min-h-0 overflow-hidden">
    {@render children()}
  </div>
</div>
```

- [ ] **Step 12: Create `StageDashboardHeader.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte`:

```svelte
<script lang="ts">
  // DashboardHeader.svelte as a picture: the date eyebrow, "Today", the
  // status sentence and its supporting line, with the real component's
  // classes. "Today" is a <p>, never a heading: the stage adds no headings.
  // The status crossfades from `before` to `after` as `logged` goes 0 → 1.
  // Both layers share one grid cell, so nothing below the header moves.
  import type { DashboardStatus } from "$lib/types";
  import type { DateFormat, TimeFormat } from "$lib/utils/time";
  import { dashboardHeaderCopy, headerEyebrow } from "$lib/utils/dashboard-copy";
  import { useMark } from "../../marks";
  import { WALKTHROUGH_DATE_FORMAT } from "../../stage-dashboard";

  let {
    before,
    after,
    logged,
    now,
    tz,
    timeFormat,
    dateFormat = WALKTHROUGH_DATE_FORMAT,
    mark,
  }: {
    before: DashboardStatus;
    after: DashboardStatus;
    logged: number;
    /** The moment's `now`; a beat's before and after share it. */
    now: Date;
    tz: string;
    timeFormat: TimeFormat;
    dateFormat?: DateFormat;
    mark?: string;
  } = $props();

  const register = useMark();

  const eyebrow = $derived(headerEyebrow(now, tz, dateFormat));
  const layers = $derived([
    { key: "before", copy: dashboardHeaderCopy(before, now, tz, timeFormat), opacity: 1 - logged },
    { key: "after", copy: dashboardHeaderCopy(after, now, tz, timeFormat), opacity: logged },
  ]);
</script>

<div use:register={mark} data-stage-section="header" class="space-y-1">
  <p class="text-text-secondary text-sm">{eyebrow}</p>
  <p class="text-2xl font-bold">Today</p>
  <div class="grid">
    {#each layers as layer (layer.key)}
      <div class="col-start-1 row-start-1 space-y-1" style:opacity={layer.opacity}>
        <p class="text-lg font-semibold">{layer.copy.sentence}</p>
        {#if layer.copy.supporting}
          <p class="text-text-secondary text-sm">{layer.copy.supporting}</p>
        {/if}
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 13: Create `StageDueCard.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`:

```svelte
<script lang="ts">
  // DueCard.svelte as a picture: the same grid, glyph, marker and copy, with
  // every control drawn as a span and DoseActionForm's variant classes
  // copied without their hover and transition classes. A row offers what
  // DueCard's `actions` snippet offers, by the same rule: Log now when
  // `row.logNow`, Took it at when `row.tookItAt !== null`, Skip when
  // `row.skipAt !== null`. Those are payload values, fixed for the whole
  // loop, so the {#if} around the marked Log now never changes with T.
  //
  // `pending` is the spinner's angle in degrees while Log now reads
  // "Logging…", or null. Label and pending text share one grid cell, as in
  // DoseActionForm, so the button keeps its width; the spinner turns by
  // `pending`, never by an animate-spin class.
  import type { DueCard, DueRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import { formatSlotTime, rowStatusLine, tookItAtLabel } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import { useMark } from "../../marks";

  let {
    card,
    now,
    todayStart,
    tz,
    timeFormat,
    pending,
    logNowMark,
  }: {
    card: DueCard;
    now: Date;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    pending: number | null;
    logNowMark?: string;
  } = $props();

  const register = useMark();

  const top = $derived(card.rows[0]);
  const rest = $derived(card.rows.slice(1));
  const dose = $derived(`${card.dosageAmount}${card.dosageUnit}`);
  const border = $derived(top.state === "due-now" ? "border-accent-ink/50" : "border-warning/50");

  function markerFor(row: DueRow): "due-now" | "overdue" {
    return row.state === "due-now" ? "due-now" : "overdue";
  }

  function view(row: DueRow) {
    const slot = new Date(row.expectedTime);
    return {
      status: rowStatusLine(
        { state: row.state, expectedTime: slot },
        now,
        todayStart,
        tz,
        timeFormat,
      ),
      tookItAt: tookItAtLabel(formatSlotTime(slot, todayStart, tz, timeFormat)),
    };
  }
  type RowView = ReturnType<typeof view>;

  const topView = $derived(view(top));
</script>

{#snippet face(label: string, pendingLabel: string, angle: number | null)}
  <span class="inline-grid">
    <span
      class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {angle === null
        ? ''
        : 'invisible'}">{label}</span
    >
    <span
      class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {angle === null
        ? 'invisible'
        : ''}"
      ><span
        class="h-4 w-4 rounded-full border-2 border-current border-t-transparent"
        style:transform="rotate({angle ?? 0}deg)"
      ></span><span>{pendingLabel}</span></span
    >
  </span>
{/snippet}

{#snippet actions(row: DueRow, v: RowView)}
  {#if row.logNow}
    <div class="col-start-3 row-span-2 row-start-1">
      <span
        use:register={logNowMark}
        class="bg-accent text-accent-fg inline-flex h-12 min-w-26 items-center justify-center rounded-lg px-4 text-base font-semibold"
        >{@render face("Log now", "Logging…", pending)}</span
      >
    </div>
  {/if}
  {#if row.tookItAt !== null || row.skipAt !== null}
    <div class="col-start-2 mt-2 flex flex-wrap gap-2">
      {#if row.tookItAt !== null}
        <span
          class="border-border-strong text-text-primary inline-flex h-11 items-center justify-center rounded-lg border px-3 text-sm font-medium"
          >{@render face(v.tookItAt, "Recording…", null)}</span
        >
      {/if}
      {#if row.skipAt !== null}
        <span
          class="text-text-secondary inline-flex h-11 min-w-11 items-center justify-center rounded-lg px-3 text-sm font-medium"
          >{@render face("Skip", "Skipping…", null)}</span
        >
      {/if}
    </div>
  {/if}
{/snippet}

<div class="bg-glass rounded-xl border p-3 backdrop-blur-xl {border}">
  <div data-stage-row class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
    <div class="row-span-2 flex flex-col items-center gap-2 pt-1">
      <MedicationGlyph
        colour={card.colour}
        colourSecondary={card.colourSecondary}
        pattern={card.pattern}
        size="md"
      />
      <StatusMarker state={markerFor(top)} />
    </div>
    <div class="min-w-0">
      <p class="flex min-w-0 items-baseline gap-2">
        <span class="text-text-primary text-base font-semibold">{card.name}</span>
        <span class="text-text-secondary truncate text-sm">{dose}</span>
      </p>
      <p class="text-text-primary text-sm">{topView.status}</p>
    </div>
    {@render actions(top, topView)}
  </div>

  {#if rest.length > 0}
    <div class="border-glass-border mt-3 space-y-3 border-t pt-3">
      {#each rest as row (row.key)}
        {@const v = view(row)}
        <div data-stage-row class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
          <div class="row-span-2 flex justify-center pt-0.5">
            <StatusMarker state={markerFor(row)} />
          </div>
          <p class="text-text-primary min-w-0 text-sm">{v.status}</p>
          {@render actions(row, v)}
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 14: Create `StageDoneList.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageDoneList.svelte`:

```svelte
<script lang="ts">
  // DoneList.svelte as a picture: "Done today" over one glass card of
  // divided rows. Each row has the time, the status marker, a small glyph,
  // the name and dose, the covers line ("for 08:00") underneath, and Edit
  // drawn as a span. The rows are `after`'s. A row `before` lacks is the dose
  // the beat logs: it grows in with `logged`, and is drawn at zero height,
  // but mounted, before the log. A row only `before` has is not drawn at all,
  // and the fidelity test's before-render fails if one ever appears.
  //
  // DoneList's `divide-y` is written out as `border-t` on every row after the
  // first, so a growing row's divider sits inside its collapse and is hidden
  // with it.
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { doneCoversLine, doneDoseText } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import type { StageDone } from "../../demo-dashboard";
  import { useMark } from "../../marks";
  import StageCollapse from "./StageCollapse.svelte";

  let {
    before,
    after,
    logged,
    todayStart,
    tz,
    timeFormat,
    mark,
  }: {
    before: StageDone[];
    after: StageDone[];
    logged: number;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    mark?: string;
  } = $props();

  const register = useMark();

  const beforeKeys = $derived(new Set(before.map((row) => row.key)));

  function view(row: StageDone) {
    return {
      time: formatUserTime(row.dose.takenAt, tz, timeFormat),
      dose: doneDoseText(row.dose),
      covers: doneCoversLine(row.covers, todayStart, tz, timeFormat),
    };
  }
</script>

<div use:register={mark} data-stage-section="done">
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Done today</p>
  <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
    {#each after as row, index (row.key)}
      {@const v = view(row)}
      <StageCollapse factor={beforeKeys.has(row.key) ? 1 : logged}>
        <div
          data-stage-row
          class="flex min-h-11 items-center gap-3 py-1 {index > 0
            ? 'border-glass-border border-t'
            : ''}"
        >
          <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
            {#if row.dayLabel === "yesterday"}
              <span class="block text-xs">Yesterday</span>
            {/if}
            <span>{v.time}</span>
          </span>
          <StatusMarker state={row.dose.status} />
          <MedicationGlyph
            colour={row.dose.colour}
            colourSecondary={row.dose.colourSecondary}
            pattern={row.dose.pattern}
            size="sm"
          />
          <div class="min-w-0 flex-1">
            <p class="flex min-w-0 items-baseline gap-2 text-sm">
              <span class="text-text-primary truncate font-medium">{row.dose.name}</span>
              <span class="text-text-secondary shrink-0">{v.dose}</span>
              {#if row.dose.status === "skipped"}
                <span class="text-text-secondary shrink-0">Skipped</span>
              {/if}
            </p>
            {#if v.covers}
              <p class="text-text-secondary truncate text-xs">{v.covers}</p>
            {/if}
          </div>
          {#if row.dose.status === "taken"}
            <span
              class="border-border-strong text-text-primary inline-flex h-11 shrink-0 items-center rounded-lg border px-3 text-sm font-medium"
              >Edit</span
            >
          {:else}
            <span
              class="text-text-secondary inline-flex h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-3 text-sm font-medium"
              >Remove skip</span
            >
          {/if}
        </div>
      </StageCollapse>
    {/each}
  </div>
</div>
```

- [ ] **Step 15: Create `StageLaterList.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageLaterList.svelte`:

```svelte
<script lang="ts">
  // LaterList.svelte as a picture: "Later today" over 40px read-only lines,
  // each the slot time, a hollow ring marker, a small glyph, the name and
  // dose, and how far off it is ("in 6 hours"). Like LaterList it draws
  // nothing when there are no rows, but its root stays mounted so its mark
  // is registered either way.
  import type { LaterRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import { formatSlotTime, laterUntil } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import StatusMarker from "$components/dashboard/StatusMarker.svelte";
  import { useMark } from "../../marks";

  let {
    rows,
    now,
    todayStart,
    tz,
    timeFormat,
    mark,
  }: {
    rows: LaterRow[];
    now: Date;
    todayStart: Date;
    tz: string;
    timeFormat: TimeFormat;
    mark?: string;
  } = $props();

  const register = useMark();
</script>

<div use:register={mark} data-stage-section="later">
  {#if rows.length > 0}
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Later today</p>
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      {#each rows as row (row.key)}
        <div data-stage-row class="flex h-10 items-center gap-3">
          <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums"
            >{formatSlotTime(new Date(row.expectedTime), todayStart, tz, timeFormat)}</span
          >
          <StatusMarker state="upcoming" />
          <MedicationGlyph
            colour={row.colour}
            colourSecondary={row.colourSecondary}
            pattern={row.pattern}
            size="sm"
          />
          <p class="flex min-w-0 flex-1 items-baseline gap-2 text-sm">
            <span class="text-text-primary truncate font-medium">{row.name}</span>
            <span class="text-text-secondary shrink-0">{row.dosageAmount}{row.dosageUnit}</span>
          </p>
          <span class="text-text-secondary shrink-0 text-sm"
            >{laterUntil(row.expectedTime, now)}</span
          >
        </div>
      {/each}
    </div>
  {/if}
</div>
```

- [ ] **Step 16: Create `StageChips.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageChips.svelte`:

```svelte
<script lang="ts">
  // QuickLogBar.svelte as a picture, under the page's "Log something else"
  // eyebrow: one 44px neutral chip per medication, in medication order. Each
  // chip is `−`, then a small glyph and the dose label, then `+`. The
  // medication's colours appear only in the glyph. At quantity 1 the app
  // draws `−` aria-disabled, so here it is drawn `text-text-muted` as a
  // plain class. The chips are on screen in the Today shot and never tapped.
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import type { StageMedication } from "../../demo-dashboard";
  import { useMark } from "../../marks";

  let { medications, mark }: { medications: StageMedication[]; mark?: string } = $props();

  const register = useMark();
</script>

<div use:register={mark} data-stage-section="chips">
  <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">
    Log something else
  </p>
  <div class="flex flex-wrap gap-2">
    {#each medications as med (med.id)}
      <div
        data-stage-row
        class="border-border-strong bg-glass text-text-primary box-content flex h-11 items-center overflow-hidden rounded-full border"
      >
        <span
          class="text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none"
          >−</span
        >
        <span
          class="text-text-primary inline-flex h-11 items-center justify-center gap-2 rounded-full px-3 text-sm font-medium"
        >
          <MedicationGlyph
            colour={med.colour}
            colourSecondary={med.colourSecondary}
            pattern={med.pattern}
            size="sm"
          />
          <span>{formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit)}</span>
        </span>
        <span class="flex h-11 w-11 shrink-0 items-center justify-center text-base select-none"
          >+</span
        >
      </div>
    {/each}
  </div>
</div>
```

- [ ] **Step 17: Export `RefillsCard`'s row rules from a `<script module>`**

The stage cannot mount `RefillsCard`: the card renders a link and an `<h2>`, and the stage has no controls or headings (Global Constraints). So the card's three private row rules move, unchanged, into a `<script module>`, and `StageRefills` imports them. A later change to the card's wording then changes the stage with it, instead of leaving a stale copy that no test notices. T4 does the same for `StatusBreakdownBar`, and `MedicalDisclaimer`'s `DISCLAIMER_TEXT` already crosses into the walkthrough this way.

Replace the whole of `src/lib/components/RefillsCard.svelte` with:

```svelte
<script lang="ts" module>
  import type { RefillForecastEntry } from "$lib/types";

  // Exported so a surface that cannot mount this card still tints and words
  // its rows by the same rules: the landing-page walkthrough draws Refills
  // with no link, heading or landmark, and this card renders all three.
  export function refillSeverityClass(severity: RefillForecastEntry["severity"]): string {
    if (severity === "critical") return "border-danger-ink/40 bg-danger/5";
    if (severity === "warning") return "border-warning/40 bg-warning/5";
    if (severity === "watch") return "border-info/30 bg-info/5";
    return "border-glass-border bg-glass";
  }

  export function refillSeverityLabel(severity: RefillForecastEntry["severity"]): string {
    if (severity === "critical") return "text-danger-ink";
    if (severity === "warning") return "text-warning";
    if (severity === "watch") return "text-info";
    return "text-text-secondary";
  }

  export function refillDaysLabel(days: number | null): string {
    if (days === null) return "Refill needed";
    if (days <= 0) return "Out today";
    if (days === 1) return "1 day left";
    return `${days} days left`;
  }
</script>

<script lang="ts">
  type Props = { entries: RefillForecastEntry[] };
  let { entries }: Props = $props();
</script>

{#if entries.length > 0}
  <section aria-labelledby="refills-heading">
    <h2
      id="refills-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      Refills
    </h2>
    <div class="space-y-2">
      {#each entries as entry (entry.medicationId)}
        <a
          href="/medications/{entry.medicationId}"
          class="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:opacity-90 {refillSeverityClass(
            entry.severity,
          )}"
        >
          <span
            class="h-2.5 w-2.5 shrink-0 rounded-full"
            style="background-color: {entry.colour}"
            aria-hidden="true"
          ></span>
          <span class="min-w-0 flex-1 truncate font-medium">{entry.medicationName}</span>
          <span class="shrink-0 text-xs {refillSeverityLabel(entry.severity)}">
            {refillDaysLabel(entry.daysUntilRefill)}
          </span>
        </a>
      {/each}
    </div>
  </section>
{/if}
```

What moved, and what did not:

- The three function bodies are byte-for-byte the old ones. Only their names gain the `refill` prefix, because a module export is visible to every importer.
- The `RefillForecastEntry` type import moves into the module script. The instance script still reads it, because a module script's declarations are in scope in the instance script.
- The markup's three calls take the new names. Every class, attribute and text node is unchanged, and Step 18 proves the rendered markup byte-identical.

The probe ran this file through Prettier (unchanged), svelte-check (0 errors, 27 warnings, the baseline) and ESLint. ESLint's one finding is `svelte/no-navigation-without-resolve` on the `href`, which the card already has at base, so the lint count does not move.

- [ ] **Step 18: Prove the move is markup-neutral (throwaway, deleted before commit)**

`RefillsCard` has no unit test of its own. This step compares the committed card, which T7 has not touched at `HEAD`, with the edited one. It covers the empty-list guard, the demo's one watch row, and a list that reaches every severity and every branch of `refillDaysLabel`.

```bash
git show HEAD:src/lib/components/RefillsCard.svelte > tests/unit/zz-t7-refills-before.svelte
cat > tests/unit/zz-t7-refills-neutral.test.ts <<'EOF'
// @vitest-environment node
import { it, expect } from "vitest";
import { render } from "svelte/server";
import type { RefillForecastEntry } from "$lib/types";
import Before from "./zz-t7-refills-before.svelte";
import After from "$lib/components/RefillsCard.svelte";

function entry(
  medicationId: string,
  daysUntilRefill: number | null,
  severity: RefillForecastEntry["severity"],
): RefillForecastEntry {
  return {
    medicationId,
    medicationName: `Medication ${medicationId}`,
    colour: "#3b82f6",
    inventoryCount: 10,
    dailyRate: 1,
    daysUntilRefill,
    severity,
  };
}

it("renders byte-identical markup before and after the move", () => {
  for (const entries of [
    [],
    [entry("ibu", 8, "watch")],
    [
      entry("a", null, "critical"),
      entry("b", 0, "critical"),
      entry("c", -2, "critical"),
      entry("d", 1, "critical"),
      entry("e", 5, "warning"),
      entry("f", 12, "watch"),
      entry("g", 40, "ok"),
    ],
  ]) {
    expect(render(After, { props: { entries } }).body).toBe(
      render(Before, { props: { entries } }).body,
    );
  }
});
EOF
npx vitest run tests/unit/zz-t7-refills-neutral.test.ts
```

Expected: `Tests  1 passed (1)`. The probe ran these three prop sets against the Step 17 file and they passed.

Prove the throwaway can fail before trusting it. In `RefillsCard.svelte`'s `refillDaysLabel`, change `return "1 day left";` to `return "1 days left";`, re-run `npx vitest run tests/unit/zz-t7-refills-neutral.test.ts`, and see it FAIL (the bodies differ at entry `d`). Undo that one edit by hand, never with `git checkout --` or `git restore`, which would discard Step 17. Re-run to see PASS. Then delete both throwaway files:

```bash
rm tests/unit/zz-t7-refills-before.svelte tests/unit/zz-t7-refills-neutral.test.ts
git status --short tests/unit src/lib/components/RefillsCard.svelte
```

Expected: no `zz-t7-` file is listed. `src/lib/components/RefillsCard.svelte` is listed as modified, and so are the two test files this task has already edited.

- [ ] **Step 19: Create `StageRefills.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageRefills.svelte`:

```svelte
<script lang="ts">
  // RefillsCard.svelte as a picture, last on the page as it is in the app.
  // Each row is a colour dot, the name and the days left, drawn as a <div>
  // where the app has a link, under a <p> where the app has an <h2>. The
  // tint and the days-left wording are RefillsCard's own exported rules, so
  // a change to the card's wording changes the stage with it. Only the
  // card's hover and transition classes are left out.
  import type { RefillForecastEntry } from "$lib/types";
  import {
    refillDaysLabel,
    refillSeverityClass,
    refillSeverityLabel,
  } from "$components/RefillsCard.svelte";

  type Entry = Pick<
    RefillForecastEntry,
    "medicationId" | "medicationName" | "colour" | "daysUntilRefill" | "severity"
  >;

  let { entries }: { entries: readonly Entry[] } = $props();
</script>

{#if entries.length > 0}
  <div>
    <p class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase">Refills</p>
    <div class="space-y-2">
      {#each entries as entry (entry.medicationId)}
        <div
          class="flex items-center gap-3 rounded-lg border p-3 {refillSeverityClass(
            entry.severity,
          )}"
        >
          <span class="h-2.5 w-2.5 shrink-0 rounded-full" style:background-color={entry.colour}
          ></span>
          <span class="min-w-0 flex-1 truncate font-medium">{entry.medicationName}</span>
          <span class="shrink-0 text-xs {refillSeverityLabel(entry.severity)}"
            >{refillDaysLabel(entry.daysUntilRefill)}</span
          >
        </div>
      {/each}
    </div>
  </div>
{/if}
```

The import stays on four lines: on one line it is 109 characters, and Prettier breaks it. The probe rendered this part against the Step 17 card and found `refillDaysLabel(8)` ("8 days left"), `refillSeverityClass("watch")` and `refillSeverityLabel("watch")` in its output. svelte-check and ESLint reported nothing for it.

- [ ] **Step 20: Create `StageUndoOffer.svelte`**

Create `src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte`:

```svelte
<script lang="ts">
  // The one Undo offer from ui/Toast.svelte as a picture: the message, an
  // underlined "Undo" and "×", with the offer's classes. Undo and × are spans
  // shaped like the 44px buttons they stand for. The caller positions it,
  // as Toast's stack positions the real one. Its entrance is `opacity`, a
  // Frame value, never a CSS transition, and it has no five-second timer,
  // because the app's offer has none.
  import { useMark } from "../../marks";

  let { message, opacity, mark }: { message: string; opacity: number; mark?: string } = $props();

  const register = useMark();
</script>

<div
  use:register={mark}
  data-stage-section="offer"
  class="border-success/30 bg-success/10 text-success flex max-w-sm flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-xl"
  style:opacity
  style:transform="translateY({(1 - opacity) * 8}px)"
>
  <span class="min-w-0 flex-1 text-sm">{message}</span>
  <span class="inline-flex min-h-11 items-center px-3 text-sm font-medium underline">Undo</span>
  <span class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-base"
    >×</span
  >
</div>
```

- [ ] **Step 21: Replace `DashboardScene.svelte`**

Replace the whole of `src/lib/components/walkthrough/scenes/DashboardScene.svelte` with the following. This deletes the Quick Log `LABELS` map, `flashShadow` and the `formatDueIn` import.

```svelte
<script lang="ts">
  // routes/(app)/dashboard/+page.svelte at DESKTOP_NOW (08:02): the header,
  // Lisinopril's due-now card, Done today, Later today, the chips and
  // Refills, top to bottom as the app orders them. The LogNow shot taps the
  // card's Log now. Two moments drive it, DESKTOP_BEFORE and DESKTOP_AFTER,
  // and the fidelity test proves both equal the real composer's payload.
  // `state` (Frame.dashboard) only says how far the stage has moved from one
  // to the other.
  //
  // Every marked element is mounted at every T. The Due section collapses
  // and the new Done row grows through StageCollapse, never through {#if},
  // so the rects measured near T=0 are the before-log layout.
  //
  // The spacing is the page's `space-y-6`, written as `mt-6` on each section
  // and `pt-6` inside the Due collapse, so the collapse takes its gap with it.
  import type { TimeFormat } from "$lib/utils/time";
  import { LOGGED_DOSE, WALKTHROUGH_TZ } from "../demo-data";
  import { DESKTOP_AFTER, DESKTOP_BEFORE } from "../demo-dashboard";
  import { STAGE_REFILLS, beatRow } from "../stage-dashboard";
  import { useMark } from "../marks";
  import type { Frame } from "../timeline";
  import StageChips from "../parts/dashboard/StageChips.svelte";
  import StageCollapse from "../parts/dashboard/StageCollapse.svelte";
  import StageDashboardHeader from "../parts/dashboard/StageDashboardHeader.svelte";
  import StageDoneList from "../parts/dashboard/StageDoneList.svelte";
  import StageDueCard from "../parts/dashboard/StageDueCard.svelte";
  import StageLaterList from "../parts/dashboard/StageLaterList.svelte";
  import StageRefills from "../parts/dashboard/StageRefills.svelte";

  let { state, timeFormat }: { state: Frame["dashboard"]; timeFormat: TimeFormat } = $props();

  const register = useMark();

  const before = DESKTOP_BEFORE;
  const after = DESKTOP_AFTER;
  /** The medication whose card the LogNow shot taps. */
  const tapped = beatRow(after, LOGGED_DOSE.desktop).dose.medicationId;
  /**
   * BEFORE's Due cards. The log resolves the only due row, so AFTER has
   * none and the whole section collapses with `logged`. A card AFTER alone
   * had would not be drawn, and the fidelity test's after-render would fail.
   */
  const dueCards = [...before.earlier, ...before.today];
  const dueStays = after.earlier.length + after.today.length > 0;
</script>

<div class="mx-auto w-full max-w-2xl">
  <StageDashboardHeader
    before={before.status}
    after={after.status}
    logged={state.logged}
    now={before.now}
    tz={WALKTHROUGH_TZ}
    {timeFormat}
    mark="d.header"
  />

  <StageCollapse factor={dueStays ? 1 : 1 - state.logged}>
    <div class="pt-6">
      <div use:register={"d.due"} data-stage-section="due" class="space-y-3">
        {#each dueCards as card (card.key)}
          <StageDueCard
            {card}
            now={before.now}
            todayStart={before.todayStart}
            tz={WALKTHROUGH_TZ}
            {timeFormat}
            pending={card.medicationId === tapped ? state.pending : null}
            logNowMark={card.medicationId === tapped ? "d.logNow" : undefined}
          />
        {/each}
      </div>
    </div>
  </StageCollapse>

  <div class="mt-6">
    <StageDoneList
      before={before.done}
      after={after.done}
      logged={state.logged}
      todayStart={before.todayStart}
      tz={WALKTHROUGH_TZ}
      {timeFormat}
      mark="d.done"
    />
  </div>

  <div class="mt-6">
    <StageLaterList
      rows={before.later}
      now={before.now}
      todayStart={before.todayStart}
      tz={WALKTHROUGH_TZ}
      {timeFormat}
      mark="d.later"
    />
  </div>

  <div class="mt-6">
    <StageChips medications={before.medications} mark="d.chips" />
  </div>

  <div class="mt-6">
    <StageRefills entries={STAGE_REFILLS} />
  </div>
</div>
```

- [ ] **Step 22: Put the Undo offer in the stage's overlay**

In `src/lib/components/walkthrough/WalkthroughStage.svelte`, replace:

```svelte
  import { PAGES, SITE_HOST } from "./demo-data";
  import { STAGE_H, STAGE_W, WIN_H, WIN_W, activeCaption, type Frame } from "./timeline";
  import AppShell from "./parts/AppShell.svelte";
  import ChromeWindow from "./parts/ChromeWindow.svelte";
  import StageToast from "./parts/StageToast.svelte";
```

with:

```svelte
  import { LOGGED_DOSE, PAGES, SITE_HOST } from "./demo-data";
  import { DESKTOP_AFTER } from "./demo-dashboard";
  import { stageLogToast } from "./stage-dashboard";
  import { STAGE_H, STAGE_W, WIN_H, WIN_W, activeCaption, type Frame } from "./timeline";
  import AppShell from "./parts/AppShell.svelte";
  import ChromeWindow from "./parts/ChromeWindow.svelte";
  import StageUndoOffer from "./parts/dashboard/StageUndoOffer.svelte";
```

If T4 already changed the `./demo-data` import line, add `LOGGED_DOSE` to it instead of replacing it.

Replace:

```svelte
  const camera = $derived(frame.camera);
</script>
```

with:

```svelte
  const camera = $derived(frame.camera);
  // The desktop beat's Undo offer, as Log now's reload would word it.
  const desktopOffer = $derived(stageLogToast(DESKTOP_AFTER, LOGGED_DOSE.desktop, timeFormat));
</script>
```

Replace:

```svelte
    <div class="absolute inset-0" style:visibility={frame.kind === "desk" ? "visible" : "hidden"}>
```

with:

```svelte
    <div
      class="absolute inset-0"
      data-stage-surface="desktop"
      style:visibility={frame.kind === "desk" ? "visible" : "hidden"}
    >
```

Replace:

```svelte
<StageToast text="Lisinopril logged" progress={frame.toast} markKey="o.toast" />
```

with:

```svelte
<!-- Where Toast's stack sits: fixed right-4 bottom-4 in the app -->
<div class="absolute right-4 bottom-4 z-50 flex flex-col gap-2">
  <StageUndoOffer message={desktopOffer} opacity={frame.dashboard.offer} mark="o.offer" />
</div>
```

`PhoneScene` keeps importing `StageToast` itself, so the file stays until T8 deletes it.

- [ ] **Step 23: Run the render and timeline tests to verify they pass**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-timeline.test.ts`

Expected: PASS, with T5's data half, the nine new render tests (three per time format, then `reads Logging…`, `draws no control…`, and `renders byte-identical markup in Auckland…`) and every timeline test green. T5's `$name equals the real composer's output at its moment` already proves `toStageMoment(composeMoment(MOMENTS[0]))` and `[1]` equal `DESKTOP_BEFORE` and `DESKTOP_AFTER`, so this half adds no test of its own for that.

**What the helpers return, as the probe measured them (on this repo's Node ICU, 24h):**

| Section, moment | Visible text                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| header, before  | `Thu 24 Sept Today 1 dose due 2 of 8 done today`                                                                                                                                                       |
| header, after   | `Thu 24 Sept Today All caught up Next: Vitamin D 1000IU at 9:05 · in 1 hour`                                                                                                                           |
| due, before     | `Lisinopril 10mg Due 8:00 · 2 minutes ago Log now Skip`. Took it at is hidden by the due-now rule. 1 row                                                                                               |
| due, after      | empty, 0 rows                                                                                                                                                                                          |
| done, before    | `Done today 6:10 Ibuprofen 200mg Edit 7:48 Metformin 500mg Edit`, 2 rows                                                                                                                               |
| done, after     | adds `8:02 Lisinopril 10mg for 8:00 Edit`, 3 rows                                                                                                                                                      |
| later, both     | `Later today 9:05 Vitamin D 1000IU in 1 hour 14:10 Ibuprofen 200mg in 6 hours 19:48 Metformin 500mg in 11 hours 22:05 Magnesium Glycinate 300mg in 14 hours 22:10 Ibuprofen 200mg in 14 hours`, 5 rows |
| chips, both     | `Log something else − Vitamin D 1000IU + − Lisinopril 10mg + − Metformin 500mg + − Ibuprofen 200mg + − Magnesium Glycinate 300mg +`, 5 rows                                                            |
| offer, after    | `Lisinopril 10mg logged at 8:02 — counted for your 8:00 dose Undo ×`. In 12h it reads `… 8:02 am — counted for your 8:00 am dose …`                                                                    |
| pending         | the due text reads `… Logging… Skip`, with the spinner at `rotate(96.00000000000007deg)`                                                                                                               |

These are illustrative. No test pins any of them: every assertion compares against helper output.

- [ ] **Step 24: Delete `formatDueIn` and its tests**

In `src/lib/utils/time.ts`, replace:

```ts
 * THE duration formatter. Every "how long" on screen goes through it, so no
 * caller can print "504h 20m" for three weeks again. `formatDueIn` did,
 * because it had no day unit.
```

with:

```ts
 * THE duration formatter. Every "how long" on screen goes through it, so no
 * caller can print "504h 20m" for three weeks again, as the dashboard's old
 * due label did before it had a day unit.
```

Then delete this whole block, together with the blank line after it:

```ts
/**
 * "Due in 2h 15m" / "Overdue 21d" / "Due now". Positive ms is time until
 * due, negative is overdue, and under a minute either way is "Due now".
 *
 * Built on `formatDuration` (short, two units), which is what gives it a
 * day unit. A medication last taken three weeks ago used to read
 * "Overdue 504h 20m".
 */
export function formatDueIn(ms: number): string {
  if (Math.abs(ms) < 60_000) return "Due now";
  const label = formatDuration(ms, { style: "short", maxUnits: 2 });
  return ms > 0 ? `Due in ${label}` : `Overdue ${label}`;
}
```

In `tests/unit/time.test.ts`:

- delete the line `  formatDueIn,` from the import at the top;
- delete the whole `describe("formatDueIn", () => { … });` block, from `describe("formatDueIn", () => {` through its closing `});`, which sits directly above `describe("formatDuration", () => {`, together with the blank line that follows it.

`formatDuration`'s own threshold tests keep the day-unit coverage: `24 * HOUR` is `"1d"`, `49 * HOUR` is `"2d 1h"`, and so on.

Then run: `grep -rn "formatDueIn" src tests`

Expected: no output. The spec's `docs/` references are history and stay.

- [ ] **Step 25: Run the time tests**

Run: `npx vitest run tests/unit/time.test.ts`

Expected: PASS. Five fewer tests than before this step, and none failing.

- [ ] **Step 26: Prove the new tests by mutation**

Apply each mutation alone, run the named command, see the named test FAIL, then undo the one edit by hand and re-run to see PASS. Never use `git checkout --` or `git restore` here: every file these mutations touch holds this task's uncommitted work. `timeline.ts`, `DashboardScene.svelte` and `WalkthroughStage.svelte` carry this task's Frame, shot and scene rewrites, and the parts are untracked, so a checkout would silently discard that work or fail. Record each one in the task report.

1. **The offer's 5.2-second timer** (`timeline.ts`). Change `offer: T >= c.Medications ? 0 : MOTION.enter(T, T_LOG + 0.5, 0.3),` to `offer: T >= T_LOG + 5.2 ? 0 : MOTION.enter(T, T_LOG + 0.5, 0.3),`.
   - Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`
   - FAIL: `logs Lisinopril once, from Log now: pending, then logged, then the Undo offer until the cut`, because `at(CUES.Medications).offer` is 1, not 0.
2. **The cut** (`timeline.ts`). Change the same line to `offer: MOTION.enter(T, T_LOG + 0.5, 0.3),`.
   - Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`
   - FAIL: `never leaves the log half-done: no spinner outside its window, and the seam matches`, because the last frame's `offer` is 1 against the first frame's 0.
3. **The hold framing** (`timeline.ts`). Change `const hold = fitCamera(unionRects(R("d.header"), R("d.due"), R("d.done")), 28, 2.0);` to `const hold = fitCamera(unionRects(R("d.header"), R("d.due")), 28, 2.0);`.
   - Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`
   - FAIL: `taps Log now, holds on the header, Due and Done through the update, then frames the offer`. T6's Proxy sweep test also fails, because `d.done` is listed but no longer read.
4. **A hard-coded status line** (`StageDueCard.svelte`). In `view()`, replace the whole `status: rowStatusLine(…),` property with `status: "Due 8:00 · 3 minutes ago",`.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: `in 24h time > 'before the log', every section reads what the helpers say` (`due: expected 'Lisinopril 10mg Due 8:00 · 3 minutes …' to be 'Lisinopril 10mg Due 8:00 · 2 minutes …'`), and the 12h twin.
5. **The visitor's clock as serverNow** (`StageDueCard.svelte`). In `view()`, change `rowStatusLine(` … `now,` to pass `new Date(),` in place of `now`.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: both `'before the log'` tests (`… Due 8:00 · 18 days ag…`, or however far today is from the story), and `renders byte-identical markup in Auckland on 1 March 2027` (`render 0: expected false to be true`).
6. **Due that never collapses** (`DashboardScene.svelte`). Change `<StageCollapse factor={dueStays ? 1 : 1 - state.logged}>` to `<StageCollapse factor={1}>`.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: both `'after the log', every section reads what the helpers say` tests (`due: expected 'Lisinopril 10mg Due 8:00 …' to be ''`).
7. **A Done row that never grows** (`StageDoneList.svelte`). Change `<StageCollapse factor={beforeKeys.has(row.key) ? 1 : logged}>` to `<StageCollapse factor={1}>`.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: both `'before the log'` tests, because `done` shows the Lisinopril row and 3 rows before the log.
8. **A control in a part** (`StageChips.svelte`). Directly after the `+` span's closing `>`, add `<button type="button">x</button>`.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: `draws no control, heading, list or landmark, and no animate-* or transition-* class` (`expected [ 'BUTTON', … ] to deeply equal []`). The chips text tests fail too.
9. **The offer worded from the wrong moment** (`WalkthroughStage.svelte`). Change `stageLogToast(DESKTOP_AFTER, LOGGED_DOSE.desktop, timeFormat)` to `stageLogToast(DESKTOP_BEFORE, LOGGED_DOSE.desktop, timeFormat)`, and import `DESKTOP_BEFORE` alongside it.
   - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
   - FAIL: both `hides the Undo offer before the log…` tests, with `walkthrough: no Done row for dose-lis-20260924-0802`.
10. **A CSS spinner** (`StageDueCard.svelte`). Add `animate-spin` to the spinner span's class list.
    - Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`
    - FAIL: `draws no control, heading, list or landmark, and no animate-* or transition-* class` (`expected [ 'animate-spin', … ] to deeply equal []`).

Before moving on, run `git diff --stat` and confirm that only this task's intended changes remain.

- [ ] **Step 27: Run the gates**

Run, from the worktree root:

```bash
npx prettier --write src/lib/components/walkthrough src/lib/components/RefillsCard.svelte tests/unit/walkthrough-timeline.test.ts tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/time.test.ts src/lib/utils/time.ts
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **`npx vitest run`, both runs:** 0 failures, with any failing test named. T7 adds no test file (Step 18's throwaway is deleted). The test count is T6's count **+ 7**: −5 `formatDueIn`; timeline −1 replaced, +4 new; fidelity +9 render.
- **`npm run check`:** 0 errors, at most 27 warnings.
- **`npm run lint`:** 0 errors, at most 115 warnings.
- **`npm run format:check`:** clean.

The probe type-checked every new part with svelte-check (0 errors, 0 warnings), ran ESLint with no findings, and checked Prettier as already formatted. The edited `RefillsCard.svelte` keeps the card's one existing ESLint warning (`svelte/no-navigation-without-resolve` on its `href`) and adds none, so neither warning count moves.

- [ ] **Step 28: Commit**

```bash
git add src/lib/components/walkthrough/stage-dashboard.ts \
  src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageDoneList.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageLaterList.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageChips.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageRefills.svelte \
  src/lib/components/walkthrough/parts/dashboard/StageUndoOffer.svelte \
  src/lib/components/walkthrough/scenes/DashboardScene.svelte \
  src/lib/components/walkthrough/WalkthroughStage.svelte \
  src/lib/components/walkthrough/timeline.ts \
  src/lib/components/RefillsCard.svelte \
  src/lib/utils/time.ts \
  tests/unit/walkthrough-timeline.test.ts \
  tests/unit/walkthrough-dashboard-fidelity.test.ts \
  tests/unit/time.test.ts
git commit -m "feat(walkthrough): redraw the desktop dashboard scene to the shipped dashboard" \
  -m "The desktop scene drew the deleted dashboard: a summary strip, My Day, coloured Quick Log pills, a green flash and a toast that faded after five seconds. It now draws the header, the due-now card with Log now, Done today, Later today, the neutral chips and Refills, as span-drawn parts that copy the real components' classes and add no control, heading or landmark." \
  -m "Frame.dashboard becomes { pending, logged, offer }: Log now's spinner turns with T, Due collapses and Done grows without unmounting a mark, and the one Undo offer stays until the cut to Medications. The top-level toast goes. Today opens on the header and Due and pans to the chips; LogNow holds on header, Due and Done, then frames the offer." \
  -m "walkthrough-dashboard-fidelity renders the scene before and after the log and checks every section's text against the real copy helpers over the composer's payload, and the offer against the offer oracle (logToastFromReload over the reloaded payload). A render in Auckland on 1 March 2027 is byte-identical. Timeline pins for count and lisinoprilDone are replaced by pending, logged and offer pins, because the app has neither a count nor a flash." \
  -m "RefillsCard's three row rules move, unchanged, into an exported <script module>, so the stage's Refills rows are tinted and worded by the card's own rules rather than a copy. The card's rendered markup is byte-identical." \
  -m "formatDueIn had no caller left, so it and its tests go; formatDuration's tests keep the day-unit coverage."
```

#### Notes for the reviewer

- **The collapse uses a `{factor}fr` grid row, not a measured height.**
  - **What the spec says.** It phrases the collapse as `(1 − logged) × measured` and the new row as `logged × row height`.
  - **Why not measure.** Svelte 5's `bind:offsetHeight` is built on `ResizeObserver` (`svelte/src/internal/client/dom/elements/bindings/size.js`), which jsdom does not provide. T9 mounts `WalkthroughStage` in jsdom, so a measured height would make that test stub `ResizeObserver`, or crash.
  - **Why `fr` gives the same height.** In an auto-height grid, a `Nfr` row whose item has no minimum size (`min-h-0 overflow-hidden`) resolves to N × the item's max-content height for N ≤ 1. That is the CSS Grid "indefinite free space" rule, and the reason the common 0fr↔1fr collapse works.
  - **What checks it.** jsdom has no layout, so T10's browser screenshots ("just after the update") are the geometry check.
- **`{#if row.logNow}` around a marked element is the payload-fixed case the Global Constraint allows.** `StageDueCard` wraps the marked Log now span in it, copying DueCard's rule, as the spec's `StageDueCard` row requires ("Filled 48px **Log now** if `row.logNow`"). The constraint forbids an `{#if}`, `{#key}` or `{#each}` whose condition depends on T or the Frame. `row.logNow` is payload data, fixed for the whole loop, so the registered set never changes with T. The probe mounted the stage at all seven of T9's moments and saw the same eight desktop keys every time, and T9's mount test asserts it.
- **The loop seam (Review Focus 2).** The seam test asserts what Review Focus 2 asks: `pending` is null outside its window and `logged`/`offer` stay in [0, 1] at every 20ms sample; `pending` and `offer` at T=0 equal their values at T=TOTAL_DURATION−ε; `logged` is 0 at T=0 and through 1.2s, while the marks are measured; and both seam frames are title frames, so the dashboard is off screen across the jump. `logged` itself cannot match across the seam: by the contract's formula it is 0 at the start of the loop and 1 at the end.
- **Refills draws by `RefillsCard`'s own rules, and has no fidelity check.** Its tint and its "8 days left" come from `refillSeverityClass`, `refillSeverityLabel` and `refillDaysLabel`, which Step 17 moves out of the card's instance script unchanged. This is how T4 handles `StatusBreakdownBar`: the stage cannot mount the card, so the card exports its rule. Step 18 proves the card's markup byte-identical. The data comes from `MEDICATIONS[].refillWatch`/`supplyDays`: Ibuprofen, 8 days, watch tier. The spec lists no Refills fidelity check, so the render test does not read this section.
- **The Due section draws BEFORE's cards only.** It collapses when AFTER has no due row. A card only AFTER has, or one in both moments that differs, is not drawn, and the after-render test fails rather than drawing something false. `StageDoneList` draws `after`'s rows, and grows the ones `before` lacks. Earlier/Today sub-headings are in the oracle (`expectedSections`) but not drawn, because neither moment has an Earlier card.
- **`data-stage-surface="desktop"`** is new on WalkthroughStage's desktop layer. It is how the offer test finds the desktop offer once T8 adds a phone offer with the same section marker.
- **`StageUndoOffer` is not self-positioned.** WalkthroughStage wraps it in Toast's `right-4 bottom-4` stack, and T8 can position it where the phone's stack sits.
- **Mutations not run in the probe.** 2, 6, 9 and 10 follow directly from the assertions, but were not individually executed. 1, 3, 4, 5, 7 and 8 were run, and failed as stated.

#### Interface notes (deviations from the planning contract)

- **`StageDashboardHeader`'s props are not fixed by the contract.** It takes the two `DashboardStatus` values and one `now`, not two StageMoments. A beat's before and after share `now`, and the phone scene can then pass `PHONE_BEFORE.status`/`PHONE_AFTER.status` directly.
- **Two modules the contract does not name.** `stage-dashboard.ts` and `StageCollapse.svelte` are needed for the beat's offer wording, the shared date format and the mounted-at-every-T collapse. The seven contract parts keep their names. The header's File Structure → Create list needs these two lines:
  - `` `src/lib/components/walkthrough/stage-dashboard.ts` (T7; T8 adds `lastEventBefore`) ``
  - `` `src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte` (T7: grow and collapse by an `fr` grid row, content always mounted) ``
- **`RefillsCard.svelte` is modified outside the walkthrough, and the contract does not name its exports.** The header's File Structure → Modify list needs this line:
  - `` `src/lib/components/RefillsCard.svelte` (T7: its three row rules move, unchanged, into an exported `<script module>` as `refillSeverityClass`, `refillSeverityLabel` and `refillDaysLabel`, so StageRefills draws Refills by the card's own rules without its link or `<h2>`; Step 18 proves the markup byte-identical) ``

  The header's Global Constraint "Every visible dashboard string in the stage comes from a real helper" should list `refillDaysLabel` (from `$components/RefillsCard.svelte`) beside the copy helpers. T10's CLAUDE.md bullet should name the `<script module>` export pattern that T4 (`statusBreakdownSegments`) and T7 (the three Refills rules) share: a shipped component the stage cannot mount exports its rule, and the stage imports it rather than copying it.

### Task 8: Redraw the phone scene

The phone still draws the deleted dashboard: a "Dashboard" title, a "3 doses today" strip, My Day's emoji groups, a 40×20 "Log" text link for the fingertip, a plain "Vitamin D logged" toast with no Undo, and a status bar stuck at 9:41. This task redraws it at `PHONE_NOW` (10:12) from the two moments T5 proved equal to the real composer, `PHONE_BEFORE` and `PHONE_AFTER`, with T7's parts at 402px:

- the header ("1 dose due" / "3 of 8 done today");
- Vitamin D's amber overdue card with **Log now**, **Took it at 9:05** and **Skip**;
- Done today;
- the first `PHONE_LATER_ROWS` rows of Later today.

The fingertip taps the card's Log now, which now carries `p.vitdLog`. The card collapses, the header crossfades to "All caught up", Done grows the 10:12 row, and one Undo offer rises at the bottom of the phone and stays until the cut to the Outro. The push banner's body comes from `lastLoggedPhrase` on the story clock, and the status bar reads 10:12.

`Frame.phone` trades `vitaminDDone` and `toast` for the desktop's `pending`, `logged` and `offer`, computed by one `logBeat` helper that both surfaces share. Then the parts nothing draws any more are deleted: `MyDaySection`, `SummaryAndRefills`, `StatusMark`, `StageToast`, and demo-data's My Day block.

**Files:**

Line ranges are at base `311758f`. T4, T6 and T7 shift several of them, so every edit below is anchored on quoted text, never on a line number.

- Modify: `src/lib/components/walkthrough/timeline.ts`:
  - `:279-318`: the `Frame` type. `dashboard` (T7's shape) becomes `LogBeat`, and `phone` becomes `LogBeat & { bannerY; touch; scale }`;
  - before `:320` (`pressAt`): the new `logBeat` function;
  - `:524-563`: the returned `dashboard` (T7's object) and the phone's `vitaminDDone`/`toast`.
  - `REQUIRED_MARKS` does **not** change: the phone still reads only `p.vitdLog`, which keeps its name and moves to Log now.
- Modify: `src/lib/components/walkthrough/scenes/PhoneScene.svelte:1-178`. The whole file is replaced.
- Modify: `src/lib/components/walkthrough/WalkthroughStage.svelte:160`, the phone layer's opening `<div>`, which gains `data-stage-surface="phone"`.
- Modify: `src/lib/components/walkthrough/stage-dashboard.ts` (created by T7): its header comment and `./demo-data` import (lines 1-8), and a new `lastEventBefore` appended at the end.
- Modify: `src/lib/components/walkthrough/demo-data.ts:232-256`. The `// ── My Day ──` block is deleted.
- Delete:
  - `src/lib/components/walkthrough/parts/MyDaySection.svelte`
  - `src/lib/components/walkthrough/parts/SummaryAndRefills.svelte`
  - `src/lib/components/walkthrough/parts/StatusMark.svelte`
  - `src/lib/components/walkthrough/parts/StageToast.svelte`
- Test: `tests/unit/walkthrough-timeline.test.ts`:
  - the MEASURED comment and its `"p.vitdLog"` entry (base `:64`);
  - the progress test's two phone lines (base `:179-180`);
  - three new tests, inserted before the typing test.
- Test: `tests/unit/walkthrough-dashboard-fidelity.test.ts`. Three import lines change, and the phone render half is appended.
- Test: `tests/unit/walkthrough-marks.svelte.test.ts` (created by T6). Its imports change, and one `describe` is appended.

**Interfaces:**

- **Consumes:**
  - **T2** (`$lib/utils/time`): `lastLoggedPhrase(lastEventAt: Date | null, now: Date): string`. Also the existing `formatUserTime(date: Date, tz: string, format: TimeFormat): string`.
  - **T4** (`walkthrough/demo-data`):
    - `WALKTHROUGH_TZ = "UTC"` and `PHONE_NOW = new Date("2026-09-24T10:12:00.000Z")`;
    - `DEMO_DOSES: readonly DemoDose[]`, where `DemoDose = { id; medicationId; takenAt: Date; quantity; status: "taken" | "skipped" }`;
    - `LOGGED_DOSE.phone` (`"dose-vitd-20260924-1012"`).
  - **T5** (`walkthrough/demo-dashboard`): `PHONE_BEFORE` and `PHONE_AFTER: StageMoment`, and `PHONE_LATER_ROWS: number` (2, provisional).
  - **T5's test-file exports** in `walkthrough-dashboard-fidelity.test.ts`:
    - `buildInputs(now: Date, includeIds: readonly string[] | "all-at-or-before-now"): DashboardCompositionInputs`;
    - `MOMENTS: readonly MomentCase[]`, where `MOMENTS[2]` is PHONE_BEFORE's case and `MOMENTS[3]` PHONE_AFTER's;
    - `composeMoment(c: MomentCase): ComposedPayload`;
    - `expectedOfferText(after: ComposedPayload, doseId: string, timeFormat: TimeFormat): string`.
  - **T6** (`walkthrough/timeline`, `walkthrough/marks`):
    - `T_TAP = CUES.Reminders + 3.0` (38.5), `CUES.Outro` (40.5) and `TOTAL_DURATION` (43.5);
    - `REQUIRED_MARKS`, which already lists `p.vitdLog`;
    - `MARKS_CONTEXT` (T6); `PHONE_ROOT` and `createMarkRegistry()` already exist at base (`marks.ts`);
    - the test file `tests/unit/walkthrough-marks.svelte.test.ts` and its module-level `target`/`app` teardown.
  - **T7** (`walkthrough/stage-dashboard`, `parts/dashboard/*`):
    - `beatRow(moment: StageMoment, doseId: string): StageDone` and `stageLogToast(moment: StageMoment, doseId: string, timeFormat: TimeFormat): string`;
    - `StageCollapse`: `{ factor: number; children: Snippet }`;
    - `StageDashboardHeader`: `{ before: DashboardStatus; after: DashboardStatus; logged: number; now: Date; tz: string; timeFormat: TimeFormat; dateFormat?: DateFormat; mark?: string }`;
    - `StageDueCard`: `{ card: DueCard; now: Date; todayStart: Date; tz: string; timeFormat: TimeFormat; pending: number | null; logNowMark?: string }`;
    - `StageDoneList`: `{ before: StageDone[]; after: StageDone[]; logged: number; todayStart: Date; tz: string; timeFormat: TimeFormat; mark?: string }`;
    - `StageLaterList`: `{ rows: LaterRow[]; now: Date; todayStart: Date; tz: string; timeFormat: TimeFormat; mark?: string }`;
    - `StageUndoOffer`: `{ message: string; opacity: number; mark?: string }`, which is not self-positioned;
    - `Frame["dashboard"]` = `{ pending: number | null; logged: number; offer: number }`, and the desktop layer's `data-stage-surface="desktop"`;
    - **T7's fidelity helpers**, at module level in the same test file: `DashboardPayload`, `SectionName`, `drawn`, `squash`, `visibleText`, `drawnRows`, `expectedSections(p, timeFormat)`, `renderStage(T, timeFormat)` and `FORBIDDEN`.
- **Produces** (T9 and T10 rely on these):
  - **In `timeline.ts`:**
    - `export type LogBeat = { pending: number | null; logged: number; offer: number }`;
    - `Frame["dashboard"]` is `LogBeat`. `Frame["phone"]` is `LogBeat & { bannerY: number; touch: { x: number; y: number; opacity: number; press: number } | null; scale: number }`, the contract's `{ bannerY, pending, logged, offer, touch, scale }`;
    - a module-private `logBeat(T: number, tap: number, cut: number): LogBeat`, called as `logBeat(T, T_LOG, c.Medications)` and `logBeat(T, T_TAP, c.Outro)`.
  - **In `stage-dashboard.ts`:** `export function lastEventBefore(medicationId: string, before: Date): Date | null`.
  - **`PhoneScene.svelte`.** Its props are unchanged: `{ state: Frame["phone"]; timeFormat: TimeFormat }`.
    - **Marks.** It keeps `const mark = useMark();` and `use:mark={PHONE_ROOT}`. It registers exactly two keys: `root.phone`, and `p.vitdLog` on Vitamin D's Log now, passed as `logNowMark`. `StageDashboardHeader`, `StageDoneList`, `StageLaterList` and the phone's `StageUndoOffer` get no `mark`.
    - **Sections.** It draws `data-stage-section` `header`, `due`, `done`, `later` and `offer`, once each, and no `chips`.
    - **Test hooks.** `data-stage-banner` sits on the push body, and `data-stage-clock` on the status bar's time.
    - **Unchanged boxes.** It keeps the device frame (`rounded-[48px]`) and the content box (`absolute inset-0 overflow-hidden px-4 pt-[72px] pb-4`).
  - **`WalkthroughStage.svelte`.** The phone layer carries `data-stage-surface="phone"`.
  - **In the fidelity file, at module level:** `PHONE_BEFORE_PAYLOAD`, `PHONE_AFTER_PAYLOAD`, `expectedPhoneSections`, `phoneSurface(T, timeFormat)`, `renderPhoneScene(state, timeFormat)` and `PHONE_TAPPED`.
  - **Gone:** `MyDaySection`, `SummaryAndRefills`, `StatusMark`, `StageToast`, and demo-data's `DayGroupKey`, `SlotStatus`, `DaySlot`, `DAY_GROUPS` and `daySlots`.

- [ ] **Step 1: Confirm what T1–T7 left**

Run, from the worktree root:

```bash
grep -c "export function lastLoggedPhrase" src/lib/utils/time.ts
grep -c "export const PHONE_LATER_ROWS" src/lib/components/walkthrough/demo-dashboard.ts
grep -cE "export function (beatRow|stageLogToast)" src/lib/components/walkthrough/stage-dashboard.ts
grep -cE "export const (T_TAP|REQUIRED_MARKS)" src/lib/components/walkthrough/timeline.ts
ls src/lib/components/walkthrough/parts/dashboard/
grep -n "vitaminDDone" src/lib/components/walkthrough/timeline.ts tests/unit/walkthrough-timeline.test.ts
grep -n "data-stage-surface" src/lib/components/walkthrough/WalkthroughStage.svelte
```

Expected:

- `1`, `1`, `2`, `2`;
- the eight parts: `StageChips.svelte`, `StageCollapse.svelte`, `StageDashboardHeader.svelte`, `StageDoneList.svelte`, `StageDueCard.svelte`, `StageLaterList.svelte`, `StageRefills.svelte` and `StageUndoOffer.svelte`;
- `vitaminDDone` on three lines: the `Frame` type and the returned phone object in `timeline.ts`, and the progress test;
- one `data-stage-surface="desktop"` line.

If any differs, stop: an earlier task has not landed as planned.

- [ ] **Step 2: Write the failing timeline tests**

Make three edits to `tests/unit/walkthrough-timeline.test.ts`. The file already imports every name they use (`CUES`, `T_TAP`, `TOTAL_DURATION`, `computeFrame`), and `samples` and `MEASURED` are module-level.

**2a. The fixture's phone rect.** `p.vitdLog` was the old 40×20 "Log" text link. It is now Log now, the card's 48px button, so the fixture describes that button.

Replace:

```ts
// and the chips at 734-920. The offer sits at the shell's bottom right.
const MEASURED: Measurements = {
```

with:

```ts
// and the chips at 734-920. The offer sits at the shell's bottom right.
// p.vitdLog is in phone space: the Vitamin D card's 48px Log now, at the
// right edge of the phone's first card, below the 112px header.
const MEASURED: Measurements = {
```

Replace:

```ts
  "p.vitdLog": { x: 330, y: 400, w: 40, h: 20 },
```

with:

```ts
  "p.vitdLog": { x: 253, y: 275, w: 120, h: 48 },
```

**2b. The progress test.** In `it("keeps every progress value within 0..1", …)`, replace:

```ts
        f.phone.vitaminDDone,
        f.phone.toast,
```

with:

```ts
        f.phone.logged,
        f.phone.offer,
```

**2c. Three new tests.** Insert them directly above `it("types the new medication a character at a time and never past its end", …)`, which T6 left directly below its `clicks to log at T_LOG on the desktop and taps at T_TAP on the phone` test. Replace:

```ts
  it("types the new medication a character at a time and never past its end", () => {
```

with:

```ts
  it("logs Vitamin D once, from the phone's Log now: pending, then logged, then the Undo offer until the Outro", () => {
    const at = (t: number) => computeFrame(t, MEASURED).phone;
    // The window edges themselves, which the 20ms samples step over.
    expect(at(T_TAP - 1e-6).pending).toBeNull();
    expect(at(T_TAP).pending).toBe(0);
    expect(at(T_TAP + 0.2).pending).toBeCloseTo(96, 6);
    expect(at(T_TAP + 0.4).pending).toBeNull();
    expect(at(T_TAP + 0.4).logged).toBe(0);
    expect(at(T_TAP + 0.7).logged).toBe(1);
    expect(at(T_TAP + 0.5).offer).toBe(0);
    expect(at(T_TAP + 0.8).offer).toBe(1);
    expect(at(CUES.Outro - 1e-6).offer).toBe(1);
    expect(at(CUES.Outro).offer).toBe(0);
    // Fully visible for over a second before the cut to the Outro.
    expect(CUES.Outro - (T_TAP + 0.8)).toBeGreaterThan(1);
    for (const t of samples) {
      const p = at(t);
      expect(p.pending !== null, `pending at ${t}`).toBe(t >= T_TAP && t < T_TAP + 0.4);
      if (t < T_TAP + 0.4) expect(p.logged, `logged at ${t}`).toBe(0);
      if (t >= T_TAP + 0.7) expect(p.logged, `logged at ${t}`).toBe(1);
      if (t < T_TAP + 0.5) expect(p.offer, `offer at ${t}`).toBe(0);
      if (t >= T_TAP + 0.8 && t < CUES.Outro) expect(p.offer, `offer at ${t}`).toBe(1);
      if (t >= CUES.Outro) expect(p.offer, `offer at ${t}`).toBe(0);
    }
  });

  // Review Focus 2, on the phone: a pause can land on any frame, and the loop
  // restarts at T=0, so no part of the tap may outlive its window.
  it("never leaves the phone's log half-done: no spinner outside its window, and the seam matches", () => {
    for (const t of samples) {
      const p = computeFrame(t, MEASURED).phone;
      if (t < T_TAP || t >= T_TAP + 0.4) expect(p.pending, `pending at ${t}`).toBeNull();
      for (const v of [p.logged, p.offer]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    const first = computeFrame(0, MEASURED);
    const last = computeFrame(TOTAL_DURATION - 1e-6, MEASURED);
    expect(last.phone.pending).toBe(first.phone.pending);
    expect(last.phone.offer).toBe(first.phone.offer);
    // `logged` is 1 at the end of the loop and 0 at its start. Both ends are
    // title frames, so the phone is off screen across the seam. Production
    // measures p.vitdLog while T is between 0 and 1.2s, so the card is
    // expanded, in its before-tap layout, whenever it is measured.
    for (const t of [0, 1.2]) expect(computeFrame(t, MEASURED).phone.logged).toBe(0);
    expect([first.kind, last.kind]).toEqual(["title", "title"]);
  });

  it("puts the fingertip on the middle of the phone card's Log now, where p.vitdLog is measured", () => {
    const logNow = MEASURED["p.vitdLog"]!;
    expect(computeFrame(T_TAP, MEASURED).phone.touch).toEqual({
      x: logNow.x + logNow.w / 2,
      y: logNow.y + logNow.h / 2,
      opacity: 1,
      press: 1,
    });
  });

  it("types the new medication a character at a time and never past its end", () => {
```

**Why existing pins change.**

- **The progress test** keeps its meaning, "every 0..1 Frame value stays in 0..1", over the phone fields that now exist. `vitaminDDone` and `toast` are gone.
- **MEASURED's `p.vitdLog`** changes because the mark moved from a 40×20 link to a 48px button. The new fingertip test reads it.
- **No other pin moves.** T6's `REQUIRED_MARKS` tests still pass unedited, because the set of keys `computeFrame` reads is unchanged.

- [ ] **Step 3: Run the timeline tests to verify they fail**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: FAIL, `3 failed`, with every other test passing (`3 failed | 34 passed (37)` at the counts T6 and T7 leave):

| Test                                                                                                                      | Message                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `computeFrame > logs Vitamin D once, from the phone's Log now: pending, then logged, then the Undo offer until the Outro` | `AssertionError: expected undefined to be null`                          |
| `computeFrame > never leaves the phone's log half-done: no spinner outside its window, and the seam matches`              | `AssertionError: pending at 0: expected undefined to be null`            |
| `computeFrame > keeps every progress value within 0..1`                                                                   | `TypeError: actual value must be number or bigint, received "undefined"` |

`puts the fingertip on the middle of the phone card's Log now, where p.vitdLog is measured` passes already: the fingertip formula is unchanged. It pins that formula against the new rect, and Step 14's M4 proves it.

- [ ] **Step 4: One beat helper for both surfaces, and the new `Frame.phone`**

Make five replacements in `src/lib/components/walkthrough/timeline.ts`: one each in 4a–4c, and two in 4d.

**4a. The `Frame` type's head**, as T7 left it. Replace:

```ts
export type Frame = {
  kind: ShotKind;
  page: DesktopPage;
  scroll: number;
  camera: Camera;
  cursor: CursorState | null;
  dashboard: {
    /** Log now's spinner angle in degrees on [T_LOG, T_LOG + 0.4), else null. */
    pending: number | null;
    /** 0 → 1 as the log's reload lands: Due collapses, the header crossfades, Done grows. */
    logged: number;
    /** The Undo offer's opacity: 0 → 1 after the log, and exactly 0 from the cut to Medications. */
    offer: number;
  };
```

with:

```ts
/**
 * One log beat, the desktop's (around T_LOG) or the phone's (around T_TAP).
 * Both run on the same clock, so `logBeat` computes both.
 */
export type LogBeat = {
  /** Log now's spinner angle in degrees for 0.4s from the tap, else null. */
  pending: number | null;
  /** 0 → 1 as the reload lands: Due collapses, the header crossfades, Done grows. */
  logged: number;
  /** The Undo offer's opacity: 0 → 1 after the tap, and exactly 0 from the next hard cut. */
  offer: number;
};

export type Frame = {
  kind: ShotKind;
  page: DesktopPage;
  scroll: number;
  camera: Camera;
  cursor: CursorState | null;
  dashboard: LogBeat;
```

**4b. The `Frame` type's phone slice.** Replace:

```ts
  phone: {
    bannerY: number;
    vitaminDDone: number;
    toast: number;
    touch: { x: number; y: number; opacity: number; press: number } | null;
    scale: number;
  };
```

with:

```ts
  phone: LogBeat & {
    bannerY: number;
    touch: { x: number; y: number; opacity: number; press: number } | null;
    scale: number;
  };
```

**4c. `logBeat`, above `pressAt`.** Replace:

```ts
/** Press-in over 150ms before a click, release over 150ms after it. */
```

with:

```ts
/**
 * One log beat from its tap: Log now reads "Logging…" for 0.4s, the reload
 * lands over the next 0.3s, and the Undo offer rises from tap + 0.5 and stays
 * until `cut`, the next hard cut, where it is exactly 0. There is no
 * five-second timer, as in the app: the cut implies time has passed. The
 * spinner turns with T rather than with a CSS animation, so a paused frame is
 * a still frame.
 */
function logBeat(T: number, tap: number, cut: number): LogBeat {
  return {
    pending: T >= tap && T < tap + 0.4 ? ((360 * (T - tap)) / 0.75) % 360 : null,
    logged: MOTION.enter(T, tap + 0.4, 0.3),
    offer: T >= cut ? 0 : MOTION.enter(T, tap + 0.5, 0.3),
  };
}

/** Press-in over 150ms before a click, release over 150ms after it. */
```

**4d. The returned beats.** In the object `computeFrame` returns, replace T7's dashboard object:

```ts
    dashboard: {
      // Log now reads "Logging…" for 0.4s. Its spinner turns with T rather
      // than with a CSS animation, so a paused frame is a still frame.
      pending: T >= T_LOG && T < T_LOG + 0.4 ? ((360 * (T - T_LOG)) / 0.75) % 360 : null,
      logged: MOTION.enter(T, T_LOG + 0.4, 0.3),
      // No five-second timer, as in the app: the offer stays until the hard
      // cut to Medications, which implies time has passed.
      offer: T >= c.Medications ? 0 : MOTION.enter(T, T_LOG + 0.5, 0.3),
    },
```

with:

```ts
    // Lisinopril, from Log now on the desktop. The offer goes at the cut to Medications.
    dashboard: logBeat(T, T_LOG, c.Medications),
```

The desktop's values are unchanged: `logBeat` computes the same three expressions with `tap = T_LOG` and `cut = c.Medications`. T7's desktop pins confirm it in Step 5.

Then replace the phone's two old fields:

```ts
      vitaminDDone: MOTION.enter(T, T_TAP, 0.3),
      toast: T < T_TAP + 0.15 ? 0 : MOTION.enter(T, T_TAP + 0.15, 0.3),
      touch,
```

with:

```ts
      // Vitamin D, from Log now on the phone. The offer goes at the cut to the Outro.
      ...logBeat(T, T_TAP, c.Outro),
      touch,
```

`bannerY`, `touch` and `scale` are untouched. `REQUIRED_MARKS` is untouched too: `computeFrame` still reads `p.vitdLog` and no other phone key.

- [ ] **Step 5: Run the timeline tests to verify they pass**

Run: `npx vitest run tests/unit/walkthrough-timeline.test.ts`

Expected: PASS, every test in the file (`37 passed` at the counts T6 and T7 leave: their 34 plus these 3). That includes T7's desktop beat tests, now computed through `logBeat`, and T6's `REQUIRED_MARKS` sweep.

The values these pins rely on, which the probe measured on the real `CUES`:

- `T_TAP = 38.5` and `CUES.Outro = 40.5`, so the offer is fully visible for `CUES.Outro − (T_TAP + 0.8) = 1.2000000000000028` s;
- `computeFrame(T_TAP + 0.2).phone.pending = 96.00000000000136`, so the pin is `toBeCloseTo(96, 6)`;
- `logged` is exactly `1` at `T_TAP + 0.7`, and `offer` exactly `1` at `T_TAP + 0.8`. easeOut's cube underflows, so these are exact equalities, as on the desktop;
- at `T_TAP` the fingertip has `opacity: 1` and `press: 1`.

- [ ] **Step 6: Write the failing render and mark tests**

**6a. The fidelity file's imports.** In `tests/unit/walkthrough-dashboard-fidelity.test.ts`, make three replacements. Each line is as T7 left it.

Replace:

```ts
import { formatUserTime, type TimeFormat } from "$lib/utils/time";
```

with:

```ts
import { formatUserTime, lastLoggedPhrase, type TimeFormat } from "$lib/utils/time";
```

Replace:

```ts
import { T_LOG, computeFrame, type Frame } from "$lib/components/walkthrough/timeline";
```

with:

```ts
import { CUES, T_LOG, T_TAP, computeFrame, type Frame } from "$lib/components/walkthrough/timeline";
```

Replace:

```ts
import DashboardScene from "$lib/components/walkthrough/scenes/DashboardScene.svelte";
```

with:

```ts
import DashboardScene from "$lib/components/walkthrough/scenes/DashboardScene.svelte";
import PhoneScene from "$lib/components/walkthrough/scenes/PhoneScene.svelte";
```

`buildInputs`, `MOMENTS`, `composeMoment` and `expectedOfferText` are T5's functions, and `expectedSections`, `visibleText`, `drawn`, `drawnRows`, `squash`, `renderStage`, `FORBIDDEN`, `DashboardPayload` and `SectionName` are T7's, all in this same file; do not import them. `DEMO_DOSES`, `LOGGED_DOSE`, `PHONE_NOW`, `WALKTHROUGH_TZ`, `PHONE_LATER_ROWS`, `vi`, `render` and `ssrDocument` are already imported.

**6b. The phone render half.** Append this at the end of the file, after T7's `describe("the desktop stage for a visitor far from the story", …)`, separated by one blank line:

```ts
// ── T8: the phone scene, rendered ────────────────────────────────────────
//
// The desktop's check, at PHONE_NOW: every section the phone draws reads
// what the real helpers say over the composer's own payload, before and
// after the fingertip's tap. The phone draws Later only as far as
// PHONE_LATER_ROWS and draws no chips, so its oracle is the desktop's with
// Later cut to that prefix and the chips left out. Each check reads the
// phone layer of the whole stage, so a section drawn on the wrong surface,
// or twice, fails.

const PHONE_BEFORE_PAYLOAD = composeMoment(MOMENTS[2]);
const PHONE_AFTER_PAYLOAD = composeMoment(MOMENTS[3]);

type PhoneSectionName = Exclude<SectionName, "chips">;

function expectedPhoneSections(
  p: DashboardPayload,
  timeFormat: TimeFormat,
): Record<PhoneSectionName, { text: string[]; rows: number | null }> {
  const all = expectedSections({ ...p, later: p.later.slice(0, PHONE_LATER_ROWS) }, timeFormat);
  return { header: all.header, due: all.due, done: all.done, later: all.later };
}

/** The phone layer of the whole stage at T. */
function phoneSurface(T: number, timeFormat: TimeFormat): Element {
  const phone = ssrDocument(renderStage(T, timeFormat)).querySelector(
    '[data-stage-surface="phone"]',
  );
  expect(phone, "the phone surface is rendered").not.toBeNull();
  return phone!;
}

function renderPhoneScene(state: Frame["phone"], timeFormat: TimeFormat): string {
  return render(PhoneScene, { props: { state, timeFormat } }).body;
}

/** The medication the phone's tap logs. */
const PHONE_TAPPED = DEMO_DOSES.find((d) => d.id === LOGGED_DOSE.phone)!.medicationId;

describe("the phone scene against the app: rendered text", () => {
  describe.each(["24h", "12h"] as const)("in %s time", (timeFormat) => {
    it.each([
      { moment: "before the tap", T: T_TAP - 0.1, payload: PHONE_BEFORE_PAYLOAD },
      { moment: "after the tap", T: T_TAP + 1.0, payload: PHONE_AFTER_PAYLOAD },
    ])("$moment, every section reads what the helpers say", ({ T, payload }) => {
      const phone = phoneSurface(T, timeFormat);
      for (const [name, want] of Object.entries(expectedPhoneSections(payload, timeFormat))) {
        const found = phone.querySelectorAll(`[data-stage-section="${name}"]`);
        expect(found, `${name} is drawn once`).toHaveLength(1);
        expect(visibleText(found[0]), name).toBe(squash(want.text.join(" ")));
        if (want.rows !== null) expect(drawnRows(found[0]), `${name} rows`).toBe(want.rows);
      }
      // The chips and Refills sit below the fold on a phone.
      expect(phone.querySelector('[data-stage-section="chips"]')).toBeNull();
    });

    it("hides the Undo offer before the tap, then words it as Log now's reload would", () => {
      const message = expectedOfferText(PHONE_AFTER_PAYLOAD, LOGGED_DOSE.phone, timeFormat);
      for (const [T, want] of [
        [T_TAP - 0.1, ""],
        [T_TAP + 1.0, squash(`${message} Undo ×`)],
      ] as const) {
        const offers = phoneSurface(T, timeFormat).querySelectorAll('[data-stage-section="offer"]');
        expect(offers, `one offer on the phone at ${T}`).toHaveLength(1);
        expect(visibleText(offers[0]), `offer at ${T}`).toBe(want);
      }
    });

    it("tells the time in the status bar as PHONE_NOW, with no am/pm, as iOS does", () => {
      const clocks = phoneSurface(CUES.Reminders + 1, timeFormat).querySelectorAll(
        "[data-stage-clock]",
      );
      expect(clocks).toHaveLength(1);
      expect(visibleText(clocks[0])).toBe(formatUserTime(PHONE_NOW, WALKTHROUGH_TZ, "24h"));
    });
  });

  it("words the overdue push as the sweep would, from the tapped medication's last event", () => {
    // Vitamin D's last event in the 10:12 input, by getLastDosePerMedication's
    // rule: the anchor the reminder sweep reports, not the dose the tap logs.
    const lastEventAt =
      buildInputs(PHONE_NOW, MOMENTS[2].include).lastDoses.find(
        (d) => d.medicationId === PHONE_TAPPED,
      )?.lastEventAt ?? null;
    // A real event, so the banner is not the "Not yet logged" branch.
    expect(lastEventAt).not.toBeNull();
    const T = CUES.Reminders + 1.5;
    // The banner is fully in at T, where it is read.
    expect(computeFrame(T, {}).phone.bannerY).toBeCloseTo(0, 9);
    const bodies = phoneSurface(T, "24h").querySelectorAll("[data-stage-banner]");
    expect(bodies).toHaveLength(1);
    expect(visibleText(bodies[0])).toBe(lastLoggedPhrase(lastEventAt, PHONE_NOW));
  });

  it("reads Logging… while the tap is pending, the spinner turned by Frame, not by CSS", () => {
    const T = T_TAP + 0.2;
    const pending = computeFrame(T, {}).phone.pending;
    expect(pending).not.toBeNull();
    const due = phoneSurface(T, "24h").querySelector('[data-stage-section="due"]')!;
    const text = visibleText(due);
    expect(text).toContain("Logging…");
    expect(text).not.toContain("Log now");
    const spinners = [...due.querySelectorAll<HTMLElement>("span")].filter(
      (el) => drawn(el) && el.style.transform.startsWith("rotate("),
    );
    expect(spinners.map((el) => el.style.transform)).toEqual([`rotate(${pending}deg)`]);
  });

  it("draws no control, heading, list or landmark, and no animate-* or transition-* class", () => {
    for (const T of [CUES.Reminders + 1.5, T_TAP - 0.1, T_TAP + 0.2, T_TAP + 1.0]) {
      const phone = phoneSurface(T, "24h");
      expect(phone.querySelector('[data-stage-section="due"]')).not.toBeNull();
      expect(
        [...phone.querySelectorAll(FORBIDDEN)].map((el) => el.tagName),
        `at ${T}`,
      ).toEqual([]);
      const moving = [...phone.querySelectorAll("*")]
        .flatMap((el) => [...el.classList])
        .filter(
          (c) => c.startsWith("animate-") || c === "transition" || c.startsWith("transition-"),
        );
      expect(moving, `at ${T}`).toEqual([]);
    }
  });
});

// Review Focus 1, on the phone: the banner's "1d ago", the status bar and
// every row must read the same for a visitor in Auckland on 1 March 2027 as
// for one in London on the story day.
describe("the phone stage for a visitor far from the story", () => {
  it("renders byte-identical markup in Auckland on 1 March 2027", () => {
    const renderAll = () => [
      renderPhoneScene(computeFrame(CUES.Reminders + 1.5, {}).phone, "24h"),
      renderPhoneScene(computeFrame(T_TAP - 0.1, {}).phone, "24h"),
      renderPhoneScene(computeFrame(T_TAP + 0.2, {}).phone, "12h"),
      renderPhoneScene(computeFrame(T_TAP + 1.0, {}).phone, "12h"),
      renderStage(T_TAP + 1.0, "24h"),
    ];
    const here = renderAll();
    const zone = process.env.TZ;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2027-03-01T09:30:00+13:00"));
      process.env.TZ = "Pacific/Auckland";
      // The zone change took: this runtime now reads local time in Auckland.
      expect(new Date(0).getHours()).toBe(12);
      const there = renderAll();
      there.forEach((body, i) => expect(body === here[i], `render ${i}`).toBe(true));
    } finally {
      vi.useRealTimers();
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
```

**6c. Where `p.vitdLog` sits.** jsdom runs actions, which SSR does not, so this check lives in T6's jsdom file. In `tests/unit/walkthrough-marks.svelte.test.ts`, replace:

```ts
import { MARKS_CONTEXT, createMarkRegistry } from "$lib/components/walkthrough/marks";
import FieldBox from "$lib/components/walkthrough/parts/FieldBox.svelte";
```

with:

```ts
import { MARKS_CONTEXT, PHONE_ROOT, createMarkRegistry } from "$lib/components/walkthrough/marks";
import { PHONE_BEFORE } from "$lib/components/walkthrough/demo-dashboard";
import { computeFrame } from "$lib/components/walkthrough/timeline";
import FieldBox from "$lib/components/walkthrough/parts/FieldBox.svelte";
import PhoneScene from "$lib/components/walkthrough/scenes/PhoneScene.svelte";
```

Then append this at the end of the file, after T6's `describe("MARKS_CONTEXT", …)`, separated by one blank line. It reuses T6's module-level `target` and `app`, which the file's `afterEach` tears down:

```ts
describe("the phone's marks", () => {
  // timeline.ts puts the fingertip at the centre of p.vitdLog's rect, so the
  // key must sit on the button the tap presses: the overdue card's 48px
  // Log now, never the card, its row or another button. A shared part takes
  // its keys as props, so the phone registers nothing else but its root.
  it("marks the overdue card's Log now as p.vitdLog, and nothing else but the phone root", () => {
    const registry = createMarkRegistry();
    target = document.body.appendChild(document.createElement("div"));
    app = mount(PhoneScene, {
      target,
      props: { state: computeFrame(0, {}).phone, timeFormat: "24h" },
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    flushSync();
    expect([...registry.keys()].sort()).toEqual([PHONE_ROOT, "p.vitdLog"].sort());

    const logNow = registry.get("p.vitdLog")!;
    expect(registry.get(PHONE_ROOT)!.contains(logNow)).toBe(true);
    // The button itself: it reads exactly "Log now" once DoseActionForm's
    // invisible "Logging…" layer is left out.
    const shown = logNow.cloneNode(true) as HTMLElement;
    for (const layer of [...shown.querySelectorAll(".invisible")]) layer.remove();
    expect(shown.textContent?.replace(/\s+/g, " ").trim()).toBe("Log now");
    // On the card of the medication the phone shows as overdue.
    const [card] = PHONE_BEFORE.today;
    expect(logNow.closest(".rounded-xl")?.textContent ?? "").toContain(card.name);
  });
});
```

- [ ] **Step 7: Run them to verify they fail**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-marks.svelte.test.ts`

Expected: FAIL, `12 failed`, every other test passing (`12 failed | 26 passed (38)` at the counts T5–T7 leave):

- **Eleven fidelity tests**, every test under `the phone scene against the app: rendered text`: `AssertionError: the phone surface is rendered: expected null not to be null`. The stage has no `data-stage-surface="phone"` yet.
- **`the phone's marks > marks the overdue card's Log now as p.vitdLog, and nothing else but the phone root`**: `AssertionError: expected [ 'p.afternoon', 'p.evening', …(4) ] to deeply equal [ 'p.vitdLog', 'root.phone' ]`. The old scene's `MyDaySection` registers four `p.` group keys and puts `p.vitdLog` on the old link.

`the phone stage for a visitor far from the story > renders byte-identical markup in Auckland on 1 March 2027` passes already, because the old scene is deterministic too. It is a guard, and Step 14's R1 proves it.

- [ ] **Step 8: Add `lastEventBefore` to `stage-dashboard.ts`**

In `src/lib/components/walkthrough/stage-dashboard.ts`, replace T7's header comment and `./demo-data` import:

```ts
// What the dashboard scenes need beyond the StageMoments themselves: the
// date format the stage renders labels in, the Done row a beat logs, the
// Undo offer's message for it, and the Refills rows. Nothing here reads a
// clock or the visitor's zone; every instant comes from a moment.
```

with:

```ts
// What the dashboard scenes need beyond the StageMoments themselves: the
// date format the stage renders labels in, the Done row a beat logs, the
// Undo offer's message for it, the Refills rows, and the last event the
// phone's overdue push reports. Nothing here reads a clock or the visitor's
// zone; every instant comes from a moment or from DEMO_DOSES.
```

Replace:

```ts
import { MEDICATIONS, WALKTHROUGH_TZ } from "./demo-data";
```

with:

```ts
import { DEMO_DOSES, MEDICATIONS, WALKTHROUGH_TZ } from "./demo-data";
```

Then append, after `STAGE_REFILLS`'s closing `}));`, separated by one blank line:

```ts
/**
 * A medication's latest event in DEMO_DOSES strictly before `before`, taken
 * or skipped, which is what the reminder sweep's `lastEventAt` holds, or null
 * when it has none. The phone's push banner is sent before the tap, so it
 * reads this at PHONE_NOW and never sees the dose the tap logs.
 */
export function lastEventBefore(medicationId: string, before: Date): Date | null {
  let latest: Date | null = null;
  for (const dose of DEMO_DOSES) {
    if (dose.medicationId !== medicationId) continue;
    if (dose.takenAt.getTime() >= before.getTime()) continue;
    if (latest === null || dose.takenAt.getTime() > latest.getTime()) latest = dose.takenAt;
  }
  return latest;
}
```

- [ ] **Step 9: Replace `PhoneScene.svelte`**

Replace the whole of `src/lib/components/walkthrough/scenes/PhoneScene.svelte` with the following.

- **What is unchanged:** the device frame, the dynamic island, the status bar's icons, the mobile header, the banner's layout, the fingertip and the home indicator.
- **What is new:** the content between the mobile header and the home indicator, the offer, the banner's title and body, and the status bar's time.

```svelte
<script lang="ts">
  // The dashboard as a phone shows it (MobileHeader.svelte over
  // routes/(app)/dashboard, below md) in a dark iPhone frame, at PHONE_NOW
  // (10:12). Vitamin D's 09:05 dose is an hour overdue, so its push drops in,
  // then the fingertip taps the card's Log now. PHONE_BEFORE and PHONE_AFTER
  // are the two halves of that beat, and the fidelity test proves both equal
  // the real composer's payload. `state` (Frame.phone) only says how far the
  // stage has moved from one to the other.
  //
  // The parts are the desktop scene's, at 402px. A shared part takes its mark
  // keys as props, so only Log now is marked here, as `p.vitdLog`: the
  // fingertip is placed from its rect. Every marked element is mounted at
  // every T; the card collapses and the new Done row grows through
  // StageCollapse, never through {#if}.
  //
  // The content box is 732px (820 − 72 − 16) and the home indicator covers
  // its foot, so Later is cut at a whole row (PHONE_LATER_ROWS). The chips and
  // Refills sit below it, off screen, as they would on a real phone.
  import appIcon from "$lib/assets/medtracker-icon-vector.svg";
  import { formatUserTime, lastLoggedPhrase, type TimeFormat } from "$lib/utils/time";
  import { LOGGED_DOSE, PHONE_NOW, WALKTHROUGH_TZ } from "../demo-data";
  import { PHONE_AFTER, PHONE_BEFORE, PHONE_LATER_ROWS } from "../demo-dashboard";
  import { PHONE_ROOT, useMark } from "../marks";
  import { beatRow, lastEventBefore, stageLogToast } from "../stage-dashboard";
  import type { Frame } from "../timeline";
  import StageCollapse from "../parts/dashboard/StageCollapse.svelte";
  import StageDashboardHeader from "../parts/dashboard/StageDashboardHeader.svelte";
  import StageDoneList from "../parts/dashboard/StageDoneList.svelte";
  import StageDueCard from "../parts/dashboard/StageDueCard.svelte";
  import StageLaterList from "../parts/dashboard/StageLaterList.svelte";
  import StageUndoOffer from "../parts/dashboard/StageUndoOffer.svelte";

  let { state, timeFormat }: { state: Frame["phone"]; timeFormat: TimeFormat } = $props();

  const mark = useMark();
  const IOS_FONT = '-apple-system, "SF Pro", system-ui, sans-serif';

  const before = PHONE_BEFORE;
  const after = PHONE_AFTER;
  /** The dose the fingertip logs. */
  const tappedDose = beatRow(after, LOGGED_DOSE.phone).dose;
  /** The medication whose card the fingertip taps. */
  const tapped = tappedDose.medicationId;
  /**
   * BEFORE's Due cards. The tap resolves the only due row, so AFTER has none
   * and the whole section collapses with `logged`.
   */
  const dueCards = [...before.earlier, ...before.today];
  const dueStays = after.earlier.length + after.today.length > 0;
  /** A prefix of the composer's Later list, cut at a whole row. */
  const laterRows = before.later.slice(0, PHONE_LATER_ROWS);
  // iOS's status bar clock never shows am/pm, so it is the 24h form of the
  // story's own clock, whatever the stage's time format.
  const clock = formatUserTime(PHONE_NOW, WALKTHROUGH_TZ, "24h");
  // The overdue push as reminders.ts sends it: the title names the
  // medication, and the body is lastLoggedPhrase over its last event. It was
  // sent before the tap, so that event is the one before PHONE_NOW.
  const bannerTitle = `${tappedDose.name} overdue`;
  const bannerBody = lastLoggedPhrase(lastEventBefore(tapped, PHONE_NOW), PHONE_NOW);
  // The tap's Undo offer, as Log now's reload would word it.
  const offerMessage = $derived(stageLogToast(after, LOGGED_DOSE.phone, timeFormat));
</script>

<!-- Device frame -->
<div
  class="relative h-[874px] w-[402px] overflow-hidden rounded-[48px] bg-black antialiased"
  style:box-shadow="0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)"
  style:font-family={IOS_FONT}
>
  <!-- Dynamic island -->
  <div
    class="absolute top-[11px] left-1/2 z-50 h-[37px] w-[126px] -translate-x-1/2 rounded-3xl bg-black"
  ></div>

  <!-- Status bar -->
  <div class="absolute top-0 right-0 left-0 z-10">
    <div
      class="relative z-20 flex w-full items-center justify-center gap-[154px] px-6 pt-[21px] pb-[19px]"
    >
      <div class="flex h-[22px] flex-1 items-center justify-center pt-[1.5px]">
        <span data-stage-clock class="text-[17px] leading-[22px] font-[590] text-white"
          >{clock}</span
        >
      </div>
      <div class="flex h-[22px] flex-1 items-center justify-center gap-[7px] pt-px pr-px">
        <svg width="19" height="12" viewBox="0 0 19 12" fill="#fff">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12" fill="#fff">
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
          />
          <circle cx="8.5" cy="10.5" r="1.5" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect
            x="0.5"
            y="0.5"
            width="23"
            height="12"
            rx="3.5"
            stroke="#fff"
            stroke-opacity="0.35"
            fill="none"
          />
          <rect x="2" y="2" width="20" height="9" rx="2" fill="#fff" />
          <path
            d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z"
            fill="#fff"
            fill-opacity="0.4"
          />
        </svg>
      </div>
    </div>
  </div>

  <!-- The app, full-bleed under the status bar -->
  <div
    use:mark={PHONE_ROOT}
    class="bg-surface text-text-primary relative h-[874px] w-[402px] overflow-hidden text-left font-sans text-base"
  >
    <div class="absolute top-[54px] right-0 bottom-0 left-0">
      <div
        class="bg-surface-raised border-glass-border absolute top-0 right-0 left-0 z-20 flex h-14 items-center justify-between border-b px-4"
      >
        <div class="text-text-secondary flex h-9 w-9 items-center justify-center rounded-lg">
          <svg
            width="20"
            height="20"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            ><path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M4 6h16M4 12h16M4 18h16"
            /></svg
          >
        </div>
        <div class="flex items-center gap-2 text-lg font-semibold">
          <img src={appIcon} alt="" width="28" height="28" class="h-7 w-7 rounded-md" />
          <span>MedTracker</span>
        </div>
        <div
          class="bg-accent/15 text-accent-ink flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium"
        >
          D
        </div>
      </div>
      <div class="absolute inset-0 overflow-hidden px-4 pt-[72px] pb-4">
        <StageDashboardHeader
          before={before.status}
          after={after.status}
          logged={state.logged}
          now={before.now}
          tz={WALKTHROUGH_TZ}
          {timeFormat}
        />

        <StageCollapse factor={dueStays ? 1 : 1 - state.logged}>
          <div class="pt-6">
            <div data-stage-section="due" class="space-y-3">
              {#each dueCards as card (card.key)}
                <StageDueCard
                  {card}
                  now={before.now}
                  todayStart={before.todayStart}
                  tz={WALKTHROUGH_TZ}
                  {timeFormat}
                  pending={card.medicationId === tapped ? state.pending : null}
                  logNowMark={card.medicationId === tapped ? "p.vitdLog" : undefined}
                />
              {/each}
            </div>
          </div>
        </StageCollapse>

        <div class="mt-6">
          <StageDoneList
            before={before.done}
            after={after.done}
            logged={state.logged}
            todayStart={before.todayStart}
            tz={WALKTHROUGH_TZ}
            {timeFormat}
          />
        </div>

        <div class="mt-6">
          <StageLaterList
            rows={laterRows}
            now={before.now}
            todayStart={before.todayStart}
            tz={WALKTHROUGH_TZ}
            {timeFormat}
          />
        </div>
      </div>

      <!-- Where Toast's stack sits (fixed right-4 bottom-4 in the app), lifted
           clear of the home indicator -->
      <div class="absolute right-4 bottom-[42px] z-50 flex flex-col gap-2">
        <StageUndoOffer message={offerMessage} opacity={state.offer} />
      </div>
    </div>

    <!-- Web Push as src/lib/server/reminders.ts sends it -->
    <div
      class="absolute top-[54px] right-2.5 left-2.5 z-[70] flex items-center gap-3 rounded-3xl px-3.5 py-3 text-white"
      style:transform="translateY({state.bannerY}px)"
      style:background="rgba(44,44,50,0.96)"
      style:box-shadow="0 10px 30px rgba(0,0,0,0.35)"
      style:font-family={IOS_FONT}
    >
      <img
        src={appIcon}
        alt=""
        width="38"
        height="38"
        class="h-[38px] w-[38px] shrink-0 rounded-[9px]"
      />
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-[15px] leading-5 font-semibold">{bannerTitle}</span>
          <span class="text-[13px] leading-[18px]" style:color="rgba(235,235,245,0.6)">now</span>
        </div>
        <div data-stage-banner class="text-[15px] leading-5" style:color="rgba(255,255,255,0.92)">
          {bannerBody}
        </div>
      </div>
    </div>

    {#if state.touch && state.touch.opacity > 0}
      <!-- A fingertip, since there is no cursor on a phone -->
      <div
        class="absolute z-[80] h-11 w-11 rounded-full"
        style:left="{state.touch.x - 22}px"
        style:top="{state.touch.y - 22}px"
        style:background="rgba(255,255,255,0.28)"
        style:border="1.5px solid rgba(255,255,255,0.6)"
        style:opacity={state.touch.opacity}
        style:transform="scale({1 - 0.15 * state.touch.press})"
      ></div>
    {/if}
  </div>

  <!-- Home indicator -->
  <div
    class="pointer-events-none absolute right-0 bottom-0 left-0 z-[60] flex h-[34px] items-end justify-center pb-2"
  >
    <div class="h-[5px] w-[139px] rounded-full" style:background="rgba(255,255,255,0.7)"></div>
  </div>
</div>
```

- [ ] **Step 10: Mark the phone layer in the stage**

In `src/lib/components/walkthrough/WalkthroughStage.svelte`, replace:

```svelte
    <div class="absolute inset-0" style:visibility={frame.kind === "phone" ? "visible" : "hidden"}>
```

with:

```svelte
    <div
      class="absolute inset-0"
      data-stage-surface="phone"
      style:visibility={frame.kind === "phone" ? "visible" : "hidden"}
    >
```

The closing `</div>` is unchanged. This mirrors T7's `data-stage-surface="desktop"`, so a phone check can never be satisfied by the desktop's sections or the desktop's offer.

- [ ] **Step 11: Run the render, mark and timeline tests to verify they pass**

Run: `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-marks.svelte.test.ts tests/unit/walkthrough-timeline.test.ts`

Expected: PASS, with no failures (`75 passed` at the counts T5–T7 leave: fidelity 36 = T5's 14 + T7's 10 + these 12; marks 2; timeline 37).

**What the helpers return, as the probe measured them** (this repo's Node ICU, `"24h"`). These are illustrative: every assertion compares with helper output, and none of them is pinned.

| Section, moment | Visible text                                                                                                |
| --------------- | ----------------------------------------------------------------------------------------------------------- |
| header, before  | `Thu 24 Sept Today 1 dose due 3 of 8 done today`                                                            |
| header, after   | `Thu 24 Sept Today All caught up Next: Ibuprofen 200mg at 14:10 · in 3 hours`                               |
| due, before     | `Vitamin D 1000IU Due 9:05 · 1 hour ago Log now Took it at 9:05 Skip`, 1 row                                |
| due, pending    | `… Logging… Took it at 9:05 Skip`, with the spinner at `rotate(96.00000000000136deg)`                       |
| due, after      | empty, 0 rows                                                                                               |
| done, before    | `Done today 6:10 Ibuprofen 200mg Edit 7:48 Metformin 500mg Edit 8:02 Lisinopril 10mg for 8:00 Edit`, 3 rows |
| done, after     | adds `10:12 Vitamin D 1000IU Edit`, with no covers line, 4 rows                                             |
| later, both     | `Later today 14:10 Ibuprofen 200mg in 3 hours 19:48 Metformin 500mg in 9 hours`: 2 rows, the prefix of 4    |
| offer, after    | `Vitamin D 1000IU logged at 10:12 Undo ×`, with no "counted for" clause. In 12h: `… at 10:12 am Undo ×`     |
| banner          | `Last logged 1d ago`, from `lastEventAt` 2026-09-23T09:05Z                                                  |
| status bar      | `10:12` in both time formats (`formatUserTime(PHONE_NOW, "UTC", "12h")` would read `10:12 am`)              |

At `CUES.Reminders + 1.5` the banner's `bannerY` is `-0`, which `toBe(0)` would reject under `Object.is`. That is why the banner test uses `toBeCloseTo(0, 9)`.

- [ ] **Step 12: Retire what nothing draws any more**

Delete the four old parts, which only the old `PhoneScene` used:

```bash
git rm src/lib/components/walkthrough/parts/MyDaySection.svelte \
  src/lib/components/walkthrough/parts/SummaryAndRefills.svelte \
  src/lib/components/walkthrough/parts/StatusMark.svelte \
  src/lib/components/walkthrough/parts/StageToast.svelte
```

In `src/lib/components/walkthrough/demo-data.ts`, delete the My Day block. Its only readers were `MyDaySection` and the old scenes. Replace:

```ts
// ── My Day ──
export type DayGroupKey = "morning" | "afternoon" | "evening" | "night";
export type SlotStatus = "taken" | "upcoming" | "overdue";
export type DaySlot = { group: DayGroupKey; id: MedicationId; time: string; status: SlotStatus };

// Emoji because the dashboard's former My Day timeline used them.
export const DAY_GROUPS: ReadonlyArray<{ key: DayGroupKey; label: string; icon: string }> = [
  { key: "morning", label: "Morning", icon: "☀️" },
  { key: "afternoon", label: "Afternoon", icon: "🌤️" },
  { key: "evening", label: "Evening", icon: "🌅" },
  { key: "night", label: "Night", icon: "🌙" },
];

export function daySlots(lisinopril: SlotStatus, vitaminD: SlotStatus): DaySlot[] {
  return [
    { group: "morning", id: "ibu", time: "06:10", status: "taken" },
    { group: "morning", id: "met", time: "07:48", status: "taken" },
    { group: "morning", id: "lis", time: "08:00", status: lisinopril },
    { group: "morning", id: "vitd", time: "09:05", status: vitaminD },
    { group: "afternoon", id: "ibu", time: "14:10", status: "upcoming" },
    { group: "evening", id: "met", time: "19:48", status: "upcoming" },
    { group: "night", id: "mag", time: "22:05", status: "upcoming" },
    { group: "night", id: "ibu", time: "22:10", status: "upcoming" },
  ];
}

// ── Doses ──
```

with:

```ts
// ── Doses ──
```

Then run:

```bash
grep -rnE "MyDaySection|SummaryAndRefills|StatusMark\b|StageToast|DAY_GROUPS|daySlots|DayGroupKey|\bSlotStatus\b|\bDaySlot\b|vitaminDDone" src tests
```

Expected: no output, exit status 1.

- `StatusMark\b` does not match the real `StatusMarker`, and `\bSlotStatus\b` does not match `utils/schedule.ts`'s `ScheduleSlotStatus`.
- The spec's and plans' mentions under `docs/` are history and stay.

**Nothing else in `demo-data.ts` became dead.** A scan of every export against `src` and `tests` (excluding the file itself) found the rest still read: `MEDICATION_BY_ID` by T5's `demo-dashboard.ts` and `HistoryScene`, `storyClock` by `HistoryScene` and the timeline test, and `refillWatch`/`supplyDays` by T7's `STAGE_REFILLS` and `MedicationsScene`. The exported types it found unread elsewhere (`DemoSchedule`, `DemoDose`, `HeatmapCell` and `LoggedDose`) each type an exported value or field, so they stay.

- [ ] **Step 13: Run every walkthrough test**

Run: `npx vitest run tests/unit/walkthrough`

Expected: PASS, with no failures, in every walkthrough file T4–T8 created or changed.

- [ ] **Step 14: Prove the new tests by mutation**

Apply each mutation alone, run the named command, and see each named test FAIL with the message given. Then **undo the edit exactly**. Never use `git checkout --` here: it would discard this task's uncommitted work. Re-run the command to see PASS before the next one. Record each one in the task report. Every mutation was run against the probe build, and failed exactly as stated.

**In `src/lib/components/walkthrough/timeline.ts`** (run `npx vitest run tests/unit/walkthrough-timeline.test.ts`):

- **M1. The offer outlives the cut to the Outro.** Change `      ...logBeat(T, T_TAP, c.Outro),` to `      ...logBeat(T, T_TAP, TOTAL_DURATION),`.
  - FAIL: `logs Vitamin D once, from the phone's Log now: …` (`expected 1 to be +0`), and `never leaves the phone's log half-done: …` (`expected 1 to be +0`: the last frame's offer is 1 against the first frame's 0).
- **M2. The beat leaves the tap.** Change the same line to `      ...logBeat(T, T_TAP + 0.15, c.Outro),`.
  - FAIL: `logs Vitamin D once, …` (`expected null to be +0`) and `never leaves the phone's log half-done: …` (`pending at 38.9: expected 120 to be null`).
- **M3. No cut at all, on both surfaces.** In `logBeat`, change `    offer: T >= cut ? 0 : MOTION.enter(T, tap + 0.5, 0.3),` to `    offer: MOTION.enter(T, tap + 0.5, 0.3),`.
  - FAIL, four tests: T7's `logs Lisinopril once, from Log now: …` and `never leaves the log half-done: …`, and this task's two phone beat tests. One helper, guarded from both surfaces.
- **M4. The fingertip off Log now's centre.** Change `        x: phoneLog.x + phoneLog.w / 2,` to `        x: phoneLog.x,`.
  - FAIL: `puts the fingertip on the middle of the phone card's Log now, where p.vitdLog is measured` (`expected { Object (x, y, ...) } to deeply equal { Object (x, y, ...) }`).

**In `src/lib/components/walkthrough/scenes/PhoneScene.svelte`** (run `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`):

- **R1. The banner reads the visitor's clock** (Review Focus 1). Change `lastLoggedPhrase(lastEventBefore(tapped, PHONE_NOW), PHONE_NOW)` to `lastLoggedPhrase(lastEventBefore(tapped, PHONE_NOW), new Date())`.
  - FAIL: `words the overdue push as the sweep would, from the tapped medication's last event` (`expected 'Last logged 19d ago' to be 'Last logged 1d ago'`; the number is however far today is from the story).
  - FAIL: `the phone stage for a visitor far from the story > renders byte-identical markup in Auckland on 1 March 2027` (`render 0: expected false to be true`).
  - FAIL: T7's desktop Auckland test (`render 3: …`), because `renderStage` draws the phone too.
- **R3. The status bar stuck at 9:41.** Change `>{clock}</span` to `>9:41</span`.
  - FAIL: both `tells the time in the status bar as PHONE_NOW, with no am/pm, as iOS does` (`expected '9:41' to be '10:12'`).
- **R4. Later not cut** (Review Focus 5). Change `  const laterRows = before.later.slice(0, PHONE_LATER_ROWS);` to `  const laterRows = before.later;`.
  - FAIL: all four `'before the tap'`/`'after the tap', every section reads what the helpers say` (`later: expected 'Later today 14:10 Ibuprofen 200mg in …' to be …`).
- **R5. The card never collapses.** Change `<StageCollapse factor={dueStays ? 1 : 1 - state.logged}>` to `<StageCollapse factor={1}>`.
  - FAIL: both `'after the tap', every section reads what the helpers say` (`due: expected 'Vitamin D 1000IU Due 9:05 · 1 hour ag…' to be ''`).
- **R6. The new Done row there before the tap.** Change `            before={before.done}` to `            before={after.done}`.
  - FAIL: both `'before the tap', every section reads what the helpers say` (`done: expected 'Done today 6:10 Ibuprofen 200mg Edit …' to be …`).
- **R7. The offer worded from the wrong moment.** Change `stageLogToast(after, LOGGED_DOSE.phone, timeFormat)` to `stageLogToast(before, LOGGED_DOSE.phone, timeFormat)`.
  - FAIL: every test that renders the phone, 16 in all, the desktop's stage tests among them. Each fails with `walkthrough: no Done row for dose-vitd-20260924-1012`.
- **R8. The offer shown before the tap.** Change `<StageUndoOffer message={offerMessage} opacity={state.offer} />` to `<StageUndoOffer message={offerMessage} opacity={1} />`.
  - FAIL: both `hides the Undo offer before the tap, then words it as Log now's reload would` (`offer at 38.4: expected 'Vitamin D 1000IU logged at 10:12 Undo…' to be ''`).
- **R9. A control on the phone.** Directly after that same `<StageUndoOffer … />` element, add `<button type="button">x</button>`.
  - FAIL: `draws no control, heading, list or landmark, and no animate-* or transition-* class` (`expected [ 'BUTTON' ] to deeply equal []`).
- **R10. No spinner.** Change `pending={card.medicationId === tapped ? state.pending : null}` to `pending={null}`.
  - FAIL: `reads Logging… while the tap is pending, the spinner turned by Frame, not by CSS` (`expected 'Vitamin D 1000IU Due 9:05 · 1 hour ag…' to contain 'Logging…'`).

**In `src/lib/components/walkthrough/stage-dashboard.ts`** (run `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`):

- **R2. The banner sees the dose the tap logs.** Change `    if (dose.takenAt.getTime() >= before.getTime()) continue;` to `    if (dose.takenAt.getTime() > before.getTime()) continue;`.
  - FAIL: `words the overdue push as the sweep would, …` (`expected 'Last logged just now' to be 'Last logged 1d ago'`).

**In `PhoneScene.svelte` again** (run `npx vitest run tests/unit/walkthrough-marks.svelte.test.ts`):

- **K1. `p.vitdLog` on the Due section instead of Log now.** Make two edits:
  - change `<div data-stage-section="due" class="space-y-3">` to `<div use:mark={"p.vitdLog"} data-stage-section="due" class="space-y-3">`;
  - change `logNowMark={card.medicationId === tapped ? "p.vitdLog" : undefined}` to `logNowMark={undefined}`.

  The key set is unchanged, so T9's stage mount test would pass this one; only this test sees where the key sits.
  - FAIL: `the phone's marks > marks the overdue card's Log now as p.vitdLog, and nothing else but the phone root` (`expected 'Vitamin D 1000IU Due 9:05 · 1 hour ag…' to be 'Log now'`).

- **K2. A phone part given a key.** In the `<StageDoneList` element, add the line `            mark="p.done"` directly above `            before={before.done}`.
  - FAIL: the same test (`expected [ 'p.done', 'p.vitdLog', 'root.phone' ] to deeply equal [ 'p.vitdLog', 'root.phone' ]`).

After the last undo, run `git status --short`. Expected, exactly:

```
 M src/lib/components/walkthrough/WalkthroughStage.svelte
 M src/lib/components/walkthrough/demo-data.ts
D  src/lib/components/walkthrough/parts/MyDaySection.svelte
D  src/lib/components/walkthrough/parts/StageToast.svelte
D  src/lib/components/walkthrough/parts/StatusMark.svelte
D  src/lib/components/walkthrough/parts/SummaryAndRefills.svelte
 M src/lib/components/walkthrough/scenes/PhoneScene.svelte
 M src/lib/components/walkthrough/stage-dashboard.ts
 M src/lib/components/walkthrough/timeline.ts
 M tests/unit/walkthrough-dashboard-fidelity.test.ts
 M tests/unit/walkthrough-marks.svelte.test.ts
 M tests/unit/walkthrough-timeline.test.ts
```

Then run `npx vitest run tests/unit/walkthrough`. Expected: PASS.

- [ ] **Step 15: Run the gates**

Run, from the worktree root:

```bash
npx prettier --write src/lib/components/walkthrough tests/unit/walkthrough-timeline.test.ts tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-marks.svelte.test.ts
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **`prettier --write`** changes nothing: every block above is already in Prettier's output, which the probe checked.
- **`npx vitest run`, both runs:** 0 failures, with any failing test named. The totals are T7's **+ 16 tests**, and the same number of files: timeline +3, fidelity +12, marks +1. T8 adds no test file.
- **`npm run check`:** 0 errors, at most 27 warnings. The probe build ran `svelte-check` over T1–T8: 0 errors and 27 warnings.
- **`npm run lint`:** 0 errors, at most 115 warnings. ESLint reported nothing for any file this task touches.
- **`npm run format:check`:** clean.

- [ ] **Step 16: Commit**

The four deletions are already staged by Step 12's `git rm`.

```bash
git add src/lib/components/walkthrough/timeline.ts \
  src/lib/components/walkthrough/stage-dashboard.ts \
  src/lib/components/walkthrough/scenes/PhoneScene.svelte \
  src/lib/components/walkthrough/WalkthroughStage.svelte \
  src/lib/components/walkthrough/demo-data.ts \
  tests/unit/walkthrough-timeline.test.ts \
  tests/unit/walkthrough-dashboard-fidelity.test.ts \
  tests/unit/walkthrough-marks.svelte.test.ts
git commit -F - <<'MSG'
feat(walkthrough): redraw the phone scene to the shipped dashboard

The phone drew the deleted dashboard: a summary strip, My Day's emoji
groups, a 40x20 "Log" link for the fingertip and a plain toast with no
Undo, under a status bar stuck at 9:41. It now draws the dashboard at
10:12 with the desktop's stage parts:
- the header;
- Vitamin D's overdue card with Log now, Took it at and Skip;
- Done today;
- the first PHONE_LATER_ROWS rows of Later today.
The fingertip taps Log now, which now carries p.vitdLog. The push
banner's body is lastLoggedPhrase on the story clock, and the status
bar reads 10:12.

Frame.phone trades vitaminDDone and toast for pending, logged and
offer. One logBeat helper now computes both beats, from T_LOG to the cut
to Medications and from T_TAP to the cut to the Outro, so the desktop and
the phone cannot drift apart.

walkthrough-dashboard-fidelity renders the phone layer of the whole stage
before, during and after the tap, and checks each section against the
real helpers over the composer's payload: the offer, the banner and the
status bar too. A render in Auckland on 1 March 2027 is byte-identical. A
jsdom mount checks that p.vitdLog sits on Log now and that the phone
registers nothing else but its root.

Changed timeline pins: the progress test reads logged and offer, which
replace vitaminDDone and toast. The p.vitdLog fixture rect is the 48px
Log now rather than the old text link.

MyDaySection, SummaryAndRefills, StatusMark, StageToast and demo-data's
My Day block had no reader left, so they go.
MSG
```

The pre-commit hook runs eslint and prettier. Never use `--no-verify`, and add no attribution trailer of any kind.

#### Notes for the reviewer

- **`logBeat` changes T7's code as well as adding the phone's.**
  - **The values are the same.** The desktop's three expressions move into the helper unchanged, with `tap = T_LOG` and `cut = c.Medications`. T7's desktop pins pass unedited in Step 5.
  - **Why share it.** The Global Constraints say the beat timing is "the same on the desktop … and the phone". With one helper, the two cannot drift, and M3 shows a break in the helper fails both surfaces' tests.
  - **The cost.** T7's mutation text (its `offer: T >= c.Medications ? …` line) no longer exists after this commit. Those mutations were run at T7's commit.
- **`PHONE_LATER_ROWS` is T5's provisional 2.** The render test follows whatever it is: the oracle cuts the composer's list to the same prefix, and the row count must equal it.
  - **The estimate**, in phone space: the content starts at y 126 and the home indicator at 840. The header is 112px and the Due card about 122px; it is taller if Took it at and Skip wrap in the card's ~188px middle column, which T10's screenshot shows. Done is about 192px with its heading, and each Later row is 40px.
  - **So** 2 rows fit in the worst case, and 3 or 4 may fit. T10's phone-before screenshot decides, and only the constant changes.
  - **After the tap**, Due collapses (about −146px) and Done grows one 52px row, so blank space opens below Later. The real page would show more Later rows and the chips there. Spec Section 3 lists only the header, Due, Done and the Later prefix, and drawing the chips would put a row cut through its text at the box's foot before the tap.
- **Values the scene derives that it used to hard-code**, with judgement calls:
  - **The status bar's time.** It is always `formatUserTime(PHONE_NOW, "UTC", "24h")`, because iOS never shows am/pm there. At 10:12 there is no leading-zero question.
  - **The banner's title.** It is `${name} overdue` over the tapped dose's medication, the template `reminders.ts` sends. It was the literal "Vitamin D overdue". It is not asserted, because no helper owns the title.
- **The phone's offer** sits at `right-4 bottom-[42px]`: Toast's stack, lifted clear of the home indicator, where the old `StageToast` sat (`bottom={42}`). It keeps the real offer's `max-w-sm` and has no left bound, as in the app. On the 402px screen its left edge can come within a few pixels of the screen's edge; T10's `phoneAfter` shot checks it.
- **`logNowMark` is an expression,** `card.medicationId === tapped ? "p.vitdLog" : undefined`, mirroring T7's desktop. T9's mutation 3b ("change the string `"p.vitdLog"` that T8 passes … to `"d.logNow"`") applies inside it.
- **The jsdom marks test goes in T6's `walkthrough-marks.svelte.test.ts`.**
  - SSR runs no actions, so neither the fidelity file nor T9's set-level test can see which element a key sits on. K1 is a mutation T9's test would pass.
  - The file's `afterEach` already unmounts `app` and removes `target`.
- **Tests that pass before the implementation.** Each is proved by mutation instead:
  - `puts the fingertip on the middle of the phone card's Log now, …` pins an unchanged formula against the new rect (M4);
  - the phone Auckland test is a guard (R1).
- **How this was checked.** No T1–T7 code exists in the worktree yet, so the probe built a scratch copy of it with stand-ins:
  - **The stand-ins.** T1's five helpers, T2's `formatTimeSince(date, now)` and `lastLoggedPhrase`, and T4's story clocks, schedules, `DEMO_DOSES` and `LOGGED_DOSE`.
  - **Verbatim from their plans.** T5's `demo-dashboard.ts` and test file, T6's 28 edits and marks test, and T7's every create and edit, extracted from the plan parts.
  - **The results.** T5's, T6's and T7's own tests passed on it before T8 was applied, at the counts their tasks predict (T5's 14, T6's 32). With T8 applied:
    - the whole suite passed, 193 files and 2904 tests;
    - `svelte-check` reported 0 errors and 27 warnings, and ESLint and Prettier were clean;
    - T9's current stage mount test, copied from its plan, passed: the phone registers exactly `root.phone` and `p.vitdLog`;
    - the red phases were `3 failed` and `12 failed`, as stated, and every mutation in Step 14 failed its named tests.
  - **A worktree probe** (`tests/unit/zz-probe-plan-T8-clock.test.ts`, deleted) confirmed the clock values on the real code: `T_TAP` 38.5, `CUES.Outro` 40.5, `bannerY` `-0`, `formatUserTime(PHONE_NOW, "UTC", "24h")` = `"10:12"`, `formatTimeSince(23 Sep 09:05)` at PHONE_NOW = `"1d ago"`, and the spinner at 96.00000000000136.
- **The MEASURED rect for `p.vitdLog`** (`{ x: 253, y: 275, w: 120, h: 48 }`) is an estimate in phone space. `y` is 54 (status bar) + 72 (padding) + 112 (header) + 24 (`pt-6`) + 13 (card border and padding). The width allows for the "Logging…" layer that keeps the button's width. jsdom has no layout; the fixture only needs to be plausible.

#### Interface notes (deviations from the planning contract)

- **"Update REQUIRED_MARKS" needs no edit in T8.** The phone's one read key, `p.vitdLog`, keeps its name; only the element under it changes. `REQUIRED_MARKS` is untouched, MEASURED's `p.vitdLog` rect moves, and T6's Proxy sweep proves the read set is unchanged.
- **`Frame.phone` is written `LogBeat & { bannerY; touch; scale }`.** That is structurally the contract's `{ bannerY, pending, logged, offer, touch, scale }`, and `Frame.dashboard` stays the contract's `{ pending, logged, offer }`. `LogBeat` and `logBeat` are names the contract does not have.
- **The banner's "vitd's latest DEMO_DOSES event < PHONE_NOW"** needs a function the contract does not name. This task adds `lastEventBefore(medicationId, before)` to T7's `stage-dashboard.ts`.
- **Review Focus 2 cannot hold for `logged`.** It asks that the T=0 frame equal the T=TOTAL−ε frame "for both new fields", but the contract's formula makes `logged` 0 at the loop's start and 1 at its end. This task resolves it as T7 does. It pins `pending` and `offer` across the seam, `logged` = 0 at T = 0 and 1.2 (when production measures `p.vitdLog`), and title frames at both ends, where the phone is not drawn.
- **T8 depends on two T7 modules the contract does not name:** `stage-dashboard.ts` (`beatRow`, `stageLogToast`) and `parts/dashboard/StageCollapse.svelte`. If T7 is revised to drop them, use the code they hold:
  - **The offer:** `toastForLog({ label: formatDoseLabel(dose.name, dose.dosageAmount, dose.dosageUnit), quantity: dose.quantity, takenAt: dose.takenAt, covers: covers.map((iso) => new Date(iso)), todayStart: PHONE_AFTER.todayStart, tz: WALKTHROUGH_TZ, timeFormat })`, over PHONE_AFTER's Done row for `LOGGED_DOSE.phone`;
  - **The collapse:** a `grid` wrapper styled `grid-template-rows: {1 − logged}fr; opacity: {1 − logged}`, around a `min-h-0 overflow-hidden` child.
- **The Global Constraint "No `{#if}` wraps an element carrying `use:mark`",** read literally, is broken by `StageDueCard`'s `{#if row.logNow}` around Log now, which now carries `p.vitdLog` too. T7 raised this. The condition is payload data, fixed for the whole loop, so the registered set never changes with T, and T9's mount test asserts that.
- **The header's File Structure omits two files this task touches:** T6's `tests/unit/walkthrough-marks.svelte.test.ts` (the jsdom check of where `p.vitdLog` sits) and T7's `stage-dashboard.ts`.
- **Two new test hooks:** `data-stage-banner` and `data-stage-clock`. They sit beside the contract's `data-stage-section` markers and are not sections, so T10's per-section lookups are unaffected.

### Task 9: Stage mount test, reduced motion and the accent

This task adds the three tests spec Sections 4 and 5 assign to the stage and the player, and makes the one production change among them: the walkthrough's default accent.

- **The stage mount test (D8)** mounts `WalkthroughStage` with a recording marks registry and moves one mount through seven moments of the loop. It pins what T6–T8 built: every mark the timeline reads is registered from T = 0, on one element, under its own root, at every moment, and nothing in the stage can take focus or adds a heading, landmark or list.
- **The reduced-motion test** mounts `WalkthroughVideo` in jsdom with `matchMedia` reporting `reduce`, plus a control case without it.
- **The accent test** SSR-renders `WalkthroughVideo` with no props, compares its theme style with the Drizzle column default, and checks that the landing page passes no `accent`.

The stage and reduced-motion tests guard behaviour that already exists when this task starts, so they pass on their first run. **Their red phase is the mutation steps** (Steps 3 and 6): each breaks one production line and names the assertion that must fail. The accent test is ordinary red, then green.

No Review Focus line is assigned to this task (the header gives 1–2 to T7/T8, 3 to T6, 4 to T2 and 5 to T10/T8). No existing test changes.

**Files:**

- Create: `tests/unit/walkthrough-stage.svelte.test.ts` (the stage mount test, jsdom).
- Create: `tests/unit/walkthrough-video.svelte.test.ts` (reduced motion, jsdom).
- Create: `tests/unit/walkthrough-video-ssr.test.ts` (the accent, `// @vitest-environment node`; CONTRACT ISSUES says why this is a separate file).
- Modify: `src/lib/components/walkthrough/WalkthroughVideo.svelte:21-25`, the `accent` default on line 23. T1–T8 leave this file as it is at base `311758f` (T6 only mutates and restores it).
- Edited by the mutation steps and restored, never committed:
  - `src/lib/components/walkthrough/WalkthroughStage.svelte` (3a, 3d)
  - `src/lib/components/walkthrough/scenes/PhoneScene.svelte` (3b, 3c, 3d)
  - `src/lib/components/walkthrough/parts/dashboard/StageChips.svelte` (3e)
  - `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte` (3f)
  - `src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte` (3g)
  - `src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte` (3h)
  - `src/lib/components/walkthrough/WalkthroughVideo.svelte` (6a, 6b, before the accent edit; 11a after it)
  - `src/routes/+page.svelte` (11b)
- Conditional, only if Step 2 fails as described there: the T7 or T8 scene or part file that registers the wrong key or draws the wrong element. It is staged at the start of Step 3, before any mutation, and committed in Step 13.
- Test: the three new files above.

**Interfaces:**

- **Consumes:**
  - **T6, `src/lib/components/walkthrough/marks.ts`:**
    - `export const MARKS_CONTEXT = Symbol("walkthrough-marks");`, the key `provideMarks` and `useMark` use;
    - `export const SHELL_ROOT = "root.shell";` and `export const PHONE_ROOT = "root.phone";` (unchanged from base);
    - `useMark()`'s action registers with `registry.set(key, node)` on mount and deletes its key in `destroy` (unchanged from base). The recording registry relies on that `set`.
  - **T6, `src/lib/components/walkthrough/timeline.ts`:**
    - `export const REQUIRED_MARKS: readonly string[]`, kept equal to `computeFrame`'s reads by T6's Proxy sweep;
    - `export const T_LOG = CUES.LogNow + 1.45;` (7.45) and `export const T_TAP = CUES.Reminders + 3.0;` (38.5);
    - `CUES.Today` (2.5) and `CUES.Reminders` (35.5);
    - `computeFrame(T: number, M: Measurements): Frame` and `export type Frame`.
  - **T7:**
    - `WalkthroughStage` props `{ frame: Frame; time: number; full: boolean; timeFormat: TimeFormat }` (unchanged);
    - `REQUIRED_MARKS` after T7, 28 keys: `d.page`, `d.header`, `d.due`, `d.logNow`, `d.done`, `d.later`, `d.chips`, `o.offer`, `m.card0`–`m.card3`, `a.h1`, `a.category`, `a.name`, `a.dose`, `a.amount`, `a.unit`, `l.form`, `l.h1`, `l.check`, `n.stats`, `n.heatTitle`, `n.heatGrid`, `s.twofa`, `x.export`, `x.download` and `p.vitdLog`;
    - `StageDueCard`'s `logNowMark?: string`, on the Log now span as `use:register={logNowMark}`;
    - `StageUndoOffer` `{ message: string; opacity: number; mark?: string }`, rendered in `WalkthroughStage.svelte`'s `{#snippet overlay()}` as `<StageUndoOffer … mark="o.offer" />`;
    - `StageDashboardHeader`'s `mark?: string`, and "Today" drawn as `<p class="text-2xl font-bold">Today</p>`;
    - `StageChips` `{ medications: StageMedication[]; mark?: string }`, rooted at `<div use:register={mark} data-stage-section="chips">`;
    - `StageCollapse` `{ factor: number; children: Snippet }`, whose content is `{@render children()}` inside `<div class="min-h-0 overflow-hidden">`, mounted at every factor;
    - `Frame.dashboard: { pending: number | null; logged: number; offer: number }`.
  - **T8** (per the contract):
    - `PhoneScene.svelte` keeps `const mark = useMark();` and `use:mark={PHONE_ROOT}`;
    - it renders the phone `StageDueCard` with `logNowMark` set to `"p.vitdLog"` on Vitamin D's card, and the phone `StageDashboardHeader` with no `mark`;
    - it registers no other key, and no `{#if}` whose condition changes with T wraps a marked element;
    - `MyDaySection`, `StageToast` and their `p.morning`/`p.afternoon`/`p.evening`/`p.night` marks are gone.
  - **Existing:**
    - `userPreferences.accentColor` in `src/lib/server/db/schema.ts:316`, `text("accent_color").notNull().default("#4f46e5")`. Its `.default` is the string `"#4f46e5"` and `.hasDefault` is `true` (probed);
    - `ssrDocument(bodyHtml: string): Document` from `tests/unit/helpers/axe-ssr.ts`;
    - `WalkthroughVideo.svelte`: `playing = !reducedMotion;` (line 84), the button's `aria-label={playing ? "Pause walkthrough" : "Play walkthrough"}`, and the progress fill at `figure > div > div.h-1 > div`.
- **Produces:**
  - `WalkthroughVideo`'s `accent` prop defaults to `"#4f46e5"`. T10 greps for `accent = "#4f46e5"`.
  - `tests/unit/walkthrough-stage.svelte.test.ts`, holding `UNREAD_MARKS`. T10's CLAUDE.md bullet cites this file and runs it.
  - The reduced-motion test pins the three player hooks T10's browser check relies on: the `aria-label` pair, the `requestAnimationFrame` loop and the progress-fill selector.
  - No new export from `src/`.

- [ ] **Step 1: Write the stage mount test**

Create `tests/unit/walkthrough-stage.svelte.test.ts`.

- **The `.svelte.test.ts` suffix is load-bearing.** It is what lets `$state` stand in for the parent that moves the props through time, as in `tests/unit/log-page-mount.svelte.test.ts`.
- **`flushSync()` before every assertion.** Actions run only when effects flush; without it the registry is empty (probed: size 0 straight after `mount`).
- **`context` is a `mount` option.** `new Map([[MARKS_CONTEXT, registry]])` is how T6's `walkthrough-marks.svelte.test.ts` provides a registry.

```ts
// WalkthroughStage, mounted for real (jsdom, client svelte), to hold the
// contract between the scenes and the timeline that no other test can see.
//
// computeFrame (timeline.ts) frames its shots on elements it knows only by
// mark key, and every way of getting a key wrong is silent:
//   - a key nobody registers sends the camera to the wide shot and the cursor
//     to the window centre;
//   - a key registered on two elements is overwritten by whichever mounted
//     last (marks.ts);
//   - a key under the wrong root is measured from the wrong origin
//     (measureMarks walks offsetParents until it meets its root);
//   - the player measures while T is still on the title card, so a mark that
//     appears only later is never measured at all.
//
// So ONE mount, its props moved through the loop the way WalkthroughVideo
// moves them, is checked at seven moments:
//   - the registered keys are the same set every time, and that set is
//     exactly REQUIRED_MARKS, the two roots and UNREAD_MARKS;
//   - no key is ever registered against two different elements;
//   - every "p." key sits inside the phone root, and every other key inside
//     the shell root;
//   - nothing in the stage can take focus, and nothing adds a heading,
//     landmark or list: the whole stage is aria-hidden decoration.
//
// One `it`, deliberately: split up, an assertion over an empty registry
// could pass on its own.
//
// Does NOT cover geometry. jsdom has no layout, so every rect is zero; whether
// a framing looks right is the browser check's job (spec Section 5).
import { describe, it, expect, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { TimeFormat } from "$lib/utils/time";
import {
  CUES,
  REQUIRED_MARKS,
  T_LOG,
  T_TAP,
  computeFrame,
  type Frame,
} from "$lib/components/walkthrough/timeline";
import { MARKS_CONTEXT, PHONE_ROOT, SHELL_ROOT } from "$lib/components/walkthrough/marks";
import WalkthroughStage from "$lib/components/walkthrough/WalkthroughStage.svelte";

/**
 * Keys a scene registers that computeFrame never reads, by name rather than
 * by pattern, so a new unread key fails here until someone decides it
 * belongs. MedicationsScene marks all five cards and their stats rows; the
 * Medications and Timers shots frame only cards 0 to 3.
 */
const UNREAD_MARKS: readonly string[] = [
  "m.card4",
  "m.stats0",
  "m.stats1",
  "m.stats2",
  "m.stats3",
  "m.stats4",
];

/** Anything a keyboard or a screen reader could land on (spec Section 5). */
const FOCUSABLE =
  "a[href], area[href], button, input, select, textarea, summary, details, iframe, " +
  "audio[controls], video[controls], [contenteditable], [tabindex]";

/**
 * The headings, landmarks, lists and controls the real dashboard components
 * render and the stage parts must not copy, by element or by role
 * (Global Constraints). `role="img"` is not here: StatusMarker and Sparkline
 * carry it, and the stage may show them.
 */
const SEMANTIC = [
  "form, h1, h2, h3, h4, h5, h6, section, nav, main, aside, header, footer, article",
  "ul, ol, li, dl, table, dialog",
  "[role='heading'], [role='banner'], [role='navigation'], [role='main'], [role='region']",
  "[role='complementary'], [role='contentinfo'], [role='form'], [role='search']",
  "[role='list'], [role='listitem'], [role='dialog'], [role='button'], [role='link']",
].join(", ");

/** When production measures, then through both log beats, in loop order. */
const MOMENTS: ReadonlyArray<readonly [string, number]> = [
  ["the title card, when the player measures", 0],
  ["the Today pan", CUES.Today + 1],
  ["just before Log now", T_LOG - 0.1],
  ["Log now pending", T_LOG + 0.2],
  ["the Undo offer", T_LOG + 1.0],
  ["the phone before its tap", CUES.Reminders + 1],
  ["the phone after its tap", T_TAP + 0.5],
];

/** The registry WalkthroughVideo provides, recording every registration. */
class RecordingRegistry extends Map<string, HTMLElement> {
  readonly writes: Array<readonly [string, HTMLElement]> = [];

  override set(key: string, el: HTMLElement): this {
    this.writes.push([key, el]);
    return super.set(key, el);
  }
}

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()!();
});

describe("WalkthroughStage marks", () => {
  it("registers exactly the marks the timeline reads, from T = 0, once each, under the right root, with nothing focusable", () => {
    // Not vacuous: the list holds the marks both log beats are framed on.
    expect(REQUIRED_MARKS).toEqual(expect.arrayContaining(["d.logNow", "o.offer", "p.vitdLog"]));
    // And the unread list cannot excuse a mark the timeline does read.
    expect(UNREAD_MARKS.filter((key) => REQUIRED_MARKS.includes(key))).toEqual([]);
    const expected = [
      ...new Set([...REQUIRED_MARKS, SHELL_ROOT, PHONE_ROOT, ...UNREAD_MARKS]),
    ].sort();

    const registry = new RecordingRegistry();
    const target = document.body.appendChild(document.createElement("div"));
    const props = $state<{ frame: Frame; time: number; full: boolean; timeFormat: TimeFormat }>({
      frame: computeFrame(0, {}),
      time: 0,
      full: true,
      timeFormat: "24h",
    });
    const app = mount(WalkthroughStage, {
      target,
      props,
      context: new Map([[MARKS_CONTEXT, registry]]),
    });
    teardown.push(() => {
      unmount(app);
      target.remove();
    });

    for (const [moment, T] of MOMENTS) {
      props.frame = computeFrame(T, {});
      props.time = T;
      // Actions run only when effects flush, so without this the registry is
      // empty and every check below compares nothing.
      flushSync();
      const at = `at ${moment} (T = ${T.toFixed(2)})`;

      expect([...registry.keys()].sort(), `registered marks ${at}`).toEqual(expected);

      const elementsByKey = new Map<string, Set<HTMLElement>>();
      for (const [key, el] of registry.writes) {
        const elements = elementsByKey.get(key) ?? new Set<HTMLElement>();
        elements.add(el);
        elementsByKey.set(key, elements);
      }
      expect(
        [...elementsByKey].filter(([, elements]) => elements.size > 1).map(([key]) => key),
        `keys registered on more than one element ${at}`,
      ).toEqual([]);

      const shell = registry.get(SHELL_ROOT)!;
      const phone = registry.get(PHONE_ROOT)!;
      expect(shell.contains(phone) || phone.contains(shell), "the two roots overlap").toBe(false);
      expect(
        [...registry]
          .filter(([key]) => !key.startsWith("root."))
          .filter(([key, el]) => !(key.startsWith("p.") ? phone : shell).contains(el))
          .map(([key]) => key),
        `marks outside their root ${at}`,
      ).toEqual([]);

      expect(
        [...target.querySelectorAll(FOCUSABLE)].map((el) => el.outerHTML.slice(0, 120)),
        `focusable elements in the stage ${at}`,
      ).toEqual([]);
      expect(
        [...target.querySelectorAll(SEMANTIC)].map((el) => el.outerHTML.slice(0, 120)),
        `headings, landmarks or lists in the stage ${at}`,
      ).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/unit/walkthrough-stage.svelte.test.ts`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  1 passed (1)`.

- **The seven moments** are T = 0, 3.5, 7.35, 7.65, 8.45, 36.5 and 39.0.
- **The expected key set** is 36 keys:
  - `REQUIRED_MARKS`' 28 (listed under Interfaces);
  - the two roots, `root.shell` and `root.phone`;
  - the six `UNREAD_MARKS`, `m.card4` and `m.stats0`–`m.stats4`.

**What was probed.** The test's mechanics were run against base `311758f`, with the old names (`CUES.MyDay`, `CUES.QuickLog + 1.45`) and a `vi.mock` of `marks.ts` that exports the key exactly as T6's Step 10 does:

- every scene mounts in jsdom with no stub;
- 43 keys are registered at all seven moments, with 0 keys on two elements, 0 marks outside their root, 0 focusable and 0 heading, landmark or list elements;
- unmounting empties the registry, so `destroy` deletes keys;
- `computeFrame` reads 28 keys at base, and the stage registers 13 it never reads. Seven of those belong to `MyDaySection` and the old `DashboardScene` (`d.afternoon`, `d.lisLog`, `d.today`, `p.morning`, `p.afternoon`, `p.evening`, `p.night`), which T7 and T8 remove. The other six are `UNREAD_MARKS`. `MedicationsScene` registers them, and no task changes it.

T7's own probe mounted its stage at these seven moments and saw the same eight desktop keys at each one.

**If it FAILS on `registered marks at the title card, when the player measures (T = 0.00)`**, read the diff. Never edit `REQUIRED_MARKS` (T6's sweep pins it to `computeFrame`'s reads) and never loosen a comparison.

- **A key under `- Expected` and missing from `+ Received`** is a mark the timeline reads that no scene registers at T = 0. That is a T7 or T8 defect. Fix the scene so the marked element is mounted at every T with its key.
- **A key under `+ Received` and not under `- Expected`** is registered but never read.
  - **A leftover of the old scenes** (`d.strip`, `d.morning`, `d.evening`, `d.night`, `d.afternoon`, `d.quick`, `d.lisPill`, `d.lisLog`, `d.today`, `o.toast`, `p.morning`, `p.afternoon`, `p.evening` or `p.night`): delete that `use:mark` or `markKey`.
  - **A key T8 registers on purpose without `computeFrame` reading it:** add it to `UNREAD_MARKS` with a comment naming the scene that registers it, and say so in the commit body.

**If it fails on a later moment**, a marked element was created or destroyed as T moved. Find the `{#if}`, `{#key}` or `{#each}` around it whose condition depends on the Frame, and draw that element with height, opacity or transform instead (Global Constraints).

**If it fails on the focusable or heading check**, a part copied a control, heading, list or landmark from the real component. Draw it as a `<span>` or `<p>` instead.

**Any `src/` file these rules make you change is staged at the start of Step 3**, before the first mutation, and committed in Step 13. Re-run this step until it passes first. An `UNREAD_MARKS` edit is in the test file, which stays untracked until Step 13.

- [ ] **Step 3: Prove the stage test by mutation**

**If Step 2 made you edit any file under `src/`, `git add` it now**, before the first mutation:

```bash
git add <each src/ file Step 2 made you change>
```

`git restore <file>` copies the file back from the index. Once your fix is staged, a restore puts back the fix, not T7's or T8's commit. Left unstaged, the fix is reverted by the first restore that touches its file, and the `git status` check below shows the loss only after it has happened. Several mutations below edit exactly the files Step 2 can send you into: `PhoneScene.svelte`, `WalkthroughStage.svelte`, `StageDueCard.svelte` and the other parts.

Do not stage the test file. `git restore` never touches an untracked file, so it is safe as it is, and it stays `??` in every check below.

Probed in a scratch repository: with a fix staged and a mutation on top, `git status --short` reads `MM <path>`. After `git restore <path>` the file holds the staged fix and the line reads `M  <path>`, an `M` in the first column followed by two spaces.

Run each mutation alone. Every file it touches was committed by T7 or T8. At this point it is either clean or differs from that commit only by your staged Step 2 fix, so `git restore` is safe. After each one:

1. run `npx vitest run tests/unit/walkthrough-stage.svelte.test.ts`;
2. check that `WalkthroughStage marks > registers exactly the marks the timeline reads, from T = 0, once each, under the right root, with nothing focusable` FAILS with the message given;
3. restore with `git restore <every file the mutation touched>`;
4. check that `git status --short` lists only:
   - `?? tests/unit/walkthrough-stage.svelte.test.ts`;
   - one `M  <path>` line (staged, nothing unstaged) for each file you staged above, and none if Step 2 passed first time.

   A line reading `MM` or ` M` means a mutation is still in the working tree. Run `git restore` on that path again.

**3a. A marked element mounted only after the log.** This is the spec's "wrap the new Done row's mark in `{#if logged}`". It is applied to `o.offer`, because the new Done row has no mark of its own: `d.done` is the whole section, mounted at every T (CONTRACT ISSUES).

In `src/lib/components/walkthrough/WalkthroughStage.svelte`, inside `{#snippet overlay()}`, leave the desktop `<StageUndoOffer … mark="o.offer" />` element exactly as T7 wrote it, and:

- add the line `{#if frame.dashboard.offer > 0}` directly above its opening `<StageUndoOffer`;
- add the line `{/if}` directly below its closing `/>`.

Expected FAIL: `registered marks at the title card, when the player measures (T = 0.00)`, with `-   "o.offer",` in the diff.

Restore: `git restore src/lib/components/walkthrough/WalkthroughStage.svelte`.

**3b. The phone's card given the desktop card's key.** In `src/lib/components/walkthrough/scenes/PhoneScene.svelte`, change the string `"p.vitdLog"` that T8 passes to the phone `StageDueCard`'s `logNowMark` to `"d.logNow"`.

Expected FAIL: `registered marks at the title card, when the player measures (T = 0.00)`, with `-   "p.vitdLog",` in the diff.

Restore: `git restore src/lib/components/walkthrough/scenes/PhoneScene.svelte`.

**3c. A `d.` key passed to a phone part.** In `src/lib/components/walkthrough/scenes/PhoneScene.svelte`, add the attribute `mark="d.header"` to the phone's `<StageDashboardHeader` element.

The key set is unchanged, because the desktop still registers `d.header`, so it is the duplicate check that fires.

Expected FAIL: `keys registered on more than one element at the title card, when the player measures (T = 0.00): expected [ 'd.header' ] to deeply equal []`.

Restore: `git restore src/lib/components/walkthrough/scenes/PhoneScene.svelte`.

**3d. A key under the wrong root.** Make two edits:

- in `src/lib/components/walkthrough/WalkthroughStage.svelte`, delete the line `mark="o.offer"` from the desktop `<StageUndoOffer`;
- in `src/lib/components/walkthrough/scenes/PhoneScene.svelte`, add the attribute `mark="o.offer"` to the phone's `<StageDashboardHeader` element.

The set is unchanged and no key has two elements, so only the containment check fires: `o.` is a desktop prefix, measured against the shell, and the element now sits inside the phone.

Expected FAIL: `marks outside their root at the title card, when the player measures (T = 0.00): expected [ 'o.offer' ] to deeply equal []`.

Restore: `git restore src/lib/components/walkthrough/WalkthroughStage.svelte src/lib/components/walkthrough/scenes/PhoneScene.svelte`.

**3e. A `<button>` in `StageChips`.** In `src/lib/components/walkthrough/parts/dashboard/StageChips.svelte`, directly above the file's last line, `</div>` (the root's closing tag), add the line `  <button type="button">+</button>`.

Expected FAIL: `focusable elements in the stage at the title card, when the player measures (T = 0.00): expected [ '<button type="button">+</button>' ] to deeply equal []`. The array holds one entry per `StageChips` the stage draws, which is one, the desktop's, if T8 followed the spec's phone content.

Restore: `git restore src/lib/components/walkthrough/parts/dashboard/StageChips.svelte`.

**3f. `use:mark` removed from Log now.** In `src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`, delete ` use:register={logNowMark}` from the Log now span.

Expected FAIL: `registered marks at the title card, when the player measures (T = 0.00)`, with both `-   "d.logNow",` and `-   "p.vitdLog",` in the diff.

Restore: `git restore src/lib/components/walkthrough/parts/dashboard/StageDueCard.svelte`.

**3g. A heading copied from the real header.** In `src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte`, change `<p class="text-2xl font-bold">Today</p>` to `<h1 class="text-2xl font-bold">Today</h1>`. The real `DashboardHeader.svelte` renders exactly this `h1`.

Expected FAIL: `headings, landmarks or lists in the stage at the title card, when the player measures (T = 0.00)`, listing `'<h1 class="text-2xl font-bold">Today</h1>'` once per header the stage draws: twice, the desktop's and the phone's.

Restore: `git restore src/lib/components/walkthrough/parts/dashboard/StageDashboardHeader.svelte`.

**3h. A collapse that unmounts instead of drawing at zero height.** This is the opposite failure to 3a: marks registered at T = 0 that vanish later, which only the every-moment comparison can see. In `src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte`, change `    {@render children()}` to `    {#if factor > 0}{@render children()}{/if}`.

At T = 0 the Due section's factor is 1, so the T = 0 set still matches. Once `logged` reaches 1, the Due collapse's factor is 0 and its content, with both of its marks, is destroyed.

Expected FAIL: `registered marks at the Undo offer (T = 8.45)`, with `-   "d.due",` and `-   "d.logNow",` in the diff.

Restore: `git restore src/lib/components/walkthrough/parts/dashboard/StageCollapse.svelte`.

- [ ] **Step 4: Write the reduced-motion test**

Create `tests/unit/walkthrough-video.svelte.test.ts`. jsdom lacks three APIs the player uses, so each is stubbed:

- **`ResizeObserver`.** `bind:clientWidth` constructs one (`svelte/src/internal/client/dom/elements/bindings/size.js:99-107`). Without the stub, mount throws `ReferenceError: ResizeObserver is not defined` (probed).
- **`IntersectionObserver`** and **`matchMedia`**: absent in jsdom.

```ts
// WalkthroughVideo, mounted for real (jsdom, client svelte), for the one
// behaviour no other test can reach: a visitor who prefers reduced motion
// gets the title frame and a Play button, and nothing moves until they press
// it (WCAG 2.2.2). The player decides that in onMount from matchMedia, so it
// cannot be seen in SSR output.
//
// jsdom has no matchMedia, IntersectionObserver or ResizeObserver, and no
// layout, so each is stubbed:
//   - matchMedia answers the reduced-motion query;
//   - the one IntersectionObserver the player creates is fired by hand, so
//     the player is on screen (`inView`) with the full stage mounted (`full`),
//     and the page is visible. The preference is then the ONLY thing left
//     that could stop playback;
//   - ResizeObserver exists only because `bind:clientWidth` constructs one,
//     and clientWidth reads 1024, the landing page's container, because jsdom
//     reports 0 and that would scale the stage to nothing.
// requestAnimationFrame is a spy that never calls back: "playing" is whether
// the player asked for a frame at all.
//
// The second case is the control. Without it, a harness that could never
// play anything would pass the first case for the wrong reason.
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync, mount, tick, unmount } from "svelte";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";

const teardown: Array<() => void> = [];

afterEach(() => {
  while (teardown.length) teardown.pop()!();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mountPlayer({ reducedMotion }: { reducedMotion: boolean }) {
  const observers: IntersectionObserverCallback[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }));
  const requestFrame = vi.fn(() => 1);
  vi.stubGlobal("requestAnimationFrame", requestFrame);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(1024);

  const target = document.body.appendChild(document.createElement("div"));
  const app = mount(WalkthroughVideo, { target, props: {} });
  teardown.push(() => {
    unmount(app);
    target.remove();
  });
  // onMount, which reads the preference and creates the observer, runs here.
  flushSync();

  // Scrolled into view, on a visible page: neither is what stops playback.
  expect(document.visibilityState).toBe("visible");
  expect(observers).toHaveLength(1);
  observers[0]([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
  flushSync();

  return { target, requestFrame };
}

/** The one element whose own text is exactly `text`. */
function byText(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>("p, span")].filter(
    (el) => el.textContent?.replace(/\s+/g, " ").trim() === text,
  );
  expect(found, `elements reading "${text}"`).toHaveLength(1);
  return found[0];
}

/**
 * Whether `el` would be painted, by CSS `visibility` alone: the nearest
 * ancestor-or-self that sets it to anything but `inherit` decides, as in CSS.
 * The stage hides whole layers this way rather than unmounting them.
 */
function isShown(el: HTMLElement, root: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node && node !== root; node = node.parentElement) {
    const visibility = node.style.visibility;
    if (visibility && visibility !== "inherit") return visibility !== "hidden";
  }
  return true;
}

function playButton(root: ParentNode): HTMLButtonElement {
  const buttons = root.querySelectorAll("button");
  expect(buttons).toHaveLength(1);
  return buttons[0];
}

/** The progress fill along the bottom of the player. */
function progress(root: ParentNode): string {
  const bar = root.querySelector<HTMLElement>("figure > div > div.h-1 > div");
  expect(bar).not.toBeNull();
  return bar!.style.width;
}

describe("WalkthroughVideo and reduced motion", () => {
  it("shows the title frame, does not play, and offers to play when the viewer prefers reduced motion", async () => {
    const { target, requestFrame } = mountPlayer({ reducedMotion: true });
    // A player that started one microtask late would still be caught.
    await tick();

    expect(playButton(target).getAttribute("aria-label")).toBe("Play walkthrough");
    expect(requestFrame).not.toHaveBeenCalled();
    expect(progress(target)).toBe("0%");
    // The title frame is the one painted: its line shows, and the desktop
    // app (mounted, since the player is on screen) does not.
    expect(isShown(byText(target, "Track your medications effortlessly"), target)).toBe(true);
    expect(isShown(byText(target, "Demo User"), target)).toBe(false);

    // The button does what it offers.
    playButton(target).click();
    flushSync();
    expect(playButton(target).getAttribute("aria-label")).toBe("Pause walkthrough");
    expect(requestFrame).toHaveBeenCalled();
  });

  it("plays on its own when the viewer has no motion preference (the control)", async () => {
    const { target, requestFrame } = mountPlayer({ reducedMotion: false });
    await tick();

    expect(playButton(target).getAttribute("aria-label")).toBe("Pause walkthrough");
    expect(requestFrame).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run it**

Run: `npx vitest run tests/unit/walkthrough-video.svelte.test.ts`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  2 passed (2)`. Probed against base `311758f`:

- **With `reduce`:** `aria-label` "Play walkthrough", 0 `requestAnimationFrame` calls, the progress fill at `0%`, the title line shown and "Demo User" hidden. After the click: "Pause walkthrough" and 1 call.
- **Without it:** "Pause walkthrough" and 1 call.
- **In both:** `document.visibilityState` is `"visible"` and the player creates exactly one `IntersectionObserver`.

The full stage mounts inside the player here, because the observer brings it on screen. So this test also depends on every scene mounting in jsdom, which Step 2 already requires.

- [ ] **Step 6: Prove the reduced-motion test by mutation**

Do this BEFORE Step 9: `git restore` on `WalkthroughVideo.svelte` is safe only while the accent edit has not been made. Both mutations were run against base on a copy of the component, with the outcomes shown.

**6a. Reduced motion ignored.** In `src/lib/components/walkthrough/WalkthroughVideo.svelte`, change `    playing = !reducedMotion;` to `    playing = true;`.

Run: `npx vitest run tests/unit/walkthrough-video.svelte.test.ts`

Expected FAIL: `WalkthroughVideo and reduced motion > shows the title frame, does not play, and offers to play when the viewer prefers reduced motion`, with `AssertionError: expected 'Pause walkthrough' to be 'Play walkthrough' // Object.is equality`. The control still passes.

Restore: `git restore src/lib/components/walkthrough/WalkthroughVideo.svelte`.

**6b. The control is live.** In the same file, change `    playing = !reducedMotion;` to `    playing = false;`.

Run: `npx vitest run tests/unit/walkthrough-video.svelte.test.ts`

Expected FAIL: `WalkthroughVideo and reduced motion > plays on its own when the viewer has no motion preference (the control)`, with `AssertionError: expected 'Play walkthrough' to be 'Pause walkthrough' // Object.is equality`. The reduced-motion case still passes.

Restore: `git restore src/lib/components/walkthrough/WalkthroughVideo.svelte`.

- [ ] **Step 7: Write the failing accent test**

Create `tests/unit/walkthrough-video-ssr.test.ts`:

```ts
// @vitest-environment node
//
// `node` is load-bearing: under the suite's default jsdom, vite resolves
// `svelte` to its client entry and `render()` from `svelte/server` throws
// `effect_orphan` (same reason as tests/unit/error-page-ssr.test.ts). The
// reduced-motion mount test needs jsdom, which is why this is its own file.
//
// The walkthrough's accent is the accent a new account gets. The landing page
// renders `<WalkthroughVideo />` with no props, so the prop's default IS what
// every visitor sees, and the prerendered HTML is what they see first. The
// oracle is the Drizzle column default, not a literal: it moved once
// (#6366f1 to #4f46e5, 2026-09-06) and the video was left behind.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { render } from "svelte/server";
import { userPreferences } from "$lib/server/db/schema";
import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";
import { ssrDocument } from "./helpers/axe-ssr";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/** `a: b; c: d` as a map, splitting each declaration on its first colon only. */
function declarations(style: string): Map<string, string> {
  return new Map(
    style
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(":");
        return [part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as const;
      }),
  );
}

describe("the walkthrough's accent", () => {
  it("defaults to the accent column's default", () => {
    const accent = userPreferences.accentColor.default;
    // Not vacuous: the oracle is a real colour, not SQL or undefined.
    expect(accent).toMatch(/^#[0-9a-f]{6}$/i);

    // The same style attribute also carries --color-accent-fg, -ink and
    // -hover, so a substring match could be satisfied by the wrong one.
    const doc = ssrDocument(render(WalkthroughVideo).body);
    const themed = [...doc.querySelectorAll("[style]")].filter((el) =>
      declarations(el.getAttribute("style")!).has("--color-accent"),
    );
    expect(themed).toHaveLength(1);
    expect(declarations(themed[0].getAttribute("style")!).get("--color-accent")).toBe(accent);
  });

  it("is rendered by the landing page with no accent prop, so the default is what ships", () => {
    const page = readFileSync(join(repoRoot, "src/routes/+page.svelte"), "utf8");
    expect(page).toContain(
      'import WalkthroughVideo from "$lib/components/walkthrough/WalkthroughVideo.svelte";',
    );
    const tags = page.match(/<WalkthroughVideo\b[^>]*>/g) ?? [];
    expect(tags).toHaveLength(1);
    // Neither `accent=`, the `{accent}` shorthand, nor a spread that could carry one.
    expect(tags[0]).not.toMatch(/\baccent\b|\{\s*\.\.\./);
  });
});
```

- [ ] **Step 8: Run it to see it fail**

Run: `npx vitest run tests/unit/walkthrough-video-ssr.test.ts`

Expected: FAIL, `Tests  1 failed | 1 passed (2)` (probed):

- `the walkthrough's accent > defaults to the accent column's default` fails with `AssertionError: expected '#6366f1' to be '#4f46e5' // Object.is equality`.
- `the walkthrough's accent > is rendered by the landing page with no accent prop, so the default is what ships` passes. `src/routes/+page.svelte` holds exactly one tag, `<WalkthroughVideo />`.

The probe also found what the comparison has to step around. 7 elements carry a `style`, and exactly one declares `--color-accent`. That one also declares `--color-accent-hover: #4338ca` (a `DARK_TOKENS` constant), `--color-accent-fg: #ffffff` and `--color-accent-ink: #9092f5`.

- [ ] **Step 9: Change the default**

In `src/lib/components/walkthrough/WalkthroughVideo.svelte`, replace:

```svelte
  let {
    // The app's default accent, so the video matches what a new account sees.
    accent = "#6366f1",
```

with:

```svelte
  let {
    // The app's default accent, so the video matches what a new account sees.
    accent = "#4f46e5",
```

The comment is unchanged: it becomes true (spec Section 4).

- [ ] **Step 10: Run the three new files**

Run: `npx vitest run tests/unit/walkthrough-video-ssr.test.ts tests/unit/walkthrough-video.svelte.test.ts tests/unit/walkthrough-stage.svelte.test.ts`

Expected: PASS, `Test Files  3 passed (3)` and `Tests  5 passed (5)`.

- [ ] **Step 11: Prove the accent test by mutation**

**11a. The old default restored.** In `src/lib/components/walkthrough/WalkthroughVideo.svelte`, change `    accent = "#4f46e5",` back to `    accent = "#6366f1",`.

Run: `npx vitest run tests/unit/walkthrough-video-ssr.test.ts`

Expected FAIL: `the walkthrough's accent > defaults to the accent column's default`, with `AssertionError: expected '#6366f1' to be '#4f46e5' // Object.is equality`.

Restore by editing the line back to `    accent = "#4f46e5",`. Do NOT `git restore` this file: that would also discard Step 9.

**11b. The landing page passing an accent.** In `src/routes/+page.svelte`, change `<WalkthroughVideo />` to `<WalkthroughVideo accent="#6366f1" />`.

Run: `npx vitest run tests/unit/walkthrough-video-ssr.test.ts`

Expected FAIL: `the walkthrough's accent > is rendered by the landing page with no accent prop, so the default is what ships`, with `AssertionError: expected '<WalkthroughVideo accent="#6366f1" />' not to match /\baccent\b|\{\s*\.\.\./` (probed).

Restore: `git restore src/routes/+page.svelte`. T6 committed its change to this file, so it is clean at this point.

Then run `git status --short`. Expected, exactly:

```
 M src/lib/components/walkthrough/WalkthroughVideo.svelte
?? tests/unit/walkthrough-stage.svelte.test.ts
?? tests/unit/walkthrough-video-ssr.test.ts
?? tests/unit/walkthrough-video.svelte.test.ts
```

Each `src/` file Step 2's rules made you fix adds one `M  <path>` line, staged since the start of Step 3. Nothing else may appear.

- [ ] **Step 12: Run the gates**

Run, from the worktree root:

```bash
npx vitest run
npx vitest run
npm run check
npm run lint
npm run format:check
```

Expected:

- **`npx vitest run`, both runs:** 0 failures, with any failing test named. The counts are T8's commit plus 3 files and 5 tests.
- **`npm run check`:** 0 errors and at most 27 warnings. Probed with svelte-check at base: the two video files add no error or warning. The stage file's only errors at base were the names T6 adds (`REQUIRED_MARKS`, `T_LOG`, `T_TAP`, `MARKS_CONTEXT`, `CUES.Today`), so it adds none once T6–T8 are in.
- **`npm run lint`:** 0 errors and at most 115 warnings. ESLint reported nothing for the three files.
- **`npm run format:check`:** clean. The three files above are already in Prettier's output form (probed with `prettier --check`).

- [ ] **Step 13: Commit**

```bash
git add src/lib/components/walkthrough/WalkthroughVideo.svelte \
  tests/unit/walkthrough-stage.svelte.test.ts \
  tests/unit/walkthrough-video.svelte.test.ts \
  tests/unit/walkthrough-video-ssr.test.ts
git commit -F - <<'MSG'
fix(walkthrough): use the app's default accent and pin the stage's marks

The landing page renders <WalkthroughVideo /> with no props, so the prop
default is the accent every visitor sees, and it was still #6366f1 after
new accounts moved to #4f46e5. It now matches the accent column's default,
and an SSR test reads that default from the schema rather than a literal.

The stage mount test mounts WalkthroughStage with a recording marks
registry and moves one mount through seven moments of the loop. At every
moment the registered keys must equal REQUIRED_MARKS plus the two roots and
the listed unread keys, each key on one element and under its own root, and
nothing in the stage may take focus or add a heading, landmark or list.

The reduced-motion test mounts WalkthroughVideo with matchMedia reporting
"reduce": the title frame shows, nothing plays, and the button offers to
play. A control case proves the harness can see playback.
MSG
```

If Step 2's rules made you change a T7 or T8 file, it is already staged (Step 3). Name it in the `git add` above anyway, and add one paragraph to the body naming the key and why it moved.

#### Notes for the reviewer

- **One mount, moved through time, not seven fresh mounts.** The props are a `$state` object the test reassigns, as `WalkthroughVideo` reassigns `frame` and `time`.
  - The registry snapshot at each moment is the set production would measure, if it measured then.
  - The recorded writes span the whole run, so an element re-created as T changes (a `{#key}`, or an `{#if}` that flips) shows up as one key on two elements. Fresh mounts would miss that, and would also miss 3h.
- **`UNREAD_MARKS` is six keys**, `m.card4` and `m.stats0`–`m.stats4`, from the base probe. `MedicationsScene` is untouched by T1–T8. T6's note lists only `m.stats0`–`m.stats3`; the probe shows five cards and five stats rows, because `MEDICATIONS` has five entries.
- **T8 is written to match.** The phone draws `StageDashboardHeader` with no `mark` and registers exactly `root.phone` and `p.vitdLog` (T8 Step on PhoneScene marks), so mutations 3b–3d anchor on those names as written.
- **Mutation 3a stands in for the spec's Done-row mutation**, and 3h is added beside it. 3a is a marked element that appears only after the log, and 3h a marked element that disappears after it.
  - 3a fails at T = 0.
  - 3h passes at T = 0 and fails at T = 8.45, so it is the one mutation that proves the "same set at every T" half of D8.
  - 3h breaks `StageCollapse`, which is the mechanism the new Done row grows through.
- **The `SEMANTIC` check goes beyond the spec's focusable selector.** It enforces the Global Constraints' "no heading, landmark or `ul`", and 3g proves it.
  - It names landmark, list and control roles explicitly. It deliberately omits `role="img"` (StatusMarker, Sparkline) and `role="status"`.
  - A live region copied from `Toast.svelte` announces nothing inside the `aria-hidden` stage, so failing T9 on it would be noise.
  - T7's fidelity file has a similar `FORBIDDEN` list, but it runs only over an SSR render of `DashboardScene`. This one covers every scene, both surfaces and seven moments.
- **The reduced-motion harness makes the preference the only brake.**
  - The `IntersectionObserver` stub fires `isIntersecting: true`, so `inView` and `full` are both true, and the test asserts `document.visibilityState === "visible"`.
  - `clientWidth` reads 1024, because jsdom reports 0, which would scale the stage to nothing. The title-shown assertion does not depend on it: `isShown` follows CSS, where a `visibility: visible` layer inside a hidden ancestor is painted.
  - The control case, and 6b, prove the harness can observe playback.
  - `requestAnimationFrame` being uncalled is the "not playing" signal, because the player's loop is its only caller. The `aria-label` and the 0% progress fill back it up.
- **The progress-fill selector** is `figure > div > div.h-1 > div`, the one T10's Interfaces record, so the test pins what T10's browser check reads.
- **The accent test parses the raw `style` attribute into declarations.**
  - The attribute also carries `--color-accent-hover`, `-fg` and `-ink` (probed), so a substring match could be satisfied by the wrong one.
  - The oracle is guarded by `toMatch(/^#[0-9a-f]{6}$/i)`, because a Drizzle `.default` can be `SQL` or `undefined`.
- **The `+page.svelte` check is a source scan.**
  - It requires the import of this exact component, refuses `accent=`, `{accent}` and spreads, and allows any other prop, such as a future `timeFormat`.
  - The probe checked the regex against `<WalkthroughVideo />` (no match), `accent="#6366f1"`, `{accent}` and `{...props}` (all match) and `timeFormat="12h"` (no match).
- **Step order matters for restores.**
  - Step 6's mutations use `git restore` on `WalkthroughVideo.svelte`, so they run before Step 9. Step 11a restores by hand.
  - A Step 2 fix is staged before Step 3 for the same reason. `git restore` restores from the index, so a staged fix survives every mutation's restore, and an unstaged one does not.
- **Probe files.** Every probe file was created as `tests/unit/zz-probe-plan-T9-*` and deleted, and `git status --short` was clean afterwards.

#### Interface notes (deviations from the planning contract)

- **The header's File Structure lists one file,** `tests/unit/walkthrough-video.svelte.test.ts`, for "T9: reduced motion and accent". One file cannot hold both.
  - The reduced-motion test needs jsdom (`mount`, `matchMedia`).
  - Spec Section 4 requires the accent test to SSR-render with `render` from `svelte/server` and read `.body`, which needs `// @vitest-environment node`.
  - Under jsdom, `render(WalkthroughVideo)` throws `effect_orphan` (probed; same reason as `tests/unit/error-page-ssr.test.ts`), and the environment is set per file.
  - **What this task uses instead:** the accent test is `tests/unit/walkthrough-video-ssr.test.ts`, following the repo's `*-ssr.test.ts` naming. The reduced-motion test keeps `tests/unit/walkthrough-video.svelte.test.ts`.
  - **The header fix.** Under **Create**, replace the line ``- `tests/unit/walkthrough-video.svelte.test.ts` (T9: reduced motion and accent).`` with these two:

    ```markdown
    - `tests/unit/walkthrough-video.svelte.test.ts` (T9: reduced motion, jsdom).
    - `tests/unit/walkthrough-video-ssr.test.ts` (T9: the accent, `// @vitest-environment node`).
    ```

    Any T10 reference to "the accent check" should name the `-ssr` file. T10 as written names neither file, so it needs no change.

- **The header's File Structure has other omissions, found in review and checked against each task's own Files list.** This fix pass may edit only this part, so `header.md` itself is unchanged. Whoever edits it should make these changes:
  - **Create**, add:
    - `` `tests/unit/analytics-status-breakdown.test.ts` (T3). `` T3's Files: "Test (create)".
    - `` `tests/unit/walkthrough-marks.svelte.test.ts` (T6, extended by T8). `` T6 creates it, and T8 changes its imports and appends one `describe`.
    - `` `src/lib/components/walkthrough/stage-dashboard.ts` (T7, extended by T8). `` T7 creates it with `WALKTHROUGH_DATE_FORMAT`, `beatRow`, `stageLogToast` and `STAGE_REFILLS`. T8 edits its header comment and import and appends `lastEventBefore`.
    - `StageCollapse`, in the T7 parts list, which becomes `` `src/lib/components/walkthrough/parts/dashboard/{StageCollapse,StageDashboardHeader,StageDueCard,StageDoneList,StageLaterList,StageChips,StageRefills,StageUndoOffer}.svelte` (T7). ``
    - The `-ssr` accent file, through the replacement above.
  - **Modify**, add:
    - `` `src/lib/components/StatusBreakdownBar.svelte` (T4: `<script module>` `statusBreakdownSegments`). `` T4's own CONTRACT ISSUES flags this omission.
    - `` `src/lib/components/RefillsCard.svelte` (T7) ``, **only if the Refills fix is taken**. T7 as written does not modify it: `StageRefills` copies `RefillsCard`'s private helpers instead.
  - **Delete**, change the owner of the four old parts from "(T7 and T8)" to "(T8)". T7's Files says they are "Not deleted here", and T8's Files deletes all four.
- **The spec's mutation "wrap the new Done row's mark in `{#if logged}`" has no target.** The contract's desktop marks (`d.page`, `d.header`, `d.due`, `d.logNow`, `d.done`, `d.later`, `d.chips`, `o.offer`) put no mark on the new Done row. `d.done` is the whole `StageDoneList`, mounted at every T. Steps 3a (`o.offer` behind `{#if frame.dashboard.offer > 0}`) and 3h (`StageCollapse` unmounting at factor 0) cover the same failure class from both directions. The spec's list is otherwise kept: 3b, 3c, 3e and 3f are its other four mutations.

### Task 10: Docs, visual verification and final gates

This task records the walkthrough's rules in `CLAUDE.md` and `CHANGELOG.md`, checks the finished stage in a real browser at a 1024px and a 375px container, and runs every gate twice over. It writes no new unit test. Its test is the browser check, which owns **Review Focus 5** (the phone at 375px). Spec Section 5 decides the method:

- seek by stubbing `performance.now` and `requestAnimationFrame`;
- use a throwaway `.env` that is deleted afterwards;
- add nothing to `src/` for the check.

The only source edits this task may make are the two tunings Section 5 allows, `PHONE_LATER_ROWS` and a `fitCamera` cap, and only when a check fails (Steps 20 and 21).

**Files:**

- Modify: `CLAUDE.md:68`. Insert one bullet after the `InsightsCard.svelte` / `StatusBreakdownBar.svelte` / `RefillsCard.svelte` bullet, under `## Reusable Components`. Line numbers are at base 311758f; T1–T9 do not touch `CLAUDE.md`.
- Modify: `CHANGELOG.md:23`. In the `### Added` walkthrough entry, "My Day, Quick Log," becomes "Today, Log now,". It is in `[Unreleased]`, so it would otherwise ship describing two scenes this PR removes.
- Modify: `CHANGELOG.md:40`. Append one bullet to `### Changed` after the `/api/v1` (non-breaking) bullet.
- Modify: `CHANGELOG.md:56` (57 once the line above is in). Append one bullet to `### Fixed` after the "Native checkboxes…" bullet.
- Create, then delete, never stage: `.env` (gitignored by `.gitignore:16`). Step 8 writes it with the first line `# walkthrough-check throwaway` and refuses to run if a `.env` already exists; Step 19 deletes it only when that line is present.
- Conditional, only if Step 16, 17 or 18 fails as described there:
  - `src/lib/components/walkthrough/demo-dashboard.ts`, the `export const PHONE_LATER_ROWS = …;` line;
  - `src/lib/components/walkthrough/timeline.ts`, one `fitCamera(…, cap)` argument;
  - any test line that pins either literal.
- Test: no new test file. The browser check (Steps 7–19) is Review Focus 5's test, and Step 22 runs the full suite twice.

**Interfaces:**

- Consumes:
  - **T6** (`src/lib/components/walkthrough/timeline.ts`):
    - `CUES: Readonly<Record<SceneName, number>>` with keys `Title, Today, LogNow, Medications, Timers, AddMedication, History, Analytics, Security, Export, Reminders, Outro`;
    - `TOTAL_DURATION` (43.5);
    - `export const T_LOG = CUES.LogNow + 1.45` (7.45) and `export const T_TAP = CUES.Reminders + 3.0` (38.5);
    - `REQUIRED_MARKS: readonly string[]`.
  - **T6** (`marks.ts`): `MARKS_CONTEXT`.
  - **T5** (`src/lib/components/walkthrough/demo-dashboard.ts`):
    - `DESKTOP_BEFORE`, `DESKTOP_AFTER`, `PHONE_BEFORE` and `PHONE_AFTER: StageMoment`, with `now: Date` and `status: DashboardStatus`;
    - `PHONE_LATER_ROWS: number`. T5 sets it to `2` as a provisional estimate and leaves the decision to this task's phone screenshot. T5's bounds test requires a non-empty prefix no longer than the phone's Later list (4 rows), and pins no literal.
    - The module imports only `$lib/types` and `./demo-data`, so the browser can import it directly from the dev server (Step 15).
  - **T4** (`demo-data.ts`):
    - `WALKTHROUGH_TZ` ("UTC") and `PHONE_NOW`;
    - `DEMO_DOSES: readonly DemoDose[]`, each `{ id, medicationId, takenAt: Date, quantity, status }`;
    - `STATUS_BREAKDOWN: { takenEvents; skippedEvents; missedEvents; expectedTotal; adherencePercent }`;
    - `SESSION_EXPIRIES: readonly Date[]`.
  - **T2** (`src/lib/utils/time.ts`): `lastLoggedPhrase(lastEventAt: Date | null, now: Date): string`.
  - **Existing**:
    - `formatUserDate(date, tz, dateFormat)`;
    - `dashboardHeaderCopy(status, serverNow, tz, timeFormat): { sentence: string; supporting: string | null }` (`src/lib/utils/dashboard-copy.ts:74`).
  - **T7/T8**:
    - every desktop and phone stage part carries `data-stage-section="header" | "due" | "done" | "later" | "chips" | "offer"`, exactly once per section per root;
    - Log now's pending label is `"Logging…"` (U+2026), as `DueCard.svelte:131` passes it;
    - the spinner's rotation is a `rotate(<deg>)` transform equal to `Frame.*.pending`;
    - T7's `StageDueCard` keeps every face's spinner span mounted, drawn as `rotate(0deg)` inside an `invisible` grid cell while not pending. So the tools below read a spinner angle only from an element that is actually drawn;
    - T7 hides the collapsed Due section with a `0fr` grid row whose item is `min-h-0 overflow-hidden`, so its section element keeps a layout box but is clipped to zero visible height. The tools measure the clipped (visible) rect for exactly this reason.
  - **T8**: `PhoneScene.svelte` keeps the device frame (`rounded-[48px]`) and the content box (`pt-[72px] pb-4`, overflow hidden), so the box is 820 − 72 − 16 = 732px.
  - **T9**: `WalkthroughVideo.svelte` keeps:
    - its one clock read, `origin = performance.now() - untrack(() => time) * 1000;`, inside its own `$effect` (line 74 at base), so the read's caller frame is in `WalkthroughVideo.svelte`;
    - its loop as `requestAnimationFrame(function step(now) …)`, with `time = ((now - origin) / 1000) % TOTAL_DURATION`;
    - the button's `aria-label` of `"Pause walkthrough"` / `"Play walkthrough"`;
    - the progress fill as `figure > div > div.h-1 > div`;
    - the accent default `"#4f46e5"`.
- Produces: nothing a later task consumes. This is the last task.

- [ ] **Step 1: Confirm the starting point and record the test counts**

Run, from `/Users/jamiewhite/Documents/Personal/Projects/medication-tracker/.claude/worktrees/affectionate-noether-23a5d8`:

```bash
test ! -e .env || { echo 'STOP: a .env already exists in this worktree; move it aside first'; exit 1; }
git status --short
git log --oneline -1
npx vitest run 2>&1 | tail -5
```

Expected:

- The guard prints nothing. `.env` is gitignored (`.gitignore:16`), so `git status` can never show it; this `test` is the only check that one is absent. If it prints `STOP: …`, stop here and report it. Do not move, edit or delete that file: it is not this task's, and Step 19 removes only the file Step 8 writes. Its owner moves it aside, and the task restarts at Step 1.
- `git status --short` prints nothing: in particular, no `tests/unit/zz-probe-*` files.
- `git log` shows T9's commit.
- vitest ends with `Test Files  N passed (N)` and `Tests  M passed (M)`, with no `failed`.

Write N and M down. They are T9's end state. This task adds no test, so both final runs in Step 22 must report the same N and M.

- [ ] **Step 2: Confirm the hooks the browser check relies on are in the code**

```bash
grep -n "origin = performance.now() - untrack(() => time) \* 1000;" src/lib/components/walkthrough/WalkthroughVideo.svelte
grep -n "requestAnimationFrame(function step" src/lib/components/walkthrough/WalkthroughVideo.svelte
grep -n '"Pause walkthrough" : "Play walkthrough"' src/lib/components/walkthrough/WalkthroughVideo.svelte
grep -n 'accent = "#4f46e5"' src/lib/components/walkthrough/WalkthroughVideo.svelte
grep -nE "^export const (T_LOG|T_TAP|REQUIRED_MARKS)" src/lib/components/walkthrough/timeline.ts
grep -nE "^export const (DESKTOP_BEFORE|DESKTOP_AFTER|PHONE_BEFORE|PHONE_AFTER|PHONE_LATER_ROWS)" src/lib/components/walkthrough/demo-dashboard.ts
grep -nE "^export (const (WALKTHROUGH_TZ|PHONE_NOW|DEMO_DOSES|STATUS_BREAKDOWN|SESSION_EXPIRIES))" src/lib/components/walkthrough/demo-data.ts
grep -n "export function lastLoggedPhrase" src/lib/utils/time.ts
grep -rn "data-stage-section" src/lib/components/walkthrough | wc -l
grep -cE 'rounded-\[48px\]|pt-\[72px\] pb-4' src/lib/components/walkthrough/scenes/PhoneScene.svelte
```

Expected:

- The first four greps print one line each. The seek stub (Step 12) depends on the first two: it serves the player's one `performance.now()` read and holds the function named `step`.
- The `timeline.ts` grep prints three lines.
- The `demo-dashboard.ts` grep prints five lines.
- The `demo-data.ts` grep prints five lines.
- The `time.ts` grep prints one line.
- The `wc -l` count is at least 1.
- The last count is at least 2.

If any grep comes back empty, an earlier task's contract is not met. Stop and report which one: the scripts below would fail with an unhelpful error rather than check anything.

- [ ] **Step 3: Add the walkthrough bullet to CLAUDE.md**

Edit `CLAUDE.md`, under `## Reusable Components`.

old_string (line 68, unique):

```markdown
- **`InsightsCard.svelte`** / **`StatusBreakdownBar.svelte`** / **`RefillsCard.svelte`** — analytics + dashboard surfaces; render nothing when their dataset is empty (don't wrap them in `{#if}` at the call site).
```

new_string:

```markdown
- **`InsightsCard.svelte`** / **`StatusBreakdownBar.svelte`** / **`RefillsCard.svelte`** — analytics + dashboard surfaces; render nothing when their dataset is empty (don't wrap them in `{#if}` at the call site).
- **The landing-page walkthrough (`src/lib/components/walkthrough/`) draws the dashboard; it never mounts it.** Its stage parts (`parts/dashboard/Stage*.svelte`) copy the real components' layout classes and reuse only their pure leaves — `MedicationGlyph`, `StatusMarker` and the copy helpers in `utils/dashboard-copy.ts` and `utils/time.ts`. The real `DueCard`, `DoseActionForm` and `QuickLogBar` are focusable and need the write lock, the dashboard clock, `use:enhance` and `$app/state`, and `DashboardHeader`, `DoneList` and `LaterList` render headings, landmarks, fixed ids and `tabindex="-1"` targets that would be duplicated across the desktop and the phone. The stage is `aria-hidden` and holds nothing focusable, and its motion comes only from `Frame` values, which are pure functions of T: no part carries an `animate-*` or `transition-*` class. **Three tests keep it honest, because a stale or broken scene fails silently.** `tests/unit/walkthrough-demo-facts.test.ts` holds the other scenes' hand-written facts — History's order, the Medications "Last taken" timers, the session expiry dates and the Analytics fold — to the one dose list, `DEMO_DOSES`. `tests/unit/walkthrough-dashboard-fidelity.test.ts` runs the real `composeDashboardPageData` at each story moment in `demo-dashboard.ts` (desktop and phone, before and after the log). It asserts that the scenes' data equals the composer's output and that their rendered text equals the copy helpers'. So a change to the dashboard's rules or wording fails there, instead of leaving the landing page advertising the old app — which is what happened when #170 rebuilt the dashboard and the walkthrough kept drawing the deleted one. Every key `computeFrame` reads must be listed in `REQUIRED_MARKS` (`timeline.ts`) and registered from mount, at every T, on exactly one element under its own root. `walkthrough-timeline.test.ts` records the reads through a `Proxy`, and `tests/unit/walkthrough-stage.svelte.test.ts` mounts the stage, checks the registry across the loop and fails on any focusable element. A missing mark throws nothing: the camera falls back to the wide shot and the cursor to the window centre. Marks are also measured only while the stage mounts, with T still on the title card, so an element drawn later is never measured. That is why a collapse or a new row is drawn with height, opacity or transform, never with an `{#if}` whose condition changes with T around a marked element; a payload-fixed condition such as `StageDueCard`'s `{#if row.logNow}` cannot change the registered set and is allowed.
```

- [ ] **Step 4: Correct the Added entry and add the Changed line to CHANGELOG.md**

First, the `### Added` walkthrough entry (line 23). It is in `[Unreleased]`, so as written it would ship naming two scenes this PR removes. Edit `CHANGELOG.md`.

old_string (unique):

```markdown
ten features on the demo account: My Day, Quick Log, the medications list,
```

new_string:

```markdown
ten features on the demo account: Today, Log now, the medications list,
```

Leave the rest of that entry as it is: the 43.5 seconds, the ten features and everything after them are still true.

Then the Changed line. Edit `CHANGELOG.md`.

old_string (unique; the end of line 40 and the next heading):

```markdown
`delete_dose` is unchanged and is not undoable.

### Fixed
```

new_string:

```markdown
`delete_dose` is unchanged and is not undoable.

- **The landing-page walkthrough shows the dashboard as it ships.** It was still drawing the dashboard from before the due-now rebuild — coloured Quick Log pills, a My Day timeline grouped by time of day, a summary strip — which is exactly what that rebuild took out. The desktop and phone scenes now show Today: the status header, a Due card whose Log now is the tap, Done today, Later today, the neutral "Log something else" chips and the single Undo offer. Every string on them comes from the helper the app itself renders it with, and a test checks them against the real dashboard composer. Captions and figures that had become false are corrected with it. No page groups doses by time of day or shows a next-due time, and reminders run on a half-hourly daytime sweep rather than Vercel Cron alone. The Analytics bar counts an untaken dose as Missed rather than Skipped, Dose History lists each day newest first, and session expiry dates are formatted as the app formats them. The accent is the one a new account gets, and the loop is described as "under a minute" rather than forty seconds.

### Fixed
```

- [ ] **Step 5: Add the Fixed line to CHANGELOG.md**

Edit `CHANGELOG.md`.

old_string (unique; the end of the last Fixed bullet and the next release heading):

```markdown
instead of as bright white OS widgets on a near-black page.

## [0.4.0] — Phase 4: polish, scheduling, demo, docs
```

new_string:

```markdown
instead of as bright white OS widgets on a near-black page.

- Overdue reminders no longer say "ago ago". The push body and the email both appended " ago" to a phrase that already ended in it. A reminder read "Last logged 1d ago ago", or "Last logged just now ago" for a dose logged moments earlier. Both now take the phrase from one helper, `lastLoggedPhrase` in `src/lib/utils/time.ts`, measured against the sweep's own clock. They read "Last logged 1d ago", "Last logged just now", or "Not yet logged" when nothing has been logged. The email for a medication never logged changes from "not logged yet" to "not yet logged" to match. Nothing could have caught it before: the push test checked a hand-written payload and the email test discarded what was sent. Both now assert on the real text.

## [0.4.0] — Phase 4: polish, scheduling, demo, docs
```

- [ ] **Step 6: Check the docs format and diff**

```bash
npx prettier --check CLAUDE.md CHANGELOG.md
git diff --stat
```

Expected:

- `All matched files use Prettier code style!`.
- `git diff --stat` shows `CHANGELOG.md | 4 +++-` and `CLAUDE.md | 1 +`, then `2 files changed, 4 insertions(+), 1 deletion(-)`. The one deletion is the old line 23.
- `git diff CHANGELOG.md | grep '^-' | grep -v '^--- a/'` prints exactly one line, the old line 23, starting `-- **The landing page has a product walkthrough.**`. (A dry run of Steps 3–5 against copies of both files at base gave exactly these stats and this line, and prettier left both copies unchanged.) Lines 39 and 83 also say "Quick Log", but about the in-app chip bar and its shortcuts, which still exist; they stay.

If prettier reports a file, run `npx prettier --write CLAUDE.md CHANGELOG.md`. Then re-read the diff to confirm prettier changed only whitespace in the new lines.

- [ ] **Step 7: Rules for the browser check (Steps 8–19)**

Read these before starting. Each one was found by running this check against base 311758f.

- **Run nothing else in this worktree while the check runs.** That means no `vitest`, no `npm run check` and no build. Each of them runs `svelte-kit sync`, which rewrites `.svelte-kit/generated/*`. Vite then logs `page reload .svelte-kit/generated/…` and reloads the page, which throws away the stubs. Then `__seek` is `undefined`, or a call ends with "The page navigated while this script was running". If that happens, go back to Step 10 with the next `?wt=N`.
- **A hidden Browser pane still works, with two consequences:**
  - The document reports `visibilityState === "hidden"`, which pauses the player. The seek stub reports `"visible"` instead.
  - IntersectionObserver only delivers on a rendering update, so the stage does not mount until something renders. A `computer` screenshot is a rendering update; Step 14 takes one for that reason.
- **Screenshots are scaled to the pane** (800px wide for a 1280px viewport), so judge legibility from the numbers.
  - `minPxPrimary` is the smallest rendered font size, in CSS pixels after every scale, of any shown text whose own size is 14px or more.
  - Use screenshots to judge composition: what is in frame, what is cut, and what overlaps.
- **The dev log prints one `{"level":"error","message":"unhandled server error",…,"status":404,…"path":"/favicon.ico"}` line per page load.** It predates this branch: there is no `/favicon.ico` route. It is not a failure of this check.
- **Each call to `__wtShot(name)` seeks to that shot's T and returns `{ name, T, pass, failures, details }`.** Shots must run in the listed order: `spinner` and `afterUpdate` compare against values `beforeTap` records.
- **Seeking must land on T exactly, and only a virtual clock does that.** The player recovers T as `((now − origin) / 1000) % 43.5`, with `origin` taken from a real `performance.now()` read. Replaying `step(origin + T × 1000)` against a real origin does not give T back. On base 311758f the player's start read was 6813.6000000238 ms, and that origin turned `T_LOG − 0.1` = 7.3500000000000005 into 7.35 and `T_LOG + 0.4` = 7.8500000000000005 into 7.85. A node probe at an origin of 123456.789 turned `CUES.Medications` = 10 into 9.999999999999986. Every one of those lands on the wrong side of a boundary: 7.85 is still inside the pending window, so the resume check would find a spinner, and 9.999… is still the LogNow shot, so `medicationsCut` would see the offer. The stub therefore answers the player's own read, and only that read, with `lastT × 1000`, so `origin` is exactly 0, and `step(T × 1000)` gives exactly T for every shot. It finds the player's read by its caller frame, which is in `WalkthroughVideo.svelte`. Every other `performance.now()` caller keeps the real clock. Verified on base: origin 0 at the first start and after a pause and resume, T = 10 shows the Medications page, and `T_LOG + 0.4` reads back as 7.8500000000000005.

- [ ] **Step 8: Write the throwaway `.env`**

```bash
lsof -nP -iTCP:5173 -sTCP:LISTEN
test ! -e .env || { echo 'STOP: a .env already exists in this worktree; move it aside first'; exit 1; }
(umask 077; printf '# walkthrough-check throwaway\nENCRYPTION_KEY=%s\nDATABASE_URL=%s\n' "$(openssl rand -base64 48)" 'postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' > .env)
head -1 .env
git check-ignore -v .env
git status --short
```

Expected:

- `lsof` prints nothing, so port 5173 is free.
- The guard prints nothing. If it prints `STOP: …`, a `.env` appeared after Step 1: stop and report it, exactly as Step 1 says, and write nothing.
- `head -1 .env` prints `# walkthrough-check throwaway`. That marker line is how Step 19 tells this file from a developer's: it deletes `.env` only when the marker is there.
- `git check-ignore` prints `.gitignore:16:.env	.env`.
- `git status --short` lists only ` M CHANGELOG.md` and ` M CLAUDE.md`. `.env` is not listed.

About the values:

- The marker is a dotenv comment. Vite's `loadEnv`, which SvelteKit's dev server uses to fill `$env/dynamic/private`, skips it: a probe of this exact `printf` returned `DATABASE_URL` and a 64-character `ENCRYPTION_KEY`, and no key from the comment line.
- The `DATABASE_URL` is CI's placeholder (`.github/workflows/ci.yml:59`). A signed-out `/` runs no query (`hooks.server.ts:21-26`), and `neon()` connects lazily.
- `ENCRYPTION_KEY` accepts any length (`auth/crypto.ts`). It only has to be non-empty, because `env.ts` throws at boot when it is empty.

- [ ] **Step 9: Start the dev server from the existing launch config**

Call `preview_start` with `{ "name": "dev" }`. Do not edit `.claude/launch.json`.

Expected: `Server started successfully on port 5173`. Then call `preview_logs` with `{ "serverId": "<id>", "search": "Missing required" }`. It must return no lines.

- [ ] **Step 10: Load `/` fresh at the desktop size**

1. Call `resize_window` with `{ "width": 1280, "height": 720, "colorScheme": "dark" }`.
2. Run `javascript_tool` with `scrollTo(0, 0); "ok"`.
3. Call `navigate` with `{ "url": "http://localhost:5173/?wt=1" }`.

A query string makes a new history entry, so SvelteKit does not restore a previous scroll position.

At 1280px wide, the player's top edge sits at about 1003px down the page. Why 720 high:

- The player starts once IntersectionObserver sees it within 200px of the viewport.
- At 720 that line is 920px, safely short of the player.
- At 800 the gap is 3.5px.

The stub has to be in place before the player starts, so that T begins at exactly 0.

- [ ] **Step 11: Prove the page is signed out**

`javascript_tool`:

```js
({
  title: document.title,
  walkthrough: !!document.querySelector('section[aria-labelledby="walkthrough-heading"] figure'),
});
```

Expected: `{ "title": "MedTracker — Personal Medication Tracker", "walkthrough": true }`.

Then call `preview_logs` with `{ "serverId": "<id>", "search": "\"path\":\"/\"" }`. It must return no lines.

Why this proves there was no session cookie:

- With any session cookie, `hooks.server.ts` calls `lucia.validateSession`.
- That queries the placeholder database, which cannot connect, so `/` would be a logged 500.
- A rendered landing page with no error logged for path `/` means no session cookie was sent.

- [ ] **Step 12: Install the seek stub (before the stage is in view)**

`javascript_tool`, exactly:

```js
(() => {
  const TOTAL = 43.5;
  if (window.__wt)
    return "ERROR: already installed on this page load - navigate to a fresh /?wt=N and rerun";
  const fig = document.querySelector('section[aria-labelledby="walkthrough-heading"] figure');
  if (!fig) return "ERROR: walkthrough figure not found";
  const box = fig.firstElementChild;
  const fill = box.querySelector(":scope > div.h-1 > div");
  const top = box.getBoundingClientRect().top;
  if (scrollY !== 0 || top <= innerHeight + 200 || fill.style.width !== "0%") {
    return `ERROR: the player may already have started (scrollY=${scrollY}, stage top=${top}, viewport+200=${innerHeight + 200}, progress=${fill.style.width}). Scroll to 0, use a shorter viewport, navigate to a fresh /?wt=N and rerun.`;
  }
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCaf = window.cancelAnimationFrame.bind(window);
  const STEP_HANDLE = -424242;
  const s = {
    origin: NaN,
    lastT: 0,
    step: null,
    inSeek: false,
    starts: 0,
    served: false,
    realAtStart: NaN,
  };
  // The player reads performance.now() once per start or resume, in its own
  // $effect: origin = performance.now() - time * 1000. That one read, and only
  // that one, gets a virtual clock standing at the current T, so origin is
  // exactly 0 and step(T * 1000) gives exactly T. It is found by its caller
  // frame (stack line 2), which is in WalkthroughVideo.svelte. Every other
  // caller gets the real clock.
  performance.now = function now() {
    const caller = (new Error().stack ?? "").split("\n")[2] ?? "";
    if (!/WalkthroughVideo\.svelte/.test(caller)) return realNow();
    s.served = true;
    s.realAtStart = realNow();
    return s.lastT * 1000;
  };
  window.requestAnimationFrame = (cb) => {
    // Only the player's own loop (`function step(now)` in WalkthroughVideo)
    // is held; every other caller gets a real frame.
    if (cb.name !== "step") return realRaf(cb);
    if (!s.inSeek) {
      // A start or a resume. The player has just read the clock; if it read
      // the virtual one, its origin is lastT * 1000 - time * 1000 = 0.
      s.starts += 1;
      s.origin = s.served ? 0 : NaN;
      s.served = false;
    }
    s.step = cb;
    return STEP_HANDLE;
  };
  window.cancelAnimationFrame = (h) => (h === STEP_HANDLE ? (s.step = null) : realCaf(h));
  // A hidden Browser pane reports "hidden", which pauses the player. Present
  // it as visible and tell the player.
  if (document.visibilityState !== "visible") {
    Object.defineProperty(document, "visibilityState", {
      get: () => "visible",
      configurable: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }
  window.__wt = s;
  window.__seek = async (T) => {
    if (!s.step)
      return "ERROR: the player is not running - is the stage in view, hydrated and not paused?";
    if (s.origin !== 0) {
      return "ERROR: the player's start did not read the virtual clock - no WalkthroughVideo.svelte frame was found in performance.now()'s caller";
    }
    // The player's own arithmetic with origin 0: ((now - 0) / 1000) % 43.5.
    const t = ((T * 1000) / 1000) % TOTAL;
    if (t !== T % TOTAL)
      return `ERROR: T=${T} does not survive the player's arithmetic; it would show T=${t}`;
    s.inSeek = true;
    try {
      s.step(T * 1000);
    } finally {
      s.inSeek = false;
    }
    s.lastT = t;
    await new Promise((r) => setTimeout(r, 50));
    // Chrome serialises the inline width to 6 significant digits ("17.5862%"),
    // so this is a sanity check on the frame having rendered, not the
    // exactness proof; the two checks above are.
    const got = parseFloat(fill.style.width);
    const want = (t / TOTAL) * 100;
    return Math.abs(got - want) < 1e-3
      ? `T=${T}`
      : `ERROR: progress ${got}% but T=${T} needs ${want}%`;
  };
  box.scrollIntoView({ block: "center" });
  return "installed";
})();
```

Expected: `"installed"`. Any `ERROR:` string says what to fix. Most often it is a page that already scrolled near the player: run Step 10 again with `?wt=2`, and use a shorter viewport if it repeats.

How it works:

- The player recovers T on every frame as `((now − origin) / 1000) % TOTAL_DURATION`, where `origin = performance.now() − time × 1000` is read once when it starts or resumes (`WalkthroughVideo.svelte`'s `$effect`).
- The stub answers that one read with `lastT × 1000`. Since the player's `time` equals `lastT` at every start and resume (both 0 at the first start; afterwards every seek sets both to the same exact T), `origin` is exactly 0.
- The stub holds the player's `step` callback without scheduling it. `__seek(T)` first checks that the player's arithmetic maps `T × 1000` back to exactly T, then calls `step(T × 1000)`. Every shot's T passes that check; a node probe of the same arithmetic found none that fails with origin 0.
- `__seek` refuses to run if the last start did not read the virtual clock (`origin` is then `NaN`). So a change that moves the player's clock read out of `WalkthroughVideo.svelte`, or a stack format that hides the caller, fails loudly instead of seeking approximately.
- Every other `performance.now()` and `requestAnimationFrame` caller gets the real clock and a real frame.
- `__wt.realAtStart` records the real clock at the player's start read, for the report.

- [ ] **Step 13: Install the measuring tools**

`javascript_tool`, exactly:

```js
(() => {
  if (!window.__wt) return "ERROR: install the seek stub first";
  const fig = document.querySelector('section[aria-labelledby="walkthrough-heading"] figure');
  const box = fig.firstElementChild;
  const stage = box.querySelector(':scope > div[aria-hidden="true"]');
  const button = box.querySelector("button");
  const all = (sel, root = stage) => [...root.querySelectorAll(sel)];
  const round = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
  const phone = () => all("div").find((d) => d.classList.contains("rounded-[48px]")) ?? null;
  const inPhone = (el) => phone()?.contains(el) ?? false;
  const view = () => {
    const b = box.getBoundingClientRect();
    const left = b.left + box.clientLeft;
    const top = b.top + box.clientTop;
    return { left, top, right: left + box.clientWidth, bottom: top + box.clientHeight };
  };
  const overlap = (r, o) =>
    Math.max(0, Math.min(r.right, o.right) - Math.max(r.left, o.left)) *
    Math.max(0, Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top));
  // The part of el that is not clipped away by an overflow-clipping ancestor.
  const visibleRect = (el) => {
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let n = el.parentElement; n && n !== box; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
      const a = n.getBoundingClientRect();
      left = Math.max(left, a.left);
      top = Math.max(top, a.top);
      right = Math.min(right, a.right);
      bottom = Math.min(bottom, a.bottom);
    }
    return { left, top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
  };
  const area = (r) => (r.right - r.left) * (r.bottom - r.top);
  const opacity = (el) => {
    if (getComputedStyle(el).visibility !== "visible") return 0;
    let o = 1;
    for (let n = el; n && n !== box; n = n.parentElement)
      o *= parseFloat(getComputedStyle(n).opacity);
    return o;
  };
  // Elements that hold text directly, the root included.
  const leaves = (root) =>
    [root, ...all("*", root)].filter((e) =>
      [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ""),
    );
  const shownLeaves = (root) =>
    leaves(root).filter((e) => opacity(e) >= 0.99 && area(visibleRect(e)) > 0);
  // Font size as drawn on screen: CSS size times every scale above it.
  const renderedPx = (e) =>
    e.offsetHeight > 0
      ? parseFloat(getComputedStyle(e).fontSize) *
        (e.getBoundingClientRect().height / e.offsetHeight)
      : NaN;
  const captionRect = () => {
    const outer = stage.querySelector(".pointer-events-none.bottom-16");
    return outer && opacity(outer) > 0 ? outer.firstElementChild.getBoundingClientRect() : null;
  };
  const windowLayer = () =>
    all("div").find(
      (d) => /translate\(/.test(d.style.transform) && /scale\(/.test(d.style.transform),
    );
  const section = (name, where) => {
    const els = all(`[data-stage-section="${name}"]`).filter(
      (e) => (where === "phone") === inPhone(e),
    );
    if (els.length !== 1) throw new Error(`${els.length} "${name}" sections on the ${where}`);
    return els[0];
  };
  // The 44px-or-taller box around the first shown "Log now" / "Logging…" label in a section.
  const logNowBox = (root) => {
    let el = leaves(root).find(
      (e) => opacity(e) >= 0.5 && /^(Log now|Logging…)$/.test(e.textContent.trim()),
    );
    while (el && el !== root && el.offsetHeight < 44) el = el.parentElement;
    return el ?? null;
  };

  window.__wtReport = (names, where = "desk") => {
    const v = view();
    const cap = captionRect();
    const btn = button.getBoundingClientRect();
    const m = windowLayer()?.style.transform.match(/scale\(([\d.]+)\)/);
    const out = {
      T: round(window.__wt.lastT),
      cameraScale: m ? round(+m[1]) : null,
      captionShown: !!cap,
    };
    for (const name of names) {
      const el = section(name, where);
      const r = el.getBoundingClientRect();
      const vis = visibleRect(el);
      const shown = shownLeaves(el);
      const px = shown.map(renderedPx).filter(Number.isFinite);
      const primary = shown
        .filter((e) => parseFloat(getComputedStyle(e).fontSize) >= 14)
        .map(renderedPx)
        .filter(Number.isFinite);
      out[name] = {
        opacity: round(opacity(el)),
        layoutHeightPx: round(r.height),
        visibleHeightPx: round(vis.bottom - vis.top),
        onCamera: area(vis) > 0 ? round(overlap(vis, v) / area(vis)) : 0,
        underCaption: cap ? round(overlap(vis, cap)) : 0,
        underButton: round(overlap(vis, btn)),
        minPxPrimary: primary.length ? round(Math.min(...primary)) : null,
        minPxAll: px.length ? round(Math.min(...px)) : null,
        // Shown text that the lower third or the pause button sits on top of.
        coveredText: shown
          .filter((e) => {
            const lv = visibleRect(e);
            return (cap && overlap(lv, cap) > 0) || overlap(lv, btn) > 0;
          })
          .map((e) => e.textContent.trim()),
        text: shown.map((e) => e.textContent.trim()),
      };
    }
    return out;
  };

  // Log now on the desktop or the phone: its label, its layout width, and the spinner angle if drawn.
  // StageDueCard keeps the idle spinner mounted at rotate(0deg) inside an
  // `invisible` cell, so only a drawn element's transform counts.
  window.__wtLogNow = (where = "desk") => {
    const due = section("due", where);
    const b = logNowBox(due);
    const rotated = (b ? [b, ...all("*", b)] : [])
      .filter((e) => opacity(e) > 0)
      .map((e) => (e.style?.transform || "") + " " + (e.getAttribute("transform") || ""))
      .map((t) => t.match(/rotate\(\s*([-\d.e]+)/))
      .find(Boolean);
    return {
      label: b
        ? shownLeaves(b)
            .map((e) => e.textContent.trim())
            .join(" ")
        : null,
      widthPx: b ? b.offsetWidth : null,
      spinnerDeg: rotated ? round(parseFloat(rotated[1])) : null,
    };
  };

  // Whether the desktop cursor's tip sits on the desktop Log now box.
  window.__wtCursorOnLogNow = () => {
    const svg = all("svg").find((s) => s.querySelector('path[d^="M3 2 L3 25"]'));
    const win = windowLayer();
    const b = logNowBox(section("due", "desk"));
    if (!svg || !win || !b) return { cursor: !!svg, logNow: !!b, onTarget: false };
    const w = win.getBoundingClientRect();
    const k = w.width / 1440;
    const tip = {
      x: w.left + (parseFloat(svg.style.left) + 3) * k,
      y: w.top + (parseFloat(svg.style.top) + 2) * k,
    };
    const r = b.getBoundingClientRect();
    return {
      cursor: true,
      logNow: true,
      onTarget: tip.x >= r.left && tip.x <= r.right && tip.y >= r.top && tip.y <= r.bottom,
    };
  };

  // Review Focus 5: Log now inside the phone's content box and above the home
  // indicator, and no shown text cut by the box's clip edge. Device pixels, so
  // the answer is the same at every container width.
  window.__wtPhone = () => {
    const dev = phone();
    if (!dev) throw new Error("phone frame not found");
    const d = dev.getBoundingClientRect();
    const k = d.height / 874;
    const y = (r) => ({ top: round((r.top - d.top) / k), bottom: round((r.bottom - d.top) / k) });
    const content = all("div", dev).find((e) => {
      const cs = getComputedStyle(e);
      return cs.paddingTop === "72px" && cs.paddingBottom === "16px" && cs.overflowY === "hidden";
    });
    if (!content) throw new Error("phone content box not found");
    const c = y(content.getBoundingClientRect());
    const contentTop = round(c.top + 72);
    const clipBottom = c.bottom;
    const indicatorTop = 874 - 34;
    const b = logNowBox(section("due", "phone"));
    const ln = b ? y(b.getBoundingClientRect()) : null;
    const cutRows = leaves(content)
      .filter((e) => opacity(e) > 0.05)
      .map((e) => ({
        text: e.textContent.trim(),
        section: e.closest("[data-stage-section]")?.getAttribute("data-stage-section") ?? null,
        ...y(e.getBoundingClientRect()),
      }))
      .filter((r) => r.top < clipBottom - 0.5 && r.bottom > clipBottom + 0.5);
    const logNowInside = !!ln && ln.top >= contentTop - 0.5 && ln.bottom <= indicatorTop + 0.5;
    return {
      contentTop,
      clipBottom,
      indicatorTop,
      logNow: ln,
      logNowInside,
      cutRows,
      pass: logNowInside && cutRows.length === 0,
    };
  };

  // Every CSS animation or transition running anywhere in the stage. Must be [].
  window.__wtAnimations = () =>
    stage
      .getAnimations({ subtree: true })
      .map((a) => a.animationName ?? a.transitionProperty ?? "animation");

  // Focusable elements in the stage. Must be 0.
  window.__wtFocusable = () =>
    stage.querySelectorAll(
      "a[href], area[href], button, input, select, textarea, summary, details, iframe, audio[controls], video[controls], [contenteditable], [tabindex]",
    ).length;

  // The shown leaf texts of the first element whose own text is exactly `label`, climbed `up` levels.
  window.__wtTextNear = (label, up = 1) => {
    let el = leaves(stage).find((e) => !inPhone(e) && e.textContent.trim() === label);
    for (let i = 0; el && i < up; i++) el = el.parentElement;
    return el ? leaves(el).map((e) => e.textContent.trim()) : null;
  };

  // Top of the first element whose own text matches, in the fake browser
  // window's coordinates. clampCamera never frames below WIN_H = 984.
  window.__wtWindowY = (re) => {
    const el = leaves(stage).find((e) => !inPhone(e) && re.test(e.textContent.trim()));
    const w = windowLayer().getBoundingClientRect();
    return el ? round((el.getBoundingClientRect().top - w.top) / (w.width / 1440)) : null;
  };

  // History's unfiltered Yesterday group: its times in order, and the first two on screen.
  window.__wtHistoryYesterday = () => {
    const title = leaves(stage).find((e) => !inPhone(e) && e.textContent.trim() === "Dose History");
    const page = title?.closest(".p-8");
    const label = page && leaves(page).find((e) => e.textContent.trim() === "Yesterday");
    const group = label?.parentElement?.parentElement;
    if (!group) throw new Error("History's Yesterday group not found");
    const clock = /^\d{1,2}:\d{2}$/;
    const minutes = (t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]);
    const timeLeaves = leaves(group).filter((e) => clock.test(e.textContent.trim()));
    const times = timeLeaves.map((e) => e.textContent.trim());
    const cap = captionRect();
    const v = view();
    return {
      times,
      newestFirst: times.every((t, i) => i === 0 || minutes(times[i - 1]) >= minutes(t)),
      firstTwo: timeLeaves.slice(0, 2).map((e) => {
        const vis = visibleRect(e);
        return {
          text: e.textContent.trim(),
          onCamera: area(vis) > 0 ? round(overlap(vis, v) / area(vis)) : 0,
          underCaption: cap ? round(overlap(vis, cap)) : 0,
          px: round(renderedPx(e)),
        };
      }),
    };
  };

  return "tools installed";
})();
```

Expected: `"tools installed"`.

- [ ] **Step 14: Bring the stage into view and wait for it to settle at T = 0**

1. Call `computer` with `{ "action": "screenshot", "scale": 0.3 }`. In a hidden pane this is what lets IntersectionObserver deliver.
2. Then `javascript_tool`:

```js
for (let i = 0; i < 50 && !window.__wt.step; i++) await new Promise((r) => setTimeout(r, 100));
// The player remeasures its marks 300ms and 1200ms after mounting; let both land while T is still 0.
await new Promise((r) => setTimeout(r, 1500));
const fig = document.querySelector('section[aria-labelledby="walkthrough-heading"] figure');
({
  starts: window.__wt.starts,
  origin: window.__wt.origin,
  realAtStart: window.__wt.realAtStart,
  running: !!window.__wt.step,
  label: fig.querySelector("button").getAttribute("aria-label"),
  figureWidth: Math.round(fig.getBoundingClientRect().width),
  progress: fig.firstElementChild.querySelector(":scope > div.h-1 > div").style.width,
});
```

Expected: `{ "starts": 1, "origin": 0, "realAtStart": <a few thousand ms>, "running": true, "label": "Pause walkthrough", "figureWidth": 1024, "progress": "0%" }`. On base 311758f this returned `starts: 1`, `origin: 0`, `realAtStart: 6813.600000023842`, `running: true`, `"Pause walkthrough"`, `figureWidth: 1024` and `"0%"`.

On `running: false`, take another screenshot and run the snippet again.

If `starts` is anything but 1, go back to Step 10 with the next `?wt=N`.

If `origin` is `NaN`, the player's clock read was not recognised: Step 2's first grep must still find the read in `WalkthroughVideo.svelte`. Stop and report rather than seeking against a real origin (Step 7 says why).

Production measures the marks while T is between 0 and 1.2s. Here they are measured with T held at exactly 0, which is inside that window.

- [ ] **Step 15: Install the shot list**

`javascript_tool`, exactly:

```js
await (async () => {
  if (!window.__wtReport) return "ERROR: install the tools first";
  // The real modules, from the dev server, so every expectation is computed by
  // the same code (and the same browser ICU) the stage renders with.
  const { CUES, T_LOG, T_TAP } = await import("/src/lib/components/walkthrough/timeline.ts");
  const copy = await import("/src/lib/utils/dashboard-copy.ts");
  const time = await import("/src/lib/utils/time.ts");
  const demo = await import("/src/lib/components/walkthrough/demo-data.ts");
  const moments = await import("/src/lib/components/walkthrough/demo-dashboard.ts");
  const TZ = demo.WALKTHROUGH_TZ;
  const TF = "24h"; // WalkthroughVideo's default; +page.svelte passes no props.
  const header = (m) => {
    const c = copy.dashboardHeaderCopy(m.status, m.now, TZ, TF);
    return [c.sentence, c.supporting].filter(Boolean);
  };
  const want = {
    deskBefore: header(moments.DESKTOP_BEFORE),
    deskAfter: header(moments.DESKTOP_AFTER),
    phoneBefore: header(moments.PHONE_BEFORE),
    phoneAfter: header(moments.PHONE_AFTER),
  };
  const vitdLast = demo.DEMO_DOSES.filter(
    (d) => d.medicationId === "vitd" && d.takenAt.getTime() < demo.PHONE_NOW.getTime(),
  ).reduce((a, d) => (a === null || d.takenAt > a ? d.takenAt : a), null);
  want.banner = time.lastLoggedPhrase(vitdLast, demo.PHONE_NOW);
  const sb = demo.STATUS_BREAKDOWN;
  want.analytics = [
    `Taken ${sb.takenEvents}`,
    `Skipped ${sb.skippedEvents}`,
    `Missed ${sb.missedEvents}`,
    `${sb.expectedTotal} expected`,
  ];
  want.security = demo.SESSION_EXPIRIES.map(
    (d) => `Expires ${time.formatUserDate(d, TZ, "DD/MM/YYYY")}`,
  );

  const stage = document.querySelector(
    'section[aria-labelledby="walkthrough-heading"] figure > div > div[aria-hidden="true"]',
  );
  const texts = (root) =>
    [root, ...root.querySelectorAll("*")]
      .filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== ""))
      .map((e) => e.textContent.trim());
  const card = (title) =>
    [...stage.querySelectorAll("p")]
      .find((p) => p.textContent.trim() === title)
      ?.closest(".rounded-xl");
  const phoneFrame = () =>
    [...stage.querySelectorAll("div")].find((d) => d.classList.contains("rounded-[48px]"));
  const has = (shown, list) => list.every((w) => shown.includes(w));
  const state = { logNowWidth: null, doneRows: null };

  // Every section the shot is about: fully on camera, fully opaque, no text
  // under the lower third or the pause button, primary text at least minPx.
  const framed = (f, rep, names, minPx) => {
    for (const n of names) {
      const s = rep[n];
      if (s.onCamera < 0.999) f.push(`${n} is not fully on camera (${s.onCamera})`);
      if (s.opacity < 0.999) f.push(`${n} opacity is ${s.opacity}`);
      if (s.coveredText.length) f.push(`${n} text is covered: ${s.coveredText.join(" | ")}`);
      if (minPx > 0 && !(s.minPxPrimary >= minPx))
        f.push(`${n} primary text is ${s.minPxPrimary}px, below ${minPx}px`);
    }
  };

  const SHOTS = {
    todayOpening: [
      CUES.Today + 1.1,
      (f, px) => {
        const r = __wtReport(["header", "due"]);
        framed(f, r, ["header", "due"], px.desk);
        if (!has(r.header.text, want.deskBefore))
          f.push(`header shows ${JSON.stringify(r.header.text)}`);
        return r;
      },
    ],
    panEnd: [
      CUES.LogNow - 0.05,
      (f, px) => {
        const r = __wtReport(["chips"]);
        framed(f, r, ["chips"], px.desk);
        return r;
      },
    ],
    beforeTap: [
      T_LOG - 0.1,
      (f, px) => {
        const r = __wtReport(["header", "due", "done", "offer"]);
        framed(f, r, ["header", "due", "done"], px.desk);
        if (r.offer.opacity !== 0) f.push(`offer opacity ${r.offer.opacity} before the tap`);
        const ln = __wtLogNow("desk");
        if (ln.label !== "Log now" || ln.spinnerDeg !== null)
          f.push(`Log now reads ${JSON.stringify(ln)}`);
        if (!__wtCursorOnLogNow().onTarget) f.push("the cursor tip is not on Log now");
        state.logNowWidth = ln.widthPx;
        state.doneRows = r.done.text.length;
        return { ...r, logNow: ln };
      },
    ],
    spinner: [
      T_LOG + 0.2,
      (f, px) => {
        const r = __wtReport(["due"]);
        framed(f, r, ["due"], px.desk);
        const ln = __wtLogNow("desk");
        const deg = ((360 * (window.__wt.lastT - T_LOG)) / 0.75) % 360;
        if (ln.label !== "Logging…") f.push(`pending label is ${JSON.stringify(ln.label)}`);
        if (!(Math.abs(ln.spinnerDeg - deg) < 0.05))
          f.push(`spinner at ${ln.spinnerDeg}deg, expected ${deg}`);
        if (ln.widthPx !== state.logNowWidth)
          f.push(`Log now is ${ln.widthPx}px wide, was ${state.logNowWidth}px`);
        return { ...r, logNow: ln };
      },
    ],
    afterUpdate: [
      T_LOG + 0.7,
      (f, px) => {
        const r = __wtReport(["header", "due", "done"]);
        framed(f, r, ["header", "done"], px.desk);
        if (r.due.visibleHeightPx >= 1) f.push(`Due section still ${r.due.visibleHeightPx}px tall`);
        if (!has(r.header.text, want.deskAfter))
          f.push(`header shows ${JSON.stringify(r.header.text)}`);
        if (want.deskBefore[0] !== want.deskAfter[0] && r.header.text.includes(want.deskBefore[0]))
          f.push("old header still shown");
        if (!(r.done.text.length > state.doneRows))
          f.push(`Done shows ${r.done.text.length} strings, ${state.doneRows} before the tap`);
        return r;
      },
    ],
    offerFraming: [
      T_LOG + 1.5,
      (f, px) => {
        const r = __wtReport(["offer"]);
        framed(f, r, ["offer"], px.desk);
        if (!r.offer.text.includes("Undo")) f.push(`offer reads ${JSON.stringify(r.offer.text)}`);
        return r;
      },
    ],
    offerHeld: [
      CUES.Medications - 0.05,
      (f, px) => {
        const r = __wtReport(["offer"]);
        framed(f, r, ["offer"], px.desk);
        if (r.offer.opacity !== 1) f.push(`offer opacity ${r.offer.opacity} just before the cut`);
        return r;
      },
    ],
    medicationsCut: [
      CUES.Medications,
      (f) => {
        const r = __wtReport(["offer"]);
        if (r.offer.opacity !== 0) f.push(`offer opacity ${r.offer.opacity} at the cut`);
        return r;
      },
    ],
    historyYesterday: [
      CUES.History + 1.2,
      (f, px) => {
        const h = __wtHistoryYesterday();
        if (!h.newestFirst) f.push(`Yesterday is not newest first: ${h.times.join(", ")}`);
        for (const t of h.firstTwo) {
          if (t.onCamera < 0.999 || t.underCaption > 0)
            f.push(`${t.text} is off camera or under the caption`);
          if (px.desk > 0 && !(t.px >= px.desk)) f.push(`${t.text} renders at ${t.px}px`);
        }
        return h;
      },
    ],
    analytics: [
      CUES.Analytics + 1.0,
      (f) => {
        const c = card("Dose Status Breakdown");
        const shown = c ? texts(c) : [];
        if (!has(shown, want.analytics))
          f.push(`bar reads ${JSON.stringify(shown)}, expected ${JSON.stringify(want.analytics)}`);
        const missed =
          c && [...c.querySelectorAll(".bg-danger")].some((e) => parseFloat(e.style.width) > 0);
        if (sb.missedEvents > 0 && !missed) f.push("no red Missed segment is drawn");
        return { windowY: __wtWindowY(/^Dose Status Breakdown$/), shown };
      },
    ],
    security: [
      CUES.Security + 1.5,
      (f) => {
        const c = card("Active Sessions");
        const shown = c ? texts(c) : [];
        if (!has(shown, want.security))
          f.push(
            `sessions read ${JSON.stringify(shown)}, expected ${JSON.stringify(want.security)}`,
          );
        return { windowY: __wtWindowY(/^Expires /), shown };
      },
    ],
    phoneBanner: [
      CUES.Reminders + 1.5,
      (f) => {
        const shown = texts(phoneFrame());
        if (!shown.includes(want.banner))
          f.push(`banner body is not ${JSON.stringify(want.banner)}`);
        return { banner: want.banner };
      },
    ],
    phoneBefore: [
      T_TAP - 0.3,
      (f, px) => {
        const r = __wtReport(["header", "due"], "phone");
        framed(f, r, ["header", "due"], px.phone);
        if (!has(r.header.text, want.phoneBefore))
          f.push(`phone header shows ${JSON.stringify(r.header.text)}`);
        const g = __wtPhone();
        if (!g.pass) f.push(`phone geometry: ${JSON.stringify(g)}`);
        return { ...r, geometry: g };
      },
    ],
    phoneAfter: [
      T_TAP + 1.0,
      (f, px) => {
        const r = __wtReport(["header", "due", "done", "offer"], "phone");
        framed(f, r, ["header", "done", "offer"], px.phone);
        if (r.due.visibleHeightPx >= 1)
          f.push(`phone Due card still ${r.due.visibleHeightPx}px tall`);
        if (!has(r.header.text, want.phoneAfter))
          f.push(`phone header shows ${JSON.stringify(r.header.text)}`);
        if (!r.offer.text.includes("Undo"))
          f.push(`phone offer reads ${JSON.stringify(r.offer.text)}`);
        // The collapse moves everything below the card up by about 120px, so a
        // Later row that sat wholly below the clip edge before the tap can
        // straddle it now. Log now itself is collapsed here, so only the cut
        // check applies.
        const g = __wtPhone();
        if (g.cutRows.length) f.push(`phone rows cut after the tap: ${JSON.stringify(g.cutRows)}`);
        return { ...r, geometry: g };
      },
    ],
    phoneOfferHeld: [
      CUES.Outro - 0.05,
      (f) => {
        const r = __wtReport(["offer"], "phone");
        if (r.offer.opacity !== 1)
          f.push(`phone offer opacity ${r.offer.opacity} just before the Outro`);
        return r;
      },
    ],
  };

  window.__wtMinPx = { desk: 9, phone: 8 };
  window.__wtShot = async (name) => {
    const [T, run] = SHOTS[name] ?? [];
    if (run === undefined) throw new Error(`no shot named ${name}`);
    const seek = await __seek(T);
    if (seek.startsWith("ERROR")) return { name, pass: false, failures: [seek] };
    const failures = [];
    const details = run(failures, window.__wtMinPx);
    const animations = __wtAnimations();
    if (animations.length) failures.push(`CSS animations running: ${animations.join(", ")}`);
    if (__wtFocusable() !== 0) failures.push(`${__wtFocusable()} focusable elements in the stage`);
    return { name, T, pass: failures.length === 0, failures, details };
  };
  return { shots: Object.keys(SHOTS), want };
})();
```

Expected: an object `{ shots, want }`. `shots` lists these 15 names:

1. `todayOpening`
2. `panEnd`
3. `beforeTap`
4. `spinner`
5. `afterUpdate`
6. `offerFraming`
7. `offerHeld`
8. `medicationsCut`
9. `historyYesterday`
10. `analytics`
11. `security`
12. `phoneBanner`
13. `phoneBefore`
14. `phoneAfter`
15. `phoneOfferHeld`

`want` holds the expected strings:

- the four header copies;
- the banner phrase;
- the Analytics labels;
- the Security expiry lines.

They are computed by the real helpers in this browser, so this is also a check that the browser's ICU agrees with the stage. Copy `want` into the task report.

The pass thresholds are `window.__wtMinPx = { desk: 9, phone: 8 }`. The reasons:

- **The desktop floor of 9px** is above the ~6px the spec rejects for a header-plus-offer framing (Section 1). It is also below the 11.7–14.2px the shipped shots measure in this container (History rows 11.7px, Quick Log pills 13.2–14.2px), so it fails only a framing markedly smaller than any shot that ships today.
- **The phone's 8px** is set by the phone's own fixed scale: 14px × 1.08 × 1022/1920 = 8.05px. This PR does not change that scale.

- [ ] **Step 16: Take the desktop and phone shots at the 1024px container (Review Focus 5 is `phoneBefore`)**

For each row, in order:

1. Run `javascript_tool` with `await __wtShot("<name>")`. It must return `"pass": true`.
2. Then call `computer` with `{ "action": "screenshot" }`.
3. Confirm the screenshot shows what the row says.
4. Record the returned JSON in the task report, with `details.*.minPxPrimary` and `cameraScale`, together with the screenshot's file path from the tool result.

| #   | name               | T (s)                              | the screenshot must show                                                                                                                                                                                                                                |
| --- | ------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `todayOpening`     | `CUES.Today + 1.1` = 3.6           | The header: date eyebrow, "Today", and the BEFORE status sentence and supporting line. Lisinopril's Due card with its filled Log now. Caption 01 "Today" bottom-left, overlapping neither.                                                              |
| 2   | `panEnd`           | `CUES.LogNow − 0.05` = 5.95        | "Log something else" and every neutral chip (`−`, capsule glyph with name and dose, `+`), readable, none under the caption.                                                                                                                             |
| 3   | `beforeTap`        | `T_LOG − 0.1` = 7.3500000000000005 | Header, Due card and Done today in one frame, the cursor tip on Log now, and no offer.                                                                                                                                                                  |
| 4   | `spinner`          | `T_LOG + 0.2` = 7.65               | Log now showing the spinner and "Logging…" at the width it had in row 3. The spinner is at 96°.                                                                                                                                                         |
| 5   | `afterUpdate`      | `T_LOG + 0.7` = 8.15               | The Due section gone, the header showing the AFTER copy, and Done today with the new Lisinopril row and its covers line.                                                                                                                                |
| 6   | `offerFraming`     | `T_LOG + 1.5` = 8.95               | The Undo offer framed on its own: message, underlined "Undo" and "×", all readable.                                                                                                                                                                     |
| 7   | `offerHeld`        | `CUES.Medications − 0.05` = 9.95   | The same offer on the last frame before the cut.                                                                                                                                                                                                        |
| 8   | `medicationsCut`   | `CUES.Medications` = 10            | The Medications page, with no offer anywhere.                                                                                                                                                                                                           |
| 9   | `historyYesterday` | `CUES.History + 1.2` = 22.2        | Yesterday's first two rows, with their times newest first (22:14 above 22:05 in the story). The names sit under the lower third in this shot, as they always have; the times on the right are clear.                                                    |
| 10  | `analytics`        | `CUES.Analytics + 1.0` = 25.5      | The stat cards. `details.windowY` is expected above 984 — see below.                                                                                                                                                                                    |
| 11  | `security`         | `CUES.Security + 1.5` = 30         | The two-factor card. `details.windowY` is expected above 984.                                                                                                                                                                                           |
| 12  | `phoneBanner`      | `CUES.Reminders + 1.5` = 37        | The "Vitamin D overdue" push banner fully in, with the body equal to `want.banner`.                                                                                                                                                                     |
| 13  | `phoneBefore`      | `T_TAP − 0.3` = 38.2               | The phone at 10:12: the header, Vitamin D's amber overdue card with Log now, Took it at and Skip, the fingertip arriving on Log now, Done today, and the Later prefix. No row is cut at the bottom. `details.geometry.pass` is `true` (Review Focus 5). |
| 14  | `phoneAfter`       | `T_TAP + 1.0` = 39.5               | The card gone, the header showing the AFTER copy, the 10:12 Vitamin D row in Done, and the offer at the bottom of the phone.                                                                                                                            |
| 15  | `phoneOfferHeld`   | `CUES.Outro − 0.05` = 40.45        | The phone offer still shown on the last phone frame.                                                                                                                                                                                                    |

The T values are those of the real `timeline.ts`, computed in the browser by the same module the stage uses. A node probe of base 311758f's `timeline.ts`, with the pre-rename names (`CUES.MyDay` = 2.5, `CUES.QuickLog` = 6, so the same `T_LOG` = 7.45 and `T_TAP` = 38.5), gave exactly 3.6, 5.95, 7.3500000000000005, 7.65, 8.15, 8.95, 9.95, 10, 22.2, 25.5, 30, 37, 38.2, 39.5 and 40.45. The returned `T` field shows these doubles, so row 3 reports `7.3500000000000005`; that is the exact value, not a seek error. At 37 the banner's `bannerY` is 0, fully in; at 38.2 it is −170, gone.

**Rows 10 and 11 cannot be screenshots of the element, and this is expected.** Measured on base 311758f at 1280×720:

- the Dose Status Breakdown title sits at fake-window y = 1106;
- Security's first "Expires" line sits at y = 1000.

Both are below the 984px fake browser window (`WIN_H`). `clampCamera` never frames below 984, so neither is on screen at any T. Their shots therefore check the DOM text instead:

- the bar labels equal `STATUS_BREAKDOWN`, and a red `bg-danger` segment is drawn when `missedEvents > 0`;
- each expiry line equals `Expires ${formatUserDate(d, "UTC", "DD/MM/YYYY")}`.

Record `windowY` in the report. If `windowY` is 984 or less, the element can now reach the frame. Then seek every 0.5s across that scene and screenshot the T where it is on camera. Do not change any framing.

**If a row fails**, read `failures`:

- **Only `phone geometry`** (row 13), or **only `phone rows cut after the tap`** (row 14) → Step 20.
- **Only `primary text is …px, below …px`** on a desktop row → Step 21.
- **Anything else** is a defect in an earlier task's work, not a tunable:
  - `not fully on camera`;
  - `text is covered`;
  - a wrong header or offer text;
  - offer timing;
  - the spinner;
  - `CSS animations running`;
  - focusable elements;
  - History not newest first;
  - the Analytics or Security text.

  Stop. Do not commit. Report the shot JSON and the screenshot.

- [ ] **Step 17: Check the pause button at the spinner frame**

1. Run `javascript_tool` with `await __wtShot("spinner")`. It must pass.
2. Call `find` with `{ "query": "Pause walkthrough" }`.
3. Call `computer` with `{ "action": "left_click", "ref": "<ref>", "action_summary": "Pauses the walkthrough" }`.
4. Then `javascript_tool`:

```js
const fig = document.querySelector('section[aria-labelledby="walkthrough-heading"] figure');
const btn = fig.querySelector("button");
const fill = fig.firstElementChild.querySelector(":scope > div.h-1 > div");
const before = JSON.stringify({ logNow: __wtLogNow("desk"), progress: fill.style.width });
await new Promise((r) => setTimeout(r, 600));
({
  label: btn.getAttribute("aria-label"),
  running: !!window.__wt.step,
  focused: document.activeElement === btn,
  frozen: before === JSON.stringify({ logNow: __wtLogNow("desk"), progress: fill.style.width }),
  animations: __wtAnimations(),
  progress: fill.style.width,
});
```

Expected: `{ "label": "Play walkthrough", "running": false, "focused": true, "frozen": true, "animations": [], "progress": "17.5862%" }`.

`"17.5862%"` is Chrome's 6-significant-digit serialisation of 7.65 / 43.5 × 100 = 17.586206896551726. The same pause on base 311758f, at the same T, returned `"17.5862%"` with no animation running.

- Pausing cancels the player's frame.
- The spinner holds its T-derived angle, with no CSS animation turning it.
- Keyboard focus stays on the button, whose label now offers to play.

If the click tool cannot reach a hidden pane, use `btn.click()` instead. Then ignore `focused`, because a script click does not move focus.

Next:

1. Call `find` with `{ "query": "Play walkthrough" }`.
2. Call `computer` with `{ "action": "left_click", "ref": "<ref>", "action_summary": "Resumes the walkthrough" }`.
3. Then `javascript_tool`:

```js
const { T_LOG } = await import("/src/lib/components/walkthrough/timeline.ts");
const fig = document.querySelector('section[aria-labelledby="walkthrough-heading"] figure');
({
  label: fig.querySelector("button").getAttribute("aria-label"),
  running: !!window.__wt.step,
  starts: window.__wt.starts,
  origin: window.__wt.origin,
  seek: await __seek(T_LOG + 0.4),
  logNow: __wtLogNow("desk"),
});
```

Expected:

- `label: "Pause walkthrough"`, `running: true`, `starts: 2` and `origin: 0`. The resume read the virtual clock too, so seeking stays exact after it;
- `seek` is exactly `"T=7.8500000000000005"`;
- `logNow` is `{ "label": "Log now", "spinnerDeg": null, "widthPx": <row 3's width> }`.

At exactly `T_LOG + 0.4` the pending window `[T_LOG, T_LOG + 0.4)` has closed, so a pause or resume around the log leaves no spinner behind. `logged` is still 0, so Log now is fully visible. This is the check a real-origin seek gets wrong: on base 311758f the player's real start read was 6813.6000000238 ms, and replaying `step(origin + 7850.000000000001)` gives back 7.85, which is still inside the pending window. On base, the same pause and resume returned `starts: 2`, `origin: 0`, and a following `__seek(10)` returned `"T=10"` with the Medications page shown.

- [ ] **Step 18: Repeat the shots at the 375px container**

1. Call `resize_window` with `{ "preset": "mobile" }`.
2. Run `javascript_tool` with `scrollTo(0, 0); "ok"`.
3. Call `navigate` with `{ "url": "http://localhost:5173/?wt=2" }`. If `?wt=2` was already used in Step 10, take the next unused N.
4. Re-run Step 12 (seek stub), Step 13 (tools) and Step 14 (screenshot, then the wait snippet).
   - At this size the player is about 1319px down an 812px viewport, so the stub's guard passes.
   - Expect `figureWidth: 343`.
5. Re-run Step 15 (shot list).
6. Then `javascript_tool` with `window.__wtMinPx = { desk: 0, phone: 0 }; "ok"`.

Run all 15 shots in the same order, with a screenshot after each, exactly as in Step 16. Every shot must pass.

The camera geometry scales uniformly with the container, so `onCamera`, the caption overlap and `details.geometry` come out the same at both sizes. Two things are genuinely different here:

- the pause button keeps a fixed 32px, so it covers about 9% of the stage's width instead of 4%. A subject near the top right can be covered here and not at 1024. `coveredText` reports it.
- every font is drawn at 341/1022 of its 1024 size.

The 1920px stage in a 343px slot draws 14px text at about 5px whatever the camera does. So legibility at 375 is a property of the format, not of this PR, and there is no px floor here. Record each `minPxPrimary` in the report and check composition only.

Review Focus 5: `phoneBefore` must pass here, and its `details.geometry` must equal the 1024 run's object field for field.

- [ ] **Step 19: Tear down**

Call `preview_stop` with the server id from Step 9. Call `resize_window` with `{ "preset": "desktop" }`. Then:

```bash
grep -qx '# walkthrough-check throwaway' .env && rm .env
test ! -e .env && echo "env removed"
git status --short
```

Expected:

- `env removed`. The `rm` runs only when the file carries Step 8's marker line, so it can never delete a `.env` this task did not write. If `env removed` does not print, the `.env` there is not the throwaway: leave it untouched, and stop and report it.
- `git status --short` lists ` M CHANGELOG.md` and ` M CLAUDE.md`, plus the files of a tuning step if Step 20 or 21 ran and is not yet committed. Nothing else: no probe files. (`git status` cannot show `.env`, which is gitignored; the `test` line above is what proves it is gone.)

- [ ] **Step 20 (only if Step 16 or 18 failed on `phone geometry` or `phone rows cut after the tap`): tune `PHONE_LATER_ROWS`**

Look at `details.geometry` from the failing shot (`phoneBefore` or `phoneAfter`).

- **`logNowInside` is `false` in `phoneBefore`:** stop and report. Log now's position is decided by the header and the Due card above it. The Later rows below it cannot move it, so no allowed knob fixes this.
- **`cutRows` is non-empty and every entry has `section: "later"`:** a Later row is cut by the content box's clip edge, and one fewer row fixes it. After the tap this can happen to a row that sat wholly below the edge before it, because the collapse moves the list up.
  1. Run `grep -n "export const PHONE_LATER_ROWS" src/lib/components/walkthrough/demo-dashboard.ts`. It prints `export const PHONE_LATER_ROWS = <n>;`. T5 sets 2.
  2. If n is 1, stop and report: T5's bounds test requires a non-empty prefix, so 0 is not a value this task may choose, and a single Later row that is still cut means the phone's layout above it is too tall. Otherwise edit that line to `export const PHONE_LATER_ROWS = <n − 1>;`, using the real number: if it printed 2, write 1.
  3. Vite reloads the page. If Step 19 already ran, re-run Steps 8 and 9 first: Step 8's guard and marker line apply to the re-write exactly as they did the first time, and Step 19 must run again before Step 22 so that its marker-checked `rm` removes the file. Then repeat Steps 10–15 and run `phoneBefore` and `phoneAfter` again.
  4. Repeat until both pass.
- **`cutRows` has an entry in any other section:** stop and report. The cut is not in the Later list, so the constant cannot fix it.

This step only ever lowers the constant. If both phone shots pass at T5's value with room to spare below the last Later row, leave it: the task tunes only on a failure, and the spec asks only that every shown row is whole.

When it passes:

1. `grep -rn "PHONE_LATER_ROWS" tests/` shows every test that reads it.
   - The fidelity test compares the shown rows with `later.slice(0, PHONE_LATER_ROWS)`, so it follows the constant with no edit.
   - Any test that pins the old literal must change to the new value. An example would be `expect(PHONE_LATER_ROWS).toBe(<old>)`.
2. Mutation proof for a changed pin: set the constant back to `<old>` and run `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts`. The pinning test must FAIL. Restore `<new>`; it must PASS.
3. Run `npx vitest run tests/unit/walkthrough-dashboard-fidelity.test.ts tests/unit/walkthrough-stage.svelte.test.ts tests/unit/walkthrough-timeline.test.ts`. Expected: all PASS.
4. Commit on its own. Before running it, replace `<new>` with the real number and pick the true value in each `<a|b>` choice; add the pinning test's path to `git add` if one changed:

```bash
git add src/lib/components/walkthrough/demo-dashboard.ts
git commit -m "fix(walkthrough): show <new> Later rows on the phone so no row is cut" -m "The <phoneBefore|phoneAfter> browser check at T_TAP <- 0.3|+ 1.0> found a Later row cut through its text by the phone content box's clip edge at the <1024|375>px container. One fewer row keeps every visible row whole, as spec Section 3 requires of PHONE_LATER_ROWS."
```

- [ ] **Step 21 (only if a desktop shot failed only on `primary text is …px, below 9px`): tune that shot's camera cap**

1. In `computeFrame` (`timeline.ts`), find the `fitCamera(rect, pad, cap)` that frames the failing shot. These are T7's lines:
   - `todayOpening`: `const from = fitCamera(unionRects(R("d.header"), R("d.due")), 28, 1.9);` in the Today branch;
   - `panEnd`: `const to = fitCamera(unionRects(R("d.later", todayScroll), R("d.chips", todayScroll)), 28, 1.9);` in the same branch;
   - `beforeTap`, `spinner` and `afterUpdate`: `const hold = fitCamera(unionRects(R("d.header"), R("d.due"), R("d.done")), 28, 2.0);` in the LogNow branch;
   - `offerFraming` and `offerHeld`: `const offer = fitCamera(R("o.offer"), 40, 2.0);` in the same branch.
2. Raise that `cap` to `Math.ceil(cap × 9 / minPxPrimary × 10) / 10`. For example, 2.0 at 8.6px becomes 2.1.
3. Vite reloads. If Step 19 already ran, re-run Steps 8 and 9 first (Step 8's guard and marker line included), and run Step 19 again before Step 22. Then repeat Steps 10–15 and rerun the shot.
4. **If `cameraScale` did not change, the cap was not what limited the frame**: `fitCamera` took the safe-area bound instead. Revert the edit, stop and report the numbers. A different framing is the spec's decision, not this task's ("The browser check confirms each framing; it does not choose one").
5. If the shot now passes:
   1. `grep -n "fitCamera(" tests/unit/walkthrough-timeline.test.ts` shows any assertion that rebuilds that shot's camera with the old cap literal. Change that literal to the new cap: the test keeps its meaning, the shot frames exactly those rects, and the cap is its parameter.
   2. Mutation proof: put the old cap back in `timeline.ts`. `npx vitest run tests/unit/walkthrough-timeline.test.ts` must FAIL on that assertion. Restore the new cap; it must PASS, including "keeps every desktop shot inside the browser window".
   3. Commit on its own. Replace `<shot>`, `<old>`, `<new>` and the measured sizes with the real values before running it:

```bash
git add src/lib/components/walkthrough/timeline.ts tests/unit/walkthrough-timeline.test.ts
git commit -m "fix(walkthrough): let the <shot> framing zoom to <new>" -m "At the 1024px landing container its primary text measured <before>px, under the 9px floor the shipped shots clear. Raising the cap from <old> to <new> brings it to <after>px with the same framed rects."
```

- [ ] **Step 22: Run the final gates**

Run each from the worktree root, after Step 19, so that no `.env` exists. The build in particular must not depend on one, as in CI.

```bash
test ! -e .env && echo "no .env"
npx vitest run 2>&1 | tail -5
npx vitest run 2>&1 | tail -5
npm run check 2>&1 | tail -3
npm run lint 2>&1 | tail -3
npm run format:check
DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npm run build; echo "build exit $?"
```

Expected:

- `no .env`. If it does not print and Step 19 has not run since the last Step 8, run Step 19. If Step 19 already ran and kept the file because it has no marker line, stop and report it, as Step 19 says. Never delete it by hand.
- **Both vitest runs:** `Test Files  N passed (N)` and `Tests  M passed (M)`, with Step 1's N and M and no `failed`. If either run fails, run `npx vitest run 2>&1 | grep -E "FAIL|✗|×"`, name every failing test in the report, and say whether it failed in one run or both. Do not commit past a failure.
- **`npm run check`:** `svelte-check found 0 errors and W warnings`, with W ≤ 27.
- **`npm run lint`:** `✖ P problems (0 errors, W warnings)`, with W ≤ 115.
- **`npm run format:check`:** `All matched files use Prettier code style!`.
- **The build:** `build exit 0`. The output normally ends with `> Using @sveltejs/adapter-vercel` and `✔ done`. It also prerenders `/`, so it server-renders `WalkthroughVideo`'s title card.

- [ ] **Step 23: Commit the docs**

```bash
git add CLAUDE.md CHANGELOG.md
git commit -m "docs: record how the walkthrough stays true to the dashboard" -m "CLAUDE.md gains one Reusable Components bullet. The walkthrough draws the dashboard from scene-only parts and never mounts the real components. The fidelity test pins its data and text to composeDashboardPageData and the copy helpers. REQUIRED_MARKS and the stage mount test make a missing or misplaced mark fail, instead of silently sending the camera to the wide shot." -m "CHANGELOG [Unreleased] records the redrawn walkthrough under Changed and the 'Last logged ... ago ago' reminder copy under Fixed, and the unreleased Added entry for the walkthrough names its Today and Log now scenes instead of My Day and Quick Log."
git log --oneline -1
git status --short
```

Expected: a new commit, and an empty `git status --short`. The commit carries no attribution trailer and no session link. The pre-commit hook runs prettier on the two Markdown files and must pass unchanged; never use `--no-verify`.

#### Notes for the reviewer

- **The spec's screenshot list includes "the Analytics bar" and "Security's dates", but neither is ever on screen.** Measured on base 311758f at 1280×720:
  - the Dose Status Breakdown title is at fake-window y = 1106, and Security's first "Expires" line at y = 1000;
  - both are below `WIN_H` = 984, and `clampCamera` never frames below it;
  - the only scrolled page is the dashboard.

  So Step 16 rows 10 and 11 verify those corrections by DOM text, computed by the real `STATUS_BREAKDOWN`, `SESSION_EXPIRIES` and `formatUserDate` in the browser, and record `windowY`. They cannot verify legibility. Bringing either on screen would mean changing a shot, which is out of scope ("no fidelity work beyond false"). The corrections are still worth making: the strings are in the page, and the CHANGELOG line describes them accurately.

- **History's Yesterday rows** are on camera at T = 22.2, with their time column at 11.68px. Their names and glyphs sit under the lower third, which has always been the case for this shot. The order check therefore reads the times, which are clear of the caption.
- **The 375px pass has no font-size floor, on purpose.** A 1920px stage drawn 343px wide renders 14px app text at about 5px at any camera ≤ 2.0. The spec's "checked for legibility at 375px" can only mean composition. The checks that do differ by width are the pause button overlap (the button is a fixed 32px) and the recorded font sizes.
- **The legibility floors (desk 9px, phone 8px) are judgement calls.** They come from the shipped shots and the phone's fixed scale; Step 15 gives the derivation. The spec's own tap framing (`fitCamera(header ∪ Due ∪ Done, 28, 2.0)`) is estimated at s ≈ 1.3–1.4, about 9.7–10.4px for 14px text at 1024. That clears 9px by about a pixel. If it lands just under, Step 21's procedure finds that the cap is not binding (s < 2.0) and stops for a decision, rather than reframing.
- **The seek stub gives the player a virtual clock, not a recorded real one.** An earlier draft replayed `step(origin + T × 1000)` against the player's real `performance.now()` origin. That is not exact, and the error lands on the boundaries this check exists to test. Measured on base 311758f, with a real start read of 6813.6000000238 ms:
  - `T_LOG − 0.1` came back as 7.35 instead of 7.3500000000000005;
  - `T_LOG + 0.4` came back as 7.85, which is inside `[T_LOG, T_LOG + 0.4)`, so the resume check would have found a spinner.

  A node probe of the same arithmetic at a 123456.789 ms origin returned 9.999999999999986 for `CUES.Medications`, which is still the LogNow shot with the offer showing. With the virtual clock, `origin` is exactly 0 at every start and resume, and the stub refuses to seek otherwise. The probe found no shot T that fails at origin 0. The cost is one heuristic: the player's read is recognised by its caller frame being in `WalkthroughVideo.svelte`. Step 2 greps for the read, and `__seek` returns an `ERROR:` if the recognition ever fails, so it cannot fail silently.

- **The spinner tool reads only a drawn spinner.** T7's `StageDueCard` renders every face's spinner at all times, as `rotate(0deg)` inside an `invisible` cell when idle (Took it at and Skip have one each, too). The earlier draft read the first `rotate(` under Log now regardless, so `beforeTap` and the resume check would have reported 0° instead of no spinner.
- **`phoneAfter` now also fails on a cut row.** Spec Section 3 asks it of the before-tap screenshot only. But the collapse lifts every row below the card by roughly 120px (−≈170 for the card, +52 for the new Done row), so a Later row that sat wholly below the clip edge before the tap, and passed, can straddle it afterwards. Step 20 handles both shots the same way.
- **The probe found four traps the steps now cover:**
  - a concurrent `svelte-kit sync` reloads the dev page every time it runs. Other plan writers' probe runs did exactly this while this part was written;
  - a hidden pane is `visibilityState: "hidden"`, and IntersectionObserver waits for a rendering update;
  - at 1280×800 the player sits only 3.5px outside the observer's margin, so a slightly different copy wrap would start it before the stub. At 1280×720 the stage top measured 1003.5px against a 920px observer line;
  - Chrome serialises the progress bar's inline width to six significant digits (`"22.9885%"` at T = 10), so the bar can confirm a frame rendered but cannot prove T exact. The stub's own arithmetic check does that.
- **Today's phone scene already cuts a row,** "Night" at device y 863–879 against a clip edge at 874. So `__wtPhone` is a real check, not a formality.
- **Today's MyDay pan end puts the Quick Log pills partly under the lower third** (16,700px² of overlap at T = 5.95). If the redrawn Today shot does the same to the chips, `panEnd` fails with `text is covered`. That is a T7 framing defect, and Step 16 stops for it rather than tuning.
- **The CHANGELOG edit goes one phrase beyond the spec's two lines, on purpose.** The `[Unreleased] ### Added` entry introducing the walkthrough names "My Day, Quick Log" among its ten features. Nothing has been released, so as written the next release's notes would list two scenes this PR deletes, beside a Changed line saying they are gone. Step 4 changes that phrase to "Today, Log now" and leaves the rest of the entry alone. If the reviewer would rather keep the spec's two lines exactly, drop Step 4's first edit and change Step 6's expected stat to `CHANGELOG.md | 2 ++`.
- **The Fixed line is not the Changed line's twin.** The "ago ago" copy is a production bug in reminders people already receive, so it belongs under Fixed even though it ships in the same PR as the walkthrough work.
- **Planner leftovers.** While this part was written, other plan writers' probe files (`tests/unit/zz-probe-plan-T9-*`) and, earlier, an untracked `tests/unit/.svelte-kit/` from a `svelte-kit sync` run in `tests/unit` appeared in the worktree. None belongs to the branch. If any `tests/unit/zz-probe-*` file or `tests/unit/.svelte-kit/` exists at Step 1, delete it before recording the baseline.
- **The CLAUDE.md bullet forbids only a T-dependent `{#if}` around a marked element.** Once T7 and T8 land, `StageDueCard` wraps the marked Log now in `{#if row.logNow}`, copying DueCard's own rule. A bullet saying "never with an `{#if}` around a marked element" would be false of the code it documents, and a later editor would either "fix" that payload-fixed condition or stop trusting the rule. The condition is fixed for the whole loop, so the registered set never changes with T, which is the property the rule protects and T9's mount test asserts. The header's Global Constraint still has the literal wording; this bullet is what ships.
- **The throwaway `.env` carries a marker line, and Step 19 deletes only a marked file.** `.env` is gitignored, so `git status` cannot show one. A `.env` copied into the worktree beforehand (the main checkout's has an empty `ENCRYPTION_KEY`) would make a bare `test ! -e .env && …` write skip silently, boot the dev server on the developer's file, and let an unconditional `rm .env` delete it. Steps 1 and 8 therefore stop on an existing file, Step 8 writes `# walkthrough-check throwaway` as the first line, Step 19 removes the file only when that line is present, and Step 22 confirms none is left.
- **Assumptions from earlier tasks' contracts** (Step 2 checks the code side of them):
  - each `data-stage-section` name appears exactly once per root, desktop and phone. The tools throw `"<k> \"<name>\" sections on the desk"` otherwise;
  - the phone keeps the `pt-[72px] pb-4` overflow-hidden content box that the spec's 732px figure describes;
  - Log now's pending label is the `DoseActionForm` string `"Logging…"`;
  - the spinner's angle is a `rotate(<deg>)` transform equal to `Frame.*.pending`.
