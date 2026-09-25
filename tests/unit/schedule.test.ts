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
import type { Medication, DoseLogWithMedication } from "$lib/types";
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

function makeIntervalSchedule(
  medicationId: string,
  intervalHours: string,
  overrides: Partial<MedicationSchedule> = {},
): MedicationSchedule {
  return {
    id: `sched-${medicationId}-int`,
    medicationId,
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

function makePrnSchedule(medicationId: string): MedicationSchedule {
  return {
    id: `sched-${medicationId}-prn`,
    medicationId,
    userId: "user-1",
    scheduleKind: "prn",
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
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

describe("classifyHour", () => {
  it("classifies morning hours (5-11)", () => {
    expect(classifyHour(5)).toBe("morning");
    expect(classifyHour(11)).toBe("morning");
  });

  it("classifies afternoon hours (12-16)", () => {
    expect(classifyHour(12)).toBe("afternoon");
    expect(classifyHour(16)).toBe("afternoon");
  });

  it("classifies evening hours (17-20)", () => {
    expect(classifyHour(17)).toBe("evening");
    expect(classifyHour(20)).toBe("evening");
  });

  it("classifies night hours (21-4)", () => {
    expect(classifyHour(21)).toBe("night");
    expect(classifyHour(0)).toBe("night");
    expect(classifyHour(4)).toBe("night");
  });
});

describe("computeScheduleSlots — interval kind", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("produces 3 slots for an 8-hour interval with no prior doses", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(3);
    expect(slots[0].expectedTime).toBe("2026-04-16T00:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T08:00:00.000Z");
    expect(slots[2].expectedTime).toBe("2026-04-16T16:00:00.000Z");
  });

  it("anchors schedule from last dose before today", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], lastDose, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(3);
    expect(slots[0].expectedTime).toBe("2026-04-16T06:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T14:00:00.000Z");
    expect(slots[2].expectedTime).toBe("2026-04-16T22:00:00.000Z");
  });

  it("marks slot as taken when dose matches within 1 hour", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const dose = makeDose({ takenAt: new Date("2026-04-16T06:30:00Z") });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      sched,
      [dose],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots[0].status).toBe("taken");
    expect(slots[0].matchedDoseId).toBe("dose-1");
  });

  it("marks past unmatched slots as overdue", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], lastDose, dayStart, dayEnd, timezone, now);
    expect(slots[0].status).toBe("overdue");
    expect(slots[1].status).toBe("upcoming");
    expect(slots[2].status).toBe("upcoming");
  });

  it("marks slot as skipped when matched dose has status=skipped", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T06:30:00Z"),
      status: "skipped",
    });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      sched,
      [skip],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots[0].status).toBe("skipped");
    expect(slots[0].matchedDoseId).toBe("dose-skip-1");
  });

  it("marks slot as overdue (not taken) when matched dose has status=missed", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const missed = makeDose({
      id: "dose-missed-1",
      takenAt: new Date("2026-04-16T06:30:00Z"),
      status: "missed",
    });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      sched,
      [missed],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots[0].status).toBe("overdue");
    expect(slots[0].matchedDoseId).toBe("dose-missed-1");
  });

  it("produces correct number of slots for various intervals", () => {
    const now = new Date("2026-04-16T01:00:00Z");
    const meds = [makeMed()];

    const slots6 = computeScheduleSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "6")]),
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots6).toHaveLength(4);

    const slots12 = computeScheduleSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "12")]),
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots12).toHaveLength(2);

    const slots24 = computeScheduleSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "24")]),
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots24).toHaveLength(1);
  });

  it("produces no slots for a zero interval", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "0")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(0);
  });

  it("produces no slots for an interval that parses to Infinity", () => {
    // Unreachable through any write door: the Zod schemas cap at
    // MAX_INTERVAL_HOURS, and the import door's numericString is capped at 32
    // characters, so the largest importable value is ~1e32 — finite. Pinned
    // because it is a deliberate tightening, not an accident: before the
    // primitive, a non-finite interval was truthy, passed the guard, and
    // yielded one phantom slot at the anchor, asserting a dose was due at the
    // instant the last one was taken. No slots is the honest reading of an
    // infinitely-spaced schedule.
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "Infinity")]);
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
});

describe("computeScheduleSlots — fixed_time kind", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("produces one slot per timeOfDay row", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:00"),
      makeFixedTimeSchedule("med-1", "20:00", null, 1),
    ]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(2);
    expect(slots[0].expectedTime).toBe("2026-04-16T08:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T20:00:00.000Z");
  });

  it("respects daysOfWeek filter", () => {
    const meds = [makeMed()];
    // 2026-04-16 is a Thursday (dow=4). Restrict to Mon/Wed/Fri (1,3,5).
    const sched = schedMap([makeFixedTimeSchedule("med-1", "08:00", [1, 3, 5])]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(0);
  });

  it("emits slot when daysOfWeek allows the local day", () => {
    const meds = [makeMed()];
    // Thursday = 4
    const sched = schedMap([makeFixedTimeSchedule("med-1", "08:00", [4])]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(1);
  });
});

describe("computeScheduleSlots — prn and mixed", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("prn produces zero slots", () => {
    const meds = [makeMed()];
    const sched = schedMap([makePrnSchedule("med-1")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(0);
  });

  it("medication with no schedules produces zero slots", () => {
    const meds = [makeMed()];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(meds, new Map(), [], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(0);
  });

  it("multi-schedule produces the union, deduped", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "12"),
      makeFixedTimeSchedule("med-1", "08:00", null, 1),
    ]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    // Interval @ 12h with no prior dose: 00:00, 12:00.
    // Fixed: 08:00. Total = 3 distinct ISO times.
    const times = slots.map((s) => s.expectedTime).sort();
    expect(times).toEqual([
      "2026-04-16T00:00:00.000Z",
      "2026-04-16T08:00:00.000Z",
      "2026-04-16T12:00:00.000Z",
    ]);
  });
});

describe("computeScheduleSlots — multi-unit dose matching (quantity)", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("a quantity-3 taken dose fills 3 nearby slots", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:30", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "09:30", null, 2),
    ]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00Z"), quantity: 3 });
    const now = new Date("2026-04-16T23:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [dose], {}, dayStart, dayEnd, timezone, now);
    expect(slots.map((s) => s.status)).toEqual(["taken", "taken", "taken"]);
  });

  it("does not fill a slot outside the ±1h vicinity of the dose", () => {
    // The user's scenario: log ×3 at 09:00; 08:55 and 09:00 are covered,
    // but the 11:00 slot is 2h away and stays its own upcoming dose.
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:55", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "11:00", null, 2),
    ]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00Z"), quantity: 3 });
    const now = new Date("2026-04-16T09:30:00Z");
    const slots = computeScheduleSlots(meds, sched, [dose], {}, dayStart, dayEnd, timezone, now);
    expect(slots[0].status).toBe("taken"); // 08:55
    expect(slots[1].status).toBe("taken"); // 09:00
    expect(slots[2].status).toBe("upcoming"); // 11:00 — untouched
    expect(slots[2].matchedDoseId).toBeNull();
  });

  it("quantity exceeding available nearby slots fills what it can and ignores the surplus", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:45", null, 0),
      makeFixedTimeSchedule("med-1", "09:15", null, 1),
    ]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00Z"), quantity: 5 });
    const now = new Date("2026-04-16T23:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [dose], {}, dayStart, dayEnd, timezone, now);
    expect(slots).toHaveLength(2);
    expect(slots.map((s) => s.status)).toEqual(["taken", "taken"]);
  });

  it("a skipped dose clears at most one slot even if its quantity is >1", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:45", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "09:15", null, 2),
    ]);
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T09:00:00Z"),
      quantity: 3,
      status: "skipped",
    });
    const now = new Date("2026-04-16T23:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [skip], {}, dayStart, dayEnd, timezone, now);
    expect(slots.filter((s) => s.status === "skipped")).toHaveLength(1);
    expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
    // Same count, different slot, on purpose. The skip sits exactly on the
    // 09:00 instant, which makes it 09:00's RESERVED skip: a pass-1
    // candidate for that slot only. Before reserved skips, pass 1's
    // ascending greed gave it to 08:45.
    expect(slots.find((s) => s.status === "skipped")?.expectedTime).toBe(
      "2026-04-16T09:00:00.000Z",
    );
  });

  it("prefers a taken dose over a skipped dose when both are in-vicinity of a slot", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeFixedTimeSchedule("med-1", "09:00", null, 0)]);
    // Skipped dose is closer in time (10m) than the taken dose (20m), but a
    // real taken dose should win the slot. Skipped is passed first to prove
    // selection is not order-dependent.
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T08:50:00Z"),
      status: "skipped",
    });
    const taken = makeDose({
      id: "dose-taken-1",
      takenAt: new Date("2026-04-16T09:20:00Z"),
      status: "taken",
    });
    const now = new Date("2026-04-16T23:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      sched,
      [skip, taken],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots[0].status).toBe("taken");
    expect(slots[0].matchedDoseId).toBe("dose-taken-1");
  });

  it("a quantity-1 dose still fills exactly one slot (regression)", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:30", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "09:30", null, 2),
    ]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T09:00:00Z"), quantity: 1 });
    const now = new Date("2026-04-16T23:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [dose], {}, dayStart, dayEnd, timezone, now);
    expect(slots.filter((s) => s.status === "taken")).toHaveLength(1);
    expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
    // Same count, different slot, on purpose. The dose sits exactly on the
    // 09:00 instant, so PASS 0 gives it 09:00 before pass 1 runs. Before
    // pass 0, pass 1's ascending greed gave it to 08:30.
    expect(slots.find((s) => s.status === "taken")?.expectedTime).toBe("2026-04-16T09:00:00.000Z");
  });
});

describe("computeScheduleSlots — drifted interval twin of a fixed_time slot", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("suppresses an interval projection within 1h of a fixed_time slot", () => {
    // Med has a declared 09:00 + 11:00 fixed schedule plus a leftover
    // 24h interval row anchored to yesterday's 08:55 log — the interval
    // projection lands at 08:55 today, 5 min from the declared 09:00.
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "11:00", null, 2),
    ]);
    const lastDose = { "med-1": new Date("2026-04-15T08:55:00Z") };
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], lastDose, dayStart, dayEnd, timezone, now);
    expect(slots.map((s) => s.expectedTime)).toEqual([
      "2026-04-16T09:00:00.000Z",
      "2026-04-16T11:00:00.000Z",
    ]);
  });

  it("a dose logged at the drifted time still marks the fixed slot taken", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
      makeFixedTimeSchedule("med-1", "11:00", null, 2),
    ]);
    const lastDose = { "med-1": new Date("2026-04-16T08:55:00Z") };
    const dose = makeDose({ takenAt: new Date("2026-04-16T08:55:00Z") });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      sched,
      [dose],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].expectedTime).toBe("2026-04-16T09:00:00.000Z");
    expect(slots[0].status).toBe("taken");
    expect(slots[1].expectedTime).toBe("2026-04-16T11:00:00.000Z");
    expect(slots[1].status).toBe("upcoming");
  });

  it("keeps an interval projection more than 1h from any fixed_time slot", () => {
    // Anchored at 07:30 yesterday → projects 07:30 today, 90 min from
    // the 09:00 fixed slot — genuinely separate, both must render.
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ]);
    const lastDose = { "med-1": new Date("2026-04-15T07:30:00Z") };
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], lastDose, dayStart, dayEnd, timezone, now);
    expect(slots.map((s) => s.expectedTime)).toEqual([
      "2026-04-16T07:30:00.000Z",
      "2026-04-16T09:00:00.000Z",
    ]);
  });

  it("collapses an exact interval/fixed_time collision into one slot", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "24"),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ]);
    const lastDose = { "med-1": new Date("2026-04-15T09:00:00Z") };
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], lastDose, dayStart, dayEnd, timezone, now);
    expect(slots.map((s) => s.expectedTime)).toEqual(["2026-04-16T09:00:00.000Z"]);
  });

  it("never collapses two explicit fixed_time slots, however close", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:55", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ]);
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, timezone, now);
    expect(slots.map((s) => s.expectedTime)).toEqual([
      "2026-04-16T08:55:00.000Z",
      "2026-04-16T09:00:00.000Z",
    ]);
  });
});

describe("groupSlotsByTimeOfDay", () => {
  it("groups slots into correct time-of-day buckets", () => {
    const dayStart = new Date("2026-04-16T00:00:00Z");
    const dayEnd = new Date("2026-04-17T00:00:00Z");
    const now = new Date("2026-04-16T01:00:00Z");
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "6")]);
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, "UTC", now);
    const groups = groupSlotsByTimeOfDay(slots, "UTC");
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("night");
    expect(keys).toContain("morning");
    expect(keys).toContain("afternoon");
    expect(keys).toContain("evening");
  });

  it("omits empty groups", () => {
    const dayStart = new Date("2026-04-16T00:00:00Z");
    const dayEnd = new Date("2026-04-17T00:00:00Z");
    const now = new Date("2026-04-16T01:00:00Z");
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "24")]);
    const slots = computeScheduleSlots(meds, sched, [], {}, dayStart, dayEnd, "UTC", now);
    const groups = groupSlotsByTimeOfDay(slots, "UTC");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("night");
  });
});

describe("timingStatusFromSlots", () => {
  const now = new Date("2026-04-16T10:00:00Z");

  function slot(status: ScheduleSlotStatus, iso: string): ScheduleSlot {
    return {
      medicationId: "med-1",
      medicationName: "TestMed",
      colour: "#6366f1",
      colourSecondary: null,
      pattern: "solid",
      dosageAmount: "200",
      dosageUnit: "mg",
      expectedTime: iso,
      kind: "fixed_time",
      status,
      matchedDoseId: null,
      resolvedByDoseId: null,
      missedByDoseId: null,
      isEarlier: false,
    };
  }

  it("reports overdue with negative minutes for a past unresolved slot", () => {
    const t = timingStatusFromSlots([slot("overdue", "2026-04-16T08:00:00Z")], now);
    expect(t).toEqual({ status: "overdue", minutesUntilDue: -120 });
  });

  it("reports due_soon for a slot within the next hour", () => {
    const t = timingStatusFromSlots([slot("upcoming", "2026-04-16T10:30:00Z")], now);
    expect(t).toEqual({ status: "due_soon", minutesUntilDue: 30 });
  });

  it("reports ok for a slot further out", () => {
    const t = timingStatusFromSlots([slot("upcoming", "2026-04-16T13:00:00Z")], now);
    expect(t).toEqual({ status: "ok", minutesUntilDue: 180 });
  });

  it("uses the earliest unresolved slot when several exist", () => {
    const t = timingStatusFromSlots(
      [slot("upcoming", "2026-04-16T10:30:00Z"), slot("overdue", "2026-04-16T08:00:00Z")],
      now,
    );
    expect(t).toEqual({ status: "overdue", minutesUntilDue: -120 });
  });

  it("returns null when every slot is already resolved", () => {
    const t = timingStatusFromSlots(
      [slot("taken", "2026-04-16T08:00:00Z"), slot("skipped", "2026-04-16T09:00:00Z")],
      now,
    );
    expect(t).toBeNull();
  });

  it("returns null for an empty slot list", () => {
    expect(timingStatusFromSlots([], now)).toBeNull();
  });
});

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
