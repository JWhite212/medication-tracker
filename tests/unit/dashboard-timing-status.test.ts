import { describe, it, expect, vi } from "vitest";

// The QuickLogBar timing badges were built only from the deprecated
// legacy interval columns, so fixed-time-scheduled medications (whose
// scheduleIntervalHours is null) never received an overdue/due-soon
// badge no matter how overdue they were. The load must now derive a
// timing entry from the My Day schedule slots for those medications.
const fixedTimeMed = {
  id: "med-fixed",
  userId: "u1",
  name: "FixedMed",
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
  sortOrder: 0,
  isArchived: false,
  archivedAt: null,
  startedAt: new Date("2026-01-01T00:00:00Z"),
  endedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const prnMed = { ...fixedTimeMed, id: "med-prn", name: "PrnMed", scheduleType: "as_needed" };

const fixedSchedule = {
  id: "s1",
  medicationId: "med-fixed",
  userId: "u1",
  scheduleKind: "fixed_time",
  timeOfDay: "12:00",
  intervalHours: null,
  daysOfWeek: null,
  sortOrder: 0,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

const prnSchedule = {
  ...fixedSchedule,
  id: "s2",
  medicationId: "med-prn",
  scheduleKind: "prn",
  timeOfDay: null,
};

vi.mock("@vercel/analytics/server", () => ({ track: async () => {} }));
vi.mock("$lib/server/medications", () => ({
  getActiveMedications: async () => [fixedTimeMed, prnMed],
}));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: async () => [] }));
vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: async () =>
    new Map([
      ["med-fixed", [fixedSchedule]],
      ["med-prn", [prnSchedule]],
    ]),
}));
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: async () => [],
  getLastDosePerMedication: async () => [],
  logDose: async () => ({}),
  logSkippedDose: async () => ({}),
  deleteDose: async () => true,
  updateDose: async () => ({}),
  MedicationNotFoundError: class MedicationNotFoundError extends Error {},
}));

const { load } = await import("../../src/routes/(app)/dashboard/+page.server");

type LoadData = { timingStatus: import("$lib/types").MedicationTimingStatus[] };

async function runLoad(): Promise<LoadData> {
  return (await load({
    locals: { user: { id: "u1", timezone: "UTC" } },
  } as never)) as LoadData;
}

describe("dashboard timingStatus for fixed-time medications", () => {
  it("includes a slot-derived timing entry for a fixed-time med with null legacy interval", async () => {
    const data = await runLoad();

    const entry = data.timingStatus.find((t) => t.medicationId === "med-fixed");
    expect(entry).toBeDefined();
    expect(typeof entry!.minutesUntilDue).toBe("number");
    expect(["ok", "due_soon", "due_now", "overdue"]).toContain(entry!.status);
  });

  it("does not invent a timing entry for PRN medications", async () => {
    const data = await runLoad();
    expect(data.timingStatus.find((t) => t.medicationId === "med-prn")).toBeUndefined();
  });
});
