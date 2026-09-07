// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Logging a dose and deleting it again must leave the stock where it started.
 *
 * It did not. `logDose` deducts with `GREATEST(0, count - quantity)` — it
 * cannot take more than there is — while `deleteDose` gave back the full
 * logged `quantity`. Every dose logged against insufficient stock therefore
 * MINTED the difference on deletion, and `updateDose` carried the same
 * asymmetry with no deletion involved at all.
 *
 * These live on PGlite and not on `fake-db` for a reason worth stating: the
 * fake stores the Drizzle SQL node verbatim and answers reads from its seed,
 * so it never evaluates `GREATEST(0, …)`. Deleting that clamp from
 * production code leaves the entire fake-backed suite green — every existing
 * "clamp" assertion is about a recorded payload object, not a resulting
 * count. The arithmetic is decided by the database, so the test has to be.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { eq } from "drizzle-orm";

const { logDose, deleteDose, updateDose } = await import("../../../src/lib/server/doses");

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
}

async function appliedFor(doseId: string): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ a: doseLogs.inventoryApplied })
    .from(doseLogs)
    .where(eq(doseLogs.id, doseId));
  return row?.a ?? null;
}

async function ledger() {
  return pgDb.db
    .select({
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .orderBy(inventoryEvents.createdAt);
}

async function seedStock(count: number | null) {
  await pgDb.seedMedication({ id: "m1", name: "Tracked", inventoryCount: count });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
});

describe("log-then-delete is an exact round trip", () => {
  it("restores only what was taken when the clamp engaged", async () => {
    // The headline case: only 1 dose was actually available, so only 1 left
    // the bottle. Restoring 3 invented two doses of stock.
    await seedStock(1);
    const dose = await logDose("u1", "m1", 3);
    expect(await stock()).toBe(0);

    await deleteDose("u1", dose.id);

    expect(await stock()).toBe(1);
  });

  it("mints nothing at zero stock with the default quantity", async () => {
    // The REACHABLE case, and the one a fixture built only around
    // "quantity 3 against stock 1" would let a broken fix walk past: the
    // dashboard's one-click log button sends quantity 1, and a medication
    // sitting at 0 is the natural end state of tracking inventory. Undoing
    // that click used to leave a dose in the bottle that was never there.
    await seedStock(0);
    const dose = await logDose("u1", "m1", 1);
    expect(await stock()).toBe(0);

    await deleteDose("u1", dose.id);

    expect(await stock()).toBe(0);
  });

  it("restores only the affordable dose when two were logged against one", async () => {
    await seedStock(1);
    const first = await logDose("u1", "m1", 1);
    const second = await logDose("u1", "m1", 1);
    expect(await stock()).toBe(0);

    await deleteDose("u1", first.id);
    await deleteDose("u1", second.id);

    expect(await stock()).toBe(1);
  });

  it("does not amplify across many doses logged against an empty bottle", async () => {
    await seedStock(0);
    const doses = [];
    for (let i = 0; i < 5; i++) doses.push(await logDose("u1", "m1", 10));

    for (const d of doses) await deleteDose("u1", d.id);

    // Fifty doses of phantom stock, from five logs against nothing.
    expect(await stock()).toBe(0);
  });

  it("control: a round trip entirely within stock is unchanged", async () => {
    await seedStock(10);
    const dose = await logDose("u1", "m1", 3);
    expect(await stock()).toBe(7);

    await deleteDose("u1", dose.id);

    expect(await stock()).toBe(10);
  });
});

describe("editing a dose moves only what it applied", () => {
  it("does not mint when a clamped dose's quantity is lowered", async () => {
    // A second door onto the same defect, with no deletion anywhere:
    // `GREATEST(0, 0 - (1 - 3))` credited two doses that never left.
    await seedStock(1);
    const dose = await logDose("u1", "m1", 3);
    expect(await stock()).toBe(0);

    await updateDose("u1", dose.id, { quantity: 1 });

    expect(await stock()).toBe(0);
    expect(await appliedFor(dose.id)).toBe(1);
  });

  it("is a round trip when a quantity is raised past stock and corrected back", async () => {
    await seedStock(10);
    const dose = await logDose("u1", "m1", 2);
    expect(await stock()).toBe(8);

    await updateDose("u1", dose.id, { quantity: 20 });
    expect(await stock()).toBe(0);

    await updateDose("u1", dose.id, { quantity: 2 });
    expect(await stock()).toBe(8);

    await deleteDose("u1", dose.id);
    expect(await stock()).toBe(10);
  });

  it("still deducts normally when a quantity is raised within stock", async () => {
    await seedStock(10);
    const dose = await logDose("u1", "m1", 2);

    await updateDose("u1", dose.id, { quantity: 5 });

    expect(await stock()).toBe(5);
    expect(await appliedFor(dose.id)).toBe(5);
  });
});

describe("medications that do not track inventory", () => {
  it("applies nothing, records nothing, and stays null", async () => {
    await seedStock(null);
    const dose = await logDose("u1", "m1", 3);

    expect(await stock()).toBeNull();
    expect(await appliedFor(dose.id)).toBe(0);
    expect(await ledger()).toHaveLength(0);

    await deleteDose("u1", dose.id);
    expect(await stock()).toBeNull();
  });
});

describe("rows written before the column existed", () => {
  it("falls back to the logged quantity, i.e. the old behaviour", async () => {
    // The guarantee for the `drizzle-kit push` path, where the migration's
    // backfill UPDATEs are skipped and every historical row keeps a NULL.
    // Degrading to today's behaviour is correct; restoring 0 would be the
    // same class of bug in the opposite direction.
    await seedStock(5);
    await pgDb.seedDose({
      id: "legacy",
      medicationId: "m1",
      quantity: 2,
      status: "taken",
      inventoryApplied: null,
    });

    await deleteDose("u1", "legacy");

    expect(await stock()).toBe(7);
  });
});

describe("the ledger tells the same story as the column", () => {
  it("sums to the live count, with a contiguous previous/new chain", async () => {
    await seedStock(1);
    const dose = await logDose("u1", "m1", 3);
    await deleteDose("u1", dose.id);

    const rows = await ledger();
    const start = 1;
    const summed = rows.reduce((acc, r) => acc + r.quantityChange, start);

    expect(summed).toBe(await stock());
    // And each event begins where the last one ended.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].previousCount).toBe(rows[i - 1].newCount);
    }
    // The delete gives back exactly what the log took.
    expect(rows[0].quantityChange).toBe(-1);
    expect(rows[1].quantityChange).toBe(1);
  });
});
