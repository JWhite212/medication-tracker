// @vitest-environment node
/**
 * updateMedicationWithSchedules: the edit-form and /api/v1 upsert door.
 *
 * This suite ran on fake-db until the audit diff's before-image moved inside
 * the transaction under `SELECT … FOR UPDATE`. fake-db has no select `.for()`
 * and must not grow one, and whether that read is locked is decided by the
 * database, so the suite lives here now (the same move `preferences` made for
 * the same defect). Every case it held is kept below.
 *
 * Two audit defects are pinned here:
 *   - the before-image was an unlocked read taken BEFORE the transaction, so a
 *     write to the row committing in between (a second save, the Mac app, a
 *     dose log moving `inventoryCount`) was missing from or misattributed in
 *     the audit row. PGlite serialises transactions, so the race itself cannot
 *     run; the lock's SQL and its place are pinned through `queryLog`.
 *   - `updatedAt` was diffed, so a Save with nothing changed wrote an audit row.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { auditLogs, medications, medicationSchedules } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb, queryLog } from "../helpers/pg-db";

const { updateMedicationWithSchedules } = await import("../../../src/lib/server/medications");

/** Exactly what the seeded medication already holds, so passing it unchanged
    is a no-op save. */
const sameInput = {
  name: "Test Med",
  dosageAmount: "1",
  dosageUnit: "mg",
  form: "tablet" as const,
  category: "supplement" as const,
  colour: "#ffffff",
  pattern: "solid" as const,
  scheduleType: "scheduled" as const,
  scheduleIntervalHours: undefined,
  inventoryCount: 10,
  // Required on MedicationInput because the Zod fields carry defaults.
  notificationsEnabled: true,
  notifyOverdueEmail: null,
  notifyOverduePush: null,
  notifyLowInventoryEmail: null,
  notifyLowInventoryPush: null,
  notifyOffsetMinutes: 0,
  notifyRepeatEveryMinutes: null,
  notifyMaxRepeats: 3,
};

const editInput = { ...sameInput, name: "New Name", dosageAmount: "1000", dosageUnit: "IU" };

async function med() {
  const [row] = await pgDb.db.select().from(medications).where(eq(medications.id, "m1"));
  return row;
}

async function schedules() {
  return pgDb.db
    .select({
      scheduleKind: medicationSchedules.scheduleKind,
      intervalHours: medicationSchedules.intervalHours,
      timeOfDay: medicationSchedules.timeOfDay,
    })
    .from(medicationSchedules)
    .where(eq(medicationSchedules.medicationId, "m1"))
    .orderBy(asc(medicationSchedules.sortOrder));
}

async function updateAudits() {
  return pgDb.db
    .select({ entityId: auditLogs.entityId, changes: auditLogs.changes })
    .from(auditLogs)
    .where(eq(auditLogs.action, "update"));
}

async function failInsertsInto(table: string) {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION test_fail_insert() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'insert into ${table} failed'; END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER test_fail_insert BEFORE INSERT ON "${table}"
      FOR EACH ROW EXECUTE FUNCTION test_fail_insert();
  `);
}

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  await pgDb.seedMedication({ inventoryCount: 10, category: "supplement" });
  await pgDb.seedSchedule({ scheduleKind: "fixed_time", timeOfDay: "08:00" });
  queryLog.length = 0;
});

afterEach(async () => {
  await pgDb.client.exec(`
    DROP TRIGGER IF EXISTS test_fail_insert ON "medication_schedules";
    DROP TRIGGER IF EXISTS test_fail_insert ON "audit_logs";
  `);
});

describe("updateMedicationWithSchedules", () => {
  it("updates the medication, replaces its schedules and writes one audit row", async () => {
    const result = await updateMedicationWithSchedules("u1", "m1", editInput, [
      { scheduleKind: "interval", intervalHours: 8 },
    ]);

    expect(result?.name).toBe("New Name");
    expect((await med()).name).toBe("New Name");
    expect(await schedules()).toEqual([
      { scheduleKind: "interval", intervalHours: "8", timeOfDay: null },
    ]);
    expect(await updateAudits()).toEqual([
      {
        entityId: "m1",
        changes: {
          name: { from: "Test Med", to: "New Name" },
          dosageAmount: { from: "1", to: "1000" },
          dosageUnit: { from: "mg", to: "IU" },
        },
      },
    ]);
  });

  it("returns null and writes nothing when the medication is missing or another user's", async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "theirs", userId: "u2", name: "Theirs" });

    expect(await updateMedicationWithSchedules("u1", "missing", editInput, [])).toBeNull();
    expect(await updateMedicationWithSchedules("u1", "theirs", editInput, [])).toBeNull();

    const [theirs] = await pgDb.db.select().from(medications).where(eq(medications.id, "theirs"));
    expect(theirs.name).toBe("Theirs");
    expect((await med()).name).toBe("Test Med");
    expect(await schedules()).toHaveLength(1);
    expect(await pgDb.db.select().from(auditLogs)).toEqual([]);
  });

  it("rolls back the entire transaction when the schedules insert throws", async () => {
    await failInsertsInto("medication_schedules");

    await expect(
      updateMedicationWithSchedules("u1", "m1", editInput, [
        { scheduleKind: "interval", intervalHours: 8 },
      ]),
    ).rejects.toThrow();

    expect((await med()).name).toBe("Test Med");
    expect(await schedules()).toEqual([
      { scheduleKind: "fixed_time", intervalHours: null, timeOfDay: "08:00" },
    ]);
    expect(await pgDb.db.select().from(auditLogs)).toEqual([]);
  });

  it("rolls back the transaction when the audit insert throws", async () => {
    await failInsertsInto("audit_logs");

    await expect(
      updateMedicationWithSchedules("u1", "m1", editInput, [{ scheduleKind: "prn" }]),
    ).rejects.toThrow();

    expect((await med()).name).toBe("Test Med");
    expect(await schedules()).toEqual([
      { scheduleKind: "fixed_time", intervalHours: null, timeOfDay: "08:00" },
    ]);
  });

  it("leaves no schedule rows when the new schedules array is empty", async () => {
    await updateMedicationWithSchedules("u1", "m1", editInput, []);

    expect(await schedules()).toEqual([]);
    expect(await updateAudits()).toHaveLength(1);
  });
});

describe("updateMedicationWithSchedules — notification settings", () => {
  it("persists the overrides on the updated row", async () => {
    await updateMedicationWithSchedules(
      "u1",
      "m1",
      { ...editInput, notificationsEnabled: false, notifyOverdueEmail: true },
      [],
    );

    const row = await med();
    expect(row.notificationsEnabled).toBe(false);
    expect(row.notifyOverdueEmail).toBe(true);
  });

  it("keeps null distinct from false on the way to the database", async () => {
    // A `?? false` or `|| null` in the enumeration would collapse the
    // tri-state at the last possible moment, after every other layer
    // took care to preserve it. Muting a medication a user has been
    // taking for months goes through this branch, not the create path.
    await pgDb.db
      .update(medications)
      .set({ notifyOverduePush: true, notifyLowInventoryEmail: null })
      .where(eq(medications.id, "m1"));

    await updateMedicationWithSchedules(
      "u1",
      "m1",
      { ...editInput, notifyOverduePush: null, notifyLowInventoryEmail: false },
      [],
    );

    const row = await med();
    expect(row.notifyOverduePush).toBeNull();
    expect(row.notifyLowInventoryEmail).toBe(false);
  });
});

describe("updateMedicationWithSchedules — the audit diff", () => {
  it("writes no audit row for a Save that changes nothing", async () => {
    const earlier = new Date("2026-01-01T00:00:00.000Z");
    await pgDb.db.update(medications).set({ updatedAt: earlier }).where(eq(medications.id, "m1"));

    await updateMedicationWithSchedules("u1", "m1", sameInput, [
      { scheduleKind: "fixed_time", timeOfDay: "08:00" },
    ]);

    // The row was rewritten (updatedAt moved, so the next sync sends it)...
    expect((await med()).updatedAt.getTime()).toBeGreaterThan(earlier.getTime());
    // ...but the user changed nothing, so there is nothing to audit.
    expect(await updateAudits()).toEqual([]);
  });

  it("never lists updatedAt in a real edit's diff", async () => {
    await updateMedicationWithSchedules("u1", "m1", { ...sameInput, name: "Renamed" }, []);

    const [row] = await updateAudits();
    expect(Object.keys(row.changes ?? {})).toEqual(["name"]);
  });

  it("reads its before-image under the medication row lock, inside the transaction", async () => {
    await updateMedicationWithSchedules("u1", "m1", editInput, []);

    const lockedRead = queryLog.findIndex(
      (q) => /^select /.test(q) && q.includes('from "medications"') && /for update/.test(q),
    );
    const unlockedRead = queryLog.findIndex(
      (q) => /^select /.test(q) && q.includes('from "medications"') && !/for update/.test(q),
    );
    const firstWrite = queryLog.findIndex(
      (q) =>
        q.startsWith('update "medications"') ||
        q.startsWith('delete from "medication_schedules"') ||
        q.startsWith('insert into "audit_logs"'),
    );

    expect(lockedRead).toBeGreaterThanOrEqual(0);
    // No unlocked read of the row the diff could be taken from.
    expect(unlockedRead).toBe(-1);
    // Lock order: the medication row first, before any write.
    expect(lockedRead).toBeLessThan(firstWrite);
  });

  it("diffs against the row as it stood under the lock", async () => {
    // The losing side of the race, seeded (PGlite cannot run the race): what a
    // concurrent writer left behind by the time the lock is granted, stock
    // moved from 10 to 9 by a dose log. The form posts the
    // count it loaded (10), an absolute overwrite, so the audit must record
    // 9 -> 10, the jump that put a dose's stock back.
    await pgDb.db.update(medications).set({ inventoryCount: 9 }).where(eq(medications.id, "m1"));

    await updateMedicationWithSchedules("u1", "m1", { ...sameInput, inventoryCount: 10 }, []);

    expect(await updateAudits()).toEqual([
      { entityId: "m1", changes: { inventoryCount: { from: 9, to: 10 } } },
    ]);
  });
});
