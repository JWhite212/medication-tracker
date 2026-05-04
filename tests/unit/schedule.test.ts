import { describe, it, expect } from "vitest";
import { classifyHour, computeScheduleSlots, groupSlotsByTimeOfDay } from "$lib/utils/schedule";
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
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
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
