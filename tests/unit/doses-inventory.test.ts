import { describe, it, expect, beforeEach, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { medications, doseLogs, inventoryEvents, syncTombstones } from "$lib/server/db/schema";

// The database comes from the shared seam. This file reads `attempted`, not
// `committed`: its transaction is a pass-through, and what these tests check
// is how far execution got before a simulated failure — a write that was
// tried still counts, even though a real database would have rolled it back.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";

// Recorded traffic carries table NAMES; map them back to the real table
// objects so every assertion below still reads `u.table === medications`.
const tableByName = new Map<string, unknown>(
  [medications, doseLogs, inventoryEvents, syncTombstones].map((t) => [
    getTableName(t),
    t as unknown,
  ]),
);

function opsOf(kind: "update" | "delete" | "insert") {
  return fakeDb.attempted
    .filter((c) => c.op === kind)
    .map((c) => ({ table: tableByName.get(c.table), values: c.payload }));
}
const updates = () => opsOf("update");
const inserts = () => opsOf("insert");

// What a select returns. The old fake was table-agnostic — one primed row
// answered every select — so both tables that get read are seeded with it,
// preserving that behaviour exactly rather than narrowing it here.
function seedSelect(row: Record<string, unknown> | undefined) {
  const rows = row ? [row] : [];
  fakeDb.seed(medications, rows);
  fakeDb.seed(doseLogs, rows);
}

// logAudit calls observed via the audit module mock — used to verify
// that audit-log writes do NOT happen on a rolled-back transaction.
const auditCalls: Array<{ entityType: string; action: string }> = [];

vi.mock("$lib/server/audit", () => ({
  logAudit: async (_userId: string, entityType: string, _entityId: string, action: string) => {
    auditCalls.push({ entityType, action });
  },
  computeChanges: () => null,
}));

const { logDose, updateDose } = await import("../../src/lib/server/doses");

beforeEach(() => {
  fakeDb.reset();
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

// deleteDose's cases moved to tests/unit/pg/dose-delete-trash.test.ts.
// Whether its DELETE … RETURNING found a row decides everything it writes,
// and it locks the medication with a select `.for()`, which this fake does
// not have and must not grow (CLAUDE.md, test-seam rule).

describe("updateDose — status-aware inventory diff", () => {
  it("applies inventory diff when editing TAKEN dose quantity", async () => {
    seedSelect(takenDose({ quantity: 1 }));
    fakeDb.seedReturning(doseLogs, [takenDose({ quantity: 2 })]);
    await updateDose("u1", "d1", { quantity: 2 });
    expect(updates().some((u) => u.table === medications)).toBe(true);
    expect(updates().some((u) => u.table === doseLogs)).toBe(true);
  });

  it("does NOT apply inventory diff when editing SKIPPED dose quantity", async () => {
    seedSelect(skippedDose({ quantity: 1 }));
    fakeDb.seedReturning(doseLogs, [skippedDose({ quantity: 2 })]);
    await updateDose("u1", "d1", { quantity: 2 });
    expect(updates().some((u) => u.table === medications)).toBe(false);
    expect(updates().some((u) => u.table === doseLogs)).toBe(true);
  });

  it("no inventory diff when quantity is unchanged on a TAKEN dose", async () => {
    seedSelect(takenDose({ quantity: 2 }));
    fakeDb.seedReturning(doseLogs, [takenDose({ quantity: 2 })]);
    await updateDose("u1", "d1", { quantity: 2, notes: "edited note" });
    expect(updates().some((u) => u.table === medications)).toBe(false);
  });

  it("returns null when the dose does not exist", async () => {
    seedSelect(undefined);
    const result = await updateDose("u1", "missing", { quantity: 5 });
    expect(result).toBeNull();
    expect(updates()).toHaveLength(0);
  });
});

describe("transactional atomicity (Phase 2.1)", () => {
  it("logDose rolls back: a failed inventory decrement skips the audit log entirely", async () => {
    // Ownership check passes (assertMedicationBelongsToUser does a
    // SELECT that returns the medication row).
    seedSelect({ id: "m1" });
    // Make the medications UPDATE inside the transaction throw —
    // simulates a concurrent constraint violation or network blip.
    fakeDb.failNext("update", {
      table: medications,
      error: new Error("simulated update failure"),
    });

    await expect(logDose("u1", "m1", 1)).rejects.toThrow("simulated update failure");

    // Both writes were attempted inside the transaction (the mock
    // recorded the update call before the simulated throw).
    expect(updates().some((u) => u.table === medications)).toBe(true);
    // CRITICAL: the audit log was NOT called — logAudit is now called
    // INSIDE dbTx.transaction(...), after the inventory update, so the
    // throw happens before that call is ever reached. In a real DB, the
    // dose insert, inventory update, and (had it been reached) the audit
    // row are all rolled back together.
    expect(auditCalls).toEqual([]);
  });

  it("updateDose rolls back: an inventory diff failure skips the audit log", async () => {
    seedSelect(takenDose({ quantity: 1 }));
    fakeDb.seedReturning(doseLogs, [takenDose({ quantity: 2 })]);
    fakeDb.failNext("update", {
      table: medications,
      error: new Error("simulated update failure"),
    });

    await expect(updateDose("u1", "d1", { quantity: 2 })).rejects.toThrow(
      "simulated update failure",
    );

    expect(auditCalls).toEqual([]);
  });
});

describe("inventory event recording", () => {
  it("logs a dose_taken event when a TAKEN dose is recorded against tracked inventory", async () => {
    seedSelect({ id: "m1", inventoryCount: 30 });
    await logDose("u1", "m1", 1);

    const events = inserts().filter((i) => i.table === inventoryEvents);
    expect(events).toHaveLength(1);
    const row = events[0].values as Record<string, unknown>;
    expect(row.eventType).toBe("dose_taken");
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(29);
    expect(row.quantityChange).toBe(-1);
  });

  it("does NOT record an event when the medication has no inventory tracking", async () => {
    seedSelect({ id: "m1", inventoryCount: null });
    await logDose("u1", "m1", 1);
    expect(inserts().filter((i) => i.table === inventoryEvents)).toHaveLength(0);
  });

  it("logs a dose_quantity_updated event when a TAKEN dose's quantity changes", async () => {
    seedSelect({
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
    });
    fakeDb.seedReturning(doseLogs, [takenDose({ quantity: 2 })]);
    await updateDose("u1", "d1", { quantity: 2 });

    const events = inserts().filter((i) => i.table === inventoryEvents);
    expect(events).toHaveLength(1);
    const row = events[0].values as Record<string, unknown>;
    expect(row.eventType).toBe("dose_quantity_updated");
    expect(row.quantityChange).toBe(-1);
  });
});

describe("sync-aware mutations (Task 2)", () => {
  it("updateDose bumps updatedAt", async () => {
    seedSelect(takenDose({ quantity: 1 }));
    fakeDb.seedReturning(doseLogs, [takenDose({ quantity: 2 })]);
    await updateDose("u1", "d1", { quantity: 2 });

    const doseUpdate = updates().find((u) => u.table === doseLogs);
    expect(doseUpdate?.values).toHaveProperty("updatedAt");
  });
});
