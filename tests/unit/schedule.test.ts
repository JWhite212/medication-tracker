import { describe, it, expect } from "vitest";
import {
  classifyHour,
  computeScheduleSlots,
  groupSlotsByTimeOfDay,
} from "$lib/utils/schedule";
import type { Medication, DoseLogWithMedication } from "$lib/types";

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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeDose(
  overrides: Partial<DoseLogWithMedication> = {},
): DoseLogWithMedication {
  return {
    id: "dose-1",
    userId: "user-1",
    medicationId: "med-1",
    quantity: 1,
    takenAt: new Date("2026-04-16T08:00:00Z"),
    loggedAt: new Date("2026-04-16T08:00:00Z"),
    notes: null,
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

describe("computeScheduleSlots", () => {
  const dayStart = new Date("2026-04-16T00:00:00Z");
  const dayEnd = new Date("2026-04-17T00:00:00Z");
  const timezone = "UTC";

  it("produces 3 slots for an 8-hour interval with no prior doses", () => {
    const meds = [makeMed()];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      [],
      {},
      dayStart,
      dayEnd,
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
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      [],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    // 22:00 + 8h = 06:00, 06:00 + 8h = 14:00, 14:00 + 8h = 22:00
    expect(slots).toHaveLength(3);
    expect(slots[0].expectedTime).toBe("2026-04-16T06:00:00.000Z");
    expect(slots[1].expectedTime).toBe("2026-04-16T14:00:00.000Z");
    expect(slots[2].expectedTime).toBe("2026-04-16T22:00:00.000Z");
  });

  it("marks slot as taken when dose matches within 1 hour", () => {
    const meds = [makeMed()];
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const dose = makeDose({
      takenAt: new Date("2026-04-16T06:30:00Z"),
    });
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
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
    const lastDose = { "med-1": new Date("2026-04-15T22:00:00Z") };
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      [],
      lastDose,
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots[0].status).toBe("overdue"); // 06:00 is past
    expect(slots[1].status).toBe("upcoming"); // 14:00 is future
    expect(slots[2].status).toBe("upcoming"); // 22:00 is future
  });

  it("skips non-scheduled medications", () => {
    const meds = [makeMed({ scheduleType: "prn" })];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots).toHaveLength(0);
  });

  it("skips medications without interval hours", () => {
    const meds = [makeMed({ scheduleIntervalHours: null })];
    const now = new Date("2026-04-16T10:00:00Z");
    const slots = computeScheduleSlots(
      meds,
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots).toHaveLength(0);
  });

  it("produces correct number of slots for various intervals", () => {
    const now = new Date("2026-04-16T01:00:00Z");
    // 6h interval -> 4 slots, 12h -> 2, 24h -> 1
    const slots6 = computeScheduleSlots(
      [makeMed({ scheduleIntervalHours: "6" })],
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots6).toHaveLength(4);

    const slots12 = computeScheduleSlots(
      [makeMed({ scheduleIntervalHours: "12" })],
      [],
      {},
      dayStart,
      dayEnd,
      timezone,
      now,
    );
    expect(slots12).toHaveLength(2);

    const slots24 = computeScheduleSlots(
      [makeMed({ scheduleIntervalHours: "24" })],
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

describe("groupSlotsByTimeOfDay", () => {
  it("groups slots into correct time-of-day buckets", () => {
    const dayStart = new Date("2026-04-16T00:00:00Z");
    const dayEnd = new Date("2026-04-17T00:00:00Z");
    const now = new Date("2026-04-16T01:00:00Z");
    const meds = [makeMed({ scheduleIntervalHours: "6" })];
    const slots = computeScheduleSlots(
      meds,
      [],
      {},
      dayStart,
      dayEnd,
      "UTC",
      now,
    );
    // Expected at 00:00, 06:00, 12:00, 18:00
    const groups = groupSlotsByTimeOfDay(slots, "UTC");
    const keys = groups.map((g) => g.key);
    expect(keys).toContain("night"); // 00:00
    expect(keys).toContain("morning"); // 06:00
    expect(keys).toContain("afternoon"); // 12:00
    expect(keys).toContain("evening"); // 18:00
  });

  it("omits empty groups", () => {
    const dayStart = new Date("2026-04-16T00:00:00Z");
    const dayEnd = new Date("2026-04-17T00:00:00Z");
    const now = new Date("2026-04-16T01:00:00Z");
    // 24h interval -> only 1 slot at midnight (night)
    const meds = [makeMed({ scheduleIntervalHours: "24" })];
    const slots = computeScheduleSlots(
      meds,
      [],
      {},
      dayStart,
      dayEnd,
      "UTC",
      now,
    );
    const groups = groupSlotsByTimeOfDay(slots, "UTC");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("night");
  });
});
