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
