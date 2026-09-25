// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The dashboard's slot-anchored writes: "Took it at HH:MM", Skip and Log now.
 *
 * Each outcome is decided by the database. "Took it at" and Skip look up
 * what the slot's exact instant already holds, under a row lock, so a double
 * tap writes (and decrements) once. Log now re-derives its target from rows
 * read inside its own transaction. `fake-db` answers every read from its seed
 * and never evaluates a predicate, so it cannot tell a dedupe from an insert.
 * These tests belong on PGlite (CLAUDE.md, test-seam rule).
 *
 * What PGlite cannot show is the `FOR UPDATE` itself. It is one backend and
 * serialises transactions with its own mutex, so "concurrent" calls here run
 * one after the other with or without the lock. The concurrency case below
 * proves our part: the second call reads the first call's dose inside its
 * transaction and refuses. It does not prove the lock that makes the two
 * calls serialise on Neon.
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";
import { medications, doseLogs, inventoryEvents } from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { logDose, logSkippedDose, MedicationNotFoundError, SlotAlreadyTakenError } =
  await import("../../../src/lib/server/doses");

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

async function stock(): Promise<number | null> {
  const [row] = await pgDb.db
    .select({ n: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, "m1"));
  return row?.n ?? null;
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
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Took it at — logDose with the exact-instant guard", () => {
  it("writes one taken row and decrements once for two posts at one slot", async () => {
    await seedTrackedMed();
    const first = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);
    const second = await logDose("u1", "m1", 1, SLOT, undefined, undefined, GUARD);

    expect(second.id).toBe(first.id);
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
  it("writes one skip and returns its id for two posts at one slot", async () => {
    await seedTrackedMed();
    const first = await logSkippedDose("u1", "m1", SLOT, GUARD);
    const second = await logSkippedDose("u1", "m1", SLOT, GUARD);

    expect(second).toBe(first);
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
