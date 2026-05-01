import { describe, it, expect, beforeEach, vi } from "vitest";
import { medications, doseLogs } from "$lib/server/db/schema";

// What db.select(...).limit(1) returns. Tests prime this before calling
// the function under test to simulate "the dose row that exists in the DB".
let nextSelectRow: Record<string, unknown> | undefined;

// What db.update(doseLogs)...returning() returns from updateDose.
let nextUpdatedRow: Record<string, unknown> | undefined;

// Operations recorded by the mock so tests can assert what was called.
const updates: Array<{ table: unknown }> = [];
const deletes: Array<{ table: unknown }> = [];

vi.mock("$lib/server/db", () => ({
  db: {
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
      const setChain = {
        where: () => {
          const whereChain = {
            returning: () => Promise.resolve(nextUpdatedRow ? [nextUpdatedRow] : []),
            then: (onFulfilled: (v: unknown) => unknown) =>
              Promise.resolve().then(() => onFulfilled(undefined)),
          };
          return whereChain;
        },
      };
      return { set: () => setChain };
    },
    delete: (table: unknown) => {
      deletes.push({ table });
      return {
        where: () => Promise.resolve(),
      };
    },
    insert: () => ({
      // For logAudit: db.insert(auditLogs).values(...) must be awaitable.
      values: () => Promise.resolve(),
    }),
  },
}));

const { deleteDose, updateDose } = await import("../../src/lib/server/doses");

beforeEach(() => {
  nextSelectRow = undefined;
  nextUpdatedRow = undefined;
  updates.length = 0;
  deletes.length = 0;
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
