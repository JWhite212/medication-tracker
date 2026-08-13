# Due-ness Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three disagreeing implementations of "is this dose due?" with one module that owns the rule and exposes two entry points over it.

**Architecture:** A new client-safe module `src/lib/utils/due.ts` owns occurrence projection, the match tolerance, the day walk-back, the legacy-column fallback and the resolution rule. Two entry points sit on that core: `outstandingSlots` for the UI (full dose rows) and `isOutstanding` for the reminder cron (a single aggregate anchor). The difference in available evidence is modelled as a discriminated union so it is visible in the type system rather than implicit in behaviour.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript, Drizzle ORM on Neon Postgres, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-13-due-ness-unification-design.md`

## Global Constraints

- `src/lib/utils/due.ts` is imported by client code (`MyDayTimeline.svelte`). It may use **`import type`** from `$lib/server/*` (erased at compile time — this is what `schedule.ts` already does) but **never a value import** from `$lib/server`, which would pull server code into the client bundle.
- Single tolerance constant: `SLOT_TOLERANCE_MS = 60 * 60 * 1000`. `MATCH_TOLERANCE_MS` and `FIXED_TIME_TOLERANCE_MS` are both deleted by the end of this plan. Never reintroduce a second one.
- `OVERDUE_LOOKBACK_DAYS = 1`.
- A dose resolves a slot when its status is `taken` or `skipped`. `missed` never resolves.
- Drizzle `numeric` columns arrive as **strings**. `intervalHours` and `scheduleIntervalHours` must go through `Number(...)` before arithmetic, and must be guarded with `Number.isFinite(n) && n > 0`.
- All timestamps are UTC (`timestamp with tz`); local-time reasoning goes through the timezone helpers in `schedule.ts`, never through `Date` local methods.
- Run a single test file with `npx vitest run tests/unit/<file>`; the whole suite with `npx vitest run`.
- Commit messages follow conventional commits. Do **not** add Claude/AI attribution, `Co-Authored-By`, or session URLs.
- Baseline before starting: 62 test files, 732 tests, all green.

---

## File Structure

**Created**

- `src/lib/utils/due.ts` — the deepened module. Owns `EffectiveSchedule`, `DoseEvent`, `Evidence`, occurrence projection, resolution, `outstandingSlots`, `isOutstanding`, `timingStatusFromSlots`.
- `tests/unit/due.test.ts` — unit tests for the module's own rules.
- `tests/unit/due-parity.test.ts` — the bounded parity test between the two projections.

**Modified**

- `src/lib/utils/schedule.ts` — keeps date primitives (`getLocalDateString`, `localTimeOnDateToUtc`, `getLocalDayOfWeek`, `getLocalDatesInRange`) and presentation (`classifyHour`, `groupSlotsByTimeOfDay`, `ScheduleSlot` types). Loses `computeScheduleSlots`, `timingStatusFromSlots`, `MATCH_TOLERANCE_MS`.
- `src/lib/utils/time.ts` — loses `computeTimingStatus`. Keeps `classifyDueStatus` and the formatters.
- `src/lib/server/reminders/domain.ts` — keeps only the dedupe-key builders. Loses `computeOverdueSlot`, `isScheduleOverdue`, `FIXED_TIME_TOLERANCE_MS`, `OVERDUE_LOOKBACK_DAYS`, `OverdueRow`.
- `src/lib/server/reminders.ts` — query shape and dispatch call.
- `src/routes/(app)/dashboard/+page.server.ts` — deletes ~50 lines of merge logic.
- `tests/unit/schedule.test.ts`, `tests/unit/time.test.ts`, `tests/unit/reminders-dedupe.test.ts`, `tests/unit/reminders.test.ts`, `tests/unit/dashboard-timing-status.test.ts`.
- `docs/adr/0005-reminder-deduplication.md`.

**Ordering rationale:** Tasks 1–3 build the new module bottom-up with no callers, so nothing can break. Task 4 moves the existing UI implementation across _without changing behaviour_, using its ~30 existing tests as the safety harness. Task 5 then refactors internals with those tests still guarding. Tasks 7–8 migrate the two callers. Task 9 deletes the old code only once nothing references it.

---

### Task 1: The module skeleton and `effectiveSchedules`

Creates the module and the legacy-column fallback that lets every later task assume "a medication always has schedules".

**Files:**

- Create: `src/lib/utils/due.ts`
- Create: `tests/unit/due.test.ts`

**Interfaces:**

- Consumes: `Medication` from `$lib/types`, `MedicationSchedule` from `$lib/server/schedules` (type-only).
- Produces: `SLOT_TOLERANCE_MS`, `OVERDUE_LOOKBACK_DAYS`, `ScheduleKind`, `EffectiveSchedule`, `ScheduleRowInput`, `effectiveSchedules(med, rows)`, `legacyScheduleId(medicationId)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/due.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { effectiveSchedules, legacyScheduleId } from "$lib/utils/due";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

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
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Medication;
}

function makeScheduleRow(overrides: Partial<MedicationSchedule> = {}): MedicationSchedule {
  return {
    id: "sched-1",
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours: "8",
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as MedicationSchedule;
}

describe("effectiveSchedules", () => {
  it("passes real schedule rows through unchanged", () => {
    const rows = [makeScheduleRow({ id: "sched-a" })];
    const out = effectiveSchedules(makeMed(), rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sched-a");
    expect(out[0].scheduleKind).toBe("interval");
    expect(out[0].intervalHours).toBe("8");
  });

  it("ignores the legacy columns entirely when real rows exist", () => {
    const rows = [
      makeScheduleRow({
        id: "sched-a",
        scheduleKind: "fixed_time",
        timeOfDay: "09:00",
        intervalHours: null,
      }),
    ];
    const out = effectiveSchedules(makeMed({ scheduleIntervalHours: "4" }), rows);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("fixed_time");
  });

  it("synthesises an interval schedule from the legacy columns when there are no rows", () => {
    const out = effectiveSchedules(makeMed({ scheduleIntervalHours: "6" }), []);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("interval");
    expect(out[0].intervalHours).toBe("6");
    expect(out[0].id).toBe(legacyScheduleId("med-1"));
  });

  it("synthesises a prn schedule for a legacy as_needed medication", () => {
    const out = effectiveSchedules(
      makeMed({ scheduleType: "as_needed", scheduleIntervalHours: null }),
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("prn");
  });

  it("synthesises nothing when the legacy interval is zero", () => {
    // validation.ts admits "0" via /^\d+(\.\d+)?$/ — an unguarded
    // 24/0 would yield Infinity, so this must produce no schedule.
    expect(effectiveSchedules(makeMed({ scheduleIntervalHours: "0" }), [])).toEqual([]);
  });

  it("synthesises nothing when the legacy interval is absent", () => {
    expect(effectiveSchedules(makeMed({ scheduleIntervalHours: null }), [])).toEqual([]);
  });

  it("gives every synthesised schedule a stable id derived from the medication", () => {
    const a = effectiveSchedules(makeMed(), [])[0];
    const b = effectiveSchedules(makeMed(), [])[0];
    expect(a.id).toBe(b.id);
    expect(a.id).toBe("legacy:med-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: FAIL — cannot resolve `$lib/utils/due`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/utils/due.ts`:

```ts
import type { Medication } from "$lib/types";
// Type-only import: erased at compile time, so this does NOT pull
// server code into the client bundle. Never make this a value import.
import type { MedicationSchedule } from "$lib/server/schedules";

/** The one match tolerance. A dose this close to an occurrence resolves it. */
export const SLOT_TOLERANCE_MS = 60 * 60 * 1000;

/** How many local days back the fixed-time scan looks for an elapsed occurrence. */
export const OVERDUE_LOOKBACK_DAYS = 1;

export type ScheduleKind = "fixed_time" | "interval" | "prn";

export type EffectiveSchedule = {
  id: string;
  scheduleKind: ScheduleKind;
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/**
 * The schedule-row fields this module reads. Structural rather than
 * `MedicationSchedule` so a caller assembling a row from a join projection
 * can pass it directly — no cast, no invented `userId`/`createdAt`.
 * Every real `MedicationSchedule` satisfies it.
 */
export type ScheduleRowInput = {
  id: string;
  scheduleKind: string;
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/** Stable synthetic id for a schedule derived from the deprecated columns. */
export function legacyScheduleId(medicationId: string): string {
  return `legacy:${medicationId}`;
}

/**
 * A medication's schedules, or one synthesised from the deprecated
 * `scheduleType` / `scheduleIntervalHours` columns when it has none.
 *
 * Medications with zero schedule rows are still creatable: the import
 * schema defaults `schedules` to `[]` while accepting the legacy
 * columns, and `import/apply.ts` synthesises nothing. Absorbing that
 * here keeps the deprecated columns out of every caller.
 */
export function effectiveSchedules(
  med: Pick<Medication, "id" | "scheduleType" | "scheduleIntervalHours">,
  rows: ScheduleRowInput[],
): EffectiveSchedule[] {
  if (rows.length > 0) {
    return rows.map((r) => ({
      id: r.id,
      scheduleKind: r.scheduleKind as ScheduleKind,
      timeOfDay: r.timeOfDay,
      intervalHours: r.intervalHours,
      daysOfWeek: r.daysOfWeek,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    }));
  }

  const base = {
    id: legacyScheduleId(med.id),
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    effectiveFrom: null,
    effectiveTo: null,
  };

  if (med.scheduleType === "as_needed") {
    return [{ ...base, scheduleKind: "prn" }];
  }

  if (med.scheduleType === "scheduled" && med.scheduleIntervalHours !== null) {
    const hrs = Number(med.scheduleIntervalHours);
    if (Number.isFinite(hrs) && hrs > 0) {
      return [{ ...base, scheduleKind: "interval", intervalHours: med.scheduleIntervalHours }];
    }
  }

  return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/due.ts tests/unit/due.test.ts
git commit -m "feat(due): add effectiveSchedules with the legacy-column fallback"
```

---

### Task 2: Occurrence projection

Projects the times a schedule expects a dose, per kind, clipped to the medication lifecycle.

**Files:**

- Modify: `src/lib/utils/due.ts`
- Modify: `src/lib/utils/schedule.ts` (export `getLocalDatesInRange`)
- Modify: `tests/unit/due.test.ts`

**Interfaces:**

- Consumes: `EffectiveSchedule` (Task 1); `getLocalDateString`, `localTimeOnDateToUtc`, `getLocalDayOfWeek`, `getLocalDatesInRange` from `$lib/utils/schedule`.
- Produces: `Lifecycle = { startedAt: Date; endedAt: Date | null }` and `occurrencesFor(schedule, windowStartUtc, windowEndUtc, timezone, anchor, lifecycle): Date[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/due.test.ts`:

```ts
import { occurrencesFor } from "$lib/utils/due";
import type { EffectiveSchedule, Lifecycle } from "$lib/utils/due";

const LIFE: Lifecycle = { startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null };
const DAY_START = new Date("2026-05-01T00:00:00Z");
const DAY_END = new Date("2026-05-02T00:00:00Z");

function sched(overrides: Partial<EffectiveSchedule> = {}): EffectiveSchedule {
  return {
    id: "s1",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours: "8",
    daysOfWeek: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

describe("occurrencesFor", () => {
  it("projects interval occurrences across the window from the anchor", () => {
    const anchor = new Date("2026-05-01T00:00:00Z");
    const out = occurrencesFor(sched(), DAY_START, DAY_END, "UTC", anchor, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T08:00:00.000Z",
      "2026-05-01T16:00:00.000Z",
    ]);
  });

  it("starts one interval AFTER startedAt when there is no event", () => {
    // startedAt is when the medication began, not a dose occurrence: the
    // first expected dose is startedAt + intervalHours. Projecting from
    // startedAt itself would make a brand-new medication instantly overdue,
    // which is the badge behaviour this change exists to replace.
    const life: Lifecycle = { startedAt: new Date("2026-05-01T02:00:00Z"), endedAt: null };
    const out = occurrencesFor(sched(), DAY_START, DAY_END, "UTC", null, life);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T18:00:00.000Z",
    ]);
  });

  it("produces one fixed-time occurrence per local day at the given time", () => {
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    const out = occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual(["2026-05-01T09:00:00.000Z"]);
  });

  it("filters fixed-time occurrences by daysOfWeek on the occurrence's own date", () => {
    // 2026-05-01 is a Friday (day 5).
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      daysOfWeek: [1],
    });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("produces no occurrences for prn", () => {
    const s = sched({ scheduleKind: "prn", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("produces no occurrences before startedAt", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T12:00:00Z"), endedAt: null };
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, life)).toEqual([]);
  });

  it("produces no occurrences after endedAt", () => {
    const life: Lifecycle = {
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: new Date("2026-04-30T00:00:00Z"),
    };
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, life)).toEqual([]);
  });

  it("guards a zero or non-numeric interval", () => {
    expect(
      occurrencesFor(sched({ intervalHours: "0" }), DAY_START, DAY_END, "UTC", DAY_START, LIFE),
    ).toEqual([]);
    expect(
      occurrencesFor(sched({ intervalHours: null }), DAY_START, DAY_END, "UTC", DAY_START, LIFE),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: FAIL — `occurrencesFor` is not exported.

- [ ] **Step 3: Export the date helper**

In `src/lib/utils/schedule.ts`, change line 59 from `function getLocalDatesInRange(` to:

```ts
export function getLocalDatesInRange(start: Date, end: Date, timezone: string): string[] {
```

- [ ] **Step 4: Write minimal implementation**

Append to `src/lib/utils/due.ts`:

```ts
import { getLocalDatesInRange, getLocalDayOfWeek, localTimeOnDateToUtc } from "$lib/utils/schedule";

export type Lifecycle = { startedAt: Date; endedAt: Date | null };

function withinLifecycle(t: Date, lifecycle: Lifecycle): boolean {
  if (t.getTime() < lifecycle.startedAt.getTime()) return false;
  if (lifecycle.endedAt && t.getTime() > lifecycle.endedAt.getTime()) return false;
  return true;
}

/**
 * The times this schedule expects a dose inside [windowStart, windowEnd).
 *
 * `anchor` is the last resolving event (taken or skipped). Interval
 * schedules phase from it; when absent they phase from `startedAt`, so a
 * never-logged medication still has occurrences. Fixed-time schedules
 * ignore the anchor entirely — they are clock-based.
 */
export function occurrencesFor(
  schedule: EffectiveSchedule,
  windowStartUtc: Date,
  windowEndUtc: Date,
  timezone: string,
  anchor: Date | null,
  lifecycle: Lifecycle,
): Date[] {
  const out: Date[] = [];

  if (schedule.scheduleKind === "interval") {
    const hrs = schedule.intervalHours !== null ? Number(schedule.intervalHours) : NaN;
    if (!Number.isFinite(hrs) || hrs <= 0) return [];
    const intervalMs = hrs * 60 * 60 * 1000;

    // With an event, phase from it. Without one, the first expected dose is
    // one interval AFTER startedAt — startedAt is when the medication began,
    // not a dose occurrence.
    let t = anchor
      ? new Date(anchor.getTime())
      : new Date(lifecycle.startedAt.getTime() + intervalMs);
    if (t.getTime() < windowStartUtc.getTime()) {
      const gap = windowStartUtc.getTime() - t.getTime();
      t = new Date(t.getTime() + Math.ceil(gap / intervalMs) * intervalMs);
    }
    while (t.getTime() < windowEndUtc.getTime()) {
      out.push(new Date(t.getTime()));
      t = new Date(t.getTime() + intervalMs);
    }

    // Keep the anchor itself visible when it falls inside the window, so a
    // just-handled dose still renders as its own slot.
    const anchorTime = anchor?.getTime();
    if (
      anchorTime !== undefined &&
      anchorTime >= windowStartUtc.getTime() &&
      anchorTime < windowEndUtc.getTime() &&
      !out.some((d) => d.getTime() === anchorTime)
    ) {
      out.push(new Date(anchorTime));
    }
  } else if (schedule.scheduleKind === "fixed_time") {
    if (!schedule.timeOfDay) return [];
    for (const dateStr of getLocalDatesInRange(windowStartUtc, windowEndUtc, timezone)) {
      const utc = localTimeOnDateToUtc(dateStr, schedule.timeOfDay, timezone);
      if (utc.getTime() < windowStartUtc.getTime() || utc.getTime() >= windowEndUtc.getTime()) {
        continue;
      }
      // Day-of-week is a property of the occurrence's own date, not today's.
      if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
        if (!schedule.daysOfWeek.includes(getLocalDayOfWeek(utc, timezone))) continue;
      }
      out.push(utc);
    }
  }
  // prn projects nothing.

  return out.filter((t) => withinLifecycle(t, lifecycle)).sort((a, b) => a.getTime() - b.getTime());
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: PASS — 15 tests.

- [ ] **Step 6: Run the full suite**

Run: `npx vitest run`
Expected: 62 files, 732 tests, all pass. Exporting `getLocalDatesInRange` changes no behaviour.

- [ ] **Step 7: Commit**

```bash
git add src/lib/utils/due.ts src/lib/utils/schedule.ts tests/unit/due.test.ts
git commit -m "feat(due): project schedule occurrences with a lifecycle clip"
```

---

### Task 3: Resolution and the cron entry point

Adds the resolution rule and `isOutstanding`, the cheap projection the reminder cron uses.

**Files:**

- Modify: `src/lib/utils/due.ts`
- Modify: `tests/unit/due.test.ts`

**Interfaces:**

- Consumes: `occurrencesFor`, `Lifecycle`, `SLOT_TOLERANCE_MS`, `OVERDUE_LOOKBACK_DAYS` (Tasks 1–2).
- Produces: `DoseEvent`, `Evidence`, `resolvesSlot(status)`, `isOutstanding(schedule, evidence, timezone, now, lifecycle): Date | null`.

> The spec sketched `isOutstanding(schedule, evidence, tz, now)`. It needs a fifth
> argument: the `startedAt` rule cannot be applied without the medication's
> lifecycle. This is a refinement of the sketch, not a change of behaviour.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/due.test.ts`:

```ts
import { isOutstanding, resolvesSlot } from "$lib/utils/due";

const NOW = new Date("2026-05-01T15:00:00Z");

describe("resolvesSlot", () => {
  it("counts taken and skipped, never missed", () => {
    expect(resolvesSlot("taken")).toBe(true);
    expect(resolvesSlot("skipped")).toBe(true);
    expect(resolvesSlot("missed")).toBe(false);
  });
});

describe("isOutstanding — interval", () => {
  it("is not outstanding inside the interval window", () => {
    const anchor = new Date("2026-05-01T12:00:00Z"); // 3h ago, 8h interval
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: anchor }, "UTC", NOW, LIFE);
    expect(got).toBeNull();
  });

  it("is outstanding once the interval has elapsed", () => {
    const anchor = new Date("2026-05-01T04:00:00Z"); // 11h ago, 8h interval
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: anchor }, "UTC", NOW, LIFE);
    expect(got?.toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });

  it("a SKIPPED dose resolves the slot just as a taken one does", () => {
    // The anchor is lastEventAt, which the caller builds from taken OR
    // skipped rows. This is the divergence the whole change exists to fix.
    const anchor = new Date("2026-05-01T12:00:00Z");
    expect(
      isOutstanding(sched(), { kind: "anchor", lastEventAt: anchor }, "UTC", NOW, LIFE),
    ).toBeNull();
  });

  it("a never-handled interval medication is outstanding once startedAt + interval has passed", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T00:00:00Z"), endedAt: null };
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: null }, "UTC", NOW, life);
    expect(got?.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("a never-handled interval medication is NOT outstanding before startedAt + interval", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T14:00:00Z"), endedAt: null };
    expect(
      isOutstanding(sched(), { kind: "anchor", lastEventAt: null }, "UTC", NOW, life),
    ).toBeNull();
  });
});

describe("isOutstanding — fixed time", () => {
  const fixed = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });

  it("is outstanding when today's elapsed slot has no event", () => {
    const got = isOutstanding(fixed, { kind: "anchor", lastEventAt: null }, "UTC", NOW, LIFE);
    expect(got?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("is not outstanding when an event lands inside the tolerance", () => {
    const at = new Date("2026-05-01T08:30:00Z"); // 30 min before the slot
    expect(isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE)).toBeNull();
  });

  it("is outstanding when the event is older than the tolerance", () => {
    const at = new Date("2026-05-01T07:00:00Z"); // 2h before the slot
    expect(
      isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE),
    ).not.toBeNull();
  });

  it("treats a late dose as resolving the slot however late", () => {
    const at = new Date("2026-05-01T14:00:00Z"); // 5h after the slot
    expect(isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE)).toBeNull();
  });

  it("falls back to yesterday's slot when today's has not arrived", () => {
    const earlyNow = new Date("2026-05-01T06:00:00Z");
    const got = isOutstanding(fixed, { kind: "anchor", lastEventAt: null }, "UTC", earlyNow, LIFE);
    expect(got?.toISOString()).toBe("2026-04-30T09:00:00.000Z");
  });

  it("does not reach back beyond the look-back window", () => {
    const life: Lifecycle = { startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null };
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      daysOfWeek: [0],
    });
    // 2026-05-01 is Friday, 2026-04-30 Thursday — neither is Sunday, so
    // nothing inside the look-back qualifies.
    expect(isOutstanding(s, { kind: "anchor", lastEventAt: null }, "UTC", NOW, life)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: FAIL — `isOutstanding` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/utils/due.ts`:

```ts
/**
 * The dose fields this module reads. Declared structurally rather than as
 * `DoseLogWithMedication` so the module stays independent of the Drizzle
 * row type — every real dose row satisfies it, so callers pass their rows
 * straight through with no mapping and no cast.
 */
export type DoseEvent = {
  id: string;
  medicationId: string;
  takenAt: Date;
  status: string;
  quantity: number;
};

/**
 * What a caller can tell the module about doses.
 *
 * `events` is full fidelity — every dose row for the window, which is what
 * makes per-occurrence matching possible. `anchor` is a single aggregated
 * "last resolving event", which is all the reminder cron can afford while
 * scanning every user. `anchor` is therefore a conservative approximation
 * of `events`, never a contradiction of it.
 */
export type Evidence =
  | { kind: "events"; doses: DoseEvent[] }
  | { kind: "anchor"; lastEventAt: Date | null };

/** A dose resolves an occurrence when it was taken or deliberately skipped. */
export function resolvesSlot(status: string): boolean {
  return status === "taken" || status === "skipped";
}

function anchorOf(evidence: Evidence): Date | null {
  if (evidence.kind === "anchor") return evidence.lastEventAt;
  let latest: Date | null = null;
  for (const d of evidence.doses) {
    if (!resolvesSlot(d.status)) continue;
    if (!latest || d.takenAt.getTime() > latest.getTime()) latest = d.takenAt;
  }
  return latest;
}

function shiftLocalDate(dateStr: string, days: number): string {
  // Pure UTC calendar arithmetic: Date.UTC rolls months and years over
  // correctly and has no DST, so "the previous local date" stays exact
  // across a transition where subtracting 24h would land on the wrong day.
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * The most recent elapsed occurrence that no dose has resolved, or null.
 *
 * Walks back `OVERDUE_LOOKBACK_DAYS` local days so an occurrence timed
 * between two cron ticks is not lost when the local date rolls over.
 */
export function isOutstanding(
  schedule: EffectiveSchedule,
  evidence: Evidence,
  timezone: string,
  now: Date,
  lifecycle: Lifecycle,
): Date | null {
  if (schedule.scheduleKind === "prn") return null;

  const tz = timezone || "UTC";
  const anchor = anchorOf(evidence);
  const todayStr = getLocalDateString(now, tz);

  const windowStart = localTimeOnDateToUtc(
    shiftLocalDate(todayStr, OVERDUE_LOOKBACK_DAYS),
    "00:00",
    tz,
  );
  const windowEnd = new Date(now.getTime() + 1);

  const occurrences = occurrencesFor(schedule, windowStart, windowEnd, tz, anchor, lifecycle);

  for (let i = occurrences.length - 1; i >= 0; i--) {
    const slot = occurrences[i];
    if (slot.getTime() > now.getTime()) continue;
    // A dose at or after the occurrence resolves it however late it was;
    // the tolerance only extends backwards, covering a dose taken shortly
    // before the scheduled time.
    if (anchor !== null && anchor.getTime() >= slot.getTime() - SLOT_TOLERANCE_MS) return null;
    return slot;
  }

  return null;
}
```

Add `getLocalDateString` to the existing import from `$lib/utils/schedule` at the top of `due.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: PASS — 27 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/due.ts tests/unit/due.test.ts
git commit -m "feat(due): add the resolution rule and the cron isOutstanding projection"
```

---

### Task 4: Move `computeScheduleSlots` across, behaviour unchanged

A pure move. Its ~30 existing tests become the harness proving nothing changed.

**Files:**

- Modify: `src/lib/utils/due.ts`, `src/lib/utils/schedule.ts`
- Modify: `tests/unit/schedule.test.ts`

**Interfaces:**

- Produces: `outstandingSlots(med, schedules, evidence, window, timezone, now): ScheduleSlot[]`, `timingStatusFromSlots(slots, now)`.

- [ ] **Step 1: Move the code**

Cut `computeScheduleSlots`, its private helpers `expectedTimesForInterval` and `expectedTimesForFixedTime`, `MATCH_TOLERANCE_MS`, and `timingStatusFromSlots` out of `schedule.ts` and paste into `due.ts`. In `due.ts`:

- Rename `computeScheduleSlots` to `outstandingSlots`.
- Replace every `MATCH_TOLERANCE_MS` with `SLOT_TOLERANCE_MS`.
- Change the signature's `lastDoseByMedication: Record<string, Date>` and `todaysDoses` parameters to a single `evidence: Evidence`, and derive both inside:

```ts
export function outstandingSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  evidence: Evidence,
  window: { startUtc: Date; endUtc: Date },
  timezone: string,
  now: Date,
): ScheduleSlot[] {
  const doses = evidence.kind === "events" ? evidence.doses : [];
  const anchorByMed = new Map<string, Date>();
  // ... existing body, reading `doses` where it read `todaysDoses`, and
  // `anchorByMed` where it read `lastDoseByMedication`
}
```

`ScheduleSlot`, `ScheduleSlotStatus` and the `DoseLogWithMedication` import move with it. Re-export the slot types from `due.ts`. Keep `groupSlotsByTimeOfDay`, `classifyHour`, `TimeOfDay`, `TimeOfDayGroup` and all date primitives in `schedule.ts`.

> `outstandingSlots` needs a per-medication anchor. For this task build `anchorByMed` from the caller-supplied dose rows exactly as `lastDoseByMedication` was built — from `taken` rows only — so behaviour is identical. Task 5 changes it.

- [ ] **Step 2: Update the test imports**

In `tests/unit/schedule.test.ts`, change the import block to:

```ts
import { classifyHour, groupSlotsByTimeOfDay } from "$lib/utils/schedule";
import { outstandingSlots, timingStatusFromSlots } from "$lib/utils/due";
import type { ScheduleSlot, ScheduleSlotStatus } from "$lib/utils/due";
```

Then update every `computeScheduleSlots(meds, schedules, doses, lastDose, dayStart, dayEnd, tz, now)` call to:

```ts
outstandingSlots(
  meds,
  schedules,
  { kind: "events", doses },
  { startUtc: dayStart, endUtc: dayEnd },
  tz,
  now,
);
```

Change nothing else — every assertion stays exactly as written.

- [ ] **Step 3: Run the moved tests**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: PASS, same count as before the move. Any failure means the move was not faithful — fix the move, do not adjust an assertion.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: 732 tests pass. `dashboard/+page.server.ts` still imports `computeScheduleSlots`, so add a temporary re-export in `schedule.ts` if the build breaks:

```ts
export { outstandingSlots as computeScheduleSlots } from "./due";
```

Task 7 removes it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/due.ts src/lib/utils/schedule.ts tests/unit/schedule.test.ts
git commit -m "refactor(due): move slot computation into the due module"
```

---

### Task 5: Refactor `outstandingSlots` onto the shared projection

Removes the duplicate occurrence logic and switches the interval anchor to `lastEventAt`.

**Files:**

- Modify: `src/lib/utils/due.ts`
- Modify: `tests/unit/schedule.test.ts`

**Interfaces:**

- Consumes: `occurrencesFor` (Task 2), `resolvesSlot` (Task 3).

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/schedule.test.ts`:

```ts
it("a skipped dose re-anchors the interval projection, like the badge already did", () => {
  const med = makeMed({ scheduleIntervalHours: "8" });
  const schedules = new Map([[med.id, [makeIntervalSchedule(med.id, "8")]]]);
  const dayStart = new Date("2026-05-01T00:00:00Z");
  const dayEnd = new Date("2026-05-02T00:00:00Z");
  const skipped = {
    id: "dose-skip",
    medicationId: med.id,
    takenAt: new Date("2026-05-01T02:00:00Z"),
    status: "skipped",
    quantity: 1,
  } as unknown as DoseLogWithMedication;

  const slots = outstandingSlots(
    [med],
    schedules,
    { kind: "events", doses: [skipped] },
    { startUtc: dayStart, endUtc: dayEnd },
    "UTC",
    new Date("2026-05-01T03:00:00Z"),
  );

  // Anchored on the skip at 02:00, not on a taken dose, so the next
  // expected times are 10:00 and 18:00.
  const times = slots.map((s) => s.expectedTime);
  expect(times).toContain("2026-05-01T10:00:00.000Z");
  expect(times).toContain("2026-05-01T18:00:00.000Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: FAIL — the projection still anchors on `taken` rows only, so the times are 08:00/16:00.

- [ ] **Step 3: Refactor the implementation**

In `outstandingSlots`, replace the inline `expectedTimesForInterval` / `expectedTimesForFixedTime` calls with `occurrencesFor`, and build the anchor from resolving events:

```ts
for (const med of medications) {
  const schedules = effectiveSchedules(med, schedulesByMedId.get(med.id) ?? []);
  if (schedules.length === 0) continue;

  const medDoses = dosesByMedId.get(med.id) ?? [];
  // Anchor on the last RESOLVING event (taken or skipped) — a skip
  // advances the interval clock exactly as the badge already did.
  let anchor: Date | null = null;
  for (const d of medDoses) {
    if (!resolvesSlot(d.status)) continue;
    const t = new Date(d.takenAt);
    if (!anchor || t.getTime() > anchor.getTime()) anchor = t;
  }

  const lifecycle: Lifecycle = { startedAt: med.startedAt, endedAt: med.endedAt };
  const expectedTimes: { time: Date; kind: ScheduleKind }[] = [];
  for (const schedule of schedules) {
    for (const t of occurrencesFor(
      schedule,
      window.startUtc,
      window.endUtc,
      timezone,
      anchor,
      lifecycle,
    )) {
      expectedTimes.push({ time: t, kind: schedule.scheduleKind });
    }
  }
  // ... existing dedupe, drifted-twin suppression, capacity matching and
  // status assignment continue unchanged from here
}
```

Delete `expectedTimesForInterval` and `expectedTimesForFixedTime`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/schedule.test.ts`
Expected: PASS, including the new case. If a pre-existing case now fails because it anchored on a `taken` dose that is still the latest resolving event, that is a genuine regression — fix the implementation, not the test.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils/due.ts tests/unit/schedule.test.ts
git commit -m "refactor(due): share one occurrence projection and anchor on skips"
```

---

### Task 6: The bounded parity test

The test that would have caught the original divergence.

**Files:**

- Create: `tests/unit/due-parity.test.ts`

**Interfaces:**

- Consumes: `outstandingSlots`, `isOutstanding`, `effectiveSchedules`.

> **Bound:** parity holds for a single schedule whose window contains **at most one** dose event. With several events the `events` projection is strictly more precise and `anchor` is a deliberate approximation. Do not widen this test — an unbounded version cannot pass, by design.

- [ ] **Step 1: Write the test**

Create `tests/unit/due-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { outstandingSlots, isOutstanding, effectiveSchedules } from "$lib/utils/due";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import type { DoseLogWithMedication } from "$lib/types";

const TZ = "UTC";
const NOW = new Date("2026-05-01T15:00:00Z");
const DAY = {
  startUtc: new Date("2026-05-01T00:00:00Z"),
  endUtc: new Date("2026-05-02T00:00:00Z"),
};

function med(): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "Parity",
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  } as Medication;
}

function fixedRow(): MedicationSchedule {
  return {
    id: "s1",
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay: "09:00",
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  } as MedicationSchedule;
}

function dose(status: string, at: string): DoseLogWithMedication {
  return {
    id: "d1",
    medicationId: "med-1",
    takenAt: new Date(at),
    status,
    quantity: 1,
  } as unknown as DoseLogWithMedication;
}

/** The UI projection's verdict for the 09:00 slot, as a boolean. */
function uiSaysOutstanding(doses: DoseLogWithMedication[]): boolean {
  const slots = outstandingSlots(
    [med()],
    new Map([["med-1", [fixedRow()]]]),
    { kind: "events", doses },
    DAY,
    TZ,
    NOW,
  );
  const slot = slots.find((s) => s.expectedTime === "2026-05-01T09:00:00.000Z");
  return slot?.status === "overdue";
}

/** The cron projection's verdict for the same slot. */
function cronSaysOutstanding(doses: DoseLogWithMedication[]): boolean {
  const resolving = doses.filter((d) => d.status === "taken" || d.status === "skipped");
  const lastEventAt = resolving.length > 0 ? new Date(resolving[0].takenAt) : null;
  const schedule = effectiveSchedules(med(), [fixedRow()])[0];
  return (
    isOutstanding(schedule, { kind: "anchor", lastEventAt }, TZ, NOW, {
      startedAt: med().startedAt,
      endedAt: null,
    }) !== null
  );
}

describe("projection parity — one schedule, at most one dose event", () => {
  const cases: Array<[string, DoseLogWithMedication[]]> = [
    ["no doses at all", []],
    ["taken inside tolerance", [dose("taken", "2026-05-01T08:30:00Z")]],
    ["taken outside tolerance", [dose("taken", "2026-05-01T06:00:00Z")]],
    ["taken late", [dose("taken", "2026-05-01T14:00:00Z")]],
    ["skipped inside tolerance", [dose("skipped", "2026-05-01T08:30:00Z")]],
    ["skipped late", [dose("skipped", "2026-05-01T14:00:00Z")]],
    ["missed inside tolerance", [dose("missed", "2026-05-01T08:30:00Z")]],
  ];

  for (const [name, doses] of cases) {
    it(`agrees: ${name}`, () => {
      expect(cronSaysOutstanding(doses)).toBe(uiSaysOutstanding(doses));
    });
  }
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run tests/unit/due-parity.test.ts`
Expected: PASS — 7 cases. A failure here is a real disagreement between the projections; fix the module, never the expectation.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/due-parity.test.ts
git commit -m "test(due): assert the two projections agree on a single event"
```

---

### Task 7: Migrate the dashboard load

**Files:**

- Modify: `src/routes/(app)/dashboard/+page.server.ts:16-89`
- Modify: `tests/unit/dashboard-timing-status.test.ts`

**Interfaces:**

- Consumes: `outstandingSlots`, `timingStatusFromSlots` from `$lib/utils/due`.

- [ ] **Step 1: Replace the imports**

```ts
import { groupSlotsByTimeOfDay } from "$lib/utils/schedule";
import { outstandingSlots, timingStatusFromSlots } from "$lib/utils/due";
import { parseDateTimeLocal, startOfDay } from "$lib/utils/time";
```

Remove `computeTimingStatus` from the `$lib/utils/time` import and `computeScheduleSlots` from the `$lib/utils/schedule` import.

- [ ] **Step 2: Replace lines 31-89 of the load function**

```ts
const now = new Date();
const dayStart = startOfDay(now, user.timezone);
const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

const scheduleSlots = outstandingSlots(
  medications,
  schedulesByMedId,
  { kind: "events", doses },
  { startUtc: dayStart, endUtc: dayEnd },
  user.timezone,
  now,
);

// Every medication's badge now comes from the same slots the timeline
// renders — no second implementation, and no covered-set merge.
const timingStatus: MedicationTimingStatus[] = [];
for (const med of medications) {
  const t = timingStatusFromSlots(
    scheduleSlots.filter((s) => s.medicationId === med.id),
    now,
  );
  if (t) timingStatus.push({ medicationId: med.id, ...t });
}
```

Delete the old `lastEventMap`, the `timingStatus` filter/map block, the `lastDoseByMedication` loop, and the `covered` set entirely. `getLastDosePerMedication` is still needed by other parts of the payload — leave the query in place, and check whether `lastDoses` is still referenced after the deletion; if not, remove it from the `Promise.all`.

- [ ] **Step 3: Update the test**

In `tests/unit/dashboard-timing-status.test.ts`, keep both existing cases exactly as written — the behaviour they assert (a fixed-time medication gets a slot-derived badge; PRN gets none) is preserved. Update any mock of `$lib/utils/schedule` to mock `$lib/utils/due` instead.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/dashboard-timing-status.test.ts tests/unit/dashboard-dose-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Remove the temporary re-export**

If Task 4 added `export { outstandingSlots as computeScheduleSlots }` to `schedule.ts`, delete it now and re-run the full suite.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npx vitest run && npm run check`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/routes/'(app)'/dashboard/+page.server.ts tests/unit/dashboard-timing-status.test.ts src/lib/utils/schedule.ts
git commit -m "refactor(dashboard): derive every timing badge from one slot projection"
```

---

### Task 8: Migrate the reminder cron

**Files:**

- Modify: `src/lib/server/reminders.ts:59-203`
- Modify: `tests/unit/reminders.test.ts`

**Interfaces:**

- Consumes: `effectiveSchedules`, `isOutstanding` from `$lib/utils/due`; `buildOverdueDedupeKey` from `./reminders/domain`.

> **Heads-up:** `reminders.test.ts` mocks the database by call order (`selectCallIndex === 0 ? scheduleRows : lastTakenRows`, lines 28-30). This task changes the query shape, so that mock must be reworked. Read it before starting.

- [ ] **Step 1: Change the aggregate to include skips**

In `checkOverdueMedications`, change the last-dose query's filter:

```ts
      .where(
        and(
          inArray(doseLogs.medicationId, medicationIds),
          inArray(doseLogs.status, ["taken", "skipped"]),
        ),
      )
```

Rename the local `lastTakenByMedication` map to `lastEventByMedication` throughout, and the row field `lastTakenAt` to `lastEventAt`.

- [ ] **Step 2: Relax the join and select the lifecycle columns**

Change the outer query so medications with no schedule rows still surface:

```ts
const scheduleRows = await db
  .select({
    scheduleId: medicationSchedules.id,
    scheduleKind: medicationSchedules.scheduleKind,
    intervalHours: medicationSchedules.intervalHours,
    timeOfDay: medicationSchedules.timeOfDay,
    daysOfWeek: medicationSchedules.daysOfWeek,
    effectiveFrom: medicationSchedules.effectiveFrom,
    effectiveTo: medicationSchedules.effectiveTo,
    medicationId: medications.id,
    medicationName: medications.name,
    medicationScheduleType: medications.scheduleType,
    medicationIntervalHours: medications.scheduleIntervalHours,
    startedAt: medications.startedAt,
    endedAt: medications.endedAt,
    userId: medications.userId,
    userEmail: users.email,
    userEmailVerified: users.emailVerified,
    userTimezone: users.timezone,
    userOverdueEmailReminders: userPreferences.overdueEmailReminders,
    userOverduePushReminders: userPreferences.overduePushReminders,
  })
  .from(medications)
  .innerJoin(users, eq(medications.userId, users.id))
  .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
  .leftJoin(medicationSchedules, eq(medicationSchedules.medicationId, medications.id))
  .where(
    and(
      eq(medications.isArchived, false),
      or(
        eq(userPreferences.overdueEmailReminders, true),
        eq(userPreferences.overduePushReminders, true),
      ),
    ),
  );
```

The `ne(medicationSchedules.scheduleKind, "prn")` filter is dropped from SQL — `isOutstanding` returns null for `prn`, so the exclusion now lives in one place. Import `or` and keep `and`, `eq`, `inArray`, `max`.

- [ ] **Step 3: Replace the per-row computation**

```ts
  for (const scheduleRow of scheduleRows) {
    const schedules = effectiveSchedules(
      {
        id: scheduleRow.medicationId,
        scheduleType: scheduleRow.medicationScheduleType,
        scheduleIntervalHours: scheduleRow.medicationIntervalHours,
      },
      scheduleRow.scheduleId
        ? [
            {
              id: scheduleRow.scheduleId,
              scheduleKind: scheduleRow.scheduleKind,
              timeOfDay: scheduleRow.timeOfDay,
              intervalHours: scheduleRow.intervalHours,
              daysOfWeek: scheduleRow.daysOfWeek,
              effectiveFrom: scheduleRow.effectiveFrom,
              effectiveTo: scheduleRow.effectiveTo,
            },
          ]
        : [],
    );
    if (schedules.length === 0) continue;
    const schedule = schedules[0];

    const slot = isOutstanding(
      schedule,
      { kind: "anchor", lastEventAt: lastEventByMedication.get(scheduleRow.medicationId) ?? null },
      scheduleRow.userTimezone,
      now,
      { startedAt: scheduleRow.startedAt, endedAt: scheduleRow.endedAt },
    );
    if (!slot) continue;

    const dedupeKey = buildOverdueDedupeKey(
      scheduleRow.userId,
      scheduleRow.medicationId,
      schedule.scheduleKind,
      schedule.id,
      slot,
    );
    // ... claim / dispatch / complete continue unchanged
```

Because a left join emits one row per schedule, a medication with several schedules still produces one iteration each, and the synthetic `legacy:{id}` only appears when `scheduleId` is null. The rest of the loop body — `claimReminderSlot`, the channel fan-out, `completeReminder` — is untouched.

- [ ] **Step 4: Rework the test mock**

In `tests/unit/reminders.test.ts`, the `db.select` mock returns rows by call index. The first call now returns the joined medication+schedule rows (with the new fields), the second the last-event aggregate. Update the fixture rows pushed into `scheduleRows` to include `medicationScheduleType`, `medicationIntervalHours`, `startedAt`, `endedAt`, `effectiveFrom`, `effectiveTo`, and rename `lastTakenRows` to `lastEventRows`.

- [ ] **Step 5: Add regression tests for the fix**

Append to `tests/unit/reminders.test.ts`, inside the existing `checkOverdueMedications` describe block:

```ts
it("does not remind for a slot the user deliberately skipped", async () => {
  // The whole point of the change: a skip resolves the slot, so no
  // reminder is claimed or dispatched.
  scheduleRows.push(overdueScheduleRow({ scheduleKind: "interval", intervalHours: "8" }));
  lastEventRows.push({
    medicationId: "med-1",
    lastEventAt: new Date(Date.now() - 60 * 60 * 1000), // skipped 1h ago
  });

  await checkOverdueMedications();

  expect(sentPushes).toHaveLength(0);
  expect(sentEmails).toHaveLength(0);
});

it("reminds for a medication that has no schedule rows but legacy columns", async () => {
  scheduleRows.push(
    overdueScheduleRow({
      scheduleId: null,
      scheduleKind: null,
      intervalHours: null,
      medicationScheduleType: "scheduled",
      medicationIntervalHours: "8",
    }),
  );

  await checkOverdueMedications();

  expect(sentPushes).toHaveLength(1);
});
```

Add an `overdueScheduleRow(overrides)` helper alongside the existing fixtures that returns a full row with sensible defaults, so both cases read clearly.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/unit/reminders.test.ts`
Expected: PASS, including both new cases.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npx vitest run && npm run check`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add src/lib/server/reminders.ts tests/unit/reminders.test.ts
git commit -m "fix(reminders): stop reminding for skipped doses and honour legacy schedules"
```

---

### Task 9: Delete the superseded implementations

**Files:**

- Modify: `src/lib/server/reminders/domain.ts`, `src/lib/utils/time.ts`
- Modify: `tests/unit/reminders-dedupe.test.ts`, `tests/unit/time.test.ts`

- [ ] **Step 1: Confirm nothing references them**

```bash
grep -rn "computeOverdueSlot\|isScheduleOverdue\|computeTimingStatus\|MATCH_TOLERANCE_MS\|FIXED_TIME_TOLERANCE_MS" src tests
```

Expected: matches only inside the files about to be edited. Any other hit means an earlier task is incomplete — stop and fix it.

- [ ] **Step 2: Trim `reminders/domain.ts`**

Delete `computeOverdueSlot`, `isScheduleOverdue`, `shiftLocalDate`, `FIXED_TIME_TOLERANCE_MS`, `OVERDUE_LOOKBACK_DAYS`, `OverdueRow`, and the now-unused imports from `$lib/utils/schedule`. The file keeps only `ReminderType`, `buildOverdueDedupeKey` and `buildLowInventoryDedupeKey`. In `src/lib/server/reminders.ts`, delete the `export { ... } from "./reminders/domain"` block near the top of the file — nothing imports those names from there. Locate it by content: Task 8 rewrote this file, so any line number from the original is stale.

- [ ] **Step 3: Trim `time.ts`**

Delete `computeTimingStatus`. Keep `classifyDueStatus`, `formatTimeSince`, `formatTime`, `formatDueIn`, `startOfDay` and `calculateDaysUntilRefill` (dead, but its removal belongs to a separate candidate).

- [ ] **Step 4: Update the tests**

In `tests/unit/reminders-dedupe.test.ts`: delete the `isScheduleOverdue` and `computeOverdueSlot` describe blocks and the `intervalRow` / `fixedTimeRow` fixtures. Keep both dedupe-key describe blocks untouched — those are the file's remaining purpose. The equivalent coverage now lives in `due.test.ts`.

In `tests/unit/time.test.ts`: delete the whole `computeTimingStatus` describe block, including `:152` "returns 'overdue' when lastTakenAt is null" — the `startedAt` rule replaces it and is already asserted in `due.test.ts`.

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run && npm run check && npm run lint`
Expected: all green. Test count drops as the superseded cases retire.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/reminders/domain.ts src/lib/server/reminders.ts src/lib/utils/time.ts tests/unit/reminders-dedupe.test.ts tests/unit/time.test.ts
git commit -m "refactor: delete the superseded due-ness implementations"
```

---

### Task 10: Honour the schedule effective window

**Confirmed in scope (2026-08-13) — implement it.** This went beyond the approved spec and was explicitly approved afterwards. `medication_schedules.effectiveFrom` / `effectiveTo` exist and are written by import, but no due-ness computation has ever read them, so a schedule with a past `effectiveTo` still generates occurrences. Fixing that _removes_ reminders for any schedule carrying a stale `effectiveTo` — that consequence is understood and accepted.

**Files:**

- Modify: `src/lib/utils/due.ts`
- Modify: `tests/unit/due.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("produces no occurrences outside the schedule's own effective window", () => {
  const s = sched({
    scheduleKind: "fixed_time",
    timeOfDay: "09:00",
    intervalHours: null,
    effectiveTo: new Date("2026-04-30T00:00:00Z"),
  });
  expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
});

it("still produces occurrences inside the schedule's effective window", () => {
  const s = sched({
    scheduleKind: "fixed_time",
    timeOfDay: "09:00",
    intervalHours: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: new Date("2026-12-31T00:00:00Z"),
  });
  expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/due.test.ts`
Expected: FAIL — the first case returns one occurrence.

- [ ] **Step 3: Intersect the windows**

In `occurrencesFor`, replace the `withinLifecycle` filter with one that also honours the schedule:

```ts
const from = schedule.effectiveFrom
  ? new Date(Math.max(lifecycle.startedAt.getTime(), schedule.effectiveFrom.getTime()))
  : lifecycle.startedAt;
const toMs = Math.min(
  lifecycle.endedAt?.getTime() ?? Infinity,
  schedule.effectiveTo?.getTime() ?? Infinity,
);

return out
  .filter((t) => t.getTime() >= from.getTime() && t.getTime() <= toMs)
  .sort((a, b) => a.getTime() - b.getTime());
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/due.ts tests/unit/due.test.ts
git commit -m "fix(due): honour the schedule effective window"
```

---

### Task 11: Correct ADR-0005 and count the affected population

**Files:**

- Modify: `docs/adr/0005-reminder-deduplication.md`

- [ ] **Step 1: Correct the documented key**

The ADR documents `${userId}:${medicationId}:${reminderType}:${nextDueAt}`. Replace with the six-segment key the code actually builds, and note the synthetic case:

```markdown
The dedupe key is
`${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt}`.

`scheduleKind` and `scheduleId` were added when a medication gained multiple
schedules (ADR-0006) so two schedules on one medication cannot collide. A
medication with no schedule rows uses the synthetic id `legacy:${medicationId}`,
derived from its deprecated interval columns.
```

- [ ] **Step 2: Count the newly-reachable population before deploying**

Run against production (read-only) and record the number in the PR:

```sql
SELECT count(*)
FROM medications m
LEFT JOIN medication_schedules s ON s.medication_id = m.id
WHERE s.id IS NULL
  AND m.is_archived = false
  AND m.schedule_type = 'scheduled'
  AND m.schedule_interval_hours IS NOT NULL;
```

These medications have never generated a reminder and will start doing so. If the count is large, ship behind a check rather than letting the first cron tick discover it.

- [ ] **Step 3: Final verification**

```bash
npx vitest run && npm run check && npm run lint && npm run build
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/0005-reminder-deduplication.md
git commit -m "docs(adr): correct the reminder dedupe key to match the implementation"
```

---

## Done When

- One tolerance constant exists in the codebase; `grep -rn "MATCH_TOLERANCE_MS\|FIXED_TIME_TOLERANCE_MS" src` returns nothing.
- `grep -rn "computeOverdueSlot\|computeTimingStatus" src` returns nothing.
- `tests/unit/due-parity.test.ts` passes — the two projections agree.
- Skipping a dose produces no overdue push.
- `dashboard/+page.server.ts` contains no `covered` set and no branch on `scheduleType` / `scheduleIntervalHours`.
- Full suite, `npm run check`, `npm run lint` and `npm run build` all green.
