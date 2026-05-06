import { describe, it, expect, beforeEach, vi } from "vitest";
import { medications, doseLogs, inventoryEvents } from "$lib/server/db/schema";

// What db.select(...).limit(1) returns. Tests prime this before calling
// the function under test to simulate "the dose row that exists in the DB".
let nextSelectRow: Record<string, unknown> | undefined;

// What db.update(doseLogs)...returning() returns from updateDose.
let nextUpdatedRow: Record<string, unknown> | undefined;

// When set to a Drizzle table identity, the next `update(table)` call
// against that table throws synchronously — used to simulate a mid-
// transaction failure so the rollback path can be tested.
let failOnUpdateOf: unknown | null = null;

// Operations recorded by the mock so tests can assert what was called.
const updates: Array<{ table: unknown }> = [];
const deletes: Array<{ table: unknown }> = [];
const inserts: Array<{ table: unknown; values: unknown }> = [];

// logAudit calls observed via the audit module mock — used to verify
// that audit-log writes do NOT happen on a rolled-back transaction.
const auditCalls: Array<{ entityType: string; action: string }> = [];

vi.mock("$lib/server/audit", () => ({
  logAudit: async (_userId: string, entityType: string, _entityId: string, action: string) => {
    auditCalls.push({ entityType, action });
  },
  computeChanges: () => null,
}));

// Shared chainable mock — used by both `db` (HTTP, for read paths)
// and the `tx` handle yielded by dbTx.transaction. The mocked
// transaction invokes its callback with a fresh chainable that
// records into the same updates/deletes arrays, so test assertions
// don't care which client executed the write.
function buildChainable() {
  return {
    select: () => {
      const chain: Record<string, unknown> = {};
      const passthrough = () => chain;
      chain.from = passthrough;
      chain.where = passthrough;
      chain.limit = () => Promise.resolve(nextSelectRow ? [nextSelectRow] : []);
      return chain;
    },
    update: (table: unknown) => {
      updates.push({ table });
      if (failOnUpdateOf !== null && failOnUpdateOf === table) {
        const err = new Error("simulated update failure");
        const failingChain = {
          returning: () => Promise.reject(err),
          then: (_onFulfilled: unknown, onRejected?: (e: unknown) => unknown) =>
            onRejected ? Promise.resolve().then(() => onRejected(err)) : Promise.reject(err),
        };
        return { set: () => ({ where: () => failingChain }) };
      }
      const whereChain = {
        returning: () => Promise.resolve(nextUpdatedRow ? [nextUpdatedRow] : []),
        then: (onFulfilled: (v: unknown) => unknown) =>
          Promise.resolve().then(() => onFulfilled(undefined)),
      };
      return { set: () => ({ where: () => whereChain }) };
    },
    delete: (table: unknown) => {
      deletes.push({ table });
      return { where: () => Promise.resolve() };
    },
    insert: (table: unknown) => ({
      // Some call sites do .values(...) standalone; logDose chains
      // .values(...).returning() expecting an inserted-row array. The
      // values() return value supports both shapes.
      values: (rows: unknown) => {
        inserts.push({ table, values: rows });
        const valuesChain = {
          returning: () => Promise.resolve([{ id: "stub" }]),
          then: (onFulfilled: (v: unknown) => unknown) =>
            Promise.resolve().then(() => onFulfilled(undefined)),
        };
        return valuesChain;
      },
    }),
  };
}

vi.mock("$lib/server/db", () => ({
  db: buildChainable(),
  dbTx: {
    transaction: <T>(cb: (tx: ReturnType<typeof buildChainable>) => Promise<T>) =>
      cb(buildChainable()),
  },
}));

const { logDose, deleteDose, updateDose } = await import("../../src/lib/server/doses");

beforeEach(() => {
  nextSelectRow = undefined;
  nextUpdatedRow = undefined;
  failOnUpdateOf = null;
  updates.length = 0;
  deletes.length = 0;
  inserts.length = 0;
  auditCalls.length = 0;
});

function takenDose(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "d1",
    userId: "u1",
    medicationId: "m1",
    quantity: 1,
    status: "taken",
    takenAt: new Date("2026-05-01T08:00:00Z"),
    loggedAt: new Date("2026-05-01T08:00:00Z"),
    notes: null,
    sideEffects: null,
    ...overrides,
  };
}

function skippedDose(overrides: Partial<Record<string, unknown>> = {}) {
  return takenDose({ status: "skipped", ...overrides });
}

describe("deleteDose — status-aware inventory restore", () => {
  it("restores inventory when deleting a TAKEN dose", async () => {
    nextSelectRow = takenDose();
    const ok = await deleteDose("u1", "d1");
    expect(ok).toBe(true);
    expect(updates.some((u) => u.table === medications)).toBe(true);
    expect(deletes.some((d) => d.table === doseLogs)).toBe(true);
  });

  it("does NOT restore inventory when deleting a SKIPPED dose", async () => {
    nextSelectRow = skippedDose();
    const ok = await deleteDose("u1", "d1");
    expect(ok).toBe(true);
    expect(updates.some((u) => u.table === medications)).toBe(false);
    expect(deletes.some((d) => d.table === doseLogs)).toBe(true);
  });

  it("does NOT restore inventory when deleting a MISSED dose", async () => {
    nextSelectRow = takenDose({ status: "missed" });
    const ok = await deleteDose("u1", "d1");
    expect(ok).toBe(true);
    expect(updates.some((u) => u.table === medications)).toBe(false);
  });

  it("returns false and does nothing when the dose does not exist", async () => {
    nextSelectRow = undefined;
    const ok = await deleteDose("u1", "missing");
    expect(ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});

describe("updateDose — status-aware inventory diff", () => {
  it("applies inventory diff when editing TAKEN dose quantity", async () => {
    nextSelectRow = takenDose({ quantity: 1 });
    nextUpdatedRow = takenDose({ quantity: 2 });
    await updateDose("u1", "d1", { quantity: 2 });
    expect(updates.some((u) => u.table === medications)).toBe(true);
    expect(updates.some((u) => u.table === doseLogs)).toBe(true);
  });

  it("does NOT apply inventory diff when editing SKIPPED dose quantity", async () => {
    nextSelectRow = skippedDose({ quantity: 1 });
    nextUpdatedRow = skippedDose({ quantity: 2 });
    await updateDose("u1", "d1", { quantity: 2 });
    expect(updates.some((u) => u.table === medications)).toBe(false);
    expect(updates.some((u) => u.table === doseLogs)).toBe(true);
  });

  it("no inventory diff when quantity is unchanged on a TAKEN dose", async () => {
    nextSelectRow = takenDose({ quantity: 2 });
    nextUpdatedRow = takenDose({ quantity: 2 });
    await updateDose("u1", "d1", { quantity: 2, notes: "edited note" });
    expect(updates.some((u) => u.table === medications)).toBe(false);
  });

  it("returns null when the dose does not exist", async () => {
    nextSelectRow = undefined;
    const result = await updateDose("u1", "missing", { quantity: 5 });
    expect(result).toBeNull();
    expect(updates).toHaveLength(0);
  });
});

describe("transactional atomicity (Phase 2.1)", () => {
  it("logDose rolls back: a failed inventory decrement skips the audit log entirely", async () => {
    // Ownership check passes (assertMedicationBelongsToUser does a
    // SELECT that returns the medication row).
    nextSelectRow = { id: "m1" };
    // Make the medications UPDATE inside the transaction throw —
    // simulates a concurrent constraint violation or network blip.
    failOnUpdateOf = medications;

    await expect(logDose("u1", "m1", 1)).rejects.toThrow("simulated update failure");

    // Both writes were attempted inside the transaction (the mock
    // recorded the update call before the simulated throw).
    expect(updates.some((u) => u.table === medications)).toBe(true);
    // CRITICAL: the audit log was NOT called — logAudit runs AFTER
    // dbTx.transaction(...) resolves; a throw bypasses it. In a real
    // DB, the dose insert is also rolled back.
    expect(auditCalls).toEqual([]);
  });

  it("updateDose rolls back: an inventory diff failure skips the audit log", async () => {
    nextSelectRow = takenDose({ quantity: 1 });
    nextUpdatedRow = takenDose({ quantity: 2 });
    failOnUpdateOf = medications;

    await expect(updateDose("u1", "d1", { quantity: 2 })).rejects.toThrow(
      "simulated update failure",
    );

    expect(auditCalls).toEqual([]);
  });
});

describe("inventory event recording", () => {
  it("logs a dose_taken event when a TAKEN dose is recorded against tracked inventory", async () => {
    nextSelectRow = { id: "m1", inventoryCount: 30 };
    await logDose("u1", "m1", 1);

    const events = inserts.filter((i) => i.table === inventoryEvents);
    expect(events).toHaveLength(1);
    const row = events[0].values as Record<string, unknown>;
    expect(row.eventType).toBe("dose_taken");
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(29);
    expect(row.quantityChange).toBe(-1);
  });

  it("does NOT record an event when the medication has no inventory tracking", async () => {
    nextSelectRow = { id: "m1", inventoryCount: null };
    await logDose("u1", "m1", 1);
    expect(inserts.filter((i) => i.table === inventoryEvents)).toHaveLength(0);
  });

  it("logs a dose_deleted event when a TAKEN dose is removed", async () => {
    nextSelectRow = takenDose({ quantity: 1, medicationId: "m1" });
    // The deleteDose path does a fresh select inside the transaction
    // for the inventory snapshot. The mock's select returns the same
    // nextSelectRow shape regardless; previousCount lookup pulls
    // `inventoryCount` from this row, so include it.
    nextSelectRow = {
      id: "d1",
      userId: "u1",
      medicationId: "m1",
      quantity: 1,
      status: "taken",
      takenAt: new Date(),
      loggedAt: new Date(),
      notes: null,
      sideEffects: null,
      inventoryCount: 28,
    };

    await deleteDose("u1", "d1");

    const events = inserts.filter((i) => i.table === inventoryEvents);
    expect(events).toHaveLength(1);
    const row = events[0].values as Record<string, unknown>;
    expect(row.eventType).toBe("dose_deleted");
    expect(row.quantityChange).toBe(1);
  });

  it("does NOT record an event when a SKIPPED dose is removed", async () => {
    nextSelectRow = skippedDose({ quantity: 1 });
    await deleteDose("u1", "d1");
    expect(inserts.filter((i) => i.table === inventoryEvents)).toHaveLength(0);
  });

  it("logs a dose_quantity_updated event when a TAKEN dose's quantity changes", async () => {
    nextSelectRow = {
      id: "d1",
      userId: "u1",
      medicationId: "m1",
      quantity: 1,
      status: "taken",
      takenAt: new Date(),
      loggedAt: new Date(),
      notes: null,
      sideEffects: null,
      inventoryCount: 30,
    };
    nextUpdatedRow = takenDose({ quantity: 2 });
    await updateDose("u1", "d1", { quantity: 2 });

    const events = inserts.filter((i) => i.table === inventoryEvents);
    expect(events).toHaveLength(1);
    const row = events[0].values as Record<string, unknown>;
    expect(row.eventType).toBe("dose_quantity_updated");
    expect(row.quantityChange).toBe(-1);
  });
});
