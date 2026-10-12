// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * D7 for every dose and stock writer that is not a delete or a restore
 * (those have their own files):
 *
 *   - the medication row is locked FIRST, before any statement that locks or
 *     writes `dose_logs` (or, for refill and adjust, writes the count);
 *   - `loggedAt` comes from a clock read AFTER that lock, so for one
 *     medication clock order is commit order, which restore's since-delete
 *     guard relies on;
 *   - `updateDose` computes from a dose row it re-read under the lock, so a
 *     Remove, or a Remove and its Undo, that committed first is seen;
 *   - the locked read is also the ownership check.
 *
 * None of this is a race test. PGlite is one backend and serialises
 * transactions, so two calls never overlap. A lock is pinned by its SQL in
 * `queryLog`. The losing side of a race is reproduced by committing the
 * other side's write at the moment the function under test opens its
 * transaction (`beforeNextTransaction`): anything it read BEFORE opening it
 * is then stale, exactly as it would be in production.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  inventoryEvents,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { and, eq } from "drizzle-orm";

const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  updateDose,
  deleteDose,
  restoreDose,
  MedicationNotFoundError,
} = await import("../../../src/lib/server/doses");
const { refillMedication, adjustInventory } =
  await import("../../../src/lib/server/inventory-events");

/** The action's clock: frozen here, and what `takenAt` defaults to. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** Where the clock jumps the moment the medication lock is sent. */
const AFTER_LOCK = new Date("2026-04-16T13:31:07.000Z");
/**
 * Before every window in this file. The database defaults `startedAt` and
 * `effectiveFrom` to Postgres `now()`, and PGlite's `now()` follows the faked
 * `Date` (measured, not assumed). So a row takes whichever instant the clock
 * stood at when it was seeded: the real one when seeded before the clock is
 * frozen, TAP after. Either way it is not before every window here, and the
 * lifecycle and schedule-edit clips would drop the slots.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

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

async function auditRows(action: string) {
  return pgDb.db.select().from(auditLogs).where(eq(auditLogs.action, action));
}

/** Index of the first statement that reads `medications` under a row lock. */
function medicationLockIndex(): number {
  return queryLog.findIndex((q) => /from "medications"/.test(q) && /for update/.test(q));
}

/**
 * Index of the first statement that locks or writes `table`. A plain read
 * is neither: `updateDose`'s unlocked read of the dose's medication id is
 * exempt by design, because `medicationId` never changes (spec Section 5,
 * "Locks").
 */
function firstLockOrWriteOn(table: string): number {
  const t = `"${table}"`;
  return queryLog.findIndex(
    (q) =>
      q.startsWith(`insert into ${t}`) ||
      q.startsWith(`update ${t}`) ||
      q.startsWith(`delete from ${t}`) ||
      (q.includes(`from ${t}`) && /for update/.test(q)),
  );
}

/** Index of the first statement that writes `table`. */
function firstWriteOn(table: string): number {
  const t = `"${table}"`;
  return queryLog.findIndex(
    (q) =>
      q.startsWith(`insert into ${t}`) ||
      q.startsWith(`update ${t}`) ||
      q.startsWith(`delete from ${t}`),
  );
}

/**
 * Jump the fake clock to `to` the moment the medication lock is SENT.
 * drizzle logs each statement just before executing it, so a clock read
 * before the lock sees TAP and one read after it sees `to`.
 */
function advanceClockOnMedicationLock(to: Date) {
  return vi.spyOn(queryLog, "push").mockImplementation((...queries: string[]) => {
    const length = Array.prototype.push.apply(queryLog, queries);
    if (queries.some((q) => /from "medications"/.test(q) && /for update/.test(q))) {
      vi.setSystemTime(to);
    }
    return length;
  });
}

/**
 * Commit `concurrent` at the moment the NEXT transaction opens, before its
 * first statement. `dbTx` and `db` are the same PGlite database here, so
 * spying on its `transaction` catches the function under test; the writes
 * `concurrent` makes open transactions of their own, which reach the real
 * method because the override is used once.
 */
function beforeNextTransaction(concurrent: () => Promise<unknown>) {
  const original = pgDb.db.transaction.bind(pgDb.db);
  return vi.spyOn(pgDb.db, "transaction").mockImplementationOnce((async (
    callback: never,
    config: never,
  ) => {
    await concurrent();
    return original(callback, config);
  }) as never);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  await pgDb.seedMedication({ id: "m1", inventoryCount: 10, startedAt: LONG_AGO });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the medication row is locked before dose_logs is locked or written", () => {
  const writers: Array<[string, () => Promise<unknown>]> = [
    ["logDose (a chip, or /api/v1 log_dose)", () => logDose("u1", "m1", 1)],
    ["logSkippedDose at now (legacy Skip, /api/v1 skip_dose)", () => logSkippedDose("u1", "m1")],
    [
      "logDoseForSlot (Log now)",
      async () => {
        await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });
        queryLog.length = 0;
        return logDoseForSlot(
          "u1",
          "m1",
          new Date("2026-04-16T08:00:00.000Z"),
          new Date("2026-04-16T08:10:00.000Z"),
          "UTC",
        );
      },
    ],
    [
      "updateDose (edit Save, /api/v1 edit_dose)",
      async () => {
        await pgDb.seedDose({ id: "d-edit", quantity: 1, inventoryApplied: 1 });
        queryLog.length = 0;
        return updateDose("u1", "d-edit", { quantity: 2 });
      },
    ],
  ];

  it.each(writers)("%s", async (_label, write) => {
    await write();

    const lock = medicationLockIndex();
    const first = firstLockOrWriteOn("dose_logs");
    expect(first).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(first);
  });

  it("updateDose also locks the dose row it re-reads", async () => {
    await pgDb.seedDose({ id: "d-edit", quantity: 1, inventoryApplied: 1 });
    queryLog.length = 0;

    await updateDose("u1", "d-edit", { quantity: 2 });

    expect(queryLog.some((q) => /from "dose_logs"/.test(q) && /for update/.test(q))).toBe(true);
  });
});

describe("refill and adjust lock the count before overwriting it", () => {
  // Both write an ABSOLUTE count. Unlocked, a log, delete or restore that
  // committed between their read and their write was simply overwritten:
  // a refill that read 6 while a restore took 1 wrote 16 (spec item 13).
  const writers: Array<[string, () => Promise<unknown>]> = [
    ["refillMedication", () => refillMedication("u1", "m1", 5)],
    ["adjustInventory", () => adjustInventory("u1", "m1", 3)],
  ];

  it.each(writers)("%s", async (_label, run) => {
    await run();

    const lock = medicationLockIndex();
    const write = firstWriteOn("medications");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(write).toBeGreaterThanOrEqual(0);
    expect(lock).toBeLessThan(write);
  });
});

describe("loggedAt is read after the medication lock; takenAt is the action's now", () => {
  // A frozen clock alone cannot tell an app-stamped `loggedAt` from the
  // column default: PGlite's `now()` follows the faked `Date`. What separates
  // them here is that Postgres' `now()` is the TRANSACTION's start, fixed at
  // BEGIN, before the medication lock is sent. A defaulted `loggedAt` reads
  // TAP and can never equal AFTER_LOCK. (Measured: dropping `loggedAt` from
  // each insert fails all three tests below, receiving TAP.)
  it("logDose", async () => {
    advanceClockOnMedicationLock(AFTER_LOCK);

    const dose = await logDose("u1", "m1", 1);

    expect(dose.takenAt).toEqual(TAP);
    expect(dose.loggedAt).toEqual(AFTER_LOCK);
  });

  it("logSkippedDose at now", async () => {
    advanceClockOnMedicationLock(AFTER_LOCK);

    const id = await logSkippedDose("u1", "m1");

    const row = await doseRow(id);
    expect(row.takenAt).toEqual(TAP);
    expect(row.loggedAt).toEqual(AFTER_LOCK);
  });

  it("logDoseForSlot", async () => {
    const at = new Date("2026-04-16T08:10:00.000Z");
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });
    advanceClockOnMedicationLock(AFTER_LOCK);

    const dose = await logDoseForSlot("u1", "m1", new Date("2026-04-16T08:00:00.000Z"), at, "UTC");

    expect(dose.takenAt).toEqual(at);
    expect(dose.loggedAt).toEqual(AFTER_LOCK);
  });
});

describe("updateDose re-reads the dose under the lock", () => {
  it("returns null for a dose that is already gone, and writes nothing", async () => {
    const dose = await logDose("u1", "m1", 2);
    await deleteDose("u1", dose.id, { keepForUndo: false });
    expect(await stock()).toBe(10);
    queryLog.length = 0;

    await expect(updateDose("u1", dose.id, { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(queryLog.some((q) => q.startsWith(`update "medications"`))).toBe(false);
    expect(await auditRows("update")).toEqual([]);
  });

  it("returns null, not a 500, when a Remove commits while the edit waits for its locks", async () => {
    // The old order: read the dose, THEN open the transaction. A Remove that
    // committed in between left the UPDATE with no row, and
    // `computeChanges(existing, undefined)` threw.
    const dose = await logDose("u1", "m1", 2);
    beforeNextTransaction(() => deleteDose("u1", dose.id, { keepForUndo: false }));

    await expect(updateDose("u1", dose.id, { quantity: 5 })).resolves.toBeNull();

    expect(await stock()).toBe(10);
    expect(
      await pgDb.db
        .select()
        .from(inventoryEvents)
        .where(eq(inventoryEvents.eventType, "dose_quantity_updated")),
    ).toEqual([]);
    expect(await auditRows("update")).toEqual([]);
  });

  it("computes from the restored row after a Remove and its Undo, not the pre-delete one", async () => {
    // The ABA case same-id restore opens. The edit's caller saw the dose
    // applying 3. Before its transaction opens, the dose is removed (stock
    // back to 10), the count is adjusted to 1, and Undo restores it, which
    // can take back only 1: the restored row applies 1, stock 0.
    const dose = await logDose("u1", "m1", 3);
    expect(await stock()).toBe(7);
    let outcome: string | undefined;
    beforeNextTransaction(async () => {
      const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
      await adjustInventory("u1", "m1", 1);
      outcome = await restoreDose("u1", dose.id, deleted!.deletedAt);
    });

    await updateDose("u1", dose.id, { quantity: 2 });

    expect(outcome).toBe("restored");
    // From the locked re-read (applies 1, count 0): 2 cannot be afforded
    // beyond the 1 it holds, so nothing moves. Diffed against the stale
    // read (applies 3) it would have handed one dose back: stock 1.
    expect(await stock()).toBe(0);
    expect(await doseRow(dose.id)).toMatchObject({ quantity: 2, inventoryApplied: 1 });
  });
});

describe("the locked read is the ownership check", () => {
  beforeEach(async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", inventoryCount: 5, startedAt: LONG_AGO });
  });

  it("logDose refuses another user's medication and writes nothing", async () => {
    await expect(logDose("u1", "m2", 1)).rejects.toBeInstanceOf(MedicationNotFoundError);

    expect(await pgDb.db.select().from(doseLogs)).toEqual([]);
    expect(await stock("m2")).toBe(5);
  });

  it("logSkippedDose refuses another user's medication on the legacy path too", async () => {
    await expect(logSkippedDose("u1", "m2")).rejects.toBeInstanceOf(MedicationNotFoundError);

    expect(
      await pgDb.db
        .select()
        .from(doseLogs)
        .where(and(eq(doseLogs.userId, "u1"), eq(doseLogs.medicationId, "m2"))),
    ).toEqual([]);
  });
});
