// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The dashboard's guarded writes: Log now, "Took it at HH:MM" and Skip.
 *
 * Each one locks the medication row, re-derives that medication's buttons
 * (`slotActions`) from rows read inside its own transaction, and writes only
 * if the button it was posted from is still offered there. Every outcome is
 * therefore decided by the database: `fake-db` answers every read from its
 * seed and never evaluates a predicate, so it cannot tell a refusal from an
 * insert. These tests belong on PGlite (CLAUDE.md, test-seam rule).
 *
 * The `FOR UPDATE` is pinned by its SQL: the query log shows each write
 * reading the medication row with a lock, before any statement touches
 * `dose_logs` (spec D7). Its runtime effect is still unprovable here. PGlite
 * is one backend and serialises transactions with its own mutex, so
 * "concurrent" calls run one after the other with or without the lock. A
 * losing side is covered by seeding what it would see and calling it
 * second: the stale second device below is exactly that.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  logDoseAtSlot,
  skipDoseForSlot,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} = await import("../../../src/lib/server/doses");

/** The frozen moment of the tap. `loggedAt` reads it. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** A slot instant, millisecond-exact, as the page posts it. */
const SLOT = new Date("2026-04-16T09:00:00.000Z");
const SLOT_0800 = new Date("2026-04-16T08:00:00.000Z");
const AT_0810 = new Date("2026-04-16T08:10:00.000Z");
/** Phone A's Log now, and laptop B's tap from a page drawn before it. */
const AT_0840 = new Date("2026-04-16T08:40:00.000Z");
const AT_0845 = new Date("2026-04-16T08:45:00.000Z");
/** Where the clock jumps the moment the medication lock is sent. */
const LATER = new Date(TAP.getTime() + 5_000);
/**
 * Before every window in this file. Required: the database defaults
 * `startedAt` and `effectiveFrom` to Postgres `now()`, and PGlite's `now()`
 * follows the faked `Date`. A row seeded here therefore defaults to TAP,
 * which is after every slot in this file. Left to default, the lifecycle and
 * schedule-edit clips would drop every slot.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");

/**
 * Jump the fake clock to `to` the moment the medication lock is SENT.
 * drizzle logs each statement just before executing it
 * (`logQuery` in drizzle-orm/pglite/session.js) and pg-db.ts's logger pushes
 * onto `queryLog`, so a clock read before the lock sees TAP and one read after
 * it sees `to`.
 */
function advanceClockOnMedicationLock(to: Date) {
  return vi.spyOn(queryLog, "push").mockImplementation((...queries: string[]) => {
    const length = Array.prototype.push.apply(queryLog, queries);
    if (queries.some((q) => /from "medications"/i.test(q) && /for update/i.test(q))) {
      vi.setSystemTime(to);
    }
    return length;
  });
}

async function stock(medicationId = "m1"): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId));
  return row?.n ?? null;
}

/** The statements that read the medications table under a row lock. */
function medicationLocks(): string[] {
  return queryLog.filter((q) => /from "medications"/i.test(q) && /for update/i.test(q));
}

/** D7: the medication lock is sent before any statement that touches `dose_logs`. */
function expectLockBeforeDoseLogs(): void {
  const lock = queryLog.findIndex((q) => /from "medications"/i.test(q) && /for update/i.test(q));
  const firstDoseLogs = queryLog.findIndex((q) => /"dose_logs"/i.test(q));
  expect(lock).toBeGreaterThanOrEqual(0);
  expect(firstDoseLogs).toBeGreaterThan(lock);
}

async function rows() {
  return pgDb.db
    .select({
      id: doseLogs.id,
      status: doseLogs.status,
      quantity: doseLogs.quantity,
      inventoryApplied: doseLogs.inventoryApplied,
      takenAt: doseLogs.takenAt,
      loggedAt: doseLogs.loggedAt,
    })
    .from(doseLogs)
    .where(eq(doseLogs.medicationId, "m1"))
    .orderBy(asc(doseLogs.takenAt), asc(doseLogs.id));
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

async function seedTrackedMed(overrides: Partial<typeof medications.$inferInsert> = {}) {
  await pgDb.seedMedication({
    id: "m1",
    name: "Metformin",
    inventoryCount: 10,
    startedAt: LONG_AGO,
    ...overrides,
  });
}

/** A daily fixed-time schedule, in force long before every window here. */
async function seedDaily(timeOfDay: string, medicationId = "m1", userId = "u1") {
  await pgDb.seedSchedule({ medicationId, userId, timeOfDay, effectiveFrom: LONG_AGO });
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
  queryLog.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Took it at — logDoseAtSlot", () => {
  it("writes one ×1 taken dose at the slot's instant, logged at the tap, with the stock bookkeeping", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const dose = await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(dose).toMatchObject({
      medicationId: "m1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });
    expect(dose.takenAt).toEqual(SLOT);
    expect(dose.loggedAt).toEqual(TAP);
    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 10, newCount: 9 },
    ]);
  });

  it("keeps the notes and side effects the row was posted with", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const dose = await logDoseAtSlot(
      "u1",
      "m1",
      SLOT,
      "with food",
      [{ name: "Nausea", severity: "mild" }],
      TAP,
      "UTC",
    );

    expect(dose.notes).toBe("with food");
    expect(dose.sideEffects).toEqual([{ name: "Nausea", severity: "mild" }]);
  });

  it("refuses a second post at one slot as already taken, so a double tap writes and decrements once", async () => {
    // Checked before the re-derivation, which would refuse it too, so that a
    // double tap gets the specific "already logged" answer.
    await seedTrackedMed();
    await seedDaily("09:00");
    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotAlreadyTakenError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses a stale second device: once Log now at 08:40 resolved 08:00, Took it at 08:00 writes nothing", async () => {
    // Phone A presses Log now at 08:40. Laptop B's page, drawn before that,
    // still offers "Took it at 08:00". The exact-instant check cannot see A's
    // dose (it sits at 08:40); only the re-derivation can.
    await seedTrackedMed();
    await seedDaily("08:00");
    vi.setSystemTime(AT_0840);
    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0840, "UTC");

    vi.setSystemTime(AT_0845);
    await expect(
      logDoseAtSlot("u1", "m1", SLOT_0800, undefined, undefined, AT_0845, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("refuses Took it at over a slot a skip already resolved — remove the skip first", async () => {
    // This used to insert, because taken beats skip in the matcher. A slot
    // the skip resolved is no longer a row, so it offers no Took it at.
    await seedTrackedMed();
    await seedDaily("09:00");
    await pgDb.seedDose({
      id: "skip-0900",
      medicationId: "m1",
      status: "skipped",
      quantity: 1,
      takenAt: SLOT,
    });

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect((await rows()).map((r) => r.status)).toEqual(["skipped"]);
    expect(await stock()).toBe(10);
  });

  it("names the slot to the millisecond — 1ms off is no row, and nothing is written", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    await expect(
      logDoseAtSlot("u1", "m1", new Date(SLOT.getTime() + 1), undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
    expect(await stock()).toBe(10);
  });

  it("is MedicationNotFoundError for an unknown medication or another user's", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await seedDaily("09:00", "m2", "u2");

    await expect(
      logDoseAtSlot("u1", "nope", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(MedicationNotFoundError);
    await expect(
      logDoseAtSlot("u1", "m2", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(MedicationNotFoundError);
  });

  it("finds nothing to honour on an archived medication — the load never lists one", async () => {
    await seedTrackedMed({ isArchived: true });
    await seedDaily("09:00");

    await expect(
      logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
  });
});

describe("Skip — skipDoseForSlot", () => {
  it("skips a past slot at the slot's own instant, logged at the tap, leaving stock alone", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");

    const id = await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, status: "skipped", quantity: 1 });
    expect(all[0].takenAt).toEqual(SLOT);
    expect(all[0].loggedAt).toEqual(TAP);
    expect(await stock()).toBe(10);
    expect(await ledger()).toEqual([]);
  });

  it("skips a slot still ahead at the server's min(slot, now), not an instant the page chose", async () => {
    // A due-now row's slot can be up to an hour ahead. The page used to post
    // its own render-time skipAt. It now posts the slot, and the server
    // writes the instant its own simulation proved.
    await seedTrackedMed();
    await seedDaily("09:00");
    vi.setSystemTime(AT_0840);

    await skipDoseForSlot("u1", "m1", SLOT, AT_0840, "UTC");

    const [row] = await rows();
    expect(row.status).toBe("skipped");
    expect(row.takenAt).toEqual(AT_0840);
  });

  it("refuses a second Skip at one slot, so a double tap writes one skip", async () => {
    // The first skip resolves the slot, so its row no longer offers Skip.
    await seedTrackedMed();
    await seedDaily("09:00");
    const first = await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first, status: "skipped", quantity: 1 });
    expect(await stock()).toBe(10);
  });

  it("refuses a stale Skip once another device's Log now resolved the slot", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    vi.setSystemTime(AT_0840);
    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0840, "UTC");

    vi.setSystemTime(AT_0845);
    await expect(skipDoseForSlot("u1", "m1", SLOT_0800, AT_0845, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
    expect(await stock()).toBe(9);
  });

  it("refuses to skip a slot Took it at already resolved", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
  });

  it("accepts a pre-deploy page's takenAt-only Skip on a past slot — its skipAt was the slot itself", async () => {
    // The action hands a legacy `takenAt` to skipDoseForSlot as the slot
    // (spec D9). For a past slot, the old page's skipAt WAS the slot instant.
    await seedTrackedMed();
    await seedDaily("09:00");
    const legacyTakenAt = new Date("2026-04-16T09:00:00.000Z");

    await skipDoseForSlot("u1", "m1", legacyTakenAt, TAP, "UTC");

    const [row] = await rows();
    expect(row.status).toBe("skipped");
    expect(row.takenAt).toEqual(SLOT);
  });

  it("refuses a pre-deploy page's takenAt-only Skip on a slot still ahead — its render-time instant names no slot", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    vi.setSystemTime(AT_0840);
    // Drawn at 08:30, that page's skipAt was min(09:00, 08:30).
    const renderedSkipAt = new Date("2026-04-16T08:30:00.000Z");

    await expect(
      skipDoseForSlot("u1", "m1", renderedSkipAt, AT_0840, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
  });

  it("is MedicationNotFoundError for another user's medication", async () => {
    await seedTrackedMed();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await seedDaily("09:00", "m2", "u2");

    await expect(skipDoseForSlot("u1", "m2", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("finds nothing to honour on an archived medication", async () => {
    await seedTrackedMed({ isArchived: true });
    await seedDaily("09:00");

    await expect(skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect(await rows()).toEqual([]);
  });
});

describe("logSkippedDose — the /api/v1 and legacy skip-at-now door", () => {
  it("still skips at now when no instant is given", async () => {
    await seedTrackedMed();
    const id = await logSkippedDose("u1", "m1");

    const [row] = await rows();
    expect(row).toMatchObject({ id, status: "skipped" });
    expect(row.takenAt).toEqual(TAP);
  });
});

describe("logDose — a dose with no slot to prove", () => {
  it("still inserts at an instant that already holds a taken dose — only Took it at refuses", async () => {
    // The chips, the 1–9 keys, the medications card and /api/v1 log_dose
    // name no slot, so there is nothing to re-derive and nothing to refuse.
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT);
    await logDose("u1", "m1", 1, SLOT);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });
});

describe("Log now — logDoseForSlot", () => {
  async function seedDaily0800() {
    await seedTrackedMed();
    await seedDaily("08:00");
  }

  it("writes one taken dose at now, with logDose's stock bookkeeping", async () => {
    await seedDaily0800();

    const row = await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(row).toMatchObject({
      medicationId: "m1",
      status: "taken",
      quantity: 1,
      inventoryApplied: 1,
    });
    expect(row.takenAt).toEqual(AT_0810);
    // The clock read after the lock (D7), not the action's `now`.
    expect(row.loggedAt).toEqual(TAP);
    expect(await stock()).toBe(9);
    expect(await ledger()).toEqual([
      { eventType: "dose_taken", quantityChange: -1, previousCount: 10, newCount: 9 },
    ]);
  });

  it("refuses a forSlot a dose logged now would not resolve, and writes nothing", async () => {
    await seedDaily0800();

    await expect(
      logDoseForSlot("u1", "m1", new Date("2026-04-16T09:00:00.000Z"), AT_0810, "UTC"),
    ).rejects.toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toEqual([]);
    expect(await stock()).toBe(10);
  });

  describe("render-to-tap drift (fixed 14:00 and 20:00)", () => {
    const SLOT_1400 = new Date("2026-04-16T14:00:00.000Z");

    async function seedTwoSlots() {
      await seedTrackedMed();
      await pgDb.seedSchedule({ timeOfDay: "14:00", effectiveFrom: LONG_AGO, sortOrder: 0 });
      await pgDb.seedSchedule({ timeOfDay: "20:00", effectiveFrom: LONG_AGO, sortOrder: 1 });
    }

    it("accepts 14:00 at 18:50, when a dose logged now would count for it", async () => {
      // 20:00 is 70 minutes ahead, beyond pass 1's hour, so pass 2 walks
      // back to 14:00.
      await seedTwoSlots();

      const row = await logDoseForSlot(
        "u1",
        "m1",
        SLOT_1400,
        new Date("2026-04-16T18:50:00.000Z"),
        "UTC",
      );

      expect(row.status).toBe("taken");
    });

    it("refuses the same 14:00 at 19:05, once 20:00 is within the hour", async () => {
      // Pass 1 now gives a dose logged at 19:05 to 20:00, so the page's
      // 14:00 button is stale.
      await seedTwoSlots();

      await expect(
        logDoseForSlot("u1", "m1", SLOT_1400, new Date("2026-04-16T19:05:00.000Z"), "UTC"),
      ).rejects.toBeInstanceOf(SlotTargetChangedError);
      expect(await rows()).toEqual([]);
    });
  });

  it("two concurrent posts for one medication write one dose; the other is told the target changed", async () => {
    await seedDaily0800();

    const results = await Promise.allSettled([
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
      logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC"),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(SlotTargetChangedError);
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
  });

  it("is MedicationNotFoundError for an unknown medication or another user's", async () => {
    await seedDaily0800();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });
    await pgDb.seedSchedule({
      medicationId: "m2",
      userId: "u2",
      timeOfDay: "08:00",
      effectiveFrom: LONG_AGO,
    });

    await expect(logDoseForSlot("u1", "nope", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
    await expect(logDoseForSlot("u1", "m2", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });

  it("finds no target on an archived medication — the load never lists one", async () => {
    await seedTrackedMed({ isArchived: true });
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });

    await expect(logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC")).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    expect(await rows()).toEqual([]);
  });
});

describe("slot-anchored reads belong to one medication", () => {
  it("Log now on an interval medication anchors on its own last TAKEN dose", async () => {
    // Every 8 hours, last taken 01:00, so the load draws the row at 09:00.
    // The load projects from `lastTakenAt`, so the write must too: a skip at
    // 03:00 and another medication's dose at 05:00 are not that anchor. Were
    // either read as it, the write would project another grid and refuse
    // every Log now on an interval medication.
    await seedTrackedMed();
    await pgDb.seedSchedule({
      scheduleKind: "interval",
      intervalHours: "8",
      timeOfDay: null,
      effectiveFrom: LONG_AGO,
    });
    await pgDb.seedMedication({ id: "m2", name: "Other", startedAt: LONG_AGO });
    await pgDb.seedDose({
      medicationId: "m1",
      status: "taken",
      takenAt: new Date("2026-04-16T01:00:00.000Z"),
    });
    await pgDb.seedDose({
      medicationId: "m1",
      status: "skipped",
      takenAt: new Date("2026-04-16T03:00:00.000Z"),
    });
    await pgDb.seedDose({
      medicationId: "m2",
      status: "taken",
      takenAt: new Date("2026-04-16T05:00:00.000Z"),
    });

    const row = await logDoseForSlot(
      "u1",
      "m1",
      new Date("2026-04-16T09:00:00.000Z"),
      new Date("2026-04-16T09:10:00.000Z"),
      "UTC",
    );

    expect(row).toMatchObject({ medicationId: "m1", status: "taken" });
  });

  describe("two medications due at the same 08:00", () => {
    async function seedTwoMedsAt0800() {
      await seedTrackedMed();
      await pgDb.seedMedication({
        id: "m2",
        name: "Lisinopril",
        inventoryCount: 10,
        startedAt: LONG_AGO,
      });
      await pgDb.seedSchedule({ medicationId: "m1", timeOfDay: "08:00", effectiveFrom: LONG_AGO });
      await pgDb.seedSchedule({ medicationId: "m2", timeOfDay: "08:00", effectiveFrom: LONG_AGO });
    }

    it("Took it at for one does not find the other's dose at that instant", async () => {
      await seedTwoMedsAt0800();
      await logDoseAtSlot("u1", "m1", SLOT_0800, undefined, undefined, TAP, "UTC");

      const second = await logDoseAtSlot("u1", "m2", SLOT_0800, undefined, undefined, TAP, "UTC");

      expect(second).toMatchObject({ medicationId: "m2", status: "taken" });
      expect(await stock("m1")).toBe(9);
      expect(await stock("m2")).toBe(9);
    });

    it("Skip for one is not refused by the other's taken dose at that instant", async () => {
      await seedTwoMedsAt0800();
      await pgDb.seedDose({ medicationId: "m1", status: "taken", takenAt: SLOT_0800 });

      const id = await skipDoseForSlot("u1", "m2", SLOT_0800, TAP, "UTC");

      const [row] = await pgDb.db.select().from(doseLogs).where(eq(doseLogs.id, id));
      expect(row).toMatchObject({ medicationId: "m2", status: "skipped" });
    });

    it("Log now for one is not cooled down by the other's dose", async () => {
      await seedTwoMedsAt0800();
      await logDoseForSlot("u1", "m1", SLOT_0800, new Date("2026-04-16T08:05:00.000Z"), "UTC");

      const row = await logDoseForSlot(
        "u1",
        "m2",
        SLOT_0800,
        new Date("2026-04-16T08:10:00.000Z"),
        "UTC",
      );

      expect(row).toMatchObject({ medicationId: "m2", status: "taken" });
    });
  });
});

describe("the medication row lock", () => {
  // Two devices tapping together, or a retry after an unknown outcome, must
  // serialise on the medication row, or both read "no dose" and both write.
  it("Log now locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    queryLog.length = 0;

    await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("Took it at locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    queryLog.length = 0;

    await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("Skip locks the medication once, before any dose_logs statement", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    queryLog.length = 0;

    await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });

  it("a chip's dose locks the medication too — every dose insert does (D7)", async () => {
    await seedTrackedMed();
    queryLog.length = 0;

    await logDose("u1", "m1", 1);

    expect(medicationLocks()).toHaveLength(1);
    expectLockBeforeDoseLogs();
  });
});

describe("the clock that orders writes is read after the lock (D7)", () => {
  // A frozen clock alone cannot tell an app-stamped `loggedAt` from the column
  // default: PGlite's `now()` follows the faked `Date`. What separates them is
  // that Postgres' `now()` is the TRANSACTION's start, fixed at BEGIN, before
  // the medication lock is sent. A defaulted `loggedAt` reads TAP and can
  // never equal LATER.
  it("Took it at's loggedAt", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    advanceClockOnMedicationLock(LATER);

    const dose = await logDoseAtSlot("u1", "m1", SLOT, undefined, undefined, TAP, "UTC");

    expect(dose.loggedAt).toEqual(LATER);
    expect(dose.takenAt).toEqual(SLOT);
  });

  it("Skip's loggedAt", async () => {
    await seedTrackedMed();
    await seedDaily("09:00");
    advanceClockOnMedicationLock(LATER);

    await skipDoseForSlot("u1", "m1", SLOT, TAP, "UTC");

    const [row] = await rows();
    expect(row.loggedAt).toEqual(LATER);
    expect(row.takenAt).toEqual(SLOT);
  });

  it("Log now's loggedAt, while takenAt keeps the action's now", async () => {
    await seedTrackedMed();
    await seedDaily("08:00");
    advanceClockOnMedicationLock(LATER);

    const row = await logDoseForSlot("u1", "m1", SLOT_0800, AT_0810, "UTC");

    expect(row.loggedAt).toEqual(LATER);
    expect(row.takenAt).toEqual(AT_0810);
  });
});
