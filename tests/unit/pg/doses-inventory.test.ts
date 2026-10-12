// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `logDose` and `updateDose`: status-aware stock bookkeeping, the ledger,
 * the sync cursor, and all-or-nothing commits.
 *
 * Moved from the fake-db file `tests/unit/doses-inventory.test.ts` when both
 * functions began reading the medication row `FOR UPDATE` (D7): the fake has
 * no select `.for()` and must not grow one (CLAUDE.md, test-seam rule). The
 * move also makes every assertion stronger. The fake answered each read from
 * one seed and recorded payloads, so "restores inventory" meant "an UPDATE
 * was attempted". Here it means the count the database holds afterwards,
 * and "rolled back" means Postgres rolled it back.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { logDose, updateDose } = await import("../../../src/lib/server/doses");

/** The frozen clock. `updatedAt` and `loggedAt` read it. */
const NOW = new Date("2026-05-01T09:00:00.000Z");

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
}

async function doseRow(id: string) {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
  return row;
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
    .orderBy(asc(inventoryEvents.createdAt));
}

async function auditActions(): Promise<string[]> {
  const rows = await pgDb.db.select({ action: auditLogs.action }).from(auditLogs);
  return rows.map((r) => r.action);
}

/**
 * Make every INSERT into `audit_logs` raise. The audit row is the LAST write
 * of both functions, so a failure there proves the writes before it roll
 * back with it: a real failure inside the real transaction, judged by what
 * Postgres still holds afterwards. `afterEach` drops it.
 */
async function failAuditInserts(): Promise<void> {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
    CREATE TRIGGER test_fail_write BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_write();
  `);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(async () => {
  vi.useRealTimers();
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
});

describe("updateDose — status-aware inventory diff", () => {
  it("moves stock by the change in what a TAKEN dose applies", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await stock()).toBe(9);
    expect(await doseRow("d1")).toMatchObject({ quantity: 2, inventoryApplied: 2 });
  });

  it("leaves stock alone when a SKIPPED dose's quantity is edited", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "skipped", quantity: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await stock()).toBe(10);
    expect((await doseRow("d1")).quantity).toBe(2);
    expect(await ledger()).toEqual([]);
  });

  it("leaves stock alone when a TAKEN dose's quantity is unchanged", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 2, inventoryApplied: 2 });

    await updateDose("u1", "d1", { quantity: 2, notes: "edited note" });

    expect(await stock()).toBe(10);
    expect((await doseRow("d1")).notes).toBe("edited note");
    expect(await ledger()).toEqual([]);
  });

  it("returns null and writes nothing when the dose does not exist", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });

    await expect(updateDose("u1", "missing", { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(await auditActions()).toEqual([]);
  });
});

describe("transactional atomicity", () => {
  it("logDose commits nothing when its last write fails", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await failAuditInserts();

    await expect(logDose("u1", "m1", 1)).rejects.toThrow(/insert into "audit_logs"/);

    // The dose row, the decrement and the ledger event were all written
    // before the audit insert failed, and none of them survived it.
    expect(await pgDb.db.select().from(doseLogs)).toEqual([]);
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });

  it("updateDose commits nothing when its last write fails", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });
    await failAuditInserts();

    await expect(updateDose("u1", "d1", { quantity: 2 })).rejects.toThrow(
      /insert into "audit_logs"/,
    );

    expect(await doseRow("d1")).toMatchObject({ quantity: 1, inventoryApplied: 1 });
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });
});

describe("inventory event recording", () => {
  it("records dose_taken when a TAKEN dose is logged against tracked stock", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });

    await logDose("u1", "m1", 1);

    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 30, newCount: 29 },
    ]);
  });

  it("records no event when the medication does not track stock", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: null });

    await logDose("u1", "m1", 1);

    expect(await ledger()).toEqual([]);
    expect(await stock()).toBeNull();
  });

  it("records dose_quantity_updated when a TAKEN dose's quantity changes", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 30 });
    await pgDb.seedDose({ id: "d1", status: "taken", quantity: 1, inventoryApplied: 1 });

    await updateDose("u1", "d1", { quantity: 2 });

    expect(await ledger()).toEqual([
      { eventType: "dose_quantity_updated", quantityChange: -1, previousCount: 30, newCount: 29 },
    ]);
  });
});

describe("sync-aware mutations", () => {
  it("updateDose bumps updatedAt", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedDose({
      id: "d1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
      updatedAt: new Date("2026-04-01T00:00:00.000Z"),
    });

    await updateDose("u1", "d1", { quantity: 2 });

    expect((await doseRow("d1")).updatedAt).toEqual(NOW);
  });
});
