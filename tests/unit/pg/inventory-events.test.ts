// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * `refillMedication` and `adjustInventory` against real Postgres.
 *
 * Moved from the fake-db file `tests/unit/inventory-events.test.ts` when both
 * began reading the medication row `FOR UPDATE` (D7, spec item 13): the fake
 * has no select `.for()` and must not grow one. The input-validation cases
 * that throw before any query stay in the fake file. Here each result is
 * checked against the count and the ledger row the database holds.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { medications, inventoryEvents } from "../../../src/lib/server/db/schema";
import { eq } from "drizzle-orm";

const { refillMedication, adjustInventory, MedicationNotFoundError, InvalidAdjustmentError } =
  await import("../../../src/lib/server/inventory-events");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function events() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
      note: inventoryEvents.note,
    })
    .from(inventoryEvents);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

/** Another user's medication, for the ownership cases. */
async function seedOtherUsersMedication() {
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 5 });
}

describe("refillMedication", () => {
  it("throws MedicationNotFoundError for a medication the user does not own, and writes nothing", async () => {
    await seedOtherUsersMedication();

    await expect(refillMedication("u1", "m2", 30)).rejects.toBeInstanceOf(MedicationNotFoundError);
    expect(await stock("m2")).toBe(5);
    expect(await events()).toEqual([]);
  });

  it("adds the refill and records previous and new counts", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 5 });

    const result = await refillMedication("u1", "m1", 30, "pharmacy run");

    expect(result).toEqual({ previousCount: 5, newCount: 35 });
    expect(await stock()).toBe(35);
    expect(await events()).toEqual([
      {
        eventType: "refill",
        quantityChange: 30,
        previousCount: 5,
        newCount: 35,
        note: "pharmacy run",
      },
    ]);
  });

  it("seeds the count from null when inventory tracking was never enabled", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    const result = await refillMedication("u1", "m1", 30);

    expect(result).toEqual({ previousCount: null, newCount: 30 });
    expect(await stock()).toBe(30);
    expect(await events()).toEqual([
      { eventType: "refill", quantityChange: 30, previousCount: null, newCount: 30, note: null },
    ]);
  });
});

describe("adjustInventory", () => {
  it("throws MedicationNotFoundError for a medication the user does not own, and writes nothing", async () => {
    await seedOtherUsersMedication();

    await expect(adjustInventory("u1", "m2", 10)).rejects.toBeInstanceOf(MedicationNotFoundError);
    expect(await stock("m2")).toBe(5);
    expect(await events()).toEqual([]);
  });

  it("rejects an adjustment that equals the current count, and writes nothing", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 12 });

    await expect(adjustInventory("u1", "m1", 12)).rejects.toBeInstanceOf(InvalidAdjustmentError);
    expect(await events()).toEqual([]);
  });

  it("records the signed delta when the count decreases", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });

    const result = await adjustInventory("u1", "m1", 26, "spilled 4 pills");

    expect(result).toEqual({ previousCount: 30, newCount: 26, quantityChange: -4 });
    expect(await stock()).toBe(26);
    expect(await events()).toEqual([
      {
        eventType: "manual_adjustment",
        quantityChange: -4,
        previousCount: 30,
        newCount: 26,
        note: "spilled 4 pills",
      },
    ]);
  });

  it("records a positive delta when the count increases", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 5 });

    const result = await adjustInventory("u1", "m1", 12);

    expect(result.quantityChange).toBe(7);
    expect(await stock()).toBe(12);
    expect(await events()).toEqual([
      {
        eventType: "manual_adjustment",
        quantityChange: 7,
        previousCount: 5,
        newCount: 12,
        note: null,
      },
    ]);
  });

  it("treats a null previous count as 0 when computing the delta", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    const result = await adjustInventory("u1", "m1", 30);

    expect(result).toEqual({ previousCount: null, newCount: 30, quantityChange: 30 });
    expect(await stock()).toBe(30);
  });
});
