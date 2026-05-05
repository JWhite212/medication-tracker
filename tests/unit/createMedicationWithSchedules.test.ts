import { describe, it, expect, vi, beforeEach } from "vitest";

type Insert = { table: string; values: unknown };

const inserts: Insert[] = [];
let nextInsertThrows: { onTable: string; error: Error } | null = null;

// Reference identities for the mocked schema tables, so the mock can
// look up which table an insert targets.
const tableNames = new WeakMap<object, string>();
const medicationsTable = {};
const medicationSchedulesTable = {};
const auditLogsTable = {};
tableNames.set(medicationsTable, "medications");
tableNames.set(medicationSchedulesTable, "medication_schedules");
tableNames.set(auditLogsTable, "audit_logs");

vi.mock("$lib/server/db/schema", () => ({
  medications: medicationsTable,
  medicationSchedules: medicationSchedulesTable,
  auditLogs: auditLogsTable,
  // The schema module exports many tables; return placeholders for
  // the ones unrelated to this service so transitive imports do not
  // explode.
  doseLogs: {},
  users: {},
  userPreferences: {},
  pushSubscriptions: {},
  reminderEvents: {},
}));

function buildClient() {
  return {
    insert: (tableRef: object) => {
      const tableName = tableNames.get(tableRef) ?? "unknown";
      let captured: unknown = undefined;
      const values = (rows: unknown) => {
        captured = rows;
        if (nextInsertThrows && nextInsertThrows.onTable === tableName) {
          const err = nextInsertThrows.error;
          nextInsertThrows = null;
          return {
            returning: () => Promise.reject(err),
            then: (_res: unknown, rej?: (e: unknown) => unknown) =>
              Promise.reject(err).catch(rej ?? ((e) => Promise.reject(e))),
            catch: (rej: (e: unknown) => unknown) => Promise.reject(err).catch(rej),
          };
        }
        inserts.push({ table: tableName, values: captured });
        const settled = Promise.resolve();
        const returnedRow =
          tableName === "medications" ? [{ id: (captured as { id: string }).id }] : [];
        return {
          returning: () => Promise.resolve(returnedRow),
          then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            settled.then(res, rej),
          catch: (rej: (e: unknown) => unknown) => settled.catch(rej),
        };
      };
      return { values };
    },
  };
}

vi.mock("$lib/server/db", () => {
  const client = buildClient();
  return {
    db: client,
    dbTx: {
      transaction: async <T>(cb: (tx: ReturnType<typeof buildClient>) => Promise<T>) => {
        // Mirror Postgres's all-or-nothing commit: snapshot the
        // inserts at entry, restore on throw.
        const snapshot = inserts.slice();
        try {
          return await cb(client);
        } catch (err) {
          inserts.length = 0;
          for (const i of snapshot) inserts.push(i);
          throw err;
        }
      },
    },
  };
});

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
};

beforeEach(() => {
  inserts.length = 0;
  nextInsertThrows = null;
});

describe("createMedicationWithSchedules", () => {
  it("inserts medication, schedules, and audit row in one transaction", async () => {
    await createMedicationWithSchedules("u1", baseInput, [
      { scheduleKind: "interval", intervalHours: 8 },
    ]);

    const tables = inserts.map((i) => i.table);
    expect(tables).toEqual(["medications", "medication_schedules", "audit_logs"]);

    const med = inserts[0].values as { userId: string; name: string };
    expect(med.userId).toBe("u1");
    expect(med.name).toBe("Vitamin D");

    const schedules = inserts[1].values as Array<{ scheduleKind: string; intervalHours: string }>;
    expect(schedules).toHaveLength(1);
    expect(schedules[0].scheduleKind).toBe("interval");
    expect(schedules[0].intervalHours).toBe("8");

    const audit = inserts[2].values as { entityType: string; action: string };
    expect(audit.entityType).toBe("medication");
    expect(audit.action).toBe("create");
  });

  it("rolls back the medication insert when the schedule insert throws", async () => {
    nextInsertThrows = { onTable: "medication_schedules", error: new Error("constraint failed") };

    await expect(
      createMedicationWithSchedules("u1", baseInput, [
        { scheduleKind: "interval", intervalHours: 8 },
      ]),
    ).rejects.toThrow("constraint failed");

    // The mock transaction wrapper restores the inserts array on
    // throw, mirroring Postgres's all-or-nothing semantics.
    expect(inserts).toHaveLength(0);
  });

  it("rolls back medication + schedules when the audit insert throws", async () => {
    nextInsertThrows = { onTable: "audit_logs", error: new Error("audit table down") };

    await expect(
      createMedicationWithSchedules("u1", baseInput, [{ scheduleKind: "prn" }]),
    ).rejects.toThrow("audit table down");

    expect(inserts).toHaveLength(0);
  });

  it("skips the schedule insert when the schedules array is empty", async () => {
    await createMedicationWithSchedules("u1", baseInput, []);

    const tables = inserts.map((i) => i.table);
    expect(tables).toEqual(["medications", "audit_logs"]);
  });
});
