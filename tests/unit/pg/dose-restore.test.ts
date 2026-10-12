// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * A delete's Undo: `restoreDose` moves a trashed dose back into `dose_logs`.
 *
 * The database decides every rule here: the `(id, deletedAt)` token match,
 * the window, the since-delete guard, the `GREATEST` clamp, the tombstone
 * cleanup and the cascade from a deleted medication. `fake-db` answers reads
 * from its seed and never evaluates a predicate, so these tests run on
 * PGlite (CLAUDE.md, test-seam rule).
 *
 * PGlite is one backend and serialises transactions, so nothing here is a
 * race. A losing side is covered by seeding the state it would see and
 * calling it sequentially. The lock order is pinned by its SQL.
 *
 * `dose_logs.updatedAt` on insert, `inventory_events.createdAt` and
 * `sync_tombstones.deletedAt` default to Postgres `now()`. PGlite evaluates it
 * from the faked `Date`, at the instant the transaction began, so a column the
 * app did not stamp itself looks right whenever the app's clock and the
 * transaction's start are the same instant. A test that has to tell an
 * app-stamped column from a defaulted one must make the two differ: the round
 * trip passes an explicit `now`, and the clock-order test moves the clock
 * after the transaction has begun.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  auditLogs,
  doseLogs,
  doseLogTrash,
  inventoryEvents,
  medications,
  syncTombstones,
} from "../../../src/lib/server/db/schema";
import { and, asc, eq, getTableColumns } from "drizzle-orm";
import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";
import type { SideEffect } from "../../../src/lib/types";

const { logDose, deleteDose, restoreDose } = await import("../../../src/lib/server/doses");
const { refillMedication, adjustInventory } =
  await import("../../../src/lib/server/inventory-events");
const { buildSyncResponse } = await import("../../../src/lib/server/api/sync");

/** The dose is logged. */
const LOGGED = new Date("2026-04-16T08:00:00.000Z");
/** It is removed. This is the Undo token's `deletedAt`. */
const DELETED = new Date("2026-04-16T08:05:00.000Z");
/** Something else happens to the medication before the Undo. */
const BETWEEN = new Date("2026-04-16T08:05:30.000Z");
/** The Undo arrives, one minute after the delete. */
const RESTORE = new Date("2026-04-16T08:06:00.000Z");

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

async function doseRow(id: string) {
  const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
  return row;
}

async function trashRows() {
  return pgDb.db.select().from(doseLogTrash).orderBy(asc(doseLogTrash.id));
}

async function restoredEvents() {
  return pgDb.db
    .select({
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
    })
    .from(inventoryEvents)
    .where(eq(inventoryEvents.eventType, "dose_restored"));
}

async function tombstonesFor(entityId: string) {
  return pgDb.db
    .select()
    .from(syncTombstones)
    .where(and(eq(syncTombstones.entityType, "dose_log"), eq(syncTombstones.entityId, entityId)));
}

async function seedStock(count: number | null) {
  await pgDb.seedMedication({ id: "m1", name: "Metformin", inventoryCount: count });
}

/**
 * Log a dose at LOGGED and remove it at DELETED, keeping it for Undo.
 * Returns its id, its Undo token and the row as it stood before the delete.
 */
async function logThenDelete(
  opts: { quantity?: number; notes?: string; sideEffects?: SideEffect[] } = {},
) {
  vi.setSystemTime(LOGGED);
  const dose = await logDose(
    "u1",
    "m1",
    opts.quantity ?? 1,
    undefined,
    opts.notes,
    opts.sideEffects,
  );
  const before = await doseRow(dose.id);
  if (!before) throw new Error("fixture: the log wrote nothing");

  vi.setSystemTime(DELETED);
  const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
  if (!deleted) throw new Error("fixture: the delete found nothing");

  return { id: dose.id, token: deleted.deletedAt, before };
}

/** Remove an existing dose at `at`, keeping it for Undo. Returns the token. */
async function deleteAt(id: string, at: Date): Promise<Date> {
  vi.setSystemTime(at);
  const deleted = await deleteDose("u1", id, { keepForUndo: true });
  if (!deleted) throw new Error(`fixture: nothing to delete for ${id}`);
  return deleted.deletedAt;
}

/** A statement that reads the medications table under a row lock. */
const isMedicationLock = (q: string) => /from "medications"/i.test(q) && /for update/i.test(q);

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  // Date only: faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(LOGGED);
  queryLog.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("restoreDose — the round trip", () => {
  it("puts back the same id with every column, and takes the stock again", async () => {
    await seedStock(10);
    const { id, token, before } = await logThenDelete({
      quantity: 2,
      notes: "after food",
      sideEffects: [{ name: "nausea", severity: "mild" }],
    });
    expect(before).toMatchObject({ notes: "after food", loggedAt: LOGGED, inventoryApplied: 2 });
    expect(await stock()).toBe(10);

    // An instant that is not the faked clock, so a row that took Postgres's own
    // `now()` for updated_at cannot pass for one the app stamped.
    const stamped = new Date(RESTORE.getTime() + 1_000);
    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token, stamped)).toBe("restored");

    // Every stored field, loggedAt included. Only the sync cursor moves, so a
    // client that already pulled the tombstone pulls the dose back.
    expect(await doseRow(id)).toEqual({ ...before, updatedAt: stamped });
    expect(await stock()).toBe(8);
    expect(await restoredEvents()).toEqual([
      { quantityChange: -2, previousCount: 10, newCount: 8 },
    ]);
    expect(await trashRows()).toEqual([]);
  });

  it.each(["skipped", "missed"] as const)(
    "puts back a %s entry with every column and no stock change",
    async (status) => {
      await seedStock(10);
      await pgDb.seedDose({
        id: "entry",
        medicationId: "m1",
        status,
        quantity: 1,
        takenAt: LOGGED,
        loggedAt: LOGGED,
      });
      const before = await doseRow("entry");
      const token = await deleteAt("entry", DELETED);

      vi.setSystemTime(RESTORE);
      expect(await restoreDose("u1", "entry", token)).toBe("restored");

      expect(await doseRow("entry")).toEqual({ ...before, updatedAt: RESTORE });
      expect(await stock()).toBe(10);
      expect(await restoredEvents()).toEqual([]);
    },
  );

  it("puts back every column the delete copied, each set away from its default, apart from updatedAt", async () => {
    // A column added to dose_logs later must come back from the trash too:
    // the column-mirror test makes the trash keep it, and restore builds the
    // row from the trash row rather than from a list of names. This fixture
    // gives every nullable or defaulted column a value of its own, and says
    // so below, so a new column fails here until it is set.
    await seedStock(10);
    await pgDb.seedDose({
      id: "every",
      medicationId: "m1",
      quantity: 3,
      inventoryApplied: 2,
      status: "skipped",
      takenAt: new Date("2026-04-16T07:45:00.000Z"),
      loggedAt: LOGGED,
      notes: "before breakfast",
      sideEffects: [{ name: "headache", severity: "moderate" }],
    });
    const before = await doseRow("every");
    if (!before) throw new Error("fixture: nothing seeded");
    for (const [key, column] of Object.entries(getTableColumns(doseLogs))) {
      if (key === "updatedAt") continue;
      const value = before[key as keyof typeof before];
      expect(value, `${key} must be set`).not.toBeNull();
      if (column.hasDefault && typeof column.default !== "object") {
        expect(value, `${key} must differ from its default`).not.toEqual(column.default);
      }
    }
    expect(before.takenAt).not.toEqual(before.loggedAt);
    const token = await deleteAt("every", DELETED);

    const stamped = new Date(RESTORE.getTime() + 1_000);
    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", "every", token, stamped)).toBe("restored");

    expect(await doseRow("every")).toEqual({ ...before, updatedAt: stamped });
  });

  it("answers already_restored to a second restore, and takes stock once", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
    // A retried Undo whose first attempt landed.
    expect(await restoreDose("u1", id, token)).toBe("already_restored");

    expect(await stock()).toBe(9);
    expect(await restoredEvents()).toHaveLength(1);
  });

  it("refuses an older token after a newer delete of the same dose, writing nothing", async () => {
    await seedStock(10);
    const { id, token: first } = await logThenDelete();
    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, first)).toBe("restored");
    const second = await deleteAt(id, new Date("2026-04-16T08:07:00.000Z"));

    // The first toast's Undo, replayed after the second delete.
    vi.setSystemTime(new Date("2026-04-16T08:08:00.000Z"));
    expect(await restoreDose("u1", id, first)).toBe("gone");

    expect(await doseRow(id)).toBeUndefined();
    expect(await stock()).toBe(10);
    expect((await trashRows()).map((t) => t.deletedAt)).toEqual([second]);
  });

  it("refuses another user's restore of the token, writing nothing", async () => {
    await seedStock(10);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    const { id, token } = await logThenDelete();

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u2", id, token)).toBe("gone");
    expect(await doseRow(id)).toBeUndefined();
    expect(await trashRows()).toHaveLength(1);
    expect(await stock()).toBe(10);

    expect(await restoreDose("u1", id, token)).toBe("restored");
  });
});

describe("restoreDose — stock", () => {
  it("clamps the re-take at what is left (stock 1, log 3, delete, adjust to 0)", async () => {
    await seedStock(1);
    const { id, token } = await logThenDelete({ quantity: 3 });
    // The log took the only 1 there was, and the delete gave that 1 back.
    expect(await stock()).toBe(1);
    expect((await trashRows())[0]).toMatchObject({ inventoryApplied: 1, inventoryCredited: 1 });

    vi.setSystemTime(BETWEEN);
    await adjustInventory("u1", "m1", 0);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect(await stock()).toBe(0);
    expect((await doseRow(id))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([{ quantityChange: 0, previousCount: 0, newCount: 0 }]);
  });

  it("takes nothing when tracking is off at the restore", async () => {
    await seedStock(5);
    const { id, token } = await logThenDelete();
    expect(await stock()).toBe(5);

    vi.setSystemTime(BETWEEN);
    await pgDb.db.update(medications).set({ inventoryCount: null }).where(eq(medications.id, "m1"));

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect(await stock()).toBeNull();
    expect((await doseRow(id))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([]);
  });

  it("takes nothing when tracking was off at the delete, even once it is back on", async () => {
    // Logged while tracking was on (it took 2), then tracking was switched off.
    await seedStock(null);
    await pgDb.seedDose({
      id: "d-off",
      medicationId: "m1",
      status: "taken",
      quantity: 2,
      inventoryApplied: 2,
      takenAt: LOGGED,
      loggedAt: LOGGED,
    });
    const token = await deleteAt("d-off", DELETED);
    // Nothing was given back, so nothing may be taken.
    expect((await trashRows())[0]).toMatchObject({ inventoryApplied: 2, inventoryCredited: 0 });

    vi.setSystemTime(BETWEEN);
    await refillMedication("u1", "m1", 10);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", "d-off", token)).toBe("restored");

    expect(await stock()).toBe(10);
    expect((await doseRow("d-off"))?.inventoryApplied).toBe(0);
    expect(await restoredEvents()).toEqual([
      { quantityChange: 0, previousCount: 10, newCount: 10 },
    ]);
  });

  it("leaves a refill intact when the dose was logged at zero stock (Review Focus #2)", async () => {
    await seedStock(0);
    vi.setSystemTime(LOGGED);
    const dose = await logDose("u1", "m1", 1);
    expect(dose.inventoryApplied).toBe(0);

    vi.setSystemTime(new Date("2026-04-16T08:02:00.000Z"));
    await refillMedication("u1", "m1", 30);
    const token = await deleteAt(dose.id, DELETED);
    expect(await stock()).toBe(30);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", dose.id, token)).toBe("restored");

    // The delete credited 0, so the Undo takes 0: the round trip changes nothing.
    expect(await stock()).toBe(30);
  });
});

describe("restoreDose — the medication changes between delete and Undo (Review Focus #5)", () => {
  it("still restores onto an archived medication", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    vi.setSystemTime(BETWEEN);
    await pgDb.db
      .update(medications)
      .set({ isArchived: true, archivedAt: BETWEEN })
      .where(eq(medications.id, "m1"));

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
    expect(await stock()).toBe(9);
  });

  it("is gone once the medication is deleted, because the cascade took the trash row", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // What the archived-medication wipe and import's replace mode do.
    vi.setSystemTime(BETWEEN);
    await pgDb.db.delete(medications).where(eq(medications.id, "m1"));
    expect(await trashRows()).toEqual([]);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("gone");
    expect(await doseRow(id)).toBeUndefined();
  });
});

describe("restoreDose — what else it writes", () => {
  it("writes one restore audit row, and no audit row carries the dose's note", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete({ notes: "private-note-xyzzy" });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    // The audit log is synced to the Mac app and never purged.
    const audits = await pgDb.db.select().from(auditLogs).where(eq(auditLogs.userId, "u1"));
    expect(JSON.stringify(audits)).not.toContain("xyzzy");
    expect(audits.filter((a) => a.action === "restore")).toEqual([
      expect.objectContaining({ entityType: "dose_log", entityId: id, changes: null }),
    ]);
  });

  it("returns the dose and no tombstone to a client whose cursor predates the delete or sits between delete and restore", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();
    // A second tombstone for the same dose, as an earlier delete of it would leave.
    await pgDb.seedTombstone({ entityId: id, deletedAt: DELETED });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    // Every one, not just the latest. The Mac app applies upserts before
    // tombstones within one delta, so a survivor would delete the restored
    // dose there for good.
    expect(await tombstonesFor(id)).toEqual([]);

    const beforeTheDelete = new Date("2026-04-16T08:04:00.000Z");
    for (const since of [beforeTheDelete, BETWEEN]) {
      const res = await buildSyncResponse("u1", since.toISOString(), 0);
      expect(res.fullResync).toBe(false);
      expect(res.doseLogs.map((d) => d.id)).toContain(id);
      expect(res.tombstones.filter((t) => t.entityId === id)).toEqual([]);
    }
  });

  it("purges this user's expired trash, and nobody else's", async () => {
    await seedStock(10);
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    const { id, token } = await logThenDelete();
    // Seeded after the delete, so the delete's own on-write purge cannot reach them.
    const expired = new Date(RESTORE.getTime() - DOSE_UNDO_WINDOW_MS - 60_000);
    await pgDb.seedTrash({ id: "old-u1", userId: "u1", medicationId: "m1", deletedAt: expired });
    await pgDb.seedTrash({ id: "fresh-u1", userId: "u1", medicationId: "m1", deletedAt: BETWEEN });
    await pgDb.seedTrash({ id: "old-u2", userId: "u2", medicationId: "m2", deletedAt: expired });

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    expect((await trashRows()).map((t) => t.id)).toEqual(["fresh-u1", "old-u2"]);
  });
});

describe("restoreDose — lock order and clock (D7)", () => {
  it("locks the medication before the trash row, with only unlocked reads before it", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();
    queryLog.length = 0;

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");

    const medicationLock = queryLog.findIndex(isMedicationLock);
    const trashLock = queryLog.findIndex(
      (q) =>
        /^select/i.test(q) &&
        /from "dose_log_trash"/i.test(q) &&
        /for update/i.test(q) &&
        !/skip locked/i.test(q),
    );
    expect(medicationLock).toBeGreaterThanOrEqual(0);
    expect(trashLock).toBeGreaterThan(medicationLock);
    // Before the medication lock there are only step 1's unlocked reads: no lock, no write.
    expect(
      queryLog.slice(0, medicationLock).filter((q) => !/^select/i.test(q) || /for update/i.test(q)),
    ).toEqual([]);
  });

  it("reads its clock after the medication lock", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // The Undo arrives at RESTORE and is granted the medication lock a minute later.
    vi.setSystemTime(RESTORE);
    const granted = new Date(RESTORE.getTime() + 60_000);
    // The query logger records each statement just before it runs, so this
    // moves the clock at the moment the lock is taken.
    const push = queryLog.push.bind(queryLog);
    const spy = vi.spyOn(queryLog, "push").mockImplementation((...items: string[]) => {
      if (items.some(isMedicationLock)) vi.setSystemTime(granted);
      return push(...items);
    });
    try {
      expect(await restoreDose("u1", id, token)).toBe("restored");
    } finally {
      spy.mockRestore();
    }

    expect((await doseRow(id))?.updatedAt).toEqual(granted);
  });
});

describe("restoreDose — the ten-minute window", () => {
  it("restores one millisecond inside the window", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    const inside = new Date(DELETED.getTime() + DOSE_UNDO_WINDOW_MS - 1);
    expect(await restoreDose("u1", id, token, inside)).toBe("restored");
  });

  it("is gone exactly at the window, and the expired row goes with it", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    const edge = new Date(DELETED.getTime() + DOSE_UNDO_WINDOW_MS);
    expect(await restoreDose("u1", id, token, edge)).toBe("gone");

    expect(await trashRows()).toEqual([]);
    expect(await doseRow(id)).toBeUndefined();
    // The delete's credit stands: nothing was taken back.
    expect(await stock()).toBe(10);
  });
});

describe("restoreDose — the since-delete guard", () => {
  it("refuses when the same medication was logged after the delete, and keeps the trash row", async () => {
    await seedStock(10);
    const { id, token } = await logThenDelete();

    // Remove, then Log now. Restoring would record two doses for one slot
    // and take stock twice.
    vi.setSystemTime(BETWEEN);
    await logDose("u1", "m1", 1);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("logged_since");

    expect(await doseRow(id)).toBeUndefined();
    expect(await trashRows()).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it("is not refused by another medication's later log", async () => {
    await seedStock(10);
    await pgDb.seedMedication({ id: "m2", name: "Lisinopril", inventoryCount: 10 });
    const { id, token } = await logThenDelete();

    vi.setSystemTime(BETWEEN);
    await logDose("u1", "m2", 1);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", id, token)).toBe("restored");
  });

  it("restores two deletes undone newest-first", async () => {
    // A restored row keeps its original loggedAt, so putting B back is not a
    // log after A's delete.
    await seedStock(10);
    vi.setSystemTime(LOGGED);
    const a = await logDose("u1", "m1", 1);
    vi.setSystemTime(new Date("2026-04-16T08:01:00.000Z"));
    const b = await logDose("u1", "m1", 1);
    const tokenA = await deleteAt(a.id, DELETED);
    const tokenB = await deleteAt(b.id, BETWEEN);

    vi.setSystemTime(RESTORE);
    expect(await restoreDose("u1", b.id, tokenB)).toBe("restored");
    vi.setSystemTime(new Date("2026-04-16T08:06:30.000Z"));
    expect(await restoreDose("u1", a.id, tokenA)).toBe("restored");

    expect(await stock()).toBe(8);
  });
});
