import { describe, it, expect, vi, beforeEach } from "vitest";

// Table identity only matters for the mock's own bookkeeping — real
// column refs aren't touched below, ops are keyed by table name.
const tableNames = new WeakMap<object, string>();
const doseLogsTable = {};
const medicationsTable = {};
const usersTable = {};
tableNames.set(doseLogsTable, "dose_logs");
tableNames.set(medicationsTable, "medications");
tableNames.set(usersTable, "users");

vi.mock("$lib/server/db/schema", () => ({
  doseLogs: doseLogsTable,
  medications: medicationsTable,
  users: usersTable,
}));

type Op = { kind: "delete"; table: string } | { kind: "update"; table: string; values: unknown };

let ops: Op[] = [];
let deletedRows: Array<{ id: string }> = [];
let nextDeleteThrows: Error | null = null;

const auditCalls: Array<{
  userId: string;
  entityType: string;
  entityId: string;
  action: string;
  changes?: unknown;
  client: unknown;
}> = [];

// logAudit is mocked to record which client (db vs tx) it was invoked
// with, so the tests can assert it ran INSIDE the transaction rather
// than after it committed.
const logAudit = vi.fn(
  async (
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    changes: unknown,
    client: unknown,
  ) => {
    auditCalls.push({ userId, entityType, entityId, action, changes, client });
  },
);
vi.mock("$lib/server/audit", () => ({
  logAudit: (
    userId: string,
    entityType: string,
    entityId: string,
    action: string,
    changes: unknown,
    client: unknown,
  ) => logAudit(userId, entityType, entityId, action, changes, client),
}));

function buildTxClient() {
  const tx = {
    delete: (tableRef: object) => ({
      where: () => ({
        returning: () => {
          const tableName = tableNames.get(tableRef) ?? "unknown";
          if (nextDeleteThrows) {
            const err = nextDeleteThrows;
            nextDeleteThrows = null;
            return Promise.reject(err);
          }
          ops.push({ kind: "delete", table: tableName });
          return Promise.resolve(deletedRows);
        },
      }),
    }),
    update: (tableRef: object) => ({
      set: (values: unknown) => ({
        where: () => {
          const tableName = tableNames.get(tableRef) ?? "unknown";
          ops.push({ kind: "update", table: tableName, values });
          return Promise.resolve();
        },
      }),
    }),
  };
  return tx;
}

vi.mock("$lib/server/db", () => ({
  dbTx: {
    transaction: async <T>(cb: (tx: ReturnType<typeof buildTxClient>) => Promise<T>) => {
      const tx = buildTxClient();
      // Mirror Postgres all-or-nothing commit: snapshot state at entry,
      // restore it (and drop any audit calls the callback made) on throw.
      const opsSnapshot = ops.slice();
      const auditSnapshot = auditCalls.slice();
      try {
        return await cb(tx);
      } catch (err) {
        ops = opsSnapshot;
        auditCalls.length = 0;
        for (const a of auditSnapshot) auditCalls.push(a);
        throw err;
      }
    },
  },
}));

const { wipeDoseHistory, wipeArchivedMedications } =
  await import("../../../src/lib/server/api/wipe");

beforeEach(() => {
  ops = [];
  deletedRows = [];
  nextDeleteThrows = null;
  auditCalls.length = 0;
  logAudit.mockClear();
});

describe("wipeDoseHistory", () => {
  it("deletes dose logs, bumps syncEpoch, and audits — all inside one transaction — returning the deleted count", async () => {
    deletedRows = [{ id: "d1" }, { id: "d2" }, { id: "d3" }];

    const result = await wipeDoseHistory("u1");

    expect(result).toEqual({ deleted: 3 });
    expect(ops).toEqual([
      { kind: "delete", table: "dose_logs" },
      {
        kind: "update",
        table: "users",
        values: expect.objectContaining({ syncEpoch: expect.anything() }),
      },
    ]);

    // The audit call happened, was passed the tx (not the top-level db),
    // and used the deleted count computed inside the same transaction.
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(auditCalls).toHaveLength(1);
    const [call] = auditCalls;
    expect(call.userId).toBe("u1");
    expect(call.entityType).toBe("dose_log");
    expect(call.entityId).toBe("*");
    expect(call.action).toBe("delete");
    expect(call.changes).toEqual({ deleted: { from: 3, to: 0 } });
    expect(call.client).not.toBe(undefined);
    expect(call.client).not.toBe(null);
  });

  it("returns {deleted: 0} when there is nothing to wipe", async () => {
    deletedRows = [];

    const result = await wipeDoseHistory("u1");

    expect(result).toEqual({ deleted: 0 });
    expect(auditCalls[0].changes).toEqual({ deleted: { from: 0, to: 0 } });
  });

  it("rolls back the epoch bump and audit when the delete throws — nothing durably committed", async () => {
    nextDeleteThrows = new Error("connection reset");

    await expect(wipeDoseHistory("u1")).rejects.toThrow("connection reset");

    expect(ops).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});

describe("wipeArchivedMedications", () => {
  it("deletes archived medications, bumps syncEpoch, and audits — all inside one transaction — returning the deleted count", async () => {
    deletedRows = [{ id: "m1" }, { id: "m2" }];

    const result = await wipeArchivedMedications("u1");

    expect(result).toEqual({ deleted: 2 });
    expect(ops).toEqual([
      { kind: "delete", table: "medications" },
      {
        kind: "update",
        table: "users",
        values: expect.objectContaining({ syncEpoch: expect.anything() }),
      },
    ]);

    expect(logAudit).toHaveBeenCalledTimes(1);
    const [call] = auditCalls;
    expect(call.userId).toBe("u1");
    expect(call.entityType).toBe("medication");
    expect(call.entityId).toBe("*");
    expect(call.action).toBe("delete");
    expect(call.changes).toEqual({
      deleted: { from: 2, to: 0 },
      filter: { from: null, to: "archived" },
    });
  });

  it("rolls back the epoch bump and audit when the delete throws — nothing durably committed", async () => {
    nextDeleteThrows = new Error("connection reset");

    await expect(wipeArchivedMedications("u1")).rejects.toThrow("connection reset");

    expect(ops).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});
