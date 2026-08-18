import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { medications, medicationSchedules } from "$lib/server/db/schema";

type Insert = { table: string; values: unknown };
type DeleteCall = { table: string };
// Controls the ownership-check lookup; set to [] to simulate
// "medication not owned by this user".

// The database comes from the shared seam, which dispatches on real table
// identity. The old fake told the ownership check apart from the schedule
// reads by sniffing the SELECT projection (`"id" in shape`); the two read
// different tables, so seeding per table replaces that entirely.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const opsOf = (kind: "insert" | "delete") =>
  fakeDb.attempted.filter((c) => c.op === kind).map((c) => ({ table: c.table, values: c.payload }));

const inserts = () => opsOf("insert");
const deletes = () => opsOf("delete");

// Schedule rows the reads return; owner rows the ownership check finds.
const selectRows: Array<Record<string, unknown>> = [];
const ownerRows: Array<{ id: string }> = [];

function pushSelectRows(...rows: Record<string, unknown>[]) {
  selectRows.push(...rows);
  syncSeeds();
}

function syncSeeds() {
  fakeDb.seed(medicationSchedules, [...selectRows]);
  fakeDb.seed(medications, [...ownerRows]);
}

const {
  getSchedulesForUser,
  getSchedulesForMedication,
  replaceSchedulesForMedication,
  MedicationOwnershipError,
} = await import("../../src/lib/server/schedules");

beforeEach(() => {
  fakeDb.reset();
  selectRows.length = 0;
  ownerRows.length = 0;
  ownerRows.push({ id: "med-A" });
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

describe("replaceSchedulesForMedication", () => {
  it("deletes existing schedules then inserts new ones", async () => {
    await replaceSchedulesForMedication("med-A", "u", [
      { scheduleKind: "interval", intervalHours: 8 },
      { scheduleKind: "prn" },
    ]);

    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].table).toMatch(/medication_schedules/);
    expect(inserts()).toHaveLength(1);
    const rows = inserts()[0].values as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0].scheduleKind).toBe("interval");
    expect(rows[0].intervalHours).toBe("8");
    expect(rows[1].scheduleKind).toBe("prn");
  });

  it("skips insert when schedules array is empty", async () => {
    await replaceSchedulesForMedication("med-A", "u", []);
    expect(deletes()).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
  });

  it("preserves daysOfWeek for fixed_time rows", async () => {
    await replaceSchedulesForMedication("med-A", "u", [
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [1, 3, 5] },
    ]);
    const rows = inserts()[0].values as Array<Record<string, unknown>>;
    expect(rows[0].timeOfDay).toBe("08:00");
    expect(rows[0].daysOfWeek).toEqual([1, 3, 5]);
  });

  it("nulls daysOfWeek when empty array", async () => {
    await replaceSchedulesForMedication("med-A", "u", [
      { scheduleKind: "fixed_time", timeOfDay: "08:00", daysOfWeek: [] },
    ]);
    const rows = inserts()[0].values as Array<Record<string, unknown>>;
    expect(rows[0].daysOfWeek).toBeNull();
  });

  it("throws MedicationOwnershipError when medication is not owned by user", async () => {
    ownerRows.length = 0;
    syncSeeds();
    await expect(
      replaceSchedulesForMedication("med-X", "u", [{ scheduleKind: "prn" }]),
    ).rejects.toBeInstanceOf(MedicationOwnershipError);
    expect(deletes()).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });
});
