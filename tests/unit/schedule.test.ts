import { describe, it, expect } from "vitest";
import { classifyHour, groupSlotsByTimeOfDay } from "$lib/utils/schedule";
import { outstandingSlots, timingStatusFromSlots } from "$lib/utils/due";
import type { ScheduleSlot, ScheduleSlotStatus } from "$lib/utils/due";
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

/**
 * `outstandingSlots` derives its per-medication interval anchor from
 * `taken` rows in the same evidence used for slot matching (see due.ts).
 * The pre-move `computeScheduleSlots` took a separate `lastDoseByMedication`
 * map, so tests exercising that anchor synthesize an extra taken dose here
 * to reproduce it.
 */
function anchorDose(medicationId: string, takenAt: Date): DoseLogWithMedication {
  return makeDose({ id: `anchor-${medicationId}`, medicationId, takenAt, status: "taken" });
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

describe("outstandingSlots — interval kind", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("produces 3 slots for an 8-hour interval with no prior doses", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].expectedTime).toBe("2026-04-16T00:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T08:00:00.000Z");
    expect(slots[2].expectedTime).toBe("2026-04-16T16:00:00.000Z");
  });

  it("anchors schedule from last dose before today", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [anchorDose("med-1", new Date("2026-04-15T22:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(3);
    expect(slots[0].expectedTime).toBe("2026-04-16T06:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T14:00:00.000Z");
    expect(slots[2].expectedTime).toBe("2026-04-16T22:00:00.000Z");
  });

  it("marks slot as taken when dose matches within 1 hour", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const dose = makeDose({ takenAt: new Date("2026-04-16T06:30:00Z") });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose, anchorDose("med-1", new Date("2026-04-15T22:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots[0].status).toBe("taken");
    expect(slots[0].matchedDoseId).toBe("dose-1");
  });

  it("marks past unmatched slots as overdue", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [anchorDose("med-1", new Date("2026-04-15T22:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots[0].status).toBe("overdue");
    expect(slots[1].status).toBe("upcoming");
    expect(slots[2].status).toBe("upcoming");
  });

  it("marks slot as skipped when matched dose has status=skipped", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const skip = makeDose({
      id: "dose-skip-1",
      takenAt: new Date("2026-04-16T06:30:00Z"),
      status: "skipped",
    });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [skip, anchorDose("med-1", new Date("2026-04-15T22:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots[0].status).toBe("skipped");
    expect(slots[0].matchedDoseId).toBe("dose-skip-1");
  });

  it("marks slot as overdue (not taken) when matched dose has status=missed", () => {
    const meds = [makeMed()];
    const sched = schedMap([makeIntervalSchedule("med-1", "8")]);
    const missed = makeDose({
      id: "dose-missed-1",
      takenAt: new Date("2026-04-16T06:30:00Z"),
      status: "missed",
    });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [missed, anchorDose("med-1", new Date("2026-04-15T22:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots[0].status).toBe("overdue");
    expect(slots[0].matchedDoseId).toBe("dose-missed-1");
  });

  it("produces correct number of slots for various intervals", () => {
    const now = new Date("2026-04-16T01:00:00Z");
    const meds = [makeMed()];

    const slots6 = outstandingSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "6")]),
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots6).toHaveLength(4);

    const slots12 = outstandingSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "12")]),
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots12).toHaveLength(2);

    const slots24 = outstandingSlots(
      meds,
      schedMap([makeIntervalSchedule("med-1", "24")]),
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots24).toHaveLength(1);
  });
});

describe("outstandingSlots — fixed_time kind", () => {
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(2);
    expect(slots[0].expectedTime).toBe("2026-04-16T08:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T20:00:00.000Z");
  });

  it("respects daysOfWeek filter", () => {
    const meds = [makeMed()];
    // 2026-04-16 is a Thursday (dow=4). Restrict to Mon/Wed/Fri (1,3,5).
    const sched = schedMap([makeFixedTimeSchedule("med-1", "08:00", [1, 3, 5])]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(0);
  });

  it("emits slot when daysOfWeek allows the local day", () => {
    const meds = [makeMed()];
    // Thursday = 4
    const sched = schedMap([makeFixedTimeSchedule("med-1", "08:00", [4])]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(1);
  });
});

describe("outstandingSlots — prn and mixed", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("prn produces zero slots", () => {
    const meds = [makeMed()];
    const sched = schedMap([makePrnSchedule("med-1")]);
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(0);
  });

  it("medication with no schedules produces zero slots", () => {
    const meds = [makeMed()];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      new Map(),
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots).toHaveLength(0);
  });

  it("multi-schedule produces the union, deduped", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeIntervalSchedule("med-1", "12"),
      makeFixedTimeSchedule("med-1", "08:00", null, 1),
    ]);
    const now = new Date("2026-04-16T01:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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

describe("outstandingSlots — multi-unit dose matching (quantity)", () => {
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [skip] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots.filter((s) => s.status === "skipped")).toHaveLength(1);
    expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [skip, taken] },
      { startUtc: dayStart, endUtc: dayEnd },
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots.filter((s) => s.status === "taken")).toHaveLength(1);
    expect(slots.filter((s) => s.status === "overdue")).toHaveLength(2);
  });
});

describe("outstandingSlots — drifted interval twin of a fixed_time slot", () => {
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
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [anchorDose("med-1", new Date("2026-04-15T08:55:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const dose = makeDose({ takenAt: new Date("2026-04-16T08:55:00Z") });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [dose] },
      { startUtc: dayStart, endUtc: dayEnd },
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
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [anchorDose("med-1", new Date("2026-04-15T07:30:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [anchorDose("med-1", new Date("2026-04-15T09:00:00Z"))] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
    expect(slots.map((s) => s.expectedTime)).toEqual(["2026-04-16T09:00:00.000Z"]);
  });

  it("never collapses two explicit fixed_time slots, however close", () => {
    const meds = [makeMed()];
    const sched = schedMap([
      makeFixedTimeSchedule("med-1", "08:55", null, 0),
      makeFixedTimeSchedule("med-1", "09:00", null, 1),
    ]);
    const now = new Date("2026-04-16T08:00:00Z");
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      timezone,
      now,
    );
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      "UTC",
      now,
    );
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
    const slots = outstandingSlots(
      meds,
      sched,
      { kind: "events", doses: [] },
      { startUtc: dayStart, endUtc: dayEnd },
      "UTC",
      now,
    );
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
      status,
      matchedDoseId: null,
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
