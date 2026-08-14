# Interval Rate Precedence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the six scattered restatements of `24 / intervalHours` one owner, and close the defect where `computeOverdueSlot` reports a medication overdue the instant it is logged.

**Architecture:** A new pure module `src/lib/utils/schedule-rate.ts` owns the interval primitive — what counts as a usable interval and what rate it implies. `server/inventory.ts:dailyRateFor` keeps owning the precedence (schedule rows → legacy column → 30-day history). The primitive lives in `utils/` because two of its callers are client-reachable and may never import from `$lib/server`.

**Tech Stack:** SvelteKit, TypeScript, Zod, Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-14-interval-rate-precedence-design.md`

## Global Constraints

- **Baseline is 777 tests across 64 files** on `origin/main` (`d760d0d`). Every task ends green. If a task's count drops, stop.
- **`MAX_INTERVAL_HOURS = 72` is a door policy.** Apply it only in the two Zod schemas and the import gate. **Never** apply it when reading stored rows — a stored 168 (weekly injection) must keep producing a rate. This is Decision 3 in the spec and is the single most likely thing to get wrong.
- **Nothing under `src/lib/utils/` may import from `$lib/server`.** `utils/time.ts` and `utils/schedule.ts` are client-reachable. This is why the primitive is not in `inventory.ts`. Type-only imports are fine and already exist.
- **No pre-existing assertion may be edited.** The only exception in this whole plan is the characterization test _this plan itself adds_ in Task 3 Step 1, which Task 3 Step 4 deliberately flips. Any other edit inside an existing `it(...)` body means behaviour moved somewhere it should not have — stop and report.
- **Drizzle `numeric` columns arrive as strings.** `"0"` is truthy. `!intervalHours` is never a sufficient guard. This is the entire bug.
- **Commit messages must contain no Claude/AI attribution** — no `Claude-Session:` trailer, no session URL, no `Co-Authored-By: Claude`, no "Generated with" line. This is a standing user preference.
- Test command: `DATABASE_URL='postgresql://placeholder:placeholder@placeholder/placeholder?sslmode=require' npx vitest run`
- Verification commands: `npx vitest run`, `npm run check`, `npm run lint`.

---

### Task 1: The `schedule-rate` primitive

**Files:**

- Create: `src/lib/utils/schedule-rate.ts`
- Test: `tests/unit/schedule-rate.test.ts`

**Interfaces:**

- Consumes: nothing. This is the base of the dependency graph.
- Produces:
  - `MAX_INTERVAL_HOURS: number` (= 72)
  - `parseIntervalHours(raw: string | number | null | undefined): number | null`
  - `intervalDosesPerDay(raw: string | number | null | undefined): number`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/schedule-rate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MAX_INTERVAL_HOURS,
  parseIntervalHours,
  intervalDosesPerDay,
} from "$lib/utils/schedule-rate";

describe("parseIntervalHours", () => {
  it("parses a positive integer string, the shape Drizzle returns", () => {
    expect(parseIntervalHours("8")).toBe(8);
  });

  it("parses a decimal string, because a numeric column can carry one", () => {
    expect(parseIntervalHours("12.5")).toBe(12.5);
  });

  it("parses a plain number, for callers that already converted", () => {
    expect(parseIntervalHours(6)).toBe(6);
  });

  it("REJECTS the string zero — the defect this module exists for", () => {
    // `"0"` is truthy, so the old guard `if (!intervalHours)` let it through
    // and computeOverdueSlot reported a dose overdue the instant it was logged.
    expect(parseIntervalHours("0")).toBeNull();
  });

  it("rejects a negative interval", () => {
    expect(parseIntervalHours("-4")).toBeNull();
  });

  it("rejects null, undefined and the empty string", () => {
    expect(parseIntervalHours(null)).toBeNull();
    expect(parseIntervalHours(undefined)).toBeNull();
    expect(parseIntervalHours("")).toBeNull();
  });

  it("rejects a non-numeric string", () => {
    expect(parseIntervalHours("every 8 hours")).toBeNull();
  });

  it("ACCEPTS a value above MAX_INTERVAL_HOURS — the cap is a door policy", () => {
    // 168h is a weekly injection. Stored rows predate the bound and must keep
    // producing a rate; rejecting on read would drop the medication out of
    // refill forecasting, out of adherence and out of reminders.
    expect(parseIntervalHours("168")).toBe(168);
  });
});

describe("intervalDosesPerDay", () => {
  it("computes 24 / hours", () => {
    expect(intervalDosesPerDay("24")).toBe(1);
    expect(intervalDosesPerDay("12")).toBe(2);
    expect(intervalDosesPerDay("8")).toBeCloseTo(3, 5);
  });

  it("returns 0 for an unusable interval rather than Infinity", () => {
    expect(intervalDosesPerDay("0")).toBe(0);
    expect(intervalDosesPerDay(null)).toBe(0);
  });

  it("returns a sub-daily rate for an interval above the door cap", () => {
    expect(intervalDosesPerDay("168")).toBeCloseTo(1 / 7, 5);
  });
});

describe("MAX_INTERVAL_HOURS", () => {
  it("is 72, the bound both strict doors have always enforced", () => {
    expect(MAX_INTERVAL_HOURS).toBe(72);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule-rate.test.ts`
Expected: FAIL — `Failed to resolve import "$lib/utils/schedule-rate"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/utils/schedule-rate.ts`:

```ts
/**
 * The single usability test for a schedule interval, and the dose rate it
 * implies.
 *
 * Drizzle `numeric` columns arrive in JS as **strings**, so the obvious guard
 * `if (!intervalHours)` does not reject a zero interval — `"0"` is truthy.
 * That is not hypothetical: it is the defect this module was extracted to fix.
 * `computeOverdueSlot` passed a `"0"` row, computed an interval of 0ms, and
 * returned the dose the user had just logged as an overdue slot.
 *
 * Lives in `utils/` and not `server/` because `utils/time.ts` and
 * `utils/schedule.ts` are client-reachable and may never import `$lib/server`.
 */

/**
 * Admission bound for NEW interval input, in hours.
 *
 * A door policy, applied where data enters: the two Zod schemas and the import
 * gate. Deliberately NOT applied when reading stored rows — a stored 168 (a
 * weekly injection) is a meaningful rate that predates the bound, and
 * rejecting it on read would silently drop that medication out of refill
 * forecasting, out of the adherence denominator and out of reminders.
 */
export const MAX_INTERVAL_HOURS = 72;

/**
 * Parse a stored interval into usable hours, or null if it cannot produce a
 * rate. Accepts the string form Drizzle returns as well as a plain number.
 *
 * Returns the hours rather than a boolean so callers replace BOTH halves of
 * the old two-step (guard, then `Number(...)`) with one call — which is what
 * removes the opportunity to spell the guard a seventh way.
 */
export function parseIntervalHours(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return hours;
}

/** Doses per day implied by an interval row: `24 / hours`, or 0 if unusable. */
export function intervalDosesPerDay(raw: string | number | null | undefined): number {
  const hours = parseIntervalHours(raw);
  return hours === null ? 0 : 24 / hours;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/schedule-rate.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Verify each test can fail (Wave 3, on the primitive)**

Apply each break to `src/lib/utils/schedule-rate.ts` one at a time, run the file, confirm the named test **fails**, then revert the break before applying the next.

| Break                                                          | Must fail                                  |
| -------------------------------------------------------------- | ------------------------------------------ |
| `hours <= 0` → `hours < 0`                                     | "REJECTS the string zero"                  |
| add `\|\| hours > MAX_INTERVAL_HOURS` to the reject condition  | "ACCEPTS a value above MAX_INTERVAL_HOURS" |
| `return 24 / hours` → `return hours`                           | "computes 24 / hours"                      |
| `hours === null ? 0 : ...` → `hours === null ? Infinity : ...` | "returns 0 for an unusable interval"       |
| `MAX_INTERVAL_HOURS = 72` → `= 48`                             | "is 72, the bound both strict doors"       |

The second row is the important one: it is the only mechanical proof that Decision 3 is actually under test. If it does not fail, the weekly-injection case is not protected and the plan must stop here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/schedule-rate.ts tests/unit/schedule-rate.test.ts
git commit -m "feat(schedule): add the interval rate primitive

Drizzle numeric columns arrive as strings, so \"0\" is truthy and the
guard \`if (!intervalHours)\` does not reject a zero interval. Six sites
each spell that guard differently and one of them gets it wrong.

parseIntervalHours returns hours-or-null so a caller replaces both the
guard and the Number() conversion with one call. MAX_INTERVAL_HOURS is
exported for the write doors only: applying it on read would reject a
stored weekly interval that predates the bound."
```

---

### Task 2: Characterization harness for the five correct read sites

Pins today's behaviour **before** any production code moves. These tests must
pass against unmodified code — they are the net that proves Tasks 4-6 change
nothing. This ordering is the #110 lesson: that PR shipped 753 green tests
which proved nothing, because the tests pinning the old contract were deleted
and _then_ the behaviour they protected was changed.

**Files:**

- Modify: `tests/unit/analytics.test.ts` (append inside `describe("expectedPerDayForSchedules")`)
- Modify: `tests/unit/inventory.test.ts` (append inside `describe("dailyRateFor")`)
- Modify: `tests/unit/medication-stats.test.ts` (append inside the top-level `describe`)
- Modify: `tests/unit/time.test.ts` (append inside `describe("calculateDaysUntilRefill")`)
- Modify: `tests/unit/schedule.test.ts` (append inside `describe("computeScheduleSlots — interval kind")`)

**Interfaces:**

- Consumes: nothing from Task 1. These test existing production code as-is.
- Produces: the regression net Tasks 4-6 rely on. No exports.

- [ ] **Step 1: Add the analytics case**

In `tests/unit/analytics.test.ts`, inside `describe("expectedPerDayForSchedules", ...)`, after the existing `"ignores an interval row with a non-positive interval"` test (which already pins the `"0"` case — leave it untouched, it is a free regression check):

```ts
it("counts an interval above the door cap, which is stored data not new input", () => {
  // The 72h bound lives at the write doors. A stored 168 (weekly injection)
  // must still contribute a rate. See Decision 3 in the design doc.
  expect(
    expectedPerDayForSchedules([schedule({ scheduleKind: "interval", intervalHours: "168" })]),
  ).toBeCloseTo(24 / 168, 5);
});
```

- [ ] **Step 2: Add the inventory cases**

In `tests/unit/inventory.test.ts`, inside `describe("dailyRateFor", ...)`:

```ts
it("ignores a zero schedule interval and falls through to history", () => {
  // "0" is truthy as a string; dailyRateFor must not divide by it.
  expect(dailyRateFor([intervalSchedule(0)], "as_needed", null, 30)).toBe(1);
});

it("ignores a zero legacy interval and falls through to history", () => {
  expect(dailyRateFor(undefined, "scheduled", "0", 30)).toBe(1);
});

it("honours a legacy interval above the door cap", () => {
  expect(dailyRateFor(undefined, "scheduled", "168", 0)).toBeCloseTo(24 / 168, 5);
});
```

- [ ] **Step 3: Add the medication-stats case**

In `tests/unit/medication-stats.test.ts`:

```ts
it("reports no expected rate for a zero legacy interval rather than a fabricated one", () => {
  // expectedDailyDoses is the adherence DENOMINATOR. A zero interval is not a
  // schedule, so it must yield null — not the 30-day history rate, which would
  // draw an adherence bar measuring the user against their own past behaviour.
  // This is why medications.ts keeps its own legacyRate (spec Decision 5).
  const med = makeMed({ scheduleType: "scheduled", scheduleIntervalHours: "0" });
  const out = medicationStatsFor(med, [], {
    lastTakenAt: null,
    weeklyDoseCount: 0,
    thirtyDayDoseCount: 30,
  });
  expect(out.expectedDailyDoses).toBeNull();
});
```

- [ ] **Step 4: Add the time cases**

In `tests/unit/time.test.ts`, inside `describe("calculateDaysUntilRefill", ...)`:

```ts
it("ignores a zero schedule interval and uses the historical average", () => {
  // 0.5 doses/day → floor(20 / 0.5) = 40
  expect(calculateDaysUntilRefill(20, 0.5, "scheduled", "0")).toBe(40);
});

it("honours a schedule interval above the door cap", () => {
  // 168h → 1/7 doses/day → floor(20 / (1/7)) = 140
  expect(calculateDaysUntilRefill(20, 0.5, "scheduled", "168")).toBe(140);
});
```

- [ ] **Step 5: Add the schedule cases**

In `tests/unit/schedule.test.ts`, inside `describe("computeScheduleSlots — interval kind", ...)`, which already defines `dayStart`, `dayEnd` and `timezone`:

```ts
it("produces no slots for a zero interval", () => {
  const meds = [makeMed()];
  const sched = schedMap([makeIntervalSchedule("med-1", "0")]);
  const now = new Date("2026-04-16T10:00:00Z");
  const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
  expect(slots).toHaveLength(0);
});

it("produces a single slot for an interval longer than the day window", () => {
  // 168h (weekly) is above the door cap but valid stored data. The anchor is
  // dayStart when there is no prior dose, and the next step lands past dayEnd.
  const meds = [makeMed()];
  const sched = schedMap([makeIntervalSchedule("med-1", "168")]);
  const now = new Date("2026-04-16T10:00:00Z");
  const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
  expect(slots).toHaveLength(1);
  expect(slots[0].expectedTime).toBe("2026-04-16T00:00:00.000Z");
});
```

- [ ] **Step 6: Run the full suite to verify all new tests pass against unmodified code**

Run: `npx vitest run`
Expected: PASS. 777 + 12 (Task 1) + 9 (Task 2) = **798 tests across 65 files**.

If any test in this task fails, the characterization is wrong, not the code. Fix the test to match today's actual behaviour and record the surprise — a wrong assumption here is exactly what this task exists to surface.

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "test(schedule): pin interval rate behaviour before it moves

Characterization net for the five read sites that already handle a
non-positive interval correctly, plus the above-cap case at each. These
pass against unmodified code and must keep passing through the
migration; anything that flips means a refactor changed behaviour.

Ordering is deliberate. #110 shipped 753 green tests that proved nothing
because the tests pinning the old contract were deleted and then the
behaviour they protected was changed."
```

---

### Task 3: Fix `computeOverdueSlot`

The defect. `intervalHours` is a string, `"0"` is truthy, so the guard passes,
`intervalMs` is 0, and the function returns `lastEventAt` — the dose the user
just logged — as an overdue slot.

**Files:**

- Modify: `src/lib/server/reminders/domain.ts:41-50`
- Test: `tests/unit/reminders-dedupe.test.ts` (append inside `describe("computeOverdueSlot — returns the actual slot Date used in dedupe keys")`)

**Interfaces:**

- Consumes: `parseIntervalHours` from Task 1.
- Produces: no signature change. `computeOverdueSlot(row: OverdueRow, now: Date): Date | null` is unchanged; only which inputs yield `null`.

- [ ] **Step 1: Write the characterization test pinning the CURRENT (buggy) behaviour**

This step is deliberate. Asserting the bug first proves the test is wired to
the right code path — a desired-behaviour test that fails could be failing
because of a typo in the helper. Add to `tests/unit/reminders-dedupe.test.ts`:

```ts
it("CURRENT BEHAVIOUR (bug): a zero interval yields a slot equal to lastEventAt", () => {
  // Flipped in the very next commit. `"0"` is truthy so the guard passes,
  // intervalMs is 0, and the dose the user just logged comes back as overdue.
  const lastTaken = new Date("2026-05-01T09:00:00.000Z");
  const slot = computeOverdueSlot(intervalRow({ intervalHours: "0", lastEventAt: lastTaken }), now);
  expect(slot).toEqual(lastTaken);
});
```

- [ ] **Step 2: Run to verify it passes against current code**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: PASS. The bug is now pinned and observable.

- [ ] **Step 3: Commit the pinned bug**

```bash
git add tests/unit/reminders-dedupe.test.ts
git commit -m "test(reminders): pin the zero-interval overdue defect

Asserts the current wrong behaviour so the fix has something visible to
flip, and so the test is proven wired to the right code path before it
is inverted."
```

- [ ] **Step 4: Flip the assertion to the desired behaviour and add the neighbours**

Replace the test written in Step 1 with:

```ts
it("a zero interval is not a schedule and yields no slot", () => {
  // `intervalHours` is a Drizzle numeric — a STRING — so `"0"` is truthy and
  // `!row.intervalHours` never rejected it. intervalMs became 0, so the slot
  // came back as lastEventAt and the medication was overdue the instant it
  // was logged. One spurious reminder per dose.
  const lastTaken = new Date("2026-05-01T09:00:00.000Z");
  expect(
    computeOverdueSlot(intervalRow({ intervalHours: "0", lastEventAt: lastTaken }), now),
  ).toBeNull();
});

it("a zero interval is not overdue", () => {
  const lastTaken = new Date("2026-05-01T09:00:00.000Z");
  expect(isScheduleOverdue(intervalRow({ intervalHours: "0", lastEventAt: lastTaken }), now)).toBe(
    false,
  );
});

it("an interval above the door cap still produces a slot", () => {
  // 168h weekly. The cap is a door policy; readers must not apply it, or a
  // weekly injection stops reminding entirely. See Decision 3.
  const lastTaken = new Date("2026-04-01T09:00:00.000Z");
  const slot = computeOverdueSlot(
    intervalRow({ intervalHours: "168", lastEventAt: lastTaken }),
    now,
  );
  expect(slot).toEqual(new Date("2026-04-08T09:00:00.000Z"));
});
```

- [ ] **Step 5: Run to verify the first two fail**

Run: `npx vitest run tests/unit/reminders-dedupe.test.ts`
Expected: FAIL — "a zero interval is not a schedule" gets `2026-05-01T09:00:00.000Z`, expected `null`; "a zero interval is not overdue" gets `true`, expected `false`. The above-cap test should already PASS (168 is positive, so current code handles it).

- [ ] **Step 6: Fix the guard**

In `src/lib/server/reminders/domain.ts`, add the import at the top of the file:

```ts
import { parseIntervalHours } from "$lib/utils/schedule-rate";
```

Then replace the interval branch of `computeOverdueSlot`:

```ts
// BEFORE
if (row.scheduleKind === "interval") {
  if (!row.intervalHours || !row.lastEventAt) return null;
  const intervalMs = Number(row.intervalHours) * 3600000;
  const lastMs = new Date(row.lastEventAt).getTime();
  if (now.getTime() - lastMs <= intervalMs) return null;
  return new Date(lastMs + intervalMs);
}

// AFTER
if (row.scheduleKind === "interval") {
  const hours = parseIntervalHours(row.intervalHours);
  if (hours === null || !row.lastEventAt) return null;
  const intervalMs = hours * 3600000;
  const lastMs = new Date(row.lastEventAt).getTime();
  if (now.getTime() - lastMs <= intervalMs) return null;
  return new Date(lastMs + intervalMs);
}
```

- [ ] **Step 7: Run the full suite**

Run: `npx vitest run`
Expected: PASS, **801 tests across 65 files**.

The arithmetic: Step 1 added one test (799), and Step 4 replaced that one with
three. The replaced test never counted toward the 798 baseline, so it is not
subtracted from it — 798 + 3 = 801.

Pay attention to `tests/unit/reminders.test.ts` and `tests/unit/reminders-dispatch.test.ts` — if either flips, a dedupe key changed shape, which is the exact failure that got #110 reverted. Stop and report if so.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/reminders/domain.ts tests/unit/reminders-dedupe.test.ts
git commit -m "fix(reminders): stop reporting a zero-interval dose as overdue

intervalHours is a Drizzle numeric and arrives as a string, so \"0\" is
truthy and \`!row.intervalHours\` did not reject it. intervalMs became 0
and the returned slot equalled lastEventAt, so the medication was
overdue the instant it was logged — one spurious reminder per dose.

The slot equals lastEventAt and is fixed until the next dose, so the
dedupe key was stable; this is one bogus reminder per dose, not the
per-tick churn that got #110 reverted. No valid interval's key changes."
```

---

### Task 4: Migrate `analytics.ts`

**Files:**

- Modify: `src/lib/server/analytics.ts:17-31`

**Interfaces:**

- Consumes: `intervalDosesPerDay` from Task 1.
- Produces: `expectedPerDayForSchedules(schedules: MedicationSchedule[]): number` — signature and behaviour unchanged.

- [ ] **Step 1: Apply the migration**

Add to the imports at the top of `src/lib/server/analytics.ts`:

```ts
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
```

Replace the interval branch inside `expectedPerDayForSchedules`:

```ts
// BEFORE
if (s.scheduleKind === "interval" && s.intervalHours) {
  const hrs = Number(s.intervalHours);
  if (hrs > 0) perDay += 24 / hrs;
} else if (s.scheduleKind === "fixed_time" && s.timeOfDay) {

// AFTER
if (s.scheduleKind === "interval") {
  perDay += intervalDosesPerDay(s.intervalHours);
} else if (s.scheduleKind === "fixed_time" && s.timeOfDay) {
```

Note the `&& s.intervalHours` drops out of the branch condition. It has to: an
interval row with an unusable value must contribute 0 and fall through to
neither branch, which is what `intervalDosesPerDay` returning 0 achieves. Had
it stayed, a `"0"` row would fall into the `fixed_time` check instead.

- [ ] **Step 2: Run the affected tests**

Run: `npx vitest run tests/unit/analytics.test.ts tests/unit/inventory.test.ts tests/unit/medication-stats.test.ts`
Expected: PASS. In particular `"ignores an interval row with a non-positive interval"` — a pre-existing test — must still pass untouched.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 801 tests. No count change; this is a pure refactor.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/analytics.ts
git commit -m "refactor(analytics): take the interval rate from the primitive

Behaviour unchanged. The \`&& s.intervalHours\` branch condition drops
out deliberately: an unusable interval row must contribute 0, not fall
through to the fixed_time check."
```

---

### Task 5: Migrate the two legacy-column sites

`inventory.ts` and `medications.ts` restate the same legacy-column derivation.
They move together because a reviewer could not sensibly accept one and reject
the other.

**Files:**

- Modify: `src/lib/server/inventory.ts:45-50`
- Modify: `src/lib/server/medications.ts:108-113`

**Interfaces:**

- Consumes: `intervalDosesPerDay` from Task 1.
- Produces: `dailyRateFor(schedules, legacyScheduleType, legacyIntervalHours, thirtyDayDoseCount): number` and `medicationStatsFor(med, schedules, s): MedicationWithStats` — both unchanged.

- [ ] **Step 1: Migrate `inventory.ts`**

Add to the imports:

```ts
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
```

Replace the legacy branch in `dailyRateFor`:

```ts
// BEFORE
if (legacyScheduleType === "scheduled") {
  const hrs = legacyIntervalHours !== null ? Number(legacyIntervalHours) : NaN;
  if (Number.isFinite(hrs) && hrs > 0) return 24 / hrs;
}
return thirtyDayDoseCount / 30;

// AFTER
if (legacyScheduleType === "scheduled") {
  const legacyRate = intervalDosesPerDay(legacyIntervalHours);
  if (legacyRate > 0) return legacyRate;
}
return thirtyDayDoseCount / 30;
```

- [ ] **Step 2: Migrate `medications.ts`**

Add `intervalDosesPerDay` to the existing import from `./analytics`'s neighbour — it comes from the primitive, so add a new import line:

```ts
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
```

Replace the legacy derivation:

```ts
// BEFORE
const legacyHrs = med.scheduleIntervalHours != null ? Number(med.scheduleIntervalHours) : NaN;
const legacyRate =
  med.scheduleType === "scheduled" && Number.isFinite(legacyHrs) && legacyHrs > 0
    ? 24 / legacyHrs
    : 0;

// AFTER
const legacyRate =
  med.scheduleType === "scheduled" ? intervalDosesPerDay(med.scheduleIntervalHours) : 0;
```

**Do not delete `legacyRate` and substitute `dailyRate`.** It looks like a
duplicate of `dailyRateFor` and is not. `expectedDailyDoses` must be `null`
when there is no scheduled rate, and `dailyRateFor` cannot express that — it
falls back to `thirtyDayDoseCount / 30`. Substituting it would hand a PRN
medication its own dose history as an expected rate and draw an adherence bar
measuring the user against their own past behaviour. See spec Decision 5.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 801 tests. Watch `medication-stats.test.ts:93` — "falls back to 30-day history for PRN medications and reports no expected rate" — which asserts `daysUntilRefill` is 40 _and_ `expectedDailyDoses` is null. That pair is the exact regression Decision 5 guards against.

- [ ] **Step 4: Commit**

```bash
git add src/lib/server/inventory.ts src/lib/server/medications.ts
git commit -m "refactor(inventory): take the legacy interval rate from the primitive

Behaviour unchanged at both sites. medications.ts keeps its own
legacyRate rather than reusing dailyRate: expectedDailyDoses is the
adherence denominator and must be null when there is no scheduled rate,
where dailyRateFor always returns a number by falling back to history."
```

---

### Task 6: Migrate the two client-side sites

`utils/time.ts` and `utils/schedule.ts`. These are the reason the primitive
lives in `utils/` — neither may import from `$lib/server`.

**Files:**

- Modify: `src/lib/utils/time.ts:86-95`
- Modify: `src/lib/utils/schedule.ts:121-128` and `:219-221`

**Interfaces:**

- Consumes: `parseIntervalHours` from Task 1.
- Produces: `calculateDaysUntilRefill(...)` and `computeScheduleSlots(...)` — both unchanged.

- [ ] **Step 1: Migrate `time.ts`**

Add to the imports:

```ts
import { parseIntervalHours } from "$lib/utils/schedule-rate";
```

Replace the rate derivation in `calculateDaysUntilRefill`:

```ts
// BEFORE
const intervalHours =
  scheduleIntervalHours !== null && scheduleIntervalHours !== undefined
    ? Number(scheduleIntervalHours)
    : NaN;
const scheduledDaily =
  scheduleType === "scheduled" && Number.isFinite(intervalHours) && intervalHours > 0
    ? 24 / intervalHours
    : 0;

// AFTER
const hours = parseIntervalHours(scheduleIntervalHours);
const scheduledDaily = scheduleType === "scheduled" && hours !== null ? 24 / hours : 0;
```

`calculateDaysUntilRefill` is dead code — no call sites across `src`, `tests`,
`scripts` or `drizzle`. It is migrated for consistency, not revived. Its 13
assertions make deleting it a separate decision, out of scope here.

- [ ] **Step 2: Migrate `schedule.ts`**

Add to the imports:

```ts
import { parseIntervalHours } from "$lib/utils/schedule-rate";
```

At the caller (around line 219), replace:

```ts
// BEFORE
const intervalHours = schedule.intervalHours ? Number(schedule.intervalHours) : 0;
if (!intervalHours || intervalHours <= 0) continue;

// AFTER
const intervalHours = parseIntervalHours(schedule.intervalHours);
if (intervalHours === null) continue;
```

Leave `expectedTimesForInterval`'s own `if (!intervalHours || intervalHours <= 0) return [];`
in place. It takes a `number` that the caller has already validated, so it is a
defensive floor on a private function rather than a seventh restatement of the
rule — and removing it would let a future caller pass an unchecked value into
the `while` loop, which is unbounded on a zero interval.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run`
Expected: PASS, 801 tests.

- [ ] **Step 4: Verify the client/server boundary still holds**

Run: `npm run check`
Expected: no errors. Confirm by inspection that neither `src/lib/utils/time.ts` nor `src/lib/utils/schedule.ts` imports from `$lib/server` — `schedule.ts` imports the `MedicationSchedule` _type_ from `$lib/server/schedules`, which is erased at build and was already there. Do not add a value import.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/time.ts src/lib/utils/schedule.ts
git commit -m "refactor(schedule): take the interval guard from the primitive

Both files are client-reachable, which is why the primitive lives in
utils/ rather than in inventory.ts alongside the precedence it serves.

expectedTimesForInterval keeps its own floor: it takes a number the
caller has already validated, and its while loop is unbounded on a zero
interval, so the defensive check earns its place."
```

---

### Task 7: The import door

The only door that admits the value. Closing it stops new `"0"` rows arriving;
Task 3 already neutralised any that are stored.

**Files:**

- Modify: `src/lib/utils/validation.ts:173`
- Modify: `src/lib/server/import/backup.ts:99-119`
- Test: `tests/unit/import-backup.test.ts` (append inside the existing top-level `describe`)

**Interfaces:**

- Consumes: `parseIntervalHours` and `MAX_INTERVAL_HOURS` from Task 1.
- Produces: no signature change to `parseBackup`. Only which schedule rows survive as `interval` rather than being demoted to `prn`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/import-backup.test.ts`, next to the existing
`"demotes a fixed-time schedule with no time to PRN"` test:

```ts
it("demotes a zero-interval schedule to PRN rather than writing a reminder trap", () => {
  // The import door is the only one of three that admits "0" — the web form
  // and /api/v1 both parse through scheduleRowSchema's positive().max(72).
  // A live "0" interval row made the medication overdue the instant it was
  // logged, once per dose.
  const raw = backup();
  (raw.medications as Json[])[0].schedules = [
    { scheduleKind: "interval", intervalHours: "0", sortOrder: 0 },
  ];
  const result = parseBackup(JSON.stringify(raw));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");
  expect(result.bundle.warnings.join(" ")).toMatch(/as needed/);
});

it("demotes an interval above the door cap, which the other two doors reject", () => {
  const raw = backup();
  (raw.medications as Json[])[0].schedules = [
    { scheduleKind: "interval", intervalHours: "9999", sortOrder: 0 },
  ];
  const result = parseBackup(JSON.stringify(raw));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("prn");
});

it("keeps a valid interval at the cap boundary", () => {
  // 72 is admissible; 73 is not. The boundary is inclusive.
  const raw = backup();
  (raw.medications as Json[])[0].schedules = [
    { scheduleKind: "interval", intervalHours: "72", sortOrder: 0 },
  ];
  const result = parseBackup(JSON.stringify(raw));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.bundle.medications[0].schedules[0].scheduleKind).toBe("interval");
  expect(result.bundle.medications[0].schedules[0].intervalHours).toBe("72");
  expect(result.bundle.warnings).toEqual([]);
});
```

- [ ] **Step 2: Run to verify the first two fail**

Run: `npx vitest run tests/unit/import-backup.test.ts`
Expected: FAIL — both demotion tests get `"interval"`, expected `"prn"`. The boundary test should already PASS.

- [ ] **Step 3: Close the gate**

In `src/lib/server/import/backup.ts`, add the import:

```ts
import { parseIntervalHours, MAX_INTERVAL_HOURS } from "$lib/utils/schedule-rate";
```

Replace the `usable` computation inside the `med.schedules.map(...)` callback:

```ts
// BEFORE
const usable =
  (schedule.scheduleKind === "fixed_time" && schedule.timeOfDay !== null) ||
  (schedule.scheduleKind === "interval" && schedule.intervalHours !== null) ||
  schedule.scheduleKind === "prn";

// AFTER
// Parse FIRST, then bound the parsed number. `intervalHours` is a string off
// the wire and `"100" <= 72` is a string/number comparison — exactly the
// coercion class the primitive exists to eliminate.
const hours = parseIntervalHours(schedule.intervalHours);
const usable =
  (schedule.scheduleKind === "fixed_time" && schedule.timeOfDay !== null) ||
  (schedule.scheduleKind === "interval" && hours !== null && hours <= MAX_INTERVAL_HOURS) ||
  schedule.scheduleKind === "prn";
```

- [ ] **Step 4: Share the bound with the strict schema**

In `src/lib/utils/validation.ts`, add to the imports:

```ts
import { MAX_INTERVAL_HOURS } from "$lib/utils/schedule-rate";
```

Then replace the literal in `scheduleRowSchema`:

```ts
// BEFORE
intervalHours: z.coerce.number().positive().max(72),

// AFTER
intervalHours: z.coerce.number().positive().max(MAX_INTERVAL_HOURS),
```

Leave `importScheduleSchema`'s `numericString` alone. The demotion happens in
`backup.ts`, not in Zod — tightening the schema would reject the whole file,
and these are backups users reach for precisely when something has gone wrong.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: PASS, **804 tests across 65 files**.

Check `tests/unit/import-round-trip.test.ts` in particular — if a round-trip test flips, an interval the app itself writes is being demoted, which would mean the bound is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/validation.ts src/lib/server/import/backup.ts tests/unit/import-backup.test.ts
git commit -m "fix(import): demote an unusable interval row to PRN

The import door was the only one of three admitting a zero interval: the
web form and /api/v1 both parse through scheduleRowSchema's
positive().max(72), while importScheduleSchema's numericString regex
accepts \"0\" and has no upper bound at all.

Demotes rather than rejecting the file, reusing the gate that already
handles a fixed_time row with no time. A backup is what a user reaches
for when something has gone wrong; one bad row should not sink it.

The bound is applied to the PARSED number, never the raw string."
```

---

### Task 8: Break-verification sweep, full verification, CLAUDE.md

**Files:**

- Modify: `CLAUDE.md` (Gotchas section)

**Interfaces:**

- Consumes: everything above.
- Produces: the merge-readiness evidence.

- [ ] **Step 1: Verify the new behavioural tests can fail (Wave 3, on production code)**

Apply each break, run the named file, confirm the named test **fails**, then revert.

| Break                                                                           | File                  | Must fail                                                             |
| ------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `hours === null` → `hours === undefined` in `computeOverdueSlot`                | `reminders/domain.ts` | "a zero interval is not a schedule and yields no slot"                |
| drop `&& hours <= MAX_INTERVAL_HOURS` from the import gate                      | `import/backup.ts`    | "demotes an interval above the door cap"                              |
| `hours !== null` → `schedule.intervalHours !== null` in the import gate         | `import/backup.ts`    | "demotes a zero-interval schedule to PRN"                             |
| `perDay += intervalDosesPerDay(...)` → `perDay += 24 / Number(s.intervalHours)` | `analytics.ts`        | "ignores an interval row with a non-positive interval" (pre-existing) |
| `legacyRate` → `dailyRate` in `expectedDailyDoses`                              | `medications.ts`      | "falls back to 30-day history for PRN medications" (pre-existing)     |

The last two are the highest-value rows: they prove pre-existing tests still
guard the sites this plan touched.

- [ ] **Step 2: Confirm no pre-existing assertion was edited**

Run:

```bash
git diff origin/main..HEAD -- tests/ | grep '^-' | grep -v '^---'
```

Expected: **zero lines.**

This is a two-dot diff between `origin/main` and the final tree, so it shows
the net change. The characterization test added in Task 3 Step 1 and replaced
in Step 4 exists on neither endpoint, so it contributes no deletion here — the
expectation is zero, not one. Every test that exists on `origin/main` must be
present at HEAD, byte-identical.

Any output at all means a pre-existing test line was deleted or modified, i.e.
a refactor changed behaviour. Stop and report rather than adjusting the test.

- [ ] **Step 3: Full verification**

```bash
npx vitest run
npm run check
npm run lint
```

Expected: 804 tests across 65 files, no type errors, no lint errors.

- [ ] **Step 4: Record the invariant in CLAUDE.md**

Add to the **Gotchas** section:

```markdown
- **`src/lib/utils/schedule-rate.ts` owns the interval rate.** Every reader
  takes `parseIntervalHours` / `intervalDosesPerDay` from it rather than
  spelling its own guard — `intervalHours` is a Drizzle `numeric` and arrives
  as a **string**, so `if (!intervalHours)` does not reject `"0"`. Six sites
  each wrote that guard differently and `computeOverdueSlot` got it wrong,
  reporting a medication overdue the instant it was logged. It lives in
  `utils/` and not `server/` because `utils/time.ts` and `utils/schedule.ts`
  are client-reachable.
- **`MAX_INTERVAL_HOURS` is a door policy, not a read policy.** Apply it in
  the two Zod schemas and the import gate only. A stored 168 (weekly
  injection) predates the bound and must still produce a rate — rejecting it
  on read would drop that medication out of refill forecasting, out of the
  adherence denominator and out of reminders. Apply it to the _parsed number_,
  never the raw string.
- **`medicationStatsFor`'s `legacyRate` is not a duplicate of `dailyRateFor`.**
  `expectedDailyDoses` is the adherence denominator and must be `null` when a
  medication has no scheduled rate; `dailyRateFor` always returns a number,
  falling back to `thirtyDayDoseCount / 30`. Substituting it would draw an
  adherence bar measuring a PRN user against their own past behaviour.
```

- [ ] **Step 5: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: record the interval rate ownership invariants

The string-truthiness trap, the door-vs-read split on MAX_INTERVAL_HOURS,
and why medications.ts keeps a legacy rate that looks redundant."
git push -u origin fix/interval-rate-precedence
```

- [ ] **Step 6: Open the PR**

```bash
gh pr create --title "fix(schedule): give the interval rate one owner and close the zero-interval hole" --body "$(cat <<'BODY'
`24 / intervalHours` was restated at six sites with six differently-spelled
guards. Five were correct. The sixth sends notifications.

## The defect

`intervalHours` is a Drizzle `numeric` and arrives as a **string**.
`computeOverdueSlot` guarded with `!row.intervalHours`, and `"0"` is truthy,
so it computed an interval of 0ms and returned `lastEventAt` — the dose the
user had just logged — as an overdue slot. The medication was overdue the
instant it was taken.

Blast radius, stated precisely: the slot equals `lastEventAt`, which is fixed
until the next dose, so the dedupe key was stable. One spurious reminder per
logged dose, not the per-tick churn that got #110 reverted.

The import door was the only one of three that admitted the value. The web
form and `/api/v1` both parse through `scheduleRowSchema`'s
`positive().max(72)`; `importScheduleSchema` used a bare numeric-string regex
with no positivity check and no upper bound.

## The shape

`src/lib/utils/schedule-rate.ts` owns the primitive — what counts as a usable
interval and what rate it implies. `inventory.ts:dailyRateFor` keeps owning
the precedence. The primitive is in `utils/` because `utils/time.ts` and
`utils/schedule.ts` are client-reachable and may never import `$lib/server`.

`MAX_INTERVAL_HOURS` is a **door policy**: applied at the two schemas and the
import gate, never on read. A stored 168 is a weekly injection, and rejecting
it on read would drop that medication out of forecasting, adherence and
reminders.

## Behaviour changes — 3, all deliberate

1. `computeOverdueSlot` returns `null` for a zero interval. The fix.
2. An unusable interval row demotes to PRN on import, with the warning that
   already existed for a fixed-time row missing its time.
3. The import door gains the 72-hour cap the other two always had. New
   imports only — stored rows above the cap keep reading as valid rates.

No valid interval's rate changes at any site. No dedupe key shape changes.

## Review signal

The characterization harness landed **before** any behaviour moved, per the
#110 post-mortem — that PR shipped 753 green tests which proved nothing
because the tests pinning the old contract were deleted and then the
behaviour they protected was changed.

- **Not one pre-existing test line is deleted or modified.** `tests/` is
  additive-only against `origin/main`. Verified with
  `git diff origin/main..HEAD -- tests/ | grep '^-' | grep -v '^---'`, which
  returns nothing. This is the #114-grade signal, and it holds here because
  every migration was a pure refactor sitting under a net that landed first.
- Every new test was re-run against a deliberately broken copy to prove it
  can fail. That step earned itself again here: breaking the `MAX_INTERVAL_HOURS`
  guard is the only mechanical proof the weekly-injection case is under test.
- `analytics.test.ts:318` and `medication-stats.test.ts:93` are pre-existing
  and stay green untouched — free regression checks on the two sites most
  likely to break silently.

777 → 804 tests across 65 files.

## Deferred

- Deleting the three verified-dead functions (`calculateDaysUntilRefill`,
  `createMedication`, `updateMedication`).
- Retroactively sweeping stored rows for zero intervals. Not needed — any that
  exist stop generating reminders the moment this ships.
BODY
)"
```

---

## Self-Review

**Spec coverage.** Every spec section maps to a task:

| Spec section                         | Task                         |
| ------------------------------------ | ---------------------------- |
| Architecture (`schedule-rate.ts`)    | 1                            |
| Decision 3 (door vs read policy)     | 1 (Step 5 break), 2, 7       |
| Decision 4 (demote to PRN)           | 7                            |
| Decision 5 (`legacyRate` kept)       | 5 (Step 2), 2 (Step 3)       |
| Migration table, all 8 rows          | 3, 4, 5, 6, 7                |
| Testing waves 1/2/3                  | 2 / 3-7 / 1 Step 5, 8 Step 1 |
| "The review signal, stated honestly" | 8 Step 2                     |
| Behaviour changes (3)                | 3, 7                         |

**Placeholder scan.** No TBD/TODO. Every code step carries the literal code.
No step says "similar to Task N".

**Type consistency.** `parseIntervalHours` returns `number | null` at every
use site; `intervalDosesPerDay` returns `number` at every use site.
`MAX_INTERVAL_HOURS` is a `number` compared only against parsed numbers.
Task 3 uses `parseIntervalHours` (needs the hours); Tasks 4 and 5 use
`intervalDosesPerDay` (need the rate); Task 6 uses `parseIntervalHours`
(one needs hours for a division, one needs a null check); Task 7 uses both.

**Test count arithmetic.** 777 baseline → +12 (Task 1) = 789 → +9 (Task 2) =
798 → +3 (Task 3) = 801 → +3 (Task 7) = **804**. Tasks 4, 5 and 6
add none; they are pure refactors.
