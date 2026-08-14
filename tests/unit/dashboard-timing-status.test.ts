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

// Drizzle `numeric` columns arrive in JS as strings, so a stored "0"
// legacy interval passed the old `!== null && !== undefined` filter and
// was handed straight to computeTimingStatus (which has no internal
// guard): a 0-hour interval collapses nextDueAt to lastEventAt, so any
// dose logged more than a minute ago reads "overdue" forever.
const zeroIntervalMed = {
  ...fixedTimeMed,
  id: "med-zero-interval",
  name: "ZeroIntervalMed",
  scheduleIntervalHours: "0",
};

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
  getActiveMedications: async () => [fixedTimeMed, prnMed, zeroIntervalMed],
}));
vi.mock("$lib/server/inventory", () => ({ getRefillForecast: async () => [] }));
vi.mock("$lib/server/schedules", () => ({
  getSchedulesForUser: async () =>
    new Map([
      ["med-fixed", [fixedSchedule]],
      ["med-prn", [prnSchedule]],
      // No entry for med-zero-interval: it has no medication_schedules
      // row, so it cannot fall back to the slot-derived timing either —
      // exactly the pre-migration shape the legacy column exists for.
    ]),
}));
vi.mock("$lib/server/doses", () => ({
  getTodaysDoses: async () => [],
  getLastDosePerMedication: async () => [
    // Dosed 5 minutes ago against a stored "0" interval. Under the old
    // guard this computed nextDueAt === lastEventAt, i.e. already 5
    // minutes overdue.
    {
      medicationId: "med-zero-interval",
      lastTakenAt: new Date(Date.now() - 5 * 60_000),
      lastEventAt: new Date(Date.now() - 5 * 60_000),
    },
  ],
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

describe("dashboard timingStatus for a zero legacy interval", () => {
  it('does not report a dose logged 5 minutes ago as overdue against a stored "0" interval', async () => {
    const data = await runLoad();
    const entry = data.timingStatus.find((t) => t.medicationId === "med-zero-interval");
    // Excluded rather than badged: a 0-hour interval carries no usable
    // rate, and this medication has no medication_schedules row to fall
    // back on, so no badge is the honest answer. The old code fed
    // Number("0") straight into computeTimingStatus and reported this
    // "overdue" on every load.
    expect(entry).toBeUndefined();
  });
});
