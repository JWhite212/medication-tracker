import { describe, it, expect, vi, beforeEach } from "vitest";

import { fakeDb } from "../helpers/fake-db";
import { medications } from "$lib/server/db/schema";

/**
 * `wipeArchivedMedications` on the fake seam.
 *
 * `wipeDoseHistory`'s cases live in `tests/unit/pg/dose-trash-wipe.test.ts`.
 * It now locks the user's medications with a select `.for("update")` before
 * it deletes anything (D7), and this fake has no select `.for()` and must not
 * grow one (CLAUDE.md, test-seam rule). On PGlite its order is pinned by the
 * SQL it sends, and its rollback by what Postgres still holds afterwards.
 */

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

const { wipeArchivedMedications } = await import("../../../src/lib/server/api/wipe");

beforeEach(() => {
  fakeDb.reset();
  auditCalls.length = 0;
  logAudit.mockClear();
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
