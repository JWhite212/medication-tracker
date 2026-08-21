import { describe, it, expect, vi, beforeEach } from "vitest";

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real tables.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { medications, medicationSchedules, auditLogs } from "$lib/server/db/schema";

type Op =
  | { kind: "select"; table: string }
  | { kind: "update"; table: string; values: unknown }
  | { kind: "delete"; table: string }
  | { kind: "insert"; table: string; values: unknown };

// The durable view. The existence-check select runs BEFORE the transaction,
// so it sits outside the rollback mark and survives — which is what the
// `ops[0].kind === "select"` assertions on the failure paths rely on.
function ops(): Op[] {
  return fakeDb.committed.map((c) => ({ kind: c.op, table: c.table, values: c.payload }) as Op);
}

const beforeRow = {
  id: "med1",
  userId: "u1",
  name: "Old Name",
  dosageAmount: "500",
  dosageUnit: "mg",
};

// What UPDATE ... RETURNING hands back: the before row with the submitted
// fields applied. The old fake computed this from `.set(...)`'s argument;
// seeding it statically is equivalent for `baseInput`. It has to differ from
// beforeRow or computeChanges finds nothing and the audit insert never runs.
const afterRow = { ...beforeRow, name: "New Name", dosageAmount: "1000", dosageUnit: "IU" };

const { updateMedicationWithSchedules } = await import("../../src/lib/server/medications");

const baseInput = {
  name: "New Name",
  dosageAmount: "1000",
  dosageUnit: "IU",
  form: "tablet" as const,
  category: "supplement" as const,
  colour: "#f59e0b",
  pattern: "solid" as const,
  scheduleType: "scheduled" as const,
  scheduleIntervalHours: undefined,
  // Required on MedicationInput because the Zod fields carry defaults.
  notificationsEnabled: true,
  notifyOverdueEmail: null,
  notifyOverduePush: null,
  notifyLowInventoryEmail: null,
  notifyLowInventoryPush: null,
};

beforeEach(() => {
  fakeDb.reset();
  // The existence check finds the medication unless a test says otherwise.
  fakeDb.seed(medications, [beforeRow]);
  fakeDb.seedReturning(medications, [afterRow]);
});

describe("updateMedicationWithSchedules", () => {
  it("updates medication, replaces schedules, and writes audit in a single transaction", async () => {
    await updateMedicationWithSchedules("u1", "med1", baseInput, [
      { scheduleKind: "interval", intervalHours: 8 },
    ]);

    // First select runs BEFORE the transaction (the existence check).
    // Inside the transaction: update meds, delete schedules, insert
    // schedules, insert audit.
    const txOps = ops().slice(1);
    expect(txOps.map((o) => `${o.kind}:${o.table}`)).toEqual([
      "update:medications",
      "delete:medication_schedules",
      "insert:medication_schedules",
      "insert:audit_logs",
    ]);
  });

  it("returns null without touching the DB when the medication does not exist", async () => {
    fakeDb.seed(medications, []);
    const result = await updateMedicationWithSchedules("u1", "missing", baseInput, []);
    expect(result).toBeNull();
    // Only the existence-check select should have run.
    expect(ops()).toHaveLength(1);
    expect(ops()[0].kind).toBe("select");
  });

  it("rolls back the entire transaction when the schedules insert throws", async () => {
    fakeDb.failNext("insert", {
      table: medicationSchedules,
      error: new Error("schedule constraint failed"),
    });

    await expect(
      updateMedicationWithSchedules("u1", "med1", baseInput, [
        { scheduleKind: "interval", intervalHours: 8 },
      ]),
    ).rejects.toThrow("schedule constraint failed");

    // Snapshot rollback restores ops to the pre-transaction state
    // (the existence check select).
    expect(ops()).toHaveLength(1);
    expect(ops()[0].kind).toBe("select");
  });

  it("rolls back the transaction when the audit insert throws", async () => {
    fakeDb.failNext("insert", { table: auditLogs, error: new Error("audit table down") });

    await expect(
      updateMedicationWithSchedules("u1", "med1", baseInput, [{ scheduleKind: "prn" }]),
    ).rejects.toThrow("audit table down");

    expect(ops()).toHaveLength(1);
    expect(ops()[0].kind).toBe("select");
  });

  it("skips the schedules insert when the new schedules array is empty", async () => {
    await updateMedicationWithSchedules("u1", "med1", baseInput, []);
    const tables = ops()
      .slice(1)
      .map((o) => `${o.kind}:${o.table}`);
    expect(tables).toEqual([
      "update:medications",
      "delete:medication_schedules",
      "insert:audit_logs",
    ]);
  });
});
