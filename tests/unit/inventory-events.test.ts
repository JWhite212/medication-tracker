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
  MedicationNotFoundError,
} = await import("../../src/lib/server/inventory-events");

beforeEach(() => {
  fakeDb.reset();
});

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

  it("throws MedicationNotFoundError when the medication doesn't belong to the user", async () => {
    fakeDb.seed(medications, []);
    await expect(refillMedication("u1", "missing", 30)).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("records a refill event with previous and new counts on success", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 5 }]);
    const result = await refillMedication("u1", "med-A", 30, "pharmacy run");
    expect(result).toEqual({ previousCount: 5, newCount: 35 });

    const eventInsert = inserts().find((i) => i.table === "inventory_events");
    expect(eventInsert).toBeDefined();
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.eventType).toBe("refill");
    expect(row.quantityChange).toBe(30);
    expect(row.previousCount).toBe(5);
    expect(row.newCount).toBe(35);
    expect(row.note).toBe("pharmacy run");
  });

  it("seeds the count from null when inventory tracking was never enabled", async () => {
    fakeDb.seed(medications, [{ inventoryCount: null }]);
    const result = await refillMedication("u1", "med-A", 30);
    expect(result).toEqual({ previousCount: null, newCount: 30 });
    const eventInsert = inserts().find((i) => i.table === "inventory_events");
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.previousCount).toBeNull();
    expect(row.newCount).toBe(30);
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

  it("throws MedicationNotFoundError when the medication is not owned by the user", async () => {
    fakeDb.seed(medications, []);
    await expect(adjustInventory("u1", "missing", 10)).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("rejects an adjustment that equals the current count (no-op)", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 12 }]);
    await expect(adjustInventory("u1", "med-A", 12)).rejects.toBeInstanceOf(InvalidAdjustmentError);
  });

  it("records a manual_adjustment event with the signed delta when count decreases", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 30 }]);
    const result = await adjustInventory("u1", "med-A", 26, "spilled 4 pills");
    expect(result).toEqual({ previousCount: 30, newCount: 26, quantityChange: -4 });

    const eventInsert = inserts().find((i) => i.table === "inventory_events");
    expect(eventInsert).toBeDefined();
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.eventType).toBe("manual_adjustment");
    expect(row.quantityChange).toBe(-4);
    expect(row.previousCount).toBe(30);
    expect(row.newCount).toBe(26);
    expect(row.note).toBe("spilled 4 pills");
  });

  it("records a positive delta when count increases (e.g. found extra stock)", async () => {
    fakeDb.seed(medications, [{ inventoryCount: 5 }]);
    const result = await adjustInventory("u1", "med-A", 12);
    expect(result.quantityChange).toBe(7);
    const eventInsert = inserts().find((i) => i.table === "inventory_events");
    const row = eventInsert!.values as Record<string, unknown>;
    expect(row.quantityChange).toBe(7);
    expect(row.note).toBeNull();
  });

  it("treats a null previousCount as 0 when computing the delta", async () => {
    fakeDb.seed(medications, [{ inventoryCount: null }]);
    const result = await adjustInventory("u1", "med-A", 30);
    expect(result).toEqual({ previousCount: null, newCount: 30, quantityChange: 30 });
  });
});
