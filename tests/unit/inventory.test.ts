import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/db", () => ({ db: {} }));

import {
  classifyRefillSeverity,
  dailyRateFor,
  daysUntilRefill,
  REFILL_THRESHOLDS,
} from "$lib/server/inventory";
import type { MedicationSchedule } from "$lib/server/schedules";

function intervalSchedule(hours: number, medId = "m"): MedicationSchedule {
  return {
    id: "s",
    medicationId: medId,
    userId: "u",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours: String(hours),
    daysOfWeek: null,
    sortOrder: 0,
    createdAt: new Date(),
  };
}

function fixedTimeSchedule(time: string, daysOfWeek: number[] | null = null): MedicationSchedule {
  return {
    id: "s",
    medicationId: "m",
    userId: "u",
    scheduleKind: "fixed_time",
    timeOfDay: time,
    intervalHours: null,
    daysOfWeek,
    sortOrder: 0,
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
    createdAt: new Date(),
  };
}

describe("classifyRefillSeverity", () => {
  it("returns ok when null", () => {
    expect(classifyRefillSeverity(null)).toBe("ok");
  });

  it("returns critical at or below 3 days", () => {
    expect(classifyRefillSeverity(0)).toBe("critical");
    expect(classifyRefillSeverity(REFILL_THRESHOLDS.critical)).toBe("critical");
  });

  it("returns warning between 4 and 7 days", () => {
    expect(classifyRefillSeverity(4)).toBe("warning");
    expect(classifyRefillSeverity(7)).toBe("warning");
  });

  it("returns watch between 8 and 14 days", () => {
    expect(classifyRefillSeverity(8)).toBe("watch");
    expect(classifyRefillSeverity(14)).toBe("watch");
  });

  it("returns ok above 14 days", () => {
    expect(classifyRefillSeverity(15)).toBe("ok");
    expect(classifyRefillSeverity(100)).toBe("ok");
  });
});

describe("dailyRateFor", () => {
  it("uses schedule rate for a 24h interval", () => {
    expect(dailyRateFor([intervalSchedule(24)], "scheduled", "24", 0)).toBe(1);
  });

  it("uses schedule rate for a 12h interval", () => {
    expect(dailyRateFor([intervalSchedule(12)], "scheduled", "12", 0)).toBe(2);
  });

  it("sums multiple fixed-time schedules", () => {
    const rate = dailyRateFor(
      [fixedTimeSchedule("08:00"), fixedTimeSchedule("20:00")],
      "scheduled",
      null,
      0,
    );
    expect(rate).toBe(2);
  });

  it("scales fixed_time by daysOfWeek when restricted", () => {
    const rate = dailyRateFor([fixedTimeSchedule("08:00", [1, 2, 3])], "scheduled", null, 0);
    expect(rate).toBeCloseTo(3 / 7);
  });

  it("falls back to historical avg for PRN-only schedules", () => {
    expect(dailyRateFor([prnSchedule()], "as_needed", null, 30)).toBe(1);
  });

  it("falls back to legacy interval column when no schedule rows", () => {
    expect(dailyRateFor(undefined, "scheduled", "24", 0)).toBe(1);
  });

  it("falls back to 30-day average for legacy as_needed", () => {
    expect(dailyRateFor(undefined, "as_needed", null, 60)).toBe(2);
  });
});

describe("daysUntilRefill", () => {
  it("60 stock at 1/day → 60 days", () => {
    expect(daysUntilRefill(60, 1)).toBe(60);
  });

  it("10 stock at 2/day → 5 days", () => {
    expect(daysUntilRefill(10, 2)).toBe(5);
  });

  it("returns null when inventory is null", () => {
    expect(daysUntilRefill(null, 1)).toBeNull();
  });

  it("returns null when daily rate is 0", () => {
    expect(daysUntilRefill(20, 0)).toBeNull();
  });

  it("rounds down on partial days", () => {
    expect(daysUntilRefill(7, 2)).toBe(3);
  });
});

describe("integration: scheduled vs PRN refill scenarios", () => {
  it("scheduled med with stock=60 / interval=24h reports 60 days", () => {
    const rate = dailyRateFor([intervalSchedule(24)], "scheduled", "24", 0);
    expect(daysUntilRefill(60, rate)).toBe(60);
  });

  it("scheduled med with stock=10 / interval=12h reports 5 days", () => {
    const rate = dailyRateFor([intervalSchedule(12)], "scheduled", "12", 0);
    expect(daysUntilRefill(10, rate)).toBe(5);
  });

  it("PRN med with stock=15 and 30 doses in 30 days reports 15 days", () => {
    const rate = dailyRateFor([prnSchedule()], "as_needed", null, 30);
    expect(daysUntilRefill(15, rate)).toBe(15);
  });

  it("PRN med with no historical doses returns null (infinite)", () => {
    const rate = dailyRateFor([prnSchedule()], "as_needed", null, 0);
    expect(daysUntilRefill(15, rate)).toBeNull();
  });
});
