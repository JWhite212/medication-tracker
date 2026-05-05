import { describe, it, expect } from "vitest";
import {
  deriveInitialMode,
  deriveInitialFixedTimes,
  deriveInitialDaysOfWeek,
  isScheduleMode,
} from "../../src/lib/medications/medication-form-state";
import type { MedicationSchedule } from "../../src/lib/server/schedules";
import type { Medication } from "../../src/lib/types";

function fixedTimeSchedule(
  timeOfDay: string,
  daysOfWeek: number[] | null = null,
): MedicationSchedule {
  return {
    id: "s",
    medicationId: "m",
    userId: "u",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder: 0,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
  };
}

function intervalSchedule(intervalHours: string): MedicationSchedule {
  return {
    id: "s",
    medicationId: "m",
    userId: "u",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
  };
}

function prnSchedule(): MedicationSchedule {
  return {
    id: "s",
    medicationId: "m",
    userId: "u",
    scheduleKind: "prn",
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdAt: new Date(),
  };
}

describe("isScheduleMode", () => {
  it("accepts the three known modes", () => {
    expect(isScheduleMode("interval")).toBe(true);
    expect(isScheduleMode("fixed_time")).toBe(true);
    expect(isScheduleMode("prn")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isScheduleMode("scheduled")).toBe(false);
    expect(isScheduleMode("")).toBe(false);
    expect(isScheduleMode(undefined)).toBe(false);
    expect(isScheduleMode(42)).toBe(false);
  });
});

describe("deriveInitialMode", () => {
  it("returns interval for a brand-new medication with no schedules", () => {
    expect(deriveInitialMode({ schedules: [] })).toBe("interval");
  });

  it("honours a previously-submitted form value over everything else", () => {
    expect(
      deriveInitialMode({
        formValueMode: "prn",
        schedules: [intervalSchedule("8")],
        medication: { scheduleType: "scheduled" } as Medication,
      }),
    ).toBe("prn");
  });

  it("ignores invalid form values", () => {
    expect(
      deriveInitialMode({
        formValueMode: "garbage",
        schedules: [intervalSchedule("8")],
      }),
    ).toBe("interval");
  });

  it("matches the only schedule kind when schedules are homogeneous", () => {
    expect(deriveInitialMode({ schedules: [intervalSchedule("8")] })).toBe("interval");
    expect(deriveInitialMode({ schedules: [fixedTimeSchedule("08:00")] })).toBe("fixed_time");
    expect(deriveInitialMode({ schedules: [prnSchedule()] })).toBe("prn");
  });

  it("falls back to fixed_time when schedules mix kinds", () => {
    expect(
      deriveInitialMode({
        schedules: [intervalSchedule("8"), fixedTimeSchedule("08:00")],
      }),
    ).toBe("fixed_time");
  });

  it("respects the legacy as_needed flag when no schedules are saved", () => {
    expect(
      deriveInitialMode({
        schedules: [],
        medication: { scheduleType: "as_needed" } as Medication,
      }),
    ).toBe("prn");
  });
});

describe("deriveInitialFixedTimes", () => {
  it("returns saved fixed times in order", () => {
    expect(
      deriveInitialFixedTimes([fixedTimeSchedule("08:00"), fixedTimeSchedule("20:00")]),
    ).toEqual(["08:00", "20:00"]);
  });

  it("defaults to a single 08:00 when no fixed-time schedules exist", () => {
    expect(deriveInitialFixedTimes([])).toEqual(["08:00"]);
    expect(deriveInitialFixedTimes([intervalSchedule("8")])).toEqual(["08:00"]);
  });
});

describe("deriveInitialDaysOfWeek", () => {
  it("returns the saved days for the first fixed_time schedule that has them", () => {
    expect(
      deriveInitialDaysOfWeek([
        fixedTimeSchedule("08:00", null),
        fixedTimeSchedule("20:00", [1, 3, 5]),
      ]),
    ).toEqual([1, 3, 5]);
  });

  it("returns an empty array when no schedule carries day filters", () => {
    expect(deriveInitialDaysOfWeek([])).toEqual([]);
    expect(deriveInitialDaysOfWeek([fixedTimeSchedule("08:00", null)])).toEqual([]);
  });
});
