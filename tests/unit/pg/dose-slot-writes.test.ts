// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The dashboard's slot-anchored writes: "Took it at HH:MM", Skip and Log now.
 *
 * Each outcome is decided by the database. "Took it at" and Skip look up
 * what the slot's exact instant already holds, under a row lock, so a double
 * tap writes (and decrements) once. Log now re-derives its target from rows
 * read inside its own transaction. `fake-db` answers every read from its seed
 * and never evaluates a predicate, so it cannot tell a refusal from an
 * insert. These tests belong on PGlite (CLAUDE.md, test-seam rule).
 *
 * The `FOR UPDATE` is pinned by its SQL: the query log shows that each
 * slot-anchored write reads the medication row with a lock, and a chip's
 * write does not. Its runtime effect is still unprovable here. PGlite is one
 * backend and serialises transactions with its own mutex, so "concurrent"
 * calls run one after the other with or without the lock. The concurrency
 * case below proves our part: the second call reads the first call's dose
 * inside its transaction and refuses.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const {
  logDose,
  logSkippedDose,
  logDoseForSlot,
  MedicationNotFoundError,
  SlotAlreadyTakenError,
  SlotTargetChangedError,
} = await import("../../../src/lib/server/doses");

/** The frozen moment of the tap. `loggedAt` reads it. */
const TAP = new Date("2026-04-16T13:31:00.000Z");
/** A slot instant, millisecond-exact, as the page posts it. */
const SLOT = new Date("2026-04-16T09:00:00.000Z");
/**
 * Before every window in this file. Required: the database defaults
 * `startedAt` and `effectiveFrom` to Postgres `now()`, which is the REAL
 * clock, not the faked one. Left to default, the lifecycle and
 * schedule-edit clips would drop every slot in this file.
 */
const LONG_AGO = new Date("2026-01-01T00:00:00.000Z");
const GUARD = { exactInstantGuard: true } as const;

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

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ timezone: "UTC" });
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TAP);
  queryLog.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Took it at — logDose with the exact-instant guard", () => {
  it("refuses a second post at one slot, so a double tap writes and decrements once", async () => {
    // A fresh page never offers "Took it at" on an instant that already
    // holds a taken dose, so the second post comes from a stale page. It is
    // refused rather than answered with the existing row, whose Undo would
    // then delete a record this tap never wrote.
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    await expect(logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD)).rejects.toBeInstanceOf(
      SlotAlreadyTakenError,
    );
    expect(await rows()).toHaveLength(1);
    expect(await stock()).toBe(9);
    expect(await ledger()).toHaveLength(1);
  });

  it("stores the slot's instant as takenAt and the tap as loggedAt", async () => {
    await seedTrackedMed();
    const dose = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(dose.takenAt).toEqual(SLOT);
    expect(dose.loggedAt).toEqual(TAP);
    expect(dose.inventoryApplied).toBe(1);
  });

  it("matches to the millisecond — a taken dose 1ms away is a different dose", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);
    await logDose("u1", "m1", 1, new Date(SLOT.getTime() + 1), undefined, undefined, GUARD);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });

  it("inserts over a skip at the same instant — taken beats skip", async () => {
    await seedTrackedMed();
    await pgDb.seedDose({
      id: "skip-0900",
      medicationId: "m1",
      status: "skipped",
      quantity: 1,
      takenAt: SLOT,
    });

    const dose = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(dose.id).not.toBe("skip-0900");
    expect((await rows()).map((r) => r.status).sort()).toEqual(["skipped", "taken"]);
    expect(await stock()).toBe(9);
  });

  it("control: without the guard a repeated post still inserts — no existing caller changes", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT);
    await logDose("u1", "m1", 1, SLOT);

    expect(await rows()).toHaveLength(2);
    expect(await stock()).toBe(8);
  });
});

describe("Skip — logSkippedDose with the exact-instant guard", () => {
  it("refuses a second skip at one slot, so a double tap writes one skip", async () => {
    // A fresh page never offers Skip on an instant that already holds a
    // skip: that skip resolves the slot. The second post is from a stale page.
    await seedTrackedMed();
    const first = await logSkippedDose("u1", "m1", SLOT, GUARD);

    await expect(logSkippedDose("u1", "m1", SLOT, GUARD)).rejects.toBeInstanceOf(
      SlotTargetChangedError,
    );
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id: first, status: "skipped", quantity: 1 });
    // A skip never touches inventory.
    expect(await stock()).toBe(10);
  });

  it("stores the slot's instant as takenAt and the tap as loggedAt", async () => {
    await seedTrackedMed();
    await logSkippedDose("u1", "m1", SLOT, GUARD);

    const [row] = await rows();
    expect(row.takenAt).toEqual(SLOT);
    expect(row.loggedAt).toEqual(TAP);
  });

  it("refuses to skip an instant that already holds a taken dose", async () => {
    await seedTrackedMed();
    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    await expect(logSkippedDose("u1", "m1", SLOT, GUARD)).rejects.toBeInstanceOf(
      SlotAlreadyTakenError,
    );
    expect((await rows()).map((r) => r.status)).toEqual(["taken"]);
  });

  it("still skips at now when no instant is given — the /api/v1 and legacy door", async () => {
    await seedTrackedMed();
    const id = await logSkippedDose("u1", "m1");

    const [row] = await rows();
    expect(row).toMatchObject({ id, status: "skipped" });
    expect(row.takenAt).toEqual(TAP);
  });

  it("is MedicationNotFoundError for another user's medication under the guard", async () => {
    await seedTrackedMed();
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m2", userId: "u2", startedAt: LONG_AGO });

    await expect(logSkippedDose("u1", "m2", SLOT, GUARD)).rejects.toBeInstanceOf(
      MedicationNotFoundError,
    );
  });
});

describe("Log now — logDoseForSlot", () => {
  const AT_0810 = new Date("2026-04-16T08:10:00.000Z");
  const SLOT_0800 = new Date("2026-04-16T08:00:00.000Z");

  async function seedDaily0800() {
    await seedTrackedMed();
    await pgDb.seedSchedule({
      medicationId: "m1",
      scheduleKind: "fixed_time",
      timeOfDay: "08:00",
      effectiveFrom: LONG_AGO,
    });
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
    expect(row.loggedAt).toEqual(AT_0810);
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
  const SLOT_0800 = new Date("2026-04-16T08:00:00.000Z");

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
      await logDose("u1", "m1", 1, SLOT_0800, undefined, undefined, GUARD);

      const second = await logDose("u1", "m2", 1, SLOT_0800, undefined, undefined, GUARD);

      expect(second).toMatchObject({ medicationId: "m2", status: "taken" });
      expect(await stock("m1")).toBe(9);
      expect(await stock("m2")).toBe(9);
    });

    it("Skip for one is not refused by the other's taken dose at that instant", async () => {
      await seedTwoMedsAt0800();
      await pgDb.seedDose({ medicationId: "m1", status: "taken", takenAt: SLOT_0800 });

      const id = await logSkippedDose("u1", "m2", SLOT_0800, GUARD);

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
  it("Log now reads the medication row FOR UPDATE", async () => {
    await seedTrackedMed();
    await pgDb.seedSchedule({ timeOfDay: "08:00", effectiveFrom: LONG_AGO });
    queryLog.length = 0;

    await logDoseForSlot(
      "u1",
      "m1",
      new Date("2026-04-16T08:00:00.000Z"),
      new Date("2026-04-16T08:10:00.000Z"),
      "UTC",
    );

    expect(medicationLocks()).toHaveLength(1);
  });

  it("Took it at reads the medication row FOR UPDATE", async () => {
    await seedTrackedMed();
    queryLog.length = 0;

    await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(medicationLocks()).toHaveLength(1);
  });

  it("Skip reads the medication row FOR UPDATE", async () => {
    await seedTrackedMed();
    queryLog.length = 0;

    await logSkippedDose("u1", "m1", SLOT, GUARD);

    expect(medicationLocks()).toHaveLength(1);
  });

  it("a chip's dose takes no lock — it names no slot to protect", async () => {
    await seedTrackedMed();
    queryLog.length = 0;

    await logDose("u1", "m1", 1);

    expect(queryLog.some((q) => /from "medications"/i.test(q))).toBe(true);
    expect(medicationLocks()).toEqual([]);
  });
});
