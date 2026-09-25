# Dashboard "Due Now" Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dashboard around what is due now, and make a late dose resolve the slot it was for.

**Architecture:** The pure matching engine lives in `src/lib/utils/schedule.ts`:

- a dashboard window over yesterday, today and tomorrow's first hour;
- projection with lifecycle and schedule-edit clips;
- passes 0–2;
- simulation-proven slot actions.

Composition sits in `src/lib/server/dashboard/`, a pure `page-data.ts` plus a `load.ts` that runs the queries. Writes are guarded in `src/lib/server/doses.ts`, with `logDoseForSlot` under a medication row lock. New Svelte 5 components live in `src/lib/components/dashboard/`, and `+page.svelte` switches to them in one atomic task. No schema migration and no `/api/v1` change.

**Tech Stack:**

- SvelteKit with Svelte 5 runes
- TypeScript
- Drizzle ORM on Neon Postgres
- Tailwind v4 semantic tokens
- Zod 4
- Vitest: jsdom by default, `node` for SSR/PGlite files
- `fake-db` and PGlite test seams
- Playwright e2e (not run in CI)

**Spec:** `docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md`. Read it before starting any task. Every task implements a part of it, and its decisions D1–D10 are binding.

## Global Constraints

- Svelte 5 runes only (`$props`, `$state`, `$derived`, `$effect`). No `export let`.
- Semantic tokens only. `accent` is the fill, `accent-ink` is text/border/ring, and `accent-fg` is text on the fill. Control boundaries use `border-strong`; `glass-border` is decorative hairlines only. Never put opacity on a row that needs action.
- Every dose control is at least 44×44px; Log now is at least 48×104px. Sizes come from fixed `h-11`/`h-12`/`min-w-*` classes, never padding, so `data-density="compact"` cannot shrink them.
- Every action under `src/routes/(app)/` opens with `if (!locals.user) error(401, "Unauthorized")`.
- `actionErrorMessage` is the only reader of a failed action. Every `use:enhance` callback handles `'failure'` and `'error'`.
- `src/lib/utils/**` must not import `$lib/server/*` (type-only imports excepted).
- Test seams:
  - Use `fake-db` unless the behaviour is decided by the database. Anything the database decides runs on PGlite in `tests/unit/pg/`.
  - PGlite files start with `// @vitest-environment node` and freeze time with `vi.useFakeTimers({ toFake: ["Date"] })`.
  - PGlite fixtures pass an explicit `startedAt` (medications) and `effectiveFrom` (schedules) in the past. The database defaults use Postgres `now()`, which the faked `Date` cannot move.
- Prove new tests by mutation wherever a step says so: break the named line, watch the named test fail, then restore it.
- SSR component tests use `// @vitest-environment node` and `render` from `svelte/server`.
- Commit messages are Conventional Commits with **no Claude/AI attribution**: no `Co-Authored-By`, no session links, no "Generated with".
- Svelte trims whitespace at element edges, so a trailing space inside an `sr-only` span is written `{"Log "}`. That string-literal mustache is an ERROR under `svelte/no-useless-mustaches` (on in `svelte.configs["flat/recommended"]`), which fails `npm run lint` and the lint-staged pre-commit hook, so put `<!-- eslint-disable-next-line svelte/no-useless-mustaches -->` on the line above it.
- Import the rune module as `$components/dashboard/dose-write-lock.svelte`, with no `.ts`/`.js` suffix.
- `formatUserTime` renders single-digit hours unpadded ("9:00"). The spec's "09:00" examples are illustrative; assert what `formatUserTime` produces.
- Final verification (Task 11): `npm run check`, `npm run lint`, `npm run format:check`, `npx vitest run` and `npm run build` all pass.

## File Structure

| File                                                                                                               | Responsibility                                                                                                                        | Task            |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `src/lib/utils/time.ts`                                                                                            | `formatDuration`, `formatDueIn` rebuilt, formatter memo; deletes `computeTimingStatus`/`classifyDueStatus`                            | 1, 11           |
| `src/lib/utils/schedule.ts`                                                                                        | window, `checkSlotActionTime`, projection, clips, passes 0–2, `slotActions`; deletes time-of-day grouping and `timingStatusFromSlots` | 2, 3, 4, 5, 11  |
| `src/lib/types.ts`                                                                                                 | dashboard payload types; deletes `MedicationTimingStatus`                                                                             | 6, 11           |
| `src/lib/utils/dashboard-copy.ts` (new)                                                                            | header copy, row status lines, toast sentences                                                                                        | 6               |
| `src/lib/server/dashboard/page-data.ts` (new)                                                                      | pure composition of the page payload                                                                                                  | 7               |
| `src/lib/server/dashboard/load.ts` (new)                                                                           | `loadDashboard`: four queries plus composition                                                                                        | 7               |
| `src/lib/server/doses.ts`                                                                                          | `getDosesInRange`, guarded `logDose`/`logSkippedDose`, `logDoseForSlot`, new errors; deletes `getTodaysDoses`                         | 7, 8, 11        |
| `src/lib/utils/validation.ts`                                                                                      | `doseSkipSchema`; `doseLogSchema.forSlot`                                                                                             | 8               |
| `src/routes/(app)/dashboard/+page.server.ts`                                                                       | actions (Task 9), then the load switch (Task 11)                                                                                      | 9, 11           |
| `src/lib/components/dashboard/*` (new)                                                                             | lock, clock, `StatusMarker`, `MedicationGlyph`, `DoseActionForm`, `DueCard`, `DoneList`, `LaterList`, `DashboardHeader`               | 10              |
| `src/routes/(app)/dashboard/+page.svelte`                                                                          | the new page                                                                                                                          | 11              |
| `src/lib/components/QuickLogBar.svelte`, `KeyboardShortcuts.svelte`, `ui/Toast.svelte`, `OnboardingWelcome.svelte` | chips, shortcut scoping, Undo size, copy                                                                                              | 11              |
| `src/lib/components/MyDayTimeline.svelte`, `SummaryStrip.svelte`                                                   | deleted                                                                                                                               | 11              |
| `src/lib/server/reminders/domain.ts`                                                                               | pre-midnight 12h cap                                                                                                                  | 12              |
| `tests/e2e/**`                                                                                                     | heading and chip selectors                                                                                                            | 11              |
| `CLAUDE.md`, the due-ness spec, workflow and test comments                                                         | docs                                                                                                                                  | 3, 4, 7, 11, 12 |

## Execution notes

- **Ship as one PR.** Tasks 3–4 change `computeScheduleSlots` for its existing callers, so the old My Day picks up the lifecycle clip and the new attributions before Task 11 switches the page. Every commit stays green, but the intermediate states are not meant to deploy on their own.
- **Anchor edits on quoted code, not line numbers.** Line numbers in a task are from `HEAD` at planning time. Earlier tasks insert code above later tasks' targets, so find each block by the code a step quotes.
- **Tasks 5, 7 and 8 contain hand-derived expectations.** They were planned before the earlier tasks existed. If one fails, first check whether the upstream function implements the spec. Change a test's expectation only when the spec says the test is wrong.
- **`ScheduleKind` exists twice.** `src/lib/server/db/schema.ts` exports `ScheduleKind` with `"prn"`, and Task 3 exports a narrower one from `$lib/utils/schedule`. Alias one wherever both are imported.
- **Order:** Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. Task 12 needs only Task 2 and can run any time after it.

---

### Task 1: `utils/time.ts` — `formatDuration`, a day unit for `formatDueIn`, and a per-timezone formatter memo

**Files:**

- Modify: `src/lib/utils/time.ts:64` (insert the memo block after the closing `};` of `DATE_FORMAT_LOCALES`), `:92-98` (`isoDayKeyFormatter` uses the memo), `:113` (`isoDayKey` doc line), `:267-279` (`wallClockToInstant`'s formatter), `:602-623` (insert `formatDuration`, rebuild `formatDueIn`)
- Test: `tests/unit/time.test.ts:1-9` (imports), `:187-210` (the `formatDueIn` describe gains one case), and new describes appended at the end of the file

**Interfaces:**

- Consumes: nothing new. Existing `src/lib/utils/time.ts` only.
- Produces (later tasks rely on these exact names):
  - `export interface DurationOptions { style?: "short" | "long"; maxUnits?: 1 | 2 }` (defaults: short, 2)
  - `export function formatDuration(ms: number, opts?: DurationOptions): string`
  - `export function formatDueIn(ms: number): string`, rebuilt on `formatDuration`. The 11 existing assertions stay byte-identical, and `formatDueIn(-(504*60+20)*60_000) === "Overdue 21d"`.
  - `isoDayKey(date: Date, timezone: string): string`, `isoDayKeyFormatter(timezone: string): (date: Date) => string` and `wallClockToInstant(dayKey: string, timeOfDay: string, timezone: string): Date` keep their signatures and behaviour. Their `Intl.DateTimeFormat` instances are now memoised in one module-level `Map` keyed by `${kind}:${timezone}`, through a private `machineFormat(kind, timezone)`. The `kind` fixes the options. Nothing new is exported for the memo.
  - NOT deleted here: `computeTimingStatus`, `classifyDueStatus` (Task 11 deletes them).

- [ ] **Step 1: Write the failing `formatDuration` tests**

In `tests/unit/time.test.ts`, replace the import block at lines 2-9:

```ts
import {
  formatTimeSince,
  formatTime,
  formatUserDate,
  startOfDay,
  formatDueIn,
  formatDuration,
  computeTimingStatus,
} from "$lib/utils/time";
```

Append this describe to the end of the file:

```ts
describe("formatDuration", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it("short style at every threshold", () => {
    expect(formatDuration(59_999)).toBe("<1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(45 * MIN)).toBe("45m");
    expect(formatDuration(60 * MIN)).toBe("1h");
    expect(formatDuration(2 * HOUR + 15 * MIN)).toBe("2h 15m");
    expect(formatDuration(23 * HOUR + 59 * MIN)).toBe("23h 59m");
    expect(formatDuration(24 * HOUR)).toBe("1d");
    expect(formatDuration(24 * HOUR + 59 * MIN)).toBe("1d");
    expect(formatDuration(25 * HOUR)).toBe("1d 1h");
    expect(formatDuration(49 * HOUR)).toBe("2d 1h");
  });

  it("long style at every threshold", () => {
    const long = (ms: number) => formatDuration(ms, { style: "long" });
    expect(long(59_999)).toBe("less than a minute");
    expect(long(60_000)).toBe("1 minute");
    expect(long(45 * MIN)).toBe("45 minutes");
    expect(long(60 * MIN)).toBe("1 hour");
    expect(long(2 * HOUR + 15 * MIN)).toBe("2 hours 15 minutes");
    expect(long(23 * HOUR + 59 * MIN)).toBe("23 hours 59 minutes");
    expect(long(24 * HOUR)).toBe("1 day");
    expect(long(24 * HOUR + 59 * MIN)).toBe("1 day");
    expect(long(25 * HOUR)).toBe("1 day 1 hour");
    expect(long(49 * HOUR)).toBe("2 days 1 hour");
  });

  it("maxUnits 1 keeps only the largest non-zero unit, floored", () => {
    // The dashboard's copy shape: "2 hours ago", never "3 hours ago" for 2h15m.
    const one = (ms: number) => formatDuration(ms, { style: "long", maxUnits: 1 });
    expect(one(59_999)).toBe("less than a minute");
    expect(one(45 * MIN)).toBe("45 minutes");
    expect(one(2 * HOUR + 15 * MIN)).toBe("2 hours");
    expect(one(23 * HOUR + 59 * MIN)).toBe("23 hours");
    expect(one(25 * HOUR)).toBe("1 day");
    expect(formatDuration(2 * HOUR + 15 * MIN, { maxUnits: 1 })).toBe("2h");
  });

  it("floors at every unit, so lateness is never overstated", () => {
    expect(formatDuration(2 * MIN - 1)).toBe("1m");
    expect(formatDuration(HOUR - 1)).toBe("59m");
    expect(formatDuration(24 * HOUR - 1)).toBe("23h 59m");
  });

  it("uses the magnitude, so the sign never reaches the label", () => {
    expect(formatDuration(-(2 * HOUR + 15 * MIN))).toBe("2h 15m");
    expect(formatDuration(-59_999, { style: "long" })).toBe("less than a minute");
  });

  it("drops zero units, and drops minutes once days appear", () => {
    expect(formatDuration(2 * HOUR + 30_000)).toBe("2h");
    expect(formatDuration(24 * HOUR + 5 * MIN, { style: "long" })).toBe("1 day");
    // The live defect: three weeks and twenty minutes.
    expect(formatDuration((504 * 60 + 20) * MIN)).toBe("21d");
  });

  it("defaults to the short style and two units", () => {
    expect(formatDuration(2 * HOUR + 15 * MIN)).toBe(
      formatDuration(2 * HOUR + 15 * MIN, { style: "short", maxUnits: 2 }),
    );
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: FAIL. Every `formatDuration` case throws `TypeError: formatDuration is not a function`, and all other cases pass.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/utils/time.ts`, insert this directly above the `formatDueIn` doc comment (`/**\n * Format a duration in milliseconds as a human-readable "due in" string.` at line 602):

```ts
export interface DurationOptions {
  /** "2h 15m" (default) or "2 hours 15 minutes". */
  style?: "short" | "long";
  /** How many units to show, largest first. Default 2. */
  maxUnits?: 1 | 2;
}

type DurationUnit = "day" | "hour" | "minute";

const MINUTES_PER_DAY = 24 * 60;

/**
 * THE duration formatter. Every "how long" on screen goes through it, so no
 * caller can print "504h 20m" for three weeks again. `formatDueIn` did,
 * because it had no day unit.
 *
 * - Magnitude only. The sign belongs to the caller ("ago" versus "in",
 *   "Due in" versus "Overdue"), never to this function.
 * - Floors at every unit, so lateness is never overstated: 119,999ms is
 *   "1m", and 23h59m at one unit is "23 hours".
 * - Units are d / h / m, where a day is 24 ELAPSED hours. This measures a
 *   duration, not a count of civil days, so a DST day does not bend it.
 * - Largest first. Zero units are dropped, and so are minutes once days
 *   appear ("1d 0h 5m" is "1d").
 * - Under a minute: "<1m" / "less than a minute".
 */
export function formatDuration(
  ms: number,
  { style = "short", maxUnits = 2 }: DurationOptions = {},
): string {
  const totalMinutes = Math.floor(Math.abs(ms) / 60_000);
  if (totalMinutes < 1) return style === "long" ? "less than a minute" : "<1m";

  const days = Math.floor(totalMinutes / MINUTES_PER_DAY);
  const hours = Math.floor((totalMinutes % MINUTES_PER_DAY) / 60);
  const minutes = totalMinutes % 60;

  const units: Array<[number, DurationUnit]> =
    days > 0
      ? [
          [days, "day"],
          [hours, "hour"],
        ]
      : [
          [hours, "hour"],
          [minutes, "minute"],
        ];

  return units
    .filter(([count]) => count > 0)
    .slice(0, maxUnits)
    .map(([count, unit]) =>
      style === "long" ? `${count} ${unit}${count === 1 ? "" : "s"}` : `${count}${unit[0]}`,
    )
    .join(" ");
}
```

- [ ] **Step 4: Run the test and check that it passes**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: PASS for all cases, including the untouched `formatDueIn` and `computeTimingStatus` blocks.

- [ ] **Step 5: Write the failing `formatDueIn` day-unit test**

In `tests/unit/time.test.ts`, inside `describe("formatDueIn", …)`, insert this after the `"formats exactly 1 minute"` case (before the describe's closing `});` at line 210):

```ts
it("prints days instead of hundreds of hours", () => {
  // Live on the dashboard: a medication last taken three weeks ago read
  // "Overdue 504h 20m".
  expect(formatDueIn(-(504 * 60 + 20) * 60_000)).toBe("Overdue 21d");
});
```

- [ ] **Step 6: Run the test and check that it fails**

Run: `npx vitest run tests/unit/time.test.ts -t "prints days instead of hundreds of hours"`
Expected: FAIL with `expected 'Overdue 504h 20m' to be 'Overdue 21d'`.

- [ ] **Step 7: Rebuild `formatDueIn` on `formatDuration`**

In `src/lib/utils/time.ts`, replace the whole `formatDueIn` doc comment and function (old lines 602-623, from `/**\n * Format a duration in milliseconds as a human-readable "due in" string.` through the closing `}` after `return ms > 0 ? \`Due in ${label}\` : \`Overdue ${label}\`;`) with:

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

- [ ] **Step 8: Run the test and check that it passes**

Run: `npx vitest run tests/unit/time.test.ts`
Expected: PASS. The 11 original `formatDueIn` assertions ("Due now" ×3, "Due in 45m", "Due in 2h 15m", "Due in 3h", "Overdue 45m", "Overdue 2h 15m", "Overdue 1h", "Due in 1m", "Overdue 1m") and the new "Overdue 21d" all pass.

- [ ] **Step 9: Prove by mutation**

Apply each change, run `npx vitest run tests/unit/time.test.ts`, confirm the named test fails, then restore:

1. In `formatDuration`, replace the `days > 0 ? [...] : [...]` ternary with `[[days, "day"], [hours, "hour"], [minutes, "minute"]]`. "short style at every threshold" must fail on `24h59m` (it prints `"1d 59m"`).
2. Change `Math.floor(Math.abs(ms) / 60_000)` to `Math.round(Math.abs(ms) / 60_000)`. "floors at every unit, so lateness is never overstated" must fail.
3. Change `.slice(0, maxUnits)` to `.slice(0, 2)`. "maxUnits 1 keeps only the largest non-zero unit, floored" must fail.
4. In `formatDueIn`, replace the body with the old hours/minutes-only arithmetic from git (`git show HEAD:src/lib/utils/time.ts | sed -n 606,623p`). "prints days instead of hundreds of hours" must fail.

- [ ] **Step 10: Commit**

```bash
git add src/lib/utils/time.ts tests/unit/time.test.ts
git commit -m "feat(time): add formatDuration and give formatDueIn a day unit"
```

- [ ] **Step 11: Write the failing formatter-memo tests**

In `tests/unit/time.test.ts`, extend the import block again. It becomes:

```ts
import {
  formatTimeSince,
  formatTime,
  formatUserDate,
  startOfDay,
  formatDueIn,
  formatDuration,
  computeTimingStatus,
  isoDayKey,
  isoDayKeyFormatter,
  wallClockToInstant,
} from "$lib/utils/time";
```

Append this to the end of the file (`vi`, `beforeEach` and `afterEach` are already imported on line 1):

```ts
describe("machine formatter memo", () => {
  // Counts Intl.DateTimeFormat constructions by putting a subclass in its
  // place. vi.spyOn cannot do this job: a spied constructor builds instances
  // on the MOCK's prototype, which has no formatToParts, so the code under
  // test would throw instead of being observed.
  //
  // The memo is module-level and outlives each case. So every counting case
  // uses a zone that no other case in this file touches, and asserts an
  // EXACT count. If the stand-in never reached time.ts, the count would be
  // 0 and the case would fail loudly, not pass as "at most one".
  let constructed = 0;

  class CountingDateTimeFormat extends Intl.DateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      super(...args);
      constructed++;
    }
  }

  beforeEach(() => {
    constructed = 0;
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl), { DateTimeFormat: CountingDateTimeFormat }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds one day-key formatter per timezone, however many keys are asked for", () => {
    for (let day = 1; day <= 50; day++) {
      isoDayKey(new Date(Date.UTC(2026, 0, day, 12)), "Asia/Tokyo");
    }
    isoDayKeyFormatter("Asia/Tokyo")(new Date("2026-04-15T17:20:00Z"));
    expect(constructed).toBe(1);
  });

  it("builds one offset formatter per timezone for wallClockToInstant", () => {
    for (let hour = 0; hour < 24; hour++) {
      wallClockToInstant("2026-04-15", `${String(hour).padStart(2, "0")}:00`, "Asia/Seoul");
    }
    expect(constructed).toBe(1);
  });

  it("never answers for one zone with another zone's formatter", () => {
    // Guards the memo KEY. A cache keyed without the timezone passes both
    // counting cases above and fails here.
    const instant = new Date("2026-04-15T17:20:00Z");
    expect(isoDayKey(instant, "Australia/Perth")).toBe("2026-04-16");
    expect(isoDayKey(instant, "America/Los_Angeles")).toBe("2026-04-15");
    expect(isoDayKey(instant, "Australia/Perth")).toBe("2026-04-16");
    expect(wallClockToInstant("2026-04-15", "08:00", "Australia/Perth").toISOString()).toBe(
      "2026-04-15T00:00:00.000Z",
    );
    expect(wallClockToInstant("2026-04-15", "08:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-04-15T15:00:00.000Z",
    );
  });

  it("still throws for a zone the runtime rejects, every time", () => {
    // Behaviour identical to the unmemoised code. The constructor throws
    // before anything is cached, so a bad zone is never remembered as good.
    expect(() => isoDayKey(new Date(), "Not/A_Zone")).toThrow(RangeError);
    expect(() => isoDayKey(new Date(), "Not/A_Zone")).toThrow(RangeError);
    expect(() => wallClockToInstant("2026-04-15", "08:00", "Not/A_Zone")).toThrow(RangeError);
  });
});
```

- [ ] **Step 12: Run the test and check that it fails**

Run: `npx vitest run tests/unit/time.test.ts -t "machine formatter memo"`
Expected: FAIL. The first case fails with `expected 51 to be 1` and the second with `expected 24 to be 1`. The key-separation and invalid-zone cases pass.

- [ ] **Step 13: Write the memo**

(a) In `src/lib/utils/time.ts`, directly after the closing `};` of `DATE_FORMAT_LOCALES` (line 64), insert:

```ts
/**
 * The two machine-read formatter shapes, the day key and the offset probe,
 * memoised per timezone.
 *
 * `isoDayKey` and `wallClockToInstant` used to construct a fresh
 * `Intl.DateTimeFormat` on every call (~30µs each), and the dashboard's
 * projection calls them for every medication on every day key. A formatter
 * cannot change once built, so sharing one per (shape, zone) changes
 * nothing observable. `tests/unit/dst-wall-clock.test.ts` holds that.
 *
 * Both shapes are en-CA with numeric, zero-padded fields, and both are read
 * through `formatToParts`, never `format()`. They are KEYS, not labels, and
 * never follow `preferences.dateFormat`. The offset shape pins
 * `hourCycle: "h23"` because `hour12: false` is not equivalent: it can
 * render midnight as hour 24.
 *
 * The map gains one entry per distinct zone string. A stored timezone is
 * validated against `Intl.supportedValuesOf("timeZone")`, and a zone the
 * runtime rejects throws from the constructor before anything is cached.
 * The label formatters (`formatUserTime`, `formatUserDate`) take per-call
 * options and are deliberately not memoised here.
 */
type MachineFormat = "dayKey" | "offset";

const MACHINE_FORMAT_OPTIONS: Record<MachineFormat, Intl.DateTimeFormatOptions> = {
  dayKey: { year: "numeric", month: "2-digit", day: "2-digit" },
  offset: {
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  },
};

const machineFormats = new Map<string, Intl.DateTimeFormat>();

function machineFormat(kind: MachineFormat, timezone: string): Intl.DateTimeFormat {
  const key = `${kind}:${timezone}`;
  let fmt = machineFormats.get(key);
  if (fmt === undefined) {
    fmt = new Intl.DateTimeFormat("en-CA", { ...MACHINE_FORMAT_OPTIONS[kind], timeZone: timezone });
    machineFormats.set(key, fmt);
  }
  return fmt;
}
```

(b) In `isoDayKeyFormatter` (old lines 92-98), replace:

```ts
export function isoDayKeyFormatter(timezone: string): (date: Date) => string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
```

with:

```ts
export function isoDayKeyFormatter(timezone: string): (date: Date) => string {
  const fmt = machineFormat("dayKey", timezone);
```

(c) Replace the one-line doc above `isoDayKey` (old line 113):

```ts
/** One-off form of {@link isoDayKeyFormatter}. Prefer the factory in a loop. */
```

with:

```ts
/**
 * One-off form of {@link isoDayKeyFormatter}. Both forms share one memoised
 * formatter per timezone, so either is cheap in a loop.
 */
```

(d) In `wallClockToInstant` (old lines 267-279), replace:

```ts
// Offset arithmetic on KEY fields, not a rendered date — hardcoded en-CA
// with an explicit hourCycle, never preferences.dateFormat. `hour12: false`
// is not equivalent: it can render midnight as hour 24.
const fmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: timezone,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
```

with:

```ts
// Offset arithmetic on KEY fields, not a rendered date. See
// MACHINE_FORMAT_OPTIONS for why the shape is en-CA with an explicit
// hourCycle, never preferences.dateFormat.
const fmt = machineFormat("offset", timezone);
```

- [ ] **Step 14: Run the tests and check that they pass, with behaviour unchanged**

Run: `npx vitest run tests/unit/time.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/heatmap-days.test.ts tests/unit/analytics.test.ts tests/unit/schedule.test.ts`
Expected: PASS. `dst-wall-clock.test.ts` checks every DST gap and overlap rule and the Godthab/Apia/Chatham edge cases, so it is the proof that the memo left behaviour unchanged.

- [ ] **Step 15: Prove by mutation**

Apply each change, run `npx vitest run tests/unit/time.test.ts -t "machine formatter memo"`, confirm the named test fails, then restore:

1. Make `machineFormat` return `new Intl.DateTimeFormat("en-CA", { ...MACHINE_FORMAT_OPTIONS[kind], timeZone: timezone })` on every call, with no map. "builds one day-key formatter per timezone…" must fail (`expected 51 to be 1`), and so must "builds one offset formatter per timezone…" (`expected 24 to be 1`).
2. Change `const key = \`${kind}:${timezone}\`;`to`const key = kind;`. "never answers for one zone with another zone's formatter" must fail (Los Angeles reads `2026-04-16`).

- [ ] **Step 16: Type-check and lint**

Run: `npm run check && npx eslint src/lib/utils/time.ts tests/unit/time.test.ts`
Expected: no new errors. The test's `class CountingDateTimeFormat extends Intl.DateTimeFormat` and its `ConstructorParameters<typeof Intl.DateTimeFormat>` rest parameter must type-check under `strict`.

- [ ] **Step 17: Commit**

```bash
git add src/lib/utils/time.ts tests/unit/time.test.ts
git commit -m "perf(time): memoise the day-key and offset formatters per timezone"
```

---

---

### Task 2: `utils/schedule.ts` — the dashboard window and `checkSlotActionTime`

**Files:**

- Modify: `src/lib/utils/schedule.ts:3` (import line) and `:30` (`MATCH_TOLERANCE_MS` becomes exported, and the window block is inserted after it)
- Create: `tests/unit/dashboard-window.test.ts`

**Interfaces:**

- Consumes, all existing in `src/lib/utils/time.ts` (memoised by Task 1, signatures unchanged): `isoDayKey(date: Date, timezone: string): string`, `startOfDay(date: Date, timezone: string): Date`, `endOfDay(date: Date, timezone: string): Date`, `shiftDayKey(dayKey: string, days: number): string`, `wallClockToInstant(dayKey: string, timeOfDay: string, timezone: string): Date`.
- Produces (later tasks rely on these exact names):
  - `export const MATCH_TOLERANCE_MS = 60 * 60 * 1000` (was module-private; value unchanged)
  - `export const CARRY_OVER_MS = 12 * 60 * 60 * 1000`
  - `export interface DashboardWindow { now: Date; todayKey: string; todayStart: Date; end: Date; projectStart: Date; projectEnd: Date; visibleStart: Date; doseFetchFrom: Date; doseFetchTo: Date }`
  - `export function dashboardWindow(now: Date, tz: string): DashboardWindow`
  - `export type SlotActionTimeProblem = "future" | "stale"`
  - `export function checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard-window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  CARRY_OVER_MS,
  MATCH_TOLERANCE_MS,
  checkSlotActionTime,
  dashboardWindow,
} from "$lib/utils/schedule";

/**
 * The dashboard's bounds. These are pure functions over Dates, so the suite
 * uses default jsdom with no db mock and no fake timers. Every expectation
 * is an explicit ISO string. None is computed by the code under test.
 */

const iso = (d: Date) => d.toISOString();
const HOUR = 60 * 60 * 1000;

describe("window constants", () => {
  it("keeps the match tolerance at one hour and sets the carry-over at twelve", () => {
    expect(MATCH_TOLERANCE_MS).toBe(HOUR);
    expect(CARRY_OVER_MS).toBe(12 * HOUR);
  });
});

describe("dashboardWindow — Europe/London in BST", () => {
  // Thursday 16 April 2026, 08:00 BST.
  const now = new Date("2026-04-16T07:00:00.000Z");
  const w = dashboardWindow(now, "Europe/London");

  it("carries the one `now` and the user's civil day", () => {
    expect(iso(w.now)).toBe("2026-04-16T07:00:00.000Z");
    expect(w.todayKey).toBe("2026-04-16");
  });

  it("bounds today at local midnights, end exclusive", () => {
    expect(iso(w.todayStart)).toBe("2026-04-15T23:00:00.000Z");
    expect(iso(w.end)).toBe("2026-04-16T23:00:00.000Z");
  });

  it("projects from yesterday's local midnight to the end of tomorrow's first hour", () => {
    expect(iso(w.projectStart)).toBe("2026-04-14T23:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-04-17T00:00:00.000Z");
  });

  it("shows Earlier rows from the first millisecond under 12 hours old", () => {
    expect(iso(w.visibleStart)).toBe("2026-04-15T19:00:00.001Z");
  });

  it("fetches doses from an hour before the projection to two hours past today", () => {
    expect(iso(w.doseFetchFrom)).toBe("2026-04-14T22:00:00.000Z");
    expect(iso(w.doseFetchTo)).toBe("2026-04-17T01:00:00.000Z");
  });
});

describe("dashboardWindow — the October transition", () => {
  it("walks the day key back, so yesterday is the whole 25-hour day", () => {
    // Monday 26 October, the day after London falls back. todayStart − 24h
    // is 00:00Z on the 25th, which is 01:00 BST, an hour into yesterday. It
    // would silently drop yesterday's 00:00–00:59 slots.
    const w = dashboardWindow(new Date("2026-10-26T08:00:00.000Z"), "Europe/London");
    expect(iso(w.todayStart)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2026-10-24T23:00:00.000Z");
    expect(w.projectStart.getTime()).not.toBe(w.todayStart.getTime() - 24 * HOUR);
    expect(w.todayStart.getTime() - w.projectStart.getTime()).toBe(25 * HOUR);
    expect(iso(w.end)).toBe("2026-10-27T00:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-10-27T01:00:00.000Z");
    expect(iso(w.visibleStart)).toBe("2026-10-25T20:00:00.001Z");
    expect(iso(w.doseFetchFrom)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(w.doseFetchTo)).toBe("2026-10-27T02:00:00.000Z");
  });

  it("ends a 25-hour today at the next local midnight, not todayStart + 24h", () => {
    const w = dashboardWindow(new Date("2026-10-25T12:00:00.000Z"), "Europe/London");
    expect(w.todayKey).toBe("2026-10-25");
    expect(iso(w.todayStart)).toBe("2026-10-24T23:00:00.000Z");
    expect(iso(w.end)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2026-10-23T23:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-10-26T01:00:00.000Z");
  });
});

describe("dashboardWindow — visibleStart stays between yesterday's and today's midnights", () => {
  it("never reaches into today: late in the evening, Earlier is empty", () => {
    // 22:00 BST. now − 12h is 10:00 BST today, but the 12-hour bound applies
    // to Earlier rows only. Today's rows stay visible until midnight.
    const w = dashboardWindow(new Date("2026-04-16T21:00:00.000Z"), "Europe/London");
    expect(iso(w.visibleStart)).toBe(iso(w.todayStart));
    expect(iso(w.visibleStart)).toBe("2026-04-15T23:00:00.000Z");
  });

  it("never reaches before yesterday's midnight (Pacific/Apia skipped 2011-12-30)", () => {
    // Apia crossed the date line, so 29 December was followed by 31
    // December. "Yesterday" resolves forward onto today's own midnight.
    // now − 12h then lies before every projected instant, and the max() holds
    // visibleStart at projectStart.
    const w = dashboardWindow(new Date("2011-12-30T16:00:00.000Z"), "Pacific/Apia");
    expect(w.todayKey).toBe("2011-12-31");
    expect(iso(w.todayStart)).toBe("2011-12-30T10:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2011-12-30T10:00:00.000Z");
    expect(iso(w.visibleStart)).toBe("2011-12-30T10:00:00.000Z");
  });

  it("gets today's midnight, not tomorrow's, at UTC+12", () => {
    const w = dashboardWindow(new Date("2026-04-16T07:00:00.000Z"), "Pacific/Auckland");
    expect(w.todayKey).toBe("2026-04-16");
    expect(iso(w.todayStart)).toBe("2026-04-15T12:00:00.000Z");
    expect(iso(w.end)).toBe("2026-04-16T12:00:00.000Z");
  });
});

describe("the 12-hour boundary, to the millisecond", () => {
  it("hides a slot exactly 12 hours old and shows one a millisecond younger", () => {
    const now = new Date("2026-04-16T07:00:00.000Z");
    const w = dashboardWindow(now, "Europe/London");
    const exactly12h = new Date(now.getTime() - CARRY_OVER_MS);
    expect(iso(exactly12h)).toBe("2026-04-15T19:00:00.000Z");
    expect(exactly12h.getTime()).toBeLessThan(w.visibleStart.getTime());
    expect(exactly12h.getTime() + 1).toBe(w.visibleStart.getTime());
  });
});

describe("checkSlotActionTime", () => {
  const tz = "Europe/London";
  const now = new Date("2026-04-16T07:00:00.000Z"); // 08:00 BST

  it("rejects an instant after now as future", () => {
    expect(checkSlotActionTime(new Date("2026-04-16T07:00:00.001Z"), now, tz)).toBe("future");
  });

  it("accepts now itself", () => {
    expect(checkSlotActionTime(now, now, tz)).toBeNull();
  });

  it("accepts an Earlier slot a millisecond under 12 hours old", () => {
    expect(checkSlotActionTime(new Date("2026-04-15T19:00:00.001Z"), now, tz)).toBeNull();
  });

  it("rejects an Earlier slot exactly 12 hours old as stale", () => {
    expect(checkSlotActionTime(new Date("2026-04-15T19:00:00.000Z"), now, tz)).toBe("stale");
  });

  it("accepts any of today's slots, however old, and measures today in the user's zone", () => {
    // 22:00 BST. Today's 00:00 BST (23:00Z yesterday in UTC terms) is 22
    // hours old and still accepted. A UTC reading of "today" would call it
    // stale. One millisecond before local midnight is yesterday, and older
    // than 12 hours, so it is stale.
    const late = new Date("2026-04-16T21:00:00.000Z");
    expect(checkSlotActionTime(new Date("2026-04-15T23:00:00.000Z"), late, tz)).toBeNull();
    expect(checkSlotActionTime(new Date("2026-04-15T22:59:59.999Z"), late, tz)).toBe("stale");
  });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `npx vitest run tests/unit/dashboard-window.test.ts`
Expected: FAIL. The window and `checkSlotActionTime` cases throw `TypeError: dashboardWindow is not a function` or `TypeError: checkSlotActionTime is not a function`, and the constants case fails with `expected undefined to be 3600000`.

- [ ] **Step 3: Write the minimal implementation**

(a) In `src/lib/utils/schedule.ts`, replace line 3:

```ts
import { classifyDueStatus, isoDayKey, wallClockToInstant, dayOfWeekForDayKey } from "./time";
```

with:

```ts
import {
  classifyDueStatus,
  isoDayKey,
  wallClockToInstant,
  dayOfWeekForDayKey,
  startOfDay,
  endOfDay,
  shiftDayKey,
} from "./time";
```

(b) Replace line 30:

```ts
const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour
```

with:

```ts
/**
 * How far either side of a slot a dose may sit and still count for it, and
 * how far past today the dashboard projects. Tomorrow's first hour is
 * matched so that today's view makes the same choice tomorrow's will.
 */
export const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

/**
 * How long an unresolved slot from before local midnight stays on the
 * dashboard, in the "Earlier" group. `reminders/domain.ts` uses the same
 * value for how long the cron keeps reminding about such a slot. It is one
 * constant so that both surfaces fall silent at the same millisecond.
 * Today's slots are not capped by it.
 */
export const CARRY_OVER_MS = 12 * 60 * 60 * 1000;

/** Every bound the dashboard uses, computed once per request from one `now`. */
export interface DashboardWindow {
  now: Date;
  /** The user's civil day, `YYYY-MM-DD`. */
  todayKey: string;
  todayStart: Date;
  /** Exclusive: the start of the next civil day. */
  end: Date;
  /** Yesterday's local midnight. Walked by day key, never `todayStart − 24h`. */
  projectStart: Date;
  /** `end + MATCH_TOLERANCE_MS`. Tomorrow's first hour is matched, never shown. */
  projectEnd: Date;
  /** The earliest instant an Earlier row may have and still be shown. */
  visibleStart: Date;
  doseFetchFrom: Date;
  /** Exclusive. */
  doseFetchTo: Date;
}

/**
 * THE owner of the dashboard's bounds. The load, the Log-now server check
 * and `checkSlotActionTime` all call it, so none of them can disagree about
 * where "today", "Earlier" or "tomorrow's first hour" begins.
 *
 * - `projectStart` walks the day KEY. `todayStart − 24h` is wrong twice a
 *   year in every DST zone. On Europe/London 2026-10-26 it lands at 01:00
 *   BST on the 25th and loses yesterday's first hour.
 * - `visibleStart` is the first millisecond under 12 hours old: a slot at
 *   exactly `now − 12h` is hidden, and one at `now − 12h + 1ms` is shown.
 *   It is clamped into `[projectStart, todayStart]`, because the 12-hour
 *   bound applies to Earlier rows only and today's rows stay visible until
 *   midnight.
 * - `doseFetchFrom` covers pass 1's one-hour reach before the first
 *   projected slot. `doseFetchTo` covers its reach past the last slot in
 *   tomorrow's first hour.
 */
export function dashboardWindow(now: Date, tz: string): DashboardWindow {
  const todayKey = isoDayKey(now, tz);
  const todayStart = startOfDay(now, tz);
  const end = endOfDay(now, tz);
  const projectStart = wallClockToInstant(shiftDayKey(todayKey, -1), "00:00", tz);
  const visibleStartMs = Math.max(
    projectStart.getTime(),
    Math.min(todayStart.getTime(), now.getTime() - CARRY_OVER_MS + 1),
  );

  return {
    now: new Date(now.getTime()),
    todayKey,
    todayStart,
    end,
    projectStart,
    projectEnd: new Date(end.getTime() + MATCH_TOLERANCE_MS),
    visibleStart: new Date(visibleStartMs),
    doseFetchFrom: new Date(projectStart.getTime() - MATCH_TOLERANCE_MS),
    doseFetchTo: new Date(end.getTime() + 2 * MATCH_TOLERANCE_MS),
  };
}

export type SlotActionTimeProblem = "future" | "stale";

/**
 * Whether a client-sent `takenAt` (from Took it at or Skip) may still be
 * written. 'future' means the instant is after now, and no dose row is ever
 * future-dated. 'stale' means the row it came from has already left the
 * dashboard (it is older than the Earlier bound), so the tap was made on a
 * page that no longer shows what is due.
 */
export function checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null {
  if (at.getTime() > now.getTime()) return "future";
  if (at.getTime() < dashboardWindow(now, tz).visibleStart.getTime()) return "stale";
  return null;
}
```

- [ ] **Step 4: Run the tests and check that they pass**

Run: `npx vitest run tests/unit/dashboard-window.test.ts tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS. `schedule.test.ts` and `dst-wall-clock.test.ts` are unchanged because `MATCH_TOLERANCE_MS` keeps its value.

- [ ] **Step 5: Prove by mutation**

Apply each change, run `npx vitest run tests/unit/dashboard-window.test.ts`, confirm the named test fails, then restore:

1. Change `now.getTime() - CARRY_OVER_MS + 1` to `now.getTime() - CARRY_OVER_MS`. These must fail: "shows Earlier rows from the first millisecond under 12 hours old", "hides a slot exactly 12 hours old and shows one a millisecond younger" and "rejects an Earlier slot exactly 12 hours old as stale".
2. Change `projectStart` to `new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)`. "walks the day key back, so yesterday is the whole 25-hour day" must fail.
3. Remove the `Math.min(todayStart.getTime(), …)` wrapper, leaving `now.getTime() - CARRY_OVER_MS + 1`. "never reaches into today…" must fail, and so must "accepts any of today's slots, however old…", which returns `'stale'`.
4. Remove the `Math.max(projectStart.getTime(), …)` wrapper. "never reaches before yesterday's midnight (Pacific/Apia skipped 2011-12-30)" must fail.
5. In `checkSlotActionTime`, change `>` to `>=`. "accepts now itself" must fail.

- [ ] **Step 6: Type-check and lint**

Run: `npm run check && npx eslint src/lib/utils/schedule.ts tests/unit/dashboard-window.test.ts`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/dashboard-window.test.ts
git commit -m "feat(schedule): add dashboardWindow and checkSlotActionTime"
```

---

---

### Task 3: Slot projection over the dashboard window (`utils/schedule.ts`)

Projection and the clips land here. Matching stays exactly today's algorithm (symmetric ±1h capacity matching, slots ascending), moved into `matchMedicationSlots` as its only pass; T4 adds passes 0 and 2, reserved skips and the segment limit inside that function.

Every code block below was run against a scratch copy of the repo with a contract-exact stand-in for T2's `dashboardWindow`. Results: each stage fails as stated before its implementation step and passes after it, `svelte-check` reports 0 errors, eslint reports nothing, prettier is clean, the full suite passes (124 files, 1962 tests), and every mutation below failed its named test.

**Files:**

- Modify: `src/lib/utils/schedule.ts`. T2 has already edited the top of this file, so every anchor below is given by content, not line number:
  - the `ScheduleSlotStatus` / `ScheduleSlot` types (HEAD `:6-19`);
  - delete `expectedTimesForFixedTime` (HEAD `:105-133`);
  - insert new exports between `expectedTimesForInterval` and `computeScheduleSlots`;
  - replace `computeScheduleSlots` (HEAD `:135-293`).
- Modify: `tests/unit/schedule.test.ts`: imports at `:1-8`, the `slot()` fixture at `:669-682`, and new blocks appended at the end.
- Modify: `tests/unit/my-day-timeline-ssr.test.ts:31-46`: the `slot()` fixture.
- Modify: `tests/unit/dst-wall-clock.test.ts`:
  - the import at `:16`;
  - the comment and test name at `:515-523`;
  - a new test inserted before `:545`.
- Modify: `src/lib/utils/time.ts`: the `wallClockToInstant` doc comment line that names `expectedTimesForFixedTime` (HEAD `:243`; T1 may have moved it, so anchor on the text).
- Modify: `CLAUDE.md:32`: the reference to `expectedTimesForFixedTime`.
- Test: `tests/unit/schedule.test.ts`, `tests/unit/dst-wall-clock.test.ts`

**Interfaces:**

- Consumes (T2, same module `src/lib/utils/schedule.ts`): `export const MATCH_TOLERANCE_MS = 60 * 60 * 1000`, `export interface DashboardWindow { now; todayKey; todayStart; end; projectStart; projectEnd; visibleStart; doseFetchFrom; doseFetchTo }`, `export function dashboardWindow(now: Date, tz: string): DashboardWindow`.
- Consumes (existing): `wallClockToInstant`, `dayOfWeekForDayKey`, `isoDayKey` from `./time` (already imported by `schedule.ts`); `parseIntervalHours` from `$lib/utils/schedule-rate` (already imported); the module-private `getLocalDatesInRange` and `expectedTimesForInterval` (unchanged).
- Produces (T4, T5, T7 and T12 rely on these):
  - `export type ScheduleKind = "interval" | "fixed_time"`
  - `ScheduleSlot` gains `kind: ScheduleKind; isEarlier: boolean; resolvedByDoseId: string | null; missedByDoseId: string | null`. `matchedDoseId` is kept and equals `resolvedByDoseId ?? missedByDoseId ?? null`.
  - `export interface Segments { projectStart: Date; todayStart: Date; end: Date; projectEnd: Date }`
  - `export function segmentsFor(window: DashboardWindow): Segments`
  - `export function singleDaySegments(dayStart: Date, dayEnd: Date): Segments`
  - `export interface ProjectedSlot { expectedTime: Date; kind: ScheduleKind; segment: "yesterday" | "today" | "tomorrow" }`
  - `export function projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`
  - `export function projectMedicationSlots(input: { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; lastTakenAt: Date | null; segments: Segments }): ProjectedSlot[]`
  - `export interface MatchDose { id: string; takenAt: Date; status: "taken" | "skipped" | "missed"; quantity: number }`
  - `export interface MatchedSlot extends ProjectedSlot { status: ScheduleSlotStatus; resolvedByDoseId: string | null; missedByDoseId: string | null }`
  - `export function matchMedicationSlots(slots: ProjectedSlot[], doses: MatchDose[], opts: { now: Date; segments: Segments; pass2Bound: Date }): MatchedSlot[]`. In T3 it runs pass 1 only and ignores `opts.segments` and `opts.pass2Bound`. It sorts its input ascending itself.
  - `computeScheduleSlots(medications, schedulesByMedId, doses, lastDoseByMedication, dayStartUtc, dayEndUtc, timezone, now, opts: { window?: DashboardWindow } = {}): ScheduleSlot[]`
    - With `opts.window` it uses `segmentsFor(window)`; without, `singleDaySegments(dayStartUtc, dayEndUtc)`.
    - It already passes `pass2Bound = window.visibleStart` (or `dayStartUtc` without a window), so T4 only has to change `matchMedicationSlots`.
    - It returns only slots with `expectedTime < segments.end`.

- [ ] **Step 1: Write the failing tests for segments and `projectFixedTimes`**

In `tests/unit/schedule.test.ts`, replace the import block at `:1-8`:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyHour,
  computeScheduleSlots,
  groupSlotsByTimeOfDay,
  timingStatusFromSlots,
} from "$lib/utils/schedule";
import type { ScheduleSlot, ScheduleSlotStatus } from "$lib/utils/schedule";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  classifyHour,
  computeScheduleSlots,
  dashboardWindow,
  groupSlotsByTimeOfDay,
  projectFixedTimes,
  segmentsFor,
  singleDaySegments,
  timingStatusFromSlots,
} from "$lib/utils/schedule";
import type { ScheduleSlot, ScheduleSlotStatus, Segments } from "$lib/utils/schedule";
```

Then append this to the end of the file. It reuses the file's existing `makeMed`, `makeIntervalSchedule`, `makeFixedTimeSchedule`, `makePrnSchedule`, `makeDose` and `schedMap` helpers.

```ts
// ---------------------------------------------------------------------------
// Projection over the dashboard's three segments. Instants are compared with
// segment bounds, never re-keyed: a resolved instant does not carry a civil
// day (see wallClockToInstant).
// ---------------------------------------------------------------------------

// Yesterday, today and tomorrow's first hour around 2026-04-16 in UTC — the
// shape dashboardWindow produces, written out so these cases pin projection
// alone and not the window arithmetic.
const UTC_SEGMENTS: Segments = {
  projectStart: new Date("2026-04-15T00:00:00Z"),
  todayStart: new Date("2026-04-16T00:00:00Z"),
  end: new Date("2026-04-17T00:00:00Z"),
  projectEnd: new Date("2026-04-17T01:00:00Z"),
};

function isoList(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString());
}

describe("segmentsFor and singleDaySegments", () => {
  it("segmentsFor takes the four projection bounds straight off the window", () => {
    const window = dashboardWindow(new Date("2026-04-16T07:00:00Z"), "Europe/London");
    expect(segmentsFor(window)).toEqual({
      projectStart: window.projectStart,
      todayStart: window.todayStart,
      end: window.end,
      projectEnd: window.projectEnd,
    });
    // Yesterday's LOCAL midnight (BST), not a UTC one.
    expect(segmentsFor(window).projectStart.toISOString()).toBe("2026-04-14T23:00:00.000Z");
  });

  it("singleDaySegments leaves yesterday and tomorrow's first hour empty", () => {
    const segments = singleDaySegments(
      new Date("2026-04-16T00:00:00Z"),
      new Date("2026-04-17T00:00:00Z"),
    );
    expect(isoList([segments.projectStart, segments.todayStart])).toEqual([
      "2026-04-16T00:00:00.000Z",
      "2026-04-16T00:00:00.000Z",
    ]);
    expect(isoList([segments.end, segments.projectEnd])).toEqual([
      "2026-04-17T00:00:00.000Z",
      "2026-04-17T00:00:00.000Z",
    ]);
  });
});

describe("projectFixedTimes", () => {
  it("projects every fixed_time row over yesterday, today and tomorrow's first hour", () => {
    const schedules = [
      makeFixedTimeSchedule("med-1", "08:00", null, 0),
      makeFixedTimeSchedule("med-1", "00:30", null, 1),
      makeIntervalSchedule("med-1", "8"),
      makePrnSchedule("med-1"),
    ];
    expect(isoList(projectFixedTimes(schedules, UTC_SEGMENTS, "UTC"))).toEqual([
      "2026-04-15T00:30:00.000Z",
      "2026-04-15T08:00:00.000Z",
      "2026-04-16T00:30:00.000Z",
      "2026-04-16T08:00:00.000Z",
      // 00:30 tomorrow is inside the first hour; 08:00 tomorrow is not.
      "2026-04-17T00:30:00.000Z",
    ]);
  });

  it("deduplicates two rows naming the same wall clock", () => {
    const schedules = [
      makeFixedTimeSchedule("med-1", "08:00", null, 0),
      makeFixedTimeSchedule("med-1", "08:00", [4], 1),
    ];
    expect(isoList(projectFixedTimes(schedules, UTC_SEGMENTS, "UTC"))).toEqual([
      "2026-04-15T08:00:00.000Z",
      "2026-04-16T08:00:00.000Z",
    ]);
  });

  it("reads day-of-week off each day key", () => {
    // 2026-04-15 is a Wednesday (3), 2026-04-16 a Thursday (4).
    const schedules = [makeFixedTimeSchedule("med-1", "08:00", [4])];
    expect(isoList(projectFixedTimes(schedules, UTC_SEGMENTS, "UTC"))).toEqual([
      "2026-04-16T08:00:00.000Z",
    ]);
  });

  it("is half-open: keeps an instant at projectStart, drops one at projectEnd", () => {
    const segments = { ...UTC_SEGMENTS, projectEnd: new Date("2026-04-17T00:30:00Z") };
    const schedules = [
      makeFixedTimeSchedule("med-1", "00:00", null, 0),
      makeFixedTimeSchedule("med-1", "00:30", null, 1),
    ];
    expect(isoList(projectFixedTimes(schedules, segments, "UTC"))).toEqual([
      "2026-04-15T00:00:00.000Z",
      "2026-04-15T00:30:00.000Z",
      "2026-04-16T00:00:00.000Z",
      "2026-04-16T00:30:00.000Z",
      "2026-04-17T00:00:00.000Z",
    ]);
  });

  it("projects nothing over an empty range", () => {
    const instant = new Date("2026-04-16T00:00:00Z");
    const schedules = [makeFixedTimeSchedule("med-1", "00:00")];
    expect(projectFixedTimes(schedules, singleDaySegments(instant, instant), "UTC")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL. Seven tests fail with `TypeError: segmentsFor is not a function`, `TypeError: singleDaySegments is not a function` or `TypeError: projectFixedTimes is not a function`. The 39 pre-existing tests still pass (`Tests  7 failed | 39 passed (46)`).

- [ ] **Step 3: Implement `ScheduleKind`, `Segments`, `segmentsFor`, `singleDaySegments`, `ProjectedSlot` and `projectFixedTimes`**

In `src/lib/utils/schedule.ts`, directly below the existing line
`export type ScheduleSlotStatus = "taken" | "skipped" | "upcoming" | "overdue";`
insert:

```ts
/** The two schedule kinds that project slots. `prn` rows never do. */
export type ScheduleKind = "interval" | "fixed_time";
```

Then insert this block immediately before the doc comment that opens with `/**\n * Compute expected dose schedule slots for the window.` (that is, after the closing brace of `expectedTimesForFixedTime`). Leave `expectedTimesForFixedTime` in place for now; Step 14 deletes it.

```ts
/**
 * The projection range, cut into three segments at instants — never at day
 * keys, because a resolved instant does not carry a civil day (see
 * `wallClockToInstant`):
 *
 *   yesterday          [projectStart, todayStart)
 *   today              [todayStart,   end)
 *   tomorrow's 1st hour [end,         projectEnd)
 *
 * Tomorrow's first hour is projected and matched but never returned, so
 * today's view already makes the choice tomorrow's view will make.
 */
export interface Segments {
  projectStart: Date;
  todayStart: Date;
  end: Date;
  projectEnd: Date;
}

/** The dashboard's three segments, straight off its window. */
export function segmentsFor(window: DashboardWindow): Segments {
  return {
    projectStart: window.projectStart,
    todayStart: window.todayStart,
    end: window.end,
    projectEnd: window.projectEnd,
  };
}

/**
 * One civil day and nothing either side: yesterday and tomorrow's first hour
 * collapse to empty ranges. What `computeScheduleSlots` uses without a window.
 */
export function singleDaySegments(dayStart: Date, dayEnd: Date): Segments {
  return { projectStart: dayStart, todayStart: dayStart, end: dayEnd, projectEnd: dayEnd };
}

export interface ProjectedSlot {
  expectedTime: Date;
  kind: ScheduleKind;
  segment: "yesterday" | "today" | "tomorrow";
}

/**
 * Every fixed-time instant in `[projectStart, projectEnd)`, deduplicated and
 * ascending, for every `fixed_time` row in `schedules`.
 *
 * THE only projection step that reads a timezone. Each day key the range
 * touches is resolved with `wallClockToInstant`; the instant is then kept or
 * dropped by comparing it with the range, never by re-deriving its day.
 * Day-of-week comes from the requested date KEY, never from the resolved
 * instant: on a transition that swallows the scheduled minute the instant can
 * legitimately land on the next civil day (America/Godthab springs forward at
 * 23:00 local), and reading the weekday off it would turn a Saturday-only
 * medication into a Sunday one and drop the slot entirely.
 *
 * Callers compute this once per medication per request and hand the result
 * to `projectMedicationSlots`, which is pure arithmetic and can therefore be
 * re-run cheaply for every simulated write.
 */
export function projectFixedTimes(
  schedules: MedicationSchedule[],
  segments: Segments,
  tz: string,
): Date[] {
  const startMs = segments.projectStart.getTime();
  const endMs = segments.projectEnd.getTime();
  const fixedRows = schedules.filter((s) => s.scheduleKind === "fixed_time");
  if (fixedRows.length === 0 || endMs <= startMs) return [];

  const dayKeys = getLocalDatesInRange(segments.projectStart, segments.projectEnd, tz);
  const instants = new Set<number>();
  for (const schedule of fixedRows) {
    const timeOfDay = schedule.timeOfDay;
    if (!timeOfDay) continue;
    const allowed = schedule.daysOfWeek;
    for (const dayKey of dayKeys) {
      if (allowed && allowed.length > 0 && !allowed.includes(dayOfWeekForDayKey(dayKey))) {
        continue;
      }
      const ms = wallClockToInstant(dayKey, timeOfDay, tz).getTime();
      if (ms >= startMs && ms < endMs) instants.add(ms);
    }
  }
  return [...instants].sort((a, b) => a - b).map((ms) => new Date(ms));
}
```

No import changes are needed. `wallClockToInstant` and `dayOfWeekForDayKey` are already imported from `./time`, and `DashboardWindow` is declared in this module by T2.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS (`Tests  157 passed (157)`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat(schedule): project fixed-time slots over the dashboard's three segments"
```

- [ ] **Step 6: Write the failing tests for `projectMedicationSlots`**

In `tests/unit/schedule.test.ts`, change `import { describe, it, expect } from "vitest";` to `import { describe, it, expect, vi } from "vitest";`, and add `projectMedicationSlots,` to the value import list between `projectFixedTimes,` and `segmentsFor,`. The value import now reads:

```ts
import {
  classifyHour,
  computeScheduleSlots,
  dashboardWindow,
  groupSlotsByTimeOfDay,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  singleDaySegments,
  timingStatusFromSlots,
} from "$lib/utils/schedule";
```

Append to the end of the file:

```ts
describe("projectMedicationSlots", () => {
  function project(
    schedules: MedicationSchedule[],
    opts: { med?: Medication; lastTakenAt?: Date | null } = {},
  ): string[] {
    return projectMedicationSlots({
      med: opts.med ?? makeMed(),
      schedules,
      fixedInstants: projectFixedTimes(schedules, UTC_SEGMENTS, "UTC"),
      lastTakenAt: opts.lastTakenAt ?? null,
      segments: UTC_SEGMENTS,
    }).map((s) => `${s.expectedTime.toISOString()} ${s.kind} ${s.segment}`);
  }

  function editedAt(schedule: MedicationSchedule, effectiveFrom: string): MedicationSchedule {
    return { ...schedule, effectiveFrom: new Date(effectiveFrom) };
  }

  it("assigns each slot to the segment containing its instant", () => {
    // 00:00 sits exactly on each boundary: projectStart is yesterday,
    // todayStart is today, end is tomorrow's first hour.
    expect(project([makeFixedTimeSchedule("med-1", "00:00")])).toEqual([
      "2026-04-15T00:00:00.000Z fixed_time yesterday",
      "2026-04-16T00:00:00.000Z fixed_time today",
      "2026-04-17T00:00:00.000Z fixed_time tomorrow",
    ]);
  });

  it("anchors interval rows on lastTakenAt across the whole range", () => {
    const lastTakenAt = new Date("2026-04-14T22:00:00Z");
    expect(project([makeIntervalSchedule("med-1", "8")], { lastTakenAt })).toEqual([
      "2026-04-15T06:00:00.000Z interval yesterday",
      "2026-04-15T14:00:00.000Z interval yesterday",
      "2026-04-15T22:00:00.000Z interval yesterday",
      "2026-04-16T06:00:00.000Z interval today",
      "2026-04-16T14:00:00.000Z interval today",
      "2026-04-16T22:00:00.000Z interval today",
    ]);
  });

  it("re-anchors on a taken dose inside the range: earlier interval points stop existing", () => {
    const lastTakenAt = new Date("2026-04-16T09:30:00Z");
    expect(project([makeIntervalSchedule("med-1", "8")], { lastTakenAt })).toEqual([
      "2026-04-16T09:30:00.000Z interval today",
      "2026-04-16T17:30:00.000Z interval today",
    ]);
  });

  it("gives a never-taken interval medication one grid per segment, each from its own start", () => {
    // 7h does not divide 24h, so one grid run from projectStart would put
    // today's points at 04:00, 11:00, 18:00. Per segment, today's grid is
    // the 00:00 / 07:00 / 14:00 / 21:00 a single-day projection has always
    // drawn, and nothing slides as the day goes on.
    expect(project([makeIntervalSchedule("med-1", "7")])).toEqual([
      "2026-04-15T00:00:00.000Z interval yesterday",
      "2026-04-15T07:00:00.000Z interval yesterday",
      "2026-04-15T14:00:00.000Z interval yesterday",
      "2026-04-15T21:00:00.000Z interval yesterday",
      "2026-04-16T00:00:00.000Z interval today",
      "2026-04-16T07:00:00.000Z interval today",
      "2026-04-16T14:00:00.000Z interval today",
      "2026-04-16T21:00:00.000Z interval today",
      "2026-04-17T00:00:00.000Z interval tomorrow",
    ]);
  });

  it("drops an interval point within 1h of a fixed slot in its own segment", () => {
    // A 24h interval row anchored on yesterday's 08:55 log drifts onto 08:55
    // beside the declared 09:00: the same intended dose, not a second one.
    const schedules = [
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ];
    expect(project(schedules, { lastTakenAt: new Date("2026-04-15T08:55:00Z") })).toEqual([
      "2026-04-15T09:00:00.000Z fixed_time yesterday",
      "2026-04-16T09:00:00.000Z fixed_time today",
    ]);
  });

  it("never suppresses an interval point because of a fixed slot in another segment", () => {
    // Today's 00:10 is 40 minutes after YESTERDAY's 23:30 — a different dose
    // on a different day. Cross-day suppression would delete it, and
    // tomorrow's 00:10 beside today's 23:30 with it.
    const schedules = [
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "23:30", null, 1),
    ];
    expect(project(schedules, { lastTakenAt: new Date("2026-04-15T00:10:00Z") })).toEqual([
      "2026-04-15T00:10:00.000Z interval yesterday",
      "2026-04-15T23:30:00.000Z fixed_time yesterday",
      "2026-04-16T00:10:00.000Z interval today",
      "2026-04-16T23:30:00.000Z fixed_time today",
      "2026-04-17T00:10:00.000Z interval tomorrow",
    ]);
  });

  it("keeps the fixed_time kind on an exact interval/fixed collision", () => {
    const schedules = [
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ];
    expect(project(schedules, { lastTakenAt: new Date("2026-04-15T09:00:00Z") })).toEqual([
      "2026-04-15T09:00:00.000Z fixed_time yesterday",
      "2026-04-16T09:00:00.000Z fixed_time today",
    ]);
  });

  it("drops every slot before startedAt: created at 14:00, no 08:00 and no yesterday", () => {
    const med = makeMed({ startedAt: new Date("2026-04-16T14:00:00Z") });
    const schedules = [
      makeFixedTimeSchedule("med-1", "08:00", null, 0),
      makeFixedTimeSchedule("med-1", "20:00", null, 1),
    ];
    expect(project(schedules, { med })).toEqual(["2026-04-16T20:00:00.000Z fixed_time today"]);
  });

  it("clips a never-taken interval grid at startedAt too", () => {
    const med = makeMed({ startedAt: new Date("2026-04-16T14:00:00Z") });
    expect(project([makeIntervalSchedule("med-1", "8")], { med })).toEqual([
      "2026-04-16T16:00:00.000Z interval today",
      "2026-04-17T00:00:00.000Z interval tomorrow",
    ]);
  });

  it("drops every slot after endedAt", () => {
    const med = makeMed({ endedAt: new Date("2026-04-16T12:00:00Z") });
    const schedules = [
      makeFixedTimeSchedule("med-1", "08:00", null, 0),
      makeFixedTimeSchedule("med-1", "20:00", null, 1),
    ];
    expect(project(schedules, { med })).toEqual([
      "2026-04-15T08:00:00.000Z fixed_time yesterday",
      "2026-04-15T20:00:00.000Z fixed_time yesterday",
      "2026-04-16T08:00:00.000Z fixed_time today",
    ]);
  });

  it("keeps a slot exactly at startedAt and one exactly at endedAt", () => {
    const med = makeMed({
      startedAt: new Date("2026-04-16T08:00:00Z"),
      endedAt: new Date("2026-04-16T20:00:00Z"),
    });
    const schedules = [
      makeFixedTimeSchedule("med-1", "08:00", null, 0),
      makeFixedTimeSchedule("med-1", "20:00", null, 1),
    ];
    expect(project(schedules, { med })).toEqual([
      "2026-04-16T08:00:00.000Z fixed_time today",
      "2026-04-16T20:00:00.000Z fixed_time today",
    ]);
  });

  it("drops a yesterday slot older than the schedule's last save", () => {
    // The evening dose moved from 20:00 to 22:00 at 07:00 this morning. The
    // rows now say 22:00, but yesterday was a 20:00 day: "Due yesterday
    // 22:00" beside yesterday's 20:05 dose would invite a double dose.
    const schedules = [editedAt(makeFixedTimeSchedule("med-1", "22:00"), "2026-04-16T07:00:00Z")];
    expect(project(schedules)).toEqual(["2026-04-16T22:00:00.000Z fixed_time today"]);
  });

  it("leaves today's slots alone, even ones before the save", () => {
    const schedules = [
      editedAt(makeFixedTimeSchedule("med-1", "06:00", null, 0), "2026-04-16T07:00:00Z"),
      editedAt(makeFixedTimeSchedule("med-1", "22:00", null, 1), "2026-04-16T07:00:00Z"),
    ];
    expect(project(schedules)).toEqual([
      "2026-04-16T06:00:00.000Z fixed_time today",
      "2026-04-16T22:00:00.000Z fixed_time today",
    ]);
  });

  it("measures the save from the EARLIEST effectiveFrom across the medication's rows", () => {
    const schedules = [
      editedAt(makeFixedTimeSchedule("med-1", "06:00", null, 0), "2026-04-15T12:00:00Z"),
      editedAt(makeFixedTimeSchedule("med-1", "22:00", null, 1), "2026-04-16T07:00:00Z"),
    ];
    expect(project(schedules)).toEqual([
      "2026-04-15T22:00:00.000Z fixed_time yesterday",
      "2026-04-16T06:00:00.000Z fixed_time today",
      "2026-04-16T22:00:00.000Z fixed_time today",
    ]);
  });

  it("is pure arithmetic: it never reads a timezone", () => {
    // slotActions re-runs this once per simulated write. The one
    // timezone-aware step, projectFixedTimes, is computed once outside it —
    // re-projecting inside would cost ~0.3s per dashboard load.
    const timezone = "Europe/London";
    const segments = segmentsFor(dashboardWindow(new Date("2026-10-25T12:00:00Z"), timezone));
    const schedules = [
      makeIntervalSchedule("med-1", "8"),
      makeFixedTimeSchedule("med-1", "23:30", null, 1),
    ];
    const fixedInstants = projectFixedTimes(schedules, segments, timezone);

    const formatToParts = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
    try {
      const slots = projectMedicationSlots({
        med: makeMed(),
        schedules,
        fixedInstants,
        lastTakenAt: new Date("2026-10-24T21:00:00Z"),
        segments,
      });
      expect(slots.length).toBeGreaterThan(0);
      expect(formatToParts).not.toHaveBeenCalled();
    } finally {
      formatToParts.mockRestore();
    }
  });
});
```

The purity test spies on `formatToParts` rather than on the `Intl.DateTimeFormat` constructor. `isoDayKey` and `wallClockToInstant` both call `formatToParts`, and after T1 memoises the formatters a constructor spy would see nothing.

- [ ] **Step 7: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL. Fifteen tests fail, all with `TypeError: projectMedicationSlots is not a function` (`Tests  15 failed | 46 passed (61)`).

- [ ] **Step 8: Implement `projectMedicationSlots`**

In `src/lib/utils/schedule.ts`, insert immediately after the closing brace of `projectFixedTimes` (still before the `computeScheduleSlots` doc comment):

```ts
function segmentOf(ms: number, segments: Segments): ProjectedSlot["segment"] {
  if (ms < segments.todayStart.getTime()) return "yesterday";
  if (ms < segments.end.getTime()) return "today";
  return "tomorrow";
}

/**
 * One medication's slots over the three segments, deduplicated and ascending.
 *
 * Pure arithmetic: no `Intl`, no `isoDayKey`, no `wallClockToInstant`. The
 * only timezone-dependent input is `fixedInstants`, from `projectFixedTimes`.
 *
 * - **Interval rows** anchor on `lastTakenAt` and step by whole intervals
 *   across the range. With no taken dose ever, each segment gets its own grid
 *   anchored at that segment's start, so today's grid is exactly the one a
 *   single-day projection has always drawn and nothing slides during the day.
 * - **Exact collision**: an interval point on a fixed instant is that fixed
 *   slot; the declared schedule, not the derived projection, is canonical.
 * - **Drifted twin, per segment**: interval projections drift with the user's
 *   behaviour (log at 08:55 → project 08:55). One within the matching
 *   tolerance of a declared fixed slot IN THE SAME SEGMENT is the same
 *   intended dose and is dropped. Across segments it is not: yesterday's
 *   23:30 must not delete today's 00:10.
 * - **Lifecycle clip**: nothing outside `[startedAt, endedAt]`. A medication
 *   created at 14:00 has no 08:00 slot and no yesterday.
 * - **Schedule-edit clip** (before `todayStart` only): every save rewrites a
 *   medication's schedule rows with `effectiveFrom = now`, so the current rows
 *   say nothing about what was scheduled before that save. A yesterday slot
 *   earlier than the medication's earliest `effectiveFrom` is dropped rather
 *   than shown as outstanding beside the dose that was actually due then.
 *   Today's slots are unaffected.
 */
export function projectMedicationSlots(input: {
  med: Medication;
  schedules: MedicationSchedule[];
  fixedInstants: Date[];
  lastTakenAt: Date | null;
  segments: Segments;
}): ProjectedSlot[] {
  const { med, schedules, fixedInstants, lastTakenAt, segments } = input;

  const kindAt = new Map<number, ScheduleKind>();
  for (const t of fixedInstants) kindAt.set(t.getTime(), "fixed_time");

  const segmentRanges: Array<[Date, Date]> = [
    [segments.projectStart, segments.todayStart],
    [segments.todayStart, segments.end],
    [segments.end, segments.projectEnd],
  ];
  for (const schedule of schedules) {
    if (schedule.scheduleKind !== "interval") continue;
    const intervalHours = parseIntervalHours(schedule.intervalHours);
    if (intervalHours === null) continue;
    const points = lastTakenAt
      ? expectedTimesForInterval(
          intervalHours,
          lastTakenAt,
          segments.projectStart,
          segments.projectEnd,
        )
      : segmentRanges.flatMap(([from, to]) =>
          expectedTimesForInterval(intervalHours, from, from, to),
        );
    for (const t of points) {
      // Set only when absent: an exact collision keeps fixed_time.
      if (!kindAt.has(t.getTime())) kindAt.set(t.getTime(), "interval");
    }
  }

  const candidates = [...kindAt].map(([ms, kind]) => ({
    ms,
    kind,
    segment: segmentOf(ms, segments),
  }));

  const startedMs = new Date(med.startedAt).getTime();
  const endedMs = med.endedAt ? new Date(med.endedAt).getTime() : Infinity;
  const todayStartMs = segments.todayStart.getTime();
  const effectiveFromMs = Math.min(...schedules.map((s) => new Date(s.effectiveFrom).getTime()));

  const fixed = candidates.filter((c) => c.kind === "fixed_time");

  return candidates
    .filter(
      (c) =>
        c.kind === "fixed_time" ||
        !fixed.some((f) => f.segment === c.segment && Math.abs(f.ms - c.ms) <= MATCH_TOLERANCE_MS),
    )
    .filter((c) => !(c.ms < startedMs) && !(c.ms > endedMs))
    .filter((c) => !(c.ms < todayStartMs && c.ms < effectiveFromMs))
    .sort((a, b) => a.ms - b.ms)
    .map((c) => ({ expectedTime: new Date(c.ms), kind: c.kind, segment: c.segment }));
}
```

Notes for the executor:

- Twin suppression runs before the clips on purpose. The twin is "the same intended dose", so when a fixed slot is clipped its drifted twin goes with it.
- The clips are written as negated comparisons (`!(c.ms < startedMs)`) so that an unparseable date, which compares as `NaN`, keeps the slot rather than silently deleting it.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/dashboard-timing-status.test.ts`
Expected: PASS (`Tests  181 passed`; `computeScheduleSlots` is not wired yet, so every pre-existing case is untouched).

- [ ] **Step 10: Prove by mutation.** Make each edit to `src/lib/utils/schedule.ts` on its own, run `npx vitest run tests/unit/schedule.test.ts`, watch the named test fail, then restore the line.
  1. In the twin filter, delete `f.segment === c.segment && `.
     Fails: "never suppresses an interval point because of a fixed slot in another segment".
  2. Delete the line `.filter((c) => !(c.ms < startedMs) && !(c.ms > endedMs))`.
     Fails: "drops every slot before startedAt…", "clips a never-taken interval grid at startedAt too", "drops every slot after endedAt" and "keeps a slot exactly at startedAt and one exactly at endedAt".
  3. Delete the line `.filter((c) => !(c.ms < todayStartMs && c.ms < effectiveFromMs))`.
     Fails: "drops a yesterday slot older than the schedule's last save", "leaves today's slots alone, even ones before the save" and "measures the save from the EARLIEST effectiveFrom…".
  4. Change `Math.min(...schedules.map` to `Math.max(...schedules.map`.
     Fails: "measures the save from the EARLIEST effectiveFrom across the medication's rows".
  5. Replace the `segmentRanges.flatMap(...)` arm with `expectedTimesForInterval(intervalHours, segments.projectStart, segments.projectStart, segments.projectEnd)`.
     Fails: "gives a never-taken interval medication one grid per segment, each from its own start".
  6. Change `if (!kindAt.has(t.getTime())) kindAt.set(t.getTime(), "interval");` to `kindAt.set(t.getTime(), "interval");`.
     Fails: "keeps the fixed_time kind on an exact interval/fixed collision".
  7. Change `for (const t of fixedInstants) kindAt.set(t.getTime(), "fixed_time");` to `for (const t of fixedInstants) { isoDayKey(t, "UTC"); kindAt.set(t.getTime(), "fixed_time"); }`.
     Fails: "is pure arithmetic: it never reads a timezone".

- [ ] **Step 11: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat(schedule): project a medication's slots arithmetically, with lifecycle and schedule-edit clips"
```

- [ ] **Step 12: Write the failing tests for `matchMedicationSlots`, the new `ScheduleSlot` fields and the window path**

(a) In `tests/unit/schedule.test.ts`, replace the whole import block (from `import { describe, it, expect, vi } from "vitest";` through the `import type` line) with:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  classifyHour,
  computeScheduleSlots,
  dashboardWindow,
  groupSlotsByTimeOfDay,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  singleDaySegments,
  timingStatusFromSlots,
} from "$lib/utils/schedule";
import type {
  MatchDose,
  ProjectedSlot,
  ScheduleSlot,
  ScheduleSlotStatus,
  Segments,
} from "$lib/utils/schedule";
```

Append to the end of the file:

```ts
describe("matchMedicationSlots — today's ±1h capacity rule", () => {
  const now = new Date("2026-04-16T12:00:00Z");
  const opts = { now, segments: UTC_SEGMENTS, pass2Bound: UTC_SEGMENTS.todayStart };

  function slotAt(iso: string): ProjectedSlot {
    return { expectedTime: new Date(iso), kind: "fixed_time", segment: "today" };
  }

  function dose(
    id: string,
    iso: string,
    status: MatchDose["status"] = "taken",
    quantity = 1,
  ): MatchDose {
    return { id, takenAt: new Date(iso), status, quantity };
  }

  it("splits a match into resolvedByDoseId and missedByDoseId", () => {
    const slots = [
      slotAt("2026-04-16T08:00:00Z"),
      slotAt("2026-04-16T09:00:00Z"),
      slotAt("2026-04-16T10:00:00Z"),
    ];
    const doses = [
      dose("d-taken", "2026-04-16T08:10:00Z"),
      dose("d-skip", "2026-04-16T09:10:00Z", "skipped"),
      dose("d-missed", "2026-04-16T10:10:00Z", "missed"),
    ];
    const matched = matchMedicationSlots(slots, doses, opts);
    expect(
      matched.map((m) => [m.status, m.resolvedByDoseId, m.missedByDoseId, m.kind, m.segment]),
    ).toEqual([
      ["taken", "d-taken", null, "fixed_time", "today"],
      ["skipped", "d-skip", null, "fixed_time", "today"],
      // A missed row resolves nothing: the slot stays outstanding.
      ["overdue", null, "d-missed", "fixed_time", "today"],
    ]);
  });

  it("visits slots ascending whatever order they arrive in", () => {
    // Ascending, 08:30 is first to reach the 09:10 dose. Visited in the
    // order given, 09:30 would take it instead.
    const slots = [
      slotAt("2026-04-16T09:30:00Z"),
      slotAt("2026-04-16T09:00:00Z"),
      slotAt("2026-04-16T08:30:00Z"),
    ];
    const matched = matchMedicationSlots(slots, [dose("d1", "2026-04-16T09:10:00Z")], opts);
    expect(matched.map((m) => [m.expectedTime.toISOString(), m.resolvedByDoseId])).toEqual([
      ["2026-04-16T08:30:00.000Z", "d1"],
      ["2026-04-16T09:00:00.000Z", null],
      ["2026-04-16T09:30:00.000Z", null],
    ]);
  });

  it("reads an unmatched slot at or before now as overdue, after it as upcoming", () => {
    const matched = matchMedicationSlots(
      [slotAt("2026-04-16T12:00:00Z"), slotAt("2026-04-16T12:00:00.001Z")],
      [],
      opts,
    );
    expect(matched.map((m) => m.status)).toEqual(["overdue", "upcoming"]);
  });
});

describe("computeScheduleSlots — slot fields", () => {
  it("labels kind, splits resolved from missed, and flags nothing earlier without a window", () => {
    const dayStart = new Date("2026-04-16T00:00:00Z");
    const dayEnd = new Date("2026-04-17T00:00:00Z");
    const sched = schedMap([
      makeIntervalSchedule("med-1", "12"),
      makeFixedTimeSchedule("med-1", "08:00", null, 1),
    ]);
    const doses = [
      makeDose({ id: "d-taken", takenAt: new Date("2026-04-16T00:10:00Z") }),
      makeDose({ id: "d-missed", takenAt: new Date("2026-04-16T08:10:00Z"), status: "missed" }),
    ];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots([makeMed()], sched, doses, {}, dayStart, dayEnd, "UTC", now);
    expect(
      slots.map((s) => ({
        expectedTime: s.expectedTime,
        kind: s.kind,
        status: s.status,
        matchedDoseId: s.matchedDoseId,
        resolvedByDoseId: s.resolvedByDoseId,
        missedByDoseId: s.missedByDoseId,
        isEarlier: s.isEarlier,
      })),
    ).toEqual([
      {
        expectedTime: "2026-04-16T00:00:00.000Z",
        kind: "interval",
        status: "taken",
        matchedDoseId: "d-taken",
        resolvedByDoseId: "d-taken",
        missedByDoseId: null,
        isEarlier: false,
      },
      {
        expectedTime: "2026-04-16T08:00:00.000Z",
        kind: "fixed_time",
        status: "overdue",
        matchedDoseId: "d-missed",
        resolvedByDoseId: null,
        missedByDoseId: "d-missed",
        isEarlier: false,
      },
      {
        expectedTime: "2026-04-16T12:00:00.000Z",
        kind: "interval",
        status: "upcoming",
        matchedDoseId: null,
        resolvedByDoseId: null,
        missedByDoseId: null,
        isEarlier: false,
      },
    ]);
  });

  it("with a window, returns yesterday's slots flagged isEarlier and never tomorrow's first hour", () => {
    const now = new Date("2026-04-16T10:00:00Z");
    const window = dashboardWindow(now, "UTC");
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "00:30", null, 0),
      makeFixedTimeSchedule("med-1", "08:00", null, 1),
    ]);
    const doses = [makeDose({ id: "d-yesterday", takenAt: new Date("2026-04-15T08:05:00Z") })];
    const slots = computeScheduleSlots(
      [makeMed()],
      sched,
      doses,
      {},
      window.todayStart,
      window.end,
      "UTC",
      now,
      { window },
    );
    expect(slots.map((s) => [s.expectedTime, s.isEarlier, s.status, s.resolvedByDoseId])).toEqual([
      ["2026-04-15T00:30:00.000Z", true, "overdue", null],
      ["2026-04-15T08:00:00.000Z", true, "taken", "d-yesterday"],
      ["2026-04-16T00:30:00.000Z", false, "overdue", null],
      ["2026-04-16T08:00:00.000Z", false, "overdue", null],
      // 2026-04-17T00:30 is projected (tomorrow's first hour) but never returned.
    ]);
  });
});
```

These fixtures deliberately avoid the cases T4 re-attributes: no dose sits exactly on a slot instant, no skip sits on a slot instant, no dose keeps spare capacity with an earlier open slot behind it, no match crosses a segment, and no missed row is on a future slot. So they hold unchanged once T4's passes land.

(b) In `tests/unit/dst-wall-clock.test.ts`, replace `:16`:

```ts
import { computeScheduleSlots } from "$lib/utils/schedule";
```

with:

```ts
import {
  computeScheduleSlots,
  dashboardWindow,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
} from "$lib/utils/schedule";
```

Replace the test opening and comment at `:515-523`:

```ts
  it("My Day cannot show a slot that rolled out of the day, and does not pretend to", () => {
    // The honest counterpart to the case above. Saturday 2026-03-28 in
    // Godthab ENDS at 23:00 local, because that is the instant the clocks
    // jump — so the 23:30 slot resolves to 01:30Z, past `endOfDay`, and the
    // window drops it. Sunday's timeline then excludes it on day-of-week.
    //
    // That is the correct reading of "show me Saturday", and the reminder
    // sweep is the surface that still fires the dose (previous test). What
    // is NOT acceptable is the old behaviour, where neither surface did.
```

with:

```ts
  it("a single-day call cannot show a slot that rolled out of the day, and does not pretend to", () => {
    // The honest counterpart to the case above, for a call WITHOUT a window.
    // Saturday 2026-03-28 in Godthab ENDS at 23:00 local, because that is the
    // instant the clocks jump — so the 23:30 slot resolves to 01:30Z, past
    // `endOfDay`, and a one-day range drops it. Sunday's one-day range then
    // excludes it on day-of-week.
    //
    // That is the correct reading of "show me Saturday", and these direct
    // calls still return nothing. The dashboard no longer asks that
    // question: its window projects from yesterday's key through tomorrow's
    // first hour, so the same slot is a matched-but-hidden tomorrow's-first-
    // hour slot at Saturday's view and a TODAY slot at Sunday's — the next
    // test. What is NOT acceptable is the old behaviour, where neither the
    // dashboard nor the reminder sweep fired the dose.
```

The rest of that test (`const timezone = …` through its closing `});`) is unchanged. Immediately before `  it("computeScheduleSlots reads the weekday off the day key too", () => {` (HEAD `:545`), insert:

```ts
it("the dashboard's window shows it: today's slot at Sunday's view, hidden at Saturday's", () => {
  const timezone = "America/Godthab";
  const schedules = [makeFixedTimeSchedule("23:30", { daysOfWeek: [6] })];
  const slotsAt = (now: Date) => {
    const window = dashboardWindow(now, timezone);
    return computeScheduleSlots(
      [makeMed()],
      new Map([["med-1", schedules]]),
      [] as DoseLogWithMedication[],
      {},
      window.todayStart,
      window.end,
      timezone,
      now,
      { window },
    );
  };

  // Sunday's window reaches back to Saturday's KEY, whose 23:30 resolves
  // into Sunday's today segment: 00:30 local, not an Earlier row.
  const sunday = slotsAt(new Date("2026-03-29T20:00:00Z"));
  expect(sunday.map((s) => [s.expectedTime, s.isEarlier])).toEqual([
    ["2026-03-29T01:30:00.000Z", false],
  ]);
  expect(localOf(new Date(sunday[0].expectedTime), timezone)).toBe("2026-03-29, 00:30");

  // At Saturday's view the same instant is past `end`: projected into
  // tomorrow's first hour, where it is matched but never returned.
  const saturdayNow = new Date("2026-03-28T20:00:00Z");
  const segments = segmentsFor(dashboardWindow(saturdayNow, timezone));
  const fixedInstants = projectFixedTimes(schedules, segments, timezone);
  const projected = projectMedicationSlots({
    med: makeMed(),
    schedules,
    fixedInstants,
    lastTakenAt: null,
    segments,
  });
  expect(projected.map((s) => [s.expectedTime.toISOString(), s.segment])).toEqual([
    ["2026-03-29T01:30:00.000Z", "tomorrow"],
  ]);
  expect(slotsAt(saturdayNow)).toEqual([]);
});
```

(`makeMed`, `makeFixedTimeSchedule(timeOfDay, overrides)` and `localOf` are that file's own helpers at `:387`, `:424` and `:47`.)

- [ ] **Step 13: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: FAIL (`Tests  6 failed | 172 passed (178)`):

- Three matchMedicationSlots tests fail with `TypeError: matchMedicationSlots is not a function`.
- "labels kind, splits resolved from missed…" fails with an `AssertionError`: `kind` and the new id fields are `undefined`.
- "with a window, returns yesterday's slots…" fails with an `AssertionError`: the `{ window }` argument is still ignored, so only today's two slots come back.
- The dst test "the dashboard's window shows it…" fails with `AssertionError: expected [] to deeply equal [ Array(1) ]`.

`svelte-check` also flags the new fields and the ninth argument until Step 14. Vitest does not type-check.

- [ ] **Step 14: Implement the slot fields, `matchMedicationSlots` and the new `computeScheduleSlots`**

In `src/lib/utils/schedule.ts`:

(a) Replace the whole `export interface ScheduleSlot { … }` block (HEAD `:8-19`) with:

```ts
export interface ScheduleSlot {
  medicationId: string;
  medicationName: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  dosageAmount: string;
  dosageUnit: string;
  expectedTime: string; // ISO string
  kind: ScheduleKind;
  status: ScheduleSlotStatus;
  /** `resolvedByDoseId ?? missedByDoseId ?? null`, kept for existing readers. */
  matchedDoseId: string | null;
  /** The taken or skipped dose that resolved this slot. Covers and toasts read this. */
  resolvedByDoseId: string | null;
  /** A `missed` row matched to this slot. A missed row never resolves a slot. */
  missedByDoseId: string | null;
  /** `expectedTime < todayStart`, by instant: an "Earlier" row on the dashboard. */
  isEarlier: boolean;
}
```

(b) Delete the entire `function expectedTimesForFixedTime(…) { … }` (HEAD `:105-133`). `projectFixedTimes` replaces it.

(c) Insert immediately after the closing brace of `projectMedicationSlots`:

```ts
/** A dose as the matcher sees it. */
export interface MatchDose {
  id: string;
  takenAt: Date;
  status: "taken" | "skipped" | "missed";
  quantity: number;
}

export interface MatchedSlot extends ProjectedSlot {
  status: ScheduleSlotStatus;
  resolvedByDoseId: string | null;
  missedByDoseId: string | null;
}

/**
 * Match one medication's doses to its projected slots.
 *
 * Capacity-based: a single logged dose can satisfy several nearby slots, up
 * to the number of units actually taken. A `taken` dose has a capacity equal
 * to its quantity (so logging ×3 in one go covers up to three slots within
 * the tolerance); a `skipped` or `missed` row can only ever clear one slot.
 *
 * Slots are visited ascending. Each takes the best dose within
 * ±`MATCH_TOLERANCE_MS` that still has capacity: a real `taken` dose over a
 * `skipped`/`missed` one, then the nearest in time, then the smaller id, so
 * the output never depends on the order `doses` arrives in.
 *
 * A `missed` row goes to `missedByDoseId` and resolves nothing; anything
 * else goes to `resolvedByDoseId`.
 */
export function matchMedicationSlots(
  slots: ProjectedSlot[],
  doses: MatchDose[],
  opts: { now: Date; segments: Segments; pass2Bound: Date },
): MatchedSlot[] {
  const nowMs = opts.now.getTime();
  const remaining = new Map<string, number>();
  for (const d of doses) {
    remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
  }

  const ordered = [...slots].sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());
  return ordered.map((slot) => {
    const expectedMs = slot.expectedTime.getTime();

    let matched: MatchDose | undefined;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const d of doses) {
      if ((remaining.get(d.id) ?? 0) <= 0) continue;
      const dist = Math.abs(d.takenAt.getTime() - expectedMs);
      if (dist > MATCH_TOLERANCE_MS) continue;
      const rank = d.status === "taken" ? 0 : 1;
      const better =
        rank < bestRank ||
        (rank === bestRank && dist < bestDist) ||
        (rank === bestRank && dist === bestDist && (!matched || d.id < matched.id));
      if (better) {
        matched = d;
        bestRank = rank;
        bestDist = dist;
      }
    }
    if (matched) remaining.set(matched.id, (remaining.get(matched.id) ?? 0) - 1);

    let status: ScheduleSlotStatus;
    if (matched?.status === "taken") status = "taken";
    else if (matched?.status === "skipped") status = "skipped";
    // A "missed" dose row hasn't actually been consumed, so the slot is
    // still unfulfilled — render it as overdue, not green-check taken.
    else if (matched?.status === "missed") status = "overdue";
    else status = expectedMs <= nowMs ? "overdue" : "upcoming";

    return {
      ...slot,
      status,
      resolvedByDoseId: matched && matched.status !== "missed" ? matched.id : null,
      missedByDoseId: matched?.status === "missed" ? matched.id : null,
    };
  });
}
```

(d) Replace the whole of `computeScheduleSlots`, from its doc comment `/**\n * Compute expected dose schedule slots for the window.` through the function's closing brace (just before `/**\n * Group schedule slots into time-of-day sections.`), with:

```ts
/**
 * Compute expected dose schedule slots.
 *
 * With `opts.window` the projection spans the dashboard's three segments
 * (`segmentsFor`): yesterday, today and tomorrow's first hour. Without it,
 * one segment `[dayStartUtc, dayEndUtc)` and nothing either side
 * (`singleDaySegments`). Either way the steps are the same, per medication:
 * `projectFixedTimes` (the one timezone-aware step), `projectMedicationSlots`
 * (arithmetic, including both clips), then `matchMedicationSlots`.
 *
 * Returns only slots before `end`: tomorrow's first hour is matched, so that
 * today's view makes the choice tomorrow's view will make, but never returned.
 * `isEarlier` flags a slot before `todayStart`; deciding which of those are
 * still visible belongs to the caller.
 */
export function computeScheduleSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  doses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
  opts: { window?: DashboardWindow } = {},
): ScheduleSlot[] {
  const segments = opts.window
    ? segmentsFor(opts.window)
    : singleDaySegments(dayStartUtc, dayEndUtc);
  const pass2Bound = opts.window ? opts.window.visibleStart : dayStartUtc;
  const endMs = segments.end.getTime();
  const todayStartMs = segments.todayStart.getTime();

  const dosesByMedId = new Map<string, MatchDose[]>();
  for (const dose of doses) {
    let arr = dosesByMedId.get(dose.medicationId);
    if (!arr) {
      arr = [];
      dosesByMedId.set(dose.medicationId, arr);
    }
    arr.push({
      id: dose.id,
      takenAt: new Date(dose.takenAt),
      status: dose.status,
      quantity: dose.quantity,
    });
  }

  const slots: ScheduleSlot[] = [];
  for (const med of medications) {
    const schedules = schedulesByMedId.get(med.id) ?? [];
    if (schedules.length === 0) continue;

    const projected = projectMedicationSlots({
      med,
      schedules,
      fixedInstants: projectFixedTimes(schedules, segments, timezone),
      lastTakenAt: lastDoseByMedication[med.id] ?? null,
      segments,
    });
    if (projected.length === 0) continue;

    const matched = matchMedicationSlots(projected, dosesByMedId.get(med.id) ?? [], {
      now,
      segments,
      pass2Bound,
    });

    for (const slot of matched) {
      const ms = slot.expectedTime.getTime();
      if (ms >= endMs) continue;
      slots.push({
        medicationId: med.id,
        medicationName: med.name,
        colour: med.colour,
        colourSecondary: med.colourSecondary,
        pattern: med.pattern,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        expectedTime: slot.expectedTime.toISOString(),
        kind: slot.kind,
        status: slot.status,
        matchedDoseId: slot.resolvedByDoseId ?? slot.missedByDoseId ?? null,
        resolvedByDoseId: slot.resolvedByDoseId,
        missedByDoseId: slot.missedByDoseId,
        isEarlier: ms < todayStartMs,
      });
    }
  }

  return slots;
}
```

(e) Two test fixtures build a `ScheduleSlot` literal and would fail `npm run check`. Add the four new fields to both.

In `tests/unit/schedule.test.ts` `slot()` (HEAD `:669-682`), replace:

```ts
      expectedTime: iso,
      status,
      matchedDoseId: null,
    };
```

with:

```ts
      expectedTime: iso,
      kind: "fixed_time",
      status,
      matchedDoseId: null,
      resolvedByDoseId: null,
      missedByDoseId: null,
      isEarlier: false,
    };
```

In `tests/unit/my-day-timeline-ssr.test.ts` `slot()` (`:31-46`), replace:

```ts
    expectedTime: "2026-05-01T09:00:00.000Z",
    status,
    matchedDoseId: null,
    ...overrides,
```

with:

```ts
    expectedTime: "2026-05-01T09:00:00.000Z",
    kind: "fixed_time",
    status,
    matchedDoseId: null,
    resolvedByDoseId: null,
    missedByDoseId: null,
    isEarlier: false,
    ...overrides,
```

The only production caller, `src/routes/(app)/dashboard/+page.server.ts:67`, passes eight arguments and no window. It compiles unchanged and keeps today's single-day behaviour, except for the lifecycle clip, which the spec intends.

- [ ] **Step 15: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/my-day-timeline-ssr.test.ts tests/unit/dashboard-timing-status.test.ts`
Expected: PASS (`Tests  187 passed (187)`). Every pre-existing `computeScheduleSlots` case keeps its outcome.

- [ ] **Step 16: Prove by mutation.** Make each edit on its own, run `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`, watch the named tests fail, then restore.
  1. In `computeScheduleSlots`, delete `if (ms >= endMs) continue;`.
     Fails: "with a window, returns yesterday's slots flagged isEarlier and never tomorrow's first hour" and the dst test "the dashboard's window shows it: today's slot at Sunday's view, hidden at Saturday's".
  2. In `matchMedicationSlots`, replace `const ordered = [...slots].sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());` with `const ordered = slots;`.
     Fails: "visits slots ascending whatever order they arrive in".

- [ ] **Step 17: Update the two references to the deleted `expectedTimesForFixedTime`**

In `src/lib/utils/time.ts`, in the `wallClockToInstant` doc comment, replace the line

```ts
 * This is exactly why `expectedTimesForFixedTime` and `computeOverdueSlot`
```

with

```ts
 * This is exactly why `projectFixedTimes` (utils/schedule.ts) and `computeOverdueSlot`
```

In `CLAUDE.md:32`, replace the phrase

`The practical consequence: `expectedTimesForFixedTime`and`computeOverdueSlot`take their day-of-week from`dayOfWeekForDayKey(dateStr)``

with

`The practical consequence: `projectFixedTimes` (`utils/schedule.ts`) and `computeOverdueSlot`take their day-of-week from`dayOfWeekForDayKey(dayKey)``

Leave the rest of that bullet unchanged.

Confirm nothing else names it: `grep -rn "expectedTimesForFixedTime" src tests CLAUDE.md`.
Expected: no output. (Old plans under `docs/superpowers/plans/` mention it historically and stay as written.)

- [ ] **Step 18: Full verification**

Run each of these:

- `npx vitest run`. Expected: PASS, with every file green (was 124 files / 1962 tests on the pre-T1 baseline plus this task).
- `npm run check`. Expected: `0 ERRORS`. The existing warnings in `settings/appearance` and `settings/notifications` are pre-existing.
- `npm run lint`. Expected: no new warnings in `src/lib/utils/schedule.ts` or the touched tests.
- `npx prettier --check src/lib/utils/schedule.ts src/lib/utils/time.ts tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/my-day-timeline-ssr.test.ts CLAUDE.md`. Expected: "All matched files use Prettier code style!".

- [ ] **Step 19: Commit**

```bash
git add src/lib/utils/schedule.ts src/lib/utils/time.ts CLAUDE.md tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/my-day-timeline-ssr.test.ts
git commit -m "feat(schedule): match per medication over the window and carry kind, isEarlier and resolved/missed ids on each slot"
```

---

### Task 4: Slot matching — passes 0–2 inside `matchMedicationSlots`

Before you start, this is what T1–T3 already left in `src/lib/utils/schedule.ts` (per the shared contract):

- `MATCH_TOLERANCE_MS`, `CARRY_OVER_MS`, `DashboardWindow`, `dashboardWindow()`
- `ScheduleKind`, `Segments`, `segmentsFor()`, `singleDaySegments()`, `ProjectedSlot`, `projectFixedTimes()`, `projectMedicationSlots()`, `MatchDose`, `MatchedSlot`
- `matchMedicationSlots()`. For now its only matching is **today's** pass 1: symmetric ±1h capacity matching, ascending.
- `computeScheduleSlots(…, opts?: { window?: DashboardWindow })`.

This task replaces the body of `matchMedicationSlots` with the spec's pass 0, reserved skips, pass 1 with the segment limit, and pass 2. It also fixes the `pass2Bound` that `computeScheduleSlots` passes in. The rules are in Section 2 "Three passes" and "Status" of `docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md`.

The plan works in four test-first cycles, then a docs step:

1. Pass 0 and reserved skips.
2. The segment limit.
3. Pass 2 and the missed-row status rule.
4. The seeded properties file, with its verbatim oracle.

Every expected red/green result and every mutation below was checked against a standalone re-implementation of the contract, so the counts are real. They were **not** run against the T3 code, which did not exist when this plan was written.

**Files:**

- Modify: `src/lib/utils/schedule.ts`. Two places: the whole exported `matchMedicationSlots` function that T3 added, and the one `matchMedicationSlots(` call inside `computeScheduleSlots`. T3 decides the line numbers, so find both with `grep -n "matchMedicationSlots\|pass2Bound" src/lib/utils/schedule.ts`.
- Modify: `tests/unit/schedule.test.ts`, using these HEAD `1b53ad7` line numbers:
  - Add helpers after `makeDose` (ends at `:143`).
  - Change the `:477` test and the `:527` test.
  - Append new `describe` blocks at the end of the file.
- Create: `tests/unit/helpers/legacy-slot-matcher.ts`
- Create: `tests/unit/schedule-matching-properties.test.ts`
- Modify: `CLAUDE.md:49-50`. Add two bullets between the "Archiving" bullet (`:49`) and the "`src/lib/server/analytics/page-data.ts` owns…" bullet (`:50`).
- Test: `tests/unit/schedule.test.ts`, `tests/unit/schedule-matching-properties.test.ts`, `tests/unit/dst-wall-clock.test.ts` (regression only)

**Interfaces:**

- Consumes:
  - From T2 (`$lib/utils/schedule`):
    - `export const MATCH_TOLERANCE_MS = 60 * 60 * 1000`
    - `export interface DashboardWindow { now: Date; todayKey: string; todayStart: Date; end: Date; projectStart: Date; projectEnd: Date; visibleStart: Date; doseFetchFrom: Date; doseFetchTo: Date }`
    - `export function dashboardWindow(now: Date, tz: string): DashboardWindow`
  - From T3 (`$lib/utils/schedule`):
    - `export type ScheduleKind = "interval" | "fixed_time"`
    - `ScheduleSlot` now also has `kind`, `isEarlier`, `resolvedByDoseId` and `missedByDoseId`, with `matchedDoseId = resolvedByDoseId ?? missedByDoseId ?? null`
    - `export interface Segments { projectStart: Date; todayStart: Date; end: Date; projectEnd: Date }`
    - `export function segmentsFor(window: DashboardWindow): Segments`
    - `export function singleDaySegments(dayStart: Date, dayEnd: Date): Segments`
    - `export interface ProjectedSlot { expectedTime: Date; kind: ScheduleKind; segment: "yesterday" | "today" | "tomorrow" }`
    - `export function projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`
    - `export function projectMedicationSlots(input: { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; lastTakenAt: Date | null; segments: Segments }): ProjectedSlot[]`
    - `export interface MatchDose { id: string; takenAt: Date; status: "taken" | "skipped" | "missed"; quantity: number }`
    - `export interface MatchedSlot extends ProjectedSlot { status: ScheduleSlotStatus; resolvedByDoseId: string | null; missedByDoseId: string | null }`
    - `export function matchMedicationSlots(slots: ProjectedSlot[], doses: MatchDose[], opts: { now: Date; segments: Segments; pass2Bound: Date }): MatchedSlot[]`
    - `computeScheduleSlots(medications, schedulesByMedId, doses, lastDoseByMedication, dayStartUtc, dayEndUtc, timezone, now, opts?: { window?: DashboardWindow }): ScheduleSlot[]`
  - Existing: `wallClockToInstant`, `shiftDayKey`, `isoDayKey` and `dayOfWeekForDayKey` from `$lib/utils/time`, and `parseIntervalHours` from `$lib/utils/schedule-rate`.
- Produces:
  - `matchMedicationSlots(slots: ProjectedSlot[], doses: MatchDose[], opts: { now: Date; segments: Segments; pass2Bound: Date }): MatchedSlot[]`. The signature does not change; it now runs passes 0–2.
    - Resolved slot → `taken` or `skipped`, from the resolving dose.
    - Otherwise `overdue` if `expectedTime ≤ now`, else `upcoming`. This includes slots holding only a missed row.
  - `computeScheduleSlots` passes `pass2Bound = opts.window.visibleStart` when it has a window and `dayStartUtc` when it does not.
  - Test-only, in `tests/unit/helpers/legacy-slot-matcher.ts`: `legacyComputeScheduleSlots(…)`, `LegacyScheduleSlot` and `LegacyScheduleSlotStatus`.

---

#### Cycle 1 — pass 0 and reserved skips

- [ ] **Step 1: Write the failing tests**

In `tests/unit/schedule.test.ts`, insert two helpers right after the closing `}` of `makeDose` (HEAD `:143`). `ScheduleSlot` and `ScheduleSlotStatus` are already imported on line 8.

```ts
/** No-window matching over UTC 2026-04-16 for one medication with these fixed times. */
function fixedDaySlots(times: string[], doses: DoseLogWithMedication[], now: Date): ScheduleSlot[] {
  return computeScheduleSlots(
    [makeMed()],
    schedMap(times.map((t, i) => makeFixedTimeSchedule("med-1", t, null, i))),
    doses,
    {},
    new Date("2026-04-16T00:00:00Z"),
    new Date("2026-04-17T00:00:00Z"),
    "UTC",
    now,
  );
}

/** [HH:MM, status, matchedDoseId] per slot, in slot order — UTC fixtures only. */
function outcome(slots: ScheduleSlot[]): [string, ScheduleSlotStatus, string | null][] {
  return slots.map((s) => [s.expectedTime.slice(11, 16), s.status, s.matchedDoseId]);
}
```

In the `:477` test ("a skipped dose clears at most one slot even if its quantity is >1"), replace these two lines:

```ts
expect(slots.filter((s) => s.status === "skipped")).toHaveLength(1);
expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
```

with:

```ts
expect(slots.filter((s) => s.status === "skipped")).toHaveLength(1);
expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
// Same count, different slot, on purpose. The skip sits exactly on the
// 09:00 instant, which makes it 09:00's RESERVED skip: a pass-1
// candidate for that slot only. Before reserved skips, pass 1's
// ascending greed gave it to 08:45.
expect(slots.find((s) => s.status === "skipped")?.expectedTime).toBe("2026-04-16T09:00:00.000Z");
```

In the `:527` test ("a quantity-1 dose still fills exactly one slot (regression)"), replace these two lines:

```ts
expect(slots.filter((s) => s.status === "taken")).toHaveLength(1);
expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
```

with:

```ts
expect(slots.filter((s) => s.status === "taken")).toHaveLength(1);
expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
// Same count, different slot, on purpose. The dose sits exactly on the
// 09:00 instant, so PASS 0 gives it 09:00 before pass 1 runs. Before
// pass 0, pass 1's ascending greed gave it to 08:30.
expect(slots.find((s) => s.status === "taken")?.expectedTime).toBe("2026-04-16T09:00:00.000Z");
```

Append at the end of the file:

```ts
describe("computeScheduleSlots — pass 0 (exact claims)", () => {
  it("a taken dose at exactly a slot's instant resolves that slot, not an open neighbour", () => {
    // "Took it at 09:00" next to an open 08:55. Without pass 0, pass 1's
    // ascending greed hands the 09:00 dose to 08:55, and the row the user
    // tapped stays overdue.
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00.000Z") });
    const slots = fixedDaySlots(
      ["08:55", "09:00", "11:00"],
      [dose],
      new Date("2026-04-16T13:30:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["08:55", "overdue", null],
      ["09:00", "taken", "dose-1"],
      ["11:00", "overdue", null],
    ]);
  });

  it("is exact to the millisecond — one millisecond late is pass 1's to place", () => {
    const now = new Date("2026-04-16T12:00:00Z");
    const exact = makeDose({ takenAt: new Date("2026-04-16T09:00:00.000Z") });
    const late = makeDose({ takenAt: new Date("2026-04-16T09:00:00.001Z") });
    expect(outcome(fixedDaySlots(["08:30", "09:00"], [exact], now))).toEqual([
      ["08:30", "overdue", null],
      ["09:00", "taken", "dose-1"],
    ]);
    expect(outcome(fixedDaySlots(["08:30", "09:00"], [late], now))).toEqual([
      ["08:30", "taken", "dose-1"],
      ["09:00", "overdue", null],
    ]);
  });

  it("breaks a tie at one instant by the smaller id", () => {
    const at = new Date("2026-04-16T09:00:00.000Z");
    const slots = fixedDaySlots(
      ["09:00"],
      [makeDose({ id: "dose-b", takenAt: at }), makeDose({ id: "dose-a", takenAt: at })],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(outcome(slots)).toEqual([["09:00", "taken", "dose-a"]]);
  });

  it("a skip never claims in pass 0 — a taken dose at the same instant wins and the skip stays inert", () => {
    const at = new Date("2026-04-16T09:00:00.000Z");
    const slots = fixedDaySlots(
      ["08:30", "09:00"],
      [
        makeDose({ id: "dose-skip", takenAt: at, status: "skipped" }),
        makeDose({ id: "dose-taken", takenAt: at }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    // "dose-skip" sorts before "dose-taken", so a pass 0 that let skips in
    // would give it 09:00. The skip is reserved for 09:00, so it cannot move
    // to 08:30 either.
    expect(outcome(slots)).toEqual([
      ["08:30", "overdue", null],
      ["09:00", "taken", "dose-taken"],
    ]);
  });

  it("pass 1 never re-claims a slot pass 0 resolved", () => {
    const slots = fixedDaySlots(
      ["09:00", "09:30"],
      [
        makeDose({ id: "dose-a", takenAt: new Date("2026-04-16T09:00:00.000Z") }),
        makeDose({ id: "dose-b", takenAt: new Date("2026-04-16T09:20:00Z") }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["09:00", "taken", "dose-a"],
      ["09:30", "taken", "dose-b"],
    ]);
  });
});

describe("computeScheduleSlots — reserved skips", () => {
  it("a skip at a slot's instant is that slot's own Skip, not an open neighbour's", () => {
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T09:00:00.000Z"),
      status: "skipped",
    });
    const slots = fixedDaySlots(["08:55", "09:00"], [skip], new Date("2026-04-16T13:30:00Z"));
    expect(outcome(slots)).toEqual([
      ["08:55", "overdue", null],
      ["09:00", "skipped", "dose-skip-1"],
    ]);
  });

  it("a real taken dose within the hour still beats a skip at the slot's instant (D7)", () => {
    const slots = fixedDaySlots(
      ["09:00"],
      [
        makeDose({
          id: "dose-skip-1",
          takenAt: new Date("2026-04-16T09:00:00.000Z"),
          status: "skipped",
        }),
        makeDose({ id: "dose-taken-1", takenAt: new Date("2026-04-16T09:20:00Z") }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(outcome(slots)).toEqual([["09:00", "taken", "dose-taken-1"]]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL. Exactly 6 tests fail, each with a `toEqual`/`toBe` mismatch that shows the dose or skip landing on the earlier slot (08:55, 08:30 or 08:45):

- "a taken dose at exactly a slot's instant resolves that slot, not an open neighbour"
- "is exact to the millisecond — one millisecond late is pass 1's to place"
- "a skip never claims in pass 0 — …"
- "a skip at a slot's instant is that slot's own Skip, not an open neighbour's"
- "a skipped dose clears at most one slot even if its quantity is >1"
- "a quantity-1 dose still fills exactly one slot (regression)"

Three tests pass already, because pass 1 alone gets them right. They pin behaviour that the mutations below prove:

- "breaks a tie at one instant by the smaller id"
- "pass 1 never re-claims a slot pass 0 resolved"
- "a real taken dose within the hour still beats …"

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/utils/schedule.ts`, replace the **whole** exported `matchMedicationSlots` function, from its JSDoc to its closing `}`, with the code below. If T3 added a private helper that only that function used, delete it too; `npm run lint` flags it as unused.

```ts
/**
 * Match one medication's projected slots to its doses.
 *
 * Every pass spends from ONE capacity map. A taken dose covers
 * `max(1, quantity)` slots; a skipped or missed row covers exactly one.
 *
 * - Pass 0 (taken only): a dose recorded at exactly a slot's instant claims
 *   that slot, with the smaller id winning a tie.
 * - Reserved skip: a skip at one of these slots' instants is that slot's own
 *   Skip. It is a pass-1 candidate for that slot only.
 * - Pass 1: the shipped ±MATCH_TOLERANCE_MS rule over the slots pass 0 left,
 *   ascending. Best by rank (taken 0, skipped/missed 1), then distance, then
 *   smaller id. A missed row goes to `missedByDoseId` and leaves the slot
 *   unresolved.
 */
export function matchMedicationSlots(
  slots: ProjectedSlot[],
  doses: MatchDose[],
  opts: { now: Date; segments: Segments; pass2Bound: Date },
): MatchedSlot[] {
  const nowMs = opts.now.getTime();
  const ordered = [...slots].sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());
  const slotMs = ordered.map((s) => s.expectedTime.getTime());
  const slotInstants = new Set(slotMs);
  const resolvedBy: (MatchDose | null)[] = ordered.map(() => null);
  const missedBy: (string | null)[] = ordered.map(() => null);

  const remaining = new Map<string, number>();
  for (const d of doses) {
    remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
  }
  const hasCapacity = (d: MatchDose) => (remaining.get(d.id) ?? 0) > 0;
  const spend = (d: MatchDose) => remaining.set(d.id, (remaining.get(d.id) ?? 0) - 1);
  const isReservedSkip = (d: MatchDose) =>
    d.status === "skipped" && slotInstants.has(d.takenAt.getTime());

  // Pass 0 — exact claims, taken only.
  for (let i = 0; i < ordered.length; i++) {
    let best: MatchDose | undefined;
    for (const d of doses) {
      if (d.status !== "taken" || !hasCapacity(d)) continue;
      if (d.takenAt.getTime() !== slotMs[i]) continue;
      if (!best || d.id < best.id) best = d;
    }
    if (best) {
      resolvedBy[i] = best;
      spend(best);
    }
  }

  // Pass 1 — the shipped ±1h rule over what pass 0 left, plus reserved skips.
  for (let i = 0; i < ordered.length; i++) {
    if (resolvedBy[i]) continue;
    const t = slotMs[i];
    let best: MatchDose | undefined;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const d of doses) {
      if (!hasCapacity(d)) continue;
      const at = d.takenAt.getTime();
      const dist = Math.abs(at - t);
      if (dist > MATCH_TOLERANCE_MS) continue;
      if (isReservedSkip(d) && at !== t) continue;
      const rank = d.status === "taken" ? 0 : 1;
      const better =
        rank < bestRank ||
        (rank === bestRank && dist < bestDist) ||
        (rank === bestRank && dist === bestDist && (!best || d.id < best.id));
      if (better) {
        best = d;
        bestRank = rank;
        bestDist = dist;
      }
    }
    if (!best) continue;
    spend(best);
    if (best.status === "missed") missedBy[i] = best.id;
    else resolvedBy[i] = best;
  }

  return ordered.map((slot, i) => {
    const by = resolvedBy[i];
    let status: ScheduleSlotStatus;
    if (by) status = by.status === "skipped" ? "skipped" : "taken";
    // The shipped rule, kept until pass 2 lands: a missed row keeps its slot overdue.
    else if (missedBy[i]) status = "overdue";
    else status = slotMs[i] <= nowMs ? "overdue" : "upcoming";
    return { ...slot, status, resolvedByDoseId: by?.id ?? null, missedByDoseId: missedBy[i] };
  });
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS. Everything is green, including every pre-existing case.

- [ ] **Step 5: Prove by mutation.** Apply each change on its own, run `npx vitest run tests/unit/schedule.test.ts`, check the named tests fail, then restore it.
  1. Delete the whole `// Pass 0` loop. These must fail: "a taken dose at exactly a slot's instant…", "is exact to the millisecond…", "a skip never claims in pass 0…" and "a quantity-1 dose still fills exactly one slot (regression)".
  2. In pass 0, change `if (!best || d.id < best.id) best = d;` to `if (!best) best = d;`. "breaks a tie at one instant by the smaller id" must fail.
  3. In pass 0, change `d.status !== "taken"` to `d.status === "missed"`. "a skip never claims in pass 0…" must fail.
  4. In pass 1, delete `if (resolvedBy[i]) continue;`. "pass 1 never re-claims a slot pass 0 resolved" must fail.
  5. Delete `if (isReservedSkip(d) && at !== t) continue;`. These must fail: "a skip at a slot's instant is that slot's own Skip…" and "a skipped dose clears at most one slot even if its quantity is >1".

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat(schedule): pass 0 exact claims and reserved skips in slot matching"
```

---

#### Cycle 2 — the segment limit

- [ ] **Step 1: Write the failing test**

In `tests/unit/schedule.test.ts`:

- Add `dashboardWindow` to the existing named import from `"$lib/utils/schedule"`. Skip this if T2/T3 already added it.
- Insert this helper directly under `outcome`:

```ts
function slotAt(slots: ScheduleSlot[], iso: string): ScheduleSlot {
  const slot = slots.find((s) => s.expectedTime === iso);
  if (!slot) {
    throw new Error(`no slot at ${iso}; slots are ${slots.map((s) => s.expectedTime).join(", ")}`);
  }
  return slot;
}
```

Append at the end of the file:

```ts
describe("computeScheduleSlots — the segment limit (with a window)", () => {
  it("a 00:10 dose goes to today's 00:13, not to yesterday's open 23:30", () => {
    // A slot from yesterday may only take a dose taken before today's
    // midnight. Without that limit, pass 1's ascending loop reaches
    // yesterday's 23:30 first and takes the 00:10 dose from the slot it was
    // meant for. Production (no yesterday at all) gave it to 00:13 too.
    const timezone = "UTC";
    const now = new Date("2026-04-16T01:00:00Z");
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "00:13", null, 0),
      makeFixedTimeSchedule("med-1", "23:30", null, 1),
    ]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T00:10:00Z") });
    const window = dashboardWindow(now, timezone);
    const slots = computeScheduleSlots(
      [makeMed()],
      sched,
      [dose],
      {},
      window.todayStart,
      window.end,
      timezone,
      now,
      { window },
    );
    expect(slotAt(slots, "2026-04-16T00:13:00.000Z")).toMatchObject({
      status: "taken",
      matchedDoseId: "dose-1",
      isEarlier: false,
    });
    expect(slotAt(slots, "2026-04-15T23:30:00.000Z")).toMatchObject({
      status: "overdue",
      matchedDoseId: null,
      isEarlier: true,
    });
  });
});
```

- [ ] **Step 2: Run the test and check it fails**

Run: `npx vitest run tests/unit/schedule.test.ts -t "segment limit"`
Expected: FAIL. `slotAt(…"2026-04-16T00:13:00.000Z")` has `status: "overdue"`, because yesterday's 23:30 took the dose.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/utils/schedule.ts`, insert this function directly above the `matchMedicationSlots` JSDoc:

```ts
/**
 * The segment limit: a dose is a pass-1 candidate for a slot only if it was
 * taken before the end of that slot's segment. Yesterday's segment ends at
 * today's midnight and today's at `end`; tomorrow's first hour has no limit.
 */
function segmentEndMs(segment: ProjectedSlot["segment"], segments: Segments): number {
  if (segment === "yesterday") return segments.todayStart.getTime();
  if (segment === "today") return segments.end.getTime();
  return Number.POSITIVE_INFINITY;
}
```

In pass 1 of `matchMedicationSlots`, replace:

```ts
const t = slotMs[i];
let best: MatchDose | undefined;
```

with:

```ts
const t = slotMs[i];
const segmentEnd = segmentEndMs(ordered[i].segment, opts.segments);
let best: MatchDose | undefined;
```

and replace:

```ts
if (dist > MATCH_TOLERANCE_MS) continue;
if (isReservedSkip(d) && at !== t) continue;
```

with:

```ts
if (dist > MATCH_TOLERANCE_MS) continue;
if (at >= segmentEnd) continue;
if (isReservedSkip(d) && at !== t) continue;
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS

- [ ] **Step 5: Prove by mutation.** Delete `if (at >= segmentEnd) continue;` and run `npx vitest run tests/unit/schedule.test.ts -t "segment limit"`. "a 00:10 dose goes to today's 00:13, not to yesterday's open 23:30" must fail. Then restore the line.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat(schedule): limit pass-1 candidates to the slot's own segment"
```

---

#### Cycle 3 — pass 2, the missed-row status rule, and the pass-2 bound

- [ ] **Step 1: Write the failing tests**

Append at the end of `tests/unit/schedule.test.ts`:

```ts
describe("computeScheduleSlots — pass 2 (late resolution)", () => {
  it("the live case: a late ×4 resolves 08:55, 09:00 and 11:00; a later ×3 covers nothing", () => {
    const slots = fixedDaySlots(
      ["08:55", "09:00", "11:00"],
      [
        makeDose({ id: "dose-a", takenAt: new Date("2026-04-16T13:31:00Z"), quantity: 4 }),
        makeDose({ id: "dose-b", takenAt: new Date("2026-04-16T21:48:00Z"), quantity: 3 }),
      ],
      new Date("2026-04-16T22:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["08:55", "taken", "dose-a"],
      ["09:00", "taken", "dose-a"],
      ["11:00", "taken", "dose-a"],
    ]);
    expect(slots.map((s) => s.resolvedByDoseId)).toEqual(["dose-a", "dose-a", "dose-a"]);
  });

  it("resolves the latest open slot first", () => {
    const slots = fixedDaySlots(
      ["08:00", "10:00", "12:00"],
      [makeDose({ takenAt: new Date("2026-04-16T14:00:00Z") })],
      new Date("2026-04-16T15:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["08:00", "overdue", null],
      ["10:00", "overdue", null],
      ["12:00", "taken", "dose-1"],
    ]);
  });

  it("never resolves a slot after its dose", () => {
    const slots = fixedDaySlots(
      ["08:00", "16:00"],
      [makeDose({ takenAt: new Date("2026-04-16T12:00:00Z"), quantity: 2 })],
      new Date("2026-04-16T17:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["08:00", "taken", "dose-1"],
      ["16:00", "overdue", null],
    ]);
  });

  it("pass 1 places a dose before pass 2 sees it", () => {
    const now = new Date("2026-04-16T21:00:00Z");
    const dose = makeDose({ takenAt: new Date("2026-04-16T20:30:00Z") });
    // The spec's worked case: pass 1 gives 20:30 to 20:00, and 14:00 stays overdue.
    expect(outcome(fixedDaySlots(["14:00", "20:00"], [dose], now))).toEqual([
      ["14:00", "overdue", null],
      ["20:00", "taken", "dose-1"],
    ]);
    // A case where the two orders disagree. Pass 2 alone would give the dose
    // to 14:00, the only slot BEFORE 20:30. Pass 1 gives it to 20:45, which
    // is 15 minutes away.
    expect(outcome(fixedDaySlots(["14:00", "20:45"], [dose], now))).toEqual([
      ["14:00", "overdue", null],
      ["20:45", "taken", "dose-1"],
    ]);
  });

  it("replays doses in time order, so a later dose never takes an earlier dose's slot", () => {
    const slots = fixedDaySlots(
      ["08:00", "12:00"],
      [
        // Listed first on purpose: input order must not decide.
        makeDose({ id: "dose-late", takenAt: new Date("2026-04-16T14:00:00Z"), quantity: 2 }),
        makeDose({ id: "dose-early", takenAt: new Date("2026-04-16T10:00:00Z") }),
      ],
      new Date("2026-04-16T15:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["08:00", "taken", "dose-early"],
      ["12:00", "taken", "dose-late"],
    ]);
  });

  it("ignores a dose dated after now until now reaches it", () => {
    const dose = makeDose({ takenAt: new Date("2026-04-16T14:00:00Z") });
    expect(outcome(fixedDaySlots(["08:00"], [dose], new Date("2026-04-16T12:00:00Z")))).toEqual([
      ["08:00", "overdue", null],
    ]);
    expect(outcome(fixedDaySlots(["08:00"], [dose], new Date("2026-04-16T14:00:00Z")))).toEqual([
      ["08:00", "taken", "dose-1"],
    ]);
  });

  it("a legacy skip-at-now (not on a slot instant) resolves the latest earlier open slot", () => {
    // /api/v1 skip_dose, the Mac app and the old dashboard Skip all write
    // takenAt = now. That skip's one unit of capacity now dismisses the slot
    // it was meant for, instead of nothing.
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T14:07:13Z"),
      status: "skipped",
    });
    expect(
      outcome(fixedDaySlots(["08:00", "12:00"], [skip], new Date("2026-04-16T14:10:00Z"))),
    ).toEqual([
      ["08:00", "overdue", null],
      ["12:00", "skipped", "dose-skip-1"],
    ]);
  });

  it("shares one capacity map: a ×3 dose resolves via passes 0, 1 and 2 and no further", () => {
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00.000Z"), quantity: 3 });
    const slots = fixedDaySlots(
      ["06:00", "07:00", "09:00", "09:30"],
      [dose],
      new Date("2026-04-16T12:00:00Z"),
    );
    // Pass 0 takes 09:00, pass 1 takes 09:30 and pass 2 takes 07:00. 06:00
    // stays open because all three units are spent, not because pass 2
    // started with a fresh count.
    expect(outcome(slots)).toEqual([
      ["06:00", "overdue", null],
      ["07:00", "taken", "dose-1"],
      ["09:00", "taken", "dose-1"],
      ["09:30", "taken", "dose-1"],
    ]);
  });

  it("a reserved skip never resolves another slot, even when a taken dose got its own slot", () => {
    const slots = fixedDaySlots(
      ["07:00", "09:00"],
      [
        makeDose({
          id: "dose-skip-1",
          takenAt: new Date("2026-04-16T09:00:00.000Z"),
          status: "skipped",
        }),
        makeDose({ id: "dose-taken-1", takenAt: new Date("2026-04-16T09:10:00Z") }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(outcome(slots)).toEqual([
      ["07:00", "overdue", null],
      ["09:00", "taken", "dose-taken-1"],
    ]);
  });

  it("without a window, reaches back to dayStart", () => {
    // 21 hours late. With no window the bound is dayStart, not a 12h carry-over.
    const slots = fixedDaySlots(
      ["01:00"],
      [makeDose({ takenAt: new Date("2026-04-16T22:00:00Z") })],
      new Date("2026-04-16T23:00:00Z"),
    );
    expect(outcome(slots)).toEqual([["01:00", "taken", "dose-1"]]);
  });
});

describe("computeScheduleSlots — pass-2 bound with a window", () => {
  it("stops at visibleStart: a slot past the 12h carry-over is never resolved late", () => {
    const timezone = "UTC";
    const sched = schedMap([makeFixedTimeSchedule("med-1", "20:00")]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T07:00:00Z") });
    const slotsAt = (now: Date) => {
      const window = dashboardWindow(now, timezone);
      return computeScheduleSlots(
        [makeMed()],
        sched,
        [dose],
        {},
        window.todayStart,
        window.end,
        timezone,
        now,
        { window },
      );
    };
    // At 07:30 yesterday's 20:00 is 11.5h old: visible and above the bound.
    expect(
      slotAt(slotsAt(new Date("2026-04-16T07:30:00Z")), "2026-04-15T20:00:00.000Z"),
    ).toMatchObject({ status: "taken", resolvedByDoseId: "dose-1", isEarlier: true });
    // At 08:30 it is 12.5h old: hidden and below the bound, so the 07:00
    // dose does not resolve it.
    const later = slotsAt(new Date("2026-04-16T08:30:00Z"));
    expect(slotAt(later, "2026-04-15T20:00:00.000Z")).toMatchObject({
      status: "overdue",
      resolvedByDoseId: null,
      isEarlier: true,
    });
    expect(slotAt(later, "2026-04-16T20:00:00.000Z")).toMatchObject({
      status: "upcoming",
      isEarlier: false,
    });
  });
});

describe("computeScheduleSlots — missed rows", () => {
  it("a future slot matched only to a missed row reads upcoming, not overdue", () => {
    const missed = makeDose({
      id: "dose-missed-1",
      takenAt: new Date("2026-04-16T15:30:00Z"),
      status: "missed",
    });
    const [slot] = fixedDaySlots(["16:00"], [missed], new Date("2026-04-16T12:00:00Z"));
    expect(slot).toMatchObject({
      status: "upcoming",
      matchedDoseId: "dose-missed-1",
      missedByDoseId: "dose-missed-1",
      resolvedByDoseId: null,
    });
  });

  it("a slot holding only a missed row can still be resolved late", () => {
    const [slot] = fixedDaySlots(
      ["08:00"],
      [
        makeDose({
          id: "dose-missed-1",
          takenAt: new Date("2026-04-16T08:10:00Z"),
          status: "missed",
        }),
        makeDose({ id: "dose-taken-1", takenAt: new Date("2026-04-16T11:00:00Z") }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(slot).toMatchObject({
      status: "taken",
      resolvedByDoseId: "dose-taken-1",
      missedByDoseId: "dose-missed-1",
      matchedDoseId: "dose-taken-1",
    });
  });

  it("a missed row never resolves anything late", () => {
    const [slot] = fixedDaySlots(
      ["08:00"],
      [
        makeDose({
          id: "dose-missed-1",
          takenAt: new Date("2026-04-16T11:00:00Z"),
          status: "missed",
        }),
      ],
      new Date("2026-04-16T12:00:00Z"),
    );
    expect(slot).toMatchObject({ status: "overdue", matchedDoseId: null });
  });
});

describe("computeScheduleSlots — stability across midnight and noon", () => {
  const timezone = "UTC";
  function windowSlots(times: string[], doses: DoseLogWithMedication[], now: Date): ScheduleSlot[] {
    const window = dashboardWindow(now, timezone);
    return computeScheduleSlots(
      [makeMed()],
      schedMap(times.map((t, i) => makeFixedTimeSchedule("med-1", t, null, i))),
      doses,
      {},
      window.todayStart,
      window.end,
      timezone,
      now,
      { window },
    );
  }

  it("an evening slot left open at 23:59 is still open at 00:01", () => {
    // 22:00 is open, and a 23:30 dose is 43 minutes before tomorrow's 00:13.
    // At 00:01, pass 1 gives the dose to 00:13, which is now today's slot.
    // At 23:59 the matcher must make the same choice. It can only do that
    // because tomorrow's first hour is projected and matched. Otherwise
    // pass 2 hands the dose to 22:00, and the row flips back to overdue at
    // midnight.
    const doses = [makeDose({ takenAt: new Date("2026-04-16T23:30:00Z") })];
    const before = windowSlots(["00:13", "22:00"], doses, new Date("2026-04-16T23:59:00Z"));
    const after = windowSlots(["00:13", "22:00"], doses, new Date("2026-04-17T00:01:00Z"));
    expect(slotAt(before, "2026-04-16T22:00:00.000Z").status).toBe("overdue");
    expect(slotAt(after, "2026-04-16T22:00:00.000Z")).toMatchObject({
      status: "overdue",
      isEarlier: true,
    });
    expect(slotAt(after, "2026-04-17T00:13:00.000Z")).toMatchObject({
      status: "taken",
      matchedDoseId: "dose-1",
    });
    // Tomorrow's first hour is matched at 23:59 but never returned.
    expect(before.some((s) => s.expectedTime === "2026-04-17T00:13:00.000Z")).toBe(false);
  });

  it("a slot at today's midnight keeps its late resolution when the bound clamps at noon", () => {
    // Pass 2's bound moves forward all morning and stops at todayStart at
    // noon. A 00:00 slot sits exactly on that bound and must stay reachable.
    const doses = [makeDose({ takenAt: new Date("2026-04-16T03:00:00Z") })];
    for (const now of ["2026-04-16T11:59:00Z", "2026-04-16T12:01:00Z"]) {
      expect(
        slotAt(windowSlots(["00:00"], doses, new Date(now)), "2026-04-16T00:00:00.000Z"),
        now,
      ).toMatchObject({ status: "taken", matchedDoseId: "dose-1" });
    }
  });
});

describe("pinned divergence: the dashboard credits slots Analytics does not", () => {
  it("one ×3 dose at 20:30 marks 08:00, 14:00 and 20:00 all taken", () => {
    // Deliberate. See "The dashboard and Analytics disagree about late and
    // multi-unit doses" in CLAUDE.md. Analytics counts this as ONE dose
    // event on 2026-04-16. The dashboard asks "has this slot been
    // handled?" and resolves all three: 20:00 in pass 1, then 14:00 and
    // 08:00 in pass 2. Do not change either surface to match the other
    // without revisiting decisions D3 and D4 of
    // docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md.
    const dose = makeDose({ takenAt: new Date("2026-04-16T20:30:00Z"), quantity: 3 });
    expect(
      outcome(fixedDaySlots(["08:00", "14:00", "20:00"], [dose], new Date("2026-04-16T21:00:00Z"))),
    ).toEqual([
      ["08:00", "taken", "dose-1"],
      ["14:00", "taken", "dose-1"],
      ["20:00", "taken", "dose-1"],
    ]);
  });
});
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL. Exactly 13 tests fail:

- "the live case…"
- "resolves the latest open slot first"
- "never resolves a slot after its dose"
- "replays doses in time order…"
- "ignores a dose dated after now until now reaches it" (the second expect)
- "a legacy skip-at-now…"
- "shares one capacity map…"
- "without a window, reaches back to dayStart"
- "stops at visibleStart…" (the 07:30 expect)
- "a future slot matched only to a missed row reads upcoming…"
- "a slot holding only a missed row can still be resolved late"
- "a slot at today's midnight keeps its late resolution…"
- "one ×3 dose at 20:30 marks 08:00, 14:00 and 20:00 all taken"

Four tests pass already and are proven by mutation in Step 5:

- "pass 1 places a dose before pass 2 sees it"
- "a reserved skip never resolves another slot…"
- "a missed row never resolves anything late"
- "an evening slot left open at 23:59 is still open at 00:01"

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/utils/schedule.ts`, replace the **whole** `matchMedicationSlots` function again, from its JSDoc to its closing `}`, with the final version below. Keep `segmentEndMs` above it unchanged.

```ts
/**
 * Match one medication's projected slots to its doses: passes 0–2.
 *
 * Every pass spends from ONE capacity map. A taken dose covers
 * `max(1, quantity)` slots; a skipped or missed row covers exactly one. So
 * a ×3 dose can resolve one slot in each pass, and never a fourth.
 *
 * - Pass 0 (taken only): a dose recorded at exactly a slot's instant claims
 *   that slot, with the smaller id winning a tie. This is what makes "Took
 *   it at 09:00" resolve 09:00 when 08:55 is also open.
 * - Reserved skip: a skip at one of these slots' instants is that slot's own
 *   Skip. It is a pass-1 candidate for that slot only and never part of
 *   pass 2, so a real taken dose within the hour still beats it.
 * - Pass 1: the shipped ±MATCH_TOLERANCE_MS rule over the slots pass 0 left,
 *   ascending. Best by rank (taken 0, skipped/missed 1), then distance, then
 *   smaller id. The dose must also have been taken before the slot's
 *   segment ends (see `segmentEndMs`). A missed row goes to
 *   `missedByDoseId` and leaves the slot unresolved.
 * - Pass 2: leftover capacity of taken and skipped doses (never missed rows,
 *   never reserved skips) with `takenAt <= now`, replayed in (takenAt, id)
 *   order so history is never re-attributed. Each dose walks backwards from
 *   the last slot strictly before it, skips resolved slots and stops below
 *   `pass2Bound`. A dose never resolves a slot after it.
 *
 * Status: a resolved slot takes the resolving dose's status. Anything else
 * is overdue once `expectedTime <= now` and upcoming before that, including
 * a slot holding only a missed row.
 */
export function matchMedicationSlots(
  slots: ProjectedSlot[],
  doses: MatchDose[],
  opts: { now: Date; segments: Segments; pass2Bound: Date },
): MatchedSlot[] {
  const nowMs = opts.now.getTime();
  const ordered = [...slots].sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());
  const slotMs = ordered.map((s) => s.expectedTime.getTime());
  const slotInstants = new Set(slotMs);
  const resolvedBy: (MatchDose | null)[] = ordered.map(() => null);
  const missedBy: (string | null)[] = ordered.map(() => null);

  const remaining = new Map<string, number>();
  for (const d of doses) {
    remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
  }
  const hasCapacity = (d: MatchDose) => (remaining.get(d.id) ?? 0) > 0;
  const spend = (d: MatchDose) => remaining.set(d.id, (remaining.get(d.id) ?? 0) - 1);
  const isReservedSkip = (d: MatchDose) =>
    d.status === "skipped" && slotInstants.has(d.takenAt.getTime());

  // Pass 0 — exact claims, taken only.
  for (let i = 0; i < ordered.length; i++) {
    let best: MatchDose | undefined;
    for (const d of doses) {
      if (d.status !== "taken" || !hasCapacity(d)) continue;
      if (d.takenAt.getTime() !== slotMs[i]) continue;
      if (!best || d.id < best.id) best = d;
    }
    if (best) {
      resolvedBy[i] = best;
      spend(best);
    }
  }

  // Pass 1 — the shipped ±1h rule over what pass 0 left, plus the segment
  // limit and reserved skips.
  for (let i = 0; i < ordered.length; i++) {
    if (resolvedBy[i]) continue;
    const t = slotMs[i];
    const segmentEnd = segmentEndMs(ordered[i].segment, opts.segments);
    let best: MatchDose | undefined;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const d of doses) {
      if (!hasCapacity(d)) continue;
      const at = d.takenAt.getTime();
      const dist = Math.abs(at - t);
      if (dist > MATCH_TOLERANCE_MS) continue;
      if (at >= segmentEnd) continue;
      if (isReservedSkip(d) && at !== t) continue;
      const rank = d.status === "taken" ? 0 : 1;
      const better =
        rank < bestRank ||
        (rank === bestRank && dist < bestDist) ||
        (rank === bestRank && dist === bestDist && (!best || d.id < best.id));
      if (better) {
        best = d;
        bestRank = rank;
        bestDist = dist;
      }
    }
    if (!best) continue;
    spend(best);
    if (best.status === "missed") missedBy[i] = best.id;
    else resolvedBy[i] = best;
  }

  // Pass 2 — late resolution.
  const bound = opts.pass2Bound.getTime();
  const late = doses
    .filter(
      (d) =>
        d.status !== "missed" &&
        !isReservedSkip(d) &&
        hasCapacity(d) &&
        d.takenAt.getTime() <= nowMs,
    )
    .sort(
      (a, b) =>
        a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const d of late) {
    const at = d.takenAt.getTime();
    for (let i = ordered.length - 1; i >= 0 && hasCapacity(d); i--) {
      if (slotMs[i] >= at) continue; // never forward: only slots strictly before the dose
      if (slotMs[i] < bound) break;
      if (resolvedBy[i]) continue; // a slot holding only a missed row is still eligible
      resolvedBy[i] = d;
      spend(d);
    }
  }

  return ordered.map((slot, i) => {
    const by = resolvedBy[i];
    const status: ScheduleSlotStatus = by
      ? by.status === "skipped"
        ? "skipped"
        : "taken"
      : slotMs[i] <= nowMs
        ? "overdue"
        : "upcoming";
    return { ...slot, status, resolvedByDoseId: by?.id ?? null, missedByDoseId: missedBy[i] };
  });
}
```

Then check the pass-2 bound at the call site. Run `grep -n "pass2Bound" src/lib/utils/schedule.ts`. Task 3 already declares, inside `computeScheduleSlots`,

```ts
const pass2Bound = opts.window ? opts.window.visibleStart : dayStartUtc;
```

and passes it to the single `matchMedicationSlots(` call as `pass2Bound`. Keep that local and **do not** inline a second copy of the expression: an unused local is a lint warning. Only add this comment above the `const`:

```ts
// Pass 2 reaches back no further than what the dashboard can show:
// visibleStart with a window, or the start of the one-segment day
// without one.
```

If the grep shows no `pass2Bound` local (Task 3 was implemented differently), pass `pass2Bound: opts.window ? opts.window.visibleStart : dayStartUtc` in the call instead.

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/schedule.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS, with every existing case unchanged. That includes `:251`: the past missed-row slot stays overdue with `matchedDoseId: "dose-missed-1"`.

- [ ] **Step 5: Prove by mutation.** Apply each change on its own, run `npx vitest run tests/unit/schedule.test.ts`, check the named test fails, then restore it.

  Changes inside `matchMedicationSlots`:
  1. Move the whole `// Pass 2` block (from `const bound` to the end of the `for (const d of late)` loop) so it runs before `// Pass 1`. Fails: "pass 1 places a dose before pass 2 sees it".
  2. Delete `if (slotMs[i] >= at) continue;`. Fails: "never resolves a slot after its dose".
  3. Delete the `.sort(…)` call in pass 2. Fails: "replays doses in time order…".
  4. Delete `&& d.takenAt.getTime() <= nowMs` from the pass-2 filter. Fails: "ignores a dose dated after now until now reaches it".
  5. Delete `!isReservedSkip(d) &&` from the pass-2 filter. Fails: "a reserved skip never resolves another slot…".
  6. Delete `d.status !== "missed" &&` from the pass-2 filter. Fails: "a missed row never resolves anything late".
  7. Change `if (resolvedBy[i]) continue;` in pass 2 to `if (resolvedBy[i] || missedBy[i]) continue;`. Fails: "a slot holding only a missed row can still be resolved late".
  8. Add `remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);` as the first line inside `for (const d of late) {`. Fails: "shares one capacity map…".
  9. Change `: slotMs[i] <= nowMs` to `: missedBy[i] || slotMs[i] <= nowMs`. Fails: "a future slot matched only to a missed row reads upcoming…".

  Changes elsewhere in `schedule.ts`: 10. At the call site, change `opts.window.visibleStart` to `opts.window.projectStart`. Fails: "stops at visibleStart…". 11. At the call site, change the no-window branch `dayStartUtc` to `new Date(now.getTime() - CARRY_OVER_MS + 1)`. Fails: "without a window, reaches back to dayStart". 12. In `dashboardWindow` (T2), set `projectEnd` to `end` (drop the `+ MATCH_TOLERANCE_MS`). Fails: "an evening slot left open at 23:59 is still open at 00:01". 13. In `dashboardWindow`, compute `visibleStart` without the `min(todayStart, …)` clamp, as `max(projectStart, now − CARRY_OVER_MS + 1ms)`. Fails: "a slot at today's midnight keeps its late resolution when the bound clamps at noon". 14. Delete the whole `// Pass 2` block. Fails: "one ×3 dose at 20:30 marks 08:00, 14:00 and 20:00 all taken".

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "feat(schedule): resolve late doses with pass 2 and read missed-only slots by time"
```

---

#### Cycle 4 — the verbatim oracle and the seeded properties

- [ ] **Step 1: Create the oracle `tests/unit/helpers/legacy-slot-matcher.ts`**

The region between the two marker lines is HEAD `1b53ad7` `src/lib/utils/schedule.ts:51-293`, with four renames and no other change.

```ts
/**
 * THE ORACLE for tests/unit/schedule-matching-properties.test.ts: the
 * dashboard's slot matcher exactly as it shipped before passes 0–2, from
 * commit 1b53ad7, src/lib/utils/schedule.ts lines 51–293.
 *
 * Everything between the two marker comments below is that range byte for
 * byte, with four mechanical renames and nothing else:
 * - `getLocalDateString` loses its `export`
 * - `ScheduleSlotStatus` → `LegacyScheduleSlotStatus`
 * - `ScheduleSlot[]` → `LegacyScheduleSlot[]`
 * - `computeScheduleSlots(` → `legacyComputeScheduleSlots(`
 * The header of the properties test holds the check that proves it.
 *
 * Never fix, refactor, reformat or "modernise" this file: a corrected
 * oracle compares against nothing. It is not a test (vitest collects only
 * `*.test.ts`), and nothing under src/ may import it.
 */
import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import { isoDayKey, wallClockToInstant, dayOfWeekForDayKey } from "$lib/utils/time";
import { parseIntervalHours } from "$lib/utils/schedule-rate";

export type LegacyScheduleSlotStatus = "taken" | "skipped" | "upcoming" | "overdue";

export interface LegacyScheduleSlot {
  medicationId: string;
  medicationName: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  dosageAmount: string;
  dosageUnit: string;
  expectedTime: string; // ISO string
  status: LegacyScheduleSlotStatus;
  matchedDoseId: string | null;
}

const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

// ---- VERBATIM-START ----
/**
 * A day KEY, not a label: callers compare it and use it to index slots, so it
 * goes through `isoDayKey` and never follows `preferences.dateFormat`.
 */
function getLocalDateString(date: Date, timezone: string): string {
  return isoDayKey(date, timezone);
}

function getLocalDatesInRange(start: Date, end: Date, timezone: string): string[] {
  const dates = new Set<string>();
  const stepMs = 6 * 60 * 60 * 1000;
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    dates.add(getLocalDateString(new Date(t), timezone));
  }
  if (end.getTime() > start.getTime()) {
    dates.add(getLocalDateString(new Date(end.getTime() - 1), timezone));
  }
  return [...dates].sort();
}

function expectedTimesForInterval(
  intervalHours: number,
  anchor: Date,
  dayStartUtc: Date,
  dayEndUtc: Date,
): Date[] {
  if (!intervalHours || intervalHours <= 0) return [];
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const out: Date[] = [];

  let t = new Date(anchor.getTime());
  if (t.getTime() < dayStartUtc.getTime()) {
    const diff = dayStartUtc.getTime() - t.getTime();
    const intervals = Math.ceil(diff / intervalMs);
    t = new Date(t.getTime() + intervals * intervalMs);
  }

  while (t.getTime() < dayEndUtc.getTime()) {
    out.push(new Date(t.getTime()));
    t = new Date(t.getTime() + intervalMs);
  }

  if (
    anchor.getTime() >= dayStartUtc.getTime() &&
    anchor.getTime() < dayEndUtc.getTime() &&
    !out.some((et) => et.getTime() === anchor.getTime())
  ) {
    out.push(new Date(anchor.getTime()));
  }

  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

function expectedTimesForFixedTime(
  schedule: MedicationSchedule,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
): Date[] {
  if (!schedule.timeOfDay) return [];
  const out: Date[] = [];
  const allowed = schedule.daysOfWeek;

  for (const dateStr of getLocalDatesInRange(dayStartUtc, dayEndUtc, timezone)) {
    // Day-of-week comes from the requested date KEY, never from the resolved
    // instant. On a transition that swallows the scheduled minute the instant
    // can legitimately land on the next civil day (America/Godthab springs
    // forward at 23:00 local), and reading the weekday off it would turn a
    // Saturday-only medication into a Sunday one and drop the slot entirely.
    if (allowed && allowed.length > 0) {
      if (!allowed.includes(dayOfWeekForDayKey(dateStr))) continue;
    }

    const utc = wallClockToInstant(dateStr, schedule.timeOfDay, timezone);
    if (utc.getTime() < dayStartUtc.getTime() || utc.getTime() >= dayEndUtc.getTime()) {
      continue;
    }
    out.push(utc);
  }

  return out;
}

/**
 * Compute expected dose schedule slots for the window.
 *
 * Walks every schedule row for each medication. Interval rows project
 * forward from the last dose (or window start) by intervalHours.
 * Fixed-time rows produce one slot per local-time-of-day per local
 * day in the window, optionally filtered by daysOfWeek. PRN rows
 * produce no slots.
 */
export function legacyComputeScheduleSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  todaysDoses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
): LegacyScheduleSlot[] {
  const slots: LegacyScheduleSlot[] = [];

  const dosesByMedId = new Map<string, DoseLogWithMedication[]>();
  for (const dose of todaysDoses) {
    let arr = dosesByMedId.get(dose.medicationId);
    if (!arr) {
      arr = [];
      dosesByMedId.set(dose.medicationId, arr);
    }
    arr.push(dose);
  }

  for (const med of medications) {
    const medSchedules = schedulesByMedId.get(med.id) ?? [];
    if (medSchedules.length === 0) continue;

    const expectedTimes: { time: Date; kind: "interval" | "fixed_time" }[] = [];

    for (const schedule of medSchedules) {
      if (schedule.scheduleKind === "prn") continue;

      if (schedule.scheduleKind === "interval") {
        const intervalHours = parseIntervalHours(schedule.intervalHours);
        if (intervalHours === null) continue;
        const lastDose = lastDoseByMedication[med.id];
        const anchor = lastDose ? new Date(lastDose.getTime()) : new Date(dayStartUtc.getTime());
        for (const t of expectedTimesForInterval(intervalHours, anchor, dayStartUtc, dayEndUtc)) {
          expectedTimes.push({ time: t, kind: "interval" });
        }
      } else if (schedule.scheduleKind === "fixed_time") {
        for (const t of expectedTimesForFixedTime(schedule, dayStartUtc, dayEndUtc, timezone)) {
          expectedTimes.push({ time: t, kind: "fixed_time" });
        }
      }
    }

    if (expectedTimes.length === 0) continue;

    // Dedupe — two schedule rows might emit the same expected time.
    // On an exact collision keep the fixed_time entry so the declared
    // schedule, not the derived interval projection, is canonical.
    const byTime = new Map<number, { time: Date; kind: "interval" | "fixed_time" }>();
    for (const e of expectedTimes) {
      const key = e.time.getTime();
      const existing = byTime.get(key);
      if (!existing || (existing.kind === "interval" && e.kind === "fixed_time")) {
        byTime.set(key, e);
      }
    }

    // Interval projections anchor to the *actual* last-taken time, so
    // they drift with the user's behaviour (log at 08:55 → project
    // 08:55). When such a projection lands within the matching
    // tolerance of a declared fixed_time slot it is the same intended
    // dose, not an extra one — drop the phantom twin and keep the
    // declared time. Explicit fixed_time rows are never collapsed.
    const fixedMs = [...byTime.values()]
      .filter((e) => e.kind === "fixed_time")
      .map((e) => e.time.getTime());
    const dedup = [...byTime.values()]
      .filter(
        (e) =>
          e.kind === "fixed_time" ||
          !fixedMs.some((f) => Math.abs(f - e.time.getTime()) <= MATCH_TOLERANCE_MS),
      )
      .map((e) => e.time);
    dedup.sort((a, b) => a.getTime() - b.getTime());

    const medDoses = dosesByMedId.get(med.id) ?? [];

    // Capacity-based matching: a single logged dose can satisfy several
    // nearby slots, up to the number of units actually taken. A `taken`
    // dose has a capacity equal to its quantity (so logging ×3 in one go
    // covers up to three slots within the vicinity window); a `skipped` or
    // `missed` row can only ever clear one slot. `remaining` is decremented
    // as slots consume each dose's capacity.
    const remaining = new Map<string, number>();
    for (const d of medDoses) {
      remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
    }

    for (const expected of dedup) {
      const expectedMs = expected.getTime();

      // Pick the best in-vicinity dose with capacity left: prefer a real
      // `taken` dose over a `skipped`/`missed` one, then the nearest in
      // time, tie-broken by id for deterministic output.
      let matchedDose: DoseLogWithMedication | undefined;
      let bestRank = Infinity;
      let bestDist = Infinity;
      for (const d of medDoses) {
        if ((remaining.get(d.id) ?? 0) <= 0) continue;
        const dist = Math.abs(new Date(d.takenAt).getTime() - expectedMs);
        if (dist > MATCH_TOLERANCE_MS) continue;
        const rank = d.status === "taken" ? 0 : 1;
        const better =
          rank < bestRank ||
          (rank === bestRank && dist < bestDist) ||
          (rank === bestRank && dist === bestDist && (!matchedDose || d.id < matchedDose.id));
        if (better) {
          matchedDose = d;
          bestRank = rank;
          bestDist = dist;
        }
      }
      if (matchedDose) {
        remaining.set(matchedDose.id, (remaining.get(matchedDose.id) ?? 0) - 1);
      }

      let status: LegacyScheduleSlotStatus;
      if (matchedDose) {
        if (matchedDose.status === "skipped") status = "skipped";
        // A "missed" dose row hasn't actually been consumed, so the slot
        // is still unfulfilled — render it as overdue, not green-check
        // taken.
        else if (matchedDose.status === "missed") status = "overdue";
        else status = "taken";
      } else if (expected.getTime() <= now.getTime()) {
        status = "overdue";
      } else {
        status = "upcoming";
      }

      slots.push({
        medicationId: med.id,
        medicationName: med.name,
        colour: med.colour,
        colourSecondary: med.colourSecondary,
        pattern: med.pattern,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        expectedTime: expected.toISOString(),
        status,
        matchedDoseId: matchedDose?.id ?? null,
      });
    }
  }

  return slots;
}
// ---- VERBATIM-END ----
```

- [ ] **Step 2: Prove the oracle is verbatim**

Run it from the repo root. It uses no `/dev/fd`, so it also works inside the sandbox:

```bash
EXPECTED=$(git show 1b53ad7:src/lib/utils/schedule.ts | sed -n '51,293p' \
  | sed -e 's/^export function getLocalDateString/function getLocalDateString/' \
        -e 's/ScheduleSlotStatus/LegacyScheduleSlotStatus/g' \
        -e 's/ScheduleSlot\[\]/LegacyScheduleSlot[]/g' \
        -e 's/computeScheduleSlots(/legacyComputeScheduleSlots(/')
ACTUAL=$(sed -n '/VERBATIM-START/,/VERBATIM-END/p' tests/unit/helpers/legacy-slot-matcher.ts | sed '1d;$d')
[ "$EXPECTED" = "$ACTUAL" ] && echo VERBATIM || echo DIFFERS
```

Expected: `VERBATIM`. If you see `DIFFERS`, rebuild the region from the `$EXPECTED` output rather than editing it by hand.

- [ ] **Step 3: Write the properties test `tests/unit/schedule-matching-properties.test.ts`**

These are properties of code that already exists, so they go green straight away. The red phase is the mutation step that follows.

```ts
/**
 * Seeded properties of the dashboard slot matcher: passes 0–2 inside the
 * window.
 *
 * 1. Differential against production. The oracle is
 *    helpers/legacy-slot-matcher.ts, a verbatim copy of the matcher as it
 *    shipped before passes 0–2. It runs the way production ran it: over
 *    [todayStart, end) with doses >= todayStart. On the spec's domain,
 *    every resolution production made must survive unchanged. The only new
 *    resolutions allowed are late ones: pass 2, from a dose taken AFTER the
 *    slot.
 * 2. Stability across midnight and noon. With no new dose in between,
 *    every slot visible just after the boundary has the same resolution it
 *    had just before.
 *
 * The fixtures are seeded, not random. A failure names its fixture index
 * and reproduces on every run. The draw order is part of each seed, so
 * reordering one `random()` call changes every fixture. Both tests set a
 * 60s timeout because vite.config.ts sets no testTimeout.
 *
 * The oracle must stay verbatim. From the repo root, this prints VERBATIM:
 *
 *   EXPECTED=$(git show 1b53ad7:src/lib/utils/schedule.ts | sed -n '51,293p' \
 *     | sed -e 's/^export function getLocalDateString/function getLocalDateString/' \
 *           -e 's/ScheduleSlotStatus/LegacyScheduleSlotStatus/g' \
 *           -e 's/ScheduleSlot\[\]/LegacyScheduleSlot[]/g' \
 *           -e 's/computeScheduleSlots(/legacyComputeScheduleSlots(/')
 *   ACTUAL=$(sed -n '/VERBATIM-START/,/VERBATIM-END/p' \
 *     tests/unit/helpers/legacy-slot-matcher.ts | sed '1d;$d')
 *   [ "$EXPECTED" = "$ACTUAL" ] && echo VERBATIM || echo DIFFERS
 */
import { describe, it, expect } from "vitest";
import {
  computeScheduleSlots,
  dashboardWindow,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
} from "$lib/utils/schedule";
import type { DashboardWindow, MatchDose, MatchedSlot } from "$lib/utils/schedule";
import { shiftDayKey, wallClockToInstant } from "$lib/utils/time";
import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import { legacyComputeScheduleSlots } from "./helpers/legacy-slot-matcher";

// ── Fixture builders (same shapes as tests/unit/schedule.test.ts) ──

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "TestMed",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: "8",
    inventoryCount: null,
    inventoryAlertThreshold: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    lowInventoryEpisodeAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFixedTimeSchedule(
  medicationId: string,
  timeOfDay: string,
  daysOfWeek: number[] | null = null,
  sortOrder = 0,
): MedicationSchedule {
  return {
    id: `sched-${medicationId}-${timeOfDay}`,
    medicationId,
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function schedMap(schedules: MedicationSchedule[]): Map<string, MedicationSchedule[]> {
  const m = new Map<string, MedicationSchedule[]>();
  for (const s of schedules) {
    let arr = m.get(s.medicationId);
    if (!arr) {
      arr = [];
      m.set(s.medicationId, arr);
    }
    arr.push(s);
  }
  return m;
}

function makeDose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  return {
    id: "dose-1",
    userId: "user-1",
    medicationId: "med-1",
    quantity: 1,
    takenAt: new Date("2026-04-16T08:00:00Z"),
    loggedAt: new Date("2026-04-16T08:00:00Z"),
    updatedAt: new Date("2026-04-16T08:00:00Z"),
    notes: null,
    sideEffects: null,
    status: "taken",
    medication: {
      name: "TestMed",
      dosageAmount: "200",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

// ── Seeded generation ──

const H = 60 * 60 * 1000;
const FIXTURES = 400;
const DIFFERENTIAL_SEED = 20260925;
const STABILITY_SEED = 20260926;

type Random = () => number;

/** mulberry32 — the generator walkthrough/demo-data.ts uses, inlined because that one is private. */
function mulberry32(seed: number): Random {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, xs: readonly T[]): T {
  return xs[Math.floor(random() * xs.length)];
}

function int(random: Random, lo: number, hi: number): number {
  return lo + Math.floor(random() * (hi - lo + 1));
}

function hhmm(minuteOfDay: number): string {
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const m = String(minuteOfDay % 60).padStart(2, "0");
  return `${h}:${m}`;
}

const ZONES = [
  "UTC",
  "Europe/London",
  "America/New_York",
  "Pacific/Auckland",
  "Asia/Kolkata",
] as const;
// One ordinary day, plus every DST transition these zones have in 2026.
const DAYS = [
  "2026-04-16",
  "2026-03-29",
  "2026-10-25",
  "2026-11-01",
  "2026-03-08",
  "2026-04-05",
  "2026-09-27",
] as const;
// 30% of drawn schedule minutes fall in the first hour of the day. That
// makes tomorrow's first hour, which midnight stability depends on, common
// enough for the check to mean something.
const FIRST_HOUR_BIAS = 0.3;

function fixedTimeFixture(random: Random): {
  timezone: string;
  dayKey: string;
  schedules: MedicationSchedule[];
} {
  const timezone = pick(random, ZONES);
  const dayKey = pick(random, DAYS);
  const count = int(random, 1, 4);
  const minutes = new Set<number>();
  while (minutes.size < count) {
    minutes.add(random() < FIRST_HOUR_BIAS ? int(random, 0, 59) : int(random, 0, 1439));
  }
  const schedules = [...minutes]
    .sort((a, b) => a - b)
    .map((minute, index) =>
      makeFixedTimeSchedule(
        "med-1",
        hhmm(minute),
        random() < 0.2 ? [int(random, 0, 6)] : null,
        index,
      ),
    );
  return { timezone, dayKey, schedules };
}

// ── 1. Differential ──

describe("slot matching — differential against the shipped matcher", () => {
  it("keeps every resolution production made and adds only late ones", () => {
    let unchanged = 0;
    let late = 0;
    for (let i = 0; i < FIXTURES; i++) {
      const random = mulberry32(DIFFERENTIAL_SEED + i);
      const { timezone, dayKey, schedules } = fixedTimeFixture(random);
      const todayStart = wallClockToInstant(dayKey, "00:00", timezone);
      const end = wallClockToInstant(shiftDayKey(dayKey, 1), "00:00", timezone);
      const span = end.getTime() - todayStart.getTime();
      const now = new Date(todayStart.getTime() + Math.floor(random() * span));

      // The spec's domain:
      // - no dose in [todayStart − 1h, todayStart) or at/after `end`
      // - no dose on a slot instant (slots are whole minutes; every dose
      //   is 1–59 seconds past a minute)
      // - no missed rows
      // - startedAt and effectiveFrom (2026-01-01) long before the window
      const doses: DoseLogWithMedication[] = [];
      const doseCount = int(random, 0, 6);
      for (let j = 0; j < doseCount; j++) {
        const yesterday = random() < 0.2;
        const base = yesterday
          ? todayStart.getTime() - 2 * H - Math.floor(random() * 22 * H)
          : todayStart.getTime() + Math.floor(random() * span);
        const takenAt = new Date(Math.floor(base / 60_000) * 60_000 + int(random, 1, 59) * 1000);
        const status = random() < 0.7 ? "taken" : "skipped";
        const quantity = status === "taken" ? int(random, 1, 3) : 1;
        doses.push(makeDose({ id: `dose-${j}`, takenAt, loggedAt: takenAt, status, quantity }));
      }

      const label = `fixture ${i} (${timezone} ${dayKey}, now ${now.toISOString()})`;
      const window = dashboardWindow(now, timezone);
      expect(window.todayStart, label).toEqual(todayStart);

      const next = computeScheduleSlots(
        [makeMed()],
        schedMap(schedules),
        doses,
        {},
        todayStart,
        end,
        timezone,
        now,
        { window },
      ).filter((s) => !s.isEarlier);
      const shipped = legacyComputeScheduleSlots(
        [makeMed()],
        schedMap(schedules),
        doses.filter((d) => d.takenAt.getTime() >= todayStart.getTime()),
        {},
        todayStart,
        end,
        timezone,
        now,
      );

      expect(
        next.map((s) => s.expectedTime),
        label,
      ).toEqual(shipped.map((s) => s.expectedTime));
      shipped.forEach((old, k) => {
        const slot = next[k];
        const where = `${label} slot ${old.expectedTime}`;
        if (old.status === "taken" || old.status === "skipped") {
          unchanged++;
          expect({ status: slot.status, matchedDoseId: slot.matchedDoseId }, where).toEqual({
            status: old.status,
            matchedDoseId: old.matchedDoseId,
          });
        } else if (old.status === "upcoming") {
          expect(slot.status, where).toBe("upcoming");
        } else if (slot.status === "overdue") {
          expect(slot.resolvedByDoseId, where).toBeNull();
        } else {
          late++;
          expect(["taken", "skipped"], where).toContain(slot.status);
          const by = doses.find((d) => d.id === slot.resolvedByDoseId);
          expect(by, where).toBeDefined();
          expect(by!.takenAt.getTime(), where).toBeGreaterThan(
            new Date(slot.expectedTime).getTime(),
          );
        }
      });
    }
    // Non-vacuity. The designing simulation saw 144 unchanged and 184 late.
    expect(unchanged).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(100);
  }, 60_000);
});

// ── 2. Stability ──

function view(schedules: MedicationSchedule[], timezone: string, doses: MatchDose[], now: Date) {
  const window = dashboardWindow(now, timezone);
  const segments = segmentsFor(window);
  const fixedInstants = projectFixedTimes(schedules, segments, timezone);
  const projected = projectMedicationSlots({
    med: makeMed(),
    schedules,
    fixedInstants,
    lastTakenAt: null,
    segments,
  });
  return {
    window,
    slots: matchMedicationSlots(projected, doses, {
      now,
      segments,
      pass2Bound: window.visibleStart,
    }),
  };
}

/** Visible exactly as the spec's Status section defines it. */
function isVisible(slot: MatchedSlot, window: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= window.end.getTime()) return false;
  if (t >= window.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= window.visibleStart.getTime();
}

function resolution(slot: MatchedSlot): string {
  return slot.status === "taken" || slot.status === "skipped"
    ? `${slot.status}:${slot.resolvedByDoseId}`
    : "open";
}

function randomDoses(
  random: Random,
  timezone: string,
  dayKey: string,
  schedules: MedicationSchedule[],
  from: Date,
  to: Date,
  prefix: string,
): MatchDose[] {
  const out: MatchDose[] = [];
  const count = int(random, 0, 6);
  for (let j = 0; j < count; j++) {
    let takenAt: Date | undefined;
    const roll = random();
    if (roll < 0.3) {
      // Exactly on one of the day's slot instants: exercises pass 0 and reserved skips.
      const onSlot = wallClockToInstant(dayKey, pick(random, schedules).timeOfDay!, timezone);
      if (onSlot.getTime() >= from.getTime() && onSlot.getTime() <= to.getTime()) takenAt = onSlot;
    } else if (roll < 0.6) {
      // The two hours before `to`, where tomorrow's first hour competes for doses.
      const lo = Math.max(from.getTime(), to.getTime() - 2 * H);
      takenAt = new Date(lo + Math.floor(random() * (to.getTime() - lo + 1)));
    }
    if (!takenAt) {
      takenAt = new Date(
        from.getTime() + Math.floor(random() * (to.getTime() - from.getTime() + 1)),
      );
    }
    const status = random() < 0.7 ? "taken" : "skipped";
    out.push({
      id: `${prefix}-${j}`,
      takenAt,
      status,
      quantity: status === "taken" ? int(random, 1, 3) : 1,
    });
  }
  return out;
}

function compareViews(
  schedules: MedicationSchedule[],
  timezone: string,
  doses: MatchDose[],
  earlier: Date,
  later: Date,
  label: string,
): { compared: number; earlierRows: number } {
  const before = view(schedules, timezone, doses, earlier);
  const after = view(schedules, timezone, doses, later);
  const beforeByInstant = new Map(before.slots.map((s) => [s.expectedTime.getTime(), s]));
  let compared = 0;
  let earlierRows = 0;
  for (const slot of after.slots) {
    if (!isVisible(slot, after.window)) continue;
    const where = `${label} slot ${slot.expectedTime.toISOString()}`;
    const was = beforeByInstant.get(slot.expectedTime.getTime());
    if (!was) {
      // Only a slot beyond the earlier view's projection may be new.
      expect(slot.expectedTime.getTime(), where).toBeGreaterThanOrEqual(
        before.window.projectEnd.getTime(),
      );
      continue;
    }
    expect(resolution(slot), where).toBe(resolution(was));
    compared++;
    if (slot.expectedTime.getTime() < after.window.todayStart.getTime()) earlierRows++;
  }
  return { compared, earlierRows };
}

describe("slot matching — stability across midnight and noon", () => {
  it("every slot visible just after midnight or noon had the same resolution just before", () => {
    let comparedAtMidnight = 0;
    let earlierRowsAtMidnight = 0;
    let comparedAtNoon = 0;
    for (let i = 0; i < FIXTURES; i++) {
      const random = mulberry32(STABILITY_SEED + i);
      const { timezone, dayKey, schedules } = fixedTimeFixture(random);
      const nextKey = shiftDayKey(dayKey, 1);
      const dayStart = wallClockToInstant(dayKey, "00:00", timezone);
      const beforeMidnight = wallClockToInstant(dayKey, "23:59", timezone);
      const afterMidnight = wallClockToInstant(nextKey, "00:01", timezone);
      const beforeNoon = wallClockToInstant(nextKey, "11:59", timezone);
      const afterNoon = wallClockToInstant(nextKey, "12:01", timezone);

      // Midnight uses only day-D doses, all at or before 23:59, so no dose
      // happens between the two views. Noon adds D+1 doses up to 11:59
      // for the same reason.
      const dayDoses = randomDoses(
        random,
        timezone,
        dayKey,
        schedules,
        dayStart,
        beforeMidnight,
        "d",
      );
      const morningDoses = randomDoses(
        random,
        timezone,
        nextKey,
        schedules,
        wallClockToInstant(nextKey, "00:00", timezone),
        beforeNoon,
        "m",
      );

      const fixture = `fixture ${i} (${timezone} ${dayKey})`;
      const midnight = compareViews(
        schedules,
        timezone,
        dayDoses,
        beforeMidnight,
        afterMidnight,
        `${fixture} midnight`,
      );
      const noon = compareViews(
        schedules,
        timezone,
        [...dayDoses, ...morningDoses],
        beforeNoon,
        afterNoon,
        `${fixture} noon`,
      );
      comparedAtMidnight += midnight.compared;
      earlierRowsAtMidnight += midnight.earlierRows;
      comparedAtNoon += noon.compared;
    }
    // Non-vacuity. The designing simulation saw 344 / 78 / 807.
    expect(comparedAtMidnight).toBeGreaterThan(200);
    expect(earlierRowsAtMidnight).toBeGreaterThan(40);
    expect(comparedAtNoon).toBeGreaterThan(500);
  }, 60_000);
});
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/unit/schedule-matching-properties.test.ts`
Expected: PASS, 2 tests, in well under a second each. If a non-vacuity threshold fails by a small margin, T3's projection differs from the contract. Inspect a fixture before you lower a threshold.

- [ ] **Step 5: Prove by mutation.** Apply each change to `src/lib/utils/schedule.ts` on its own, run `npx vitest run tests/unit/schedule-matching-properties.test.ts`, check the named test fails, then restore it.
  1. Move the `// Pass 2` block above `// Pass 1`. The differential fails: an unchanged `matchedDoseId` mismatch, about 25 fixtures.
  2. Delete `&& d.takenAt.getTime() <= nowMs` from the pass-2 filter. The differential fails: an oracle-`upcoming` slot resolved early.
  3. Delete the whole `// Pass 2` block. The differential fails on `expect(late).toBeGreaterThan(100)` (late is 0).
  4. In pass 2, replace the backward walk with a forward one: `for (let i = 0; i < ordered.length && hasCapacity(d); i++) { if (slotMs[i] >= at || slotMs[i] < bound || resolvedBy[i]) continue; resolvedBy[i] = d; spend(d); }`. Both tests fail.
  5. In `dashboardWindow`, set `projectEnd` to `end`. The stability test fails at midnight on at least one fixture (the designing simulation saw 2).
  6. In `dashboardWindow`, drop the `min(todayStart, …)` clamp from `visibleStart`. The stability test fails at noon on at least one fixture (the simulation saw 4).

- [ ] **Step 6: Commit**

```bash
git add tests/unit/helpers/legacy-slot-matcher.ts tests/unit/schedule-matching-properties.test.ts
git commit -m "test(schedule): seeded differential and stability properties for slot matching"
```

---

#### Cycle 5 — docs, then the whole suite

- [ ] **Step 1: Record the rule and the divergence in `CLAUDE.md`**

Use Edit with the anchor below and prepend the two new bullets. The result sits directly after the "Archiving" bullet, beside the denominator rules.

Anchor (old_string):

```
- **`src/lib/server/analytics/page-data.ts` owns the analytics page's composition.**
```

new_string:

```
- **`src/lib/utils/schedule.ts` is the single owner of "has this slot been handled?" — the window, both clips and passes 0–2 — and nothing re-derives any part of it.** `dashboardWindow` owns every bound. Projection runs from yesterday's local midnight (a day-key walk, never `todayStart − 24h`) to one `MATCH_TOLERANCE_MS` past `end`. `visibleStart` is the first millisecond under `CARRY_OVER_MS` old. **Tomorrow's first hour is matched but never returned**: without it, pass 1 at tomorrow's view takes a late-evening dose that pass 2 gave one of today's slots at today's view, and that row reappears as overdue at midnight. `projectMedicationSlots` owns both clips. The lifecycle clip drops everything outside `startedAt`/`endedAt`, so a medication added at 14:00 has no 08:00 slot. The schedule-edit clip drops any slot before `todayStart` that is older than the medication's earliest `effectiveFrom`: every save rewrites the rows with `effectiveFrom = now`, so the current rows say nothing about yesterday. `matchMedicationSlots` runs the passes over one medication, sharing **one** capacity map (`max(1, quantity)` for taken, 1 for a skip or missed row):
  - **Pass 0**: a taken dose at exactly a slot's instant claims it, with the smaller id winning a tie. So "Took it at 09:00" next to an open 08:55 resolves 09:00.
  - **Reserved skip**: a skip on one of the medication's slot instants is a pass-1 candidate for that slot only and never enters pass 2. So a real taken dose within the hour still beats it.
  - **Pass 1**: the shipped ±1h rule (taken over skipped/missed, then distance, then id) over what pass 0 left, with the **segment limit**. A dose must be taken before its slot's segment ends (`todayStart` for yesterday's slots, `end` for today's, no limit for tomorrow's first hour). So a 00:10 dose goes to today's 00:13, not yesterday's open 23:30.
  - **Pass 2**: leftover taken/skipped capacity with `takenAt ≤ now`, replayed in `(takenAt, id)` order. Each dose walks backwards from the last slot strictly before it, skipping resolved slots, and stops below `pass2Bound` (`visibleStart` with a window, `dayStart` without). A dose never resolves a slot after it.

  An unresolved slot is overdue or upcoming by time alone, even if it holds a missed row. Two proofs live in `tests/unit/schedule-matching-properties.test.ts`. One is a seeded differential against `tests/unit/helpers/legacy-slot-matcher.ts`, a **verbatim** copy of the pre-change matcher: never "fix" it, because a corrected oracle compares against nothing. The other is a seeded midnight/noon stability check. Anything that needs to know what a write would do must re-run these functions, never approximate them.
- **The dashboard and Analytics disagree about late and multi-unit doses, deliberately.** The dashboard answers "has this slot been handled?", with capacity and late resolution. Analytics counts dose events per civil day of `takenAt` (`analytics.ts`, under the denominator rules above). They already differed inside ±1h: one ×3 dose fills three slots on the dashboard and counts once in Analytics. Pass 2 extends that to late doses. A dose logged today can resolve yesterday's Earlier slot on the dashboard while Analytics files it under today. Converging the two would reverse a product decision either way: a late dose resolves the slot it was for, and logging now records the current time. So do not bend one surface to match the other; convergence belongs with the analytics-window (W1) or due-ness work. The "pinned divergence" test in `tests/unit/schedule.test.ts` holds this: fixed 08:00/14:00/20:00 and one ×3 dose at 20:30 give all three slots taken.
- **`src/lib/server/analytics/page-data.ts` owns the analytics page's composition.**
```

- [ ] **Step 2: Run the whole suite, types and lint**

Run: `npx vitest run`
Expected: PASS. Every file is green; no other suite reads a slot matched by a dose. `dashboard-timing-status.test.ts` still passes because its dose mock is empty.

Run: `npm run check`
Expected: `0 errors`. PGlite is installed in this worktree.

Run: `npm run lint`
Expected: no errors and no new warnings. In particular, nothing in `schedule.ts` or the two new test files is reported unused.

Run the verbatim check from Cycle 4 Step 2 once more.
Expected: `VERBATIM`. lint-staged's prettier pass must not have touched the oracle.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: record the slot-matching owner and the deliberate Analytics divergence"
```

---

### Task 5: `slotActions`: pick each dashboard button by simulating its write

This task adds one pure function to `src/lib/utils/schedule.ts`. For one medication it decides which buttons each visible row of the dashboard offers:

- **Log now**: at most one per medication.
- **Took it at HH:MM**: offered per row.
- **Skip**: offered per row.

It decides each button by simulating the dose row that the button would write, then re-running the T3/T4 matcher. It never uses a rule about which row "should" take a dose. The spec is `docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md`, § "Which buttons a row offers" and Section 4, which lists the Log-now and Took-it-at placement cases and the slot-anchored property.

Every expected value below was traced by hand against the contract rules T2–T4 implement. If a placement test fails after T2–T4 have landed, fix T2–T4 to match the contract. Do not edit the expectation.

**Files:**

- Modify: `src/lib/utils/schedule.ts`. Append after the last export at the end of the file. At HEAD `1b53ad7` the file ends at line 356; T2–T4 have grown it. The `Medication` and `MedicationSchedule` type imports at lines 1–2 already cover this block, and every other name it uses is defined in this module by T2/T3.
- Create: `tests/unit/slot-actions.test.ts`
- Test: `tests/unit/slot-actions.test.ts`

**Interfaces:**

- Consumes, from T2 (same module):
  - `export const MATCH_TOLERANCE_MS = 60 * 60 * 1000`
  - `export interface DashboardWindow { now: Date; todayKey: string; todayStart: Date; end: Date; projectStart: Date; projectEnd: Date; visibleStart: Date; doseFetchFrom: Date; doseFetchTo: Date }`
  - `export function dashboardWindow(now: Date, tz: string): DashboardWindow`, where `visibleStart = max(projectStart, min(todayStart, now − 12h + 1ms))`.
- Consumes, from T3 (same module):
  - `export type ScheduleKind = "interval" | "fixed_time"`
  - `export interface Segments { projectStart: Date; todayStart: Date; end: Date; projectEnd: Date }`
  - `export function segmentsFor(window: DashboardWindow): Segments`
  - `export interface ProjectedSlot { expectedTime: Date; kind: ScheduleKind; segment: "yesterday" | "today" | "tomorrow" }`
  - `export function projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`
  - `export function projectMedicationSlots(input: { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; lastTakenAt: Date | null; segments: Segments }): ProjectedSlot[]`
  - `export interface MatchDose { id: string; takenAt: Date; status: "taken" | "skipped" | "missed"; quantity: number }`
  - `export interface MatchedSlot extends ProjectedSlot { status: ScheduleSlotStatus; resolvedByDoseId: string | null; missedByDoseId: string | null }`
  - `export function matchMedicationSlots(slots: ProjectedSlot[], doses: MatchDose[], opts: { now: Date; segments: Segments; pass2Bound: Date }): MatchedSlot[]`
- Consumes, from T4: the behaviour of `matchMedicationSlots`. The hand-traced expectations depend on these rules:
  - Pass 0: an exact-millisecond taken claim; ties go to the smaller id.
  - Reserved skip: a skip on a slot instant is a candidate only for that slot, in pass 1, at rank 1, and never in pass 2.
  - Pass 1: ascending, `|Δ| ≤ 1h` inclusive, rank then distance then id, with the segment limit.
  - Pass 2: taken or skipped, non-reserved, `takenAt ≤ now`, ascending `(takenAt, id)`. It walks back from the last slot strictly before `takenAt`, skips resolved slots, and stops at a slot `< pass2Bound`.
  - Status of an unresolved slot is `overdue` when `≤ now`, otherwise `upcoming`.
  - Projection: an interval anchor inside the projection range is itself a slot. Drifted-twin suppression is ±1h inclusive, per segment. An exact interval/fixed collision keeps the fixed row.
- Produces (T7's composition and T8's `logDoseForSlot` rely on these):
  - `export const LOG_NOW_COOLDOWN_MS = 60 * 60 * 1000`
  - `export interface SlotActionInput { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; doses: MatchDose[]; lastTakenAt: Date | null; window: DashboardWindow }`
  - `export interface RowActions { tookItAt: string | null; skipAt: string | null }`
  - `export interface SlotActions { logNowTarget: string | null; rows: Map<string, RowActions> }`. `rows` is keyed by the ISO `expectedTime` of every visible, unresolved row, including Later rows more than 1h ahead, which always get `{ tookItAt: null, skipAt: null }`.
  - `export function slotActions(input: SlotActionInput): SlotActions`

- [ ] **Step 1: Write the failing tests for Took it at and Skip**

Create `tests/unit/slot-actions.test.ts`:

```ts
/**
 * `slotActions` decides every dashboard button by simulating the write the
 * button makes and re-running the matcher. The placement cases are the ones
 * Section 4 of docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md
 * lists; the seeded property at the end pins that pressing any offered
 * button changes its own row and no other.
 *
 * Fixtures are UTC unless a test names a zone. 2026-04-16 is a Thursday.
 */
import { describe, it, expect } from "vitest";
import {
  dashboardWindow,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  slotActions,
} from "$lib/utils/schedule";
import type {
  DashboardWindow,
  MatchDose,
  MatchedSlot,
  RowActions,
  SlotActionInput,
  SlotActions,
} from "$lib/utils/schedule";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

// ── Fixtures ────────────────────────────────────────────────────────────

// Same shape as makeMed in tests/unit/schedule.test.ts.
function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "TestMed",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: "8",
    inventoryCount: null,
    inventoryAlertThreshold: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    lowInventoryEpisodeAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fixed(
  timeOfDay: string,
  sortOrder = 0,
  overrides: Partial<MedicationSchedule> = {},
): MedicationSchedule {
  return {
    id: `sched-med-1-fixed-${sortOrder}`,
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function interval(
  intervalHours: string,
  overrides: Partial<MedicationSchedule> = {},
): MedicationSchedule {
  return {
    id: "sched-med-1-interval",
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function dose(
  id: string,
  takenAt: string,
  status: MatchDose["status"] = "taken",
  quantity = 1,
): MatchDose {
  return { id, takenAt: new Date(takenAt), status, quantity };
}

function at(iso: string): Date {
  return new Date(iso);
}

/** What getLastDosePerMedication returns for these doses: the latest TAKEN takenAt. */
function latestTaken(doses: MatchDose[]): Date | null {
  const taken = doses.filter((d) => d.status === "taken").map((d) => d.takenAt.getTime());
  return taken.length > 0 ? new Date(Math.max(...taken)) : null;
}

/** One medication's input, built the way the load builds it. */
function setup(opts: {
  now: string;
  schedules: MedicationSchedule[];
  doses?: MatchDose[];
  tz?: string;
}): SlotActionInput {
  const tz = opts.tz ?? "UTC";
  const window = dashboardWindow(new Date(opts.now), tz);
  const doses = opts.doses ?? [];
  return {
    med: makeMed(),
    schedules: opts.schedules,
    fixedInstants: projectFixedTimes(opts.schedules, segmentsFor(window), tz),
    doses,
    lastTakenAt: latestTaken(doses),
    window,
  };
}

/** What the next load computes for this medication: the same projection and matcher, fresh. */
function matchWith(
  i: SlotActionInput,
  doses: MatchDose[],
  lastTakenAt: Date | null,
): MatchedSlot[] {
  const segments = segmentsFor(i.window);
  const projected = projectMedicationSlots({
    med: i.med,
    schedules: i.schedules,
    fixedInstants: i.fixedInstants,
    lastTakenAt,
    segments,
  });
  return matchMedicationSlots(projected, doses, {
    now: i.window.now,
    segments,
    pass2Bound: i.window.visibleStart,
  });
}

function rowsOf(a: SlotActions): Record<string, RowActions> {
  return Object.fromEntries(a.rows);
}

/** Today's slots as [ISO, status], ascending. */
function todayRows(slots: MatchedSlot[], w: DashboardWindow): Array<[string, string]> {
  return slots
    .filter(
      (s) =>
        s.expectedTime.getTime() >= w.todayStart.getTime() &&
        s.expectedTime.getTime() < w.end.getTime(),
    )
    .map((s): [string, string] => [s.expectedTime.toISOString(), s.status]);
}

/** Fixed 08:00 and 20:00, nothing logged, at 08:10. */
const commonCase = () =>
  setup({ now: "2026-04-16T08:10:00Z", schedules: [fixed("08:00"), fixed("20:00", 1)] });

/** One fixed 14:00 slot, nothing logged. */
const dueAtTwo = (now: string) => setup({ now, schedules: [fixed("14:00")] });

/** The live account from the spec: fixed 08:55, 09:00 and 11:00, nothing logged, at 09:30. */
const liveMorning = () =>
  setup({
    now: "2026-04-16T09:30:00Z",
    schedules: [fixed("08:55"), fixed("09:00", 1), fixed("11:00", 2)],
  });

/** One fixed 22:00 slot, nothing logged: yesterday's 22:00 is an Earlier row until 10:00. */
const bedtime = (now: string) => setup({ now, schedules: [fixed("22:00")] });

/** Fixed 00:30 at 23:45: tomorrow's 00:30 is in the window's matched-but-hidden first hour. */
const lateNight = () => setup({ now: "2026-04-16T23:45:00Z", schedules: [fixed("00:30")] });

/** Fixed 13:00 and 13:45 at 13:30, nothing logged. */
const aheadWithEarlierOpen = () =>
  setup({ now: "2026-04-16T13:30:00Z", schedules: [fixed("13:00"), fixed("13:45", 1)] });

/** Fixed 12:40 and 13:10 at 13:30, nothing logged: the spec's Took-it-at case. */
const twoPastInTheHour = () =>
  setup({ now: "2026-04-16T13:30:00Z", schedules: [fixed("12:40"), fixed("13:10", 1)] });

/** Legacy mix: a 24h interval row last taken yesterday 18:00, plus fixed 09:00, at 13:30. */
const mixedLegacy = () =>
  setup({
    now: "2026-04-16T13:30:00Z",
    schedules: [interval("24"), fixed("09:00", 1)],
    doses: [dose("d1", "2026-04-15T18:00:00Z")],
  });

/**
 * Legacy mix where a re-anchor re-attributes: fixed 04:00 and 13:00 plus a
 * 24h interval row whose projection sits on today's 06:00 dose, at 13:30.
 */
const reanchorReattributes = () =>
  setup({
    now: "2026-04-16T13:30:00Z",
    schedules: [interval("24"), fixed("04:00", 1), fixed("13:00", 2)],
    doses: [dose("d1", "2026-04-16T06:00:00Z")],
  });

/** Fixed 09:00 and 13:00; 13:00 was skipped at its own instant. */
const skippedAtOne = (now: string) =>
  setup({
    now,
    schedules: [fixed("09:00"), fixed("13:00", 1)],
    doses: [dose("s1", "2026-04-16T13:00:00Z", "skipped")],
  });

/** An 8-hour interval last taken yesterday 22:00: today's grid is 06:00, 14:00, 22:00. At 13:30. */
const eightHourly = () =>
  setup({
    now: "2026-04-16T13:30:00Z",
    schedules: [interval("8")],
    doses: [dose("d1", "2026-04-15T22:00:00Z")],
  });

/** Fixed 22:00 in Europe/London (BST) at 09:00 local. */
const londonBedtime = () =>
  setup({ now: "2026-04-16T08:00:00Z", tz: "Europe/London", schedules: [fixed("22:00")] });

// ── Took it at and Skip ─────────────────────────────────────────────────

describe("slotActions — Took it at and Skip", () => {
  it("offers both at a past row's own instant, and nothing on a row hours ahead", () => {
    // Yesterday's 08:00 and 20:00 are unresolved but more than 12 hours old
    // at 08:10, so they are not rows at all. Skip-at-now for 20:00 would land
    // on the open 08:00 (pass 1 walks ascending), so 20:00 offers nothing.
    expect(rowsOf(slotActions(commonCase()))).toEqual({
      "2026-04-16T08:00:00.000Z": {
        tookItAt: "2026-04-16T08:00:00.000Z",
        skipAt: "2026-04-16T08:00:00.000Z",
      },
      "2026-04-16T20:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("records a skip for a slot still ahead at now — never future-dated — and only within the hour", () => {
    expect(rowsOf(slotActions(dueAtTwo("2026-04-16T13:30:00Z")))).toEqual({
      "2026-04-16T14:00:00.000Z": { tookItAt: null, skipAt: "2026-04-16T13:30:00.000Z" },
    });
    expect(rowsOf(slotActions(dueAtTwo("2026-04-16T13:00:00Z")))).toEqual({
      "2026-04-16T14:00:00.000Z": { tookItAt: null, skipAt: "2026-04-16T13:00:00.000Z" },
    });
    // One millisecond further out, pass 1 cannot reach the slot and pass 2
    // never resolves a slot after its dose.
    expect(rowsOf(slotActions(dueAtTwo("2026-04-16T12:59:59.999Z")))).toEqual({
      "2026-04-16T14:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("gives every past row of the live account its own instant, whatever pass 1 would do", () => {
    // Pass 0 claims an exact taken instant, and a skip on a slot instant is
    // reserved for that slot, so 09:00's buttons resolve 09:00 even with
    // 08:55 open beside it. Skip-at-09:30 for 11:00 would land on 08:55.
    expect(rowsOf(slotActions(liveMorning()))).toEqual({
      "2026-04-16T08:55:00.000Z": {
        tookItAt: "2026-04-16T08:55:00.000Z",
        skipAt: "2026-04-16T08:55:00.000Z",
      },
      "2026-04-16T09:00:00.000Z": {
        tookItAt: "2026-04-16T09:00:00.000Z",
        skipAt: "2026-04-16T09:00:00.000Z",
      },
      "2026-04-16T11:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("gives a due-now row still ahead no buttons while an earlier slot is open within the hour", () => {
    // Skip at 13:30 would land on 13:00 (ascending pass 1), not 13:45.
    expect(rowsOf(slotActions(aheadWithEarlierOpen()))).toEqual({
      "2026-04-16T13:00:00.000Z": {
        tookItAt: "2026-04-16T13:00:00.000Z",
        skipAt: "2026-04-16T13:00:00.000Z",
      },
      "2026-04-16T13:45:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("offers Took it at on both past rows inside the hour", () => {
    // 12:40 is also the Log-now row (see the Log now block). Hiding its Took
    // it at is the composition's presentation rule, not slotActions'.
    expect(rowsOf(slotActions(twoPastInTheHour()))).toEqual({
      "2026-04-16T12:40:00.000Z": {
        tookItAt: "2026-04-16T12:40:00.000Z",
        skipAt: "2026-04-16T12:40:00.000Z",
      },
      "2026-04-16T13:10:00.000Z": {
        tookItAt: "2026-04-16T13:10:00.000Z",
        skipAt: "2026-04-16T13:10:00.000Z",
      },
    });
  });

  it("keys an Earlier row by yesterday's instant until it is 12 hours old, to the millisecond", () => {
    const earlier = {
      "2026-04-15T22:00:00.000Z": {
        tookItAt: "2026-04-15T22:00:00.000Z",
        skipAt: "2026-04-15T22:00:00.000Z",
      },
      // Skip-at-now lands on yesterday's open 22:00 through pass 2.
      "2026-04-16T22:00:00.000Z": { tookItAt: null, skipAt: null },
    };
    expect(rowsOf(slotActions(bedtime("2026-04-16T09:00:00Z")))).toEqual(earlier);
    expect(rowsOf(slotActions(bedtime("2026-04-16T09:59:59.999Z")))).toEqual(earlier);
    expect(rowsOf(slotActions(bedtime("2026-04-16T10:00:00.000Z")))).toEqual({
      "2026-04-16T22:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("never gives tomorrow's first hour a row, though it is matched", () => {
    expect(rowsOf(slotActions(lateNight()))).toEqual({
      "2026-04-16T00:30:00.000Z": {
        tookItAt: "2026-04-16T00:30:00.000Z",
        skipAt: "2026-04-16T00:30:00.000Z",
      },
    });
  });

  it("re-projects interval rows before judging Took it at", () => {
    const i = mixedLegacy();
    // Skip-at-13:30 for 18:00 lands on the open 09:00 through pass 2.
    expect(rowsOf(slotActions(i))).toEqual({
      "2026-04-16T09:00:00.000Z": {
        tookItAt: "2026-04-16T09:00:00.000Z",
        skipAt: "2026-04-16T09:00:00.000Z",
      },
      "2026-04-16T18:00:00.000Z": { tookItAt: null, skipAt: null },
    });
    // What pressing it does on the next load: lastTakenAt moves to 09:00, the
    // 24h row re-anchors onto the fixed 09:00 (an exact collision keeps the
    // fixed row), and today's 18:00 interval row stops existing.
    const next = matchWith(
      i,
      [...i.doses, dose("applied", "2026-04-16T09:00:00Z")],
      at("2026-04-16T09:00:00Z"),
    );
    expect(todayRows(next, i.window)).toEqual([["2026-04-16T09:00:00.000Z", "taken"]]);
  });

  it("withholds Took it at when the re-anchor would hand an earlier dose to another row", () => {
    // Today's 06:00 dose sits on the interval projection (pass 0). Recording
    // 13:00 moves lastTakenAt to 13:00: the interval row re-anchors onto the
    // fixed 13:00, the 06:00 slot stops existing, and pass 2 hands the freed
    // 06:00 dose to the open 04:00. One tap would change two rows, so 13:00
    // offers Skip only. Recording 04:00 does not move the anchor (06:00 is
    // later), so 04:00 keeps both.
    expect(rowsOf(slotActions(reanchorReattributes()))).toEqual({
      "2026-04-16T04:00:00.000Z": {
        tookItAt: "2026-04-16T04:00:00.000Z",
        skipAt: "2026-04-16T04:00:00.000Z",
      },
      "2026-04-16T13:00:00.000Z": { tookItAt: null, skipAt: "2026-04-16T13:00:00.000Z" },
    });
  });

  it("gives a slot skipped at its instant no row; the open one keeps both buttons", () => {
    expect(rowsOf(slotActions(skippedAtOne("2026-04-16T13:30:00Z")))).toEqual({
      "2026-04-16T09:00:00.000Z": {
        tookItAt: "2026-04-16T09:00:00.000Z",
        skipAt: "2026-04-16T09:00:00.000Z",
      },
    });
  });

  it("offers both on an overdue interval row and Skip-at-now on the one due next", () => {
    // Skip-at-13:30 for 22:00 would land on 14:00, so 22:00 offers nothing.
    expect(rowsOf(slotActions(eightHourly()))).toEqual({
      "2026-04-16T06:00:00.000Z": {
        tookItAt: "2026-04-16T06:00:00.000Z",
        skipAt: "2026-04-16T06:00:00.000Z",
      },
      "2026-04-16T14:00:00.000Z": { tookItAt: null, skipAt: "2026-04-16T13:30:00.000Z" },
      "2026-04-16T22:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });

  it("reads every bound from the window: a London Earlier row under BST", () => {
    // 22:00 BST yesterday is 21:00Z; at 09:00 BST it is 11 hours old.
    expect(rowsOf(slotActions(londonBedtime()))).toEqual({
      "2026-04-15T21:00:00.000Z": {
        tookItAt: "2026-04-15T21:00:00.000Z",
        skipAt: "2026-04-15T21:00:00.000Z",
      },
      "2026-04-16T21:00:00.000Z": { tookItAt: null, skipAt: null },
    });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: FAIL. All 12 tests fail with `TypeError: … slotActions is not a function`, because the export does not exist yet. T2–T4's exports (`dashboardWindow`, `projectFixedTimes`, `segmentsFor`, `projectMedicationSlots`, `matchMedicationSlots`) must resolve. If the error names one of those instead, T2–T4 are not merged, so stop.

- [ ] **Step 3: Write the minimal implementation (rows only)**

Append to the end of `src/lib/utils/schedule.ts`:

```ts
// ── Dashboard buttons ─────────────────────────────────────────────────────

/**
 * How long after a taken dose Log now stays off that medication (D8). A
 * second tap inside the hour is far likelier a double log than a second
 * dose. Took it at and Skip stay, because each names its own instant.
 */
export const LOG_NOW_COOLDOWN_MS = 60 * 60 * 1000;

export interface SlotActionInput {
  med: Medication;
  schedules: MedicationSchedule[];
  /**
   * `projectFixedTimes(schedules, segmentsFor(window), tz)` for this
   * medication — computed once per request and reused by every simulation,
   * which is what keeps the simulations free of `Intl`.
   */
  fixedInstants: Date[];
  /** This medication's doses in `[window.doseFetchFrom, window.doseFetchTo)`. */
  doses: MatchDose[];
  /** All-time latest TAKEN `takenAt` (`getLastDosePerMedication`); skips never anchor. */
  lastTakenAt: Date | null;
  window: DashboardWindow;
}

/** One visible, unresolved row's secondary buttons. ISO instants, posted verbatim. */
export interface RowActions {
  /** "Took it at HH:MM": always the row's own instant, or null. */
  tookItAt: string | null;
  /** Skip at `min(expectedTime, now)`, so never future-dated, or null. */
  skipAt: string | null;
}

export interface SlotActions {
  /** ISO `expectedTime` of the one row that carries Log now, or null. */
  logNowTarget: string | null;
  /** Every visible, unresolved row, keyed by ISO `expectedTime`. */
  rows: Map<string, RowActions>;
}

/**
 * A probe's id. U+FFFF sorts after every stored id, so a simulated dose
 * never wins a tie a real row would have won — pass 0's smaller-id rule,
 * pass 1's id tie-break, pass 2's `(takenAt, id)` order.
 */
const PROBE_ID = "￿";

interface SlotIndex {
  all: Map<number, MatchedSlot>;
  visible: Map<number, MatchedSlot>;
}

/**
 * The dashboard's visibility rule: before `end`, and either on today's
 * civil day or an overdue Earlier row under 12 hours old.
 */
function isVisibleSlot(slot: MatchedSlot, window: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= window.end.getTime()) return false;
  if (t >= window.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= window.visibleStart.getTime();
}

function indexSlots(slots: MatchedSlot[], window: DashboardWindow): SlotIndex {
  const all = new Map<number, MatchedSlot>();
  const visible = new Map<number, MatchedSlot>();
  for (const slot of slots) {
    const t = slot.expectedTime.getTime();
    all.set(t, slot);
    if (isVisibleSlot(slot, window)) visible.set(t, slot);
  }
  return { all, visible };
}

/**
 * Does `sim` show every visible row of `base` — bar the one at `ownMs` — at
 * the same instant with the same status?
 *
 * The only licensed difference is an interval row the re-anchor stopped
 * projecting (in `base`, absent from `sim`) or newly projects (in `sim`,
 * absent from `base`): a taken probe moves `lastTakenAt`, and the next load
 * supersedes those rows the same way. Anything else — an overdue row
 * turning taken because a freed dose slid onto it, an Earlier row leaving
 * the list — means the tap would change a row it is not on.
 */
function othersUnchanged(base: SlotIndex, sim: SlotIndex, ownMs: number): boolean {
  for (const [t, before] of base.visible) {
    if (t === ownMs) continue;
    const after = sim.visible.get(t);
    if (after) {
      if (after.status !== before.status) return false;
    } else if (before.kind !== "interval" || sim.all.has(t)) {
      return false;
    }
  }
  for (const [t, after] of sim.visible) {
    if (t === ownMs || base.visible.has(t)) continue;
    if (after.kind !== "interval" || base.all.has(t)) return false;
  }
  return true;
}

/**
 * Which buttons each visible, unresolved row of ONE medication offers,
 * decided by SIMULATING the write each button makes and re-running the
 * matcher — never by a rule about which row "should" take a dose.
 *
 * - Log now probes a taken ×1 dose at `now`. Its target is the latest
 *   visible, unresolved row at most `MATCH_TOLERANCE_MS` ahead that the dose
 *   would resolve (or, for an interval row, supersede by re-anchoring) while
 *   every other visible row stays as it is. None while a taken dose sits in
 *   `(now − LOG_NOW_COOLDOWN_MS, now]`.
 * - Took it at probes a taken dose at exactly the row's instant (past rows
 *   only) and is offered when that resolves this row and moves no other.
 * - Skip probes a skip at `min(expectedTime, now)` and is offered when that
 *   moves this row, and no other, to skipped.
 *
 * Every taken probe re-projects the interval rows with
 * `lastTakenAt' = max(lastTakenAt, probe.takenAt)`, which is what the next
 * load will see. No simulation calls `isoDayKey` or `wallClockToInstant`:
 * fixed-time instants arrive precomputed in `fixedInstants`.
 *
 * Log now's "no other row moves" condition is deliberately stricter than
 * the spec's wording. On a medication mixing interval and fixed rows, the
 * re-anchor can free an old dose that pass 2 then hands to another row, or
 * supersede a later interval row while the dose itself lands on a fixed
 * one; without the guard Log now would sit on a row whose tap changes a
 * different row. tests/unit/slot-actions.test.ts pins the placement cases
 * and the slot-anchored property this guarantees.
 */
export function slotActions(input: SlotActionInput): SlotActions {
  const { med, schedules, fixedInstants, doses, lastTakenAt, window } = input;
  const now = window.now;
  const nowMs = now.getTime();
  const segments = segmentsFor(window);
  const matchOpts = { now, segments, pass2Bound: window.visibleStart };

  const project = (anchor: Date | null): ProjectedSlot[] =>
    projectMedicationSlots({ med, schedules, fixedInstants, lastTakenAt: anchor, segments });

  const baseProjection = project(lastTakenAt);
  const base = matchMedicationSlots(baseProjection, doses, matchOpts);
  const baseIndex = indexSlots(base, window);

  const simulate = (takenAt: Date, status: "taken" | "skipped"): SlotIndex => {
    const probe: MatchDose = { id: PROBE_ID, takenAt, status, quantity: 1 };
    // Only a taken dose moves the interval anchor, and only forwards.
    const reanchors =
      status === "taken" && (lastTakenAt === null || takenAt.getTime() > lastTakenAt.getTime());
    const projection = reanchors ? project(takenAt) : baseProjection;
    return indexSlots(matchMedicationSlots(projection, [...doses, probe], matchOpts), window);
  };

  const open = base
    .filter((slot) => slot.resolvedByDoseId === null && isVisibleSlot(slot, window))
    .sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());

  const rows = new Map<string, RowActions>();
  // Every row still ahead probes the same skip-at-now, so simulate it once.
  const skipSims = new Map<number, SlotIndex>();
  for (const slot of open) {
    const t = slot.expectedTime.getTime();

    let tookItAt: string | null = null;
    if (t <= nowMs) {
      const sim = simulate(slot.expectedTime, "taken");
      if (sim.all.get(t)?.status === "taken" && othersUnchanged(baseIndex, sim, t)) {
        tookItAt = slot.expectedTime.toISOString();
      }
    }

    const skipMs = Math.min(t, nowMs);
    let skipSim = skipSims.get(skipMs);
    if (!skipSim) {
      skipSim = simulate(new Date(skipMs), "skipped");
      skipSims.set(skipMs, skipSim);
    }
    const skipAt =
      skipSim.all.get(t)?.status === "skipped" && othersUnchanged(baseIndex, skipSim, t)
        ? new Date(skipMs).toISOString()
        : null;

    rows.set(slot.expectedTime.toISOString(), { tookItAt, skipAt });
  }

  return { logNowTarget: null, rows };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Write the failing Log-now placement tests**

Append to `tests/unit/slot-actions.test.ts`:

```ts
/** Fixed 08:00 and 12:00 at 12:10, one dose taken at `lastDoseAt` (it resolves 12:00). */
const cooldownAfter = (lastDoseAt: string) =>
  setup({
    now: "2026-04-16T12:10:00Z",
    schedules: [fixed("08:00"), fixed("12:00", 1)],
    doses: [dose("d1", lastDoseAt)],
  });

// ── Log now ─────────────────────────────────────────────────────────────

describe("slotActions — Log now placement", () => {
  it("the common case: the open slot the dose will resolve", () => {
    expect(slotActions(commonCase()).logNowTarget).toBe("2026-04-16T08:00:00.000Z");
  });

  it("sits on a slot due within the hour, to the millisecond", () => {
    expect(slotActions(dueAtTwo("2026-04-16T13:30:00Z")).logNowTarget).toBe(
      "2026-04-16T14:00:00.000Z",
    );
    expect(slotActions(dueAtTwo("2026-04-16T13:00:00Z")).logNowTarget).toBe(
      "2026-04-16T14:00:00.000Z",
    );
    expect(slotActions(dueAtTwo("2026-04-16T12:59:59.999Z")).logNowTarget).toBeNull();
  });

  it("goes where a dose logged now would land — 08:55, not the later 09:00", () => {
    // Pass 1 walks ascending, so a 09:30 dose resolves 08:55 first. The
    // "latest outstanding" premise the spec rejected would have put the
    // button on 09:00 and left that row overdue after the tap.
    expect(slotActions(liveMorning()).logNowTarget).toBe("2026-04-16T08:55:00.000Z");
  });

  it("sits on an Earlier row until it is 12 hours old, to the millisecond", () => {
    expect(slotActions(bedtime("2026-04-16T09:00:00Z")).logNowTarget).toBe(
      "2026-04-15T22:00:00.000Z",
    );
    expect(slotActions(bedtime("2026-04-16T09:59:59.999Z")).logNowTarget).toBe(
      "2026-04-15T22:00:00.000Z",
    );
    // Hidden: pass 2 stops at visibleStart, so the dose resolves nothing.
    expect(slotActions(bedtime("2026-04-16T10:00:00.000Z")).logNowTarget).toBeNull();
  });

  it("never targets tomorrow's first hour, even when that is where the dose would land", () => {
    // A dose at 23:45 resolves tomorrow's 00:30 (pass 1, 45 minutes), not
    // today's 00:30 (23h15m ago), so today's row gets no Log now.
    expect(slotActions(lateNight()).logNowTarget).toBeNull();
  });

  it("has no target on a mixed medication whose dose would land on a new interval row", () => {
    // Logging at 13:30 re-anchors the 24h row onto 13:30 (no fixed slot
    // within the hour to suppress it) and pass 0 gives the dose to that new
    // slot; the fixed 09:00 stays open either way.
    expect(slotActions(mixedLegacy()).logNowTarget).toBeNull();
  });

  it("has no target when the tap would also re-attribute an earlier dose", () => {
    // At 13:30 the re-anchored 13:30 slot is suppressed as a twin of the
    // fixed 13:00, the dose resolves 13:00, and the freed 06:00 dose slides
    // onto 04:00. Neither row can carry a button that changes the other.
    expect(slotActions(reanchorReattributes()).logNowTarget).toBeNull();
  });

  it("is absent for the hour after a slot is skipped at its instant, then returns", () => {
    // Taken beats skip: a dose inside the hour would go to the skipped 13:00.
    expect(slotActions(skippedAtOne("2026-04-16T13:30:00Z")).logNowTarget).toBeNull();
    expect(slotActions(skippedAtOne("2026-04-16T14:00:00.000Z")).logNowTarget).toBeNull();
    // Past the hour, pass 2 walks back over the skipped 13:00 to 09:00.
    expect(slotActions(skippedAtOne("2026-04-16T14:00:00.001Z")).logNowTarget).toBe(
      "2026-04-16T09:00:00.000Z",
    );
  });

  it("targets the interval row a new dose supersedes, never one more than an hour ahead", () => {
    const i = eightHourly();
    // A 13:30 dose re-anchors the grid, superseding 06:00, 14:00 and 22:00;
    // 22:00 is beyond now + 1h, so the latest within reach is 14:00.
    expect(slotActions(i).logNowTarget).toBe("2026-04-16T14:00:00.000Z");
    const next = matchWith(
      i,
      [...i.doses, dose("applied", "2026-04-16T13:30:00Z")],
      at("2026-04-16T13:30:00Z"),
    );
    expect(todayRows(next, i.window)).toEqual([
      ["2026-04-16T13:30:00.000Z", "taken"],
      ["2026-04-16T21:30:00.000Z", "upcoming"],
    ]);
  });

  it("is withheld for an hour after a taken dose — (now − 1h, now], to the millisecond", () => {
    const rowsWhenOpen = {
      "2026-04-16T08:00:00.000Z": {
        tookItAt: "2026-04-16T08:00:00.000Z",
        skipAt: "2026-04-16T08:00:00.000Z",
      },
    };
    const clear = slotActions(cooldownAfter("2026-04-16T11:10:00.000Z"));
    expect(clear.logNowTarget).toBe("2026-04-16T08:00:00.000Z");
    const cooling = slotActions(cooldownAfter("2026-04-16T11:10:00.001Z"));
    expect(cooling.logNowTarget).toBeNull();
    // Only Log now cools down: Took it at and Skip name their own instant.
    expect(rowsOf(clear)).toEqual(rowsWhenOpen);
    expect(rowsOf(cooling)).toEqual(rowsWhenOpen);
  });

  it("with a due-now slot ahead and an earlier one open within the hour, targets the earlier one", () => {
    expect(slotActions(aheadWithEarlierOpen()).logNowTarget).toBe("2026-04-16T13:00:00.000Z");
  });

  it("leaves Took it at as the only way to record the later of two past rows in the hour", () => {
    const a = slotActions(twoPastInTheHour());
    expect(a.logNowTarget).toBe("2026-04-16T12:40:00.000Z");
    expect(a.rows.get("2026-04-16T13:10:00.000Z")?.tookItAt).toBe("2026-04-16T13:10:00.000Z");
  });

  it("round trip: once the dose is recorded, the target is resolved and Log now cools down", () => {
    const i = liveMorning();
    const target = slotActions(i).logNowTarget;
    expect(target).toBe("2026-04-16T08:55:00.000Z");
    const logged = dose("applied", "2026-04-16T09:30:00Z");
    const next: SlotActionInput = {
      ...i,
      doses: [...i.doses, logged],
      lastTakenAt: logged.takenAt,
    };
    const resolved = matchWith(next, next.doses, next.lastTakenAt).find(
      (s) => s.expectedTime.toISOString() === target,
    );
    expect(resolved?.status).toBe("taken");
    expect(resolved?.resolvedByDoseId).toBe("applied");
    const again = slotActions(next);
    expect(again.logNowTarget).toBeNull();
    expect(again.rows.get("2026-04-16T09:00:00.000Z")).toEqual({
      tookItAt: "2026-04-16T09:00:00.000Z",
      skipAt: "2026-04-16T09:00:00.000Z",
    });
  });

  it("targets a London Earlier row by its UTC instant", () => {
    expect(slotActions(londonBedtime()).logNowTarget).toBe("2026-04-15T21:00:00.000Z");
  });
});
```

- [ ] **Step 6: Run the tests and confirm the new ones fail**

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: FAIL. 11 tests fail with `expected null to be '2026-…'`. The three that expect `null` pass: tomorrow's first hour, the mixed medication, and the re-attribution case. The 12 Took-it-at/Skip tests still pass.

- [ ] **Step 7: Implement Log now**

In `slotActions` in `src/lib/utils/schedule.ts`, replace the final line:

```ts
  return { logNowTarget: null, rows };
}
```

with:

```ts
  let logNowTarget: string | null = null;
  const cooling = doses.some(
    (d) =>
      d.status === "taken" &&
      d.takenAt.getTime() > nowMs - LOG_NOW_COOLDOWN_MS &&
      d.takenAt.getTime() <= nowMs,
  );
  if (!cooling && open.length > 0) {
    const sim = simulate(now, "taken");
    const reach = nowMs + MATCH_TOLERANCE_MS;
    // Latest first: the target is the latest row a dose logged now would resolve.
    for (let k = open.length - 1; k >= 0; k--) {
      const slot = open[k];
      const t = slot.expectedTime.getTime();
      if (t > reach) continue;
      // Resolved by a taken dose, or (interval rows only) superseded by the re-anchor.
      const after = sim.all.get(t);
      const landed = after ? after.status === "taken" : slot.kind === "interval";
      if (!landed || !othersUnchanged(baseIndex, sim, t)) continue;
      logNowTarget = slot.expectedTime.toISOString();
      break;
    }
  }

  return { logNowTarget, rows };
}
```

- [ ] **Step 8: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/slot-actions.test.ts tests/unit/schedule.test.ts`
Expected: PASS. `slot-actions` has 26 tests. `schedule.test.ts` is unchanged by this task and still passes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/utils/schedule.ts tests/unit/slot-actions.test.ts
git commit -m "feat(schedule): decide dashboard buttons by simulating their writes"
```

- [ ] **Step 10: Add the seeded slot-anchored property**

In `tests/unit/slot-actions.test.ts`, extend the value import at the top:

```ts
import {
  LOG_NOW_COOLDOWN_MS,
  MATCH_TOLERANCE_MS,
  dashboardWindow,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  slotActions,
} from "$lib/utils/schedule";
```

Then append to the end of the file:

```ts
// ── Seeded slot-anchored property ───────────────────────────────────────

const SEED = 0x5107_ac75;
/** Roughly 1ms per fixture: comfortably inside the explicit 60s timeout. */
const FIXTURES = 1_500;
/**
 * The id a pressed button's dose gets here. Like slotActions' probe it sorts
 * after every fixture id ("d0".."d5"), so ties break the same way.
 */
const APPLIED_ID = "zz-applied";
const ZONES = ["UTC", "Europe/London", "America/New_York", "Pacific/Auckland"] as const;
const INTERVAL_HOURS = ["4", "6", "8", "12", "24"] as const;
const LONG_AGO = new Date("2025-01-01T00:00:00Z");

/** mulberry32: a tiny deterministic PRNG, so a failure names a reproducible fixture. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const minuteFormatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock minute of `at` in `tz` (0–1439): where to cluster slots so they sit near now. */
function localMinuteOfDay(at: Date, tz: string): number {
  let fmt = minuteFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
    });
    minuteFormatters.set(tz, fmt);
  }
  const parts = fmt.formatToParts(at);
  const field = (type: "hour" | "minute") => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return field("hour") * 60 + field("minute");
}

function hhmm(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

function generateFixture(rng: () => number): { input: SlotActionInput; tz: string } {
  const int = (lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

  const tz = pick(ZONES);
  const now = new Date(Date.UTC(2026, 0, 1) + int(0, 364 * 24 * 60) * 60_000);
  const window = dashboardWindow(now, tz);
  const nowMinute = localMinuteOfDay(now, tz);

  // A save rewrites every schedule row with effectiveFrom = now: one instant per medication.
  const effectiveFrom = rng() < 0.15 ? new Date(now.getTime() - int(0, 36) * 3_600_000) : LONG_AGO;
  const schedules: MedicationSchedule[] = [];
  const fixedCount = rng() < 0.15 ? 0 : int(1, 4);
  for (let k = 0; k < fixedCount; k++) {
    // Most slots cluster in the four hours before now and the two after, where the buttons are.
    const minute = rng() < 0.6 ? nowMinute + 5 * int(-48, 24) : 5 * int(0, 287);
    const daysOfWeek = rng() < 0.15 ? [int(0, 6), int(0, 6)] : null;
    schedules.push(fixed(hhmm(minute), k + 1, { daysOfWeek, effectiveFrom }));
  }
  if (fixedCount === 0 || rng() < 0.3) {
    schedules.push(interval(pick(INTERVAL_HOURS), { effectiveFrom }));
  }

  const fixedInstants = projectFixedTimes(schedules, segmentsFor(window), tz);
  const pastInstants = fixedInstants.filter((t) => t.getTime() <= now.getTime());
  const fetchFrom = window.doseFetchFrom.getTime();
  const doses: MatchDose[] = [];
  const doseCount = int(0, 6);
  for (let k = 0; k < doseCount; k++) {
    const roll = rng();
    let takenAt: Date;
    if (roll < 0.25 && pastInstants.length > 0) {
      takenAt = new Date(pick(pastInstants).getTime()); // Took it at / reserved skip
    } else if (roll < 0.3) {
      takenAt = new Date(now.getTime() + int(1, 90) * 60_000); // future-dated
    } else if (roll < 0.8) {
      takenAt = new Date(now.getTime() - int(0, 300) * 60_000);
    } else {
      takenAt = new Date(fetchFrom + Math.floor(rng() * (now.getTime() - fetchFrom)));
    }
    const s = rng();
    const status: MatchDose["status"] = s < 0.7 ? "taken" : s < 0.95 ? "skipped" : "missed";
    const quantity = status === "taken" && rng() < 0.25 ? int(2, 3) : 1;
    doses.push({ id: `d${k}`, takenAt, status, quantity });
  }

  const takenMs = doses.filter((d) => d.status === "taken").map((d) => d.takenAt.getTime());
  const lastTakenAt =
    takenMs.length > 0
      ? new Date(Math.max(...takenMs))
      : rng() < 0.5
        ? null
        : new Date(fetchFrom - int(1, 48) * 3_600_000);
  const med = makeMed({
    startedAt: rng() < 0.15 ? new Date(now.getTime() - int(0, 36) * 3_600_000) : LONG_AGO,
  });
  return { input: { med, schedules, fixedInstants, doses, lastTakenAt, window }, tz };
}

function describeFixture(i: SlotActionInput, tz: string): string {
  return JSON.stringify({
    tz,
    now: i.window.now.toISOString(),
    startedAt: i.med.startedAt.toISOString(),
    lastTakenAt: i.lastTakenAt?.toISOString() ?? null,
    schedules: i.schedules.map((s) => [
      s.scheduleKind,
      s.timeOfDay ?? s.intervalHours,
      s.daysOfWeek,
      s.effectiveFrom.toISOString(),
    ]),
    doses: i.doses.map((d) => [d.id, d.takenAt.toISOString(), d.status, d.quantity]),
  });
}

/** The spec's visibility rule, restated independently of the implementation. */
function isVisible(slot: MatchedSlot, w: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= w.end.getTime()) return false;
  if (t >= w.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= w.visibleStart.getTime();
}

function byInstant(slots: MatchedSlot[]): Map<number, MatchedSlot> {
  return new Map(slots.map((s) => [s.expectedTime.getTime(), s]));
}

/**
 * Press a button the way the next load sees it: add the dose, move
 * lastTakenAt if it is a later taken dose, re-project and re-match. Returns
 * what went wrong, or null when the button did exactly what its row says.
 */
function pressProblem(
  i: SlotActionInput,
  base: MatchedSlot[],
  row: string,
  press: MatchDose,
  supersedable: boolean,
): string | null {
  const reanchors =
    press.status === "taken" &&
    (i.lastTakenAt === null || press.takenAt.getTime() > i.lastTakenAt.getTime());
  const after = matchWith(i, [...i.doses, press], reanchors ? press.takenAt : i.lastTakenAt);
  const ownMs = Date.parse(row);
  const want = press.status === "taken" ? "taken" : "skipped";
  const baseAll = byInstant(base);
  const afterAll = byInstant(after);

  const own = afterAll.get(ownMs);
  if (own) {
    if (own.status !== want) return `its own row is ${own.status}, not ${want}`;
  } else if (!(supersedable && baseAll.get(ownMs)?.kind === "interval")) {
    return "its own row disappeared";
  }

  const baseVisible = byInstant(base.filter((s) => isVisible(s, i.window)));
  const afterVisible = byInstant(after.filter((s) => isVisible(s, i.window)));
  for (const [ms, before] of baseVisible) {
    if (ms === ownMs) continue;
    const later = afterVisible.get(ms);
    if (later) {
      if (later.status !== before.status) {
        return `row ${new Date(ms).toISOString()} moved from ${before.status} to ${later.status}`;
      }
    } else if (before.kind !== "interval" || afterAll.has(ms)) {
      return `row ${new Date(ms).toISOString()} left the list`;
    }
  }
  for (const [ms, later] of afterVisible) {
    if (ms === ownMs || baseVisible.has(ms)) continue;
    if (later.kind !== "interval" || baseAll.has(ms)) {
      return `row ${new Date(ms).toISOString()} joined the list as ${later.status}`;
    }
  }
  return null;
}

describe("slotActions — slot-anchored property (seeded)", () => {
  it("every offered button, pressed as the next load sees it, resolves its own row and moves no other", () => {
    const rng = mulberry32(SEED);
    const seen = { logNow: 0, tookItAt: 0, skip: 0, notLatest: 0 };

    for (let n = 0; n < FIXTURES; n++) {
      const { input: i, tz } = generateFixture(rng);
      const label = `fixture ${n} ${describeFixture(i, tz)}`;
      const nowMs = i.window.now.getTime();
      const base = matchWith(i, i.doses, i.lastTakenAt);
      const actions = slotActions(i);

      const open = base
        .filter((s) => s.resolvedByDoseId === null && isVisible(s, i.window))
        .map((s) => s.expectedTime.toISOString())
        .sort();
      expect([...actions.rows.keys()].sort(), label).toEqual(open);

      const cooling = i.doses.some(
        (d) =>
          d.status === "taken" &&
          d.takenAt.getTime() > nowMs - LOG_NOW_COOLDOWN_MS &&
          d.takenAt.getTime() <= nowMs,
      );
      const inReach = open.filter((t) => Date.parse(t) <= nowMs + MATCH_TOLERANCE_MS);
      if (cooling) expect(actions.logNowTarget, label).toBeNull();
      if (!cooling && inReach.length > 0 && inReach[inReach.length - 1] !== actions.logNowTarget) {
        seen.notLatest++;
      }

      const presses: Array<{ row: string; dose: MatchDose; supersedable: boolean }> = [];
      if (actions.logNowTarget !== null) {
        expect(inReach, label).toContain(actions.logNowTarget);
        presses.push({
          row: actions.logNowTarget,
          dose: { id: APPLIED_ID, takenAt: i.window.now, status: "taken", quantity: 1 },
          supersedable: true,
        });
        seen.logNow++;
      }
      for (const [row, offered] of actions.rows) {
        const rowMs = Date.parse(row);
        if (offered.tookItAt !== null) {
          expect(offered.tookItAt, label).toBe(row);
          expect(rowMs, label).toBeLessThanOrEqual(nowMs);
          presses.push({
            row,
            dose: { id: APPLIED_ID, takenAt: new Date(rowMs), status: "taken", quantity: 1 },
            supersedable: false,
          });
          seen.tookItAt++;
        }
        if (offered.skipAt !== null) {
          expect(offered.skipAt, label).toBe(new Date(Math.min(rowMs, nowMs)).toISOString());
          presses.push({
            row,
            dose: {
              id: APPLIED_ID,
              takenAt: new Date(offered.skipAt),
              status: "skipped",
              quantity: 1,
            },
            supersedable: false,
          });
          seen.skip++;
        }
      }

      for (const p of presses) {
        expect(
          pressProblem(i, base, p.row, p.dose, p.supersedable),
          `${label} pressed ${p.dose.status} at ${p.dose.takenAt.toISOString()} for ${p.row}`,
        ).toBeNull();
      }
    }

    // Not vacuous: every kind of button was pressed many times, and Log now
    // often sat somewhere other than the latest open row. Those are the
    // cases a "latest outstanding" rule gets wrong.
    expect(seen.logNow).toBeGreaterThanOrEqual(25);
    expect(seen.tookItAt).toBeGreaterThanOrEqual(25);
    expect(seen.skip).toBeGreaterThanOrEqual(25);
    expect(seen.notLatest).toBeGreaterThanOrEqual(5);
  }, 60_000);
});
```

- [ ] **Step 11: Run the property and confirm it passes**

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: PASS (27 tests). The property should take a few seconds.

- If it takes more than 20s, lower `FIXTURES` to `800`. Leave the 60s timeout as it is.
- If one of the `seen` floors fails, the generator has lost its clustering around `now`. Fix the generator. Do not lower a floor.

This step has no red phase, because the property was written against working code. Steps 12–15 prove that it, and the placement tests, can fail.

- [ ] **Step 12: Prove by mutation — remove the simulation guard (the mutation the spec requires)**

In `slotActions`'s Log-now loop in `src/lib/utils/schedule.ts`, delete these lines (and the comment above them):

```ts
const after = sim.all.get(t);
const landed = after ? after.status === "taken" : slot.kind === "interval";
if (!landed || !othersUnchanged(baseIndex, sim, t)) continue;
```

With these lines gone, Log now falls back to the rejected "latest outstanding row within the hour" rule.

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: FAIL in these tests:

- "goes where a dose logged now would land — 08:55, not the later 09:00" (receives 09:00)
- "never targets tomorrow's first hour…"
- "has no target on a mixed medication…"
- "has no target when the tap would also re-attribute…"
- "is absent for the hour after a slot is skipped…"
- "with a due-now slot ahead…" (receives 13:45)
- "leaves Took it at as the only way…" (receives 13:10)
- "round trip…"
- the seeded property, with a message like `… pressed taken at … for …: expected 'its own row is overdue, not taken' to be null`

Restore with: `git checkout -- src/lib/utils/schedule.ts`, then re-run and confirm PASS.

- [ ] **Step 13: Prove by mutation — the "no other row moves" guard**

Make the first line of `othersUnchanged`'s body `return true;`.

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: FAIL in these tests (the seeded property may also fail):

- "withholds Took it at when the re-anchor would hand an earlier dose to another row" (13:00's `tookItAt` becomes `"2026-04-16T13:00:00.000Z"`)
- "has no target when the tap would also re-attribute an earlier dose" (receives `"2026-04-16T13:00:00.000Z"`)

Restore with `git checkout -- src/lib/utils/schedule.ts` and confirm PASS.

- [ ] **Step 14: Prove by mutation — re-projection in taken simulations**

In `simulate`, replace `const projection = reanchors ? project(takenAt) : baseProjection;` with `const projection = baseProjection;`.

Run: `npx vitest run tests/unit/slot-actions.test.ts`
Expected: FAIL in these tests:

- "withholds Took it at when the re-anchor would hand an earlier dose to another row" (13:00 offers Took it at)
- "has no target on a mixed medication whose dose would land on a new interval row" (receives `"2026-04-16T09:00:00.000Z"` through pass 2)

Restore with `git checkout -- src/lib/utils/schedule.ts` and confirm PASS.

- [ ] **Step 15: Prove by mutation — the reach and cooldown bounds (one at a time, restoring between)**

1. Delete `if (t > reach) continue;`. Expected failure: "targets the interval row a new dose supersedes, never one more than an hour ahead" (receives `"2026-04-16T22:00:00.000Z"`).
2. Change `d.takenAt.getTime() > nowMs - LOG_NOW_COOLDOWN_MS` to `>=`. Expected failure: "is withheld for an hour after a taken dose — (now − 1h, now], to the millisecond" (the `11:10:00.000` fixture receives `null`).

After each mutation, run `npx vitest run tests/unit/slot-actions.test.ts`, then restore with `git checkout -- src/lib/utils/schedule.ts`. After the last restore, re-run and confirm PASS.

- [ ] **Step 16: Verify the neighbourhood**

Run: `npx vitest run tests/unit/slot-actions.test.ts tests/unit/schedule.test.ts tests/unit/schedule-matching-properties.test.ts tests/unit/dashboard-window.test.ts tests/unit/dst-wall-clock.test.ts`
Expected: PASS.

Run: `npm run check`
Expected: no new errors or warnings in `src/lib/utils/schedule.ts` or `tests/unit/slot-actions.test.ts`.

Run: `npm run lint`
Expected: no new problems in either file.

- [ ] **Step 17: Commit**

```bash
git add tests/unit/slot-actions.test.ts
git commit -m "test(schedule): pin slotActions with a seeded slot-anchored property"
```

---

### Task 6: Dashboard payload types and pure dashboard copy

**Files:**

- Modify: `src/lib/types.ts:79` (append after `RefillForecastEntry`, the last declaration; remove nothing)
- Create: `src/lib/utils/dashboard-copy.ts`
- Test: `tests/unit/dashboard-copy.test.ts`

**Interfaces:**

- Consumes:
  - `formatDuration(ms: number, opts?: DurationOptions): string` from `src/lib/utils/time.ts` (T1). `{ style: "long", maxUnits: 1 }` gives "2 hours", "15 minutes", "1 minute", "1 day". It uses `|ms|` and floors.
  - `formatUserTime(date: Date, timezone: string, timeFormat: TimeFormat = "12h"): string` and `type TimeFormat = "12h" | "24h"` from `src/lib/utils/time.ts:15-34` (existing).
  - `Medication`, `DoseLogWithMedication`, `RefillForecastEntry` from `src/lib/types.ts` (existing).
- Produces (the contract, verbatim):
  - In `src/lib/types.ts`: `DashboardStatusKind`, `DashboardStatus`, `DueRow`, `DueCard`, `DoneRow`, `LaterRow`, `DashboardPageData` (shapes below).
  - `formatSlotTime(at: Date, todayStart: Date, tz: string, timeFormat: TimeFormat): string`
  - `dashboardHeaderCopy(status: DashboardStatus, serverNow: Date, tz: string, timeFormat: TimeFormat): { sentence: string; supporting: string | null }`
  - `formatDoseLabel(name: string, dosageAmount: string, dosageUnit: string): string`
  - `toastForLog(i: { label: string; quantity: number; takenAt: Date; covers: Date[]; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`
  - `toastForTookItAt(i: { label: string; at: Date; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`
  - `toastForSkip(i: { label: string; slot: Date; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`
  - `rowStatusLine(row: { state: DueRow["state"]; expectedTime: Date }, serverNow: Date, todayStart: Date, tz: string, timeFormat: TimeFormat): string`

Note for the executor: on this ICU, `formatUserTime`'s en-GB 24h output does **not** zero-pad a single-digit hour (`08:55Z` renders `8:55`; verified with `node`). That is the shared formatter's contract, and this task does not change it. Every 24h time these tests assert therefore has a two-digit hour.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dashboard-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  dashboardHeaderCopy,
  formatDoseLabel,
  formatSlotTime,
  rowStatusLine,
  toastForLog,
  toastForSkip,
  toastForTookItAt,
} from "$lib/utils/dashboard-copy";
import type { DashboardStatus, DueRow } from "$lib/types";
import type { TimeFormat } from "$lib/utils/time";

// UTC keeps every local time equal to its ISO string. Every 24h time asserted
// here has a two-digit hour on purpose: formatUserTime's en-GB 24h output does
// not pad a single-digit hour ("9:05"), and that is the shared formatter's
// business, not this module's.
const TZ = "UTC";
const TODAY_START = new Date("2026-04-16T00:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("formatDoseLabel", () => {
  it("joins name and dose the way every dashboard surface already does", () => {
    expect(formatDoseLabel("Metformin", "500", "mg")).toBe("Metformin 500mg");
    expect(formatDoseLabel("Vitamin D", "1000", "IU")).toBe("Vitamin D 1000IU");
  });
});

describe("formatSlotTime", () => {
  it("renders a time on today's civil day plainly", () => {
    expect(formatSlotTime(at("2026-04-16T22:00:00.000Z"), TODAY_START, TZ, "24h")).toBe("22:00");
  });

  it("prefixes 'yesterday' for any instant before today's midnight", () => {
    expect(formatSlotTime(at("2026-04-15T22:00:00.000Z"), TODAY_START, TZ, "24h")).toBe(
      "yesterday 22:00",
    );
    expect(formatSlotTime(at("2026-04-15T23:59:59.999Z"), TODAY_START, TZ, "24h")).toBe(
      "yesterday 23:59",
    );
  });

  it("follows the 12h preference", () => {
    expect(formatSlotTime(at("2026-04-16T13:31:00.000Z"), TODAY_START, TZ, "12h")).toBe("1:31 pm");
  });

  it("decides 'yesterday' against todayStart, in the user's zone", () => {
    // Midnight on 16 April in London (BST) is 23:00Z on the 15th.
    const londonStart = at("2026-04-15T23:00:00.000Z");
    expect(
      formatSlotTime(at("2026-04-15T21:00:00.000Z"), londonStart, "Europe/London", "24h"),
    ).toBe("yesterday 22:00");
    expect(
      formatSlotTime(at("2026-04-16T12:31:00.000Z"), londonStart, "Europe/London", "24h"),
    ).toBe("13:31");
  });
});

describe("rowStatusLine", () => {
  function line(
    expectedTime: string,
    serverNow: string,
    state: DueRow["state"] = "overdue",
    timeFormat: TimeFormat = "24h",
  ): string {
    return rowStatusLine(
      { state, expectedTime: at(expectedTime) },
      at(serverNow),
      TODAY_START,
      TZ,
      timeFormat,
    );
  }

  it("states the slot time and how long ago it was", () => {
    expect(line("2026-04-16T11:00:00.000Z", "2026-04-16T13:00:00.000Z")).toBe(
      "Due 11:00 · 2 hours ago",
    );
  });

  it("floors, so lateness is never overstated", () => {
    expect(line("2026-04-16T11:00:00.000Z", "2026-04-16T13:59:00.000Z")).toBe(
      "Due 11:00 · 2 hours ago",
    );
  });

  it("prefixes an Earlier row's time with 'yesterday'", () => {
    expect(line("2026-04-15T22:00:00.000Z", "2026-04-16T07:00:00.000Z", "earlier")).toBe(
      "Due yesterday 22:00 · 9 hours ago",
    );
  });

  it("counts down to a slot still ahead", () => {
    expect(line("2026-04-16T13:45:00.000Z", "2026-04-16T13:30:00.000Z", "due-now")).toBe(
      "Due 13:45 · in 15 minutes",
    );
  });

  it("says 'now' for anything under a minute either side", () => {
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:30:59.999Z", "due-now")).toBe(
      "Due 13:30 · now",
    );
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:29:00.001Z", "due-now")).toBe(
      "Due 13:30 · now",
    );
  });

  it("switches to minutes at exactly one minute, singular", () => {
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:31:00.000Z", "due-now")).toBe(
      "Due 13:30 · 1 minute ago",
    );
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:29:00.000Z", "due-now")).toBe(
      "Due 13:30 · in 1 minute",
    );
  });

  it("takes 'ago' or 'in' from the clock, never from the state", () => {
    // A due-now row half an hour past its slot still reads "ago".
    expect(line("2026-04-16T13:00:00.000Z", "2026-04-16T13:30:00.000Z", "due-now")).toBe(
      "Due 13:00 · 30 minutes ago",
    );
  });

  it("follows the 12h preference", () => {
    expect(line("2026-04-16T13:45:00.000Z", "2026-04-16T13:30:00.000Z", "due-now", "12h")).toBe(
      "Due 1:45 pm · in 15 minutes",
    );
  });
});

describe("dashboardHeaderCopy", () => {
  const SERVER_NOW = at("2026-04-16T17:00:00.000Z");
  const NEXT = {
    name: "Lisinopril",
    dosageAmount: "10",
    dosageUnit: "mg",
    expectedTime: "2026-04-16T20:00:00.000Z",
    alsoCount: 0,
  };
  const status = (overrides: Partial<DashboardStatus>): DashboardStatus => ({
    kind: "due",
    dueCount: 0,
    doneToday: 0,
    totalToday: 0,
    loggedToday: 0,
    next: null,
    ...overrides,
  });
  const copy = (s: DashboardStatus, timeFormat: TimeFormat = "24h") =>
    dashboardHeaderCopy(s, SERVER_NOW, TZ, timeFormat);

  it("due: counts every Due row and how much of today is done", () => {
    expect(copy(status({ kind: "due", dueCount: 5, doneToday: 2, totalToday: 7 }))).toEqual({
      sentence: "5 doses due",
      supporting: "2 of 7 done today",
    });
  });

  it("due: singular, and no progress line while nothing today is done", () => {
    expect(copy(status({ kind: "due", dueCount: 1, doneToday: 0, totalToday: 7 }))).toEqual({
      sentence: "1 dose due",
      supporting: null,
    });
  });

  it("caught-up: names the next slot and how far away it is", () => {
    expect(copy(status({ kind: "caught-up", next: NEXT }))).toEqual({
      sentence: "All caught up",
      supporting: "Next: Lisinopril 10mg at 20:00 · in 3 hours",
    });
  });

  it("caught-up: folds other slots at the same instant into 'and N more'", () => {
    expect(copy(status({ kind: "caught-up", next: { ...NEXT, alsoCount: 2 } })).supporting).toBe(
      "Next: Lisinopril 10mg and 2 more at 20:00 · in 3 hours",
    );
  });

  it("caught-up: follows the 12h preference", () => {
    expect(copy(status({ kind: "caught-up", next: NEXT }), "12h").supporting).toBe(
      "Next: Lisinopril 10mg at 8:00 pm · in 3 hours",
    );
  });

  it("caught-up: no supporting line without a next slot", () => {
    expect(copy(status({ kind: "caught-up", next: null }))).toEqual({
      sentence: "All caught up",
      supporting: null,
    });
  });

  it("all-done", () => {
    expect(copy(status({ kind: "all-done", doneToday: 7, totalToday: 7 }))).toEqual({
      sentence: "All done for today",
      supporting: "7 of 7 done today",
    });
  });

  it("none-today: reports what was logged, and omits the line at zero", () => {
    expect(copy(status({ kind: "none-today", loggedToday: 2 }))).toEqual({
      sentence: "Nothing scheduled today",
      supporting: "2 doses logged today",
    });
    expect(copy(status({ kind: "none-today", loggedToday: 1 })).supporting).toBe(
      "1 dose logged today",
    );
    expect(copy(status({ kind: "none-today", loggedToday: 0 })).supporting).toBeNull();
  });

  it("as-needed-only: the count is the sentence, the hint is the line", () => {
    expect(copy(status({ kind: "as-needed-only", loggedToday: 2 }))).toEqual({
      sentence: "2 doses logged today",
      supporting: "Tap a medication below to log a dose.",
    });
    expect(copy(status({ kind: "as-needed-only", loggedToday: 1 })).sentence).toBe(
      "1 dose logged today",
    );
    expect(copy(status({ kind: "as-needed-only", loggedToday: 0 })).sentence).toBe(
      "No doses logged yet today",
    );
  });

  it("never prints 'overdue' — that word lives only in StatusMarker's accessible name", () => {
    const every: DashboardStatus[] = [
      status({ kind: "due", dueCount: 3, doneToday: 1, totalToday: 4 }),
      status({ kind: "caught-up", next: NEXT }),
      status({ kind: "all-done", doneToday: 2, totalToday: 2 }),
      status({ kind: "none-today", loggedToday: 1 }),
      status({ kind: "as-needed-only", loggedToday: 1 }),
    ];
    for (const s of every) {
      const { sentence, supporting } = copy(s);
      expect(`${sentence} ${supporting ?? ""}`).not.toMatch(/overdue/i);
    }
    expect(
      rowStatusLine(
        { state: "overdue", expectedTime: at("2026-04-16T11:00:00.000Z") },
        SERVER_NOW,
        TODAY_START,
        TZ,
        "24h",
      ),
    ).not.toMatch(/overdue/i);
  });
});

describe("toast builders", () => {
  const clock = { todayStart: TODAY_START, tz: TZ, timeFormat: "24h" as TimeFormat };
  const LOGGED_AT = at("2026-04-16T13:31:00.000Z");

  it("Log now: says which slots the dose counted for, in time order", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [
          at("2026-04-16T12:00:00.000Z"),
          at("2026-04-16T10:55:00.000Z"),
          at("2026-04-16T11:00:00.000Z"),
        ],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 10:55, 11:00 and 12:00 doses");
  });

  it("joins two slots with 'and'", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T10:55:00.000Z"), at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 10:55 and 11:00 doses");
  });

  it("names a single slot in the singular", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 11:00 dose");
  });

  it("prefixes a slot before midnight with 'yesterday'", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: at("2026-04-16T10:31:00.000Z"),
        covers: [at("2026-04-15T22:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 10:31 — counted for your yesterday 22:00 dose");
  });

  it("drops the clause when the dose counted for nothing (also the reload-failed fallback)", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [],
      }),
    ).toBe("Metformin 500mg logged at 13:31");
  });

  it("shows the quantity when a chip logged more than one", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Ibuprofen 200mg",
        quantity: 2,
        takenAt: LOGGED_AT,
        covers: [],
      }),
    ).toBe("Ibuprofen 200mg ×2 logged at 13:31");
  });

  it("follows the 12h preference", () => {
    expect(
      toastForLog({
        ...clock,
        timeFormat: "12h",
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 1:31 pm — counted for your 11:00 am dose");
  });

  it("Took it at: names the recorded time, prefixed when it was yesterday", () => {
    expect(
      toastForTookItAt({ ...clock, label: "Metformin 500mg", at: at("2026-04-15T22:00:00.000Z") }),
    ).toBe("Metformin 500mg recorded as taken at yesterday 22:00");
    expect(
      toastForTookItAt({ ...clock, label: "Metformin 500mg", at: at("2026-04-16T11:00:00.000Z") }),
    ).toBe("Metformin 500mg recorded as taken at 11:00");
  });

  it("Skip: names the slot, prefixed when it was yesterday", () => {
    expect(
      toastForSkip({ ...clock, label: "Metformin 500mg", slot: at("2026-04-16T11:00:00.000Z") }),
    ).toBe("Metformin 500mg: 11:00 dose skipped");
    expect(
      toastForSkip({ ...clock, label: "Metformin 500mg", slot: at("2026-04-15T22:00:00.000Z") }),
    ).toBe("Metformin 500mg: yesterday 22:00 dose skipped");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-copy.test.ts`
Expected: FAIL. The suite cannot load because `$lib/utils/dashboard-copy` does not exist, and Vite reports `Failed to resolve import "$lib/utils/dashboard-copy"`.

- [ ] **Step 3: Write minimal implementation**

(a) Append to the end of `src/lib/types.ts`, after `RefillForecastEntry` (line 79). Remove nothing: `MedicationTimingStatus` stays until T11.

```ts
/**
 * The dashboard payload (docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md).
 * Built by `composeDashboardPageData` in `$lib/server/dashboard/page-data.ts`.
 * Every instant is an ISO string so the client never re-derives a civil day
 * from one; the client formats them against `todayStart`.
 */

/** First matching predicate wins, in this order: as-needed-only, due, caught-up, all-done, none-today. */
export type DashboardStatusKind =
  | "due"
  | "caught-up"
  | "all-done"
  | "none-today"
  | "as-needed-only";

export type DashboardStatus = {
  kind: DashboardStatusKind;
  /** Every Due row, Earlier and nested rows included. */
  dueCount: number;
  /** Today's slots resolved (taken or skipped). Earlier rows are not counted. */
  doneToday: number;
  /** Today's slots, resolved or not. */
  totalToday: number;
  /** Taken dose events among the Done rows; a skip is not a dose logged. */
  loggedToday: number;
  /** The earliest outstanding slot ahead, set only for `caught-up`; `alsoCount` = other slots at that instant. */
  next: {
    name: string;
    dosageAmount: string;
    dosageUnit: string;
    expectedTime: string;
    alsoCount: number;
  } | null;
};

/**
 * One outstanding slot on a Due card. `tookItAt` / `skipAt` are the exact
 * instants those buttons post, or null when the row does not offer them —
 * decided by simulation in `slotActions`, never by the component.
 */
export type DueRow = {
  key: string;
  kind: "interval" | "fixed_time";
  expectedTime: string;
  state: "earlier" | "overdue" | "due-now";
  logNow: boolean;
  tookItAt: string | null;
  skipAt: string | null;
};

/** One medication in one Due sub-group; `key` is `${subGroup}:${medicationId}`. `rows[0]` is the top row. */
export type DueCard = {
  key: string;
  medicationId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  rows: DueRow[];
};

/** One dose event in Done. `covers` = ISO slot instants this dose resolved, other than its own minute. */
export type DoneRow = {
  key: string;
  dose: DoseLogWithMedication;
  covers: string[];
  dayLabel: "yesterday" | null;
};

/** A read-only line for a slot of today's more than an hour ahead. */
export type LaterRow = {
  key: string;
  medicationId: string;
  name: string;
  dosageAmount: string;
  dosageUnit: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  expectedTime: string;
};

export type DashboardPageData = {
  now: string;
  nextRefreshAt: string;
  timezone: string;
  todayStart: string;
  status: DashboardStatus;
  earlier: DueCard[];
  today: DueCard[];
  done: DoneRow[];
  later: LaterRow[];
  /** Active medications in `sortOrder` — the chip list. */
  medications: Medication[];
  /** Merged in by the page load beside `loadDashboard`. */
  refillForecast: RefillForecastEntry[];
};
```

(b) Create `src/lib/utils/dashboard-copy.ts`:

```ts
import type { DashboardStatus, DueRow } from "$lib/types";
import { formatDuration, formatUserTime, type TimeFormat } from "./time";

/**
 * Every sentence the dashboard shows, as pure functions, so the spec's copy
 * is unit-testable without rendering a component.
 *
 * Two rules hold across all of it:
 * - Relative time comes from the SIGN of `serverNow − expectedTime`, never
 *   from a row's state, and `serverNow` is the page's server-relative clock,
 *   never raw `Date.now()`.
 * - The word "overdue" appears nowhere. It survives only as StatusMarker's
 *   accessible name; visible copy states when, not a verdict.
 *
 * Client-reachable (dashboard components import it), so it imports only
 * `./time` and types.
 */

/** Under this the dashboard says "now" rather than "less than a minute". */
const NOW_THRESHOLD_MS = 60_000;

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a", "a and b", "a, b and c". */
function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** "now", "in 15 minutes" or "2 hours ago", from the sign of the gap. */
function relativeTo(at: Date, serverNow: Date): string {
  const diff = serverNow.getTime() - at.getTime();
  if (Math.abs(diff) < NOW_THRESHOLD_MS) return "now";
  const span = formatDuration(diff, { style: "long", maxUnits: 1 });
  return diff > 0 ? `${span} ago` : `in ${span}`;
}

/** "Metformin 500mg" — the concatenation every dose surface already uses. */
export function formatDoseLabel(name: string, dosageAmount: string, dosageUnit: string): string {
  return `${name} ${dosageAmount}${dosageUnit}`;
}

/**
 * A slot or dose time as the dashboard prints it: "22:00", or
 * "yesterday 22:00" for an instant before today's local midnight. The
 * dashboard's window never reaches further back than yesterday, so no other
 * prefix exists.
 */
export function formatSlotTime(
  at: Date,
  todayStart: Date,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const time = formatUserTime(at, tz, timeFormat);
  return at.getTime() < todayStart.getTime() ? `yesterday ${time}` : time;
}

/** A Due row's status line: "Due 11:00 · 2 hours ago", "Due 13:45 · in 15 minutes". */
export function rowStatusLine(
  row: { state: DueRow["state"]; expectedTime: Date },
  serverNow: Date,
  todayStart: Date,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const when = formatSlotTime(row.expectedTime, todayStart, tz, timeFormat);
  return `Due ${when} · ${relativeTo(row.expectedTime, serverNow)}`;
}

/** The header's status sentence and supporting line — the only place a count appears. */
export function dashboardHeaderCopy(
  status: DashboardStatus,
  serverNow: Date,
  tz: string,
  timeFormat: TimeFormat,
): { sentence: string; supporting: string | null } {
  const logged =
    status.loggedToday > 0 ? `${count(status.loggedToday, "dose")} logged today` : null;
  const progress = `${status.doneToday} of ${status.totalToday} done today`;

  switch (status.kind) {
    case "as-needed-only":
      return {
        sentence: logged ?? "No doses logged yet today",
        supporting: "Tap a medication below to log a dose.",
      };
    case "due":
      return {
        sentence: `${count(status.dueCount, "dose")} due`,
        supporting: status.doneToday > 0 ? progress : null,
      };
    case "caught-up": {
      const next = status.next;
      if (!next) return { sentence: "All caught up", supporting: null };
      const at = new Date(next.expectedTime);
      const who =
        formatDoseLabel(next.name, next.dosageAmount, next.dosageUnit) +
        (next.alsoCount > 0 ? ` and ${next.alsoCount} more` : "");
      return {
        sentence: "All caught up",
        supporting: `Next: ${who} at ${formatUserTime(at, tz, timeFormat)} · ${relativeTo(at, serverNow)}`,
      };
    }
    case "all-done":
      return { sentence: "All done for today", supporting: progress };
    case "none-today":
      return { sentence: "Nothing scheduled today", supporting: logged };
  }
}

/**
 * Log now / chip success toast, built from the reloaded data: `covers` are
 * the slots the new dose actually resolved. The Toast appends its own Undo.
 */
export function toastForLog(i: {
  label: string;
  quantity: number;
  takenAt: Date;
  covers: Date[];
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  const what = i.quantity > 1 ? `${i.label} ×${i.quantity}` : i.label;
  const logged = `${what} logged at ${formatSlotTime(i.takenAt, i.todayStart, i.tz, i.timeFormat)}`;
  if (i.covers.length === 0) return logged;
  const times = [...i.covers]
    .sort((a, b) => a.getTime() - b.getTime())
    .map((c) => formatSlotTime(c, i.todayStart, i.tz, i.timeFormat));
  return `${logged} — counted for your ${listOf(times)} ${i.covers.length === 1 ? "dose" : "doses"}`;
}

/** "Took it at" success toast. */
export function toastForTookItAt(i: {
  label: string;
  at: Date;
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  return `${i.label} recorded as taken at ${formatSlotTime(i.at, i.todayStart, i.tz, i.timeFormat)}`;
}

/** Skip success toast. */
export function toastForSkip(i: {
  label: string;
  slot: Date;
  todayStart: Date;
  tz: string;
  timeFormat: TimeFormat;
}): string {
  return `${i.label}: ${formatSlotTime(i.slot, i.todayStart, i.tz, i.timeFormat)} dose skipped`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-copy.test.ts`
Expected: PASS (all tests green).

- [ ] **Step 5: Prove by mutation** (apply each change on its own, watch the named test fail, then restore it)
  1. In `relativeTo`, change `return diff > 0 ? \`${span} ago\` : \`in ${span}\`;` to `return diff < 0 ? \`${span} ago\` : \`in ${span}\`;`. "rowStatusLine › states the slot time and how long ago it was" fails, receiving "Due 11:00 · in 2 hours".
  2. In `formatSlotTime`, change the return to `return time;`. "formatSlotTime › prefixes 'yesterday' for any instant before today's midnight" fails.
  3. In `relativeTo`, change `Math.abs(diff) < NOW_THRESHOLD_MS` to `Math.abs(diff) <= NOW_THRESHOLD_MS`. "rowStatusLine › switches to minutes at exactly one minute, singular" fails, receiving "Due 13:30 · now".
  4. In `toastForLog`, delete `.sort((a, b) => a.getTime() - b.getTime())`. "toast builders › Log now: says which slots the dose counted for, in time order" fails.
  5. In `dashboardHeaderCopy`'s `"due"` case, change `status.doneToday > 0 ? progress : null` to `progress`. "dashboardHeaderCopy › due: singular, and no progress line while nothing today is done" fails.

  Restore each change, then run `npx vitest run tests/unit/dashboard-copy.test.ts`. Expected: PASS.

- [ ] **Step 6: Typecheck and lint**

Run: `npm run check && npx eslint src/lib/types.ts src/lib/utils/dashboard-copy.ts tests/unit/dashboard-copy.test.ts`
Expected: svelte-check reports 0 errors, and eslint reports no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/utils/dashboard-copy.ts tests/unit/dashboard-copy.test.ts
git commit -m "feat(dashboard): add due-now payload types and pure dashboard copy"
```

---

---

### Task 7: Dashboard composition and loadDashboard (read path)

**Files:**

- Modify: `src/lib/server/doses.ts:2` (add `lt` to the drizzle import)
- Modify: `src/lib/server/doses.ts:27-61` (move `getTodaysDoses`'s select into shared columns and add `getDosesInRange`; `getTodaysDoses` stays until T11)
- Create: `src/lib/server/dashboard/page-data.ts`
- Create: `src/lib/server/dashboard/load.ts`
- Modify: `CLAUDE.md` (add one bullet directly after the bullet that begins `- **\`src/lib/server/analytics/page-data.ts\` owns the analytics page's composition.\*\*`, currently line 50)
- Test: `tests/unit/pg/doses-in-range.test.ts` (PGlite, because the database decides the half-open edges)
- Test: `tests/unit/dashboard-page-data.test.ts` (pure)
- Test: `tests/unit/dashboard-load.test.ts` (fake-db)

The dashboard page itself is **not** switched in this task. `+page.server.ts` still uses `getTodaysDoses`; T11 switches it.

**Interfaces:**

- Consumes:
  - T2 (`src/lib/utils/schedule.ts`): `MATCH_TOLERANCE_MS`, `CARRY_OVER_MS`, `interface DashboardWindow { now; todayKey; todayStart; end; projectStart; projectEnd; visibleStart; doseFetchFrom; doseFetchTo }`, `dashboardWindow(now: Date, tz: string): DashboardWindow`
  - T3: `type ScheduleKind = "interval" | "fixed_time"`, `segmentsFor(window: DashboardWindow): Segments`, `projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`, `projectMedicationSlots(input: { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; lastTakenAt: Date | null; segments: Segments }): ProjectedSlot[]`, `interface MatchDose { id: string; takenAt: Date; status: "taken" | "skipped" | "missed"; quantity: number }`, `interface MatchedSlot extends ProjectedSlot { status: ScheduleSlotStatus; resolvedByDoseId: string | null; missedByDoseId: string | null }` (with `ProjectedSlot = { expectedTime: Date; kind: ScheduleKind; segment: "yesterday" | "today" | "tomorrow" }`), `matchMedicationSlots(slots: ProjectedSlot[], doses: MatchDose[], opts: { now: Date; segments: Segments; pass2Bound: Date }): MatchedSlot[]`
  - T5: `LOG_NOW_COOLDOWN_MS`, `slotActions(input: { med; schedules; fixedInstants; doses: MatchDose[]; lastTakenAt: Date | null; window: DashboardWindow }): { logNowTarget: string | null; rows: Map<string, { tookItAt: string | null; skipAt: string | null }> }`
  - T6 (`src/lib/types.ts`): `DashboardPageData`, `DashboardStatus`, `DueCard`, `DueRow`, `DoneRow`, `LaterRow`
  - Existing: `getActiveMedications(userId)` (`src/lib/server/medications.ts:14`), `getLastDosePerMedication(userId): Promise<Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>>` (`src/lib/server/doses.ts:360`), `getSchedulesForUser(userId): Promise<Map<string, MedicationSchedule[]>>` and `type MedicationSchedule` (`src/lib/server/schedules.ts`)
- Produces:
  - `export async function getDosesInRange(userId: string, from: Date, to: Date): Promise<DoseLogWithMedication[]>` (`src/lib/server/doses.ts`). It filters `takenAt ≥ from AND takenAt < to`, is user-scoped, orders by `desc(takenAt)` and uses the same select and join as `getTodaysDoses`.
  - `export type DashboardCompositionInputs = { medications: Medication[]; schedulesByMedId: Map<string, MedicationSchedule[]>; doses: DoseLogWithMedication[]; lastDoses: Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>; now: Date; timezone: string }`
  - `export function composeDashboardPageData(input: DashboardCompositionInputs): Omit<DashboardPageData, "refillForecast">`
  - `export function computeNextRefreshAt(input: { now: Date; window: DashboardWindow; slots: readonly MatchedSlot[]; doses: ReadonlyArray<Pick<DoseLogWithMedication, "status" | "takenAt">> }): Date` (exported for tests; clamped to ≥ `now + 5s`)
  - `export async function loadDashboard(userId: string, timezone: string, now: Date): Promise<Omit<DashboardPageData, "refillForecast">>` (`src/lib/server/dashboard/load.ts`)
  - Keys minted here that T10 and T11 treat as opaque: `DueCard.key = \`${"earlier" | "today"}:${medicationId}\``, `DueRow.key = LaterRow.key = \`${medicationId}:${expectedTimeIso}\``, `DoneRow.key = dose.id`.

#### Cycle 1: `getDosesInRange`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/pg/doses-in-range.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { getDosesInRange } = await import("../../../src/lib/server/doses");

/**
 * The dashboard's dose read. It runs on PGlite because the property under
 * test is which rows a real WHERE returns at its two edges: `fake-db`
 * captures the predicate without evaluating it, so `lt` and `lte` would
 * look identical there.
 *
 * FROM/TO are dashboardWindow's doseFetchFrom/doseFetchTo for London at
 * 13:30 BST on 2026-04-16. They are copied here as plain constants; nothing
 * in this file depends on the window.
 */
const FROM = new Date("2026-04-14T22:00:00.000Z");
const TO = new Date("2026-04-17T01:00:00.000Z");
const shift = (d: Date, ms: number) => new Date(d.getTime() + ms);

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ name: "Metformin", dosageAmount: "500", dosageUnit: "mg" });
});

describe("getDosesInRange", () => {
  it("is half-open: a dose at `from` is in, a dose at `to` is out", async () => {
    await pgDb.seedDose({ id: "before-from", takenAt: shift(FROM, -1) });
    await pgDb.seedDose({ id: "at-from", takenAt: FROM });
    await pgDb.seedDose({ id: "before-to", takenAt: shift(TO, -1) });
    await pgDb.seedDose({ id: "at-to", takenAt: TO });

    const rows = await getDosesInRange("u1", FROM, TO);

    // Newest first, like the read it replaces.
    expect(rows.map((r) => r.id)).toEqual(["before-to", "at-from"]);
  });

  it("returns only the requesting user's doses", async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedDose({ id: "mine", takenAt: new Date("2026-04-16T10:00:00.000Z") });
    await pgDb.seedDose({
      id: "theirs",
      userId: "u2",
      medicationId: "m2",
      takenAt: new Date("2026-04-16T10:00:00.000Z"),
    });

    const rows = await getDosesInRange("u1", FROM, TO);

    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("joins the medication fields a row renders and keeps milliseconds", async () => {
    // Pass 0 compares takenAt with a slot instant to the millisecond, so the
    // read must hand back exactly what was written.
    await pgDb.seedDose({
      id: "d1",
      takenAt: new Date("2026-04-16T10:00:00.123Z"),
      status: "skipped",
    });

    const [row] = await getDosesInRange("u1", FROM, TO);

    expect(row.takenAt.toISOString()).toBe("2026-04-16T10:00:00.123Z");
    expect(row.status).toBe("skipped");
    expect(row.medication).toEqual({
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#ffffff",
      colourSecondary: null,
      pattern: "solid",
    });
    // Server-side bookkeeping never reaches the page (see DoseLog in $lib/types).
    expect(row).not.toHaveProperty("inventoryApplied");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/pg/doses-in-range.test.ts`
Expected: FAIL with `TypeError: getDosesInRange is not a function`, in all 3 tests.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/server/doses.ts`, replace line 2:

```ts
import { eq, and, gte, lt, desc, sql, isNotNull, max } from "drizzle-orm";
```

Then replace lines 27-61 (the whole `getTodaysDoses` function) with:

```ts
/**
 * The columns a dashboard dose read returns: the dose plus the medication
 * fields its row renders. `inventoryApplied` is deliberately absent — see
 * `DoseLog` in `$lib/types`.
 */
const doseWithMedicationColumns = {
  id: doseLogs.id,
  userId: doseLogs.userId,
  medicationId: doseLogs.medicationId,
  quantity: doseLogs.quantity,
  status: doseLogs.status,
  takenAt: doseLogs.takenAt,
  loggedAt: doseLogs.loggedAt,
  updatedAt: doseLogs.updatedAt,
  notes: doseLogs.notes,
  sideEffects: doseLogs.sideEffects,
  medication: {
    name: medications.name,
    dosageAmount: medications.dosageAmount,
    dosageUnit: medications.dosageUnit,
    form: medications.form,
    colour: medications.colour,
    colourSecondary: medications.colourSecondary,
    pattern: medications.pattern,
  },
};

export async function getTodaysDoses(
  userId: string,
  timezone: string,
): Promise<DoseLogWithMedication[]> {
  const dayStart = startOfDay(new Date(), timezone);

  const rows = await db
    .select(doseWithMedicationColumns)
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, dayStart)))
    .orderBy(desc(doseLogs.takenAt));

  return rows;
}

/**
 * Every dose with `from ≤ takenAt < to`, newest first, with the medication
 * fields a dashboard row renders.
 *
 * Half-open, so a dose exactly at `to` belongs to the next range and never
 * to both. The dashboard passes `dashboardWindow`'s `doseFetchFrom` /
 * `doseFetchTo`, which reach an hour before yesterday's midnight and two
 * hours past tonight's — pass 1's reach either side of the slots it
 * matches. The read it replaced stopped at today's midnight, so no dose from
 * before it could reach the matcher.
 */
export async function getDosesInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<DoseLogWithMedication[]> {
  const rows = await db
    .select(doseWithMedicationColumns)
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, from), lt(doseLogs.takenAt, to)))
    .orderBy(desc(doseLogs.takenAt));

  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/pg/doses-in-range.test.ts tests/unit/doses-inventory.test.ts tests/unit/dashboard-timing-status.test.ts tests/unit/dashboard-dose-actions.test.ts`
Expected: PASS. The new file is green, and the three existing suites that import or mock `doses.ts` are unchanged.

- [ ] **Step 5: Prove by mutation** (apply each change on its own, watch the named test fail, then restore it)
  1. Change `lt(doseLogs.takenAt, to)` to `sql\`${doseLogs.takenAt} <= ${to}\``. "is half-open: a dose at `from`is in, a dose at`to`is out" fails because`at-to` appears.
  2. Change `gte(doseLogs.takenAt, from)` to `sql\`${doseLogs.takenAt} > ${from}\``. The same test fails because `at-from` is missing.
  3. Delete `eq(doseLogs.userId, userId), ` from the `and(...)`. "returns only the requesting user's doses" fails because `theirs` appears.

  Restore each change, then rerun the Step 4 command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/doses.ts tests/unit/pg/doses-in-range.test.ts
git commit -m "feat(doses): add getDosesInRange for the dashboard window"
```

#### Cycle 2: `computeNextRefreshAt`

- [ ] **Step 7: Write the failing test**

Create `tests/unit/dashboard-page-data.test.ts`. This step writes the whole import block, the fixtures and the `computeNextRefreshAt` suite. Step 11 appends the composition suites.

```ts
import { describe, it, expect } from "vitest";
import {
  composeDashboardPageData,
  computeNextRefreshAt,
  type DashboardCompositionInputs,
} from "$lib/server/dashboard/page-data";
import { dashboardWindow, type MatchedSlot } from "$lib/utils/schedule";
import type { DoseLogWithMedication, DueCard, DueRow, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

/*
 * Every expectation below is derived by hand from rules this module does NOT
 * own — the window, projection, passes 0–2 and slotActions in
 * utils/schedule.ts — and each case's comment walks the derivation, so a
 * failure says which layer disagrees before anyone edits an expectation.
 *
 * UTC unless a case says otherwise, so a local time IS its ISO string.
 * 2026-04-15/16/17 are Wednesday, Thursday, Friday.
 */
const wed = (hhmm: string) => `2026-04-15T${hhmm}:00.000Z`;
const thu = (hhmm: string) => `2026-04-16T${hhmm}:00.000Z`;
const fri = (hhmm: string) => `2026-04-17T${hhmm}:00.000Z`;

const EPOCH = new Date("2026-01-01T00:00:00Z");

function makeMed(overrides: Partial<Medication> & Pick<Medication, "id" | "name">): Medication {
  return {
    userId: "u1",
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
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
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: EPOCH,
    endedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

const METFORMIN = makeMed({ id: "med-a", name: "Metformin", dosageAmount: "500", sortOrder: 0 });
const IBUPROFEN = makeMed({
  id: "med-b",
  name: "Ibuprofen",
  dosageAmount: "200",
  sortOrder: 1,
  colour: "#f59e0b",
});
const LISINOPRIL = makeMed({
  id: "med-c",
  name: "Lisinopril",
  dosageAmount: "10",
  sortOrder: 2,
  colour: "#10b981",
});

function fixed(med: Medication, timeOfDay: string, daysOfWeek: number[] | null = null) {
  const row: MedicationSchedule = {
    id: `${med.id}-${timeOfDay}`,
    medicationId: med.id,
    userId: "u1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder: 0,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    createdAt: EPOCH,
  };
  return row;
}

function prn(med: Medication): MedicationSchedule {
  return { ...fixed(med, "00:00"), id: `${med.id}-prn`, scheduleKind: "prn", timeOfDay: null };
}

function schedulesOf(...rows: MedicationSchedule[]): Map<string, MedicationSchedule[]> {
  const map = new Map<string, MedicationSchedule[]>();
  for (const row of rows) map.set(row.medicationId, [...(map.get(row.medicationId) ?? []), row]);
  return map;
}

function dose(
  id: string,
  med: Medication,
  takenAt: string,
  overrides: Partial<DoseLogWithMedication> = {},
): DoseLogWithMedication {
  return {
    id,
    userId: "u1",
    medicationId: med.id,
    quantity: 1,
    status: "taken",
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
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
    ...overrides,
  };
}

/** What getLastDosePerMedication would return for these doses. */
function lastDosesOf(doses: DoseLogWithMedication[]): DashboardCompositionInputs["lastDoses"] {
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

function compose(args: Omit<Partial<DashboardCompositionInputs>, "now"> & { now: string }) {
  const doses = args.doses ?? [];
  return composeDashboardPageData({
    medications: args.medications ?? [],
    schedulesByMedId: args.schedulesByMedId ?? new Map(),
    doses,
    lastDoses: args.lastDoses ?? lastDosesOf(doses),
    now: new Date(args.now),
    timezone: args.timezone ?? "UTC",
  });
}

function row(
  med: Medication,
  expectedTime: string,
  state: DueRow["state"],
  actions: { logNow?: boolean; tookItAt?: string | null; skipAt?: string | null } = {},
): DueRow {
  return {
    key: `${med.id}:${expectedTime}`,
    kind: "fixed_time",
    expectedTime,
    state,
    logNow: actions.logNow ?? false,
    tookItAt: actions.tookItAt ?? null,
    skipAt: actions.skipAt ?? null,
  };
}

const rowsOf = (cards: DueCard[]) => cards.map((card) => ({ key: card.key, rows: card.rows }));

describe("computeNextRefreshAt", () => {
  function matched(
    expectedTime: string,
    segment: MatchedSlot["segment"],
    status: MatchedSlot["status"],
  ): MatchedSlot {
    return {
      expectedTime: new Date(expectedTime),
      kind: "fixed_time",
      segment,
      status,
      resolvedByDoseId: null,
      missedByDoseId: null,
    };
  }

  function refreshAt(
    now: string,
    slots: MatchedSlot[],
    doses: Array<Pick<DoseLogWithMedication, "status" | "takenAt">> = [],
  ): string {
    const at = new Date(now);
    return computeNextRefreshAt({
      now: at,
      window: dashboardWindow(at, "UTC"),
      slots,
      doses,
    }).toISOString();
  }

  it("falls back to the end of the civil day", () => {
    expect(refreshAt(thu("13:30"), [])).toBe(fri("00:00"));
  });

  it("never arms a timer for less than five seconds", () => {
    expect(
      refreshAt("2026-04-16T13:59:58.000Z", [matched(thu("14:00"), "today", "upcoming")]),
    ).toBe("2026-04-16T14:00:03.000Z");
  });

  it("wakes an hour before a tomorrow's-first-hour slot", () => {
    expect(refreshAt(thu("22:00"), [matched(fri("00:30"), "tomorrow", "upcoming")])).toBe(
      thu("23:30"),
    );
  });

  it("wakes when an Earlier slot turns twelve hours old, but only while it is outstanding", () => {
    expect(refreshAt(thu("07:00"), [matched(wed("22:00"), "yesterday", "overdue")])).toBe(
      thu("10:00"),
    );
    // Resolved, so not visible: there is no expiry to wait for.
    expect(refreshAt(thu("07:00"), [matched(wed("22:00"), "yesterday", "taken")])).toBe(
      fri("00:00"),
    );
  });

  it("wakes when a future-dated dose's time arrives", () => {
    expect(
      refreshAt(thu("13:30"), [], [{ status: "taken", takenAt: new Date(thu("15:00")) }]),
    ).toBe(thu("15:00"));
  });

  it("ends a taken dose's cooldown on time; a skip starts none", () => {
    expect(
      refreshAt(
        thu("13:30"),
        [],
        [
          { status: "taken", takenAt: new Date(thu("13:10")) },
          // Were skips counted, 12:40 + 1h = 13:40 would win.
          { status: "skipped", takenAt: new Date(thu("12:40")) },
        ],
      ),
    ).toBe(thu("14:10"));
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-page-data.test.ts`
Expected: FAIL. The suite cannot load because `$lib/server/dashboard/page-data` does not exist (`Failed to resolve import`).

- [ ] **Step 9: Write minimal implementation**

Create `src/lib/server/dashboard/page-data.ts`:

```ts
import type { DoseLogWithMedication, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  CARRY_OVER_MS,
  LOG_NOW_COOLDOWN_MS,
  MATCH_TOLERANCE_MS,
  type DashboardWindow,
  type MatchedSlot,
} from "$lib/utils/schedule";

/**
 * The dashboard's composition: everything the page shows, built from data
 * already fetched. `load.ts` is the I/O; nothing here touches the database,
 * so every rule the page renders is testable from plain fixtures — the
 * `analytics/page-data.ts` precedent.
 *
 * It owns no matching rule. The window, both clips, passes 0–2 and which
 * buttons a row offers belong to `utils/schedule.ts`; this module sorts
 * their answers into the page's sections and adds exactly one presentation
 * rule (Took it at is not shown beside Log now on a due-now row).
 */

/** A refresh timer is never armed for less than this. */
const MIN_REFRESH_DELAY_MS = 5_000;

export type DashboardCompositionInputs = {
  /** Active medications, in `sortOrder` — also the chip list. */
  medications: Medication[];
  /**
   * Every schedule row the user has. Only `medications`' rows are read, so an
   * archived medication's schedule never reaches the page.
   */
  schedulesByMedId: Map<string, MedicationSchedule[]>;
  /** `getDosesInRange` over `dashboardWindow`'s `doseFetchFrom` / `doseFetchTo`. */
  doses: DoseLogWithMedication[];
  /** `getLastDosePerMedication` — all-time, so an interval row anchors on a dose older than the fetch. */
  lastDoses: Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>;
  /** One instant for the whole request. */
  now: Date;
  timezone: string;
};

/**
 * Whether the page may show a slot at all: today's always; one from before
 * midnight only while outstanding and at or after `visibleStart` (the first
 * millisecond under 12h old). Tomorrow's first hour is matched, never shown.
 */
function isVisible(slot: MatchedSlot, window: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= window.end.getTime()) return false;
  if (t >= window.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= window.visibleStart.getTime();
}

/**
 * The earliest instant after `now` at which the page would change without a
 * write (spec "Freshness"), clamped to at least `now + 5s`. Status, rows and
 * buttons change only through the load, so the client reloads at this
 * instant rather than recomputing anything itself.
 */
export function computeNextRefreshAt(input: {
  now: Date;
  window: DashboardWindow;
  slots: readonly MatchedSlot[];
  doses: ReadonlyArray<Pick<DoseLogWithMedication, "status" | "takenAt">>;
}): Date {
  const { now, window, slots, doses } = input;
  const nowMs = now.getTime();
  // `end` is always after `now`, so the minimum below is always finite.
  const candidates: number[] = [window.end.getTime()];

  for (const slot of slots) {
    const t = slot.expectedTime.getTime();
    if (slot.segment === "tomorrow") {
      // From here a dose logged now can land on it in pass 1.
      candidates.push(t - MATCH_TOLERANCE_MS);
      continue;
    }
    if (!isVisible(slot, window)) continue;
    // Enters due-now, reaches its time, leaves due-now.
    candidates.push(t - MATCH_TOLERANCE_MS, t, t + MATCH_TOLERANCE_MS);
    // An Earlier row disappears at exactly twelve hours old.
    if (t < window.todayStart.getTime()) candidates.push(t + CARRY_OVER_MS);
  }

  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    // A future-dated dose starts counting when its time arrives.
    if (t > nowMs) candidates.push(t);
    // Log now returns when the one-hour cooldown ends.
    else if (dose.status === "taken" && t > nowMs - LOG_NOW_COOLDOWN_MS) {
      candidates.push(t + LOG_NOW_COOLDOWN_MS);
    }
  }

  const next = Math.min(...candidates.filter((c) => c > nowMs));
  return new Date(Math.max(next, nowMs + MIN_REFRESH_DELAY_MS));
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-page-data.test.ts`
Expected: PASS (the 6 `computeNextRefreshAt` tests).

#### Cycle 3: `composeDashboardPageData`

- [ ] **Step 11: Write the failing test**

Append to `tests/unit/dashboard-page-data.test.ts`:

```ts
describe("composeDashboardPageData — Due and Later", () => {
  it("files today's outstanding slots as overdue, due-now or Later by distance from now", () => {
    // 13:30. Metformin 11:00 is 2.5h late (overdue): pass 2 gives a dose
    // logged now to it, pass 0 gives Took it at 11:00 to it, and its skip is
    // reserved at 11:00. Ibuprofen 13:45 is 15m ahead (due-now): pass 1 gives
    // a dose logged now to it; Took it at is not offered (not yet happened);
    // its skip is at min(13:45, now) = 13:30. Lisinopril 20:00 is 6.5h ahead
    // (Later). Yesterday's slots are over 12h old, so hidden.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "11:00"),
        fixed(IBUPROFEN, "13:45"),
        fixed(LISINOPRIL, "20:00"),
      ),
    });

    expect(data.earlier).toEqual([]);
    expect(data.today).toEqual([
      {
        key: "today:med-a",
        medicationId: "med-a",
        name: "Metformin",
        dosageAmount: "500",
        dosageUnit: "mg",
        colour: "#6366f1",
        colourSecondary: null,
        pattern: "solid",
        rows: [
          row(METFORMIN, thu("11:00"), "overdue", {
            logNow: true,
            tookItAt: thu("11:00"),
            skipAt: thu("11:00"),
          }),
        ],
      },
      {
        key: "today:med-b",
        medicationId: "med-b",
        name: "Ibuprofen",
        dosageAmount: "200",
        dosageUnit: "mg",
        colour: "#f59e0b",
        colourSecondary: null,
        pattern: "solid",
        rows: [row(IBUPROFEN, thu("13:45"), "due-now", { logNow: true, skipAt: thu("13:30") })],
      },
    ]);
    expect(data.later).toEqual([
      {
        key: `med-c:${thu("20:00")}`,
        medicationId: "med-c",
        name: "Lisinopril",
        dosageAmount: "10",
        dosageUnit: "mg",
        colour: "#10b981",
        colourSecondary: null,
        pattern: "solid",
        expectedTime: thu("20:00"),
      },
    ]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 2,
      doneToday: 0,
      totalToday: 3,
      loggedToday: 0,
      next: null,
    });
  });

  it("hides Took it at on a due-now row that also shows Log now, and keeps Skip", () => {
    // 13:30, slot 13:00 (due-now). Pass 1 gives a dose logged now to it, so
    // it is the target. slotActions offers Took it at 13:00 as well; the
    // presentation rule drops it because both resolve the same row.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "13:00")),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [row(METFORMIN, thu("13:00"), "due-now", { logNow: true, skipAt: thu("13:00") })],
      },
    ]);
  });

  it("nests a medication's other outstanding rows latest first under its Log-now row", () => {
    // 13:30, slots 08:55, 09:00, 11:00, nothing logged. Pass 2 gives a dose
    // logged now to the latest, 11:00: that is the target and the top row.
    // All three are past, so each offers Took it at its own time (pass 0)
    // and a reserved Skip.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "08:55"),
        fixed(METFORMIN, "09:00"),
        fixed(METFORMIN, "11:00"),
      ),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("11:00"), "overdue", {
            logNow: true,
            tookItAt: thu("11:00"),
            skipAt: thu("11:00"),
          }),
          row(METFORMIN, thu("09:00"), "overdue", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
          row(METFORMIN, thu("08:55"), "overdue", { tookItAt: thu("08:55"), skipAt: thu("08:55") }),
        ],
      },
    ]);
    expect(data.status).toMatchObject({ kind: "due", dueCount: 3 });
  });

  it("puts the Log-now target on top even when it is not the latest row", () => {
    // 09:30, slots 08:55 and 09:00. Pass 1 ascends, so a dose logged now
    // (35m from 08:55) lands on 08:55, not 09:00: 08:55 is the target and
    // leads the card. 09:00 keeps Took it at (pass 0 resolves exactly it)
    // because it is not the Log-now row.
    const data = compose({
      now: thu("09:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "08:55"), fixed(METFORMIN, "09:00")),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("08:55"), "due-now", { logNow: true, skipAt: thu("08:55") }),
          row(METFORMIN, thu("09:00"), "due-now", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
        ],
      },
    ]);
  });

  it("withholds Log now inside the one-hour cooldown but keeps Took it at and Skip", () => {
    // 13:30, slots 09:00 and 13:00, a dose at 12:45. Pass 1 gives it to
    // 13:00; 09:00 is 4.5h late. 12:45 is inside (12:30, 13:30], so this
    // medication has no Log now anywhere.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "09:00"), fixed(METFORMIN, "13:00")),
      doses: [dose("d1", METFORMIN, thu("12:45"))],
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("09:00"), "overdue", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
        ],
      },
    ]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 1,
      doneToday: 1,
      totalToday: 2,
      loggedToday: 1,
      next: null,
    });
  });

  it("gives a medication one card per sub-group", () => {
    // 07:00, slots 06:30 and 22:00. Yesterday's 22:00 is 9h old (Earlier:
    // Took it at and a reserved Skip, but no Log now). This morning's 06:30
    // is 30m late (due-now) and pass 1 gives it a dose logged now. Tonight's
    // 22:00 is Later. Yesterday's 06:30 is over 12h old, so hidden.
    const data = compose({
      now: thu("07:00"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "06:30"), fixed(METFORMIN, "22:00")),
    });

    expect(rowsOf(data.earlier)).toEqual([
      {
        key: "earlier:med-a",
        rows: [
          row(METFORMIN, wed("22:00"), "earlier", { tookItAt: wed("22:00"), skipAt: wed("22:00") }),
        ],
      },
    ]);
    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [row(METFORMIN, thu("06:30"), "due-now", { logNow: true, skipAt: thu("06:30") })],
      },
    ]);
    expect(data.later.map((r) => r.expectedTime)).toEqual([thu("22:00")]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 2,
      doneToday: 0,
      totalToday: 2,
      loggedToday: 0,
      next: null,
    });
  });

  it("orders cards by top-row time, then sortOrder, whatever order medications arrive in", () => {
    const data = compose({
      now: thu("13:30"),
      medications: [IBUPROFEN, METFORMIN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(IBUPROFEN, "11:00"),
        fixed(METFORMIN, "11:00"),
        fixed(LISINOPRIL, "10:00"),
      ),
    });

    expect(data.today.map((card) => card.key)).toEqual([
      "today:med-c",
      "today:med-a",
      "today:med-b",
    ]);
  });
});

describe("composeDashboardPageData — state boundaries", () => {
  it("a slot exactly an hour past is due-now; a millisecond later it is overdue", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "13:00")),
    };
    expect(compose({ ...setup, now: thu("14:00") }).today[0].rows[0].state).toBe("due-now");
    expect(compose({ ...setup, now: "2026-04-16T14:00:00.001Z" }).today[0].rows[0].state).toBe(
      "overdue",
    );
  });

  it("a slot exactly an hour ahead is in Due; a millisecond further out it is in Later", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "15:00")),
    };
    const onBoundary = compose({ ...setup, now: thu("14:00") });
    expect(onBoundary.today[0].rows[0].state).toBe("due-now");
    expect(onBoundary.later).toEqual([]);

    const beyond = compose({ ...setup, now: "2026-04-16T13:59:59.999Z" });
    expect(beyond.today).toEqual([]);
    expect(beyond.later.map((r) => r.expectedTime)).toEqual([thu("15:00")]);
  });

  it("an Earlier row shows until it is twelve hours old, to the millisecond", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "22:00")),
    };
    // visibleStart = now − 12h + 1ms. At 09:59:59.999 that is exactly
    // yesterday 22:00:00.000, so the slot is in.
    const last = compose({ ...setup, now: "2026-04-16T09:59:59.999Z" });
    expect(last.earlier.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [[wed("22:00"), "earlier"]],
    ]);
    // At 10:00:00.000 visibleStart is 22:00:00.001, so the slot is gone, and Due with it.
    const gone = compose({ ...setup, now: thu("10:00") });
    expect(gone.earlier).toEqual([]);
    expect(gone.status.kind).toBe("caught-up");
  });
});

describe("composeDashboardPageData — Done", () => {
  it("lists today's doses and backdated doses logged today, oldest first", () => {
    // 07:00. Lisinopril is fixed 22:00. d-back is a "Took it at yesterday
    // 22:00" tapped this morning: pass 0 gives it yesterday's 22:00, and it
    // must be in Done so it can be undone. d-old was logged yesterday for
    // yesterday, so it is history, not Done.
    const doses = [
      dose("d-old", LISINOPRIL, wed("20:00")),
      dose("d-back", LISINOPRIL, wed("22:00"), { loggedAt: new Date(thu("06:50")) }),
      dose("d-prn", IBUPROFEN, thu("06:40"), { quantity: 2 }),
      dose("d-skip", IBUPROFEN, thu("06:45"), { status: "skipped" }),
    ];
    const data = compose({
      now: thu("07:00"),
      medications: [LISINOPRIL, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(LISINOPRIL, "22:00"), prn(IBUPROFEN)),
      doses,
    });

    expect(data.done.map((r) => [r.key, r.dayLabel, r.covers])).toEqual([
      // It resolved its own minute, so it covers nothing extra.
      ["d-back", "yesterday", []],
      ["d-prn", null, []],
      ["d-skip", null, []],
    ]);
    expect(data.done[0].dose).toBe(doses[1]);
    // Yesterday's 22:00 is resolved, so nothing is Due; tonight's is ahead.
    expect(data.earlier).toEqual([]);
    expect(data.status).toEqual({
      kind: "caught-up",
      dueCount: 0,
      doneToday: 0,
      totalToday: 1,
      loggedToday: 2,
      next: {
        name: "Lisinopril",
        dosageAmount: "10",
        dosageUnit: "mg",
        expectedTime: thu("22:00"),
        alsoCount: 0,
      },
    });
  });

  it("covers lists the slots a dose resolved, minus its own minute", () => {
    // The spec's live case: slots 08:55, 09:00, 11:00, with ×4 at 13:31 and
    // ×3 at 21:48; now 22:00. Pass 1 finds nothing within an hour of either
    // dose. Pass 2 replays in time order: 13:31 walks back over 11:00,
    // 09:00 and 08:55 and stops at todayStart (= visibleStart) with a unit
    // spare; 21:48 finds every slot already resolved.
    const data = compose({
      now: thu("22:00"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "08:55"),
        fixed(METFORMIN, "09:00"),
        fixed(METFORMIN, "11:00"),
      ),
      doses: [
        dose("d1", METFORMIN, thu("13:31"), { quantity: 4 }),
        dose("d2", METFORMIN, thu("21:48"), { quantity: 3 }),
      ],
    });

    expect(data.done.map((r) => [r.key, r.covers])).toEqual([
      ["d1", [thu("08:55"), thu("09:00"), thu("11:00")]],
      ["d2", []],
    ]);
    expect(data.today).toEqual([]);
    expect(data.status).toEqual({
      kind: "all-done",
      dueCount: 0,
      doneToday: 3,
      totalToday: 3,
      loggedToday: 2,
      next: null,
    });
    // d2's cooldown (21:48 + 1h) ends before midnight.
    expect(data.nextRefreshAt).toBe(thu("22:48"));
  });

  it("covers never names tomorrow's first hour, though the dose resolved it", () => {
    // Fixed 23:50 and 00:20, ×3 at 23:55. Pass 1 ascends: tonight's 23:50
    // (5m), then tomorrow's 00:20 (25m, which has no segment limit). Pass 2
    // walks the last unit back past 23:50 (resolved) to this morning's
    // 00:20. Tomorrow's 00:20 is matched but never shown, counted or credited.
    const data = compose({
      now: thu("23:58"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "23:50"), fixed(METFORMIN, "00:20")),
      doses: [dose("d1", METFORMIN, thu("23:55"), { quantity: 3 })],
    });

    expect(data.done.map((r) => r.covers)).toEqual([[thu("00:20"), thu("23:50")]]);
    expect(data.status).toMatchObject({ kind: "all-done", doneToday: 2, totalToday: 2 });
    expect(data.later).toEqual([]);
    expect(data.nextRefreshAt).toBe(fri("00:00"));
  });
});

describe("composeDashboardPageData — header status", () => {
  it("caught-up: names the earliest slot ahead and how many share its instant", () => {
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "20:00"),
        fixed(IBUPROFEN, "20:00"),
        fixed(LISINOPRIL, "20:00"),
      ),
    });

    expect(data.status).toEqual({
      kind: "caught-up",
      dueCount: 0,
      doneToday: 0,
      totalToday: 3,
      loggedToday: 0,
      next: {
        name: "Metformin",
        dosageAmount: "500",
        dosageUnit: "mg",
        expectedTime: thu("20:00"),
        alsoCount: 2,
      },
    });
    expect(data.later.map((r) => r.medicationId)).toEqual(["med-a", "med-b", "med-c"]);
  });

  it("none-today: a scheduled medication with no slot today", () => {
    // Monday-only; the window touches Wednesday, Thursday and Friday.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "08:00", [1])),
      doses: [dose("d1", METFORMIN, thu("09:00"))],
    });

    expect(data.status).toEqual({
      kind: "none-today",
      dueCount: 0,
      doneToday: 0,
      totalToday: 0,
      loggedToday: 1,
      next: null,
    });
  });

  it("as-needed-only: no ACTIVE medication has a timed schedule — an archived one's rows are ignored", () => {
    const ARCHIVED = makeMed({ id: "med-old", name: "Old", isArchived: true });
    const data = compose({
      now: thu("13:30"),
      // METFORMIN has no schedule rows at all.
      medications: [IBUPROFEN, METFORMIN],
      schedulesByMedId: schedulesOf(prn(IBUPROFEN), fixed(ARCHIVED, "08:00")),
      doses: [
        dose("d1", IBUPROFEN, thu("09:00")),
        dose("d2", IBUPROFEN, thu("11:00")),
        dose("d3", IBUPROFEN, thu("12:00"), { status: "skipped" }),
      ],
    });

    // loggedToday counts taken events; the skip is in Done but is not a dose logged.
    expect(data.status).toEqual({
      kind: "as-needed-only",
      dueCount: 0,
      doneToday: 0,
      totalToday: 0,
      loggedToday: 2,
      next: null,
    });
    expect(data.done.map((r) => r.key)).toEqual(["d1", "d2", "d3"]);
    expect([data.earlier, data.today, data.later]).toEqual([[], [], []]);
  });
});

describe("composeDashboardPageData — nextRefreshAt", () => {
  it("is the next slot boundary", () => {
    // 13:30: Ibuprofen's 13:45 is the nearest of t−1h, t and t+1h over the visible slots.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "11:00"), fixed(IBUPROFEN, "13:45")),
    });
    expect(data.nextRefreshAt).toBe(thu("13:45"));
  });

  it("includes the moment an Earlier row turns twelve hours old", () => {
    // 07:00: yesterday's 22:00 expires at 10:00. Yesterday's 18:00 is
    // already hidden, so it gets no card and contributes nothing.
    const data = compose({
      now: thu("07:00"),
      medications: [METFORMIN, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "22:00"), fixed(IBUPROFEN, "18:00")),
    });
    expect(data.earlier.map((c) => c.key)).toEqual(["earlier:med-a"]);
    expect(data.nextRefreshAt).toBe(thu("10:00"));
  });

  it("includes the end of a taken dose's cooldown", () => {
    // 13:30 with a dose at 12:45: Log now may return at 13:45, before the
    // next slot boundary (13:00 + 1h = 14:00).
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "09:00"), fixed(METFORMIN, "13:00")),
      doses: [dose("d1", METFORMIN, thu("12:45"))],
    });
    expect(data.nextRefreshAt).toBe(thu("13:45"));
  });
});

describe("composeDashboardPageData — payload", () => {
  it("echoes the request's instant and zone and resolves slots in that zone", () => {
    // 13:30 BST. Fixed 11:00 London is 10:00Z; London's midnight is 23:00Z the day before.
    const data = compose({
      now: "2026-04-16T12:30:00.000Z",
      timezone: "Europe/London",
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "11:00")),
    });

    expect(data.now).toBe("2026-04-16T12:30:00.000Z");
    expect(data.timezone).toBe("Europe/London");
    expect(data.todayStart).toBe("2026-04-15T23:00:00.000Z");
    expect(data.today.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [["2026-04-16T10:00:00.000Z", "overdue"]],
    ]);
    expect(data.medications).toEqual([METFORMIN]);
    expect(data).not.toHaveProperty("refillForecast");
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-page-data.test.ts`
Expected: FAIL with `TypeError: composeDashboardPageData is not a function` in every `composeDashboardPageData — …` test. The 6 `computeNextRefreshAt` tests still pass.

- [ ] **Step 13: Write minimal implementation**

In `src/lib/server/dashboard/page-data.ts`, replace the import block at the top of the file:

```ts
import type { DoseLogWithMedication, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  CARRY_OVER_MS,
  LOG_NOW_COOLDOWN_MS,
  MATCH_TOLERANCE_MS,
  type DashboardWindow,
  type MatchedSlot,
} from "$lib/utils/schedule";
```

with:

```ts
import type {
  DashboardPageData,
  DashboardStatus,
  DoneRow,
  DoseLogWithMedication,
  DueCard,
  DueRow,
  LaterRow,
  Medication,
} from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  CARRY_OVER_MS,
  LOG_NOW_COOLDOWN_MS,
  MATCH_TOLERANCE_MS,
  dashboardWindow,
  matchMedicationSlots,
  projectFixedTimes,
  projectMedicationSlots,
  segmentsFor,
  slotActions,
  type DashboardWindow,
  type MatchDose,
  type MatchedSlot,
} from "$lib/utils/schedule";
```

Then append this code to the end of the file, below `computeNextRefreshAt`:

```ts
const MINUTE_MS = 60_000;

type DisplayState = DueRow["state"] | "later";

/** Sort key shared by cards and Later rows: time, then the user's order, then arrival. */
type Placed<T> = { value: T; at: number; sortOrder: number; index: number };

function byPlacement<T>(a: Placed<T>, b: Placed<T>): number {
  return a.at - b.at || a.sortOrder - b.sortOrder || a.index - b.index;
}

function isResolved(slot: MatchedSlot): boolean {
  return slot.status === "taken" || slot.status === "skipped";
}

/** A row that projects slots. PRN rows never do. */
function isTimed(schedule: MedicationSchedule): boolean {
  return schedule.scheduleKind === "interval" || schedule.scheduleKind === "fixed_time";
}

/**
 * Where an outstanding visible slot goes: Earlier if before today's
 * midnight; due-now within ±1h of now, inclusive; overdue further past;
 * Later further ahead. Null for a slot the page does not list.
 */
function displayStateOf(
  slot: MatchedSlot,
  window: DashboardWindow,
  now: Date,
): DisplayState | null {
  if (!isVisible(slot, window) || isResolved(slot)) return null;
  const t = slot.expectedTime.getTime();
  if (t < window.todayStart.getTime()) return "earlier";
  const ahead = t - now.getTime();
  if (Math.abs(ahead) <= MATCH_TOLERANCE_MS) return "due-now";
  return ahead < 0 ? "overdue" : "later";
}

/**
 * One card per medication per sub-group. Its top row is the Log-now target
 * when this sub-group holds it, else the latest outstanding row; the rest
 * nest below, latest first.
 */
function placeCard(
  subGroup: "earlier" | "today",
  med: Medication,
  index: number,
  rows: DueRow[],
): Placed<DueCard> {
  const latestFirst = [...rows].sort(
    (a, b) => Date.parse(b.expectedTime) - Date.parse(a.expectedTime),
  );
  const top = latestFirst.find((row) => row.logNow) ?? latestFirst[0];
  const card: DueCard = {
    key: `${subGroup}:${med.id}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    rows: [top, ...latestFirst.filter((row) => row !== top)],
  };
  return { value: card, at: Date.parse(top.expectedTime), sortOrder: med.sortOrder, index };
}

/**
 * Done: today's doses, plus doses logged today for before midnight (a
 * backdated Took it at on an Earlier row, which must stay reachable to
 * undo), oldest first. `covers` reads `resolvedByDoseId` only — a missed
 * row resolves nothing.
 */
function buildDoneRows(
  doses: DoseLogWithMedication[],
  slots: readonly MatchedSlot[],
  window: DashboardWindow,
): DoneRow[] {
  const todayStartMs = window.todayStart.getTime();
  const endMs = window.end.getTime();
  const projectStartMs = window.projectStart.getTime();

  const takenAtById = new Map(doses.map((d) => [d.id, d.takenAt.getTime()]));
  const covers = new Map<string, number[]>();
  for (const slot of slots) {
    // Tomorrow's first hour is matched so that today's choices hold at
    // midnight, but it is never shown, counted or credited.
    if (slot.segment === "tomorrow" || slot.resolvedByDoseId === null) continue;
    const takenAt = takenAtById.get(slot.resolvedByDoseId);
    if (takenAt === undefined) continue;
    const t = slot.expectedTime.getTime();
    // A dose at its own slot's minute adds nothing its time column doesn't say.
    if (Math.floor(t / MINUTE_MS) === Math.floor(takenAt / MINUTE_MS)) continue;
    covers.set(slot.resolvedByDoseId, [...(covers.get(slot.resolvedByDoseId) ?? []), t]);
  }

  return doses
    .filter((d) => {
      const t = d.takenAt.getTime();
      if (t >= todayStartMs && t < endMs) return true;
      // Bounded below by projectStart so "yesterday" is true of every row it labels.
      return d.loggedAt.getTime() >= todayStartMs && t < todayStartMs && t >= projectStartMs;
    })
    .sort(
      (a, b) =>
        a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map(
      (d): DoneRow => ({
        key: d.id,
        dose: d,
        covers: (covers.get(d.id) ?? [])
          .sort((x, y) => x - y)
          .map((t) => new Date(t).toISOString()),
        dayLabel: d.takenAt.getTime() < todayStartMs ? "yesterday" : null,
      }),
    );
}

/** The header's kind and counts. First matching predicate wins, in the spec's table order. */
function headerStatus(input: {
  anyTimed: boolean;
  earlier: DueCard[];
  today: DueCard[];
  later: LaterRow[];
  done: DoneRow[];
  doneToday: number;
  totalToday: number;
}): DashboardStatus {
  const dueCount = [...input.earlier, ...input.today].reduce((n, card) => n + card.rows.length, 0);
  const loggedToday = input.done.filter((row) => row.dose.status === "taken").length;
  const counts = {
    dueCount,
    doneToday: input.doneToday,
    totalToday: input.totalToday,
    loggedToday,
  };

  if (!input.anyTimed) return { kind: "as-needed-only", ...counts, next: null };
  if (dueCount > 0) return { kind: "due", ...counts, next: null };
  // With Due empty, today's unresolved slots ahead of now are exactly Later.
  const first = input.later[0];
  if (first) {
    return {
      kind: "caught-up",
      ...counts,
      next: {
        name: first.name,
        dosageAmount: first.dosageAmount,
        dosageUnit: first.dosageUnit,
        expectedTime: first.expectedTime,
        alsoCount: input.later.filter((row) => row.expectedTime === first.expectedTime).length - 1,
      },
    };
  }
  if (input.totalToday > 0 && input.doneToday === input.totalToday) {
    return { kind: "all-done", ...counts, next: null };
  }
  return { kind: "none-today", ...counts, next: null };
}

/** Build the dashboard payload (everything but `refillForecast`) from already-fetched data. */
export function composeDashboardPageData(
  input: DashboardCompositionInputs,
): Omit<DashboardPageData, "refillForecast"> {
  const { medications, schedulesByMedId, doses, lastDoses, now, timezone } = input;
  const window = dashboardWindow(now, timezone);
  const segments = segmentsFor(window);

  const lastTakenByMed = new Map(lastDoses.map((d) => [d.medicationId, d.lastTakenAt]));
  const dosesByMed = new Map<string, MatchDose[]>();
  for (const d of doses) {
    const list = dosesByMed.get(d.medicationId) ?? [];
    list.push({ id: d.id, takenAt: d.takenAt, status: d.status, quantity: d.quantity });
    dosesByMed.set(d.medicationId, list);
  }

  const allSlots: MatchedSlot[] = [];
  const earlierCards: Placed<DueCard>[] = [];
  const todayCards: Placed<DueCard>[] = [];
  const laterRows: Placed<LaterRow>[] = [];
  let anyTimed = false;
  let totalToday = 0;
  let doneToday = 0;

  for (const [index, med] of medications.entries()) {
    const schedules = schedulesByMedId.get(med.id) ?? [];
    if (!schedules.some(isTimed)) continue;
    anyTimed = true;

    // The only projection step that touches Intl: computed once here and
    // handed to every simulation slotActions runs.
    const fixedInstants = projectFixedTimes(schedules, segments, timezone);
    const lastTakenAt = lastTakenByMed.get(med.id) ?? null;
    const medDoses = dosesByMed.get(med.id) ?? [];
    const slots = matchMedicationSlots(
      projectMedicationSlots({ med, schedules, fixedInstants, lastTakenAt, segments }),
      medDoses,
      { now, segments, pass2Bound: window.visibleStart },
    );
    const actions = slotActions({
      med,
      schedules,
      fixedInstants,
      doses: medDoses,
      lastTakenAt,
      window,
    });
    allSlots.push(...slots);

    const earlierRows: DueRow[] = [];
    const todayRows: DueRow[] = [];
    for (const slot of slots) {
      if (slot.segment === "today") {
        totalToday += 1;
        if (isResolved(slot)) doneToday += 1;
      }

      const state = displayStateOf(slot, window, now);
      if (state === null) continue;
      const expectedTime = slot.expectedTime.toISOString();
      const key = `${med.id}:${expectedTime}`;

      if (state === "later") {
        laterRows.push({
          value: {
            key,
            medicationId: med.id,
            name: med.name,
            dosageAmount: med.dosageAmount,
            dosageUnit: med.dosageUnit,
            colour: med.colour,
            colourSecondary: med.colourSecondary,
            pattern: med.pattern,
            expectedTime,
          },
          at: slot.expectedTime.getTime(),
          sortOrder: med.sortOrder,
          index,
        });
        continue;
      }

      const logNow = actions.logNowTarget === expectedTime;
      const offered = actions.rows.get(expectedTime);
      (state === "earlier" ? earlierRows : todayRows).push({
        key,
        kind: slot.kind,
        expectedTime,
        state,
        logNow,
        // The one presentation rule on top of the simulations: a due-now row
        // showing Log now does not also show Took it at, because both would
        // resolve the same row.
        tookItAt: state === "due-now" && logNow ? null : (offered?.tookItAt ?? null),
        skipAt: offered?.skipAt ?? null,
      });
    }

    if (earlierRows.length > 0) earlierCards.push(placeCard("earlier", med, index, earlierRows));
    if (todayRows.length > 0) todayCards.push(placeCard("today", med, index, todayRows));
  }

  const earlier = earlierCards.sort(byPlacement).map((p) => p.value);
  const today = todayCards.sort(byPlacement).map((p) => p.value);
  const later = laterRows.sort(byPlacement).map((p) => p.value);
  const done = buildDoneRows(doses, allSlots, window);

  return {
    now: now.toISOString(),
    nextRefreshAt: computeNextRefreshAt({ now, window, slots: allSlots, doses }).toISOString(),
    timezone,
    todayStart: window.todayStart.toISOString(),
    status: headerStatus({ anyTimed, earlier, today, later, done, doneToday, totalToday }),
    earlier,
    today,
    done,
    later,
    medications,
  };
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-page-data.test.ts`
Expected: PASS (every test). If a case fails, read its derivation comment first. A mismatch in `logNow`, `tookItAt` or `skipAt` means `slotActions` (T5) disagrees with the contract; a mismatch in status or covers means `matchMedicationSlots` (T4) disagrees. Fix the owning layer, not the expectation.

- [ ] **Step 15: Prove by mutation** (apply each change on its own, watch the named test fail, then restore it)
  1. In `displayStateOf`, change `Math.abs(ahead) <= MATCH_TOLERANCE_MS` to `Math.abs(ahead) < MATCH_TOLERANCE_MS`. "a slot exactly an hour past is due-now; a millisecond later it is overdue" fails.
  2. In `composeDashboardPageData`, change `tookItAt: state === "due-now" && logNow ? null : (offered?.tookItAt ?? null),` to `tookItAt: offered?.tookItAt ?? null,`. "hides Took it at on a due-now row that also shows Log now, and keeps Skip" fails.
  3. In `placeCard`, change `latestFirst.find((row) => row.logNow) ?? latestFirst[0]` to `latestFirst[0]`. "puts the Log-now target on top even when it is not the latest row" fails.
  4. In `buildDoneRows`, change `if (slot.segment === "tomorrow" || slot.resolvedByDoseId === null) continue;` to `if (slot.resolvedByDoseId === null) continue;`. "covers never names tomorrow's first hour, though the dose resolved it" fails.
  5. In `buildDoneRows`, change the filter's second `return` to `return false;`. "lists today's doses and backdated doses logged today, oldest first" fails.
  6. In `isVisible`, change `return slot.status === "overdue" && t >= window.visibleStart.getTime();` to `return slot.status === "overdue";`. "an Earlier row shows until it is twelve hours old, to the millisecond" fails.
  7. In `computeNextRefreshAt`, delete the `else if (dose.status === "taken" && …) { … }` branch. "includes the end of a taken dose's cooldown" and "ends a taken dose's cooldown on time; a skip starts none" fail.
  8. In `headerStatus`, change `row.dose.status === "taken"` to `true`. "as-needed-only: no ACTIVE medication has a timed schedule — an archived one's rows are ignored" fails (`loggedToday` 3).

  Restore each change, then run `npx vitest run tests/unit/dashboard-page-data.test.ts`. Expected: PASS.

- [ ] **Step 16: Commit**

```bash
git add src/lib/server/dashboard/page-data.ts tests/unit/dashboard-page-data.test.ts
git commit -m "feat(dashboard): compose the due-now payload from matched slots"
```

#### Cycle 4: `loadDashboard`

- [ ] **Step 17: Write the failing test**

Create `tests/unit/dashboard-load.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { doseLogs, medications, medicationSchedules } from "$lib/server/db/schema";
import { fakeDb, predicateIncludes } from "./helpers/fake-db";

// The real query modules run against the shared seam, so this pins what
// loadDashboard asks the database for. The rules it composes are covered by
// dashboard-page-data.test.ts; this file proves only the wiring.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const { loadDashboard } = await import("../../src/lib/server/dashboard/load");

const TZ = "Europe/London";
// 13:30 BST on Thursday 2026-04-16.
const NOW = new Date("2026-04-16T12:30:00.000Z");
// dashboardWindow(NOW, London): projectStart is yesterday's local midnight
// (2026-04-14T23:00Z) and end is tonight's (2026-04-16T23:00Z).
const FETCH_FROM = "2026-04-14T22:00:00.000Z"; // projectStart − 1h
const FETCH_TO = "2026-04-17T01:00:00.000Z"; // end + 2h

const EPOCH = new Date("2026-01-01T00:00:00Z");

function medicationRow(id: string, name: string, sortOrder: number) {
  return {
    id,
    userId: "u1",
    name,
    dosageAmount: "500",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
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
    sortOrder,
    isArchived: false,
    archivedAt: null,
    startedAt: EPOCH,
    endedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
  };
}

function scheduleRow(medicationId: string, overrides: Record<string, unknown>) {
  return {
    id: `sched-${medicationId}`,
    medicationId,
    userId: "u1",
    scheduleKind: "fixed_time",
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    createdAt: EPOCH,
    ...overrides,
  };
}

function doseRow(id: string, medicationId: string, takenAt: string) {
  return {
    id,
    userId: "u1",
    medicationId,
    quantity: 1,
    status: "taken",
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
    notes: null,
    sideEffects: null,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
  };
}

const doseReads = () =>
  fakeDb.attempted.filter((c) => c.op === "select" && c.table === "dose_logs");

beforeEach(() => {
  fakeDb.reset();
  fakeDb.seed(medications, [medicationRow("med-a", "Metformin", 0)]);
  // 11:00 London is 10:00Z today.
  fakeDb.seed(medicationSchedules, [scheduleRow("med-a", { timeOfDay: "11:00" })]);
});

describe("loadDashboard", () => {
  it("reads doses over the window's fetch range, not from today's midnight", async () => {
    await loadDashboard("u1", TZ, NOW);

    const reads = doseReads();
    // The range read, and getLastDosePerMedication's all-time read.
    expect(reads).toHaveLength(2);
    const range = reads.find((c) => predicateIncludes(c.predicate, FETCH_FROM));
    expect(range).toBeDefined();
    expect(predicateIncludes(range!.predicate, FETCH_TO)).toBe(true);
    expect(predicateIncludes(range!.predicate, "u1")).toBe(true);
    // The queue in "threads fetched doses…" below depends on this order.
    expect(reads[0]).toBe(range);
  });

  it("returns the composed payload, with no legacy keys and nothing the page merges", async () => {
    const data = await loadDashboard("u1", TZ, NOW);

    expect(Object.keys(data).sort()).toEqual([
      "done",
      "earlier",
      "later",
      "medications",
      "nextRefreshAt",
      "now",
      "status",
      "timezone",
      "today",
      "todayStart",
    ]);
    expect(data).not.toHaveProperty("timingStatus");
    expect(data.now).toBe(NOW.toISOString());
    expect(data.timezone).toBe(TZ);
    expect(data.todayStart).toBe("2026-04-15T23:00:00.000Z");
    // 11:00 BST (10:00Z) is two and a half hours before NOW.
    expect(data.today.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [["2026-04-16T10:00:00.000Z", "overdue"]],
    ]);
  });

  it("threads fetched doses and last-dose anchors into the composition", async () => {
    fakeDb.seed(medications, [
      medicationRow("med-a", "Metformin", 0),
      medicationRow("med-b", "Amlodipine", 1),
    ]);
    fakeDb.seed(medicationSchedules, [
      scheduleRow("med-a", { timeOfDay: "11:00" }),
      scheduleRow("med-b", { scheduleKind: "interval", intervalHours: "8" }),
    ]);
    // Two dose_logs reads, in loadDashboard's Promise.all order: the range
    // read, then the all-time last-dose read (strings, as the raw SQL returns).
    fakeDb.seedQueue(doseLogs, [
      [
        doseRow("d-a", "med-a", "2026-04-16T10:05:00.000Z"),
        doseRow("d-b", "med-b", "2026-04-16T02:05:00.000Z"),
      ],
      [
        {
          medicationId: "med-a",
          lastTakenAt: "2026-04-16T10:05:00.000Z",
          lastEventAt: "2026-04-16T10:05:00.000Z",
        },
        {
          medicationId: "med-b",
          lastTakenAt: "2026-04-16T02:05:00.000Z",
          lastEventAt: "2026-04-16T02:05:00.000Z",
        },
      ],
    ]);

    const data = await loadDashboard("u1", TZ, NOW);

    // med-a: d-a (10:05Z) is 5m from the 10:00Z slot, so pass 1 resolves it.
    // med-b: the 8h grid anchors on lastTakenAt 02:05Z, giving 02:05 (pass 0
    // gives it d-b), 10:05 (2h25m late) and 18:05 (Later). Without the
    // anchor, the grid would start at local midnight (23:00Z).
    expect(data.today.map((c) => [c.medicationId, c.rows.map((r) => r.expectedTime)])).toEqual([
      ["med-b", ["2026-04-16T10:05:00.000Z"]],
    ]);
    expect(data.done.map((r) => [r.key, r.covers])).toEqual([
      ["d-b", []],
      ["d-a", ["2026-04-16T10:00:00.000Z"]],
    ]);
  });
});
```

- [ ] **Step 18: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-load.test.ts`
Expected: FAIL. The suite cannot load because `../../src/lib/server/dashboard/load` does not exist.

- [ ] **Step 19: Write minimal implementation**

Create `src/lib/server/dashboard/load.ts`:

```ts
import type { DashboardPageData } from "$lib/types";
import { getActiveMedications } from "$lib/server/medications";
import { getDosesInRange, getLastDosePerMedication } from "$lib/server/doses";
import { getSchedulesForUser } from "$lib/server/schedules";
import { dashboardWindow } from "$lib/utils/schedule";
import { composeDashboardPageData } from "./page-data";

/**
 * The dashboard's reads, then its composition. I/O only: every rule lives in
 * `page-data.ts` (pure) and `utils/schedule.ts`.
 *
 * `now` is a parameter so one request uses one instant throughout: the window
 * the doses are fetched over is the window they are matched in. The page load
 * merges `getRefillForecast` in beside this. `logDoseForSlot` does not call
 * it; it recomputes one medication inside its own transaction.
 */
export async function loadDashboard(
  userId: string,
  timezone: string,
  now: Date,
): Promise<Omit<DashboardPageData, "refillForecast">> {
  const window = dashboardWindow(now, timezone);

  // dashboard-load.test.ts queues the two dose_logs reads in this order.
  const [medications, doses, lastDoses, schedulesByMedId] = await Promise.all([
    getActiveMedications(userId),
    getDosesInRange(userId, window.doseFetchFrom, window.doseFetchTo),
    getLastDosePerMedication(userId),
    getSchedulesForUser(userId),
  ]);

  return composeDashboardPageData({
    medications,
    schedulesByMedId,
    doses,
    lastDoses,
    now,
    timezone,
  });
}
```

- [ ] **Step 20: Run test to verify it passes**

Run: `npx vitest run tests/unit/dashboard-load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 21: Prove by mutation** (apply each change on its own, watch the named test fail, then restore it)
  1. Change `getDosesInRange(userId, window.doseFetchFrom, window.doseFetchTo)` to `getDosesInRange(userId, window.todayStart, window.doseFetchTo)`. "reads doses over the window's fetch range, not from today's midnight" fails.
  2. Change `lastDoses,` in the `composeDashboardPageData({...})` call to `lastDoses: [],`. "threads fetched doses and last-dose anchors into the composition" fails, because med-b's grid re-anchors at 23:00Z.

  Restore each change, then run `npx vitest run tests/unit/dashboard-load.test.ts`. Expected: PASS.

- [ ] **Step 22: Record the composition owner in CLAUDE.md**

In `CLAUDE.md`, insert this bullet on its own line directly after the bullet that begins `- **\`src/lib/server/analytics/page-data.ts\` owns the analytics page's composition.\*\*`:

```markdown
- **`src/lib/server/dashboard/page-data.ts` owns the dashboard's composition, and no matching rule.** `composeDashboardPageData` sorts what `utils/schedule.ts` decides (window, projection, passes 0–2, `slotActions`) into Earlier/Today cards, Done, Later, the header status and `nextRefreshAt`; `dashboard/load.ts` is I/O only — four queries, then compose. It adds exactly one rule, a presentational one: a due-now row that shows Log now does not also show Took it at. `projectFixedTimes` is called once per medication here and handed to `slotActions`, because it is the only projection step that touches `Intl`. If a count on the page disagrees with a slot's status, the bug is in this module, not the matcher.
```

- [ ] **Step 23: Full verification**

Run: `npx vitest run && npm run check && npm run lint`
Expected: the whole suite passes, including the untouched `dashboard-timing-status.test.ts`, because the page still uses `getTodaysDoses` until T11. svelte-check reports 0 errors, and eslint reports no errors.

- [ ] **Step 24: Commit**

```bash
git add src/lib/server/dashboard/load.ts tests/unit/dashboard-load.test.ts CLAUDE.md
git commit -m "feat(dashboard): add loadDashboard read path over the dashboard window"
```

---

### Task 8: Slot-checked dose writes and their schemas

**Files:**

- Modify: `src/lib/utils/validation.ts:197-203` (`doseLogSchema` gains `forSlot` and a refine; new `doseSkipSchema` directly below it)
- Modify: `src/lib/server/doses.ts` — line numbers below are from HEAD. T7 inserted `getDosesInRange` after `getTodaysDoses`, which shifts everything after line 61 by roughly 35 lines, so find each block by its function name:
  - `:2` the `drizzle-orm` import
  - `:4` and `:7` (schema import and `utils/time` import; changed in Step 15)
  - after `:15` (new error classes go directly after `MedicationNotFoundError`)
  - `:63-148` (`logDose`, replaced by `DbTransaction` + `insertTakenDose` + the new `logDose`)
  - `:150-172` (`logSkippedDose`)
  - the new `logDoseForSlot` goes after `logSkippedDose`
- Modify: `tests/unit/validation.test.ts:2-9` (import) and insert after `:218` (end of the `doseLogSchema` describe)
- Create: `tests/unit/pg/dose-slot-writes.test.ts`

**Interfaces:**

- Consumes:
  - T2: `dashboardWindow(now: Date, tz: string): DashboardWindow`. Uses `doseFetchFrom` and `doseFetchTo`.
  - T3: `segmentsFor(window: DashboardWindow): Segments`; `projectFixedTimes(schedules: MedicationSchedule[], segments: Segments, tz: string): Date[]`; `interface MatchDose { id: string; takenAt: Date; status: "taken" | "skipped" | "missed"; quantity: number }`
  - T5: `slotActions(input: SlotActionInput): SlotActions`, where `SlotActionInput = { med: Medication; schedules: MedicationSchedule[]; fixedInstants: Date[]; doses: MatchDose[]; lastTakenAt: Date | null; window: DashboardWindow }` and `SlotActions.logNowTarget: string | null` (ISO)
  - T7: `getDosesInRange` already in `doses.ts`, plus `lt` in its drizzle import. Not called here.
- Produces:
  - `export class SlotAlreadyTakenError extends Error {}` (constructor takes an optional message)
  - `export class SlotTargetChangedError extends Error {}` (constructor takes an optional message)
  - `logSkippedDose(userId: string, medicationId: string, takenAt?: Date, opts: { exactInstantGuard?: boolean } = {}): Promise<string>`
  - `logDose(userId, medicationId, quantity, takenAt?, notes?, sideEffects?, opts: { exactInstantGuard?: boolean } = {})` still returns the `dose_logs` row
  - `export async function logDoseForSlot(userId: string, medicationId: string, forSlot: Date, now: Date, timezone: string): Promise<typeof doseLogs.$inferSelect>`
  - `export const doseSkipSchema = z.object({ medicationId: z.string().min(1), takenAt: z.string().datetime().optional() })`
  - `doseLogSchema` gains `forSlot: z.string().datetime().optional()`, refined so `takenAt` and `forSlot` are never both present. Message: "Send takenAt or forSlot, not both", reported on path `forSlot`.

- [ ] **Step 1: Write the failing schema tests**

In `tests/unit/validation.test.ts`, replace the import block at lines 2-9 with:

```ts
import {
  registerSchema,
  loginSchema,
  medicationSchema,
  doseLogSchema,
  doseEditSchema,
  doseSkipSchema,
  settingsSchema,
} from "$lib/utils/validation";
```

Then insert these blocks directly after line 218, which closes `describe("doseLogSchema", …)`:

```ts
describe("doseLogSchema forSlot (Log now)", () => {
  it("accepts a millisecond-exact forSlot on its own and keeps it verbatim", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.forSlot).toBe("2026-04-16T09:00:00.000Z");
  });

  it("rejects takenAt and forSlot together, on the forSlot field the action returns", () => {
    // The dashboard action answers with `fieldErrors` only, so a root-level
    // refine would reach the client as `{}` and a generic toast.
    const result = doseLogSchema.safeParse({
      medicationId: "m1",
      takenAt: "2026-04-16T09:00:00.000Z",
      forSlot: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.forSlot).toEqual([
        "Send takenAt or forSlot, not both",
      ]);
    }
  });

  it("rejects a forSlot with no UTC designator — it names no instant", () => {
    const result = doseLogSchema.safeParse({ medicationId: "m1", forSlot: "2026-04-16T09:00" });
    expect(result.success).toBe(false);
  });

  it("still accepts takenAt on its own (Took it at)", () => {
    const result = doseLogSchema.safeParse({
      medicationId: "m1",
      takenAt: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });
});

describe("doseSkipSchema", () => {
  it("accepts a bare medicationId — skip at now, the legacy door", () => {
    const result = doseSkipSchema.safeParse({ medicationId: "m1" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.takenAt).toBeUndefined();
  });

  it("accepts a millisecond-exact takenAt and keeps it verbatim", () => {
    // Pass 0 and the reserved skip compare instants to the millisecond, so
    // the string must reach the database exactly as the page posted it.
    const result = doseSkipSchema.safeParse({
      medicationId: "m1",
      takenAt: "2026-04-16T09:00:00.000Z",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.takenAt).toBe("2026-04-16T09:00:00.000Z");
  });

  it("rejects a missing medicationId, so the action answers 400 rather than 404", () => {
    // The old action read `String(formData.medicationId)`, which turned a
    // missing field into the id "undefined" and answered 404.
    const result = doseSkipSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.medicationId).toBeDefined();
    }
  });

  it("rejects an empty medicationId", () => {
    expect(doseSkipSchema.safeParse({ medicationId: "" }).success).toBe(false);
  });

  it("rejects a datetime-local takenAt, which names no instant", () => {
    const result = doseSkipSchema.safeParse({ medicationId: "m1", takenAt: "2026-04-16T09:00" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/validation.test.ts`
Expected: FAIL.

- Every `doseSkipSchema` case fails with `TypeError: Cannot read properties of undefined (reading 'safeParse')`.
- Three `forSlot` cases fail because zod strips the unknown `forSlot` key: `expected undefined to be '2026-04-16T09:00:00.000Z'`, and `expected true to be false` twice.
- "still accepts takenAt on its own" passes.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/utils/validation.ts`, replace lines 197-203 (the whole `export const doseLogSchema = z.object({ … });`) with:

```ts
export const doseLogSchema = z
  .object({
    medicationId: z.string().min(1),
    quantity: z.coerce.number().int().min(1).default(1),
    takenAt: z.string().datetime().optional(),
    // Log now: the ISO instant of the row the button sat on. The server
    // re-derives where a dose logged now would land and refuses unless it is
    // still this row (`logDoseForSlot`). Millisecond-exact, like `takenAt`.
    forSlot: z.string().datetime().optional(),
    notes: z.string().max(500).optional(),
    sideEffects: sideEffectsField,
  })
  // Two different writes: `takenAt` records the slot's own instant, `forSlot`
  // records now against a proven slot. Both at once is a client bug, not a
  // choice. The path puts the message in `fieldErrors`, which is all the
  // dashboard action returns.
  .refine((d) => !(d.takenAt && d.forSlot), {
    message: "Send takenAt or forSlot, not both",
    path: ["forSlot"],
  });

/**
 * The dashboard's Skip. `takenAt` is the row's `skipAt` — the slot's own
 * instant for a past slot, now for a due-now slot still ahead — posted
 * verbatim. Absent, the skip is recorded at now (the legacy door).
 */
export const doseSkipSchema = z.object({
  medicationId: z.string().min(1),
  takenAt: z.string().datetime().optional(),
});
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/validation.test.ts`
Expected: PASS. The earlier `doseLogSchema` and `sideEffects` cases stay green, because zod 4's `.refine` on an object still returns a `ZodObject`.

- [ ] **Step 5: Prove the refine by mutation**

1. Delete the `.refine((d) => !(d.takenAt && d.forSlot), { … })` call, keeping the `z.object({ … })` and ending it with `;`.
2. Run `npx vitest run tests/unit/validation.test.ts -t "rejects takenAt and forSlot together"`. It must FAIL with `expected true to be false`.
3. Restore the refine and re-run. It must pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/validation.ts tests/unit/validation.test.ts
git commit -m "feat(validation): add doseSkipSchema and a forSlot field to doseLogSchema"
```

- [ ] **Step 7: Write the failing PGlite tests for the exact-instant guard**

Create `tests/unit/pg/dose-slot-writes.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The dashboard's slot-anchored writes: "Took it at HH:MM", Skip and Log now.
 *
 * Each outcome is decided by the database. "Took it at" and Skip look up
 * what the slot's exact instant already holds, under a row lock, so a double
 * tap writes (and decrements) once. Log now re-derives its target from rows
 * read inside its own transaction. `fake-db` answers every read from its seed
 * and never evaluates a predicate, so it cannot tell a dedupe from an insert.
 * These tests belong on PGlite (CLAUDE.md, test-seam rule).
 *
 * What PGlite cannot show is the `FOR UPDATE` itself. It is one backend and
 * serialises transactions with its own mutex, so "concurrent" calls here run
 * one after the other with or without the lock. The concurrency case below
 * proves our part: the second call reads the first call's dose inside its
 * transaction and refuses. It does not prove the lock that makes the two
 * calls serialise on Neon.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { logDose, logSkippedDose, MedicationNotFoundError, SlotAlreadyTakenError } =
  await import("../../../src/lib/server/doses");

/** The frozen moment of the tap. `loggedAt` reads it. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** A slot instant, millisecond-exact, as the page posts it. */
const SLOT = new Date("2026-04-16T09:00:00.000Z");
/**
 * Before every window in this file. Required: the database defaults
 * `startedAt` and `effectiveFrom` to Postgres `now()`, which is the REAL
 * clock, not the faked one. Left to default, the lifecycle and
 * schedule-edit clips would drop every slot in this file.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
const GUARD = { exactInstantGuard: true } as const;

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
}

async function rows() {
  return pgDb.db
    .select({
      id: doseLogs.id,
      status: doseLogs.status,
      quantity: doseLogs.quantity,
      inventoryApplied: doseLogs.inventoryApplied,
      takenAt: doseLogs.takenAt,
      loggedAt: doseLogs.loggedAt,
    })
    .from(doseLogs)
    .where(eq(doseLogs.medicationId, "m1"))
    .orderBy(asc(doseLogs.takenAt), asc(doseLogs.id));
}

async function ledger() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .orderBy(asc(inventoryEvents.createdAt));
}

async function seedTrackedMed(overrides: Partial<typeof medications.$inferInsert> = {}) {
  await pgDb.seedMedication({
    id: "m1",
    name: "Metformin",
    inventoryCount: 10,
    startedAt: LONG_AGO,
    ...overrides,
  });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Took it at — logDose with the exact-instant guard", () => {
  it("writes one taken row and decrements once for two posts at one slot", async () => {
    await seedTrackedMed();
    const first = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);
    const second = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(second.id).toBe(first.id);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("stores the slot's instant as takenAt and the tap as loggedAt", async () => {
    await seedTrackedMed();
    const dose = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(dose.takenAt).toEqual(SLOT);
    expect(dose.loggedAt).toEqual(TAP);
    expect(dose.inventoryApplied).toBe(1);
  });

  it("matches to the millisecond — a taken dose 1ms away is a different dose", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);
    await logDose("u1", "m1", 1, new Date(SLOT.getTime() + 1), undefined, undefined, GUARD);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });

  it("inserts over a skip at the same instant — taken beats skip", async () => {
    await seedTrackedMed();
    await pgDb.seedDose({
      id: "skip-0900",
      medicationId: "m1",
      status: "skipped",
      quantity: 1,
      takenAt: SLOT,
    });

    const dose = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(dose.id).not.toBe("skip-0900");
    expect((await rows()).map((r) => r.status).sort()).toEqual(["skipped", "taken"]);
    expect(await stock()).toBe(9);
  });

  it("control: without the guard a repeated post still inserts — no existing caller changes", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT);
    await logDose("u1", "m1", 1, SLOT);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });
});

describe("Skip — logSkippedDose with the exact-instant guard", () => {
  it("writes one skip and returns its id for two posts at one slot", async () => {
    await seedTrackedMed();
    const first = await logSkippedDose("u1", "m1", SLOT, GUARD);
    const second = await logSkippedDose("u1", "m1", SLOT, GUARD);

    expect(second).toBe(first);
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first, status: "skipped", quantity: 1 });
    // A skip never touches inventory.
    expect(await stock()).toBe(10);
  });

  it("stores the slot's instant as takenAt and the tap as loggedAt", async () => {
    await seedTrackedMed();
    await logSkippedDose("u1", "m1", SLOT, GUARD);

    const [row] = await rows();
    expect(row.takenAt).toEqual(SLOT);
    expect(row.loggedAt).toEqual(TAP);
  });

  it("refuses to skip an instant that already holds a taken dose", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    await expect(logSkippedDose("u1", "m1", SLOT, GUARD)).rejects.toBeInstanceOf(
      SlotAlreadyTakenError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
  });

  it("still skips at now when no instant is given — the /api/v1 and legacy door", async () => {
    await seedTrackedMed();
    const id = await logSkippedDose("u1", "m1");

    const [row] = await rows();
    expect(row).toMatchObject({ id, status: "skipped" });
    expect(row.takenAt).toEqual(TAP);
  });

  it("is MedicationNotFoundError for another user's medication under the guard", async () => {
    await seedTrackedMed();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });

    await expect(logSkippedDose("u1", "m2", SLOT, GUARD)).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });
});
```

- [ ] **Step 8: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts`
Expected: FAIL, with 4 failures:

- "writes one taken row and decrements once…" fails because the extra `opts` argument is ignored: `expected 'd…' to be 'd…'`, then 2 rows and stock 8.
- "writes one skip and returns its id…" fails because `logSkippedDose` ignores `takenAt`/`opts` and writes two skips at TAP.
- "stores the slot's instant…" (Skip) fails with `takenAt` = TAP, not SLOT.
- "refuses to skip…" fails with `promise resolved "…" instead of rejecting`.

The millisecond, over-a-skip, control and not-found cases already pass. They pin behaviour for the mutations in Step 11.

- [ ] **Step 9: Write the minimal implementation (error classes, shared insert, both guards)**

In `src/lib/server/doses.ts`, replace the `drizzle-orm` import on line 2 with the line below. `lt` came with T7; `max` was already imported.

```ts
import { eq, and, gte, lt, asc, desc, sql, isNotNull, max } from "drizzle-orm";
```

Insert these classes directly after the `MedicationNotFoundError` class (after HEAD line 15):

```ts
/**
 * A skip was asked for at an instant that already holds a TAKEN dose.
 *
 * Only the guarded skip throws it — the dashboard's Skip, which posts the
 * slot's own instant. Taken beats skip in the matcher, so a skip written
 * there would record a decision the page could never show. The honest
 * answer is "refresh, it's already logged".
 */
export class SlotAlreadyTakenError extends Error {
  constructor(message = "A taken dose already exists at this instant") {
    super(message);
    this.name = "SlotAlreadyTakenError";
  }
}

/**
 * Log now was posted for a row that is no longer where a dose logged now
 * would land. Causes: render-to-tap drift, a page left open across
 * midnight, the 12h expiry, a double tap, a second device.
 * `logDoseForSlot` throws it and writes nothing.
 */
export class SlotTargetChangedError extends Error {
  constructor(message = "The Log-now target has changed") {
    super(message);
    this.name = "SlotTargetChangedError";
  }
}
```

Replace the whole `export async function logDose(…) { … }` (HEAD lines 63-148) with:

```ts
type DbTransaction = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];

/**
 * The one taken-dose write: the row, the stock decrement, the inventory
 * event and the audit entry, all inside the caller's transaction.
 *
 * `logDose` and `logDoseForSlot` both end here, so a Log-now dose and a chip
 * dose cannot drift apart on `inventoryApplied`, the column `deleteDose`
 * restores from. `previousCount` is the caller's own read of
 * `medications.inventoryCount`, taken inside the same transaction before
 * this insert. The caller decides whether that read locks.
 */
async function insertTakenDose(
  tx: DbTransaction,
  input: {
    userId: string;
    medicationId: string;
    quantity: number;
    takenAt: Date;
    loggedAt: Date;
    notes: string | null;
    sideEffects: SideEffect[] | null;
    previousCount: number | null;
  },
) {
  const { userId, medicationId, quantity, previousCount } = input;
  const id = createId();

  // What will really leave the bottle. `GREATEST(0, …)` cannot take more
  // than there is, so a dose of 3 logged against a stock of 1 removes 1 —
  // and a delete that gave back 3 would invent the other two.
  const inventoryApplied =
    previousCount === null ? 0 : previousCount - Math.max(0, previousCount - quantity);

  const [inserted] = await tx
    .insert(doseLogs)
    .values({
      id,
      userId,
      medicationId,
      quantity,
      inventoryApplied,
      takenAt: input.takenAt,
      loggedAt: input.loggedAt,
      notes: input.notes,
      sideEffects: input.sideEffects,
      status: "taken",
    })
    .returning();

  await tx
    .update(medications)
    .set({
      inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${quantity})`,
    })
    .where(
      and(
        eq(medications.id, medicationId),
        eq(medications.userId, userId),
        isNotNull(medications.inventoryCount),
      ),
    );

  // Only record an event when inventory was actually tracked.
  // The actual delta accounts for the GREATEST(0, ...) clamp.
  if (previousCount !== null) {
    await recordInventoryEvent(tx, {
      userId,
      medicationId,
      eventType: "dose_taken",
      quantityChange: -inventoryApplied,
      previousCount,
      newCount: previousCount - inventoryApplied,
    });
  }

  await logAudit(userId, "dose_log", id, "create", undefined, tx);

  return inserted;
}

export async function logDose(
  userId: string,
  medicationId: string,
  quantity: number,
  takenAt?: Date,
  notes?: string,
  sideEffects?: SideEffect[],
  opts: { exactInstantGuard?: boolean } = {},
) {
  await assertMedicationBelongsToUser(userId, medicationId);
  const now = new Date();
  const at = takenAt ?? now;
  const guard = opts.exactInstantGuard === true;

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  const dose = await dbTx.transaction(async (tx) => {
    // Snapshot the count BEFORE anything else. It is needed in two places:
    // the inventory event records both ends of the change, and the dose row
    // stores how much it ACTUALLY removed — which is not `quantity` whenever
    // the clamp engages.
    const medRead = tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1);
    // Under the guard the read LOCKS. Two "Took it at 09:00" posts for one
    // medication serialise here, so the second one's lookup below sees the
    // first one's row instead of both inserting. Unguarded callers (the
    // chips, `/api/v1`) keep the plain read. So does
    // `tests/unit/doses-inventory.test.ts`, whose fake-db has no select
    // `.for()` and must not grow one (CLAUDE.md, test-seam rule).
    const [med] = guard ? await medRead.for("update") : await medRead;
    const previousCount = med?.inventoryCount ?? null;

    if (guard) {
      // "Took it at" names the slot's own instant to the millisecond, and a
      // taken row already there IS this dose. Return it, with no second row
      // and no second decrement. A SKIP there does not count: taken beats
      // skip, and pass 0 then gives the slot to the taken dose.
      const [existing] = await tx
        .select()
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
            eq(doseLogs.status, "taken"),
          ),
        )
        .orderBy(asc(doseLogs.id))
        .limit(1);
      if (existing) return existing;
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity,
      takenAt: at,
      loggedAt: now,
      notes: notes ?? null,
      sideEffects: sideEffects ?? null,
      previousCount,
    });
  });

  return dose;
}
```

Replace the whole `export async function logSkippedDose(…) { … }` (HEAD lines 150-172) with:

```ts
export async function logSkippedDose(
  userId: string,
  medicationId: string,
  takenAt?: Date,
  opts: { exactInstantGuard?: boolean } = {},
): Promise<string> {
  await assertMedicationBelongsToUser(userId, medicationId);
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  return dbTx.transaction(async (tx) => {
    if (opts.exactInstantGuard) {
      // The dashboard's Skip posts the slot's own instant. Lock the
      // medication so two Skip taps, or a Skip racing "Took it at" on another
      // device, serialise. Then look at what that instant already holds.
      const [locked] = await tx
        .select({ id: medications.id })
        .from(medications)
        .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
        .limit(1)
        .for("update");
      if (!locked) throw new MedicationNotFoundError(medicationId);

      const atInstant = await tx
        .select({ id: doseLogs.id, status: doseLogs.status })
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
          ),
        )
        .orderBy(asc(doseLogs.id));

      // Taken beats skip: a skip written here could never show.
      if (atInstant.some((d) => d.status === "taken")) {
        throw new SlotAlreadyTakenError(
          `Medication ${medicationId} already has a taken dose at ${at.toISOString()}`,
        );
      }
      // A second Skip for the same slot is the first one.
      const existingSkip = atInstant.find((d) => d.status === "skipped");
      if (existingSkip) return existingSkip.id;
    }

    const id = createId();
    await tx.insert(doseLogs).values({
      id,
      userId,
      medicationId,
      quantity: 1,
      takenAt: at,
      loggedAt: now,
      notes: null,
      sideEffects: null,
      status: "skipped",
    });
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
    return id;
  });
}
```

- [ ] **Step 10: Run the new test and the regression suites**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts tests/unit/doses-inventory.test.ts tests/unit/pg/dose-inventory-symmetry.test.ts tests/unit/pg/low-inventory-episode.test.ts tests/unit/pg/dose-edit-round-trip.test.ts tests/unit/api/commands.test.ts`
Expected: PASS.

- `doses-inventory.test.ts` (fake-db) proves the unguarded path still makes the same calls in the same order, with no `.for()`.
- The two PGlite inventory suites prove `insertTakenDose` kept the clamp and `inventoryApplied`.

- [ ] **Step 11: Prove each guard by mutation** (restore each change and re-run before the next)

1. In `logDose`, delete `if (existing) return existing;`. Then `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "decrements once"` must FAIL: the ids differ, there are 2 rows and stock is 8.
2. In `logDose`'s guard query, delete the line `eq(doseLogs.status, "taken"),`. Then `-t "taken beats skip"` must FAIL, because the returned id is `skip-0900`.
3. In `logSkippedDose`, delete `if (existingSkip) return existingSkip.id;`. Then `-t "writes one skip"` must FAIL with 2 rows.
4. In `logSkippedDose`, delete the `if (atInstant.some(…)) { throw … }` block. Then `-t "refuses to skip"` must FAIL, because the promise resolved.

- [ ] **Step 12: Commit**

```bash
git add src/lib/server/doses.ts tests/unit/pg/dose-slot-writes.test.ts
git commit -m "feat(doses): deduplicate Took it at and Skip on the slot's exact instant"
```

- [ ] **Step 13: Write the failing Log-now tests**

In `tests/unit/pg/dose-slot-writes.test.ts`, replace the `const { … } = await import("../../../src/lib/server/doses");` statement with:

```ts
const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} = await import("../../../src/lib/server/doses");
```

Append this block at the end of the file:

```ts
describe("Log now — logDoseForSlot", () => {
  const AT_0810 = new Date("2026-04-16T08:10:00.000Z");
  const SLOT_0800 = new Date("2026-04-16T08:00:00.000Z");

  async function seedDaily0800() {
    await seedTrackedMed();
    await pgDb.seedSchedule({
      medicationId: "m1",
      scheduleKind: "fixed_time",
      timeOfDay: "08:00",
      effectiveFrom: LONG_AGO,
    });
  }

  it("writes one taken dose at now, with logDose's stock bookkeeping", async () => {
    await seedDaily0800();

    const row = await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(row).toMatchObject({
      medicationId: "m1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });
    expect(row.takenAt).toEqual(AT_0810);
    expect(row.loggedAt).toEqual(AT_0810);
    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 10, newCount: 9 },
    ]);
  });

  it("refuses a forSlot a dose logged now would not resolve, and writes nothing", async () => {
    await seedDaily0800();

    await expect(
      logDoseForSlot("u1", "m1", new Date("2026-04-16T09:00:00.000Z"), AT_0810, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
    expect(await stock()).toBe(10);
  });

  describe("render-to-tap drift (fixed 14:00 and 20:00)", () => {
    const SLOT_1400 = new Date("2026-04-16T14:00:00.000Z");

    async function seedTwoSlots() {
      await seedTrackedMed();
      await pgDb.seedSchedule({ timeOfDay: "14:00", effectiveFrom: LONG_AGO, sortOrder: 0 });
      await pgDb.seedSchedule({ timeOfDay: "20:00", effectiveFrom: LONG_AGO, sortOrder: 1 });
    }

    it("accepts 14:00 at 18:50, when a dose logged now would count for it", async () => {
      // 20:00 is 70 minutes ahead, beyond pass 1's hour, so pass 2 walks
      // back to 14:00.
      await seedTwoSlots();

      const row = await logDoseForSlot(
        "u1",
        "m1",
        SLOT_1400,
        new Date("2026-04-16T18:50:00.000Z"),
        "UTC",
      );

      expect(row.status).toBe("taken");
    });

    it("refuses the same 14:00 at 19:05, once 20:00 is within the hour", async () => {
      // Pass 1 now gives a dose logged at 19:05 to 20:00, so the page's
      // 14:00 button is stale.
      await seedTwoSlots();

      await expect(
        logDoseForSlot("u1", "m1", SLOT_1400, new Date("2026-04-16T19:05:00.000Z"), "UTC"),
      ).rejects.toBeInstanceOf(SlotTargetChangedError);
      expect(await rows()).toEqual([]);
    });
  });

  it("two concurrent posts for one medication write one dose; the other is told the target changed", async () => {
    await seedDaily0800();

    const results = await Promise.allSettled([
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it("is MedicationNotFoundError for an unknown medication or another user's", async () => {
    await seedDaily0800();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await pgDb.seedSchedule({
      medicationId: "m2",
      userId: "u2",
      timeOfDay: "08:00",
      effectiveFrom: LONG_AGO,
    });

    await expect(logDoseForSlot("u1", "nope", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
    await expect(logDoseForSlot("u1", "m2", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("finds no target on an archived medication — the load never lists one", async () => {
    await seedTrackedMed({ isArchived: true });
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });

    await expect(logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect(await rows()).toEqual([]);
  });
});
```

- [ ] **Step 14: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "logDoseForSlot"`
Expected: FAIL. Every Log-now case fails with `TypeError: logDoseForSlot is not a function`.

- [ ] **Step 15: Write the minimal implementation**

In `src/lib/server/doses.ts`, replace the schema import (HEAD line 4) with:

```ts
import { doseLogs, medications, medicationSchedules, syncTombstones } from "$lib/server/db/schema";
```

Add this import directly below `import { startOfDay } from "$lib/utils/time";` (HEAD line 7):

```ts
import { dashboardWindow, projectFixedTimes, segmentsFor, slotActions } from "$lib/utils/schedule";
```

Insert this function directly after `logSkippedDose`:

```ts
/**
 * Log now's write.
 *
 * The page rendered Log now on the row a dose logged at render time would
 * resolve. By the time the tap arrives, that can be a different row: a slot
 * came within the hour, midnight passed, the 12h expiry hid the row, or
 * another device logged. So the server re-derives the target with the SAME
 * pure functions the load used (`dashboardWindow`, `projectFixedTimes`,
 * `slotActions`), from rows read inside this transaction, and writes only
 * if the target is still `forSlot`.
 *
 * The medication row is locked first, so two Log-now posts for one
 * medication serialise. The second reads the first one's dose, finds the
 * one-hour cooldown active and throws SlotTargetChangedError instead of
 * writing a second dose. PGlite is one backend and serialises transactions
 * itself, so that lock is unexercisable in the suite.
 * `tests/unit/pg/dose-slot-writes.test.ts` proves the recompute reads inside
 * the transaction.
 *
 * Always ×1. A larger dose could resolve rows the simulation never proved,
 * and Log now's contract is "this row".
 */
export async function logDoseForSlot(
  userId: string,
  medicationId: string,
  forSlot: Date,
  now: Date,
  timezone: string,
): Promise<typeof doseLogs.$inferSelect> {
  const window = dashboardWindow(now, timezone);

  return dbTx.transaction(async (tx) => {
    const [med] = await tx
      .select()
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);

    // The load lists active medications only (`getActiveMedications`), so an
    // archived one has no Log-now target there and must have none here.
    if (med.isArchived) {
      throw new SlotTargetChangedError(`Medication ${medicationId} is archived`);
    }

    const schedules = await tx
      .select()
      .from(medicationSchedules)
      .where(
        and(
          eq(medicationSchedules.medicationId, medicationId),
          eq(medicationSchedules.userId, userId),
        ),
      )
      .orderBy(asc(medicationSchedules.sortOrder));

    // The load's bounds, so pass 1 reaches as far either side of the window
    // here as it did when the button was drawn.
    const doses = await tx
      .select({
        id: doseLogs.id,
        takenAt: doseLogs.takenAt,
        status: doseLogs.status,
        quantity: doseLogs.quantity,
      })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, medicationId),
          gte(doseLogs.takenAt, window.doseFetchFrom),
          lt(doseLogs.takenAt, window.doseFetchTo),
        ),
      );

    // All-time and taken-only: `getLastDosePerMedication`'s `lastTakenAt`,
    // the anchor the load projects interval rows from.
    const [last] = await tx
      .select({ at: max(doseLogs.takenAt) })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, medicationId),
          eq(doseLogs.status, "taken"),
        ),
      );

    const fixedInstants = projectFixedTimes(schedules, segmentsFor(window), timezone);
    const { logNowTarget } = slotActions({
      med,
      schedules,
      fixedInstants,
      doses,
      lastTakenAt: last?.at ?? null,
      window,
    });

    if (logNowTarget !== forSlot.toISOString()) {
      throw new SlotTargetChangedError(
        `Log-now target for ${medicationId} is ${logNowTarget ?? "none"}, not ${forSlot.toISOString()}`,
      );
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity: 1,
      takenAt: now,
      loggedAt: now,
      notes: null,
      sideEffects: null,
      previousCount: med.inventoryCount,
    });
  });
}
```

- [ ] **Step 16: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/pg/dose-slot-writes.test.ts`
Expected: PASS, all three describe blocks.

- [ ] **Step 17: Prove the recompute by mutation** (restore after each)

1. Delete the whole `if (logNowTarget !== forSlot.toISOString()) { throw … }` block. Then `npx vitest run tests/unit/pg/dose-slot-writes.test.ts -t "logDoseForSlot"` must FAIL in three cases:
   - "refuses a forSlot…": a row is written.
   - "refuses the same 14:00 at 19:05": the promise resolved.
   - "two concurrent posts…": 2 fulfilled, 2 rows, stock 8.
2. Delete the `if (med.isArchived) { … }` block. Then `-t "archived"` must FAIL, because the promise resolved.
3. Move the `doses` select out of the transaction onto `db`, above `dbTx.transaction(`, with `window` hoisted accordingly. Then `-t "concurrent"` must FAIL with 2 rows, because both calls read before either wrote. Restore.

- [ ] **Step 18: Type-check and lint**

Run: `npm run check && npm run lint`
Expected: 0 errors. Lint warnings, if any, must not be new ones in the touched files.

- [ ] **Step 19: Commit**

```bash
git add src/lib/server/doses.ts tests/unit/pg/dose-slot-writes.test.ts
git commit -m "feat(doses): add logDoseForSlot, which re-derives the Log-now target under a row lock"
```

---

### Task 9: Dashboard log and skip actions

**Files:**

- Modify: `src/routes/(app)/dashboard/+page.server.ts:5-16` (imports), insert before `:102` (`export const actions`), `:103-146` (`logDose` action), `:177-192` (`skipDose` action). The `load` (`:22-100`) is NOT touched in this task.
- Modify (full rewrite): `tests/unit/dashboard-dose-actions.test.ts:1-89`
- Modify: `tests/unit/app-action-auth-guard.test.ts:56-64` (the `$lib/server/doses` mock factory)

**Interfaces:**

- Consumes:
  - T2: `checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null` and `type SlotActionTimeProblem = "future" | "stale"`, both from `$lib/utils/schedule`.
  - T8 (`$lib/server/doses`):
    - `logDose(userId, medicationId, quantity, takenAt?, notes?, sideEffects?, opts: { exactInstantGuard?: boolean } = {})`
    - `logSkippedDose(userId: string, medicationId: string, takenAt?: Date, opts: { exactInstantGuard?: boolean } = {}): Promise<string>`
    - `logDoseForSlot(userId: string, medicationId: string, forSlot: Date, now: Date, timezone: string): Promise<typeof doseLogs.$inferSelect>`
    - `MedicationNotFoundError`, `SlotAlreadyTakenError`, `SlotTargetChangedError`
  - T8 (`$lib/utils/validation`): `doseLogSchema` (with `forSlot`) and `doseSkipSchema`.
- Produces (T10's `DoseActionForm` reads these):
  - `?/logDose` and `?/skipDose` return `{ success: true, doseId: string }`.
  - Failures:
    - 400 `{ errors: { <field>: string[] } }`
    - 400 `{ errors: { takenAt: ["That time hasn't happened yet."] } }`
    - 409 `{ errors: { form: ["This dose has moved off your dashboard. Refresh to see what's due now."] } }`
    - 409 `{ errors: { form: ["What's due has changed. Refresh to see what's due now."] } }`
    - 409 `{ errors: { form: ["This dose is already logged as taken. Refresh to see it."] } }`
    - 404 `{ errors: { form: ["Medication not found"] } }` (logDose)
    - 404 `{ error: "Medication not found" }` (skipDose)

  Every one of these shapes is read by `actionErrorMessage`.

- [ ] **Step 1: Write the failing action tests**

Replace the whole of `tests/unit/dashboard-dose-actions.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { actionErrorMessage } from "$lib/utils/form-errors";

// Verifies the dashboard's dose mutations don't report success when the
// underlying row no longer exists (deleted in another tab or via native
// -app sync). deleteDose() returns false and updateDose() returns null
// in that case — the actions must surface a failure, not `success`.
//
// The log and skip actions follow the spec's action flow
// (docs/superpowers/specs/2026-09-24-dashboard-due-now-design.md, "Action
// flow"). The 401 guard is covered by app-action-auth-guard.test.ts, and
// what the writes do to the database by pg/dose-slot-writes.test.ts. This
// file pins what is left: routing, the clock and the error mapping.
const state = {
  deleteResult: true as boolean,
  updateResult: { id: "d1" } as object | null,
};

const deleteDose = vi.fn(async () => state.deleteResult);
const updateDose = vi.fn(async () => state.updateResult);
// The writes return what production returns — a row for the two taken
// writes, an id string for a skip. Each has a distinct id, so the `doseId`
// in a result names the write that produced it.
const logDose = vi.fn(async (..._args: unknown[]) => ({ id: "dose-logged" }));
const logDoseForSlot = vi.fn(async (..._args: unknown[]) => ({ id: "dose-log-now" }));
const logSkippedDose = vi.fn(async (..._args: unknown[]) => "dose-skipped");

// Declared here, not inline in the factory, so a test can throw the very
// constructor the action checks with `instanceof`. The factory runs at the
// dynamic import below, after these exist.
class MedicationNotFoundError extends Error {}
class SlotAlreadyTakenError extends Error {}
class SlotTargetChangedError extends Error {}

vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }));
vi.mock("$lib/server/medications", () => ({ getActiveMedications: async () => [] }));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: async () => [] }));
vi.mock("$lib/server/schedules", () => ({ getSchedulesForUser: async () => new Map() }));
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: async () => [],
  getDosesInRange: async () => [],
  getLastDosePerMedication: async () => [],
  logDose: (...args: unknown[]) => logDose(...args),
  logDoseForSlot: (...args: unknown[]) => logDoseForSlot(...args),
  logSkippedDose: (...args: unknown[]) => logSkippedDose(...args),
  deleteDose: (...args: unknown[]) => deleteDose(...(args as [])),
  updateDose: (...args: unknown[]) => updateDose(...(args as [])),
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
}));

const { actions } = await import("../../src/routes/(app)/dashboard/+page.server");

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } };

/**
 * 19:05 UTC on 16 April. In UTC, `visibleStart` at this instant is today's
 * midnight (19:05 − 12h is already today). So anything before 00:00 on the
 * 16th is stale, and anything after 19:05 is in the future.
 */
const NOW = new Date("2026-04-16T19:05:00.000Z");

const logDoseAction = (fields: Record<string, string>) =>
  actions.logDose({ request: formRequest(fields), locals } as never);
const skipDoseAction = (fields: Record<string, string>) =>
  actions.skipDose({ request: formRequest(fields), locals } as never);

/** What the page will toast. The client reads every failure through actionErrorMessage. */
function toastFor(res: unknown): string {
  const { status, data } = res as { status: number; data: Record<string, unknown> };
  return actionErrorMessage({ type: "failure", status, data });
}

beforeEach(() => {
  state.deleteResult = true;
  state.updateResult = { id: "d1" };
  deleteDose.mockClear();
  updateDose.mockClear();
  logDose.mockClear();
  logDoseForSlot.mockClear();
  logSkippedDose.mockClear();
  // Date only: each action reads `new Date()` once per request.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("dashboard deleteDose action", () => {
  it("returns 404 when the dose no longer exists instead of success", async () => {
    state.deleteResult = false;
    const res = await actions.deleteDose({
      request: formRequest({ doseId: "gone" }),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
  });

  it("returns success when the dose was actually deleted", async () => {
    const res = await actions.deleteDose({
      request: formRequest({ doseId: "d1" }),
      locals,
    } as never);
    expect(res).toEqual({ success: true });
  });
});

describe("dashboard editDose action", () => {
  const validEdit = {
    doseId: "d1",
    takenAt: "2026-08-04T10:00",
    quantity: "2",
    sideEffects: "[]",
  };

  it("returns 404 when the dose no longer exists instead of success", async () => {
    state.updateResult = null;
    const res = await actions.editDose({
      request: formRequest(validEdit),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
  });

  it("returns success when the dose was actually updated", async () => {
    const res = await actions.editDose({
      request: formRequest(validEdit),
      locals,
    } as never);
    expect(res).toEqual({ success: true });
  });
});

describe("dashboard logDose action", () => {
  it("routes forSlot to logDoseForSlot with the request's clock and the user's zone", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-log-now" });
    expect(logDoseForSlot).toHaveBeenCalledWith(
      "u1",
      "m1",
      new Date("2026-04-16T14:00:00.000Z"),
      NOW,
      "UTC",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("answers 409 when the Log-now target moved between render and tap (14:00 drawn at 18:50, posted at 19:05)", async () => {
    // At 18:50 a dose logged now counted for 14:00. At 19:05 the 20:00 slot
    // is within the hour and takes it. The recompute is logDoseForSlot's
    // (proven on PGlite in pg/dose-slot-writes.test.ts); this test pins what
    // the action does with the refusal.
    logDoseForSlot.mockRejectedValueOnce(new SlotTargetChangedError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("What's due has changed. Refresh to see what's due now.");
  });

  it("keeps the existing 404 shape when Log now's medication is gone", async () => {
    logDoseForSlot.mockRejectedValueOnce(new MedicationNotFoundError());

    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
  });

  it("writes Took it at through logDose with the exact-instant guard", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith(
      "u1",
      "m1",
      1,
      new Date("2026-04-16T14:00:00.000Z"),
      undefined,
      undefined,
      { exactInstantGuard: true },
    );
  });

  it("refuses a takenAt after now with a 400 on the field, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T19:05:00.001Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("That time hasn't happened yet.");
    expect(logDose).not.toHaveBeenCalled();
  });

  it("refuses a takenAt the dashboard no longer shows with a 409, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-15T23:59:59.999Z",
    });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe(
      "This dose has moved off your dashboard. Refresh to see what's due now.",
    );
    expect(logDose).not.toHaveBeenCalled();
  });

  it("rejects takenAt and forSlot together with a 400, writing nothing", async () => {
    const res = await logDoseAction({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-04-16T14:00:00.000Z",
      forSlot: "2026-04-16T14:00:00.000Z",
    });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("Send takenAt or forSlot, not both");
    expect(logDose).not.toHaveBeenCalled();
    expect(logDoseForSlot).not.toHaveBeenCalled();
  });

  it("logs a chip dose exactly as before when neither is sent", async () => {
    const res = await logDoseAction({ medicationId: "m1", quantity: "2" });

    expect(res).toEqual({ success: true, doseId: "dose-logged" });
    expect(logDose).toHaveBeenCalledWith("u1", "m1", 2, undefined, undefined, undefined);
  });
});

describe("dashboard skipDose action", () => {
  it("answers 400, not 404, when medicationId is missing", async () => {
    const res = await skipDoseAction({});

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("skips at now through the legacy door when no takenAt is sent", async () => {
    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1");
  });

  it("skips the row's own instant with the exact-instant guard", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toEqual({ success: true, doseId: "dose-skipped" });
    expect(logSkippedDose).toHaveBeenCalledWith("u1", "m1", new Date("2026-04-16T14:00:00.000Z"), {
      exactInstantGuard: true,
    });
  });

  it("refuses a takenAt after now with a 400 on the field", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T19:05:00.001Z" });

    expect(res).toMatchObject({ status: 400 });
    expect(toastFor(res)).toBe("That time hasn't happened yet.");
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("refuses a stale takenAt with a 409", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-15T23:59:59.999Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe(
      "This dose has moved off your dashboard. Refresh to see what's due now.",
    );
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("rejects a takenAt that is not an ISO instant", async () => {
    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00" });

    expect(res).toMatchObject({ status: 400 });
    expect(logSkippedDose).not.toHaveBeenCalled();
  });

  it("answers 409 when the instant already holds a taken dose", async () => {
    logSkippedDose.mockRejectedValueOnce(new SlotAlreadyTakenError());

    const res = await skipDoseAction({ medicationId: "m1", takenAt: "2026-04-16T14:00:00.000Z" });

    expect(res).toMatchObject({ status: 409 });
    expect(toastFor(res)).toBe("This dose is already logged as taken. Refresh to see it.");
  });

  it("keeps the existing 404 shape for a medication that is gone", async () => {
    logSkippedDose.mockRejectedValueOnce(new MedicationNotFoundError());

    const res = await skipDoseAction({ medicationId: "m1" });

    expect(res).toMatchObject({ status: 404, data: { error: "Medication not found" } });
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts`
Expected: FAIL.

- The four original deleteDose/editDose cases pass.
- "rejects takenAt and forSlot together" passes, because T8's schema already refuses it.
- The skip "existing 404 shape" case passes.
- Every other new case fails, for example:
  - `expected { success: true } to deeply equal { success: true, doseId: 'dose-log-now' }`
  - `logDoseForSlot` never called
  - `expected { success: true } to match object { status: 400 }`

- [ ] **Step 3: Update the imports and add the refusal helper**

In `src/routes/(app)/dashboard/+page.server.ts`, replace lines 5-16. That is the `$lib/server/doses` import, the validation import, the `$lib/utils/time` import and the `$lib/utils/schedule` import. Use:

```ts
import {
  getTodaysDoses,
  getLastDosePerMedication,
  logDose,
  logDoseForSlot,
  logSkippedDose,
  deleteDose,
  updateDose,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema, doseSkipSchema } from "$lib/utils/validation";
import { resolveEditedInstant, startOfDay, endOfDay, computeTimingStatus } from "$lib/utils/time";
import {
  computeScheduleSlots,
  timingStatusFromSlots,
  checkSlotActionTime,
  type SlotActionTimeProblem,
} from "$lib/utils/schedule";
```

Then insert this block between the end of `load` (line 100, `};`) and `export const actions: Actions = {` (line 102):

```ts
// The refusals a dashboard dose write can meet. Each is a shape
// `actionErrorMessage` already reads (`errors.form` / `errors.takenAt`), so
// the client needs no new branch. 409 means "your page is stale": the client
// re-runs the load before it lets the user try again.
const TAKEN_AT_IN_FUTURE = "That time hasn't happened yet.";
const SLOT_OFF_DASHBOARD = "This dose has moved off your dashboard. Refresh to see what's due now.";
const SLOT_TARGET_CHANGED = "What's due has changed. Refresh to see what's due now.";
const SLOT_ALREADY_TAKEN = "This dose is already logged as taken. Refresh to see it.";

function slotTimeFailure(problem: SlotActionTimeProblem) {
  return problem === "future"
    ? fail(400, { errors: { takenAt: [TAKEN_AT_IN_FUTURE] } })
    : fail(409, { errors: { form: [SLOT_OFF_DASHBOARD] } });
}
```

- [ ] **Step 4: Replace the logDose action**

Replace the `logDose: async ({ request, locals }) => { … },` entry (HEAD lines 103-146) with:

```ts
  logDose: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");
    const user = locals.user;

    const formData = Object.fromEntries(await request.formData());
    const parsed = doseLogSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, quantity, takenAt, forSlot, notes, sideEffects } = parsed.data;
    // One clock for the whole request: the stale check below and Log now's
    // recompute must judge the same instant.
    const now = new Date();
    const at = takenAt ? new Date(takenAt) : undefined;

    if (at) {
      const problem = checkSlotActionTime(at, now, user.timezone);
      if (problem) return slotTimeFailure(problem);
    }

    let doseId: string;
    try {
      if (forSlot) {
        // Log now. `quantity` is not read: the server proves where ONE dose
        // logged now lands, and it refuses (409) unless that is still the row
        // the button sat on.
        const row = await logDoseForSlot(
          user.id,
          medicationId,
          new Date(forSlot),
          now,
          user.timezone,
        );
        doseId = row.id;
      } else if (at) {
        // "Took it at HH:MM": the slot's own instant. The guard makes a
        // double tap one row and one decrement.
        const row = await logDose(user.id, medicationId, quantity, at, notes, sideEffects, {
          exactInstantGuard: true,
        });
        doseId = row.id;
      } else {
        // A chip: logged now, exactly as before this page had slots.
        const row = await logDose(user.id, medicationId, quantity, undefined, notes, sideEffects);
        doseId = row.id;
      }
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { errors: { form: ["Medication not found"] } });
      }
      if (err instanceof SlotTargetChangedError) {
        return fail(409, { errors: { form: [SLOT_TARGET_CHANGED] } });
      }
      throw err;
    }

    // Fire-and-forget product analytics. Only safe, non-PII metadata is sent:
    // no medication id/name, no notes content, no side-effect strings.
    try {
      await track("dose_logged", {
        source: "dashboard",
        hasNotes: Boolean(notes),
        hasSideEffects: Array.isArray(sideEffects) && sideEffects.length > 0,
      });
    } catch {
      // Telemetry failure must never break the user's dose log.
    }

    return { success: true, doseId };
  },
```

- [ ] **Step 5: Replace the skipDose action**

Replace the `skipDose: async ({ request, locals }) => { … },` entry (HEAD lines 177-192) with:

```ts
  skipDose: async ({ request, locals }) => {
    if (!locals.user) error(401, "Unauthorized");
    const user = locals.user;

    const formData = Object.fromEntries(await request.formData());
    // Through the schema, not `String(formData.medicationId)`: that turned a
    // missing field into the id "undefined" and answered 404 where a
    // malformed request deserves 400.
    const parsed = doseSkipSchema.safeParse(formData);
    if (!parsed.success) {
      return fail(400, { errors: parsed.error.flatten().fieldErrors });
    }

    const { medicationId, takenAt } = parsed.data;
    const now = new Date();
    const at = takenAt ? new Date(takenAt) : undefined;

    if (at) {
      const problem = checkSlotActionTime(at, now, user.timezone);
      if (problem) return slotTimeFailure(problem);
    }

    let doseId: string;
    try {
      // With an instant, this is the row's own Skip (its `skipAt`), so it is
      // deduplicated and refused over a taken dose. Without one it is the
      // legacy skip-at-now.
      doseId = at
        ? await logSkippedDose(user.id, medicationId, at, { exactInstantGuard: true })
        : await logSkippedDose(user.id, medicationId);
    } catch (err) {
      if (err instanceof MedicationNotFoundError) {
        return fail(404, { error: "Medication not found" });
      }
      if (err instanceof SlotAlreadyTakenError) {
        return fail(409, { errors: { form: [SLOT_ALREADY_TAKEN] } });
      }
      throw err;
    }
    return { success: true, doseId };
  },
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts`
Expected: PASS (all 20 cases).

- [ ] **Step 7: Update the auth-guard mock factory**

In `tests/unit/app-action-auth-guard.test.ts`, replace lines 56-64 (the `vi.mock("$lib/server/doses", …)` call) with:

```ts
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: never("getTodaysDoses"),
  getDosesInRange: never("getDosesInRange"),
  getLastDosePerMedication: never("getLastDosePerMedication"),
  logDose: never("logDose"),
  logDoseForSlot: never("logDoseForSlot"),
  logSkippedDose: never("logSkippedDose"),
  deleteDose: never("deleteDose"),
  updateDose: never("updateDose"),
  MedicationNotFoundError: FakeError,
  SlotAlreadyTakenError: FakeError,
  SlotTargetChangedError: FakeError,
}));
```

The `CASES` table does not change. `{ medicationId: "m1" }` is still a valid body for both `doseLogSchema` and `doseSkipSchema`, and no action was added.

Run: `npx vitest run tests/unit/app-action-auth-guard.test.ts`
Expected: PASS, including "covers every action defined under (app)".

- [ ] **Step 8: Prove by mutation** (restore after each)

1. In the `logDose` action, delete the `if (at) { const problem = checkSlotActionTime(…); … }` block. Then `npx vitest run tests/unit/dashboard-dose-actions.test.ts -t "logDose action"` must FAIL in two cases: "refuses a takenAt after now…" and "refuses a takenAt the dashboard no longer shows…" (`logDose` was called; the status is not 400/409).
2. Delete the `if (err instanceof SlotTargetChangedError) { … }` branch. Then `-t "moved between render and tap"` must FAIL, because the action rejects with the error.
3. In `skipDose`, replace the `doseSkipSchema.safeParse` block with the old `const medicationId = String(formData.medicationId); if (!medicationId) return fail(400);`, adjusting the destructure. Then `-t "answers 400, not 404"` must FAIL.
4. In `skipDose`, comment out `if (!locals.user) error(401, "Unauthorized");`. TypeScript will flag `user`, but vitest does not type-check. Then `npx vitest run tests/unit/app-action-auth-guard.test.ts -t "dashboard ?/skipDose"` must FAIL with a `TypeError`, not a 401.

- [ ] **Step 9: Run the neighbouring suites, type-check and lint**

Run: `npx vitest run tests/unit/dashboard-dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts tests/unit/dashboard-timing-status.test.ts tests/unit/log-dose-actions.test.ts tests/unit/api/commands.test.ts && npm run check && npm run lint`
Expected: PASS, and `check` reports 0 errors.

- `dashboard-timing-status.test.ts` still passes without the new mock names: the `load` does not touch them, and vitest's mock proxy throws only on access. T11 deletes that file.

- [ ] **Step 10: Commit**

```bash
git add "src/routes/(app)/dashboard/+page.server.ts" tests/unit/dashboard-dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts
git commit -m "feat(dashboard): route Log now, Took it at and Skip through slot-checked writes"
```

---

### Task 10: Dashboard client building blocks (lock, clock, StatusMarker, MedicationGlyph, DoseActionForm, DueCard, DoneList, LaterList, DashboardHeader)

Nothing in this task is mounted on the page yet. T11 switches `+page.svelte` over. Every file here is new except `vite.config.ts`, which Step 25 changes for Vitest only. Prerequisites: T1 (`formatDuration`), T6 (types + `utils/dashboard-copy.ts`) and T9 (actions return `{ success: true, doseId }`) are merged.

Conventions used throughout (all already true in this repo):

- Unit tests default to **jsdom** (`vite.config.ts` `test.environment`). A test that calls `render()` from `svelte/server` MUST start with `// @vitest-environment node`, because under jsdom vite resolves `svelte` to its client entry and `render()` throws `effect_orphan` (see `tests/unit/error-page-ssr.test.ts:1-6`).
- NOT already true, and Part E depends on it: under this repo's `vite.config.ts` a jsdom test's own `import { mount, flushSync } from "svelte"` resolves to `svelte`'s SERVER entry (`src/index-server.js`), so `mount()` throws `lifecycle_function_unavailable` before any assertion. Step 25 adds `resolve.conditions: ["browser"]` under Vitest. With it the existing suite (124 files) and every SSR test in this task still pass.
- `jsdom` has no bundled types; `tests/types/jsdom.d.ts` declares only `new JSDOM(html).window`. Use nothing else from it.
- `$app/forms`, `$app/navigation`, `$app/state` and `$components/ui/Toast.svelte` are mocked with `vi.mock` in every test that imports a component using them (precedent: `tests/unit/my-day-timeline-ssr.test.ts:13-14`). Mock once per file, never per case (`tests/unit/error-page-ssr.test.ts:11-14`).
- The pre-commit hook runs `eslint --fix` and `prettier --write` (`.lintstagedrc.json`). Every "run to pass" step below formats first, so the tests see exactly what will be committed — several assertions pin accessible names to the character, and a whitespace change Prettier introduced would show up there.
- `.svelte.ts` modules are imported WITHOUT the `.ts` extension (`"$lib/components/dashboard/dose-write-lock.svelte"`). Vite appends `.ts`. svelte-check resolves it too: its virtual component path is `*.d.svelte.ts` (`node_modules/svelte-check/dist/src/index.js:102597`), so the real `*.svelte.ts` file is not shadowed.

**Files:**

- Create: `src/lib/components/dashboard/dose-write-lock.svelte.ts`
- Create: `src/lib/components/dashboard/dashboard-clock.ts`
- Create: `src/lib/components/dashboard/status-marker.ts`
- Create: `src/lib/components/dashboard/StatusMarker.svelte`
- Create: `src/lib/components/dashboard/MedicationGlyph.svelte`
- Create: `src/lib/components/dashboard/dose-action.ts`
- Create: `src/lib/components/dashboard/DoseActionForm.svelte`
- Create: `src/lib/components/dashboard/dose-toasts.ts`
- Create: `src/lib/components/dashboard/dom-ids.ts`
- Create: `src/lib/components/dashboard/focus-after.ts`
- Create: `src/lib/components/dashboard/DueCard.svelte`
- Create: `src/lib/components/dashboard/DoneList.svelte`
- Create: `src/lib/components/dashboard/LaterList.svelte`
- Create: `src/lib/components/dashboard/DashboardHeader.svelte`
- Create (test helpers): `tests/unit/helpers/axe-ssr.ts`, `tests/unit/helpers/dashboard-context.ts`, `tests/unit/helpers/dose-action-form-harness.ts`, `tests/unit/helpers/dom-names.ts`
- Modify: `vite.config.ts` (Step 25: Svelte's browser entry under Vitest, so jsdom tests can `mount()`)
- Test: `tests/unit/dose-write-lock.test.ts`, `tests/unit/dashboard-clock.test.ts`, `tests/unit/status-marker-ssr.test.ts`, `tests/unit/medication-glyph-ssr.test.ts`, `tests/unit/dose-action-form.test.ts`, `tests/unit/dose-toasts.test.ts`, `tests/unit/dashboard-focus.test.ts`, `tests/unit/due-card-ssr.test.ts`, `tests/unit/done-list-ssr.test.ts`, `tests/unit/later-list-ssr.test.ts`, `tests/unit/dashboard-header-ssr.test.ts`

**Interfaces:**

- Consumes:
  - T1 `src/lib/utils/time.ts`: `export function formatDuration(ms: number, opts?: DurationOptions): string` (`{ style?: "short" | "long"; maxUnits?: 1 | 2 }`).
  - T6 `src/lib/types.ts`: `DashboardStatus`, `DueRow`, `DueCard`, `DoneRow`, `LaterRow` (exact shapes in the contract).
  - T6 `src/lib/utils/dashboard-copy.ts`: `formatSlotTime(at: Date, todayStart: Date, tz: string, timeFormat: TimeFormat): string`; `dashboardHeaderCopy(status: DashboardStatus, serverNow: Date, tz: string, timeFormat: TimeFormat): { sentence: string; supporting: string | null }`; `formatDoseLabel(name: string, dosageAmount: string, dosageUnit: string): string`; `toastForLog(i: { label: string; quantity: number; takenAt: Date; covers: Date[]; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`; `toastForTookItAt(i: { label: string; at: Date; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`; `toastForSkip(i: { label: string; slot: Date; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`; `rowStatusLine(row: { state: DueRow["state"]; expectedTime: Date }, serverNow: Date, todayStart: Date, tz: string, timeFormat: TimeFormat): string`.
  - T9 (runtime): `?/logDose` and `?/skipDose` return `{ success: true, doseId }`; 409 failures carry `{ errors: { form: [...] } }`.
  - Existing: `getMedicationBackground(colour, colourSecondary, pattern, small)` (`src/lib/utils/medication-style.ts:39`); `actionErrorMessage(result, fallback?)` (`src/lib/utils/form-errors.ts:25`); `showToast(message, type, undoAction?)` (`src/lib/components/ui/Toast.svelte:23`); `formatUserTime(date, timezone, timeFormat)` (`src/lib/utils/time.ts:23`); `formatUserDate(date, timezone, dateFormat, { weekday, year })` (`src/lib/utils/time.ts:408`); `TimeFormat`, `DateFormat` (`src/lib/utils/time.ts:15,45`); `DoseLogWithMedication` (`src/lib/types.ts`).
- Produces (contract, verbatim):
  - `src/lib/components/dashboard/dose-write-lock.svelte.ts`: `export const DOSE_WRITE_COOLDOWN_MS = 700;` `export interface DoseWriteLock { readonly busy: boolean; acquire(): boolean; release(): void }` `export function createDoseWriteLock(opts?: { cooldownMs?: number }): DoseWriteLock` `export function setDoseWriteLock(lock: DoseWriteLock): void` `export function getDoseWriteLock(): DoseWriteLock`
  - `src/lib/components/dashboard/dashboard-clock.ts`: `export function skewFrom(serverNowIso: string, clientNowMs?: number): number` `export interface DashboardClock { serverNow(): Date; nextRefreshAt(): Date; refresh(): Promise<void> }` `export function setDashboardClock(c: DashboardClock): void` `export function getDashboardClock(): DashboardClock`
  - `StatusMarker.svelte` props `{ state: "taken" | "overdue" | "due-now" | "upcoming" | "skipped" | "missed" }`
  - `MedicationGlyph.svelte` props `{ colour: string; colourSecondary: string | null; pattern: string; size?: "sm" | "md" }`
  - `DoseActionForm.svelte` props `{ action: string; fields: Record<string, string>; label: string; srContext?: string; pendingLabel: string; variant: "primary" | "secondary" | "quiet" | "chip" | "danger"; quickLog?: boolean; buildToast?: (doseId: string | null) => string | null; undoable?: boolean; focusAfter?: () => HTMLElement | null; onSuccess?: () => void; children?: Snippet; class?: string }` (`"danger"` added; `class` goes on the `<form>`; `children` renders inside the button BEFORE `label` — see deviations)
  - `DueCard.svelte` props `{ card: DueCard; serverNow: Date; todayStart: Date; timezone: string; timeFormat: TimeFormat; focusAfter: () => HTMLElement | null }`
  - `DoneList.svelte` props `{ rows: DoneRow[]; title: string; todayStart: Date; timezone: string; timeFormat: TimeFormat; onedit: (dose: DoseLogWithMedication) => void }` (`todayStart` added)
  - `LaterList.svelte` props `{ rows: LaterRow[]; serverNow: Date; todayStart: Date; timezone: string; timeFormat: TimeFormat }`
  - `DashboardHeader.svelte` props `{ status: DashboardStatus; serverNow: Date; timezone: string; timeFormat: TimeFormat; dateFormat: DateFormat }`
- Produces (additive, for T11):
  - `dose-write-lock.svelte.ts`: `export const DOSE_WRITE_LOCK: unique symbol` (context key).
  - `dashboard-clock.ts`: `export const DASHBOARD_CLOCK` (context key); `export interface DashboardClockPayload { now: string; nextRefreshAt: string }`; `export interface DashboardClockController extends DashboardClock { sync(payload: DashboardClockPayload): void; onVisible(): void; dispose(): void }`; `export function createDashboardClock(invalidate: () => Promise<void>): DashboardClockController`. T11 wiring: `const clock = createDashboardClock(invalidateAll); setDashboardClock(clock);` then `$effect(() => clock.sync({ now: data.now, nextRefreshAt: data.nextRefreshAt }))` (once per payload), call `clock.onVisible()` from `visibilitychange` when `document.visibilityState === "visible"`, and `clock.dispose()` in the effect teardown / `onDestroy`. The 60-second render tick stays in the page: set a `$state` `serverNow = clock.serverNow()` every 60s.
  - `status-marker.ts`: `export type StatusMarkerState`; `export const STATUS_MARKER_LABELS: Record<StatusMarkerState, string>`; `export const STATUS_MARKER_STATES: StatusMarkerState[]`.
  - `dose-action.ts`: `UNDO_ACTION = "/dashboard?/deleteDose"`, `STALE_TAP_MESSAGE`, `SUCCESS_FALLBACK_TOAST`, `UNDONE_TOAST`.
  - `dose-toasts.ts`: `export interface LogToastFallback { label: string; quantity: number; takenAt: Date; todayStart: Date }`; `export function logToastFromReload(reloaded: unknown, doseId: string | null, fallback: LogToastFallback, tz: string, timeFormat: TimeFormat): string` — T11's chips pass `page.data` (from `$app/state`) and their own quantity.
  - `dom-ids.ts`: `DASHBOARD_HEADING_ID = "dashboard-heading"`, `DONE_HEADING_ID = "done-heading"`. T11 passes `focusAfter={() => document.getElementById(DASHBOARD_HEADING_ID)}` to every `DueCard`, and the Modal's Remove form uses `focusAfter={() => document.getElementById(DONE_HEADING_ID)}`.
  - `focus-after.ts`: `export function focusTargetAfterResolve(cardKey: string, followingKeys: readonly string[], root?: ParentNode): HTMLElement | null`.
  - Every `DueCard` `<li>` carries `data-dose-card` and `data-card-key={card.key}`; `DoseActionForm` sets `aria-busy="true"` on the closest `[data-dose-card]` while it is pending.

---

#### Part A — the page-wide dose-write lock

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dose-write-lock.test.ts`:

```ts
// The dashboard's page-wide dose-write lock. Every log, skip, undo and remove
// on the page takes it, so a double tap — or a tap on a row that is about to
// re-render away — cannot write twice. Part E adds the DoseActionForm case
// whose ORDERING matters most (an 'error' result frees the page only after
// the reload has landed).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDoseWriteLock", () => {
  it("cools down for 700ms by default", () => {
    expect(DOSE_WRITE_COOLDOWN_MS).toBe(700);
  });

  it("grants the lock once and refuses it while it is held", () => {
    const lock = createDoseWriteLock();
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);
  });

  it("stays busy through the whole cooldown after release, to the millisecond", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();

    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
  });

  it("honours a custom cooldown", () => {
    const lock = createDoseWriteLock({ cooldownMs: 50 });
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(49);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("ignores a release when nothing holds the lock", () => {
    const lock = createDoseWriteLock();
    lock.release();
    expect(lock.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stretch a running cooldown when released twice", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(400);
    lock.release();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 400);
    expect(lock.busy).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/dose-write-lock.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/dose-write-lock.svelte"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/components/dashboard/dose-write-lock.svelte.ts`:

```ts
import { getContext, setContext } from "svelte";

/**
 * How long every dose-writing control on the dashboard stays locked after a
 * write settles. A double tap on Log now lands well inside this, and the
 * second tap would otherwise hit a list that has not re-rendered yet — it
 * would write against whatever row slid under the finger. Exported for tests.
 */
export const DOSE_WRITE_COOLDOWN_MS = 700;

/** Context key. Exported so a test can render a component with a lock of its own. */
export const DOSE_WRITE_LOCK = Symbol("dose-write-lock");

export interface DoseWriteLock {
  /** True from a successful `acquire()` until the cooldown after `release()` ends. */
  readonly busy: boolean;
  /** Take the page-wide lock. False when any dose write already holds it. */
  acquire(): boolean;
  /** Start the cooldown. A no-op when nothing holds the lock or a cooldown is already running. */
  release(): void;
}

/**
 * One lock per dashboard. While `busy`, every DoseActionForm renders
 * `aria-disabled` and cancels its submit — never the `disabled` attribute,
 * which drops keyboard focus to <body> mid-task.
 */
export function createDoseWriteLock(opts: { cooldownMs?: number } = {}): DoseWriteLock {
  const cooldownMs = opts.cooldownMs ?? DOSE_WRITE_COOLDOWN_MS;
  let busy = $state(false);
  let cooldown: ReturnType<typeof setTimeout> | undefined;

  return {
    get busy() {
      return busy;
    },
    acquire() {
      if (busy) return false;
      busy = true;
      return true;
    },
    release() {
      if (!busy || cooldown !== undefined) return;
      cooldown = setTimeout(() => {
        cooldown = undefined;
        busy = false;
      }, cooldownMs);
    },
  };
}

/** Call once, during +page.svelte's initialisation. */
export function setDoseWriteLock(lock: DoseWriteLock): void {
  setContext(DOSE_WRITE_LOCK, lock);
}

/** Call during a component's initialisation. Throws when no page set a lock. */
export function getDoseWriteLock(): DoseWriteLock {
  const lock = getContext<DoseWriteLock | undefined>(DOSE_WRITE_LOCK);
  if (!lock) {
    throw new Error("No dose-write lock in context: +page.svelte must call setDoseWriteLock()");
  }
  return lock;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/dose-write-lock.svelte.ts tests/unit/dose-write-lock.test.ts && npx vitest run tests/unit/dose-write-lock.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Prove by mutation**

In `release()`, replace the whole `cooldown = setTimeout(...)` statement with `busy = false;`. Run `npx vitest run tests/unit/dose-write-lock.test.ts`: "stays busy through the whole cooldown after release, to the millisecond" and "honours a custom cooldown" must FAIL. Restore the line and re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/dashboard/dose-write-lock.svelte.ts tests/unit/dose-write-lock.test.ts
git commit -m "feat(dashboard): add the page-wide dose-write lock"
```

---

#### Part B — server-relative client time

- [ ] **Step 7: Write the failing test**

Create `tests/unit/dashboard-clock.test.ts`:

```ts
// All dashboard client time is server-relative. A device clock that is
// minutes fast must neither reload the page early (in a loop, since every
// reload hands back a nextRefreshAt the device already thinks has passed)
// nor refuse taps near a boundary.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDashboardClock, skewFrom } from "$lib/components/dashboard/dashboard-clock";

const MIN = 60_000;

describe("skewFrom", () => {
  it("is server minus device: a device 10 minutes fast gives minus 10 minutes", () => {
    expect(skewFrom("2026-05-01T12:00:00.000Z", Date.parse("2026-05-01T12:10:00.000Z"))).toBe(
      -10 * MIN,
    );
  });

  it("reads the device clock when none is given", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T11:59:30.000Z"));
    try {
      expect(skewFrom("2026-05-01T12:00:00.000Z")).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createDashboardClock", () => {
  // The device reads 12:10 while the server's payload says 12:00.
  const FIRST = { now: "2026-05-01T12:00:00.000Z", nextRefreshAt: "2026-05-01T12:30:00.000Z" };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-01T12:10:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tells the time on the server's clock, not the device's", () => {
    const clock = createDashboardClock(vi.fn(async () => {}));
    clock.sync(FIRST);
    expect(clock.serverNow().toISOString()).toBe("2026-05-01T12:00:00.000Z");
    expect(clock.nextRefreshAt().toISOString()).toBe(FIRST.nextRefreshAt);
    vi.advanceTimersByTime(5 * MIN);
    expect(clock.serverNow().toISOString()).toBe("2026-05-01T12:05:00.000Z");
    clock.dispose();
  });

  it("with a device clock 10 minutes fast, reloads once per nextRefreshAt and never early", async () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST);

    // Device 12:35, server 12:25. Comparing the payload with raw Date.now()
    // would reload here — and again after every reload.
    vi.advanceTimersByTime(25 * MIN);
    clock.onVisible();
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * MIN - 1);
    expect(invalidate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // Until a new payload lands, nothing fires again for the same nextRefreshAt.
    clock.onVisible();
    // Async: lets the first reload's promise settle, as it would in a browser,
    // so the next payload's refresh is not coalesced into it.
    await vi.advanceTimersByTimeAsync(MIN);
    expect(invalidate).toHaveBeenCalledTimes(1);

    // The reload lands: device 12:41, server 12:31. Next refresh 13:00 server time.
    clock.sync({ now: "2026-05-01T12:31:00.000Z", nextRefreshAt: "2026-05-01T13:00:00.000Z" });
    vi.advanceTimersByTime(29 * MIN - 1);
    clock.onVisible();
    expect(invalidate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(invalidate).toHaveBeenCalledTimes(2);
    clock.dispose();
  });

  it("re-arms instead of giving up when the device clock is stepped back under the timer", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST); // timer due in 30 minutes

    // NTP steps the device back five minutes; the pending timer is unaffected.
    vi.setSystemTime(new Date("2026-05-01T12:05:00.000Z"));
    vi.advanceTimersByTime(30 * MIN); // fires at device 12:35 = server 12:25: not yet
    expect(invalidate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5 * MIN);
    expect(invalidate).toHaveBeenCalledTimes(1);
    clock.dispose();
  });

  it("coalesces overlapping refreshes into one reload", async () => {
    let finish!: () => void;
    const invalidate = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const clock = createDashboardClock(invalidate);

    const first = clock.refresh();
    const second = clock.refresh();
    expect(invalidate).toHaveBeenCalledTimes(1);

    finish();
    await Promise.all([first, second]);
    void clock.refresh();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });

  it("stops its timer on dispose", () => {
    const invalidate = vi.fn(async () => {});
    const clock = createDashboardClock(invalidate);
    clock.sync(FIRST);
    clock.dispose();
    vi.advanceTimersByTime(60 * MIN);
    expect(invalidate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-clock.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/dashboard-clock"`.

- [ ] **Step 9: Write minimal implementation**

Create `src/lib/components/dashboard/dashboard-clock.ts`:

```ts
import { getContext, setContext } from "svelte";

/** Context key. Exported so a test can render a component with a clock of its own. */
export const DASHBOARD_CLOCK = Symbol("dashboard-clock");

/**
 * Server time minus device time, measured when a payload arrives.
 *
 * Every payload instant (`now`, `nextRefreshAt`, slot times) is on the
 * server's clock. Compare one with raw `Date.now()` on a device ten minutes
 * fast and the page reloads in a loop — each reload hands back a
 * `nextRefreshAt` the device already believes has passed — and the stale
 * guard refuses every tap near a boundary.
 */
export function skewFrom(serverNowIso: string, clientNowMs: number = Date.now()): number {
  return Date.parse(serverNowIso) - clientNowMs;
}

export interface DashboardClock {
  /** The current instant on the server's clock. */
  serverNow(): Date;
  /** When the loaded payload stops being true, on the server's clock. */
  nextRefreshAt(): Date;
  /** Reload the page data now. Overlapping calls share one reload. */
  refresh(): Promise<void>;
}

export interface DashboardClockPayload {
  now: string;
  nextRefreshAt: string;
}

export interface DashboardClockController extends DashboardClock {
  /** Adopt a freshly loaded payload: re-measure skew and re-arm the one refresh timer. Call once per payload. */
  sync(payload: DashboardClockPayload): void;
  /** For `visibilitychange` → visible: reload if the payload expired while the tab was hidden. */
  onVisible(): void;
  /** Clear the refresh timer. */
  dispose(): void;
}

export function createDashboardClock(invalidate: () => Promise<void>): DashboardClockController {
  let skewMs = 0;
  let refreshAtMs = Number.NaN;
  let firedFor: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;

  const serverNowMs = () => Date.now() + skewMs;

  function refresh(): Promise<void> {
    inFlight ??= invalidate().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  /** Reload at most once per payload, and only once the SERVER's clock says it has expired. */
  function refreshIfExpired(): void {
    if (!(serverNowMs() >= refreshAtMs) || firedFor === refreshAtMs) return;
    firedFor = refreshAtMs;
    void refresh().catch(() => {});
  }

  function arm(): void {
    clearTimeout(timer);
    timer = undefined;
    if (Number.isNaN(refreshAtMs)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        // A timer measures elapsed time, and the device clock can be stepped
        // underneath it. If the server clock has not reached the refresh yet,
        // wait out the difference rather than dropping the refresh.
        if (serverNowMs() < refreshAtMs) arm();
        else refreshIfExpired();
      },
      Math.max(0, refreshAtMs - serverNowMs()),
    );
  }

  return {
    serverNow: () => new Date(serverNowMs()),
    nextRefreshAt: () => new Date(refreshAtMs),
    refresh,
    sync(payload) {
      skewMs = skewFrom(payload.now);
      refreshAtMs = Date.parse(payload.nextRefreshAt);
      arm();
    },
    onVisible: refreshIfExpired,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Call once, during +page.svelte's initialisation. */
export function setDashboardClock(c: DashboardClock): void {
  setContext(DASHBOARD_CLOCK, c);
}

/** Call during a component's initialisation. Throws when no page set a clock. */
export function getDashboardClock(): DashboardClock {
  const clock = getContext<DashboardClock | undefined>(DASHBOARD_CLOCK);
  if (!clock) {
    throw new Error("No dashboard clock in context: +page.svelte must call setDashboardClock()");
  }
  return clock;
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/dashboard-clock.ts tests/unit/dashboard-clock.test.ts && npx vitest run tests/unit/dashboard-clock.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 11: Prove by mutation**

1. Change `const serverNowMs = () => Date.now() + skewMs;` to `const serverNowMs = () => Date.now();`. Run the file: "with a device clock 10 minutes fast, reloads once per nextRefreshAt and never early" must FAIL (the `onVisible()` at device 12:35 reloads). Restore.
2. In `arm()`, replace `if (serverNowMs() < refreshAtMs) arm(); else refreshIfExpired();` with `refreshIfExpired();`. Run: "re-arms instead of giving up when the device clock is stepped back under the timer" must FAIL. Restore and re-run: PASS.

- [ ] **Step 12: Commit**

```bash
git add src/lib/components/dashboard/dashboard-clock.ts tests/unit/dashboard-clock.test.ts
git commit -m "feat(dashboard): keep dashboard time on the server's clock"
```

---

#### Part C — StatusMarker

- [ ] **Step 13: Write the axe helper and the failing test**

Create `tests/unit/helpers/axe-ssr.ts`:

```ts
import type { AxeResults } from "axe-core";
import { JSDOM } from "jsdom";

/** Parse SSR markup into a standalone document, inside a <main> as the page nests it. */
export function ssrDocument(bodyHtml: string): Document {
  return new JSDOM(`<!doctype html><html lang="en"><body><main>${bodyHtml}</main></body></html>`)
    .window.document;
}

/**
 * Run the named axe rules against a JSDOM document. axe reads `window` and
 * `document` off the global at run time and SSR tests run in the `node`
 * environment, so they are put there for the run and taken back off
 * (the pattern the My Day timeline's SSR test used before T11 deleted it).
 */
export async function runAxe(doc: Document, rules: string[]): Promise<AxeResults> {
  const axe = (await import("axe-core")).default;
  const g = globalThis as unknown as Record<string, unknown>;
  const [prevWindow, prevDocument] = [g.window, g.document];
  g.window = doc.defaultView;
  g.document = doc;
  try {
    return await axe.run(doc.body, { runOnly: { type: "rule", values: rules } });
  } finally {
    g.window = prevWindow;
    g.document = prevDocument;
  }
}

/**
 * The rules that actually evaluated something. An empty violations list is
 * vacuous if a rule found no candidate, so every caller asserts its rules
 * appear here.
 */
export function evaluatedRules(results: AxeResults): Set<string> {
  return new Set([...results.passes, ...results.violations].map((rule) => rule.id));
}
```

Create `tests/unit/status-marker-ssr.test.ts`:

```ts
// @vitest-environment node
//
// Moved from the My Day timeline's SSR test (deleted with that component in T11),
// with the same assertions: the marker is the ONLY thing that says whether a
// dose was taken, skipped, missed, is overdue, due now or still to come, so
// its accessible name is load-bearing. An aria-label on a bare <span> is
// prohibited (`generic` does not support naming) and is DISCARDED — confirmed
// on production by Lighthouse (`aria-prohibited-attr`, nine failing nodes on
// /dashboard). `node` is load-bearing: see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import StatusMarker from "$lib/components/dashboard/StatusMarker.svelte";
import {
  STATUS_MARKER_LABELS,
  STATUS_MARKER_STATES,
  type StatusMarkerState,
} from "$lib/components/dashboard/status-marker";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";

/** The spec's table (Section 1, Accessibility). A new state fails the first test until it is added here. */
const SPEC: Record<StatusMarkerState, { label: string; classes: string[] }> = {
  taken: { label: "Taken", classes: ["bg-success/20", "text-success"] },
  overdue: { label: "Overdue", classes: ["bg-warning/20", "text-warning"] },
  "due-now": { label: "Due now", classes: ["ring-2", "ring-accent-ink"] },
  upcoming: { label: "Upcoming", classes: ["border", "border-border-strong"] },
  skipped: { label: "Skipped", classes: ["border", "border-border-strong", "text-text-secondary"] },
  missed: { label: "Missed", classes: ["border", "border-border-strong", "text-text-secondary"] },
};

const renderMarker = (state: StatusMarkerState) => render(StatusMarker, { props: { state } }).body;
const withoutComments = (html: string) => html.replace(/<!--[\s\S]*?-->/g, "").trim();
const outerTag = (html: string) => withoutComments(html).match(/^<span[^>]*>/)?.[0] ?? "";
const classesOf = (tag: string) => tag.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/) ?? [];
const glyphOf = (html: string) =>
  withoutComments(html)
    .replace(/^<span[^>]*>/, "")
    .replace(/<\/span>$/, "")
    .trim();

describe("StatusMarker", () => {
  it("covers exactly the states the spec defines, each with the spec's label", () => {
    const labels = Object.fromEntries(
      STATUS_MARKER_STATES.map((s) => [s, STATUS_MARKER_LABELS[s]]),
    );
    const expected = Object.fromEntries(Object.entries(SPEC).map(([s, v]) => [s, v.label]));
    expect(labels).toEqual(expected);
  });

  for (const state of STATUS_MARKER_STATES) {
    it(`gives the ${state} marker a name assistive technology will actually read`, () => {
      const tag = outerTag(renderMarker(state));
      expect(tag).toContain(`aria-label="${SPEC[state].label}"`);
      expect(tag).toContain('role="img"');
    });

    it(`draws the ${state} marker with the spec's recipe`, () => {
      const classes = classesOf(outerTag(renderMarker(state)));
      expect(classes).toEqual(
        expect.arrayContaining(["h-5", "w-5", "rounded-full", ...SPEC[state].classes]),
      );
    });
  }

  it("never leaves an aria-label on an element without a role, whatever the state", () => {
    const html = STATUS_MARKER_STATES.map(renderMarker).join("");
    const bare = html.match(/<span(?![^>]*\brole=)[^>]*\saria-label=/g) ?? [];
    expect(bare, `spans carrying aria-label without a role: ${bare.join(", ")}`).toEqual([]);
  });

  it("gives every state its own shape, so status never rests on colour alone", () => {
    const glyphs = new Map(STATUS_MARKER_STATES.map((s) => [s, glyphOf(renderMarker(s))]));
    const distinct = ["taken", "overdue", "due-now", "upcoming", "skipped"] as const;
    expect(new Set(distinct.map((s) => glyphs.get(s))).size).toBe(distinct.length);
    // A missed row is rendered exactly like a skip: a decision, not a problem.
    expect(glyphs.get("missed")).toBe(glyphs.get("skipped"));
    expect(glyphs.get("due-now")).toContain("bg-accent-ink");
    expect(glyphs.get("upcoming")).toBe("");
  });

  it("passes axe's own aria-prohibited-attr rule", async () => {
    const doc = ssrDocument(`<div>${STATUS_MARKER_STATES.map(renderMarker).join("")}</div>`);
    const results = await runAxe(doc, ["aria-prohibited-attr"]);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => n.html));
    expect(offenders, offenders.join("\n")).toEqual([]);
    expect(evaluatedRules(results).has("aria-prohibited-attr")).toBe(true);
  });
});
```

- [ ] **Step 14: Run test to verify it fails**

Run: `npx vitest run tests/unit/status-marker-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/StatusMarker.svelte"`.

- [ ] **Step 15: Write minimal implementation**

Create `src/lib/components/dashboard/status-marker.ts`:

```ts
export type StatusMarkerState = "taken" | "overdue" | "due-now" | "upcoming" | "skipped" | "missed";

/**
 * Each marker's accessible name. "Overdue" survives on the dashboard ONLY
 * here — no visible copy says it. A total Record, so a state added to the
 * union without a label does not compile; status-marker-ssr.test.ts pins
 * the wording against the spec's table.
 */
export const STATUS_MARKER_LABELS: Record<StatusMarkerState, string> = {
  taken: "Taken",
  overdue: "Overdue",
  "due-now": "Due now",
  upcoming: "Upcoming",
  skipped: "Skipped",
  missed: "Missed",
};

export const STATUS_MARKER_STATES = Object.keys(STATUS_MARKER_LABELS) as StatusMarkerState[];
```

Create `src/lib/components/dashboard/StatusMarker.svelte`:

```svelte
<script lang="ts">
  import { STATUS_MARKER_LABELS, type StatusMarkerState } from "./status-marker";

  // Renamed on destructure: a local binding called `state` would collide with
  // the `$state` rune the moment anyone added one to this component.
  let { state: marker }: { state: StatusMarkerState } = $props();

  // Shape first, colour as reinforcement (spec, Section 1 → Accessibility).
  const RECIPES: Record<StatusMarkerState, string> = {
    taken: "bg-success/20 text-success",
    overdue: "bg-warning/20 text-warning",
    "due-now": "ring-2 ring-accent-ink",
    upcoming: "border border-border-strong",
    skipped: "border border-border-strong text-text-secondary",
    missed: "border border-border-strong text-text-secondary",
  };
</script>

<!-- `role="img"` is required, not decoration. This marker is the only thing
     that states a dose's status to a screen reader, and a bare <span> has the
     implicit `generic` role, which PROHIBITS naming — the aria-label is
     discarded. Caught on production by Lighthouse (`aria-prohibited-attr`).
     Pinned by tests/unit/status-marker-ssr.test.ts. -->
<span
  role="img"
  aria-label={STATUS_MARKER_LABELS[marker]}
  class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full {RECIPES[marker]}"
>
  {#if marker === "taken"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <polyline points="2,6 5,9 10,3" />
    </svg>
  {:else if marker === "overdue"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <line x1="6" y1="3" x2="6" y2="7" />
      <circle cx="6" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  {:else if marker === "due-now"}
    <span class="bg-accent-ink h-2 w-2 rounded-full"></span>
  {:else if marker === "skipped" || marker === "missed"}
    <svg
      class="h-3 w-3"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="9" y2="6" />
    </svg>
  {/if}
</span>
```

- [ ] **Step 16: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/status-marker.ts src/lib/components/dashboard/StatusMarker.svelte tests/unit/helpers/axe-ssr.ts tests/unit/status-marker-ssr.test.ts && npx vitest run tests/unit/status-marker-ssr.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 17: Prove by mutation**

Delete `role="img"` from the outer `<span>` in `StatusMarker.svelte`. Run the file: the six "gives the … marker a name assistive technology will actually read" tests, "never leaves an aria-label on an element without a role" and "passes axe's own aria-prohibited-attr rule" must FAIL. Restore and re-run: PASS.

- [ ] **Step 18: Commit**

```bash
git add src/lib/components/dashboard/status-marker.ts src/lib/components/dashboard/StatusMarker.svelte tests/unit/helpers/axe-ssr.ts tests/unit/status-marker-ssr.test.ts
git commit -m "feat(dashboard): add StatusMarker with a named marker for every state"
```

---

#### Part D — MedicationGlyph

- [ ] **Step 19: Write the failing test**

Create `tests/unit/medication-glyph-ssr.test.ts`:

```ts
// @vitest-environment node
//
// The capsule that replaces full-colour pills. Medication colours never sit
// behind text again, so this is decorative and hidden from AT.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import MedicationGlyph from "$lib/components/dashboard/MedicationGlyph.svelte";
import { getMedicationBackground } from "$lib/utils/medication-style";
import { ssrDocument } from "./helpers/axe-ssr";

type GlyphProps = {
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  size?: "sm" | "md";
};

function glyph(props: GlyphProps): HTMLElement {
  const el = ssrDocument(render(MedicationGlyph, { props }).body).querySelector<HTMLElement>(
    "[data-medication-glyph]",
  );
  if (!el) throw new Error("no glyph rendered");
  return el;
}

describe("MedicationGlyph", () => {
  it("is a 28×14 capsule by default", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" });
    expect(el.dataset.medicationGlyph).toBe("md");
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-3.5", "w-7", "rounded-full"]));
  });

  it("is a 20×10 capsule at size sm", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid", size: "sm" });
    expect(el.dataset.medicationGlyph).toBe("sm");
    expect([...el.classList]).toEqual(expect.arrayContaining(["h-2.5", "w-5", "rounded-full"]));
  });

  it("is hidden from assistive technology", () => {
    expect(
      glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" }).getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
  });

  it("draws its edge with border-strong, since a medication colour can match the card", () => {
    const el = glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" });
    expect([...el.classList]).toEqual(expect.arrayContaining(["ring-1", "ring-border-strong"]));
  });

  it("paints the small-size background, so stripes become a gradient rather than noise", () => {
    const style =
      glyph({ colour: "#ff0000", colourSecondary: "#0000ff", pattern: "stripes" }).getAttribute(
        "style",
      ) ?? "";
    expect(style).toContain(getMedicationBackground("#ff0000", "#0000ff", "stripes", true));
    expect(style).not.toContain("repeating-linear-gradient");
  });

  it("paints a single-colour medication solid", () => {
    const style =
      glyph({ colour: "#ff0000", colourSecondary: null, pattern: "solid" }).getAttribute("style") ??
      "";
    expect(style).toContain("#ff0000");
  });
});
```

- [ ] **Step 20: Run test to verify it fails**

Run: `npx vitest run tests/unit/medication-glyph-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/MedicationGlyph.svelte"`.

- [ ] **Step 21: Write minimal implementation**

Create `src/lib/components/dashboard/MedicationGlyph.svelte`:

```svelte
<script lang="ts">
  import { getMedicationBackground } from "$lib/utils/medication-style";

  let {
    colour,
    colourSecondary,
    pattern,
    size = "md",
  }: {
    colour: string;
    colourSecondary: string | null;
    pattern: string;
    size?: "sm" | "md";
  } = $props();

  // `small = true`: at 28px and below a stripe, dot or check pattern is noise,
  // so getMedicationBackground swaps geometric patterns for a gradient.
  const background = $derived(getMedicationBackground(colour, colourSecondary, pattern, true));
</script>

<!-- Decorative: the name beside it carries the meaning. ring-border-strong,
     not glass-border, because a medication colour can equal the card's. -->
<span
  aria-hidden="true"
  data-medication-glyph={size}
  class="ring-border-strong inline-block shrink-0 rounded-full ring-1 {size === 'sm'
    ? 'h-2.5 w-5'
    : 'h-3.5 w-7'}"
  style="background: {background}"
></span>
```

- [ ] **Step 22: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/MedicationGlyph.svelte tests/unit/medication-glyph-ssr.test.ts && npx vitest run tests/unit/medication-glyph-ssr.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 23: Prove by mutation**

Change the last argument of `getMedicationBackground(...)` in `MedicationGlyph.svelte` from `true` to `false`. Run the file: "paints the small-size background, so stripes become a gradient rather than noise" must FAIL. Restore and re-run: PASS.

- [ ] **Step 24: Commit**

```bash
git add src/lib/components/dashboard/MedicationGlyph.svelte tests/unit/medication-glyph-ssr.test.ts
git commit -m "feat(dashboard): add the MedicationGlyph capsule"
```

---

#### Part E — DoseActionForm, the one enhance path

- [ ] **Step 25: Let jsdom tests mount a component, then write the test helpers**

In `vite.config.ts`, replace:

```ts
  plugins: [tailwindcss(), sveltekit()],
  test: {
```

with:

```ts
  plugins: [tailwindcss(), sveltekit()],
  // Vitest only: resolve `svelte` to its browser entry, so a jsdom test can
  // `mount()` a component (dose-action-form.test.ts, dose-write-lock.test.ts).
  // Without it a test's `import { mount } from "svelte"` resolves to
  // index-server.js and throws `lifecycle_function_unavailable`. SSR tests
  // are unaffected: they run under `@vitest-environment node` and import
  // `render` from `svelte/server`. The build never sees this (VITEST unset).
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
  test: {
```

Run: `npx vitest run`
Expected: PASS with the same files and counts as before the edit (verified on HEAD: 124 files, all green with the condition added).

Create `tests/unit/helpers/dashboard-context.ts`:

```ts
import {
  createDoseWriteLock,
  DOSE_WRITE_LOCK,
  type DoseWriteLock,
} from "$lib/components/dashboard/dose-write-lock.svelte";
import { DASHBOARD_CLOCK, type DashboardClock } from "$lib/components/dashboard/dashboard-clock";

/** A clock frozen at `now` whose payload expires an hour later unless overridden. */
export function fixedClock(now: Date, overrides: Partial<DashboardClock> = {}): DashboardClock {
  return {
    serverNow: () => now,
    nextRefreshAt: () => new Date(now.getTime() + 60 * 60 * 1000),
    refresh: async () => {},
    ...overrides,
  };
}

/** The two contexts +page.svelte sets, for `render()` / `mount()`'s `context` option. */
export function dashboardContext(
  opts: { lock?: DoseWriteLock; clock?: DashboardClock; now?: Date } = {},
): Map<unknown, unknown> {
  return new Map<unknown, unknown>([
    [DOSE_WRITE_LOCK, opts.lock ?? createDoseWriteLock()],
    [DASHBOARD_CLOCK, opts.clock ?? fixedClock(opts.now ?? new Date("2026-05-01T13:00:00.000Z"))],
  ]);
}
```

Create `tests/unit/helpers/dose-action-form-harness.ts`:

```ts
// Mounts DoseActionForm for real (jsdom, client svelte) and drives its
// use:enhance callback by hand. The TEST FILE must mock `$app/forms` so that
// `enhance(form, submit)` hands `submit` over; this module only mounts and
// builds the arguments SvelteKit would pass.
import { vi } from "vitest";
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
import DoseActionForm from "$lib/components/dashboard/DoseActionForm.svelte";
import type { DoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import { dashboardContext } from "./dashboard-context";

export type DoseActionFormProps = ComponentProps<typeof DoseActionForm>;
export type SubmitCallback = Exclude<Awaited<ReturnType<SubmitFunction>>, void>;
type Update = Parameters<SubmitCallback>[0]["update"];

export const LOG_NOW_PROPS: DoseActionFormProps = {
  action: "?/logDose",
  fields: { medicationId: "m1", quantity: "1", forSlot: "2026-05-01T13:30:00.000Z" },
  label: "Log now",
  srContext: ": Metformin 500mg, 13:30 dose",
  pendingLabel: "Logging…",
  variant: "primary",
};

export function mountDoseActionForm(opts: {
  lock: DoseWriteLock;
  clock: DashboardClock;
  props?: Partial<DoseActionFormProps>;
  insideCard?: boolean;
}) {
  const list = document.createElement("ul");
  const host = document.createElement("li");
  if (opts.insideCard) host.setAttribute("data-dose-card", "");
  list.append(host);
  document.body.append(list);
  const component = mount(DoseActionForm, {
    target: host,
    props: { ...LOG_NOW_PROPS, ...opts.props },
    context: dashboardContext({ lock: opts.lock, clock: opts.clock }),
  });
  flushSync();
  const form = host.querySelector("form");
  const button = host.querySelector("button");
  if (!form || !button) throw new Error("DoseActionForm rendered no form or button");
  return {
    host,
    form,
    button,
    destroy() {
      unmount(component);
      list.remove();
    },
  };
}

/** What SvelteKit does when the form submits: call `submit` with the submit input. */
export async function startSubmit(submit: SubmitFunction, form: HTMLFormElement) {
  const cancel = vi.fn();
  const callback = await submit({
    action: new URL(form.action),
    formData: new FormData(form),
    formElement: form,
    controller: new AbortController(),
    submitter: form.querySelector("button"),
    cancel,
  });
  return { cancel, callback: (callback as SubmitCallback | undefined) ?? null };
}

/** What SvelteKit does when the response arrives: call the returned callback with the result. */
export function finishSubmit(
  callback: SubmitCallback,
  form: HTMLFormElement,
  result: ActionResult,
  update: Update = vi.fn(async () => {}),
) {
  const done = Promise.resolve(
    callback({
      action: new URL(form.action),
      formData: new FormData(form),
      formElement: form,
      result,
      update,
    }),
  );
  return { update, done };
}
```

- [ ] **Step 26: Write the failing tests**

Create `tests/unit/dose-action-form.test.ts`:

```ts
// DoseActionForm is the ONE use:enhance for every dashboard log, skip, undo
// and remove. These drive its callback by hand against a really mounted
// component. SSR markup (names, fields, sizes) is in due-card-ssr.test.ts;
// the 'error' ordering is in dose-write-lock.test.ts.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRawSnippet, flushSync } from "svelte";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submit: null as SubmitFunction | null,
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";
import type { DashboardClock } from "$lib/components/dashboard/dashboard-clock";
import {
  STALE_TAP_MESSAGE,
  SUCCESS_FALLBACK_TOAST,
  UNDO_ACTION,
  UNDONE_TOAST,
} from "$lib/components/dashboard/dose-action";
import { fixedClock } from "./helpers/dashboard-context";
import {
  finishSubmit,
  mountDoseActionForm,
  startSubmit,
  type DoseActionFormProps,
} from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const SUCCESS = { type: "success", status: 200, data: { success: true, doseId: "d-new" } } as const;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(
  opts: {
    props?: Partial<DoseActionFormProps>;
    clock?: Partial<DashboardClock>;
    insideCard?: boolean;
  } = {},
) {
  const lock = createDoseWriteLock();
  const mounted = mountDoseActionForm({
    lock,
    clock: fixedClock(NOW, opts.clock),
    props: opts.props,
    insideCard: opts.insideCard,
  });
  destroy = mounted.destroy;
  const submit = h.submit;
  if (!submit) throw new Error("use:enhance never attached");
  return { lock, submit, ...mounted };
}

describe("DoseActionForm markup", () => {
  it("posts its fields as hidden inputs to its action", () => {
    const { form } = setup();
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(Object.fromEntries(new FormData(form))).toEqual({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-05-01T13:30:00.000Z",
    });
  });

  it("names the button by its visible label first, then the screen-reader context", () => {
    const { button } = setup();
    expect(button.hasAttribute("aria-label")).toBe(false);
    expect(accessibleName(button)).toBe("Log now: Metformin 500mg, 13:30 dose");
  });

  it("renders children before the label, which is how a chip gets its sr-only 'Log '", () => {
    const { button, form } = setup({
      props: {
        variant: "chip",
        label: "Ibuprofen 200mg ×2",
        srContext: undefined,
        quickLog: true,
        children: createRawSnippet(() => ({ render: () => `<span class="sr-only">Log </span>` })),
      },
    });
    expect(accessibleName(button)).toBe("Log Ibuprofen 200mg ×2");
    expect(form.hasAttribute("data-quick-log")).toBe(true);
  });

  it("marks only quick-log forms with data-quick-log", () => {
    expect(setup().form.hasAttribute("data-quick-log")).toBe(false);
  });

  it("is aria-disabled — never disabled — while any dose write holds the lock", () => {
    const { lock, button } = setup();
    expect(button.getAttribute("aria-disabled")).toBeNull();
    lock.acquire();
    flushSync();
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.disabled).toBe(false);
  });

  it("gives chip and danger their own fixed-height recipes", () => {
    const chip = setup({ props: { variant: "chip" } }).button;
    expect([...chip.classList]).toEqual(expect.arrayContaining(["h-11", "rounded-full"]));
    destroy?.();
    const danger = setup({ props: { variant: "danger" } }).button;
    expect([...danger.classList]).toEqual(expect.arrayContaining(["min-h-11", "text-danger-ink"]));
  });
});

describe("DoseActionForm submit", () => {
  it("cancels a submit while the lock is busy, with no toast and no request", async () => {
    const { lock, form, submit } = setup();
    lock.acquire();
    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });

  it("refuses a tap on an expired list: cancels, reloads, says so, and stays locked until the reload lands", async () => {
    const reload = deferred();
    const refresh = vi.fn(() => reload.promise);
    const { lock, form, submit } = setup({ clock: { nextRefreshAt: () => NOW, refresh } });

    const { cancel, callback } = await startSubmit(submit, form);
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).toBeNull();
    expect(refresh).toHaveBeenCalledOnce();
    expect(h.showToast).toHaveBeenCalledWith(STALE_TAP_MESSAGE, "error");

    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(lock.busy).toBe(true);

    reload.resolve();
    await flushMicrotasks();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("shows the pending label and marks its card aria-busy until the write settles", async () => {
    const { host, form, button, submit } = setup({ insideCard: true });
    const label = button.querySelector('[data-part="label"]');
    const pending = button.querySelector('[data-part="pending"]');
    expect(pending?.getAttribute("aria-hidden")).toBe("true");

    const { callback } = await startSubmit(submit, form);
    flushSync();
    expect(host.getAttribute("aria-busy")).toBe("true");
    expect(label?.getAttribute("aria-hidden")).toBe("true");
    expect(pending?.getAttribute("aria-hidden")).toBeNull();
    expect(pending?.textContent).toContain("Logging…");

    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();
    expect(host.hasAttribute("aria-busy")).toBe(false);
    expect(pending?.getAttribute("aria-hidden")).toBe("true");
  });

  it("on success: reloads first, then toasts from the reloaded data with an Undo, then focuses, then calls onSuccess", async () => {
    const order: string[] = [];
    const target = document.createElement("h1");
    target.tabIndex = -1;
    document.body.append(target);
    const buildToast = vi.fn((doseId: string | null) => {
      order.push(`toast:${doseId}`);
      return "Metformin 500mg logged at 13:00";
    });
    const focusAfter = vi.fn(() => {
      order.push("focus");
      return target;
    });
    const onSuccess = vi.fn(() => {
      order.push("onSuccess");
    });
    const { lock, form, submit } = setup({
      props: { buildToast, undoable: true, focusAfter, onSuccess },
    });

    const { callback } = await startSubmit(submit, form);
    const update = vi.fn(async () => {
      order.push("update");
    });
    await finishSubmit(callback!, form, SUCCESS, update).done;

    expect(order).toEqual(["update", "toast:d-new", "focus", "onSuccess"]);
    expect(h.showToast).toHaveBeenCalledWith(
      "Metformin 500mg logged at 13:00",
      "success",
      expect.any(Function),
    );
    expect(document.activeElement).toBe(target);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
    target.remove();
  });

  it("still toasts when the reload itself fails — the write did not", async () => {
    const buildToast = vi.fn(() => "Metformin 500mg logged at 13:00");
    const { form, submit } = setup({ props: { buildToast } });
    const { callback } = await startSubmit(submit, form);
    const update = vi.fn(async () => {
      throw new Error("load failed");
    });
    await finishSubmit(callback!, form, SUCCESS, update).done;
    expect(buildToast).toHaveBeenCalledWith("d-new");
    expect(h.showToast).toHaveBeenCalledWith(
      "Metformin 500mg logged at 13:00",
      "success",
      undefined,
    );
  });

  it("falls back to a plain toast with no Undo when there is no builder or no doseId", async () => {
    const { form, submit } = setup({ props: { undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, { type: "success", status: 200, data: { success: true } })
      .done;
    expect(h.showToast).toHaveBeenCalledWith(SUCCESS_FALLBACK_TOAST, "success", undefined);
  });

  it("Undo posts the doseId to the absolute deleteDose action, then reloads", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      text: async () => JSON.stringify({ type: "success", status: 200 }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { form, submit } = setup({ props: { buildToast: () => "logged", undoable: true } });
    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;

    const undo = h.showToast.mock.calls[0][2] as () => void;
    h.invalidateAll.mockClear();
    undo();

    await vi.waitFor(() => expect(h.invalidateAll).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UNDO_ACTION);
    expect(init?.method).toBe("POST");
    expect((init?.body as FormData).get("doseId")).toBe("d-new");
    expect(h.showToast).toHaveBeenLastCalledWith(UNDONE_TOAST, "success");
  });

  it("a 409 reloads before releasing the lock, and never runs update()", async () => {
    const reload = deferred();
    h.invalidateAll.mockImplementation(() => reload.promise);
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 409,
      data: { errors: { form: ["What's due has changed. Refresh to see what's due now."] } },
    });

    expect(h.showToast).toHaveBeenCalledWith(
      "What's due has changed. Refresh to see what's due now.",
      "error",
    );
    await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
    expect(lock.busy).toBe(true);
    expect(update).not.toHaveBeenCalled();

    reload.resolve();
    await done;
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });

  it("any other failure runs update() and releases, without a reload", async () => {
    const { lock, form, submit } = setup();
    const { callback } = await startSubmit(submit, form);
    const { update, done } = finishSubmit(callback!, form, {
      type: "failure",
      status: 404,
      data: { errors: { form: ["Medication not found"] } },
    });
    await done;
    expect(h.showToast).toHaveBeenCalledWith("Medication not found", "error");
    expect(update).toHaveBeenCalledOnce();
    expect(h.invalidateAll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
    expect(lock.busy).toBe(false);
  });
});
```

Replace `tests/unit/dose-write-lock.test.ts` with the Part A tests plus the 'error' ordering case (the whole file):

```ts
// The dashboard's page-wide dose-write lock, and the DoseActionForm path whose
// ORDERING matters most: an 'error' result means the outcome is unknown, so
// the page must not accept another tap until the reload has landed.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({
  submit: null as SubmitFunction | null,
  invalidateAll: vi.fn(async () => {}),
  showToast: vi.fn(),
}));

vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: () => h.invalidateAll() }));
vi.mock("$components/ui/Toast.svelte", () => ({
  showToast: (...args: unknown[]) => h.showToast(...args),
}));

import {
  createDoseWriteLock,
  DOSE_WRITE_COOLDOWN_MS,
} from "$lib/components/dashboard/dose-write-lock.svelte";
import { fixedClock } from "./helpers/dashboard-context";
import { finishSubmit, mountDoseActionForm, startSubmit } from "./helpers/dose-action-form-harness";

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
  h.invalidateAll.mockReset();
  h.invalidateAll.mockResolvedValue(undefined);
  h.showToast.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createDoseWriteLock", () => {
  it("cools down for 700ms by default", () => {
    expect(DOSE_WRITE_COOLDOWN_MS).toBe(700);
  });

  it("grants the lock once and refuses it while it is held", () => {
    const lock = createDoseWriteLock();
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);
  });

  it("stays busy through the whole cooldown after release, to the millisecond", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();

    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 1);
    expect(lock.busy).toBe(true);
    expect(lock.acquire()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
    expect(lock.acquire()).toBe(true);
  });

  it("honours a custom cooldown", () => {
    const lock = createDoseWriteLock({ cooldownMs: 50 });
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(49);
    expect(lock.busy).toBe(true);
    vi.advanceTimersByTime(1);
    expect(lock.busy).toBe(false);
  });

  it("ignores a release when nothing holds the lock", () => {
    const lock = createDoseWriteLock();
    lock.release();
    expect(lock.busy).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not stretch a running cooldown when released twice", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    lock.release();
    vi.advanceTimersByTime(400);
    lock.release();
    vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS - 400);
    expect(lock.busy).toBe(false);
  });
});

describe("DoseActionForm on an 'error' result (outcome unknown)", () => {
  it("toasts, then keeps the page locked until the reload has landed, then cools down", async () => {
    let finishReload!: () => void;
    h.invalidateAll.mockImplementation(() => new Promise<void>((r) => (finishReload = r)));
    const lock = createDoseWriteLock();
    const mounted = mountDoseActionForm({
      lock,
      clock: fixedClock(new Date("2026-05-01T13:00:00.000Z")),
    });
    try {
      const { callback } = await startSubmit(h.submit!, mounted.form);
      const { update, done } = finishSubmit(callback!, mounted.form, {
        type: "error",
        status: 500,
        error: { message: "Something went wrong on our end.", errorId: "a3f10c9e" },
      });

      expect(h.showToast).toHaveBeenCalledWith(
        "Something went wrong on our end. (reference a3f10c9e)",
        "error",
      );
      // release() has NOT run: a retry now would act on the list the failed
      // request may already have changed.
      await vi.advanceTimersByTimeAsync(DOSE_WRITE_COOLDOWN_MS * 3);
      expect(lock.busy).toBe(true);
      expect(update).not.toHaveBeenCalled();

      finishReload();
      await done;
      expect(lock.busy).toBe(true); // the cooldown starts only now
      vi.advanceTimersByTime(DOSE_WRITE_COOLDOWN_MS);
      expect(lock.busy).toBe(false);
    } finally {
      mounted.destroy();
    }
  });
});
```

Create `tests/unit/helpers/dom-names.ts` (the dose-action-form test imports `accessibleName`; Part H reuses the rest):

```ts
/**
 * Accessible-name reading for components that name their buttons with visible
 * text plus an sr-only suffix and NEVER with aria-label (callers assert that).
 * JSDOM has no CSS, so "visible" means "not aria-hidden and not .sr-only".
 */
const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

function textWithout(el: Element, selector: string): string {
  const clone = el.cloneNode(true) as Element;
  clone.querySelectorAll(selector).forEach((node) => node.remove());
  return squash(clone.textContent);
}

export const textOf = (el: Element) => squash(el.textContent);
export const accessibleName = (el: Element) => textWithout(el, '[aria-hidden="true"]');
export const visibleLabel = (el: Element) => textWithout(el, '[aria-hidden="true"], .sr-only');

export function buttonNamed(root: ParentNode, name: string): HTMLButtonElement {
  const buttons = [...root.querySelectorAll("button")];
  const found = buttons.find((b) => accessibleName(b) === name);
  if (!found) {
    throw new Error(`no button named "${name}"; found: ${buttons.map(accessibleName).join(" | ")}`);
  }
  return found;
}

export function hiddenFields(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(
    [...form.querySelectorAll<HTMLInputElement>('input[type="hidden"]')].map((i) => [
      i.name,
      i.value,
    ]),
  );
}
```

- [ ] **Step 27: Run tests to verify they fail**

Run: `npx vitest run tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts`
Expected: FAIL — both files fail to load with `Failed to resolve import "$lib/components/dashboard/DoseActionForm.svelte"` (from the harness) / `"$lib/components/dashboard/dose-action"`.

- [ ] **Step 28: Write minimal implementation**

Create `src/lib/components/dashboard/dose-action.ts`:

```ts
/**
 * Endpoints and copy DoseActionForm owns, separate from the component so tests
 * import them without rendering it.
 */

/**
 * Absolute, not `?/deleteDose`: the Toast is mounted once in the (app) layout
 * and outlives navigation, so a relative action would post to whichever page
 * the user has moved to.
 */
export const UNDO_ACTION = "/dashboard?/deleteDose";

/** The client-side stale guard: the payload expired before the tap. The server check on Log now is the authority. */
export const STALE_TAP_MESSAGE = "The list just updated — check it and tap again";

/** The success toast when the caller supplied no builder, or its builder had nothing to say. */
export const SUCCESS_FALLBACK_TOAST = "Saved";

/** After the toast's Undo removed the dose. */
export const UNDONE_TOAST = "Undone";
```

Create `src/lib/components/dashboard/DoseActionForm.svelte`:

```svelte
<script lang="ts">
  import { tick, type Snippet } from "svelte";
  import type { ActionResult, SubmitFunction } from "@sveltejs/kit";
  import { deserialize, enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import { showToast } from "$components/ui/Toast.svelte";
  import { actionErrorMessage } from "$lib/utils/form-errors";
  import { getDashboardClock } from "./dashboard-clock";
  import { getDoseWriteLock } from "./dose-write-lock.svelte";
  import {
    STALE_TAP_MESSAGE,
    SUCCESS_FALLBACK_TOAST,
    UNDO_ACTION,
    UNDONE_TOAST,
  } from "./dose-action";

  type Variant = "primary" | "secondary" | "quiet" | "chip" | "danger";

  let {
    action,
    fields,
    label,
    srContext,
    pendingLabel,
    variant,
    quickLog = false,
    buildToast,
    undoable = false,
    focusAfter,
    onSuccess,
    children,
    class: className = "",
  }: {
    /** The form action, e.g. "?/logDose". */
    action: string;
    /** Posted verbatim as hidden inputs. */
    fields: Record<string, string>;
    /** The visible label — the start of the accessible name (WCAG 2.5.3). */
    label: string;
    /** Screen-reader-only context appended to the label, e.g. ": Metformin 500mg, 11:00 dose". */
    srContext?: string;
    /** Shown with a spinner while pending: "Logging…", "Recording…", "Skipping…", "Removing…". */
    pendingLabel: string;
    variant: Variant;
    /** Marks the form `data-quick-log`: the ONLY forms the 1–9 shortcuts may submit. */
    quickLog?: boolean;
    /** Called AFTER the reload with the returned doseId; builds the toast from the reloaded data. */
    buildToast?: (doseId: string | null) => string | null;
    /** Attach an Undo to the success toast (needs a doseId in the result). */
    undoable?: boolean;
    /** Where focus goes after success. Never another write button. */
    focusAfter?: () => HTMLElement | null;
    onSuccess?: () => void;
    /** Rendered inside the button BEFORE the label (a chip's sr-only "Log " and its glyph). */
    children?: Snippet;
    /** Classes for the <form> (layout inside the parent); the button's look is the variant's. */
    class?: string;
  } = $props();

  const lock = getDoseWriteLock();
  const clock = getDashboardClock();

  let pending = $state(false);

  // Fixed heights, never padding-derived: data-density="compact" rewrites only
  // .p-5, .p-6 and .py-2.5 (app.css), so none of these can shrink a target.
  const VARIANTS: Record<Variant, string> = {
    primary:
      "h-12 min-w-26 rounded-lg bg-accent px-4 text-base font-semibold text-accent-fg hover:brightness-110",
    secondary:
      "h-11 rounded-lg border border-border-strong px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    quiet:
      "h-11 min-w-11 rounded-lg px-3 text-sm font-medium text-text-secondary hover:bg-surface-overlay",
    chip: "h-11 rounded-full px-3 text-sm font-medium text-text-primary hover:bg-surface-overlay",
    danger: "min-h-11 rounded-lg px-3 text-sm font-medium text-danger-ink hover:bg-surface-overlay",
  };

  /** invalidateAll, but a failed reload leaves the page as it was instead of throwing out of the callback. */
  async function reload(): Promise<void> {
    try {
      await invalidateAll();
    } catch {
      // The data stays as it was; the next tap is re-checked on the server.
    }
  }

  async function undoDose(doseId: string): Promise<void> {
    const body = new FormData();
    body.set("doseId", doseId);
    try {
      const response = await fetch(UNDO_ACTION, {
        method: "POST",
        body,
        headers: { accept: "application/json" },
      });
      const result = deserialize(await response.text()) as ActionResult;
      if (result.type === "success") showToast(UNDONE_TOAST, "success");
      else showToast(actionErrorMessage(result), "error");
    } catch (error) {
      // A network failure never reaches `deserialize`.
      showToast(actionErrorMessage({ type: "error", error }), "error");
    }
    await reload();
  }

  const submit: SubmitFunction = ({ cancel, formElement }) => {
    if (!lock.acquire()) {
      cancel();
      return;
    }
    // Server-relative: comparing with raw Date.now() would refuse every tap
    // near a boundary on a device whose clock runs fast.
    if (clock.serverNow().getTime() >= clock.nextRefreshAt().getTime()) {
      cancel();
      showToast(STALE_TAP_MESSAGE, "error");
      // Hold the lock through the reload, so nothing is tapped on the old list.
      clock.refresh().then(
        () => lock.release(),
        () => lock.release(),
      );
      return;
    }

    // Read every caller-supplied value NOW. The response usually re-renders
    // this row away, and the callback must not read props of a component the
    // reload has unmounted.
    const build = buildToast;
    const withUndo = undoable;
    const focusTarget = focusAfter;
    const afterSuccess = onSuccess;
    const card = formElement.closest<HTMLElement>("[data-dose-card]");
    pending = true;
    card?.setAttribute("aria-busy", "true");

    return async ({ result, update }) => {
      try {
        if (result.type === "success") {
          const doseId = typeof result.data?.doseId === "string" ? result.data.doseId : null;
          try {
            await update();
            await tick();
          } catch {
            // The write succeeded; only the reload failed. The builder falls back.
          }
          const message = build?.(doseId) ?? SUCCESS_FALLBACK_TOAST;
          showToast(
            message,
            "success",
            withUndo && doseId ? () => void undoDose(doseId) : undefined,
          );
          focusTarget?.()?.focus();
          afterSuccess?.();
        } else if (result.type === "failure") {
          showToast(actionErrorMessage(result), "error");
          // update() does not re-run the load for a failure, and a 409 means
          // the button that failed is stale.
          if (result.status === 409) await reload();
          else await update();
        } else if (result.type === "error") {
          // Outcome unknown: reload BEFORE releasing, so any retry acts on fresh data.
          showToast(actionErrorMessage(result), "error");
          await reload();
        } else {
          await update();
        }
      } finally {
        pending = false;
        card?.removeAttribute("aria-busy");
        lock.release();
      }
    };
  };
</script>

<form
  method="POST"
  {action}
  class={className}
  data-quick-log={quickLog ? "" : undefined}
  use:enhance={submit}
>
  {#each Object.entries(fields) as [name, value] (name)}
    <input type="hidden" {name} {value} />
  {/each}
  <!-- aria-disabled, never `disabled`: the disabled attribute drops keyboard
       focus to <body>. A busy tap is cancelled in `submit` instead. The label
       and the pending label share one grid cell, so the pressed button keeps
       its width. -->
  <button
    type="submit"
    aria-disabled={lock.busy ? "true" : undefined}
    class="inline-flex items-center justify-center transition-colors aria-disabled:cursor-not-allowed {VARIANTS[
      variant
    ]}"
  >
    <span class="inline-grid">
      <span
        data-part="label"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {pending
          ? 'invisible'
          : ''}"
        aria-hidden={pending ? "true" : undefined}
        >{@render children?.()}<span
          >{label}{#if srContext}<span class="sr-only">{srContext}</span>{/if}</span
        ></span
      >
      <span
        data-part="pending"
        class="col-start-1 row-start-1 inline-flex items-center justify-center gap-2 {pending
          ? ''
          : 'invisible'}"
        aria-hidden={pending ? undefined : "true"}
        ><span
          class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        ></span>{pendingLabel}</span
      >
    </span>
  </button>
</form>
```

- [ ] **Step 29: Run tests to verify they pass**

Run: `npx prettier --write src/lib/components/dashboard/dose-action.ts src/lib/components/dashboard/DoseActionForm.svelte tests/unit/helpers/dashboard-context.ts tests/unit/helpers/dose-action-form-harness.ts tests/unit/helpers/dom-names.ts tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts && npx vitest run tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts`
Expected: PASS (dose-action-form: 15 tests; dose-write-lock: 7 tests). If "names the button by its visible label first" fails with a space before the colon, Prettier split `{label}` from the sr-only `<span>`: rejoin them with no whitespace between `{label}` and `<span class="sr-only">`.

- [ ] **Step 30: Prove by mutation**

1. In `DoseActionForm.svelte`, delete `lock.release();` from the `finally` block and add it as the first statement of the returned callback (`return async ({ result, update }) => { lock.release(); try { …`). Run `npx vitest run tests/unit/dose-write-lock.test.ts`: "toasts, then keeps the page locked until the reload has landed, then cools down" must FAIL. Restore.
2. Replace `if (result.status === 409) await reload(); else await update();` with `await update();`. Run `npx vitest run tests/unit/dose-action-form.test.ts`: "a 409 reloads before releasing the lock, and never runs update()" must FAIL. Restore.
3. Replace `aria-disabled={lock.busy ? "true" : undefined}` with `disabled={lock.busy}`. Run the file: "is aria-disabled — never disabled — while any dose write holds the lock" must FAIL. Restore and re-run both files: PASS.

- [ ] **Step 31: Commit**

```bash
git add vite.config.ts src/lib/components/dashboard/dose-action.ts src/lib/components/dashboard/DoseActionForm.svelte tests/unit/helpers/dashboard-context.ts tests/unit/helpers/dose-action-form-harness.ts tests/unit/helpers/dom-names.ts tests/unit/dose-action-form.test.ts tests/unit/dose-write-lock.test.ts
git commit -m "feat(dashboard): add DoseActionForm, the one enhance path for dose writes"
```

---

#### Part F — the log toast from reloaded data

- [ ] **Step 32: Write the failing test**

Create `tests/unit/dose-toasts.test.ts`:

```ts
// The Log now / chip toast states what the matcher ACTUALLY did, read off the
// reloaded Done row for the returned doseId — never what the client guessed.
import { describe, it, expect } from "vitest";
import { logToastFromReload } from "$lib/components/dashboard/dose-toasts";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";

const TZ = "UTC";
const TODAY_START = "2026-05-01T00:00:00.000Z";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const COVERING: DoneRow = {
  key: "d1",
  dose: dose({ id: "d1", quantity: 4 }),
  covers: ["2026-05-01T08:55:00.000Z", "2026-05-01T09:00:00.000Z", "2026-05-01T11:00:00.000Z"],
  dayLabel: null,
};

const FALLBACK = {
  label: "Metformin 500mg",
  quantity: 1,
  takenAt: new Date("2026-05-01T13:31:00.000Z"),
  todayStart: new Date(TODAY_START),
};

const plain = toastForLog({ ...FALLBACK, covers: [], tz: TZ, timeFormat: "24h" });

describe("logToastFromReload", () => {
  it("builds the toast from the reloaded Done row: its quantity, time and covered slots", () => {
    const got = logToastFromReload(
      { done: [COVERING], todayStart: TODAY_START },
      "d1",
      FALLBACK,
      TZ,
      "24h",
    );
    expect(got).toBe(
      toastForLog({
        label: formatDoseLabel("Metformin", "500", "mg"),
        quantity: 4,
        takenAt: new Date("2026-05-01T13:31:00.000Z"),
        covers: COVERING.covers.map((c) => new Date(c)),
        todayStart: new Date(TODAY_START),
        tz: TZ,
        timeFormat: "24h",
      }),
    );
    expect(got).toContain("8:55"); // formatUserTime does not pad a single-digit hour
  });

  it("falls back to the plain sentence when the reload has no row for the dose", () => {
    expect(
      logToastFromReload(
        { done: [COVERING], todayStart: TODAY_START },
        "other",
        FALLBACK,
        TZ,
        "24h",
      ),
    ).toBe(plain);
  });

  it("falls back when the action returned no doseId", () => {
    expect(
      logToastFromReload({ done: [COVERING], todayStart: TODAY_START }, null, FALLBACK, TZ, "24h"),
    ).toBe(plain);
  });

  it("falls back when the reload produced no dashboard payload at all", () => {
    expect(logToastFromReload(undefined, "d1", FALLBACK, TZ, "24h")).toBe(plain);
    expect(logToastFromReload({ done: "nope" }, "d1", FALLBACK, TZ, "24h")).toBe(plain);
  });
});
```

- [ ] **Step 33: Run test to verify it fails**

Run: `npx vitest run tests/unit/dose-toasts.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/dose-toasts"`.

- [ ] **Step 34: Write minimal implementation**

Create `src/lib/components/dashboard/dose-toasts.ts`:

```ts
import type { DoneRow } from "$lib/types";
import type { TimeFormat } from "$lib/utils/time";
import { formatDoseLabel, toastForLog } from "$lib/utils/dashboard-copy";

/** What the log toast says when the reload cannot tell us what the matcher did. */
export interface LogToastFallback {
  label: string;
  quantity: number;
  takenAt: Date;
  todayStart: Date;
}

/**
 * The success toast for Log now and the chips, built from the RELOADED page
 * data so it states what the matcher actually did ("— counted for your 08:55,
 * 09:00 and 11:00 doses"), never what the client guessed it would do.
 *
 * `reloaded` is `page.data` (from `$app/state`) after `update()`. It is
 * `unknown` because this reads only two keys and must survive the reload
 * having failed — then it is the old payload, or not a dashboard payload at
 * all. Anything short of a Done row for `doseId` falls back to the plain
 * "logged at" sentence with no "counted for" clause.
 */
export function logToastFromReload(
  reloaded: unknown,
  doseId: string | null,
  fallback: LogToastFallback,
  tz: string,
  timeFormat: TimeFormat,
): string {
  const data = (reloaded ?? {}) as { done?: unknown; todayStart?: unknown };
  const done = Array.isArray(data.done) ? (data.done as DoneRow[]) : [];
  const row = doseId === null ? undefined : done.find((r) => r.dose.id === doseId);
  if (!row || typeof data.todayStart !== "string") {
    return toastForLog({ ...fallback, covers: [], tz, timeFormat });
  }
  const med = row.dose.medication;
  return toastForLog({
    label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
    quantity: row.dose.quantity,
    takenAt: new Date(row.dose.takenAt),
    covers: row.covers.map((iso) => new Date(iso)),
    todayStart: new Date(data.todayStart),
    tz,
    timeFormat,
  });
}
```

- [ ] **Step 35: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/dose-toasts.ts tests/unit/dose-toasts.test.ts && npx vitest run tests/unit/dose-toasts.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 36: Prove by mutation**

Replace the body of `logToastFromReload` after the `const row = …` line with `return toastForLog({ ...fallback, covers: [], tz, timeFormat });`. Run the file: "builds the toast from the reloaded Done row: its quantity, time and covered slots" must FAIL. Restore and re-run: PASS.

- [ ] **Step 37: Commit**

```bash
git add src/lib/components/dashboard/dose-toasts.ts tests/unit/dose-toasts.test.ts
git commit -m "feat(dashboard): build the log toast from the reloaded Done row"
```

---

#### Part G — focus targets

- [ ] **Step 38: Write the failing test**

Create `tests/unit/dashboard-focus.test.ts`:

```ts
// After a Due row resolves: the same card's <li> if it survived the reload,
// else the next card that was below it, else (the caller's fallback) the h1.
// Never another write button — a repeated Enter must not log a different
// medication.
import { describe, it, expect, afterEach } from "vitest";
import { focusTargetAfterResolve } from "$lib/components/dashboard/focus-after";
import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";

function renderCards(...keys: string[]) {
  document.body.innerHTML = keys
    .map((key) => `<li tabindex="-1" data-card-key="${key}"></li>`)
    .join("");
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("focusTargetAfterResolve", () => {
  it("returns the same card when it survived the reload", () => {
    renderCards("earlier:m1", "today:m1", "today:m2");
    expect(focusTargetAfterResolve("today:m1", ["today:m2"])?.dataset.cardKey).toBe("today:m1");
  });

  it("otherwise returns the first card that was below it and still exists", () => {
    renderCards("earlier:m1", "today:m3");
    expect(focusTargetAfterResolve("today:m2", ["today:m9", "today:m3"])?.dataset.cardKey).toBe(
      "today:m3",
    );
  });

  it("never returns a card that was above it", () => {
    renderCards("earlier:m1");
    expect(focusTargetAfterResolve("today:m2", ["today:m3"])).toBeNull();
  });

  it("names the page's two fixed focus targets", () => {
    expect(DASHBOARD_HEADING_ID).toBe("dashboard-heading");
    expect(DONE_HEADING_ID).toBe("done-heading");
  });
});
```

- [ ] **Step 39: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-focus.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/focus-after"`.

- [ ] **Step 40: Write minimal implementation**

Create `src/lib/components/dashboard/dom-ids.ts`:

```ts
/** DashboardHeader's `<h1>`: the last-resort focus target after a Due row resolves. */
export const DASHBOARD_HEADING_ID = "dashboard-heading";

/** DoneList's `<h2>`: focus lands here after Remove or Undo skip. Always rendered. */
export const DONE_HEADING_ID = "done-heading";
```

Create `src/lib/components/dashboard/focus-after.ts`:

```ts
/**
 * Where focus goes after a Due row resolves: the same card if it survived
 * the reload, else the first card that was rendered BELOW it and still
 * exists, else null (the caller then uses its fallback, the page's h1).
 *
 * `followingKeys` must be captured at the moment of the tap: after the
 * reload the resolved card is gone and the DOM can no longer say what came
 * after it. DueCard snapshots it in `onsubmitcapture`.
 */
export function focusTargetAfterResolve(
  cardKey: string,
  followingKeys: readonly string[],
  root: ParentNode = document,
): HTMLElement | null {
  const cards = new Map<string, HTMLElement>();
  for (const el of root.querySelectorAll<HTMLElement>("[data-card-key]")) {
    const key = el.dataset.cardKey;
    if (key) cards.set(key, el);
  }
  const same = cards.get(cardKey);
  if (same) return same;
  for (const key of followingKeys) {
    const next = cards.get(key);
    if (next) return next;
  }
  return null;
}
```

- [ ] **Step 41: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/dom-ids.ts src/lib/components/dashboard/focus-after.ts tests/unit/dashboard-focus.test.ts && npx vitest run tests/unit/dashboard-focus.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 42: Prove by mutation**

Delete the two lines `const same = cards.get(cardKey);` / `if (same) return same;`. Run the file: "returns the same card when it survived the reload" must FAIL. Restore and re-run: PASS.

- [ ] **Step 43: Commit**

```bash
git add src/lib/components/dashboard/dom-ids.ts src/lib/components/dashboard/focus-after.ts tests/unit/dashboard-focus.test.ts
git commit -m "feat(dashboard): add focus targets for a resolved row"
```

---

#### Part H — DueCard

- [ ] **Step 44: Write the failing test**

Create `tests/unit/due-card-ssr.test.ts`:

```ts
// @vitest-environment node
//
// DueCard's SSR markup: what each button posts, what it is called, how tall
// it is, and axe on the result. `node` is load-bearing — see
// tests/unit/error-page-ssr.test.ts.
//
// The spec lists axe's button-name, label-in-name, list and target-size.
// Under JSDOM only some of those work AS AXE RULES, so the rest are asserted
// directly:
//   - axe has no "label-in-name" id; its WCAG 2.5.3 rule
//     (label-content-name-mismatch) is experimental and returns `incomplete`
//     without a canvas. "Every name starts with its visible label" is below.
//   - `list` does not apply to <ul role="list"> (axe's no-role-matches), so
//     `listitem` and `aria-required-children` check the list structure.
//   - `target-size` passes a 10×10px button under JSDOM: nothing has layout.
//     The fixed height classes are asserted instead.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { DueCard as DueCardData, DueRow } from "$lib/types";
import { formatSlotTime, rowStatusLine } from "$lib/utils/dashboard-copy";

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$app/state", () => ({ page: { data: {} } }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DueCard from "$lib/components/dashboard/DueCard.svelte";
import { createDoseWriteLock } from "$lib/components/dashboard/dose-write-lock.svelte";
import { dashboardContext } from "./helpers/dashboard-context";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import {
  accessibleName,
  buttonNamed,
  hiddenFields,
  textOf,
  visibleLabel,
} from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const TZ = "UTC";

function row(expectedTime: string, overrides: Partial<DueRow> = {}): DueRow {
  return {
    key: `row@${expectedTime}`,
    kind: "fixed_time",
    expectedTime,
    state: "overdue",
    logNow: false,
    tookItAt: expectedTime,
    skipAt: expectedTime,
    ...overrides,
  };
}

// Top row: due in 30 minutes and the Log-now target. Its Skip is at `now`
// (a skip is never future-dated) and Took it at is absent (composition's
// presentation rule). Nested, latest first: 11:00 overdue with Took it at +
// Skip; 09:00, which the simulations proved offers nothing.
const TODAY_CARD: DueCardData = {
  key: "today:m1",
  medicationId: "m1",
  name: "Metformin",
  dosageAmount: "500",
  dosageUnit: "mg",
  colour: "#6366f1",
  colourSecondary: null,
  pattern: "solid",
  rows: [
    row("2026-05-01T13:30:00.000Z", {
      state: "due-now",
      logNow: true,
      tookItAt: null,
      skipAt: "2026-05-01T13:00:00.000Z",
    }),
    row("2026-05-01T11:00:00.000Z"),
    row("2026-05-01T09:00:00.000Z", { tookItAt: null, skipAt: null }),
  ],
};

const EARLIER_CARD: DueCardData = {
  key: "earlier:m2",
  medicationId: "m2",
  name: "Lisinopril",
  dosageAmount: "10",
  dosageUnit: "mg",
  colour: "#10b981",
  colourSecondary: "#064e3b",
  pattern: "stripes",
  rows: [row("2026-04-30T22:00:00.000Z", { state: "earlier", logNow: true })],
};

const OVERDUE_CARD: DueCardData = {
  ...TODAY_CARD,
  key: "today:m3",
  medicationId: "m3",
  rows: [row("2026-05-01T11:00:00.000Z")],
};

function renderCard(card: DueCardData, lock = createDoseWriteLock()): Document {
  const { body } = render(DueCard, {
    props: {
      card,
      serverNow: NOW,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      focusAfter: () => null,
    },
    context: dashboardContext({ lock, now: NOW }),
  });
  return ssrDocument(`<ul role="list">${body}</ul>`);
}

function cardItem(doc: Document): HTMLLIElement {
  const li = doc.querySelector<HTMLLIElement>("li[data-card-key]");
  if (!li) throw new Error("no card <li> rendered");
  return li;
}

const formOf = (button: HTMLButtonElement) => {
  const form = button.closest("form");
  if (!form) throw new Error(`"${accessibleName(button)}" is not inside a form`);
  return form;
};

const statusLine = (r: DueRow) =>
  rowStatusLine(
    { state: r.state, expectedTime: new Date(r.expectedTime) },
    NOW,
    TODAY_START,
    TZ,
    "24h",
  );

describe("DueCard", () => {
  it("is a focusable list item named by the medication and its dose", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    expect(li.getAttribute("tabindex")).toBe("-1");
    expect(li.dataset.cardKey).toBe("today:m1");
    expect(li.hasAttribute("data-dose-card")).toBe(true);
    expect(li.hasAttribute("aria-busy")).toBe(false);
    const labelledBy = li.getAttribute("aria-labelledby");
    const nameEl = labelledBy ? li.ownerDocument.getElementById(labelledBy) : null;
    expect(nameEl && textOf(nameEl)).toBe("Metformin 500mg");
  });

  it("Log now posts the row's own instant as forSlot, and no takenAt", () => {
    const form = formOf(
      buttonNamed(renderCard(TODAY_CARD), "Log now: Metformin 500mg, 13:30 dose"),
    );
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(hiddenFields(form)).toEqual({
      medicationId: "m1",
      quantity: "1",
      forSlot: "2026-05-01T13:30:00.000Z",
    });
  });

  it("Took it at posts the slot's instant as takenAt", () => {
    const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Took it at 11:00: Metformin 500mg"));
    expect(form.getAttribute("action")).toBe("?/logDose");
    expect(hiddenFields(form)).toEqual({
      medicationId: "m1",
      quantity: "1",
      takenAt: "2026-05-01T11:00:00.000Z",
    });
  });

  it("Skip posts the shipped skipAt verbatim — for a slot still ahead, that is now", () => {
    const form = formOf(buttonNamed(renderCard(TODAY_CARD), "Skip: Metformin 500mg, 13:30 dose"));
    expect(form.getAttribute("action")).toBe("?/skipDose");
    expect(hiddenFields(form)).toEqual({ medicationId: "m1", takenAt: "2026-05-01T13:00:00.000Z" });
  });

  it("puts Log now first in tab order, then Took it at and Skip, row by row", () => {
    const names = [...renderCard(TODAY_CARD).querySelectorAll("button")].map(accessibleName);
    expect(names).toEqual([
      "Log now: Metformin 500mg, 13:30 dose",
      "Skip: Metformin 500mg, 13:30 dose",
      "Took it at 11:00: Metformin 500mg",
      "Skip: Metformin 500mg, 11:00 dose",
    ]);
  });

  it("keeps Skip out of Log now's column, so a thumb slipping off Log now cannot land on it", () => {
    const doc = renderCard(TODAY_CARD);
    const logNow = formOf(buttonNamed(doc, "Log now: Metformin 500mg, 13:30 dose"));
    const skip = formOf(buttonNamed(doc, "Skip: Metformin 500mg, 13:30 dose"));
    expect(logNow.parentElement).not.toBe(skip.parentElement);
    expect(logNow.contains(skip)).toBe(false);
  });

  it("shows every row's status line; a row proven to offer nothing still shows, with no buttons", () => {
    const doc = renderCard(TODAY_CARD);
    const li = cardItem(doc);
    for (const r of TODAY_CARD.rows) expect(textOf(li)).toContain(statusLine(r));
    const nested = [...li.querySelectorAll("ul > li")];
    const nineOClock = nested.find((el) => textOf(el).includes(statusLine(TODAY_CARD.rows[2])));
    expect(nineOClock).toBeDefined();
    expect(nineOClock!.querySelectorAll("button")).toHaveLength(0);
  });

  it("nests the other rows, latest first, under one name and one glyph", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    const nestedList = li.querySelector("ul");
    expect(nestedList?.getAttribute("role")).toBe("list");
    const nested = [...(nestedList?.children ?? [])].map(textOf);
    expect(nested).toHaveLength(2);
    expect(nested[0]).toContain(statusLine(TODAY_CARD.rows[1]));
    expect(nested[1]).toContain(statusLine(TODAY_CARD.rows[2]));
    const glyphs = li.querySelectorAll("[data-medication-glyph]");
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0].getAttribute("data-medication-glyph")).toBe("md");
    expect(li.querySelectorAll('[id^="due-name-"]')).toHaveLength(1);
  });

  it("marks due-now and overdue rows with their own named markers", () => {
    const li = cardItem(renderCard(TODAY_CARD));
    const labels = [...li.querySelectorAll('[role="img"]')].map((m) =>
      m.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Due now", "Overdue", "Overdue"]);
    const earlier = cardItem(renderCard(EARLIER_CARD));
    expect(earlier.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Overdue");
  });

  it("borders the card by its top row: accent when due now, amber when overdue or earlier", () => {
    expect(cardItem(renderCard(TODAY_CARD)).classList.contains("border-accent-ink/50")).toBe(true);
    expect(cardItem(renderCard(TODAY_CARD)).classList.contains("border-warning/50")).toBe(false);
    expect(cardItem(renderCard(OVERDUE_CARD)).classList.contains("border-warning/50")).toBe(true);
    expect(cardItem(renderCard(EARLIER_CARD)).classList.contains("border-warning/50")).toBe(true);
  });

  it("never fades, dashes or tints a row that needs action", () => {
    const doc = renderCard(TODAY_CARD);
    expect(doc.querySelectorAll('[class*="opacity-"], [class*="border-dashed"]')).toHaveLength(0);
  });

  it("names an Earlier row's buttons with its day", () => {
    const at = formatSlotTime(new Date("2026-04-30T22:00:00.000Z"), TODAY_START, TZ, "24h");
    expect(at).toBe("yesterday 22:00");
    const names = [...renderCard(EARLIER_CARD).querySelectorAll("button")].map(accessibleName);
    expect(names).toEqual([
      `Log now: Lisinopril 10mg, ${at} dose`,
      `Took it at ${at}: Lisinopril 10mg`,
      `Skip: Lisinopril 10mg, ${at} dose`,
    ]);
  });

  it("names every button by its visible label first, context after, never by aria-label (WCAG 2.5.3)", () => {
    for (const card of [TODAY_CARD, EARLIER_CARD]) {
      for (const button of renderCard(card).querySelectorAll("button")) {
        expect(button.hasAttribute("aria-label")).toBe(false);
        expect(button.hasAttribute("aria-labelledby")).toBe(false);
        const visible = visibleLabel(button);
        expect(visible.length).toBeGreaterThan(0);
        expect(accessibleName(button).startsWith(visible)).toBe(true);
      }
    }
  });

  it("keeps every dose control at least 44px tall, and Log now 48px × 104px", () => {
    const doc = renderCard(TODAY_CARD);
    const logNow = buttonNamed(doc, "Log now: Metformin 500mg, 13:30 dose");
    expect([...logNow.classList]).toEqual(
      expect.arrayContaining(["h-12", "min-w-26", "bg-accent"]),
    );
    const skip = buttonNamed(doc, "Skip: Metformin 500mg, 11:00 dose");
    expect([...skip.classList]).toEqual(expect.arrayContaining(["h-11", "min-w-11"]));
    const took = buttonNamed(doc, "Took it at 11:00: Metformin 500mg");
    expect([...took.classList]).toEqual(expect.arrayContaining(["h-11", "border-border-strong"]));
    for (const button of doc.querySelectorAll("button")) {
      // data-density="compact" rewrites only .p-5, .p-6 and .py-2.5 (app.css).
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["p-5"]));
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["p-6"]));
      expect([...button.classList]).not.toEqual(expect.arrayContaining(["py-2.5"]));
    }
  });

  it("marks every dose control aria-disabled — never disabled — while a write holds the lock", () => {
    const lock = createDoseWriteLock();
    lock.acquire();
    const buttons = [...renderCard(TODAY_CARD, lock).querySelectorAll("button")];
    expect(buttons.length).toBe(4);
    for (const button of buttons) {
      expect(button.getAttribute("aria-disabled")).toBe("true");
      expect(button.hasAttribute("disabled")).toBe(false);
    }
  });

  it("passes axe: button-name, listitem, aria-required-children, aria-prohibited-attr, nested-interactive", async () => {
    const rules = [
      "button-name",
      "listitem",
      "aria-required-children",
      "aria-prohibited-attr",
      "nested-interactive",
    ];
    for (const card of [TODAY_CARD, EARLIER_CARD]) {
      const results = await runAxe(renderCard(card), rules);
      const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
      expect(offenders, offenders.join("\n")).toEqual([]);
      for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
    }
  });
});
```

- [ ] **Step 45: Run test to verify it fails**

Run: `npx vitest run tests/unit/due-card-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/DueCard.svelte"`.

- [ ] **Step 46: Write minimal implementation**

Create `src/lib/components/dashboard/DueCard.svelte`:

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import type { DueCard as DueCardData, DueRow } from "$lib/types";
  import type { TimeFormat } from "$lib/utils/time";
  import {
    formatDoseLabel,
    formatSlotTime,
    rowStatusLine,
    toastForSkip,
    toastForTookItAt,
  } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";
  import { getDashboardClock } from "./dashboard-clock";
  import { logToastFromReload } from "./dose-toasts";
  import { focusTargetAfterResolve } from "./focus-after";
  import type { StatusMarkerState } from "./status-marker";

  let {
    card,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
    focusAfter,
  }: {
    /** Rows arrive ordered by the composition: top row first, the rest latest first. */
    card: DueCardData;
    serverNow: Date;
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    /** Focus target when neither this card nor any card rendered after it survives the reload. The page passes its h1. */
    focusAfter: () => HTMLElement | null;
  } = $props();

  const clock = getDashboardClock();

  const top = $derived(card.rows[0]);
  const rest = $derived(card.rows.slice(1));
  const doseLabel = $derived(formatDoseLabel(card.name, card.dosageAmount, card.dosageUnit));
  const nameId = $derived(`due-name-${card.key}`);
  const border = $derived(top.state === "due-now" ? "border-accent-ink/50" : "border-warning/50");

  function markerFor(row: DueRow): StatusMarkerState {
    return row.state === "due-now" ? "due-now" : "overdue";
  }

  /**
   * Everything one row's buttons need, resolved to plain values NOW. The toast
   * builders run after the reload, when this card has often unmounted because
   * its row resolved — so they close over values, never over props.
   */
  function rowView(row: DueRow) {
    const slot = new Date(row.expectedTime);
    const label = doseLabel;
    const dayStart = todayStart;
    const tz = timezone;
    const tf = timeFormat;
    const tookToast = toastForTookItAt({
      label,
      at: slot,
      todayStart: dayStart,
      tz,
      timeFormat: tf,
    });
    const skipToast = toastForSkip({ label, slot, todayStart: dayStart, tz, timeFormat: tf });
    return {
      time: formatSlotTime(slot, dayStart, tz, tf),
      status: rowStatusLine({ state: row.state, expectedTime: slot }, serverNow, dayStart, tz, tf),
      tookToast: () => tookToast,
      skipToast: () => skipToast,
      logNowToast: (doseId: string | null) =>
        logToastFromReload(
          page.data,
          doseId,
          { label, quantity: 1, takenAt: clock.serverNow(), todayStart: dayStart },
          tz,
          tf,
        ),
    };
  }
  type RowView = ReturnType<typeof rowView>;

  const topView = $derived(rowView(top));

  // Which cards were rendered after this one at the moment of the tap. After
  // the reload this card may be gone, and the DOM can no longer say.
  let focusSnapshot: {
    key: string;
    following: string[];
    fallback: () => HTMLElement | null;
  } | null = null;

  function snapshotFocusOrder(event: Event & { currentTarget: EventTarget & HTMLElement }) {
    const cards = [...document.querySelectorAll<HTMLElement>("[data-card-key]")];
    const at = cards.indexOf(event.currentTarget);
    focusSnapshot = {
      key: card.key,
      following: cards.slice(at + 1).map((el) => el.dataset.cardKey ?? ""),
      fallback: focusAfter,
    };
  }

  /** The same card if it survived, else the next card, else the page's fallback (its h1). */
  function focusAfterResolve(): HTMLElement | null {
    const snap = focusSnapshot;
    if (!snap) return focusAfter();
    return focusTargetAfterResolve(snap.key, snap.following) ?? snap.fallback();
  }
</script>

{#snippet actions(row: DueRow, view: RowView)}
  {#if row.logNow}
    <DoseActionForm
      class="col-start-3 row-span-2 row-start-1"
      action="?/logDose"
      fields={{ medicationId: card.medicationId, quantity: "1", forSlot: row.expectedTime }}
      label="Log now"
      srContext={`: ${doseLabel}, ${view.time} dose`}
      pendingLabel="Logging…"
      variant="primary"
      buildToast={view.logNowToast}
      undoable
      focusAfter={focusAfterResolve}
    />
  {/if}
  {#if row.tookItAt !== null || row.skipAt !== null}
    <div class="col-start-2 mt-2 flex flex-wrap gap-2">
      {#if row.tookItAt !== null}
        <DoseActionForm
          action="?/logDose"
          fields={{ medicationId: card.medicationId, quantity: "1", takenAt: row.tookItAt }}
          label={`Took it at ${view.time}`}
          srContext={`: ${doseLabel}`}
          pendingLabel="Recording…"
          variant="secondary"
          buildToast={view.tookToast}
          undoable
          focusAfter={focusAfterResolve}
        />
      {/if}
      {#if row.skipAt !== null}
        <DoseActionForm
          action="?/skipDose"
          fields={{ medicationId: card.medicationId, takenAt: row.skipAt }}
          label="Skip"
          srContext={`: ${doseLabel}, ${view.time} dose`}
          pendingLabel="Skipping…"
          variant="quiet"
          buildToast={view.skipToast}
          undoable
          focusAfter={focusAfterResolve}
        />
      {/if}
    </div>
  {/if}
{/snippet}

<!-- Grid, not flex: Log now sits in its own right-hand column spanning both
     rows, and Took it at / Skip sit UNDER the text column — a thumb slipping
     off Log now cannot land on Skip. DOM order puts Log now first in tab order. -->
<li
  tabindex="-1"
  aria-labelledby={nameId}
  data-dose-card
  data-card-key={card.key}
  class="bg-glass rounded-xl border p-3 backdrop-blur-xl {border}"
  onsubmitcapture={snapshotFocusOrder}
>
  <div class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
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
      <p id={nameId} class="flex min-w-0 items-baseline gap-2">
        <span class="text-text-primary text-base font-semibold">{card.name}</span>
        <span class="text-text-secondary truncate text-sm"
          >{card.dosageAmount}{card.dosageUnit}</span
        >
      </p>
      <p class="text-text-primary text-sm">{topView.status}</p>
    </div>
    {@render actions(top, topView)}
  </div>

  {#if rest.length > 0}
    <ul role="list" class="border-glass-border mt-3 space-y-3 border-t pt-3">
      {#each rest as row (row.key)}
        {@const view = rowView(row)}
        <li class="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-start gap-x-3">
          <div class="row-span-2 flex justify-center pt-0.5">
            <StatusMarker state={markerFor(row)} />
          </div>
          <p class="text-text-primary min-w-0 text-sm">{view.status}</p>
          {@render actions(row, view)}
        </li>
      {/each}
    </ul>
  {/if}
</li>
```

- [ ] **Step 47: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/DueCard.svelte tests/unit/due-card-ssr.test.ts && npx vitest run tests/unit/due-card-ssr.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 48: Prove by mutation**

1. In the `actions` snippet, change `forSlot: row.expectedTime` to `takenAt: row.expectedTime`. Run the file: "Log now posts the row's own instant as forSlot, and no takenAt" must FAIL. Restore.
2. Move the `{#if row.logNow}…{/if}` block below the `{#if row.tookItAt !== null || …}` block inside `actions`. Run: "puts Log now first in tab order, then Took it at and Skip, row by row" must FAIL. Restore.
3. Change `class="col-start-3 row-span-2 row-start-1"` on the Log now form to `class="col-start-2"` and move that `{#if row.logNow}` block inside the `<div class="col-start-2 mt-2 flex flex-wrap gap-2">`. Run: "keeps Skip out of Log now's column…" must FAIL. Restore and re-run: PASS.

- [ ] **Step 49: Commit**

```bash
git add src/lib/components/dashboard/DueCard.svelte tests/unit/due-card-ssr.test.ts
git commit -m "feat(dashboard): add DueCard with row-anchored Log now, Took it at and Skip"
```

---

#### Part I — DoneList

- [ ] **Step 50: Write the failing test**

Create `tests/unit/done-list-ssr.test.ts`:

```ts
// @vitest-environment node
//
// "Done today": one row per dose event, the slots it covered, and the untimed
// alternatives to the toast's Undo (Edit → Remove, Undo skip). `node` is
// load-bearing — see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import type { DoneRow, DoseLogWithMedication } from "$lib/types";
import { formatSlotTime } from "$lib/utils/dashboard-copy";

vi.mock("$app/forms", () => ({
  enhance: () => ({ destroy() {} }),
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import DoneList from "$lib/components/dashboard/DoneList.svelte";
import { DONE_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import { dashboardContext } from "./helpers/dashboard-context";
import { evaluatedRules, runAxe, ssrDocument } from "./helpers/axe-ssr";
import {
  accessibleName,
  buttonNamed,
  hiddenFields,
  textOf,
  visibleLabel,
} from "./helpers/dom-names";

const NOW = new Date("2026-05-01T14:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");
const TZ = "UTC";

function dose(overrides: Partial<DoseLogWithMedication> = {}): DoseLogWithMedication {
  const takenAt = overrides.takenAt ?? new Date("2026-05-01T13:31:00.000Z");
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    takenAt,
    loggedAt: takenAt,
    notes: null,
    sideEffects: null,
    status: "taken",
    updatedAt: takenAt,
    medication: {
      name: "Metformin",
      dosageAmount: "500",
      dosageUnit: "mg",
      form: "tablet",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
    },
    ...overrides,
  };
}

const BACKDATED: DoneRow = {
  key: "d0",
  dose: dose({
    id: "d0",
    takenAt: new Date("2026-04-30T22:00:00.000Z"),
    loggedAt: new Date("2026-05-01T07:00:00.000Z"),
  }),
  covers: [],
  dayLabel: "yesterday",
};
const SKIPPED: DoneRow = {
  key: "d2",
  dose: dose({ id: "d2", status: "skipped", takenAt: new Date("2026-05-01T11:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const MISSED: DoneRow = {
  key: "d3",
  dose: dose({ id: "d3", status: "missed", takenAt: new Date("2026-05-01T12:00:00.000Z") }),
  covers: [],
  dayLabel: null,
};
const TAKEN: DoneRow = {
  key: "d1",
  dose: dose({ id: "d1", quantity: 4 }),
  covers: ["2026-04-30T22:30:00.000Z", "2026-05-01T08:55:00.000Z", "2026-05-01T09:00:00.000Z"],
  dayLabel: null,
};
const ROWS = [BACKDATED, SKIPPED, MISSED, TAKEN];

function renderList(rows: DoneRow[], title = "Done today"): Document {
  const { body } = render(DoneList, {
    props: {
      rows,
      title,
      todayStart: TODAY_START,
      timezone: TZ,
      timeFormat: "24h",
      onedit: () => {},
    },
    context: dashboardContext({ now: NOW }),
  });
  return ssrDocument(body);
}

const items = (doc: Document) => [...doc.querySelectorAll<HTMLLIElement>("section ul > li")];

describe("DoneList", () => {
  it("always renders its heading as a focus target, even when nothing is logged", () => {
    const doc = renderList([]);
    const section = doc.querySelector("section");
    const h2 = doc.getElementById(DONE_HEADING_ID);
    expect(section?.getAttribute("aria-labelledby")).toBe(DONE_HEADING_ID);
    expect(h2?.tagName).toBe("H2");
    expect(h2?.getAttribute("tabindex")).toBe("-1");
    expect(textOf(h2!)).toBe("Done today");
    expect(textOf(section!)).toContain("Nothing logged yet today");
  });

  it("uses the title it is given", () => {
    expect(textOf(renderList([], "Logged today").getElementById(DONE_HEADING_ID)!)).toBe(
      "Logged today",
    );
  });

  it("lists rows in the order given, each at least 44px tall", () => {
    const lis = items(renderList(ROWS));
    expect(lis).toHaveLength(4);
    for (const li of lis) expect(li.classList.contains("min-h-11")).toBe(true);
    expect(textOf(lis[3])).toContain("13:31");
  });

  it("shows a taken dose's time, marker, glyph, name, dose and quantity", () => {
    const li = items(renderList(ROWS))[3];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Taken");
    expect(li.querySelector("[data-medication-glyph]")?.getAttribute("data-medication-glyph")).toBe(
      "sm",
    );
    expect(textOf(li)).toContain("Metformin");
    expect(textOf(li)).toContain("500mg ×4");
  });

  it("states which slots a dose covered, with yesterday's prefixed", () => {
    const li = items(renderList(ROWS))[3];
    const covered = TAKEN.covers.map((c) => formatSlotTime(new Date(c), TODAY_START, TZ, "24h"));
    expect(covered[0]).toBe("yesterday 22:30");
    expect(textOf(li)).toContain(`for ${covered.join(", ")}`);
  });

  it("omits the covers line when a dose covered nothing", () => {
    expect(textOf(items(renderList(ROWS))[0])).not.toContain("for ");
  });

  it("shows a backdated Took it at as Yesterday, so it can be seen and undone", () => {
    const li = items(renderList(ROWS))[0];
    expect(textOf(li)).toContain("Yesterday");
    expect(textOf(li)).toContain("22:00");
    buttonNamed(li, "Edit: Metformin 500mg dose taken at yesterday 22:00");
  });

  it("gives a taken row an Edit button — outside any form — that says which dose", () => {
    const edit = buttonNamed(renderList(ROWS), "Edit: Metformin 500mg dose taken at 13:31");
    expect(edit.getAttribute("type")).toBe("button");
    expect(edit.closest("form")).toBeNull();
    expect([...edit.classList]).toEqual(expect.arrayContaining(["h-11", "border-border-strong"]));
  });

  it("gives a skipped row a neutral marker, the word, and an Undo skip that removes it", () => {
    const li = items(renderList(ROWS))[1];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Skipped");
    expect(textOf(li)).toContain("Skipped");
    const form = buttonNamed(li, "Undo skip: Metformin 500mg, skipped at 11:00").closest("form")!;
    expect(form.getAttribute("action")).toBe("?/deleteDose");
    expect(hiddenFields(form)).toEqual({ doseId: "d2" });
  });

  it("renders a missed row the same way, with Missed", () => {
    const li = items(renderList(ROWS))[2];
    expect(li.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Missed");
    expect(textOf(li)).toContain("Missed");
    const form = buttonNamed(li, "Remove: Metformin 500mg, missed at 12:00").closest("form")!;
    expect(hiddenFields(form)).toEqual({ doseId: "d3" });
  });

  it("has no hover-revealed controls", () => {
    expect(
      renderList(ROWS).querySelectorAll('[class*="opacity-0"], [class*="group-hover"]'),
    ).toHaveLength(0);
  });

  it("names every button by its visible label first, never by aria-label", () => {
    for (const button of renderList(ROWS).querySelectorAll("button")) {
      expect(button.hasAttribute("aria-label")).toBe(false);
      expect(accessibleName(button).startsWith(visibleLabel(button))).toBe(true);
    }
  });

  it("passes axe: button-name, listitem, aria-required-children, aria-prohibited-attr", async () => {
    const rules = ["button-name", "listitem", "aria-required-children", "aria-prohibited-attr"];
    const results = await runAxe(renderList(ROWS), rules);
    const offenders = results.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.html}`));
    expect(offenders, offenders.join("\n")).toEqual([]);
    for (const rule of rules) expect(evaluatedRules(results).has(rule), rule).toBe(true);
  });
});
```

- [ ] **Step 51: Run test to verify it fails**

Run: `npx vitest run tests/unit/done-list-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/DoneList.svelte"`.

- [ ] **Step 52: Write minimal implementation**

Create `src/lib/components/dashboard/DoneList.svelte`:

```svelte
<script lang="ts">
  import type { DoneRow, DoseLogWithMedication } from "$lib/types";
  import { formatUserTime, type TimeFormat } from "$lib/utils/time";
  import { formatDoseLabel, formatSlotTime } from "$lib/utils/dashboard-copy";
  import DoseActionForm from "./DoseActionForm.svelte";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";
  import { DONE_HEADING_ID } from "./dom-ids";

  let {
    rows,
    title,
    todayStart,
    timezone,
    timeFormat,
    onedit,
  }: {
    rows: DoneRow[];
    /** "Done today", or "Logged today" on an as-needed-only account. */
    title: string;
    /** Covered slots before this instant are prefixed "yesterday". */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
    onedit: (dose: DoseLogWithMedication) => void;
  } = $props();

  function focusDoneHeading(): HTMLElement | null {
    return document.getElementById(DONE_HEADING_ID);
  }

  function view(row: DoneRow) {
    const { dose } = row;
    const med = dose.medication;
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const time = formatUserTime(new Date(dose.takenAt), timezone, timeFormat);
    const when = row.dayLabel === "yesterday" ? `yesterday ${time}` : time;
    const covers = row.covers.map((iso) =>
      formatSlotTime(new Date(iso), todayStart, timezone, timeFormat),
    );
    const removeToast =
      dose.status === "skipped" ? `${label}: skip undone` : `${label}: missed entry removed`;
    return {
      label,
      time,
      when,
      dose: `${med.dosageAmount}${med.dosageUnit}${
        dose.status === "taken" && dose.quantity > 1 ? ` ×${dose.quantity}` : ""
      }`,
      statusWord:
        dose.status === "skipped" ? "Skipped" : dose.status === "missed" ? "Missed" : null,
      // Facts only, no verdict: the slots this dose resolved.
      coversText: covers.length > 0 ? `for ${covers.join(", ")}` : null,
      removeLabel: dose.status === "skipped" ? "Undo skip" : "Remove",
      removeToast: () => removeToast,
    };
  }
</script>

<section aria-labelledby={DONE_HEADING_ID}>
  <!-- tabindex="-1" and always rendered: focus lands here after Remove or Undo skip. -->
  <h2
    id={DONE_HEADING_ID}
    tabindex="-1"
    class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
  >
    {title}
  </h2>
  <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
    {#if rows.length === 0}
      <p class="text-text-secondary py-3 text-sm">Nothing logged yet today</p>
    {:else}
      <ul role="list" class="divide-glass-border divide-y">
        {#each rows as row (row.key)}
          {@const v = view(row)}
          <li class="flex min-h-11 items-center gap-3 py-1">
            <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
              {#if row.dayLabel === "yesterday"}<span class="block text-xs">Yesterday</span
                >{/if}{v.time}
            </span>
            <StatusMarker state={row.dose.status} />
            <MedicationGlyph
              colour={row.dose.medication.colour}
              colourSecondary={row.dose.medication.colourSecondary}
              pattern={row.dose.medication.pattern}
              size="sm"
            />
            <div class="min-w-0 flex-1">
              <p class="flex min-w-0 items-baseline gap-2 text-sm">
                <span class="text-text-primary truncate font-medium"
                  >{row.dose.medication.name}</span
                >
                <span class="text-text-secondary shrink-0">{v.dose}</span>
                {#if v.statusWord}
                  <span class="text-text-secondary shrink-0">{v.statusWord}</span>
                {/if}
              </p>
              {#if v.coversText}
                <p class="text-text-secondary truncate text-xs">{v.coversText}</p>
              {/if}
            </div>
            {#if row.dose.status === "taken"}
              <button
                type="button"
                class="border-border-strong text-text-primary hover:bg-surface-overlay h-11 shrink-0 rounded-lg border px-3 text-sm font-medium"
                onclick={() => onedit(row.dose)}
                >Edit<span class="sr-only">: {v.label} dose taken at {v.when}</span></button
              >
            {:else}
              <DoseActionForm
                class="shrink-0"
                action="?/deleteDose"
                fields={{ doseId: row.dose.id }}
                label={v.removeLabel}
                srContext={`: ${v.label}, ${row.dose.status} at ${v.when}`}
                pendingLabel="Removing…"
                variant="quiet"
                buildToast={v.removeToast}
                focusAfter={focusDoneHeading}
              />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
```

- [ ] **Step 53: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/DoneList.svelte tests/unit/done-list-ssr.test.ts && npx vitest run tests/unit/done-list-ssr.test.ts`
Expected: PASS (13 tests). If the Edit name fails with "Edit :", Prettier separated `Edit` from its `<span class="sr-only">`; rejoin them with no whitespace.

- [ ] **Step 54: Prove by mutation**

In `view()`, change the covers mapping to `formatUserTime(new Date(iso), timezone, timeFormat)`. Run the file: "states which slots a dose covered, with yesterday's prefixed" must FAIL. Restore and re-run: PASS.

- [ ] **Step 55: Commit**

```bash
git add src/lib/components/dashboard/DoneList.svelte tests/unit/done-list-ssr.test.ts
git commit -m "feat(dashboard): add DoneList with covers, Edit and Undo skip"
```

---

#### Part J — LaterList

- [ ] **Step 56: Write the failing test**

Create `tests/unit/later-list-ssr.test.ts`:

```ts
// @vitest-environment node
//
// "Later today": read-only lines for today's slots more than an hour ahead.
// `node` is load-bearing — see tests/unit/error-page-ssr.test.ts.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { LaterRow } from "$lib/types";
import { formatSlotTime } from "$lib/utils/dashboard-copy";
import { formatDuration } from "$lib/utils/time";
import LaterList from "$lib/components/dashboard/LaterList.svelte";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const NOW = new Date("2026-05-01T13:00:00.000Z");
const TODAY_START = new Date("2026-05-01T00:00:00.000Z");

const ROW: LaterRow = {
  key: "m1@20:00",
  medicationId: "m1",
  name: "Lisinopril",
  dosageAmount: "10",
  dosageUnit: "mg",
  colour: "#10b981",
  colourSecondary: null,
  pattern: "solid",
  expectedTime: "2026-05-01T20:00:00.000Z",
};

function renderList(rows: LaterRow[]): string {
  return render(LaterList, {
    props: { rows, serverNow: NOW, todayStart: TODAY_START, timezone: "UTC", timeFormat: "24h" },
  }).body;
}

describe("LaterList", () => {
  it("renders nothing when nothing is later today", () => {
    expect(
      renderList([])
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim(),
    ).toBe("");
  });

  it("renders one 40px line per slot: time, hollow marker, glyph, name, dose, and how far off", () => {
    const doc = ssrDocument(renderList([ROW]));
    const section = doc.querySelector("section");
    expect(section?.getAttribute("aria-labelledby")).toBe("later-heading");
    expect(textOf(doc.getElementById("later-heading")!)).toBe("Later today");
    const li = doc.querySelector("li");
    expect(li?.classList.contains("h-10")).toBe(true);
    expect(li?.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe("Upcoming");
    expect(
      li?.querySelector("[data-medication-glyph]")?.getAttribute("data-medication-glyph"),
    ).toBe("sm");
    const text = textOf(li!);
    expect(text).toContain(formatSlotTime(new Date(ROW.expectedTime), TODAY_START, "UTC", "24h"));
    expect(text).toContain("Lisinopril");
    expect(text).toContain("10mg");
    expect(text).toContain(`in ${formatDuration(7 * 3_600_000, { style: "long", maxUnits: 1 })}`);
  });

  it("offers no actions and takes no focus", () => {
    const html = renderList([ROW]);
    expect(html).not.toMatch(/<(button|form|a)\b/);
    expect(html).not.toContain("tabindex");
  });
});
```

- [ ] **Step 57: Run test to verify it fails**

Run: `npx vitest run tests/unit/later-list-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/LaterList.svelte"`.

- [ ] **Step 58: Write minimal implementation**

Create `src/lib/components/dashboard/LaterList.svelte`:

```svelte
<script lang="ts">
  import type { LaterRow } from "$lib/types";
  import { formatDuration, type TimeFormat } from "$lib/utils/time";
  import { formatSlotTime } from "$lib/utils/dashboard-copy";
  import MedicationGlyph from "./MedicationGlyph.svelte";
  import StatusMarker from "./StatusMarker.svelte";

  let {
    rows,
    serverNow,
    todayStart,
    timezone,
    timeFormat,
  }: {
    rows: LaterRow[];
    /** The page's server-relative 60-second tick. */
    serverNow: Date;
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
  } = $props();

  /** "in 3 hours": long style, one unit, measured on the server's clock. */
  function until(row: LaterRow): string {
    const ms = Date.parse(row.expectedTime) - serverNow.getTime();
    return `in ${formatDuration(ms, { style: "long", maxUnits: 1 })}`;
  }
</script>

<!-- Renders nothing when empty (the RefillsCard convention), so the page does not wrap it in {#if}. -->
{#if rows.length > 0}
  <section aria-labelledby="later-heading">
    <h2
      id="later-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      Later today
    </h2>
    <div class="border-glass-border bg-glass rounded-xl border px-3 backdrop-blur-xl">
      <ul role="list">
        {#each rows as row (row.key)}
          <li class="flex h-10 items-center gap-3">
            <span class="text-text-secondary min-w-14 shrink-0 text-sm tabular-nums">
              {formatSlotTime(new Date(row.expectedTime), todayStart, timezone, timeFormat)}
            </span>
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
            <span class="text-text-secondary shrink-0 text-sm">{until(row)}</span>
          </li>
        {/each}
      </ul>
    </div>
  </section>
{/if}
```

- [ ] **Step 59: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/LaterList.svelte tests/unit/later-list-ssr.test.ts && npx vitest run tests/unit/later-list-ssr.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 60: Prove by mutation**

Change `const ms = Date.parse(row.expectedTime) - serverNow.getTime();` to `const ms = Date.parse(row.expectedTime) - Date.now();`. Run the file: "renders one 40px line per slot…" must FAIL (the duration is measured from the real clock, not the 13:00 server tick). Restore and re-run: PASS.

- [ ] **Step 61: Commit**

```bash
git add src/lib/components/dashboard/LaterList.svelte tests/unit/later-list-ssr.test.ts
git commit -m "feat(dashboard): add the read-only LaterList"
```

---

#### Part K — DashboardHeader

- [ ] **Step 62: Write the failing test**

Create `tests/unit/dashboard-header-ssr.test.ts`:

```ts
// @vitest-environment node
//
// The header is the ONLY place a count appears. Its copy is
// dashboardHeaderCopy's (T6); this pins that the component renders it, the
// eyebrow date, the stable h1, and that it is not a live region.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import type { DashboardStatus } from "$lib/types";
import { dashboardHeaderCopy } from "$lib/utils/dashboard-copy";
import { formatUserDate } from "$lib/utils/time";
import DashboardHeader from "$lib/components/dashboard/DashboardHeader.svelte";
import { DASHBOARD_HEADING_ID } from "$lib/components/dashboard/dom-ids";
import { ssrDocument } from "./helpers/axe-ssr";
import { textOf } from "./helpers/dom-names";

const NOW = new Date("2026-09-24T12:00:00.000Z");
const TZ = "Europe/London";
const EYEBROW = formatUserDate(NOW, TZ, "DD/MM/YYYY", { weekday: true, year: false });

const STATUSES: DashboardStatus[] = [
  { kind: "due", dueCount: 5, doneToday: 2, totalToday: 7, loggedToday: 3, next: null },
  {
    kind: "caught-up",
    dueCount: 0,
    doneToday: 3,
    totalToday: 5,
    loggedToday: 3,
    next: {
      name: "Lisinopril",
      dosageAmount: "10",
      dosageUnit: "mg",
      expectedTime: "2026-09-24T19:00:00.000Z",
      alsoCount: 2,
    },
  },
  { kind: "all-done", dueCount: 0, doneToday: 7, totalToday: 7, loggedToday: 7, next: null },
  { kind: "none-today", dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 0, next: null },
  { kind: "as-needed-only", dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 2, next: null },
];

function renderHeader(status: DashboardStatus): Document {
  const { body } = render(DashboardHeader, {
    props: { status, serverNow: NOW, timezone: TZ, timeFormat: "24h", dateFormat: "DD/MM/YYYY" },
  });
  return ssrDocument(body);
}

describe("DashboardHeader", () => {
  it("heads the page 'Today' with a stable h1 that focus can be sent to", () => {
    const h1 = renderHeader(STATUSES[0]).querySelector("h1");
    expect(h1?.id).toBe(DASHBOARD_HEADING_ID);
    expect(h1?.getAttribute("tabindex")).toBe("-1");
    expect(textOf(h1!)).toBe("Today");
  });

  for (const status of STATUSES) {
    it(`renders the eyebrow date and dashboardHeaderCopy for "${status.kind}", supporting line only when there is one`, () => {
      const copy = dashboardHeaderCopy(status, NOW, TZ, "24h");
      const lines = [...renderHeader(status).querySelectorAll("p")].map(textOf);
      expect(lines).toEqual([
        EYEBROW,
        copy.sentence,
        ...(copy.supporting ? [copy.supporting] : []),
      ]);
    });
  }

  it("styles the sentence as the status and the supporting line as secondary", () => {
    const [, sentence, supporting] = [...renderHeader(STATUSES[0]).querySelectorAll("p")];
    expect([...sentence.classList]).toEqual(expect.arrayContaining(["text-lg", "font-semibold"]));
    expect([...supporting.classList]).toEqual(
      expect.arrayContaining(["text-sm", "text-text-secondary"]),
    );
  });

  it("is not a live region: the page's only live region is the Toast", () => {
    const doc = renderHeader(STATUSES[0]);
    expect(doc.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull();
  });
});
```

- [ ] **Step 63: Run test to verify it fails**

Run: `npx vitest run tests/unit/dashboard-header-ssr.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/components/dashboard/DashboardHeader.svelte"`.

- [ ] **Step 64: Write minimal implementation**

Create `src/lib/components/dashboard/DashboardHeader.svelte`:

```svelte
<script lang="ts">
  import type { DashboardStatus } from "$lib/types";
  import { formatUserDate, type DateFormat, type TimeFormat } from "$lib/utils/time";
  import { dashboardHeaderCopy } from "$lib/utils/dashboard-copy";
  import { DASHBOARD_HEADING_ID } from "./dom-ids";

  let {
    status,
    serverNow,
    timezone,
    timeFormat,
    dateFormat,
  }: {
    status: DashboardStatus;
    /** The page's server-relative 60-second tick. */
    serverNow: Date;
    timezone: string;
    timeFormat: TimeFormat;
    dateFormat: DateFormat;
  } = $props();

  const eyebrow = $derived(
    formatUserDate(serverNow, timezone, dateFormat, { weekday: true, year: false }),
  );
  const copy = $derived(dashboardHeaderCopy(status, serverNow, timezone, timeFormat));
</script>

<!-- A <div>, not <header>: inside <main> a header is not the banner landmark
     anyway, and this is not a live region — only the Toast is. -->
<div class="space-y-1">
  <p class="text-text-secondary text-sm">{eyebrow}</p>
  <!-- Stable "Today", and tabindex="-1": the last-resort focus target after a row resolves. -->
  <h1 id={DASHBOARD_HEADING_ID} tabindex="-1" class="text-2xl font-bold">Today</h1>
  <p class="text-lg font-semibold">{copy.sentence}</p>
  {#if copy.supporting}
    <p class="text-text-secondary text-sm">{copy.supporting}</p>
  {/if}
</div>
```

- [ ] **Step 65: Run test to verify it passes**

Run: `npx prettier --write src/lib/components/dashboard/DashboardHeader.svelte tests/unit/dashboard-header-ssr.test.ts && npx vitest run tests/unit/dashboard-header-ssr.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 66: Prove by mutation**

Delete the `{#if copy.supporting}` / `{/if}` wrapper so the supporting `<p>` always renders. Run the file: the case whose copy has `supporting: null` ("none-today" with `loggedToday: 0`, per the spec's "omitted at 0") must FAIL. Restore and re-run: PASS.

- [ ] **Step 67: Commit**

```bash
git add src/lib/components/dashboard/DashboardHeader.svelte tests/unit/dashboard-header-ssr.test.ts
git commit -m "feat(dashboard): add DashboardHeader"
```

---

#### Part L — verification

- [ ] **Step 68: Type-check, lint and run the whole suite**

Run: `npm run check`
Expected: 0 errors (these components are not mounted yet, so the existing dashboard page is untouched). The suffix-less `…/dose-write-lock.svelte` specifier resolves in svelte-check (TypeScript appends `.ts`; verified with this repo's svelte-check), so never add a `.js`/`.ts` suffix to it (decision j).

Run: `npm run lint`
Expected: no errors (warnings from `svelte/prefer-svelte-reactivity` on `new Date(...)` are acceptable; the rule is configured at "warn").

Run: `npx vitest run`
Expected: PASS — the whole suite, including the untouched `tests/unit/my-day-timeline-ssr.test.ts` (T11 deletes it).

- [ ] **Step 69: Commit any formatting the hook applied**

```bash
git status --short
# Only if files under src/lib/components/dashboard/ or tests/unit/ show as modified:
git add src/lib/components/dashboard tests/unit
git commit -m "style(dashboard): apply formatter to the dashboard building blocks"
```

---

### Task 11: Dashboard page switch, deletions, e2e and docs

**Files:**

- Create: `src/lib/utils/quick-log.ts`
- Rewrite: `src/routes/(app)/dashboard/+page.svelte` (whole file; HEAD is 156 lines)
- Rewrite: `src/lib/components/QuickLogBar.svelte` (whole file; HEAD is 126 lines)
- Modify: `src/routes/(app)/dashboard/+page.server.ts`: imports and `load` only (HEAD `:1-100`). T9 rewrote the actions, and it also inserted a refusal block between `load` and `export const actions` (the message constants and `slotTimeFailure`). Leave both untouched.
- (No focus helper here. `src/lib/components/dashboard/focus-after.ts` is T10's, and this task does not touch it.)
- Modify: `src/lib/components/KeyboardShortcuts.svelte:83-101` (the 1–9 branch), `:111` (help text)
- Modify: `src/lib/components/ui/Toast.svelte:126-127` (Undo button)
- Modify: `src/lib/components/OnboardingWelcome.svelte:80-103` (step-2 copy)
- Modify: `src/lib/types.ts:52-56`: delete `MedicationTimingStatus`
- Modify: `src/lib/utils/time.ts`: delete `computeTimingStatus` and `classifyDueStatus` (HEAD `:625-669`); fix the stale comments in the `startOfDay` doc (HEAD `:685-687`) and the `wallClockToInstant` doc (HEAD `:246`)
- Modify: `src/lib/utils/schedule.ts`: delete `TimeOfDay`, `TimeOfDayGroup`, `classifyHour`, `getLocalHour`, `groupSlotsByTimeOfDay` and `timingStatusFromSlots`, and drop `classifyDueStatus` from the `./time` import
- Modify: `src/lib/server/doses.ts`: delete `getTodaysDoses` (HEAD `:27-61`) and the `startOfDay` import if nothing else uses it
- Modify: `src/app.css`: delete `@keyframes success-flash` (HEAD `:264-274`) and `.animate-success-flash` (`:282-284`); fix the comment at `:293-295`
- Modify (comments only): `src/lib/components/walkthrough/parts/MyDaySection.svelte:2-4`, `src/lib/components/walkthrough/parts/SummaryAndRefills.svelte:2-3`, `src/lib/components/walkthrough/demo-data.ts:237`
- Delete: `src/lib/components/MyDayTimeline.svelte`, `src/lib/components/SummaryStrip.svelte`, `tests/unit/my-day-timeline-ssr.test.ts`, `tests/unit/dashboard-timing-status.test.ts`
- Test (new): `tests/unit/dashboard-page-load.test.ts`, `tests/unit/dashboard-page-ssr.test.ts`, `tests/unit/quick-log-target.test.ts`, `tests/unit/dashboard-chrome-copy.test.ts`
- Test (modify): `tests/unit/time.test.ts` (the `computeTimingStatus` import and block), `tests/unit/schedule.test.ts` (the `classifyHour`, `groupSlotsByTimeOfDay` and `timingStatusFromSlots` imports and blocks), `tests/unit/theme-tokens.test.ts:338-340, :382-385`, `tests/unit/dashboard-dose-actions.test.ts` (the `getTodaysDoses` mock line), `tests/unit/app-action-auth-guard.test.ts` (the `getTodaysDoses` mock line)
- E2E: `tests/e2e/helpers/selectors.ts:14`, `tests/e2e/helpers/auth.ts:28`, `tests/e2e/auth.test.ts:16`, `tests/e2e/accessibility.test.ts:1-4, :55, :102`, `tests/e2e/dose-logging.test.ts:21-39`
- Docs: `CLAUDE.md:36` and `:59` (insert after each), `docs/superpowers/specs/2026-08-13-due-ness-unification-design.md`

**Interfaces:**

- Consumes:
  - T6 (`$lib/types`): `DashboardPageData`, `DashboardStatus`, `DueCard`, `DueRow`, `DoneRow`, `LaterRow`. T6 (`$lib/utils/dashboard-copy`): `formatDoseLabel(name: string, dosageAmount: string, dosageUnit: string): string` and `toastForLog(i: { label: string; quantity: number; takenAt: Date; covers: Date[]; todayStart: Date; tz: string; timeFormat: TimeFormat }): string`
  - T7: `loadDashboard(userId: string, timezone: string, now: Date): Promise<Omit<DashboardPageData, "refillForecast">>` from `$lib/server/dashboard/load`; `getDosesInRange` (already in the mocks after T9)
  - T9: the `logDose` / `skipDose` / `deleteDose` / `editDose` actions in `+page.server.ts` (not edited here) and their imports
  - T10: `createDoseWriteLock(opts?: { cooldownMs?: number }): DoseWriteLock` and `setDoseWriteLock(lock)` from `$components/dashboard/dose-write-lock.svelte` (import it **without** `.js`/`.ts`); `createDashboardClock(invalidate: () => Promise<void>): DashboardClockController` and `setDashboardClock(c: DashboardClock)` from `$components/dashboard/dashboard-clock`; `getDashboardClock()` and `logToastFromReload(reloaded, doseId, fallback, tz, timeFormat)` (`$components/dashboard/dose-toasts`) for the chips; `DASHBOARD_HEADING_ID` and `DONE_HEADING_ID` from `$components/dashboard/dom-ids`; components `DashboardHeader { status, serverNow, timezone, timeFormat, dateFormat }`, `DueCard { card, serverNow, todayStart, timezone, timeFormat, focusAfter }`, `DoneList { rows, title, todayStart, timezone, timeFormat, onedit }`, `LaterList { rows, serverNow, todayStart, timezone, timeFormat }`, `DoseActionForm { action, fields, label, srContext?, pendingLabel, variant, quickLog?, buildToast?, undoable?, focusAfter?, onSuccess?, children?, class? }`, `MedicationGlyph { colour, colourSecondary, pattern, size? }`; `StatusMarker` (referenced by the theme-token rows)
  - Existing: `getRefillForecast(userId: string)` (`$lib/server/inventory`), `invalidateAll` (`$app/navigation`), `Modal`, `DoseEditForm`, `RefillsCard`, `OnboardingWelcome`, `KeyboardShortcuts`, `BASE_MEDICATION_ROW` (`tests/unit/fixtures/medication-row.ts`), `unusedDb` (`tests/unit/helpers/fake-db.ts`)
- Produces:
  - The page `load` in `+page.server.ts` returns `{ ...dash, refillForecast } satisfies DashboardPageData`
  - `export function findQuickLogForm(root: ParentNode, medicationId: string): HTMLFormElement | null` in `src/lib/utils/quick-log.ts`
  - `QuickLogBar` props `{ medications: Medication[]; todayStart: Date; timezone: string; timeFormat: TimeFormat }`. No `toastFor`: each chip builds its toast with `logToastFromReload(page.data, …)` (`$app/state`), called by DoseActionForm after `update()` and `tick()`. The chip forms carry `data-quick-log`.
  - No page-level focus helper. Focus after a Due-card write is DueCard's own (T10 `focusTargetAfterResolve`); the page passes only its h1 as the last resort.
  - Removed from the codebase: `MyDayTimeline.svelte`, `SummaryStrip.svelte`, `MedicationTimingStatus`, `computeTimingStatus`, `classifyDueStatus`, `timingStatusFromSlots`, `groupSlotsByTimeOfDay`, `classifyHour`, `getLocalHour`, `TimeOfDay`, `TimeOfDayGroup`, `getTodaysDoses`

---

- [ ] **Steps 1–6: none.** Focus after a Due-card write is already built. T10's DueCard snapshots the card keys rendered after it at tap time (`onsubmitcapture`) and resolves "same card, else next card" through T10's `focusTargetAfterResolve` (`src/lib/components/dashboard/focus-after.ts`), falling back to the `focusAfter` the page passes: the h1. Do NOT create `nextFocusKey`, `tests/unit/dashboard-focus-after.test.ts` or a second `focus-after.ts`. "Create" would overwrite T10's file, and DueCard's `import { focusTargetAfterResolve } from "./focus-after"` would stop resolving. Numbering continues at Step 7.

---

- [ ] **Step 7: Write the failing test for the page load**

Create `tests/unit/dashboard-page-load.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DashboardPageData, RefillForecastEntry } from "$lib/types";

// The page load is I/O only now. `loadDashboard` owns the window, the four
// dashboard queries and the composition; `getRefillForecast` owns refills; the
// load merges the two. Everything it used to compute itself is gone: the
// per-medication `timingStatus`, the `covered` merge, and the raw `doses` and
// `scheduleSlots`. The database is `unusedDb`, so any query the load still
// makes on its own fails by name.

const DASH: Omit<DashboardPageData, "refillForecast"> = {
  now: "2026-04-16T08:30:00.000Z",
  nextRefreshAt: "2026-04-16T09:00:00.000Z",
  timezone: "Europe/London",
  todayStart: "2026-04-15T23:00:00.000Z",
  status: {
    kind: "none-today",
    dueCount: 0,
    doneToday: 0,
    totalToday: 0,
    loggedToday: 0,
    next: null,
  },
  earlier: [],
  today: [],
  done: [],
  later: [],
  medications: [],
};

const FORECAST: RefillForecastEntry[] = [
  {
    medicationId: "m1",
    medicationName: "Metformin",
    colour: "#6366f1",
    inventoryCount: 2,
    dailyRate: 1,
    daysUntilRefill: 2,
    severity: "critical",
  },
];

const loadDashboard = vi.fn(async (..._args: unknown[]) => DASH);
const getRefillForecast = vi.fn(async (..._args: unknown[]) => FORECAST);

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }));
vi.mock("$lib/server/dashboard/load", () => ({
  loadDashboard: (...args: unknown[]) => loadDashboard(...args),
}));
vi.mock("$lib/server/inventory", () => ({
  getRefillForecast: (...args: unknown[]) => getRefillForecast(...args),
}));

const { load } = await import("../../src/routes/(app)/dashboard/+page.server");

const locals = { user: { id: "u1", timezone: "Europe/London" }, session: { id: "s1" } };

async function runLoad(): Promise<Record<string, unknown>> {
  return (await load({ locals } as never)) as Record<string, unknown>;
}

beforeEach(() => {
  loadDashboard.mockClear();
  getRefillForecast.mockClear();
});

describe("dashboard page load", () => {
  it("returns loadDashboard's payload with the refill forecast merged in", async () => {
    expect(await runLoad()).toEqual({ ...DASH, refillForecast: FORECAST });
  });

  it("asks for the signed-in user's dashboard in their profile timezone, at one instant", async () => {
    const before = Date.now();
    await runLoad();
    expect(loadDashboard).toHaveBeenCalledTimes(1);
    const [userId, timezone, now] = loadDashboard.mock.calls[0];
    expect(userId).toBe("u1");
    expect(timezone).toBe("Europe/London");
    expect(now).toBeInstanceOf(Date);
    expect((now as Date).getTime()).toBeGreaterThanOrEqual(before);
    expect(getRefillForecast).toHaveBeenCalledWith("u1");
  });

  it("no longer ships the per-medication timing model or the day's raw doses", async () => {
    const data = await runLoad();
    for (const gone of ["timingStatus", "scheduleSlots", "doses"]) {
      expect(data).not.toHaveProperty(gone);
    }
  });
});
```

- [ ] **Step 8: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/dashboard-page-load.test.ts`
Expected: FAIL with `Unexpected db.select — this test mocks the database as unused` (the old load still calls `getActiveMedications` / `getTodaysDoses` itself)

- [ ] **Step 9: Write the failing SSR test for the page composition**

Create `tests/unit/dashboard-page-ssr.test.ts`:

```ts
// @vitest-environment node
//
// `@vitest-environment node` is load-bearing: under the suite's default jsdom
// environment, vite resolves `svelte` to its client entry, and `render()` from
// `svelte/server` throws `effect_orphan` (see appearance-page-ssr.test.ts).
//
// This covers the dashboard page's COMPOSITION only: which sections render,
// in what order, under which headings, and the chip forms the 1–9 shortcuts
// select. What a card, the header or a Done row SAYS is tested in
// due-card-ssr.test.ts, dashboard-copy.test.ts and dashboard-page-data.test.ts.
// `$app/*` is not mocked: the appearance page SSR-renders `$app/forms` and
// `$app/navigation` unmocked, and nothing here runs an effect or a submit.
import { describe, it, expect } from "vitest";
import { render } from "svelte/server";
import Page from "../../src/routes/(app)/dashboard/+page.svelte";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import type {
  DashboardPageData,
  DashboardStatus,
  DoneRow,
  DueCard,
  DueRow,
  LaterRow,
  Medication,
  RefillForecastEntry,
} from "$lib/types";

// 09:30 BST on Thursday 16 April 2026. Local midnight was 23:00Z the day before.
const NOW = "2026-04-16T08:30:00.000Z";
const TODAY_START = "2026-04-15T23:00:00.000Z";

// The (app) layout adds `user` and `preferences` to the merged PageData, and
// svelte-check types this fixture against it.
const preferences = {
  userId: "u1",
  accentColor: "#4f46e5",
  theme: "dark",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "24h",
  uiDensity: "comfortable",
  reducedMotion: false,
  overdueEmailReminders: true,
  overduePushReminders: true,
  lowInventoryEmailAlerts: true,
  lowInventoryPushAlerts: false,
  doseLogPageSize: 20,
  heatmapPeriod: 90,
  exportFormat: "pdf",
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const user = {
  id: "u1",
  email: "person@example.com",
  name: "Test Person",
  avatarUrl: null,
  timezone: "Europe/London",
  twoFactorEnabled: false,
  emailVerified: true,
};

const metformin: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};
const ibuprofen: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m2",
  name: "Ibuprofen",
  dosageAmount: "200",
  sortOrder: 1,
  lowInventoryEpisodeAt: null,
};

const lowStock: RefillForecastEntry = {
  medicationId: "m1",
  medicationName: "Metformin",
  colour: "#ff0000",
  inventoryCount: 2,
  dailyRate: 1,
  daysUntilRefill: 2,
  severity: "critical",
};

function status(
  kind: DashboardStatus["kind"],
  counts: Partial<Omit<DashboardStatus, "kind">> = {},
): DashboardStatus {
  return { kind, dueCount: 0, doneToday: 0, totalToday: 0, loggedToday: 0, next: null, ...counts };
}

function dueCard(
  subGroup: "earlier" | "today",
  med: Medication,
  expectedTime: string,
  state: DueRow["state"],
): DueCard {
  return {
    key: `${subGroup}:${med.id}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    rows: [
      {
        key: `${med.id}:${expectedTime}`,
        kind: "fixed_time",
        expectedTime,
        state,
        logNow: true,
        tookItAt: state === "due-now" ? null : expectedTime,
        skipAt: expectedTime,
      },
    ],
  };
}

function doneRow(id: string, med: Medication, takenAt: string): DoneRow {
  return {
    key: id,
    dose: {
      id,
      userId: "u1",
      medicationId: med.id,
      quantity: 1,
      status: "taken",
      takenAt: new Date(takenAt),
      loggedAt: new Date(takenAt),
      updatedAt: new Date(takenAt),
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
    },
    covers: [],
    dayLabel: null,
  };
}

function laterRow(med: Medication, expectedTime: string): LaterRow {
  return {
    key: `later:${med.id}:${expectedTime}`,
    medicationId: med.id,
    name: med.name,
    dosageAmount: med.dosageAmount,
    dosageUnit: med.dosageUnit,
    colour: med.colour,
    colourSecondary: med.colourSecondary,
    pattern: med.pattern,
    expectedTime,
  };
}

function renderPage(overrides: Partial<DashboardPageData> = {}) {
  const dash: DashboardPageData = {
    now: NOW,
    nextRefreshAt: "2026-04-16T09:00:00.000Z",
    timezone: "Europe/London",
    todayStart: TODAY_START,
    status: status("none-today"),
    earlier: [],
    today: [],
    done: [],
    later: [],
    medications: [metformin, ibuprofen],
    refillForecast: [],
    ...overrides,
  };
  // No `form`: the page destructures only `data`, and svelte-check rejects an unknown prop.
  return render(Page, { props: { data: { ...dash, user, preferences } } });
}

/** Whitespace or Svelte hydration comments (`<!--[-->`, `<!---->`). */
const GAP = String.raw`(?:\s|<!--[^>]*-->)*`;

/** Offset of the first `<hN>` whose whole text is `text`, or -1. */
function headingAt(html: string, level: 1 | 2 | 3, text: string): number {
  return new RegExp(`<h${level}\\b[^>]*>${GAP}${text}${GAP}</h${level}>`).exec(html)?.index ?? -1;
}

/** The markup from `text`'s h2 up to the next h2 (or the end of the page). */
function sectionAfter(html: string, text: string): string {
  const start = headingAt(html, 2, text);
  if (start === -1) return "";
  const next = html.slice(start + 1).search(/<h2\b/);
  return next === -1 ? html.slice(start) : html.slice(start, start + 1 + next);
}

function chipForms(html: string): string[] {
  return html.match(/<form\b[^>]*\bdata-quick-log\b[^>]*>[\s\S]*?<\/form>/g) ?? [];
}

function hiddenValue(formHtml: string, name: string): string | undefined {
  const tag = formHtml.match(new RegExp(`<input\\b[^>]*\\bname="${name}"[^>]*>`))?.[0];
  return tag?.match(/\bvalue="([^"]*)"/)?.[1];
}

const SCHEDULED: Partial<DashboardPageData> = {
  status: status("due", { dueCount: 2, doneToday: 1, totalToday: 3 }),
  // 23:00 BST yesterday, 10.5h old: an Earlier row.
  earlier: [dueCard("earlier", metformin, "2026-04-15T22:00:00.000Z", "earlier")],
  // 09:00 BST, 30 minutes ago: due now.
  today: [dueCard("today", metformin, "2026-04-16T08:00:00.000Z", "due-now")],
  done: [doneRow("d1", ibuprofen, "2026-04-16T06:00:00.000Z")],
  later: [laterRow(ibuprofen, "2026-04-16T19:00:00.000Z")],
  refillForecast: [lowStock],
};

describe("dashboard page composition (SSR)", () => {
  it("orders a scheduled account's page by what the user has to do", () => {
    const html = renderPage(SCHEDULED).body;
    const order = [
      headingAt(html, 1, "Today"),
      headingAt(html, 2, "Due"),
      headingAt(html, 3, "Earlier"),
      headingAt(html, 3, "Today"),
      headingAt(html, 2, "Done today"),
      headingAt(html, 2, "Later today"),
      headingAt(html, 2, "Log something else"),
      headingAt(html, 2, "Refills"),
    ];
    expect(
      order.every((i) => i >= 0),
      `missing heading: ${JSON.stringify(order)}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("gives the Today sub-group a visible heading only when Earlier is also shown", () => {
    const html = renderPage({ ...SCHEDULED, earlier: [] }).body;
    expect(headingAt(html, 2, "Due")).toBeGreaterThan(-1);
    expect(headingAt(html, 3, "Earlier")).toBe(-1);
    expect(headingAt(html, 3, "Today")).toBe(-1);
  });

  it("holds the Due cards themselves in role=list lists (focus finds them by position)", () => {
    const html = renderPage(SCHEDULED).body;
    for (const group of ["earlier", "today"]) {
      const open = html.match(new RegExp(`<ul\\b[^>]*data-due-list="${group}"[^>]*>`))?.[0];
      expect(open, `no Due list for ${group}`).toBeDefined();
      expect(open).toContain('role="list"');
      const after = html.slice(html.indexOf(open!) + open!.length);
      expect(after).toMatch(new RegExp(`^${GAP}<li\\b`));
    }
  });

  it("renders neither Due nor Later when nothing is outstanding or ahead", () => {
    const html = renderPage({
      status: status("all-done", { doneToday: 1, totalToday: 1 }),
      done: [doneRow("d1", metformin, "2026-04-16T07:00:00.000Z")],
    }).body;
    expect(headingAt(html, 2, "Due")).toBe(-1);
    expect(headingAt(html, 2, "Later today")).toBe(-1);
    expect(headingAt(html, 2, "Done today")).toBeGreaterThan(-1);
    expect(headingAt(html, 2, "Log something else")).toBeGreaterThan(-1);
  });

  it("keeps the Done heading as a focus target and says so when nothing is logged", () => {
    const html = renderPage().body;
    expect(sectionAfter(html, "Done today")).toContain("Nothing logged yet today");
  });

  it("moves the chips under the header, retitled, for an as-needed-only account", () => {
    const html = renderPage({ status: status("as-needed-only") }).body;
    const order = [
      headingAt(html, 1, "Today"),
      headingAt(html, 2, "Log a dose"),
      headingAt(html, 2, "Logged today"),
    ];
    expect(
      order.every((i) => i >= 0),
      `missing heading: ${JSON.stringify(order)}`,
    ).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (const absent of ["Due", "Later today", "Log something else", "Done today"]) {
      expect(headingAt(html, 2, absent), absent).toBe(-1);
    }
  });

  it("renders one quick-log chip per active medication, in list order, logging one dose now", () => {
    const forms = chipForms(renderPage(SCHEDULED).body);
    expect(forms.map((f) => hiddenValue(f, "medicationId"))).toEqual(["m1", "m2"]);
    for (const form of forms) {
      expect(form).toMatch(/action="\?\/logDose"/);
      expect(hiddenValue(form, "quantity")).toBe("1");
      expect(form).not.toMatch(/name="(takenAt|forSlot)"/);
    }
  });

  it("never paints a medication's colours behind chip text, and keeps − in place at quantity 1", () => {
    const chips = sectionAfter(renderPage(SCHEDULED).body, "Log something else");
    expect(chips).toMatch(/<ul\b[^>]*role="list"/);
    // getReadableTextColor's text-shadow was the signature of text on colour.
    expect(chips).not.toMatch(/text-shadow/);
    // Visible label first, context in sr-only text. The old aria-label that
    // hid the visible label is gone.
    expect(chips).toContain('<span class="sr-only">Log </span>');
    expect(chips).not.toMatch(/aria-label="Log /);
    const minus = chips.match(
      /<button\b[^>]*aria-label="Decrease quantity for Metformin"[^>]*>/,
    )?.[0];
    expect(minus, "the − segment must render at quantity 1").toBeDefined();
    expect(minus).toContain('aria-disabled="true"');
    expect(chips).toMatch(/<button\b[^>]*aria-label="Increase quantity for Metformin"/);
  });

  it("keeps the tab title matching the nav", () => {
    expect(renderPage(SCHEDULED).head).toContain("<title>Dashboard — MedTracker</title>");
  });

  it("shows onboarding, not the page, to an account with no active medications", () => {
    const html = renderPage({ medications: [] }).body;
    expect(html).toContain("Welcome to MedTracker");
    expect(headingAt(html, 1, "Today")).toBe(-1);
    expect(chipForms(html)).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/dashboard-page-ssr.test.ts`
Expected: FAIL with `TypeError: Cannot read properties of undefined (reading 'filter')` (the old page reads `data.timingStatus`)

- [ ] **Step 11: Switch the page load**

In `src/routes/(app)/dashboard/+page.server.ts`, replace everything above the comment `// The refusals a dashboard dose write can meet.` (the import block and the whole `load`) with the block below. T9's refusal constants and `slotTimeFailure`, which sit between the `load` and `export const actions: Actions = {`, and the actions below them are **not** edited. Replacing everything above `export const actions` deletes them, and 6 `dashboard-dose-actions.test.ts` cases then throw `ReferenceError: slotTimeFailure is not defined` / `SLOT_TARGET_CHANGED is not defined`. Every name imported here is one the T9 actions use. If `npx eslint "src/routes/(app)/dashboard/+page.server.ts"` then reports an unused import, or `npm run check` reports a missing one, reconcile this block against T9's action bodies and nothing else.

```ts
import { error, fail } from "@sveltejs/kit";
import { track } from "@vercel/analytics/server";
import { getRefillForecast } from "$lib/server/inventory";
import { loadDashboard } from "$lib/server/dashboard/load";
import {
  logDose,
  logDoseForSlot,
  logSkippedDose,
  deleteDose,
  updateDose,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} from "$lib/server/doses";
import { doseLogSchema, doseEditSchema, doseSkipSchema } from "$lib/utils/validation";
import { resolveEditedInstant } from "$lib/utils/time";
import { checkSlotActionTime, type SlotActionTimeProblem } from "$lib/utils/schedule";
import type { DashboardPageData } from "$lib/types";
import type { Actions, PageServerLoad } from "./$types";

/**
 * I/O only. `loadDashboard` owns the window, the four dashboard queries and
 * the composition (`server/dashboard/`), `getRefillForecast` owns refills, and
 * this merges them. Two things are gone: the per-medication `timingStatus`
 * built on the deprecated interval columns, and the `covered` merge that
 * patched it for fixed-time medications. Every due-ness answer on this page
 * now comes from the per-slot model. New derived values belong in
 * `page-data.ts`, not here.
 */
export const load: PageServerLoad = async ({ locals }) => {
  const user = locals.user!;
  // One instant per request: the window, every row's state and nextRefreshAt
  // are all computed against it.
  const now = new Date();
  const [dash, refillForecast] = await Promise.all([
    loadDashboard(user.id, user.timezone, now),
    getRefillForecast(user.id),
  ]);
  return { ...dash, refillForecast } satisfies DashboardPageData;
};
```

- [ ] **Step 12: Run the load test and confirm it passes**

Run: `npx vitest run tests/unit/dashboard-page-load.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 13: Rewrite QuickLogBar as neutral chips on DoseActionForm**

Replace the whole of `src/lib/components/QuickLogBar.svelte` with:

```svelte
<script lang="ts">
  import { page } from "$app/state";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import MedicationGlyph from "$components/dashboard/MedicationGlyph.svelte";
  import { getDashboardClock } from "$components/dashboard/dashboard-clock";
  import { logToastFromReload } from "$components/dashboard/dose-toasts";
  import { formatDoseLabel } from "$lib/utils/dashboard-copy";
  import type { TimeFormat } from "$lib/utils/time";
  import type { Medication } from "$lib/types";

  let {
    medications,
    todayStart,
    timezone,
    timeFormat,
  }: {
    medications: Medication[];
    /** Only for the toast's fallback sentence, when the reload has no Done row for the dose. */
    todayStart: Date;
    timezone: string;
    timeFormat: TimeFormat;
  } = $props();

  const clock = getDashboardClock();

  const MIN_QTY = 1;
  const MAX_QTY = 10;

  // Per-chip quantity. It resets to 1 only after a SUCCESSFUL log; a failed
  // log keeps it, so a retry submits what the user chose. The old pill kept
  // it after success too: it still read "3×" after a ×3 log.
  let quantities: Record<string, number> = $state({});

  function qtyOf(medId: string): number {
    return quantities[medId] ?? MIN_QTY;
  }

  function setQty(medId: string, value: number): void {
    quantities[medId] = Math.max(MIN_QTY, Math.min(MAX_QTY, value));
  }

  /**
   * The chip's success toast. DoseActionForm calls it after `update()` and
   * `tick()`, so `page.data` is the RELOADED payload and the sentence states
   * which slots the dose actually covered (`logToastFromReload`, the same
   * helper Log now uses). Every other value is resolved when the chip renders.
   */
  function chipToast(med: Medication, quantity: number): (doseId: string | null) => string {
    const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit);
    const dayStart = todayStart;
    const tz = timezone;
    const tf = timeFormat;
    return (doseId) =>
      logToastFromReload(
        page.data,
        doseId,
        { label, quantity, takenAt: clock.serverNow(), todayStart: dayStart },
        tz,
        tf,
      );
  }
</script>

<ul role="list" class="flex flex-wrap gap-2">
  {#each medications as med (med.id)}
    {@const qty = qtyOf(med.id)}
    {@const label = formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit)}
    <!-- Neutral on purpose: the medication's colours appear only in the
         aria-hidden glyph, never behind text. Gradient, striped and two-tone
         pills ran the name across colour boundaries, and opacity on the
         steppers undid getReadableTextColor's worst-case contrast. -->
    <li
      class="border-border-strong bg-glass text-text-primary flex h-11 items-center overflow-hidden rounded-full border"
    >
      <!-- Rendered at every quantity, so the log segment never moves under the
           thumb. At 1 it is aria-disabled, not `disabled`, so it keeps focus. -->
      <button
        type="button"
        class="hover:bg-surface-overlay aria-disabled:text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none aria-disabled:cursor-not-allowed"
        aria-label="Decrease quantity for {med.name}"
        aria-disabled={qty <= MIN_QTY}
        onclick={() => setQty(med.id, qty - 1)}>−</button
      >
      <!-- DoseActionForm renders `children` BEFORE `label`, inside the button:
           the aria-hidden glyph, then the sr-only "Log ", so the accessible
           name is "Log Ibuprofen 200mg ×2" and starts with nothing visible
           that is not also in it. `label` is the visible text; it is never
           repeated in the children. {"Log "}, not a literal "Log ": Svelte 5
           trims whitespace at the end of an element, so a literal space is
           dropped and the name would read "LogIbuprofen". -->
      <DoseActionForm
        action="?/logDose"
        fields={{ medicationId: med.id, quantity: String(qty) }}
        label={qty > 1 ? `${label} ×${qty}` : label}
        pendingLabel="Logging…"
        variant="chip"
        quickLog
        undoable
        buildToast={chipToast(med, qty)}
        onSuccess={() => setQty(med.id, MIN_QTY)}
      >
        <MedicationGlyph
          colour={med.colour}
          colourSecondary={med.colourSecondary}
          pattern={med.pattern}
          size="sm"
        />
        <!-- eslint-disable-next-line svelte/no-useless-mustaches -- see above: a literal trailing space is trimmed -->
        <span class="sr-only">{"Log "}</span>
      </DoseActionForm>
      <button
        type="button"
        class="hover:bg-surface-overlay aria-disabled:text-text-muted flex h-11 w-11 shrink-0 items-center justify-center text-base select-none aria-disabled:cursor-not-allowed"
        aria-label="Increase quantity for {med.name}"
        aria-disabled={qty >= MAX_QTY}
        onclick={() => setQty(med.id, qty + 1)}>+</button
      >
    </li>
  {/each}
</ul>
```

- [ ] **Step 14: Rewrite the dashboard page**

Replace the whole of `src/routes/(app)/dashboard/+page.svelte` with:

```svelte
<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import OnboardingWelcome from "$components/OnboardingWelcome.svelte";
  import Modal from "$components/ui/Modal.svelte";
  import DoseEditForm from "$components/DoseEditForm.svelte";
  import KeyboardShortcuts from "$components/KeyboardShortcuts.svelte";
  import RefillsCard from "$components/RefillsCard.svelte";
  import QuickLogBar from "$components/QuickLogBar.svelte";
  import DashboardHeader from "$components/dashboard/DashboardHeader.svelte";
  import DueCard from "$components/dashboard/DueCard.svelte";
  import DoneList from "$components/dashboard/DoneList.svelte";
  import LaterList from "$components/dashboard/LaterList.svelte";
  import DoseActionForm from "$components/dashboard/DoseActionForm.svelte";
  import {
    createDoseWriteLock,
    setDoseWriteLock,
  } from "$components/dashboard/dose-write-lock.svelte";
  import { createDashboardClock, setDashboardClock } from "$components/dashboard/dashboard-clock";
  import { DASHBOARD_HEADING_ID, DONE_HEADING_ID } from "$components/dashboard/dom-ids";
  import type { DateFormat, TimeFormat } from "$lib/utils/time";
  import type { DoseLogWithMedication } from "$lib/types";

  let { data } = $props();

  let editingDose = $state<DoseLogWithMedication | null>(null);

  const timeFormat = $derived(data.preferences.timeFormat as TimeFormat);
  const dateFormat = $derived(data.preferences.dateFormat as DateFormat);
  const todayStart = $derived(new Date(data.todayStart));
  const asNeededOnly = $derived(data.status.kind === "as-needed-only");
  const doneTitle = $derived(asNeededOnly ? "Logged today" : "Done today");
  const hasDue = $derived(data.earlier.length + data.today.length > 0);

  // One page-wide write lock and one server-relative clock, from T10. Every
  // DoseActionForm, DueCard and chip reads them from context; nothing here
  // re-implements a timer, a skew or a lock.
  setDoseWriteLock(createDoseWriteLock());
  const clock = createDashboardClock(invalidateAll);
  setDashboardClock(clock);

  // The instant visible durations are rendered against. It starts at the
  // server's own `now`, so SSR and hydration print the same text, then
  // follows clock.serverNow() every 60s (the TimeSince pattern).
  let tickMs = $state<number | null>(null);
  const renderNow = $derived(new Date(tickMs ?? Date.parse(data.now)));

  // Once per payload: re-measure the skew and re-arm the one refresh timer
  // at nextRefreshAt. The teardown clears it before the next payload's sync,
  // and on unmount.
  $effect(() => {
    clock.sync({ now: data.now, nextRefreshAt: data.nextRefreshAt });
    tickMs = clock.serverNow().getTime();
    return () => clock.dispose();
  });

  $effect(() => {
    const tick = () => {
      tickMs = clock.serverNow().getTime();
    };
    const interval = setInterval(tick, 60_000);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      tick();
      clock.onVisible();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  });

  /** DueCard's last resort after a row resolves: the same card, else the next card, else this h1. */
  const headingTarget = () => document.getElementById(DASHBOARD_HEADING_ID);
  /** The Done h2 (tabindex="-1", always rendered): focus after Remove. */
  const doneHeading = () => document.getElementById(DONE_HEADING_ID);
</script>

<svelte:head>
  <title>Dashboard — MedTracker</title>
</svelte:head>

{#snippet chips(title: string)}
  <section aria-labelledby="quick-log-heading">
    <h2
      id="quick-log-heading"
      class="text-text-muted mb-3 text-sm font-medium tracking-wider uppercase"
    >
      {title}
    </h2>
    <QuickLogBar
      medications={data.medications}
      {todayStart}
      timezone={data.timezone}
      {timeFormat}
    />
  </section>
{/snippet}

{#if data.medications.length === 0}
  <OnboardingWelcome />
{:else}
  <div class="mx-auto w-full max-w-2xl space-y-6">
    <DashboardHeader
      status={data.status}
      serverNow={renderNow}
      timezone={data.timezone}
      {timeFormat}
      {dateFormat}
    />

    {#if asNeededOnly}
      <!-- No active medication has an interval or fixed-time schedule, so
           nothing can be due: the chips are the page. -->
      {@render chips("Log a dose")}
      <DoneList
        rows={data.done}
        title={doneTitle}
        {todayStart}
        timezone={data.timezone}
        {timeFormat}
        onedit={(dose) => (editingDose = dose)}
      />
    {:else}
      {#if hasDue}
        <section aria-labelledby="due-heading" class="space-y-3">
          <h2 id="due-heading" class="sr-only">Due</h2>
          {#if data.earlier.length > 0}
            <h3 class="text-text-secondary text-sm font-semibold">Earlier</h3>
            <ul role="list" data-due-list="earlier" class="space-y-3">
              {#each data.earlier as card (card.key)}
                <DueCard
                  {card}
                  serverNow={renderNow}
                  {todayStart}
                  timezone={data.timezone}
                  {timeFormat}
                  focusAfter={headingTarget}
                />
              {/each}
            </ul>
          {/if}
          {#if data.today.length > 0}
            {#if data.earlier.length > 0}
              <h3 class="text-text-secondary text-sm font-semibold">Today</h3>
            {/if}
            <ul role="list" data-due-list="today" class="space-y-3">
              {#each data.today as card (card.key)}
                <DueCard
                  {card}
                  serverNow={renderNow}
                  {todayStart}
                  timezone={data.timezone}
                  {timeFormat}
                  focusAfter={headingTarget}
                />
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <DoneList
        rows={data.done}
        title={doneTitle}
        {todayStart}
        timezone={data.timezone}
        {timeFormat}
        onedit={(dose) => (editingDose = dose)}
      />

      {#if data.later.length > 0}
        <LaterList
          rows={data.later}
          serverNow={renderNow}
          {todayStart}
          timezone={data.timezone}
          {timeFormat}
        />
      {/if}

      {@render chips("Log something else")}
    {/if}

    <RefillsCard entries={data.refillForecast} />
  </div>
{/if}

<Modal
  open={editingDose !== null}
  onclose={() => (editingDose = null)}
  title={editingDose ? `Edit dose of ${editingDose.medication.name}` : "Edit dose"}
>
  {#if editingDose}
    <!-- Edit stays on DoseEditForm's own enhance: the component is shared
         with /log. Remove is a separate form so it goes through the page's
         write lock like every other dose write. -->
    <DoseEditForm
      dose={editingDose}
      timezone={data.timezone}
      onclose={() => (editingDose = null)}
    />
    <div class="border-glass-border mt-4 border-t pt-4">
      <DoseActionForm
        action="?/deleteDose"
        fields={{ doseId: editingDose.id }}
        label="Remove this dose"
        pendingLabel="Removing…"
        variant="danger"
        buildToast={() => "Dose removed"}
        focusAfter={doneHeading}
        onSuccess={() => (editingDose = null)}
      />
    </div>
  {/if}
</Modal>

<KeyboardShortcuts medications={data.medications} />
```

- [ ] **Step 15: Delete the load test the switch made obsolete**

`tests/unit/dashboard-timing-status.test.ts` drives the old load's `timingStatus`, which no longer exists. The rules it guarded (slot-derived timing for fixed-time medications, the `"0"` legacy interval) now live in T7's `dashboard-page-data.test.ts` and in `schedule-rate`'s own suite.

```bash
git rm tests/unit/dashboard-timing-status.test.ts
```

- [ ] **Step 16: Run both page tests and confirm they pass**

Run: `npx vitest run tests/unit/dashboard-page-load.test.ts tests/unit/dashboard-page-ssr.test.ts`
Expected: PASS (3 + 10 tests)

- [ ] **Step 17: Prove it by mutation**

Break each line below in turn, confirm the named test fails, then restore it:

1. In `+page.server.ts`, return `{ ...dash }` instead of `{ ...dash, refillForecast }` (and drop `satisfies` while mutated). Expected FAIL: "returns loadDashboard's payload with the refill forecast merged in".
2. In `+page.svelte`, move the `{#if data.later.length > 0}<LaterList … />{/if}` block above the first `<DoneList … />`. Expected FAIL: "orders a scheduled account's page by what the user has to do".
3. In `+page.svelte`, remove the `{#if data.earlier.length > 0}` guard around `<h3 …>Today</h3>`. Expected FAIL: "gives the Today sub-group a visible heading only when Earlier is also shown".
4. In `QuickLogBar.svelte`, replace `{"Log "}` with a literal `Log `. Expected FAIL: "never paints a medication's colours behind chip text…" (Svelte trims the space and emits `<span class="sr-only">Log</span>`).

Re-run `npx vitest run tests/unit/dashboard-page-load.test.ts tests/unit/dashboard-page-ssr.test.ts`: PASS.

- [ ] **Step 18: Run the whole suite and the type check**

Run: `npx vitest run && npm run check`
Expected: all test files pass, and `svelte-check found 0 errors`. `MyDayTimeline.svelte` and `SummaryStrip.svelte` still exist unused until Step 29, so `my-day-timeline-ssr.test.ts` still passes.

- [ ] **Step 19: Commit**

```bash
npx prettier --write "src/routes/(app)/dashboard/+page.svelte" "src/routes/(app)/dashboard/+page.server.ts" src/lib/components/QuickLogBar.svelte tests/unit/dashboard-page-load.test.ts tests/unit/dashboard-page-ssr.test.ts
git add "src/routes/(app)/dashboard/+page.svelte" "src/routes/(app)/dashboard/+page.server.ts" src/lib/components/QuickLogBar.svelte tests/unit/dashboard-page-load.test.ts tests/unit/dashboard-page-ssr.test.ts
git commit -m "feat(dashboard): switch the page to the due-now composition"
```

---

- [ ] **Step 19a: Pin the chip quantity rule with a mounted test**

Spec Section 1, "Log something else": the quantity resets to 1 after a successful log and is kept after a failure (live problem 7: a chip still read "3×" after a ×3 log). Nothing above can see it: the page SSR test renders only the initial state. Create `tests/unit/quick-log-bar.test.ts` (default jsdom environment; it mounts the real component and drives its `DoseActionForm` callback with T10's harness):

```ts
// The chip's quantity is a per-tap choice, not a sticky setting. It resets to
// 1 after a SUCCESSFUL log and is kept after a failure, so a retry sends what
// the user chose. Live, a chip still read "3×" after a ×3 log.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { ActionResult, SubmitFunction } from "@sveltejs/kit";

const h = vi.hoisted(() => ({ submit: null as SubmitFunction | null }));

vi.mock("$app/forms", () => ({
  enhance: (_form: HTMLFormElement, submit: SubmitFunction) => {
    h.submit = submit;
    return { destroy() {} };
  },
  deserialize: (text: string) => JSON.parse(text),
}));
vi.mock("$app/navigation", () => ({ invalidateAll: async () => {} }));
// A realistic reloaded payload, so whichever dose-toasts helper the chip's
// toast builder calls finds the keys it reads and falls back cleanly.
vi.mock("$app/state", () => ({
  page: {
    data: {
      done: [],
      todayStart: "2026-05-01T00:00:00.000Z",
      timezone: "UTC",
      preferences: { timeFormat: "24h" },
    },
  },
}));
vi.mock("$components/ui/Toast.svelte", () => ({ showToast: () => {} }));

import QuickLogBar from "$lib/components/QuickLogBar.svelte";
import type { Medication } from "$lib/types";
import { BASE_MEDICATION_ROW } from "./fixtures/medication-row";
import { dashboardContext } from "./helpers/dashboard-context";
import { finishSubmit, startSubmit } from "./helpers/dose-action-form-harness";
import { accessibleName } from "./helpers/dom-names";

const METFORMIN: Medication = {
  ...BASE_MEDICATION_ROW,
  id: "m1",
  name: "Metformin",
  lowInventoryEpisodeAt: null,
};

const SUCCESS: ActionResult = {
  type: "success",
  status: 200,
  data: { success: true, doseId: "d-new" },
};
const NOT_FOUND: ActionResult = {
  type: "failure",
  status: 404,
  data: { errors: { form: ["Medication not found"] } },
};

let destroy: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  h.submit = null;
});

afterEach(() => {
  destroy?.();
  destroy = null;
  vi.useRealTimers();
});

function setup() {
  const target = document.createElement("div");
  document.body.append(target);
  const component = mount(QuickLogBar, {
    target,
    props: {
      medications: [METFORMIN],
      todayStart: new Date("2026-04-16T00:00:00Z"),
      timezone: "UTC",
      timeFormat: "24h",
    },
    context: dashboardContext(),
  });
  flushSync();
  destroy = () => {
    unmount(component);
    target.remove();
  };
  const form = target.querySelector<HTMLFormElement>("form[data-quick-log]");
  const plus = target.querySelector<HTMLButtonElement>(
    'button[aria-label="Increase quantity for Metformin"]',
  );
  const submit = h.submit;
  if (!form || !plus || !submit) {
    throw new Error("no chip form, no + segment, or use:enhance never attached");
  }
  const chip = () => form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  const quantity = () => new FormData(form).get("quantity");
  return { form, plus, submit, chip, quantity };
}

describe("QuickLogBar quantity", () => {
  it("resets to 1 after a successful log", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    expect(quantity()).toBe("2");
    expect(accessibleName(chip())).toContain("×2");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, SUCCESS).done;
    flushSync();

    expect(quantity()).toBe("1");
    expect(accessibleName(chip())).not.toContain("×");
  });

  it("keeps the chosen quantity after a failed log, so a retry sends it again", async () => {
    const { form, plus, submit, chip, quantity } = setup();
    plus.click();
    flushSync();
    plus.click();
    flushSync();
    expect(quantity()).toBe("3");

    const { callback } = await startSubmit(submit, form);
    await finishSubmit(callback!, form, NOT_FOUND).done;
    flushSync();

    expect(quantity()).toBe("3");
    expect(accessibleName(chip())).toContain("×3");
  });
});
```

- [ ] **Step 19b: Run the test and confirm it passes**

Run: `npx prettier --write tests/unit/quick-log-bar.test.ts && npx vitest run tests/unit/quick-log-bar.test.ts`
Expected: PASS (2 tests). There is no red phase, because Step 13 already rewrote QuickLogBar, so Step 19c is the proof.

- [ ] **Step 19c: Prove it by mutation** (restore after each)

1. In `QuickLogBar.svelte`, delete the chip `DoseActionForm`'s `onSuccess={…}` prop. Run `npx vitest run tests/unit/quick-log-bar.test.ts`: "resets to 1 after a successful log" must FAIL (`quantity` stays "2"). Restore.
2. In `DoseActionForm.svelte`, move `afterSuccess?.();` out of the `result.type === "success"` branch to the top of the `finally` block. Run the file: "keeps the chosen quantity after a failed log, so a retry sends it again" must FAIL (`quantity` is "1"). Restore and re-run: PASS.

- [ ] **Step 19d: Commit**

```bash
git add tests/unit/quick-log-bar.test.ts
git commit -m "test(dashboard): pin the chip quantity reset after a successful log"
```

---

- [ ] **Step 20: Write the failing test for the 1–9 shortcut target**

Create `tests/unit/quick-log-target.test.ts` (default jsdom environment):

```ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findQuickLogForm } from "$lib/utils/quick-log";

function logForm(attrs: string, medicationId: string, extra = ""): string {
  return (
    `<form method="POST" action="?/logDose" ${attrs}>` +
    `<input type="hidden" name="medicationId" value="${medicationId}" />${extra}` +
    `<button type="submit">x</button></form>`
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findQuickLogForm", () => {
  it("returns the chip even when a Due card's logDose forms for the same medication come first", () => {
    // Due cards render before the chips, and "Took it at" records a PAST
    // instant. A number key must never submit it.
    document.body.innerHTML =
      logForm(
        'data-testid="took-it-at"',
        "m1",
        '<input type="hidden" name="takenAt" value="2026-04-16T08:00:00.000Z" />',
      ) +
      logForm(
        'data-testid="log-now"',
        "m1",
        '<input type="hidden" name="forSlot" value="2026-04-16T12:00:00.000Z" />',
      ) +
      logForm('data-quick-log data-testid="chip-m2"', "m2") +
      logForm('data-quick-log data-testid="chip-m1"', "m1");
    expect(findQuickLogForm(document, "m1")?.dataset.testid).toBe("chip-m1");
  });

  it("returns null when the medication has no chip, whatever other logDose forms exist", () => {
    document.body.innerHTML = logForm('data-testid="took-it-at"', "m1");
    expect(findQuickLogForm(document, "m1")).toBeNull();
  });

  it("never returns another medication's chip", () => {
    document.body.innerHTML = logForm("data-quick-log", "m2");
    expect(findQuickLogForm(document, "m1")).toBeNull();
  });
});

describe("KeyboardShortcuts", () => {
  // cwd, not import.meta.url: this file runs under jsdom, where
  // import.meta.url is not a file: URL.
  const src = readFileSync(
    resolve(process.cwd(), "src/lib/components/KeyboardShortcuts.svelte"),
    "utf8",
  ).replace(/\s+/g, " ");

  it("submits through findQuickLogForm, never by the logDose action alone", () => {
    expect(src).toContain("findQuickLogForm(");
    expect(src).not.toContain(`form[action="?/logDose"]`);
  });

  it("describes 1–9 as logging now, by chip position", () => {
    expect(src).toContain("Log a medication now, by its position in the chip list");
  });
});
```

- [ ] **Step 21: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/quick-log-target.test.ts`
Expected: FAIL with `Failed to resolve import "$lib/utils/quick-log"`

- [ ] **Step 22: Write the helper and point KeyboardShortcuts at it**

Create `src/lib/utils/quick-log.ts`:

```ts
/**
 * The chip form that logs `medicationId` now, or null.
 *
 * It matches `form[data-quick-log]` only. The dashboard also renders
 * `?/logDose` forms on its Due cards, and one of them, "Took it at HH:MM",
 * records a PAST instant. Matching on the action alone let a number key submit
 * whichever logDose form for that medication came first in the DOM, and since
 * the due-now rebuild that is a Due card's form, not the chip's.
 */
export function findQuickLogForm(root: ParentNode, medicationId: string): HTMLFormElement | null {
  for (const form of root.querySelectorAll<HTMLFormElement>("form[data-quick-log]")) {
    const input = form.querySelector<HTMLInputElement>('input[name="medicationId"]');
    if (input?.value === medicationId) return form;
  }
  return null;
}
```

In `src/lib/components/KeyboardShortcuts.svelte`, add to the imports (after `import { trapTab } from "$lib/utils/focus-trap";`):

```ts
import { findQuickLogForm } from "$lib/utils/quick-log";
```

Replace the 1–9 branch (HEAD `:83-101`):

```ts
const num = parseInt(e.key);
if (num >= 1 && num <= 9 && medications.length > 0) {
  const idx = num - 1;
  if (idx < medications.length) {
    e.preventDefault();
    // Match on the medication id rather than the form's position in the DOM.
    // The dashboard renders logDose forms in more than one section, so the
    // Nth form is not reliably the Nth medication — positional coupling could
    // log the wrong medication, which for a dosing control is the worst
    // available failure.
    const wanted = medications[idx].id;
    const form = [...document.querySelectorAll<HTMLFormElement>('form[action="?/logDose"]')].find(
      (f) => f.querySelector<HTMLInputElement>('input[name="medicationId"]')?.value === wanted,
    );
    if (form) form.requestSubmit();
  }
}
```

with:

```ts
const num = parseInt(e.key);
if (num >= 1 && num <= 9 && medications.length > 0) {
  const idx = num - 1;
  if (idx < medications.length) {
    e.preventDefault();
    // The chip's form only, matched on the medication id rather than the
    // form's position. Due cards render `?/logDose` forms too, and "Took
    // it at" records a PAST instant; positional coupling could log the
    // wrong medication, which for a dosing control is the worst available
    // failure. requestSubmit() runs the chip's DoseActionForm enhance, so
    // a key press goes through the same write lock as a tap.
    const form = findQuickLogForm(document, medications[idx].id);
    if (form) form.requestSubmit();
  }
}
```

Replace the help entry (HEAD `:111`):

```ts
    { keys: ["1-9"], description: "Quick-log medication by position" },
```

with:

```ts
    { keys: ["1-9"], description: "Log a medication now, by its position in the chip list" },
```

- [ ] **Step 23: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/quick-log-target.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 24: Prove it by mutation**

In `quick-log.ts`, change `"form[data-quick-log]"` to `'form[action="?/logDose"]'`. Run `npx vitest run tests/unit/quick-log-target.test.ts`. Expected: FAIL in "returns the chip even when a Due card's logDose forms…" (received `"took-it-at"`) and in "returns null when the medication has no chip…". Restore it: PASS.

- [ ] **Step 25: Commit**

```bash
npx prettier --write src/lib/utils/quick-log.ts src/lib/components/KeyboardShortcuts.svelte tests/unit/quick-log-target.test.ts
git add src/lib/utils/quick-log.ts src/lib/components/KeyboardShortcuts.svelte tests/unit/quick-log-target.test.ts
git commit -m "fix(shortcuts): let 1-9 submit only quick-log chip forms"
```

---

- [ ] **Step 26: Delete the per-medication timing model from `time.ts` and `types.ts`**

In `src/lib/utils/time.ts`, delete the whole `computeTimingStatus` function and its JSDoc (the block starting `/**\n * Compute the timing status for a scheduled medication.`). Delete the whole `classifyDueStatus` function and its JSDoc too (the block starting `/**\n * Shared due-ness thresholds:`, which is also the stale "QuickLogBar badges" note). Keep `formatDueIn`, which T1 rebuilt; the landing walkthrough still uses it.

In the `startOfDay` JSDoc, replace:

```
 * Chatham, Tongatapu, Kamchatka…). Since `getTodaysDoses` filters on
 * `takenAt >= dayStart`, a New Zealand user's dashboard listed no doses at
 * all, permanently, and My Day projected tomorrow's slots. Its one test used
```

with:

```
 * Chatham, Tongatapu, Kamchatka…). Since the dashboard's dose query filtered
 * on `takenAt >= dayStart`, a New Zealand user's dashboard listed no doses at
 * all, permanently, and projected tomorrow's slots. Its one test used
```

In the `wallClockToInstant` JSDoc, replace `Sunday would otherwise vanish from both the timeline and the sweep.` with `Sunday would otherwise vanish from both the dashboard and the sweep.` Then run `grep -n "expectedTimesForFixedTime" src/lib/utils/schedule.ts`. If T3 renamed that function (for example into `projectFixedTimes`), rename it in this same comment.

In `tests/unit/time.test.ts`, remove `computeTimingStatus,` from the import list from `"$lib/utils/time"`, and delete the whole `describe("computeTimingStatus", () => { … });` block (6 tests).

In `src/lib/types.ts`, delete:

```ts
export type MedicationTimingStatus = {
  medicationId: string;
  status: "ok" | "due_soon" | "due_now" | "overdue";
  minutesUntilDue: number; // negative if overdue
};
```

- [ ] **Step 27: Delete the time-of-day and slot-timing helpers from `schedule.ts`**

In `src/lib/utils/schedule.ts`, delete:

- `export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";`
- the `export interface TimeOfDayGroup { … }` block
- `classifyHour` with its JSDoc, and the private `getLocalHour`
- `groupSlotsByTimeOfDay` with its JSDoc
- `timingStatusFromSlots` with its JSDoc ("Derive a QuickLogBar-style timing status…")
- `classifyDueStatus` from the `import { … } from "./time";` line, keeping every other name on it

In `tests/unit/schedule.test.ts`, remove `classifyHour`, `groupSlotsByTimeOfDay` and `timingStatusFromSlots` from the import from `"$lib/utils/schedule"` (keep every other name). Delete these whole blocks: `describe("classifyHour", …)` (4 tests), `describe("groupSlotsByTimeOfDay", …)` (2 tests) and `describe("timingStatusFromSlots", …)` (6 tests). Then run `grep -nE "\bScheduleSlot(Status)?\b" tests/unit/schedule.test.ts`. If the only hit left is the `import type { ScheduleSlot, ScheduleSlotStatus }` line, delete that line; otherwise remove only the name that is now unused.

- [ ] **Step 28: Delete `getTodaysDoses` and its mock references**

In `src/lib/server/doses.ts`, delete the whole `export async function getTodaysDoses(…) { … }` function. Then run `grep -n "startOfDay" src/lib/server/doses.ts`. If the only hit left is `import { startOfDay } from "$lib/utils/time";`, delete that import. Keep `gte` and `desc`, which T7's `getDosesInRange` uses.

In `tests/unit/dashboard-dose-actions.test.ts`, delete the line `  getTodaysDoses: async () => [],` from the `vi.mock("$lib/server/doses", …)` factory.
In `tests/unit/app-action-auth-guard.test.ts`, delete the line `  getTodaysDoses: never("getTodaysDoses"),` from the `vi.mock("$lib/server/doses", …)` factory.

- [ ] **Step 29: Delete the timeline and summary strip, and fix the comments that named them**

```bash
git rm src/lib/components/MyDayTimeline.svelte src/lib/components/SummaryStrip.svelte tests/unit/my-day-timeline-ssr.test.ts
```

(`tests/unit/status-marker-ssr.test.ts` from T10 already carries the same assertions against `StatusMarker`.)

In `src/lib/components/walkthrough/parts/MyDaySection.svelte`, replace:

```ts
// MyDayTimeline.svelte: today's slots grouped by time of day. `done` maps a
// slot key (medication id + time) to 0..1 as it animates from its current
// status to taken, which also collapses its "Log" button.
```

with:

```ts
// Depicts the dashboard's former "My Day" timeline (today's slots grouped by
// time of day), which the 2026-09-24 due-now rebuild removed. Redrawing this
// scene is follow-up 4 of that spec. `done` maps a slot key (medication id +
// time) to 0..1 as it animates from its current status to taken, which also
// collapses its "Log" button.
```

In `src/lib/components/walkthrough/parts/SummaryAndRefills.svelte`, replace:

```ts
// SummaryStrip.svelte followed by RefillsCard.svelte, as they sit together at
// the top of the dashboard.
```

with:

```ts
// Depicts the former dose-count summary strip followed by RefillsCard.svelte,
// as they sat together at the top of the dashboard before the 2026-09-24
// due-now rebuild (redrawing this is follow-up 4 of that spec).
```

In `src/lib/components/walkthrough/demo-data.ts`, replace `// Emoji because MyDayTimeline.svelte uses them.` with `// Emoji because the dashboard's former My Day timeline used them.`

In `src/app.css`, run `grep -rn "success-flash" src` first. If the only hits are in `app.css`, delete the `@keyframes success-flash { … }` block and the `.animate-success-flash { animation: success-flash 0.6s ease-out; }` rule; their only user was the old QuickLogBar. Then in the reduced-motion comment, replace:

```
   i.e. a per-frame strobe where there had been a calm 2s pulse. Turning reduced
   motion ON was worse than leaving it off, for the dashboard's persistent
   "due now" badge (QuickLogBar) and the two dose-logging spinners.
```

with:

```
   i.e. a per-frame strobe where there had been a calm 2s pulse. Turning reduced
   motion ON was worse than leaving it off, for every dose-writing spinner
   (DoseActionForm on the dashboard, MedicationCard, TimelineEntry on /log).
```

- [ ] **Step 30: Confirm nothing still names a deleted symbol**

Run:

```bash
grep -rnE "MyDayTimeline|SummaryStrip|MedicationTimingStatus|computeTimingStatus|classifyDueStatus|timingStatusFromSlots|groupSlotsByTimeOfDay|classifyHour|getLocalHour|getTodaysDoses|my-day-timeline-ssr|dashboard-timing-status|success-flash" src tests CLAUDE.md
grep -rnw "TimeOfDay\|TimeOfDayGroup" src tests
```

Expected: no output from the second command. From the first, exactly one hit: the `// MyDayTimeline: row.hover…` comment in `tests/unit/theme-tokens.test.ts`, which Step 33 deletes (Step 49 re-runs the grep and expects nothing). Any other hit is a missed reference. Historical mentions in `docs/adr/` and `docs/superpowers/` are intentionally out of scope.

- [ ] **Step 31: Run the suite and the type check**

Run: `npx vitest run && npm run check`
Expected: all test files pass (the deleted blocks and files are simply gone), and `svelte-check found 0 errors`. If `check` names an importer this task did not list, delete its use of the removed symbol. There should be none, because Step 30's grep is empty.

- [ ] **Step 32: Commit**

```bash
npx prettier --write src/lib/utils/time.ts src/lib/utils/schedule.ts src/lib/types.ts src/lib/server/doses.ts src/app.css src/lib/components/walkthrough/parts/MyDaySection.svelte src/lib/components/walkthrough/parts/SummaryAndRefills.svelte src/lib/components/walkthrough/demo-data.ts tests/unit/time.test.ts tests/unit/schedule.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts
git add src/lib/utils/time.ts src/lib/utils/schedule.ts src/lib/types.ts src/lib/server/doses.ts src/app.css src/lib/components/walkthrough/parts/MyDaySection.svelte src/lib/components/walkthrough/parts/SummaryAndRefills.svelte src/lib/components/walkthrough/demo-data.ts tests/unit/time.test.ts tests/unit/schedule.test.ts tests/unit/dashboard-dose-actions.test.ts tests/unit/app-action-auth-guard.test.ts
git commit -m "refactor(dashboard): delete the timeline, summary strip and per-medication timing model"
```

(The `git rm` in Step 29 has already staged the three deletions.)

---

- [ ] **Step 33: Replace the timeline glyph rows in theme-tokens with StatusMarker's real nesting**

In `tests/unit/theme-tokens.test.ts`, inside `describe.each(SCHEMES)("$name — tinted chips are legible over the backdrop they actually paint on", …)`, delete these three lines. The deleted component was their only reason to exist; `glassHover` stays because `cardHover` uses it.

```ts
// MyDayTimeline: row.hover:bg-glass-hover > .bg-glass group > page.
const row = card;
const rowHover = compositeOver(glassHover.alpha, card, glassHover.overlay);
```

Replace the last four `CHIPS` rows:

```ts
      ["--color-success", 0.2, row, "--color-success", 3, "timeline status glyph: taken"],
      ["--color-success", 0.2, rowHover, "--color-success", 3, "…hovered"],
      ["--color-warning", 0.2, row, "--color-warning", 3, "timeline status glyph: skipped"],
      ["--color-warning", 0.2, rowHover, "--color-warning", 3, "…hovered"],
```

with:

```ts
      // StatusMarker's two tinted states: a 20px circle inside a DueCard
      // <li class="bg-glass"> or the Done today card (.bg-glass), each sitting
      // directly on the page <main>, so the backdrop is `card`. Neither has a
      // hover background, so there is no hovered row. `due-now`, `upcoming`,
      // `skipped` and `missed` are untinted rings and carry no chip to check.
      ["--color-success", 0.2, card, "--color-success", 3, "StatusMarker: taken"],
      ["--color-warning", 0.2, card, "--color-warning", 3, "StatusMarker: overdue"],
```

- [ ] **Step 34: Run the test and confirm it passes**

Run: `npx vitest run tests/unit/theme-tokens.test.ts`
Expected: PASS. There is no red phase, because the backdrop is the same `card` value the old non-hovered rows used; the rows moved to the component that now renders them.

- [ ] **Step 35: Prove the rows are live by mutation**

Change the `StatusMarker: overdue` row's alpha from `0.2` to `1`. Run `npx vitest run tests/unit/theme-tokens.test.ts`. Expected: FAIL `--color-warning on --color-warning/100 — StatusMarker: overdue` (1.00:1) in both schemes. Restore `0.2`: PASS.

- [ ] **Step 36: Commit**

```bash
git add tests/unit/theme-tokens.test.ts
git commit -m "test(theme): measure StatusMarker's tinted states on the card they sit on"
```

---

- [ ] **Step 37: Write the failing test for the toast Undo target and the onboarding copy**

Create `tests/unit/dashboard-chrome-copy.test.ts`:

```ts
// @vitest-environment node
//
// These assertions read source, because neither component can be rendered
// into the state that matters. `showToast` returns early unless `browser`, so
// SSR never renders a toast, and OnboardingWelcome's step 2 is reachable only
// by clicking. Normalising whitespace makes them indifferent to prettier's
// line wrapping.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8")
    .replace(/\s+/g, " ")
    .replace(/ >/g, ">");
}

describe("Toast", () => {
  it("gives Undo at least a 44px-tall target with side padding, like every other dose control", () => {
    const src = source("src/lib/components/ui/Toast.svelte");
    const start = src.indexOf("{#if toast.undoAction}");
    expect(start, "the Undo block moved: update this test").toBeGreaterThan(-1);
    const block = src.slice(start, src.indexOf("{/if}", start));
    const classes = /class="([^"]*)"/.exec(block)?.[1].split(" ") ?? [];
    expect(classes).toEqual(expect.arrayContaining(["min-h-11", "px-3"]));
  });
});

describe("OnboardingWelcome step 2", () => {
  const src = source("src/lib/components/OnboardingWelcome.svelte");

  it("describes the dashboard the user will actually get", () => {
    expect(src).toContain(`Due</span> — one tap to log what's due`);
    expect(src).toContain(`Done today</span> — everything you've logged`);
    expect(src).toContain(`Refills</span> — know when to reorder`);
  });

  it("no longer names sections the rebuild removed", () => {
    expect(src).not.toContain("Quick Log");
    expect(src).not.toContain("Today's Timeline");
  });
});
```

- [ ] **Step 38: Run the test and confirm it fails**

Run: `npx vitest run tests/unit/dashboard-chrome-copy.test.ts`
Expected: FAIL. "gives Undo…" fails because `min-h-11` is missing; "describes the dashboard…" fails because the Due copy is missing; "no longer names…" fails because the source still contains "Quick Log".

- [ ] **Step 39: Edit the Toast and the onboarding copy**

In `src/lib/components/ui/Toast.svelte`, replace:

```svelte
        <button
          class="text-sm font-medium underline"
```

with:

```svelte
        <!-- min-h-11 px-3: Undo is the only one-tap route back from a logged
             dose and must meet the 44px target every dose control does. -->
        <button
          class="min-h-11 px-3 text-sm font-medium underline"
```

In `src/lib/components/OnboardingWelcome.svelte`, replace the three step-2 paragraphs:

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Quick Log</span> — one-tap dose logging for each medication
</p>
```

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Due</span> — one tap to log what's due
</p>
```

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Today's Timeline</span> — a live view of everything you've
  taken
</p>
```

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Done today</span> — everything you've logged
</p>
```

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Inventory Tracking</span> — know when it's time to refill
</p>
```

```svelte
<p class="text-text-secondary">
  <span class="text-text-primary font-medium">Refills</span> — know when to reorder
</p>
```

(In each pair the first block is replaced by the second.)

- [ ] **Step 40: Run the test and confirm it passes**

Run: `npx prettier --write src/lib/components/ui/Toast.svelte src/lib/components/OnboardingWelcome.svelte tests/unit/dashboard-chrome-copy.test.ts && npx vitest run tests/unit/dashboard-chrome-copy.test.ts`
Expected: PASS (3 tests), still green after prettier's reflow.

- [ ] **Step 41: Prove it by mutation**

Remove `min-h-11` from the Toast's Undo class. Run the test. Expected: FAIL "gives Undo at least a 44px-tall target…". Restore it: PASS.

- [ ] **Step 42: Commit**

```bash
git add src/lib/components/ui/Toast.svelte src/lib/components/OnboardingWelcome.svelte tests/unit/dashboard-chrome-copy.test.ts
git commit -m "fix(a11y): give the toast's Undo a 44px target; update onboarding copy"
```

---

- [ ] **Step 43: Update the e2e selectors and heading waits**

The e2e suite never runs in CI (`RUN_E2E` is unset), so no automated red phase exists here. `npm run check` still type-checks `tests/e2e/**`.

`tests/e2e/helpers/selectors.ts:14`: replace `  dashboard: "Dashboard",` with:

```ts
  // The dashboard's h1 is "Today"; the tab title and the nav still say
  // "Dashboard". Match it with { level: 1, exact: true }: "Today" is a
  // substring of "Done today" and "Later today", and the Due section has an
  // h3 "Today" whenever Earlier rows are shown.
  dashboard: "Today",
```

`tests/e2e/helpers/auth.ts:28`, inside `login()`: replace `  await expect(page.getByRole("heading", { name: HEADING.dashboard })).toBeVisible();` with:

```ts
await expect(
  page.getByRole("heading", { level: 1, name: HEADING.dashboard, exact: true }),
).toBeVisible();
```

`tests/e2e/auth.test.ts:16`: replace `    await expect(page.getByRole("heading", { name: HEADING.dashboard })).toBeVisible();` with:

```ts
await expect(
  page.getByRole("heading", { level: 1, name: HEADING.dashboard, exact: true }),
).toBeVisible();
```

`tests/e2e/accessibility.test.ts`: after `import { login, SEEDED_EMAIL, SEEDED_PASSWORD } from "./helpers/auth";` add:

```ts
import { HEADING } from "./helpers/selectors";
```

Then replace both `await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();` lines (HEAD `:55` and `:102`) with:

```ts
await expect(
  page.getByRole("heading", { level: 1, name: HEADING.dashboard, exact: true }),
).toBeVisible();
```

`tests/e2e/dose-logging.test.ts`: replace the first test (HEAD `:21-39`) with:

```ts
test("logging a dose via QuickLogBar decrements inventory by one", async ({ page }) => {
  const userId = await getUserIdByEmail(SEEDED_EMAIL);
  expect(userId).not.toBeNull();
  const medId = await getMedIdByName(userId!, VITAMIN_D);
  const before = await getInventoryCount(userId!, VITAMIN_D);
  expect(before).not.toBeNull();

  await page.goto("/dashboard");
  // The chip's form, found by medication id. A Due card can name Vitamin D
  // too, and its "Took it at" records a past instant, so matching a button
  // by its visible name could press the wrong control.
  await page
    .locator(`form[data-quick-log]:has(input[name="medicationId"][value="${medId}"])`)
    .locator('button[type="submit"]')
    .click();

  // The toast confirms the server round trip; wait for it before reading
  // the DB so we don't race the transaction. Scoped to the toast region:
  // "logged" also appears in the page's own copy ("Nothing logged yet
  // today", "2 doses logged today").
  await expect(page.getByRole("status").getByText(/logged at/i)).toBeVisible();

  const after = await getInventoryCount(userId!, VITAMIN_D);
  expect(after).toBe((before ?? 0) - 1);
});
```

- [ ] **Step 44: Type-check the e2e edits and (optionally) run them**

Run: `npm run check`
Expected: `svelte-check found 0 errors`.
Optional, with an e2e database and a non-empty `ENCRYPTION_KEY` in `.env`: `npx playwright test tests/e2e/auth.test.ts tests/e2e/accessibility.test.ts tests/e2e/dose-logging.test.ts`. Expected: pass. The one exception is the pre-existing `auth.test.ts:11` assertion (`/no medications yet/i` on a new account's dashboard), which OnboardingWelcome has never rendered and which this task does not touch.

- [ ] **Step 45: Commit**

```bash
npx prettier --write tests/e2e/helpers/selectors.ts tests/e2e/helpers/auth.ts tests/e2e/auth.test.ts tests/e2e/accessibility.test.ts tests/e2e/dose-logging.test.ts
git add tests/e2e/helpers/selectors.ts tests/e2e/helpers/auth.ts tests/e2e/auth.test.ts tests/e2e/accessibility.test.ts tests/e2e/dose-logging.test.ts
git commit -m "test(e2e): follow the dashboard's Today heading and chip forms"
```

---

- [ ] **Step 46: Record the two new rules in CLAUDE.md**

Insert this bullet immediately after the line `- Live "time since" counters: client-side \`$effect\` + \`setInterval(60s)\` + \`visibilitychange\` recalc. No WebSocket.` (`CLAUDE.md:36`):

```markdown
- **Dashboard time is server-relative, and `createDashboardClock` (`components/dashboard/dashboard-clock.ts`) owns it.** `(app)/dashboard/+page.svelte` creates one clock, puts it in context with `setDashboardClock`, and calls `clock.sync({ now, nextRefreshAt })` once per payload. `sync` re-measures `skewMs = Date.parse(data.now) − Date.now()` (`skewFrom`) and arms the ONE refresh timer for `data.nextRefreshAt` (computed by `composeDashboardPageData`, clamped to at least `now + 5s`). `onVisible()` re-checks on `visibilitychange`, and the page re-renders durations from a 60s `clock.serverNow()` tick. Every payload instant is compared with `serverNow() = Date.now() + skewMs`, never raw `Date.now()`: a device clock minutes fast would otherwise reload the page in a loop, and `DoseActionForm`'s stale guard would refuse every tap near a boundary. Status, rows and buttons change only through the load; the client never re-derives them, and nothing else arms a refresh timer.
```

Insert this bullet immediately after the `actionErrorMessage` bullet, which ends `…so the button spins and the user believes the dose was recorded.` (`CLAUDE.md:59`):

```markdown
- **`DoseActionForm` (`src/lib/components/dashboard/`) is the only `use:enhance` for a dashboard log, skip, undo or remove.** That covers the Due-card buttons, the chips, Undo skip and the Modal's _Remove this dose_. It owns:
  - the page-wide write lock (`createDoseWriteLock`, set in context by the page; `aria-disabled`, never `disabled`, which drops focus to `<body>`)
  - the stale guard
  - the toast, built from the RELOADED data, and its Undo
  - every failure path (`actionErrorMessage`; a 409 or `'error'` runs `invalidateAll()` before the lock releases)

  A second hand-rolled enhance on this page reopens the double-tap double-dose the lock exists to close. The 1–9 shortcuts go through it too: they `requestSubmit()` the chip form `findQuickLogForm` returns. That helper matches `form[data-quick-log]` only, because a Due card's _Took it at_ is also a `?/logDose` form and records a past instant. The Modal's edit stays on `DoseEditForm`'s own enhance because that component is shared with `/log`.
```

- [ ] **Step 47: Amend the due-ness unification spec**

In `docs/superpowers/specs/2026-08-13-due-ness-unification-design.md`, make these replacements.

(a) Replace:

```
module so the question has one home, one rule, and one place to test.

## The three answers, and how they differ
```

with:

```
module so the question has one home, one rule, and one place to test.

> **Amended 2026-09-24 by the [dashboard "Due Now" rebuild](2026-09-24-dashboard-due-now-design.md).**
> That change landed some of this spec's pieces early and made others obsolete; read
> the _Amended_ notes below before implementing anything here. In short:
>
> - The dashboard's `computeTimingStatus` block and `covered` merge are already deleted.
> - `timingStatusFromSlots`, `classifyDueStatus`, `groupSlotsByTimeOfDay` and
>   `classifyHour` are deleted rather than moved or kept.
> - The lifecycle clip already applies in `computeScheduleSlots`.
> - The resolution rule should adopt that spec's passes 0–2 rather than the symmetric
>   ±1h rule stated here.

## The three answers, and how they differ
```

(b) Replace:

```
it, so it may never import `$lib/server`. Date primitives (`localTimeOnDateToUtc`,
`getLocalDayOfWeek`, `getLocalDateString`) and presentation helpers
(`groupSlotsByTimeOfDay`, `classifyHour`) stay in `schedule.ts` and are imported.
`classifyDueStatus` stays in `time.ts` — it is a pure threshold classifier with its
own tests and no reason to move.
```

with:

```
it, so it may never import `$lib/server`. Date primitives (`localTimeOnDateToUtc`,
`getLocalDayOfWeek`, `getLocalDateString`) stay in `schedule.ts` and are imported.
_Amended 2026-09-24:_ the dashboard due-now rebuild **deleted** the presentation
helpers `groupSlotsByTimeOfDay` and `classifyHour`, and `classifyDueStatus` in
`time.ts`. The page is now grouped by action, not time of day, and no caller of the
classifier remained. None of them is moved here or kept. `MyDayTimeline.svelte` is
deleted as well; the client consumers are now the `src/lib/components/dashboard/`
components, which render a composed payload instead of calling due-ness directly.
```

(c) Replace:

```
clip and the resolution rule are all private to it. `timingStatusFromSlots` moves here
from `schedule.ts` — it answers a due-ness question, not a formatting one.
```

with:

```
clip and the resolution rule are all private to it. _Amended 2026-09-24:_
`timingStatusFromSlots` was **deleted** rather than moved. Its only consumer was the
dashboard's `covered` merge, which is gone.
```

(d) Replace:

```
Occurrences are clipped to the medication's `[startedAt, endedAt]` lifecycle window,
consistent with how analytics already treats that range.
```

with:

```
Occurrences are clipped to the medication's `[startedAt, endedAt]` lifecycle window,
consistent with how analytics already treats that range. _Amended 2026-09-24:_ this
clip has already landed in `computeScheduleSlots`, together with a second,
schedule-edit clip for pre-midnight slots. Move both into the new module; do not add
them again.
```

(e) Replace:

```
find the most recent elapsed occurrence, so a slot timed after the cron tick is not
lost when the local date rolls over.
```

with:

```
find the most recent elapsed occurrence, so a slot timed after the cron tick is not
lost when the local date rolls over.

_Amended 2026-09-24:_ the symmetric ±`SLOT_TOLERANCE_MS` rule above is what the
dashboard used to do, and it is now pass 1 of three. `outstandingSlots` should adopt
the dashboard's rules as specified in
[the due-now spec's Three passes](2026-09-24-dashboard-due-now-design.md#three-passes):
passes 0–2 (exact-instant claims, reserved skips, late resolution), the segment limit
and both clips. The cron's anchor evidence cannot run pass 2 and stays as described
under "Limits of the anchor projection".
```

(f) Replace:

```
deprecated columns) and `:81-89` (the `covered`-set merge) are both deleted.
```

with:

```
deprecated columns) and `:81-89` (the `covered`-set merge) are both deleted.
_Amended 2026-09-24: both deletions have landed._ The dashboard load is now
`loadDashboard` (`src/lib/server/dashboard/load.ts`) plus `getRefillForecast`, and
composition lives in `src/lib/server/dashboard/page-data.ts`. What remains here is to
route that composition's per-medication projection and matching through
`outstandingSlots`.
```

(g) Replace:

```
`reminders/domain.ts` keeps only its dedupe-key builders, which are reminder
concerns rather than due-ness.
```

with:

```
`reminders/domain.ts` keeps only its dedupe-key builders, which are reminder
concerns rather than due-ness. _Amended 2026-09-24:_ `computeTimingStatus` and the
`covered`-set merge are already gone. `MATCH_TOLERANCE_MS` is now **exported** from
`schedule.ts` beside `CARRY_OVER_MS`, which the reminder cap imports. Fold both into
`SLOT_TOLERANCE_MS`'s module rather than deleting them.
```

(h) Replace:

```
`MyDayTimeline.svelte` and `QuickLogBar.svelte` keep their current props — the
`ScheduleSlot` and `MedicationTimingStatus` shapes are preserved. The medications list
computes no due-ness and is untouched. The three modules consuming `ScheduleSlot` are
the entire blast radius.
```

with:

```
_Amended 2026-09-24: obsolete as written._ `MyDayTimeline.svelte` and
`MedicationTimingStatus` are deleted. `QuickLogBar.svelte` takes
`{ medications, todayStart, timezone, timeFormat }` and shows no due-ness at all. `ScheduleSlot` is kept
(it gained `kind`, `isEarlier`, `resolvedByDoseId` and `missedByDoseId`). The
medications list computes no due-ness and is untouched.
```

(i) If T12 has not already amended it, replace:

```
If a rewrite breaks a rule, that suite says so. `reminders-dedupe.test.ts` keeps its
dedupe-key cases, its look-back cases (`:216-247`) and its fixed-time tolerance cases.
```

with:

```
If a rewrite breaks a rule, that suite says so. `reminders-dedupe.test.ts` keeps its
dedupe-key cases, its look-back cases (`:216-247`) and its fixed-time tolerance cases.
_Amended 2026-09-24:_ it keeps the look-back cases, with ticks inside 12h of the
slot, because the reminder cap stops reminding about a pre-midnight slot once it is
12h old.
```

(j) Replace:

```
- `reminders-dedupe.test.ts:86` — "never-taken interval is not overdue (no baseline)"
- `time.test.ts:152` — "returns 'overdue' when lastTakenAt is null (never taken)"

Both are replaced by a single case asserting the `startedAt + intervalHours` rule.
Having to edit precisely these two, and nothing else, is the check that the decision
landed where the design says it does.
```

with:

```
- `reminders-dedupe.test.ts:86` — "never-taken interval is not overdue (no baseline)"
- ~~`time.test.ts:152` — "returns 'overdue' when lastTakenAt is null (never taken)"~~
  _Amended 2026-09-24:_ deleted with `computeTimingStatus` by the dashboard due-now
  rebuild, so this half of the check no longer exists.

The remaining case is replaced by one asserting the `startedAt + intervalHours` rule.
Having to edit precisely that one, and nothing else, is the check that the decision
landed where the design says it does.
```

(k) Replace:

```
**Retires with its function.** The remainder of `computeTimingStatus`'s block in
`time.test.ts` is deleted along with the function itself — those cases are not
rewritten, because the behaviour they cover moves under the slot projection and is
already asserted by `schedule.test.ts`. `time.test.ts` keeps `formatTimeSince`,
`formatTime`, `startOfDay`, `formatDueIn` and `classifyDueStatus`.
```

with:

```
**Retires with its function.** _Amended 2026-09-24: done._ The dashboard due-now
rebuild deleted `computeTimingStatus`'s block in `time.test.ts` together with the
function. `time.test.ts` keeps `formatTimeSince`, `formatTime`, `startOfDay` and
`formatDueIn`, and gains `formatDuration`. `classifyDueStatus` had no tests and is
deleted.
```

- [ ] **Step 48: Commit the docs**

```bash
npx prettier --write CLAUDE.md docs/superpowers/specs/2026-08-13-due-ness-unification-design.md
git add CLAUDE.md docs/superpowers/specs/2026-08-13-due-ness-unification-design.md
git commit -m "docs: record DoseActionForm and server-relative time; amend the due-ness spec"
```

---

- [ ] **Step 49: Full verification**

Run each command and confirm its expected result:

```bash
npm run check
```

Expected: `svelte-check found 0 errors`. Warnings are pre-existing only; none are in a file this task touched.

```bash
npm run lint
```

Expected: `0 errors`. The warning count is no higher than before the task (120 at the plan's baseline, plus any T1–T10 added), and none are in a file this task touched. Check the touched files with `npx eslint "src/routes/(app)/dashboard" src/lib/components/QuickLogBar.svelte src/lib/components/KeyboardShortcuts.svelte src/lib/utils/quick-log.ts`, which should print no problems.

```bash
npm run format:check
```

Expected: `All matched files use Prettier code style!`

```bash
npx vitest run
```

Expected: every test file passes and 0 fail. The new files `dashboard-page-load`, `dashboard-page-ssr`, `quick-log-target` and `dashboard-chrome-copy` all appear (focus after a write is T10's `dashboard-focus`). `my-day-timeline-ssr` and `dashboard-timing-status` no longer appear.

```bash
npm run test:coverage
```

Expected: passes, with the `vite.config.ts` thresholds met (statements 30, branches 25, functions 25.5, lines 30). CI runs this command.

```bash
npm run build
```

Expected: exits 0 (`✓ built in …`, then adapter-vercel's `done`).

```bash
grep -rnE "MyDayTimeline|SummaryStrip|MedicationTimingStatus|computeTimingStatus|classifyDueStatus|timingStatusFromSlots|groupSlotsByTimeOfDay|classifyHour|getLocalHour|getTodaysDoses|my-day-timeline-ssr|dashboard-timing-status" src tests CLAUDE.md
```

Expected: no output.

---

### Task 12: Reminder cap: stop reminding about a pre-midnight fixed-time slot once it is 12 hours old

**Files:**

- Modify: `src/lib/server/reminders/domain.ts:1-2` (imports), `:7-17` (`OVERDUE_LOOKBACK_DAYS` doc), `:43-44` (compute today's local midnight once), `:59-60` (the cap)
- Test: `tests/unit/reminders-dedupe.test.ts:1-12` (import), `:185-192`, `:245-251`, `:253-257`, `:312-412` (the look-back describe is rewritten with ticks inside 12h), and a new describe inserted after line 412
- Test: `tests/unit/pg/reminders-notification-gate.test.ts:2`, `:26-30` (pin the clock; see Step 7)
- Modify: `.github/workflows/reminder-tick.yml:3-8`, `:25-27` (backstop comments)
- Modify: `CLAUDE.md:73` (the `computeOverdueSlot` gotcha bullet)
- Modify, conditionally (see Step 10): `docs/superpowers/specs/2026-08-13-due-ness-unification-design.md:205-206`

**Interfaces:**

- Consumes from Task 2 (`src/lib/utils/schedule.ts`): `export const CARRY_OVER_MS = 12 * 60 * 60 * 1000`, and `export function checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null` (tests only, for the parity case). From existing `src/lib/utils/time.ts`: `startOfDay(date: Date, timezone: string): Date`.
- Produces: `computeOverdueSlot(row: OverdueRow, now: Date): Date | null`. The signature is unchanged. In the fixed-time walk-back, a slot is now skipped when `slotUtc < startOfDay(now, tz)` **and** `now − slotUtc ≥ CARRY_OVER_MS`. The interval branch is untouched. No dedupe key changes: the cap only withholds slots and never moves an instant.

- [ ] **Step 1: Move the existing look-back cases inside 12 hours of their slot (test-only; must stay green on today's code)**

Every case below computes a slot 13–16 hours before its tick. Under the cap they would either fail or pass for the wrong reason, because the cap returns `null` before the dose is ever consulted. Each one keeps its name and the property it pins.

(a) Replace lines 185-192 in `tests/unit/reminders-dedupe.test.ts`:

```ts
it("future slot today falls back to yesterday's slot, which was taken → not overdue", () => {
  // Today's 23:00 has not arrived yet, so the most recent elapsed
  // occurrence is yesterday's. A dose at that slot satisfies it.
  const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
  expect(
    isScheduleOverdue(fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }), now),
  ).toBe(false);
});
```

with:

```ts
it("future slot today falls back to yesterday's slot, which was taken → not overdue", () => {
  // Today's 23:00 has not arrived yet, so the most recent elapsed
  // occurrence is yesterday's. A dose at that slot satisfies it.
  //
  // Evaluated at 09:00, ten hours after the slot. At the suite's 15:00
  // `now` the slot is 16 hours old, and the pre-midnight cap returns null
  // before the dose is consulted. This case would then pass even with the
  // late-dose rule deleted.
  const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
  expect(
    isScheduleOverdue(
      fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }),
      new Date("2026-05-01T09:00:00.000Z"),
    ),
  ).toBe(false);
});
```

(b) Replace lines 245-257 (the `"returns null when not overdue"` and `"fixed-time slot falls back to yesterday when today's has not arrived"` cases):

```ts
it("returns null when not overdue", () => {
  // Today's 23:00 is still ahead and yesterday's was taken on time.
  const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
  expect(
    computeOverdueSlot(fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }), now),
  ).toBeNull();
});

it("fixed-time slot falls back to yesterday when today's has not arrived", () => {
  const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "23:00" }), now);
  expect(slot).not.toBeNull();
  expect(slot!.toISOString()).toBe("2026-04-30T23:00:00.000Z");
});
```

with:

```ts
it("returns null when not overdue", () => {
  // Today's 23:00 is still ahead and yesterday's was taken on time.
  // Evaluated at 09:00, ten hours after the slot. At the suite's 15:00
  // `now` the pre-midnight cap returns null first and the dose is never
  // consulted.
  const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
  expect(
    computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }),
      new Date("2026-05-01T09:00:00.000Z"),
    ),
  ).toBeNull();
});

it("fixed-time slot falls back to yesterday when today's has not arrived", () => {
  // 09:00, ten hours after yesterday's 23:00, which is inside the 12-hour cap.
  const slot = computeOverdueSlot(
    fixedTimeRow({ timeOfDay: "23:00" }),
    new Date("2026-05-01T09:00:00.000Z"),
  );
  expect(slot).not.toBeNull();
  expect(slot!.toISOString()).toBe("2026-04-30T23:00:00.000Z");
});
```

(c) Replace the whole `describe("computeOverdueSlot — look-back across the cron tick", …)` block, lines 312-412, with:

```ts
describe("computeOverdueSlot — look-back across the cron tick", () => {
  // The original production shape was a daily cron at 09:00 UTC and a
  // medication due at 20:00 UTC. Before the look-back, that returned null
  // forever. The 09:00 tick is now deliberately silent about yesterday's
  // 20:00: the slot is thirteen hours old and past the pre-midnight cap
  // (see the next describe). So the look-back is exercised at 06:00 UTC,
  // the first reminder-tick run of the day ("*/30 6-22 * * *"), ten hours
  // after the slot. Every case keeps the property it is named for.
  const sixAmTick = new Date("2026-05-01T06:00:00.000Z");

  it("catches an evening slot that elapsed since the previous tick", () => {
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), sixAmTick);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-04-30T20:00:00.000Z");
  });

  it("dedupe key differs per day, so a daily slot reminds once per day", () => {
    const dayOne = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), sixAmTick)!;
    const dayTwo = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-05-02T06:00:00.000Z"),
    )!;
    expect(dayOne.toISOString()).toBe("2026-04-30T20:00:00.000Z");
    expect(dayTwo.toISOString()).toBe("2026-05-01T20:00:00.000Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", dayOne)).not.toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s", dayTwo),
    );
  });

  it("prefers today's elapsed slot over yesterday's", () => {
    // At 15:00 an 08:00 schedule has today's slot already behind it.
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "08:00" }), now);
    expect(slot!.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("does not reach back beyond the look-back window", () => {
    // Sunday-only schedule at 20:00, evaluated Friday 06:00. The most
    // recent Sunday slot is five days old, too stale to act on. (The
    // 12-hour cap would silence it as well: every slot two or more days
    // back is already past the cap.)
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [0] }), sixAmTick),
    ).toBeNull();
  });

  it("applies day-of-week to the looked-back date, not to today", () => {
    // 2026-05-01 is a Friday, so the fallback lands on Thursday (4).
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [4] }), sixAmTick),
    ).not.toBeNull();
    // Friday-only: yesterday (Thursday) is excluded and today's 20:00
    // has not arrived, so there is nothing to report yet.
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [5] }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken late still satisfies the slot", () => {
    // Taken at 22:00 for a 20:00 slot: two hours late, well outside the
    // one-hour tolerance, but clearly taken. Reporting it as overdue the
    // next morning would be a false alarm.
    const takenLate = new Date("2026-04-30T22:00:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenLate }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken shortly BEFORE the slot still satisfies it", () => {
    const takenEarly = new Date("2026-04-30T19:30:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenEarly }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken before the previous slot does not satisfy it", () => {
    const takenTwoDaysBefore = new Date("2026-04-28T20:00:00.000Z");
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenTwoDaysBefore }),
        sixAmTick,
      ),
    ).not.toBeNull();
  });

  it("resolves the look-back slot in the user's timezone during BST", () => {
    // 20:00 Europe/London on 30 Apr is 19:00 UTC (BST, UTC+1), eleven
    // hours before the tick.
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      sixAmTick,
    );
    expect(slot!.toISOString()).toBe("2026-04-30T19:00:00.000Z");
  });

  it("resolves the look-back slot in the user's timezone during GMT", () => {
    // 20:00 Europe/London in January is 20:00 UTC (GMT, no offset).
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      new Date("2026-01-15T06:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-01-14T20:00:00.000Z");
  });

  it("crosses a month boundary when looking back", () => {
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-06-01T06:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-05-31T20:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the rewritten cases against today's code; they must pass**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: PASS for all cases. This shows the moved ticks still describe today's behaviour before the cap exists.

- [ ] **Step 3: Write the failing cap tests**

In `tests/unit/reminders-dedupe.test.ts`, insert this line directly after the closing `} from "$lib/server/reminders/domain";` of the import block (line 12):

```ts
import { CARRY_OVER_MS, checkSlotActionTime } from "$lib/utils/schedule";
```

Insert this new describe directly after the look-back describe rewritten in Step 1(c), before `describe("overdue dedupe key — pinned contract (pre-nag-ordinal)", …)`:

```ts
// ---------------------------------------------------------------------
// The 12-hour cap on pre-midnight fixed-time slots (dashboard due-now
// rebuild, decision D9).
//
// The dashboard shows an unresolved slot from before local midnight under
// "Earlier" until it is 12 hours old, then drops it. The cron now stops at
// the same instant, so a reminder never points at a row the dashboard no
// longer offers. The bound is CARRY_OVER_MS, imported rather than written
// out again, and it applies to fixed-time rows only.
// ---------------------------------------------------------------------
describe("computeOverdueSlot — pre-midnight fixed-time slots stop at 12 hours", () => {
  const eightPmYesterday = new Date("2026-04-30T20:00:00.000Z");

  it("uses the dashboard's CARRY_OVER_MS as the boundary", () => {
    expect(new Date("2026-05-01T08:00:00.000Z").getTime() - eightPmYesterday.getTime()).toBe(
      CARRY_OVER_MS,
    );
  });

  it("returns null for a pre-midnight slot exactly 12 hours old", () => {
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T08:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("still returns a pre-midnight slot 1ms short of 12 hours", () => {
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T07:59:59.999Z"),
      ),
    ).toEqual(eightPmYesterday);
  });

  it("the daily 09:00 UTC backstop returns null for the previous day's 20:00", () => {
    // This is the shape the look-back was first written for. The slot is
    // thirteen hours old at the Vercel cron's only run, and the dashboard
    // has already dropped it, so the cron drops it too. The accepted cost
    // is written up in .github/workflows/reminder-tick.yml.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("never caps today's slot, however old", () => {
    // Today's rows stay on the dashboard until midnight, so they keep
    // reminding until then: a 00:30 slot is 23 hours old at 23:30.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "00:30" }),
        new Date("2026-05-01T23:30:00.000Z"),
      ),
    ).toEqual(new Date("2026-05-01T00:30:00.000Z"));
  });

  it("measures midnight in the user's zone, not UTC", () => {
    // 00:30 BST on 1 May is 23:30Z on 30 April. That is yesterday in UTC
    // but TODAY for the user, so twelve and a half hours later it must
    // still remind.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "00:30", userTimezone: "Europe/London" }),
        new Date("2026-05-01T12:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-30T23:30:00.000Z"));
  });

  it("compares by instant, so a slot that rolled past midnight counts as today's", () => {
    // Godthab springs forward at 23:00 on Saturday 2026-03-28, so
    // Saturday's 23:30 resolves to 01:30Z, after Sunday's local midnight
    // (01:00Z). The dashboard files it under Sunday by instant. A day-key
    // test here ("every slot one day back is pre-midnight") would silence
    // it at 13:30Z while the dashboard still shows it as a Sunday row.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "23:30", userTimezone: "America/Godthab" }),
        new Date("2026-03-29T14:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-03-29T01:30:00.000Z"));
  });

  it("does not cap interval rows", () => {
    // An interval reminder is for the FIRST missed occurrence after the
    // last event, not for a projected day. Capping it would silently end
    // that medication's reminders. Aligning the two belongs to the
    // due-ness unification.
    expect(
      computeOverdueSlot(
        intervalRow({ intervalHours: "6", lastEventAt: new Date("2026-04-30T06:00:00.000Z") }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-30T12:00:00.000Z"));
  });

  it("falls silent at exactly the instant the dashboard stops offering the row", () => {
    // One row and one clock, checked against both surfaces: the cron
    // returns null exactly when checkSlotActionTime calls the slot stale.
    // The sweep runs at the reminder-tick cadence across the day in which
    // yesterday's 20:00 BST is the latest elapsed candidate, plus one tick
    // either side of the boundary.
    const tz = "Europe/London";
    const row = fixedTimeRow({ timeOfDay: "20:00", userTimezone: tz });
    const slot = new Date("2026-04-30T19:00:00.000Z"); // 20:00 BST
    const ticks: Date[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      ticks.push(new Date(slot.getTime() + minutes * 60_000));
    }
    ticks.push(
      new Date(slot.getTime() + CARRY_OVER_MS - 1),
      new Date(slot.getTime() + CARRY_OVER_MS),
    );

    let silent = 0;
    for (const tick of ticks) {
      const reminded = computeOverdueSlot(row, tick);
      const stale = checkSlotActionTime(slot, tick, tz) === "stale";
      expect(reminded === null, tick.toISOString()).toBe(stale);
      if (reminded === null) silent++;
      else expect(reminded, tick.toISOString()).toEqual(slot);
    }
    // Non-vacuous in both directions: the sweep sees the row reminded AND
    // silenced (24 half-hour ticks from 12h to 23.5h, plus the exact-12h tick).
    expect(silent).toBe(25);
  });
});
```

- [ ] **Step 4: Run the test and check that it fails**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: FAIL with exactly 3 failures:

- "returns null for a pre-midnight slot exactly 12 hours old": `expected 2026-04-30T20:00:00.000Z to be null`
- "the daily 09:00 UTC backstop returns null for the previous day's 20:00": `expected 2026-04-30T20:00:00.000Z to be null`
- "falls silent at exactly the instant the dashboard stops offering the row": `2026-05-01T07:00:00.000Z: expected false to be true`

The guard cases (1ms short, today's slot, user's zone, Godthab, interval) already pass.

- [ ] **Step 5: Write the minimal implementation**

(a) In `src/lib/server/reminders/domain.ts`, replace lines 1-2:

```ts
import { getLocalDateString } from "$lib/utils/schedule";
import { wallClockToInstant, shiftDayKey, dayOfWeekForDayKey } from "$lib/utils/time";
```

with:

```ts
import { getLocalDateString, CARRY_OVER_MS } from "$lib/utils/schedule";
import { wallClockToInstant, shiftDayKey, dayOfWeekForDayKey, startOfDay } from "$lib/utils/time";
```

(b) In the fixed-time branch, replace:

```ts
const todayStr = getLocalDateString(now, tz);
const lastMs = row.lastEventAt ? new Date(row.lastEventAt).getTime() : null;
```

with:

```ts
const todayStr = getLocalDateString(now, tz);
const todayStartMs = startOfDay(now, tz).getTime();
const lastMs = row.lastEventAt ? new Date(row.lastEventAt).getTime() : null;
```

(c) Replace:

```ts
// Not yet due — try the previous day's occurrence.
if (slotUtc.getTime() > now.getTime()) continue;
```

with:

```ts
// Not yet due — try the previous day's occurrence.
if (slotUtc.getTime() > now.getTime()) continue;

// The 12-hour cap (dashboard due-now rebuild, D9). A slot from before
// local midnight stops reminding once it is CARRY_OVER_MS old. That
// is the same boundary as the dashboard's `visibleStart`, so the
// cron falls silent at the moment the dashboard's "Earlier" group
// drops the row, and a reminder never points at something the page
// no longer offers.
//
// "Before local midnight" is decided by INSTANT against `startOfDay`,
// never by `daysBack`. America/Godthab's Saturday 23:30 resolves to
// 01:30Z Sunday, after Sunday's midnight, and the dashboard files it
// under Sunday. Today's slots are never capped: the dashboard shows
// them until midnight, so they keep reminding until then. The
// interval branch above is deliberately left uncapped.
if (slotUtc.getTime() < todayStartMs && now.getTime() - slotUtc.getTime() >= CARRY_OVER_MS) {
  continue;
}
```

- [ ] **Step 6: Run the tests and check that they pass**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts tests/unit/dst-wall-clock.test.ts tests/unit/schedule-rate.test.ts tests/unit/reminders.test.ts`
Expected: PASS. The three Godthab `computeOverdueSlot` cases in `dst-wall-clock.test.ts` (slots 1.5 hours old at 03:00Z) are unaffected.

- [ ] **Step 7: Pin the clock in the notification-gate PGlite suite**

`tests/unit/pg/reminders-notification-gate.test.ts` runs on the real clock with `timeOfDay: "00:01"` in UTC. If a run starts between 00:00 and 00:01 UTC, the only elapsed slot is yesterday's 00:01. That slot is ~24 hours old and before midnight, so the cap now silences it, and every case that expects a claimed key would fail. Pin the clock so that the slot is always today's.

Replace line 2:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
```

with:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
```

Replace lines 26-30:

```ts
beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
  await pgDb.seedPreferences();
});
```

with:

```ts
beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC", emailVerified: true });
  await pgDb.seedPreferences();
  // Pinned so the 00:01 schedules below are always TODAY's slot. On the
  // real clock, a run between 00:00 and 00:01 UTC found only yesterday's
  // 00:01. That slot is ~24 hours old and before local midnight, so the
  // reminder cap (CARRY_OVER_MS) silences it and every "reminds" case
  // failed. toFake: ["Date"] only, because faking all timers stalls
  // PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
});
```

Run: `npx vitest run tests/unit/pg/reminders-notification-gate.test.ts tests/unit/pg/reminders-nag-series.test.ts tests/unit/pg/low-inventory-episode.test.ts`
Expected: PASS (8 tests in the gate suite; the nag-series slots are same-day 08:00 slots and are unaffected).

- [ ] **Step 8: Prove by mutation**

Apply each change to `src/lib/server/reminders/domain.ts`, run `npx vitest run tests/unit/reminders-dedupe.test.ts`, confirm the named tests fail, then restore:

1. Delete the whole cap `if (…) { continue; }` block. These must fail: "returns null for a pre-midnight slot exactly 12 hours old", "the daily 09:00 UTC backstop…" and "falls silent at exactly the instant…".
2. Change `>= CARRY_OVER_MS` to `> CARRY_OVER_MS`. "returns null for a pre-midnight slot exactly 12 hours old" and "falls silent at exactly the instant…" must fail.
3. Delete the `slotUtc.getTime() < todayStartMs &&` conjunct. "never caps today's slot, however old", "measures midnight in the user's zone, not UTC" and "compares by instant…" must fail.
4. Change `startOfDay(now, tz)` to `startOfDay(now, "UTC")`. "measures midnight in the user's zone, not UTC" must fail.
5. Change `slotUtc.getTime() < todayStartMs &&` to `daysBack > 0 &&`. "compares by instant, so a slot that rolled past midnight counts as today's" must fail.
6. Also copy the cap block into the interval branch just before its `return new Date(lastMs + intervalMs);`, as `const slot = new Date(lastMs + intervalMs); if (slot.getTime() < startOfDay(now, row.userTimezone || "UTC").getTime() && now.getTime() - slot.getTime() >= CARRY_OVER_MS) return null;`. "does not cap interval rows" must fail.
7. Vacuity check on the moved ticks: delete the line `if (lastMs !== null && lastMs >= slotUtc.getTime() - FIXED_TIME_TOLERANCE_MS) return null;`. These must now fail: "future slot today falls back to yesterday's slot, which was taken → not overdue", "returns null when not overdue", "a dose taken late still satisfies the slot" and "a dose taken shortly BEFORE the slot still satisfies it". Before Step 1 moved their ticks, all four would have stayed green under the cap.

- [ ] **Step 9: Update the backstop comments**

(a) In `src/lib/server/reminders/domain.ts`, replace the `OVERDUE_LOOKBACK_DAYS` doc comment (lines 7-16):

```ts
/**
 * How many local days back from `now` the fixed-time scan looks for the
 * most recent elapsed slot.
 *
 * One day is the minimum that makes the scan correct at any cron cadence
 * up to daily: if today's occurrence has not arrived yet, yesterday's
 * has, and that is the dose the user actually missed. Reaching further
 * back would surface doses too stale to act on — by then the point is
 * adherence history, not a reminder.
 */
```

with:

```ts
/**
 * How many local days back from `now` the fixed-time scan looks for the
 * most recent elapsed slot.
 *
 * One day is the minimum that catches a dose timed after the last tick
 * before midnight. If today's occurrence has not arrived yet, yesterday's
 * has, and that is the dose the user actually missed.
 *
 * This is NOT "correct at any cron cadence up to daily" any more, and must
 * not be read that way. A slot from before local midnight is dropped once
 * it is `CARRY_OVER_MS` (12h) old (see the cap in `computeOverdueSlot`),
 * so a tick reminds about yesterday's slot only if it runs within those 12
 * hours. The every-30-minutes `reminder-tick` workflow does. The daily
 * 09:00 UTC Vercel cron on its own covers only the 12 hours before it.
 * Raising this constant would change nothing, because every slot two or
 * more days back is already past the cap.
 */
```

(b) In `.github/workflows/reminder-tick.yml`, replace lines 3-8:

```yaml
# Drives /api/cron/reminders more often than the Vercel Hobby plan
# allows. Hobby caps cron jobs at one run per day, which is far too
# coarse for medication reminders: an evening dose would only ever be
# reported the following morning. The vercel.json cron stays in place as
# a guaranteed daily backstop; this workflow is what makes reminders
# timely during waking hours.
```

with:

```yaml
# Drives /api/cron/reminders more often than the Vercel Hobby plan
# allows. Hobby caps cron jobs at one run per day, which is far too
# coarse for medication reminders: an evening dose would only ever be
# reported the following morning. This workflow is what makes reminders
# timely during waking hours.
#
# The vercel.json cron (09:00 UTC) stays in place as a daily backstop,
# but a narrow one. computeOverdueSlot stops reminding about a fixed-time
# slot from before the user's local midnight once it is 12 hours old
# (CARRY_OVER_MS, the instant the dashboard stops showing it). So the
# 09:00 run on its own covers today's elapsed slots and only the last 12
# hours of yesterday's. If GitHub disables this workflow (see below),
# yesterday's daytime slots lose their day-late reminder rather than
# getting it at 09:00. The cron dead-man switch (#128) is what detects
# that.
```

and replace lines 25-27:

```yaml
# Every 30 minutes, 06:00–22:59 UTC. The overnight gap lets the Neon
# compute scale to zero instead of being held awake around the
# clock, and the daily Vercel cron still covers that window.
```

with:

```yaml
# Every 30 minutes, 06:00–22:59 UTC. The overnight gap lets the Neon
# compute scale to zero instead of being held awake around the
# clock. A slot that falls due in the gap is picked up by the 06:00
# run, at most 7½ hours late. Keep the gap under 12 hours: a slot
# from before the user's midnight stops reminding at 12 hours old
# (computeOverdueSlot's cap), so a longer gap would silently skip it.
```

(c) In `CLAUDE.md`, replace line 73:

```markdown
- `computeOverdueSlot` for `fixed_time` scans back `OVERDUE_LOOKBACK_DAYS` (1) to find the most recent _elapsed_ slot. Evaluating only today's slot silently dropped every schedule timed after the cron tick — permanently, since the local date rolls over before the next tick. A dose at or after the slot satisfies it however late; the tolerance window only extends backwards.
```

with:

```markdown
- `computeOverdueSlot` for `fixed_time` scans back `OVERDUE_LOOKBACK_DAYS` (1) to find the most recent _elapsed_ slot. Evaluating only today's slot silently dropped every schedule timed after the cron tick — permanently, since the local date rolls over before the next tick. A dose at or after the slot satisfies it however late; the tolerance window only extends backwards. **A slot from before local midnight stops reminding once it is `CARRY_OVER_MS` (12h) old.** The constant is imported from `utils/schedule.ts` and is the same bound as the dashboard's `visibleStart`, so the cron falls silent the moment the dashboard hides the row (`reminders-dedupe.test.ts` sweeps both surfaces against each other). It is compared by instant against `startOfDay(now, tz)`, never by day key, so a Godthab slot that rolled past midnight is a today slot on both surfaces. It applies to fixed-time rows only: interval rows remind about the first missed occurrence after the last event, and a cap would silently end them. The cost is accepted: the daily 09:00 UTC Vercel cron now backstops only the 12 hours before it, so if GitHub disables `reminder-tick`, yesterday's daytime slots lose their day-late reminder.
```

- [ ] **Step 10: Amend the due-ness spec's look-back line (only if Task 11 has not already)**

Run: `grep -n "ticks inside 12h" docs/superpowers/specs/2026-08-13-due-ness-unification-design.md`
If it prints a line, Task 11 already made this edit, so skip this step. If it prints nothing, replace lines 205-206:

```markdown
If a rewrite breaks a rule, that suite says so. `reminders-dedupe.test.ts` keeps its
dedupe-key cases, its look-back cases (`:216-247`) and its fixed-time tolerance cases.
```

with:

```markdown
If a rewrite breaks a rule, that suite says so. `reminders-dedupe.test.ts` keeps its
dedupe-key cases, its look-back cases (`:216-247`), which it keeps with ticks inside 12h
of the slot since the [due-now rebuild](2026-09-24-dashboard-due-now-design.md#reminder-cap-d9)
capped pre-midnight reminders at 12 hours, and its fixed-time tolerance cases.
```

- [ ] **Step 11: Run the full suite, type-check and lint**

Run: `npx vitest run && npm run check && npx eslint src/lib/server/reminders/domain.ts tests/unit/reminders-dedupe.test.ts tests/unit/pg/reminders-notification-gate.test.ts`
Expected: all tests PASS and there are no new check or lint errors.

- [ ] **Step 12: Commit**

```bash
git add src/lib/server/reminders/domain.ts tests/unit/reminders-dedupe.test.ts tests/unit/pg/reminders-notification-gate.test.ts .github/workflows/reminder-tick.yml CLAUDE.md docs/superpowers/specs/2026-08-13-due-ness-unification-design.md
git commit -m "fix(reminders): stop reminding about a pre-midnight slot once it is 12 hours old"
```

---
