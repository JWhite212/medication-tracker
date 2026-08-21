import { describe, it, expect, vi } from "vitest";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

// medicationStatsFor must use the schedule-aware daily rate (inventory
// .ts dailyRateFor — the documented single source of truth) instead of
// only the deprecated legacy columns, which are null for fixed-time
// medications and made daysUntilRefill silently wrong for them.
// This module imports `db` but must never reach it. unusedDb THROWS on any
// property access, so an accidental query fails loudly instead of silently
// returning [] — do not "upgrade" this to createFakeDb().
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

const { medicationStatsFor } = await import("../../src/lib/server/medications");

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
    scheduleIntervalHours: null,
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
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function fixedRow(
  medicationId: string,
  timeOfDay: string,
  daysOfWeek: number[] | null = null,
): MedicationSchedule {
  return {
    id: `s-${medicationId}-${timeOfDay}`,
    medicationId,
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

function prnRow(medicationId: string): MedicationSchedule {
  return { ...fixedRow(medicationId, "00:00"), scheduleKind: "prn", timeOfDay: null };
}

describe("medicationStatsFor", () => {
  it("computes daysUntilRefill from fixed-time schedule rows (legacy interval is null)", () => {
    const med = makeMed({ inventoryCount: 20, scheduleIntervalHours: null });
    const schedules = [fixedRow("med-1", "08:00"), fixedRow("med-1", "20:00")];
    const out = medicationStatsFor(med, schedules, undefined);
    // 2 doses/day, 20 on hand → 10 days. The legacy-only path returned
    // null here (no interval hours, no history).
    expect(out.daysUntilRefill).toBe(10);
    expect(out.expectedDailyDoses).toBe(2);
  });

  it("weights fixed-time rows by daysOfWeek", () => {
    const med = makeMed({ inventoryCount: 21 });
    const schedules = [fixedRow("med-1", "08:00", [1, 3, 5])];
    const out = medicationStatsFor(med, schedules, undefined);
    // 3/7 doses per day → floor(21 / (3/7)) = 49
    expect(out.daysUntilRefill).toBe(49);
    expect(out.expectedDailyDoses).toBeCloseTo(3 / 7);
  });

  it("still supports legacy interval columns when no schedule rows exist", () => {
    const med = makeMed({ inventoryCount: 24, scheduleIntervalHours: "8" });
    const out = medicationStatsFor(med, undefined, undefined);
    // 24/8 = 3 doses/day → floor(24/3) = 8
    expect(out.daysUntilRefill).toBe(8);
    expect(out.expectedDailyDoses).toBe(3);
  });

  it("falls back to 30-day history for PRN medications and reports no expected rate", () => {
    const med = makeMed({ inventoryCount: 20, scheduleType: "as_needed" });
    const out = medicationStatsFor(med, [prnRow("med-1")], {
      lastTakenAt: new Date("2026-04-15T08:00:00Z"),
      weeklyDoseCount: 3,
      thirtyDayDoseCount: 15,
    });
    // 15/30 = 0.5 doses/day → floor(20/0.5) = 40
    expect(out.daysUntilRefill).toBe(40);
    expect(out.expectedDailyDoses).toBeNull();
  });

  it("returns null daysUntilRefill when inventory is untracked", () => {
    const med = makeMed({ inventoryCount: null });
    const out = medicationStatsFor(med, [fixedRow("med-1", "08:00")], undefined);
    expect(out.daysUntilRefill).toBeNull();
  });

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
});
