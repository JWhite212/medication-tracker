import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { medicationSchedules } from "$lib/server/db/schema";

// The database comes from the shared seam, which dispatches on real table
// identity.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

// Schedule rows the reads return.
const selectRows: Array<Record<string, unknown>> = [];

function pushSelectRows(...rows: Record<string, unknown>[]) {
  selectRows.push(...rows);
  syncSeeds();
}

function syncSeeds() {
  fakeDb.seed(medicationSchedules, [...selectRows]);
}

const { getSchedulesForUser, getSchedulesForMedication, buildScheduleRows } =
  await import("../../src/lib/server/schedules");

beforeEach(() => {
  fakeDb.reset();
  selectRows.length = 0;
  syncSeeds();
});

describe("getSchedulesForUser", () => {
  it("groups rows by medicationId", async () => {
    pushSelectRows(
      { id: "s1", medicationId: "med-A", userId: "u", scheduleKind: "interval" },
      { id: "s2", medicationId: "med-A", userId: "u", scheduleKind: "fixed_time" },
      { id: "s3", medicationId: "med-B", userId: "u", scheduleKind: "prn" },
    );

    const map = await getSchedulesForUser("u");
    expect(map.get("med-A")).toHaveLength(2);
    expect(map.get("med-B")).toHaveLength(1);
  });

  it("returns empty map when no rows", async () => {
    const map = await getSchedulesForUser("u");
    expect(map.size).toBe(0);
  });
});

describe("getSchedulesForMedication", () => {
  it("returns rows for a single medication", async () => {
    pushSelectRows(
      { id: "s1", medicationId: "med-A", userId: "u", scheduleKind: "fixed_time", sortOrder: 0 },
      { id: "s2", medicationId: "med-A", userId: "u", scheduleKind: "fixed_time", sortOrder: 1 },
    );
    const rows = await getSchedulesForMedication("med-A", "u");
    expect(rows).toHaveLength(2);
  });
});

// `buildScheduleRows` is the one owner of the per-kind row shape, shared by
// `createMedicationWithSchedules` and `updateMedicationWithSchedules`. These
// cases used to run through `replaceSchedulesForMedication`, a dead wrapper
// that was deleted; the shape they pin is unchanged.
describe("buildScheduleRows", () => {
  it("builds one row per schedule, in order, under the given ids", () => {
    const rows = buildScheduleRows("u", "med-A", [
      { scheduleKind: "interval", intervalHours: 8 },
      { scheduleKind: "prn" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      medicationId: "med-A",
      userId: "u",
      scheduleKind: "interval",
      intervalHours: "8",
      timeOfDay: null,
      daysOfWeek: null,
      sortOrder: 0,
    });
    expect(rows[1]).toMatchObject({
      scheduleKind: "prn",
      intervalHours: null,
      timeOfDay: null,
      sortOrder: 1,
    });
    expect(rows[0].id).not.toBe(rows[1].id);
  });

  it("returns no rows for an empty schedule list", () => {
    expect(buildScheduleRows("u", "med-A", [])).toEqual([]);
  });

  it("preserves daysOfWeek for fixed_time rows", () => {
    const rows = buildScheduleRows("u", "med-A", [
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [1, 3, 5] },
    ]);
    expect(rows[0].timeOfDay).toBe("08:00");
    expect(rows[0].daysOfWeek).toEqual([1, 3, 5]);
  });

  it("nulls daysOfWeek when empty array", () => {
    const rows = buildScheduleRows("u", "med-A", [
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [] },
    ]);
    expect(rows[0].daysOfWeek).toBeNull();
  });
});
