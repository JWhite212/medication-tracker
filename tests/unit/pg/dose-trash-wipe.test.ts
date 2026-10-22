// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/**
 * The Undo trash under the three bulk deletes.
 *
 * - "Delete dose history" (`wipeDoseHistory`) locks every one of the user's
 *   medications in ascending id order, deletes the doses, then deletes the
 *   trash (D7). PGlite serialises transactions and cannot race one, so the
 *   order is pinned by its SQL in `queryLog`.
 * - "Delete archived medications" (`wipeArchivedMedications`) and account
 *   deletion reach the trash only through `ON DELETE CASCADE` on its two
 *   foreign keys, from migration 0021. No application code is involved,
 *   which is why it needs a test: dropping a cascade from the SQL would be
 *   invisible everywhere else. PGlite applies the real migrations.
 * - After any of them, an Undo offered earlier is "Too late to undo".
 *
 * The `wipeDoseHistory` cases moved here from the fake-db file
 * `tests/unit/api/wipe.test.ts`, because its medication lock is a select
 * `.for()`, which that fake does not have and must not grow (CLAUDE.md,
 * test-seam rule).
 */

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
// Account deletion re-checks the password and ends the sessions before its
// one DELETE. Neither is what this file tests, so both succeed. The seeded
// `u1` has no password, so `checkDestructiveGuard` passes on the typed word
// and the session's recent sign-in, and the mocked `confirmReauth` is never
// reached; that also runs the passwordless path on real Postgres.
vi.mock("$lib/server/auth/reauth", () => ({
  confirmReauth: async () => ({ ok: true }),
  reauthMessage: () => "Incorrect password.",
}));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    invalidateUserSessions: async () => {},
    createBlankSessionCookie: () => ({ name: "auth_session", value: "", attributes: {} }),
  },
}));

import { pgDb, queryLog } from "../helpers/pg-db";
import {
  medications,
  doseLogs,
  doseLogTrash,
  users,
  auditLogs,
} from "../../../src/lib/server/db/schema";
import { asc, eq } from "drizzle-orm";

const { wipeDoseHistory, wipeArchivedMedications } =
  await import("../../../src/lib/server/api/wipe");
const { logDose, deleteDose, restoreDose } = await import("../../../src/lib/server/doses");
const { restoreDoseAction, RESTORE_GONE_MESSAGE } =
  await import("../../../src/lib/server/dose-actions");
const { actions: dataActions } =
  await import("../../../src/routes/(app)/settings/data/+page.server");

/** Five minutes after `seedTrash`'s default `deletedAt`: its rows are live. */
const NOW = new Date("2026-08-01T09:05:00.000Z");

async function trashIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .orderBy(asc(doseLogTrash.id));
  return rows.map((r) => r.id);
}

async function doseIds(): Promise<string[]> {
  const rows = await pgDb.db.select({ id: doseLogs.id }).from(doseLogs).orderBy(asc(doseLogs.id));
  return rows.map((r) => r.id);
}

async function syncEpoch(userId = "u1"): Promise<number> {
  const [row] = await pgDb.db
    .select({ syncEpoch: users.syncEpoch })
    .from(users)
    .where(eq(users.id, userId));
  return row.syncEpoch;
}

/** Another user with a medication and a trash row, for the scope checks. */
async function seedOtherUser() {
  await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
  await pgDb.seedMedication({ id: "m2", userId: "u2" });
  await pgDb.seedTrash({ id: "t-u2", userId: "u2", medicationId: "m2" });
}

/**
 * Make every INSERT into `audit_logs` raise. Each wipe's audit row is its
 * last write, so this proves everything before it rolls back too. Dropped in
 * `afterEach`.
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
  queryLog.length = 0;
});

afterEach(async () => {
  vi.useRealTimers();
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
});

describe("wipeDoseHistory", () => {
  it("locks the user's medications in id order, then deletes the doses, then the trash", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    await pgDb.seedTrash({ id: "t-a" });
    queryLog.length = 0;

    await wipeDoseHistory("u1");

    const lock = queryLog.findIndex((q) => /from "medications"/.test(q) && /for update/.test(q));
    const doses = queryLog.findIndex((q) => q.startsWith(`delete from "dose_logs"`));
    const trash = queryLog.findIndex((q) => q.startsWith(`delete from "dose_log_trash"`));
    const epoch = queryLog.findIndex((q) => q.startsWith(`update "users"`));
    expect([lock, doses, trash, epoch].every((index) => index >= 0)).toBe(true);
    // Ascending id when there is more than one, like every multi-row lock (D7).
    expect(queryLog[lock]).toMatch(/order by "medications"\."id" asc for update/);
    expect(lock).toBeLessThan(doses);
    expect(doses).toBeLessThan(trash);
    expect(trash).toBeLessThan(epoch);
  });

  it("returns the dose count, bumps the sync epoch once and audits the count", async () => {
    await pgDb.seedMedication();
    for (const id of ["d-a", "d-b", "d-c"]) await pgDb.seedDose({ id });
    // A trash row is not part of the history the user could see, so it is
    // deleted but not counted.
    await pgDb.seedTrash({ id: "t-a" });

    await expect(wipeDoseHistory("u1")).resolves.toEqual({ deleted: 3 });

    expect(await doseIds()).toEqual([]);
    expect(await trashIds()).toEqual([]);
    expect(await syncEpoch()).toBe(1);
    const audits = await pgDb.db.select().from(auditLogs);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      userId: "u1",
      entityType: "dose_log",
      entityId: "*",
      action: "delete",
      changes: { deleted: { from: 3, to: 0 } },
    });
  });

  it("returns {deleted: 0} when there is nothing to wipe", async () => {
    await expect(wipeDoseHistory("u1")).resolves.toEqual({ deleted: 0 });

    const [audit] = await pgDb.db.select().from(auditLogs);
    expect(audit.changes).toEqual({ deleted: { from: 0, to: 0 } });
  });

  it("empties this user's trash and no one else's", async () => {
    await pgDb.seedMedication();
    await pgDb.seedTrash({ id: "t-u1" });
    await seedOtherUser();
    await pgDb.seedDose({ id: "d-u2", userId: "u2", medicationId: "m2" });

    await wipeDoseHistory("u1");

    expect(await trashIds()).toEqual(["t-u2"]);
    expect(await doseIds()).toEqual(["d-u2"]);
  });

  it("rolls back the doses, the trash and the epoch when its audit insert fails", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    await pgDb.seedTrash({ id: "t-a" });
    await failAuditInserts();

    await expect(wipeDoseHistory("u1")).rejects.toThrow(/insert into "audit_logs"/);

    expect(await doseIds()).toEqual(["d-a"]);
    expect(await trashIds()).toEqual(["t-a"]);
    expect(await syncEpoch()).toBe(0);
  });

  it("turns an Undo offered before it into Too late to undo", async () => {
    await pgDb.seedMedication({ inventoryCount: 10 });
    const dose = await logDose("u1", "m1", 1);
    const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
    expect(deleted).not.toBeNull();

    await wipeDoseHistory("u1");

    await expect(restoreDose("u1", dose.id, deleted!.deletedAt)).resolves.toBe("gone");
    expect(await doseIds()).toEqual([]);
  });
});

describe("wipeArchivedMedications", () => {
  it("cascades to the archived medication's trash rows and leaves an active one's", async () => {
    await pgDb.seedMedication({ id: "m-archived", isArchived: true, archivedAt: NOW });
    await pgDb.seedMedication({ id: "m-active" });
    await pgDb.seedTrash({ id: "t-archived", medicationId: "m-archived" });
    await pgDb.seedTrash({ id: "t-active", medicationId: "m-active" });

    await expect(wipeArchivedMedications("u1")).resolves.toEqual({ deleted: 1 });

    expect(await trashIds()).toEqual(["t-active"]);
  });

  it("Review Focus #5: a dose deleted before its medication is archived and wiped cannot be restored", async () => {
    await pgDb.seedMedication({ inventoryCount: 10 });
    const dose = await logDose("u1", "m1", 1);
    const deleted = await deleteDose("u1", dose.id, { keepForUndo: true });
    await pgDb.db
      .update(medications)
      .set({ isArchived: true, archivedAt: NOW })
      .where(eq(medications.id, "m1"));
    await wipeArchivedMedications("u1");

    // Through the real action, so the person sees the real copy.
    const result = await restoreDoseAction({
      locals: { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } },
      request: new Request("http://localhost/dashboard?/restoreDose", {
        method: "POST",
        body: new URLSearchParams({
          doseId: dose.id,
          deletedAt: deleted!.deletedAt.toISOString(),
        }),
      }),
    } as never);

    expect(result).toMatchObject({ status: 410, data: { error: RESTORE_GONE_MESSAGE } });
    expect(RESTORE_GONE_MESSAGE).toBe("Too late to undo. Log it again if you need it.");
    expect(await doseIds()).toEqual([]);
    expect(await trashIds()).toEqual([]);
  });
});

describe("account deletion", () => {
  it("removes every one of the user's trash rows, and no one else's", async () => {
    await pgDb.seedMedication({ id: "m1" });
    await pgDb.seedMedication({ id: "m1b" });
    await pgDb.seedTrash({ id: "t-a", medicationId: "m1" });
    await pgDb.seedTrash({ id: "t-b", medicationId: "m1b" });
    await seedOtherUser();
    const cookies = { set: vi.fn() };

    // The real action: its one statement is `db.delete(users)`, and
    // everything else hangs off the cascades.
    await expect(
      dataActions.deleteAccount({
        request: new Request("http://localhost/settings/data?/deleteAccount", {
          method: "POST",
          body: new URLSearchParams({
            confirmWord: "DELETE",
            password: "correct horse battery staple",
          }),
        }),
        locals: { user: { id: "u1" }, session: { id: "s1", authenticatedAt: new Date() } },
        cookies,
      } as never),
    ).rejects.toMatchObject({ status: 302, location: "/" });

    expect(await pgDb.db.select().from(users).where(eq(users.id, "u1"))).toEqual([]);
    expect(await trashIds()).toEqual(["t-u2"]);
  });
});
