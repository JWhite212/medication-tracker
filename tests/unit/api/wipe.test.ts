import { describe, it, expect, vi, beforeEach } from "vitest";

import { fakeDb } from "../helpers/fake-db";
import { doseLogs, medications } from "$lib/server/db/schema";

type Op = { kind: "delete"; table: string } | { kind: "update"; table: string; values: unknown };

// The durable view: what a database would still show after the transaction
// resolved. fakeDb.committed is truncated when the callback throws, so a
// rolled-back run reports [] exactly as the hand-rolled snapshot did.
function ops(): Op[] {
  return fakeDb.committed.map((c) =>
    c.op === "delete"
      ? { kind: "delete", table: c.table }
      : { kind: c.op as "update", table: c.table, values: c.payload },
  );
}

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

// Database traffic rolls back through the shared seam's `committed` view.
// `auditCalls` does NOT: logAudit is mocked at module level, so its calls are
// not database traffic and `committed` structurally cannot see them. That one
// array keeps a local snapshot here rather than teaching the shared fake about
// arbitrary mocked modules.
vi.mock("$lib/server/db", async () => {
  const { fakeDb: fake } = await import("../helpers/fake-db");
  return {
    db: fake.db,
    dbTx: {
      async transaction<T>(cb: (tx: typeof fake.db) => Promise<T>): Promise<T> {
        const auditSnapshot = auditCalls.slice();
        try {
          return await fake.dbTx.transaction(cb);
        } catch (err) {
          auditCalls.length = 0;
          for (const a of auditSnapshot) auditCalls.push(a);
          throw err;
        }
      },
    },
  };
});

const { wipeDoseHistory, wipeArchivedMedications } =
  await import("../../../src/lib/server/api/wipe");

beforeEach(() => {
  fakeDb.reset();
  auditCalls.length = 0;
  logAudit.mockClear();
});

describe("wipeDoseHistory", () => {
  it("deletes dose logs, bumps syncEpoch, and audits — all inside one transaction — returning the deleted count", async () => {
    fakeDb.seed(doseLogs, [{ id: "d1" }, { id: "d2" }, { id: "d3" }]);

    const result = await wipeDoseHistory("u1");

    expect(result).toEqual({ deleted: 3 });
    expect(ops()).toEqual([
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
    fakeDb.seed(doseLogs, []);

    const result = await wipeDoseHistory("u1");

    expect(result).toEqual({ deleted: 0 });
    expect(auditCalls[0].changes).toEqual({ deleted: { from: 0, to: 0 } });
  });

  it("rolls back the epoch bump and audit when the delete throws — nothing durably committed", async () => {
    fakeDb.failNext("delete", { error: new Error("connection reset") });

    await expect(wipeDoseHistory("u1")).rejects.toThrow("connection reset");

    expect(ops()).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});

describe("wipeArchivedMedications", () => {
  it("deletes archived medications, bumps syncEpoch, and audits — all inside one transaction — returning the deleted count", async () => {
    fakeDb.seed(medications, [{ id: "m1" }, { id: "m2" }]);

    const result = await wipeArchivedMedications("u1");

    expect(result).toEqual({ deleted: 2 });
    expect(ops()).toEqual([
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
    fakeDb.failNext("delete", { error: new Error("connection reset") });

    await expect(wipeArchivedMedications("u1")).rejects.toThrow("connection reset");

    expect(ops()).toEqual([]);
    expect(auditCalls).toEqual([]);
  });
});
