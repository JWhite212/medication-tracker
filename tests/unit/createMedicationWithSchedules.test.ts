import { describe, it, expect, vi, beforeEach } from "vitest";

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real tables.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { medicationSchedules, auditLogs } from "$lib/server/db/schema";

type Insert = { table: string; values: unknown };

// The durable view: what a database would still show once the transaction
// resolved. `committed` is truncated when the callback throws, which is
// exactly what the rollback assertions below check.
function inserts(): Insert[] {
  return fakeDb.committed
    .filter((c) => c.op === "insert")
    .map((c) => ({ table: c.table, values: c.payload }));
}

const { createMedicationWithSchedules } = await import("../../src/lib/server/medications");

const baseInput = {
  name: "Vitamin D",
  dosageAmount: "1000",
  dosageUnit: "IU",
  form: "tablet" as const,
  category: "supplement" as const,
  colour: "#f59e0b",
  pattern: "solid" as const,
  scheduleType: "scheduled" as const,
  // The legacy column is still required by MedicationInput's type
  // until we drop it (post P3 cycle); leave it undefined to mirror a
  // PRN form submit.
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
});

describe("createMedicationWithSchedules", () => {
  it("inserts medication, schedules, and audit row in one transaction", async () => {
    await createMedicationWithSchedules("u1", baseInput, [
      { scheduleKind: "interval", intervalHours: 8 },
    ]);

    const tables = inserts().map((i) => i.table);
    expect(tables).toEqual(["medications", "medication_schedules", "audit_logs"]);

    const med = inserts()[0].values as { userId: string; name: string };
    expect(med.userId).toBe("u1");
    expect(med.name).toBe("Vitamin D");

    const schedules = inserts()[1].values as Array<{ scheduleKind: string; intervalHours: string }>;
    expect(schedules).toHaveLength(1);
    expect(schedules[0].scheduleKind).toBe("interval");
    expect(schedules[0].intervalHours).toBe("8");

    const audit = inserts()[2].values as { entityType: string; action: string };
    expect(audit.entityType).toBe("medication");
    expect(audit.action).toBe("create");
  });

  it("rolls back the medication insert when the schedule insert throws", async () => {
    fakeDb.failNext("insert", {
      table: medicationSchedules,
      error: new Error("constraint failed"),
    });

    await expect(
      createMedicationWithSchedules("u1", baseInput, [
        { scheduleKind: "interval", intervalHours: 8 },
      ]),
    ).rejects.toThrow("constraint failed");

    // The mock transaction wrapper restores the inserts array on
    // throw, mirroring Postgres's all-or-nothing semantics.
    expect(inserts()).toHaveLength(0);
  });

  it("rolls back medication + schedules when the audit insert throws", async () => {
    fakeDb.failNext("insert", { table: auditLogs, error: new Error("audit table down") });

    await expect(
      createMedicationWithSchedules("u1", baseInput, [{ scheduleKind: "prn" }]),
    ).rejects.toThrow("audit table down");

    expect(inserts()).toHaveLength(0);
  });

  it("skips the schedule insert when the schedules array is empty", async () => {
    await createMedicationWithSchedules("u1", baseInput, []);

    const tables = inserts().map((i) => i.table);
    expect(tables).toEqual(["medications", "audit_logs"]);
  });
});

describe("createMedicationWithSchedules — notification settings", () => {
  it("persists the overrides on the inserted row", async () => {
    await createMedicationWithSchedules(
      "u1",
      { ...baseInput, notificationsEnabled: false, notifyOverdueEmail: true },
      [],
    );

    const med = inserts()[0].values as Record<string, unknown>;
    expect(med.notificationsEnabled).toBe(false);
    expect(med.notifyOverdueEmail).toBe(true);
  });

  it("keeps null distinct from false on the way to the database", async () => {
    // A `?? false` or `|| null` in the enumeration would collapse the
    // tri-state at the last possible moment, after every other layer
    // took care to preserve it.
    await createMedicationWithSchedules(
      "u1",
      { ...baseInput, notifyOverduePush: null, notifyLowInventoryEmail: false },
      [],
    );

    const med = inserts()[0].values as Record<string, unknown>;
    expect(med.notifyOverduePush).toBeNull();
    expect(med.notifyLowInventoryEmail).toBe(false);
  });
});
