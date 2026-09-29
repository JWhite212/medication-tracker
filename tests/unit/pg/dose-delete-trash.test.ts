// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * `deleteDose` moves a dose into `dose_log_trash` (spec Section 1, "Deleting
 * a dose"; decisions D7 and D8).
 *
 * The database decides the outcome. Whether `DELETE … RETURNING` came back
 * with a row is what stops a second, overlapping delete from crediting stock
 * again, and the purge's `FOR UPDATE SKIP LOCKED` is SQL. `fake-db` evaluates
 * neither and has no select `.for()`, so these tests live on PGlite
 * (CLAUDE.md, test-seam rule).
 *
 * PGlite is one backend and serialises transactions. Nothing here runs two
 * deletes at once, and no test claims a race. Instead, the LOSING side of a
 * race is staged: `beforeMedicationLock` runs SQL inside the delete's own
 * transaction just before its medication `FOR UPDATE`. That is exactly the
 * state the loser reads once the winner has committed and released the lock.
 * The lock itself is pinned by its SQL in `queryLog`.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { db } from "$lib/server/db";
import { pgDb, queryLog } from "../helpers/pg-db";
import {
  auditLogs,
  doseLogs,
  doseLogTrash,
  inventoryEvents,
  medications,
  syncTombstones,
} from "../../../src/lib/server/db/schema";
import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";
import { asc, eq } from "drizzle-orm";

const { deleteDose, purgeExpiredTrash } = await import("../../../src/lib/server/doses");

/** The frozen clock. `deletedAt` reads it unless a test moves it. */
const NOW = new Date("2026-08-01T12:00:00.000Z");
/** Where the clock-after-lock test moves the clock, at the lock. */
const LATER = new Date("2026-08-01T12:00:05.000Z");
/** A trash row with `deleted_at <= CUTOFF` has expired. `restoreDose` uses the same rule. */
const CUTOFF = new Date(NOW.getTime() - DOSE_UNDO_WINDOW_MS);

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
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

async function trashRows() {
  return pgDb.db.select().from(doseLogTrash).orderBy(asc(doseLogTrash.id));
}

async function trashIds(): Promise<string[]> {
  return (await trashRows()).map((r) => r.id);
}

async function tombstones() {
  return pgDb.db
    .select({ entityType: syncTombstones.entityType, entityId: syncTombstones.entityId })
    .from(syncTombstones);
}

async function auditRows() {
  return pgDb.db
    .select({ entityId: auditLogs.entityId, action: auditLogs.action, changes: auditLogs.changes })
    .from(auditLogs);
}

async function doseExists(id: string): Promise<boolean> {
  const rows = await pgDb.db.select({ id: doseLogs.id }).from(doseLogs).where(eq(doseLogs.id, id));
  return rows.length > 0;
}

function isMedicationLock(q: string): boolean {
  return /from "medications"/i.test(q) && /for update/i.test(q);
}

/** A medication `m1` holding `stockCount`, and one dose `d1` of it: taken ×1, applied 1. */
async function seedTakenDose(
  stockCount: number | null,
  dose: Partial<typeof doseLogs.$inferInsert> = {},
) {
  await pgDb.seedMedication({ id: "m1", inventoryCount: stockCount });
  await pgDb.seedDose({
    id: "d1",
    medicationId: "m1",
    status: "taken",
    quantity: 1,
    inventoryApplied: 1,
    ...dose,
  });
}

type RawTx = {
  query: (sql: string, params?: unknown[], options?: unknown) => Promise<unknown>;
};

/**
 * Runs `stage` inside the NEXT transaction, immediately before that
 * transaction's first medications `FOR UPDATE`.
 *
 * Drizzle's PGlite session opens every transaction through
 * `pgDb.client.transaction` and runs each statement through the transaction
 * object's `query`. Wrapping that `query` lets the test write through the
 * same transaction at the moment the lock is requested. A delete that
 * started when the dose existed, then waited for the lock while another
 * request deleted or edited the dose and committed, sees the same thing.
 */
function beforeMedicationLock(stage: (tx: RawTx) => unknown) {
  const original = pgDb.client.transaction.bind(pgDb.client);
  return vi.spyOn(pgDb.client, "transaction").mockImplementationOnce(((
    callback: (tx: unknown) => Promise<unknown>,
  ) =>
    original(async (tx) => {
      const raw = tx as unknown as RawTx;
      const query = raw.query;
      let staged = false;
      raw.query = async (sql, params, options) => {
        if (!staged && isMedicationLock(sql)) {
          staged = true;
          await stage({ query });
        }
        return query(sql, params, options);
      };
      return callback(tx);
    })) as never);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only: faking every timer stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("deleteDose — the delete, its credit and its trash row", () => {
  it("copies every dose_logs column but updatedAt into the trash, with what it credited", async () => {
    const takenAt = new Date("2026-08-01T08:00:00.000Z");
    const loggedAt = new Date("2026-08-01T08:02:00.000Z");
    await seedTakenDose(5, {
      quantity: 3,
      inventoryApplied: 2,
      takenAt,
      loggedAt,
      notes: "After breakfast",
      sideEffects: [{ name: "Nausea", severity: "mild" }],
    });

    const result = await deleteDose("u1", "d1", { keepForUndo: true });

    expect(result).toEqual({ doseId: "d1", medicationId: "m1", deletedAt: NOW });
    expect(await doseExists("d1")).toBe(false);
    expect(await trashRows()).toEqual([
      {
        id: "d1",
        userId: "u1",
        medicationId: "m1",
        quantity: 3,
        inventoryApplied: 2,
        inventoryCredited: 2,
        takenAt,
        loggedAt,
        notes: "After breakfast",
        sideEffects: [{ name: "Nausea", severity: "mild" }],
        status: "taken",
        deletedAt: NOW,
      },
    ]);
    // It gives back what the dose took (2), not what it says it took (3).
    expect(await stock()).toBe(7);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 2, previousCount: 5, newCount: 7 },
    ]);
  });

  it("records inventoryCredited 0, and no event, while the medication is not tracking stock", async () => {
    // Logged while tracking was on (it took 2), then tracking was switched
    // off. The delete gives nothing back, so a restore must take nothing.
    await seedTakenDose(null, { quantity: 2, inventoryApplied: 2 });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await stock()).toBeNull();
    expect(await ledger()).toEqual([]);
    expect(await trashRows()).toMatchObject([
      { id: "d1", inventoryApplied: 2, inventoryCredited: 0 },
    ]);
  });

  it.each(["skipped", "missed"] as const)(
    "gives nothing back for a %s dose and trashes it with inventoryCredited 0",
    async (status) => {
      await seedTakenDose(10, { status, inventoryApplied: null });

      await deleteDose("u1", "d1", { keepForUndo: true });

      expect(await stock()).toBe(10);
      expect(await ledger()).toEqual([]);
      expect(await trashRows()).toMatchObject([
        { id: "d1", status, inventoryApplied: null, inventoryCredited: 0 },
      ]);
    },
  );

  it("keepForUndo: false still deletes, credits, tombstones and audits, but keeps no trash row", async () => {
    // D8: the Mac app's delete_dose and a create's Undo. Nobody can undo them.
    await seedTakenDose(9);

    const result = await deleteDose("u1", "d1", { keepForUndo: false });

    expect(result).toEqual({ doseId: "d1", medicationId: "m1", deletedAt: NOW });
    expect(await doseExists("d1")).toBe(false);
    expect(await stock()).toBe(10);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([{ entityType: "dose_log", entityId: "d1" }]);
    expect(await auditRows()).toEqual([{ entityId: "d1", action: "delete", changes: null }]);
  });

  it("writes one tombstone and one delete audit row whose diff carries no note text", async () => {
    await seedTakenDose(9, { notes: "Private: felt dizzy" });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await tombstones()).toEqual([{ entityType: "dose_log", entityId: "d1" }]);
    const audit = await auditRows();
    expect(audit).toEqual([{ entityId: "d1", action: "delete", changes: null }]);
    expect(JSON.stringify(audit)).not.toContain("felt dizzy");
  });

  it("returns null and writes nothing for a missing dose or another user's", async () => {
    await pgDb.seedMedication({ id: "m1", inventoryCount: 10 });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 10 });
    await pgDb.seedDose({
      id: "theirs",
      userId: "u2",
      medicationId: "m2",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });

    expect(await deleteDose("u1", "missing", { keepForUndo: true })).toBeNull();
    expect(await deleteDose("u1", "theirs", { keepForUndo: true })).toBeNull();

    expect(await doseExists("theirs")).toBe(true);
    expect(await stock("m2")).toBe(10);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });
});

describe("two deletes of one dose credit stock once", () => {
  it("a second, sequential delete returns null — one credit, one event, one tombstone, one trash row", async () => {
    await seedTakenDose(9);

    expect(await deleteDose("u1", "d1", { keepForUndo: true })).not.toBeNull();
    expect(await deleteDose("u1", "d1", { keepForUndo: true })).toBeNull();

    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 1, previousCount: 9, newCount: 10 },
    ]);
    expect(await tombstones()).toHaveLength(1);
    expect(await trashIds()).toEqual(["d1"]);
    expect(await auditRows()).toHaveLength(1);
  });

  it("the losing side — its dose gone once it holds the lock — returns null and writes nothing", async () => {
    // The loser read d1 (step 1), then waited on the medication lock while
    // the winner deleted d1 and committed. Remove racing the toast's Undo, a
    // second tab and the Mac app all get here.
    await seedTakenDose(9);
    beforeMedicationLock(({ query }) => query('delete from "dose_logs" where "id" = $1', ["d1"]));

    expect(await deleteDose("u1", "d1", { keepForUndo: true })).toBeNull();

    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([]);
    expect(await trashRows()).toEqual([]);
    expect(await tombstones()).toEqual([]);
    expect(await auditRows()).toEqual([]);
  });

  it("credits what the row holds once the lock is taken — an edit that committed first counts", async () => {
    // Save raised the dose from 1 to 3 and committed (stock 5 → 3) while this
    // delete waited on the medication lock (spec item 4).
    await seedTakenDose(5);
    beforeMedicationLock(async ({ query }) => {
      await query(
        'update "dose_logs" set "quantity" = 3, "inventory_applied" = 3 where "id" = $1',
        ["d1"],
      );
      await query('update "medications" set "inventory_count" = 3 where "id" = $1', ["m1"]);
    });

    await deleteDose("u1", "d1", { keepForUndo: true });

    expect(await stock()).toBe(6);
    expect(await ledger()).toEqual([
      { eventType: "dose_deleted", quantityChange: 3, previousCount: 3, newCount: 6 },
    ]);
    expect(await trashRows()).toMatchObject([
      { id: "d1", quantity: 3, inventoryApplied: 3, inventoryCredited: 3 },
    ]);
  });
});

describe("deleteDose — lock order and the clock (D7)", () => {
  it("locks the medication before any write, and reads dose_logs before it only without a lock", async () => {
    await seedTakenDose(9);
    queryLog.length = 0;

    await deleteDose("u1", "d1", { keepForUndo: true });

    const lock = queryLog.findIndex(isMedicationLock);
    const doseDelete = queryLog.findIndex((q) => /^delete from "dose_logs"/i.test(q));
    const purge = queryLog.findIndex((q) => /^delete from "dose_log_trash"/i.test(q));
    const trashInsert = queryLog.findIndex((q) => /^insert into "dose_log_trash"/i.test(q));
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(doseDelete).toBeGreaterThan(lock);
    expect(purge).toBeGreaterThan(lock);
    expect(trashInsert).toBeGreaterThan(lock);
    // Step 1's read is the only statement on dose_logs before the lock, and
    // it takes no lock itself.
    const beforeLock = queryLog.slice(0, lock).filter((q) => /"dose_logs"/i.test(q));
    expect(beforeLock).toHaveLength(1);
    expect(beforeLock[0]).toMatch(/^select/i);
    expect(beforeLock[0]).not.toMatch(/for update/i);
  });

  it("stamps deletedAt from a clock read after the medication lock", async () => {
    await seedTakenDose(9);
    beforeMedicationLock(() => vi.setSystemTime(LATER));

    const result = await deleteDose("u1", "d1", { keepForUndo: true });

    expect(result?.deletedAt).toEqual(LATER);
    expect(await trashRows()).toMatchObject([{ id: "d1", deletedAt: LATER }]);
  });
});

describe("purgeExpiredTrash", () => {
  it("an on-write purge removes this user's expired rows only", async () => {
    await seedTakenDose(9);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "at-cutoff", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "just-inside", deletedAt: new Date(CUTOFF.getTime() + 1) });
    await pgDb.seedTrash({
      id: "other-user",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(CUTOFF.getTime() - 60_000),
    });

    await deleteDose("u1", "d1", { keepForUndo: true, now: NOW });

    expect(await trashIds()).toEqual(["d1", "just-inside", "other-user"]);
  });

  it("never waits: its row locks skip rows another transaction holds", async () => {
    await seedTakenDose(9);
    queryLog.length = 0;

    await deleteDose("u1", "d1", { keepForUndo: true });

    const purges = queryLog.filter((q) => /^delete from "dose_log_trash"/i.test(q));
    expect(purges).toHaveLength(1);
    expect(purges[0]).toMatch(/for update skip locked/i);
  });

  it("without a userId it purges every user's expired rows — the retention sweep's call", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "u1-expired", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "u2-expired", userId: "u2", medicationId: "m2", deletedAt: CUTOFF });
    await pgDb.seedTrash({ id: "u1-live", deletedAt: new Date(CUTOFF.getTime() + 1) });

    await purgeExpiredTrash(db, { now: NOW });

    expect(await trashIds()).toEqual(["u1-live"]);
  });
});
