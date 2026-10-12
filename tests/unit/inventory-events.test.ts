import { describe, it, expect, vi, beforeEach } from "vitest";

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real tables.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { medications } from "$lib/server/db/schema";

type Insert = { table: string; values: unknown };

// `attempted`, not `committed`: this module's transaction is a pass-through
// and nothing here simulates a mid-transaction failure, so the two views
// agree — attempted is the one that matches the old fake exactly.
function inserts(): Insert[] {
  return fakeDb.attempted
    .filter((c) => c.op === "insert")
    .map((c) => ({ table: c.table, values: c.payload }));
}

const {
  recordInventoryEvent,
  refillMedication,
  adjustInventory,
  InvalidRefillQuantityError,
  InvalidAdjustmentError,
} = await import("../../src/lib/server/inventory-events");

beforeEach(() => {
  fakeDb.reset();
});

// What stays here is what never reaches the database: `recordInventoryEvent`
// takes its client as an argument, and the input checks throw before the
// transaction opens. Every case that reads the medication moved to
// `tests/unit/pg/inventory-events.test.ts` when that read became
// `FOR UPDATE` (D7): this fake has no select `.for()` and must not grow one.

describe("recordInventoryEvent", () => {
  it("inserts a row with the supplied event payload", async () => {
    const client = fakeDb.db as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "dose_taken",
      quantityChange: -1,
      previousCount: 30,
      newCount: 29,
    });

    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].table).toBe("inventory_events");
    const row = inserts()[0].values as Record<string, unknown>;
    expect(row.userId).toBe("u1");
    expect(row.eventType).toBe("dose_taken");
    expect(row.quantityChange).toBe(-1);
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(29);
    expect(row.note).toBeNull();
  });

  it("preserves the supplied note when present", async () => {
    const client = fakeDb.db as unknown as Parameters<typeof recordInventoryEvent>[0];
    await recordInventoryEvent(client, {
      userId: "u1",
      medicationId: "med-A",
      eventType: "refill",
      quantityChange: 30,
      previousCount: 5,
      newCount: 35,
      note: "picked up at pharmacy",
    });
    const row = inserts()[0].values as Record<string, unknown>;
    expect(row.note).toBe("picked up at pharmacy");
  });
});

describe("refillMedication", () => {
  it("rejects non-positive integer quantities", async () => {
    await expect(refillMedication("u1", "med-A", 0)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", -3)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
    await expect(refillMedication("u1", "med-A", 1.5)).rejects.toBeInstanceOf(
      InvalidRefillQuantityError,
    );
  });
});

describe("adjustInventory", () => {
  it("rejects negative or non-integer new counts", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 5 }]);
    await expect(adjustInventory("u1", "med-A", -1)).rejects.toBeInstanceOf(InvalidAdjustmentError);
    await expect(adjustInventory("u1", "med-A", 4.2)).rejects.toBeInstanceOf(
      InvalidAdjustmentError,
    );
  });
});
