import { describe, it, expect, vi, beforeEach } from "vitest";

type Op =
  | { kind: "select"; table: string }
  | { kind: "update"; table: string; values: unknown }
  | { kind: "delete"; table: string }
  | { kind: "insert"; table: string; values: unknown };

const ops: Op[] = [];
let nextThrows: { onKind: Op["kind"]; onTable: string; error: Error } | null = null;
let medExists = true;

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
  doseLogs: {},
  users: {},
  userPreferences: {},
  pushSubscriptions: {},
  reminderEvents: {},
}));

const beforeRow = {
  id: "med1",
  userId: "u1",
  name: "Old Name",
  dosageAmount: "500",
  dosageUnit: "mg",
};

function maybeThrow(kind: Op["kind"], table: string) {
  if (nextThrows && nextThrows.onKind === kind && nextThrows.onTable === table) {
    const err = nextThrows.error;
    nextThrows = null;
    throw err;
  }
}

function buildClient() {
  return {
    select: () => ({
      from: (tableRef: object) => ({
        where: () => ({
          limit: () => {
            const tableName = tableNames.get(tableRef) ?? "unknown";
            ops.push({ kind: "select", table: tableName });
            if (tableName === "medications" && !medExists) return Promise.resolve([]);
            return Promise.resolve([beforeRow]);
          },
        }),
      }),
    }),
    update: (tableRef: object) => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: () => {
            const tableName = tableNames.get(tableRef) ?? "unknown";
            maybeThrow("update", tableName);
            ops.push({ kind: "update", table: tableName, values });
            if (tableName === "medications" && !medExists) return Promise.resolve([]);
            return Promise.resolve([{ ...beforeRow, ...(values as object) }]);
          },
        }),
      }),
    }),
    delete: (tableRef: object) => ({
      where: () => {
        const tableName = tableNames.get(tableRef) ?? "unknown";
        maybeThrow("delete", tableName);
        ops.push({ kind: "delete", table: tableName });
        return Promise.resolve();
      },
    }),
    insert: (tableRef: object) => ({
      values: (rows: unknown) => {
        const tableName = tableNames.get(tableRef) ?? "unknown";
        maybeThrow("insert", tableName);
        ops.push({ kind: "insert", table: tableName, values: rows });
        return Promise.resolve();
      },
    }),
  };
}

vi.mock("$lib/server/db", () => {
  const client = buildClient();
  return {
    db: client,
    dbTx: {
      transaction: async <T>(cb: (tx: ReturnType<typeof buildClient>) => Promise<T>) => {
        // Mirror Postgres all-or-nothing: snapshot ops at entry,
        // restore on throw.
        const snapshot = ops.slice();
        try {
          return await cb(client);
        } catch (err) {
          ops.length = 0;
          for (const o of snapshot) ops.push(o);
          throw err;
        }
      },
    },
  };
});

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
};

beforeEach(() => {
  ops.length = 0;
  nextThrows = null;
  medExists = true;
});

describe("updateMedicationWithSchedules", () => {
  it("updates medication, replaces schedules, and writes audit in a single transaction", async () => {
    await updateMedicationWithSchedules("u1", "med1", baseInput, [
      { scheduleKind: "interval", intervalHours: 8 },
    ]);

    // First select runs BEFORE the transaction (the existence check).
    // Inside the transaction: update meds, delete schedules, insert
    // schedules, insert audit.
    const txOps = ops.slice(1);
    expect(txOps.map((o) => `${o.kind}:${o.table}`)).toEqual([
      "update:medications",
      "delete:medication_schedules",
      "insert:medication_schedules",
      "insert:audit_logs",
    ]);
  });

  it("returns null without touching the DB when the medication does not exist", async () => {
    medExists = false;
    const result = await updateMedicationWithSchedules("u1", "missing", baseInput, []);
    expect(result).toBeNull();
    // Only the existence-check select should have run.
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("select");
  });

  it("rolls back the entire transaction when the schedules insert throws", async () => {
    nextThrows = {
      onKind: "insert",
      onTable: "medication_schedules",
      error: new Error("schedule constraint failed"),
    };

    await expect(
      updateMedicationWithSchedules("u1", "med1", baseInput, [
        { scheduleKind: "interval", intervalHours: 8 },
      ]),
    ).rejects.toThrow("schedule constraint failed");

    // Snapshot rollback restores ops to the pre-transaction state
    // (the existence check select).
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("select");
  });

  it("rolls back the transaction when the audit insert throws", async () => {
    nextThrows = {
      onKind: "insert",
      onTable: "audit_logs",
      error: new Error("audit table down"),
    };

    await expect(
      updateMedicationWithSchedules("u1", "med1", baseInput, [{ scheduleKind: "prn" }]),
    ).rejects.toThrow("audit table down");

    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("select");
  });

  it("skips the schedules insert when the new schedules array is empty", async () => {
    await updateMedicationWithSchedules("u1", "med1", baseInput, []);
    const tables = ops.slice(1).map((o) => `${o.kind}:${o.table}`);
    expect(tables).toEqual([
      "update:medications",
      "delete:medication_schedules",
      "insert:audit_logs",
    ]);
  });
});
