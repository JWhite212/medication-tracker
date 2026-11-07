// @vitest-environment node
import { rateLimitSurface } from "../helpers/rate-limit";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { asc, eq } from "drizzle-orm";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/auth/password", () => ({ verifyPassword: async () => true }));
vi.mock("$lib/server/auth/rate-limit", () =>
  rateLimitSurface({ primitive: async () => ({ allowed: true, retryAfterMs: 0 }) }),
);

import { pgDb } from "../helpers/pg-db";
import {
  apiCommands,
  doseLogs,
  medications,
  reauthTokens,
} from "../../../src/lib/server/db/schema";

const { confirmReauth } = await import("../../../src/lib/server/auth/reauth");
const { dispatchCommand, runCommands, ReauthRequiredError } =
  await import("../../../src/lib/server/api/commands");

/**
 * The /api/v1 wipes spend their reauth token in the same transaction as the
 * wipe, so a wipe that rolls back leaves the token redeemable.
 *
 * It used to be redeemed on the autocommit `db` before the wipe opened its own
 * transaction. A wipe that then failed rolled its deletes back, `runCommands`
 * released the reservation for a retry, and the retry was refused because the
 * token was already spent: the user had to type the password again for a wipe
 * that never happened.
 *
 * Whether `used_at` survives a rollback is decided by the database, so this
 * runs on PGlite. The failure is a trigger on `audit_logs`, which each wipe
 * writes last, so everything before it, the redeem included, must roll back.
 */

beforeAll(() => {
  // Date only — faking all timers stalls PGlite's WASM layer.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser({ passwordHash: "argon2-hash" });
});

afterEach(async () => {
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
});

async function failAuditInserts(): Promise<void> {
  await pgDb.client.exec(`
    CREATE OR REPLACE FUNCTION test_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
    CREATE TRIGGER test_fail_write BEFORE INSERT ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION test_fail_write();
  `);
}

async function healAuditInserts(): Promise<void> {
  await pgDb.client.exec(`DROP TRIGGER IF EXISTS test_fail_write ON "audit_logs";`);
}

async function mint(purpose: "wipe_dose_history" | "wipe_archived_medications"): Promise<string> {
  const result = await confirmReauth("u1", "correct", purpose);
  expect(result.ok).toBe(true);
  return result.token!;
}

/** Each test mints one token, so the single row is unambiguous. */
async function storedUsedAt(): Promise<Date | null> {
  const rows = await pgDb.db.select().from(reauthTokens);
  expect(rows).toHaveLength(1);
  return rows[0].usedAt;
}

async function doseIds(): Promise<string[]> {
  const rows = await pgDb.db.select({ id: doseLogs.id }).from(doseLogs).orderBy(asc(doseLogs.id));
  return rows.map((r) => r.id);
}

async function medicationIds(): Promise<string[]> {
  const rows = await pgDb.db
    .select({ id: medications.id })
    .from(medications)
    .orderBy(asc(medications.id));
  return rows.map((r) => r.id);
}

describe("wipe_dose_history — the redeem commits with the wipe", () => {
  it("a wipe that rolls back leaves its token unspent, and the retry succeeds", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    const token = await mint("wipe_dose_history");
    await failAuditInserts();

    await expect(
      dispatchCommand("u1", "wipe_dose_history", { reauthToken: token }),
    ).rejects.toThrow(/insert into "audit_logs"/);

    expect(await doseIds()).toEqual(["d-a"]);
    expect(await storedUsedAt()).toBeNull();

    await healAuditInserts();
    await expect(
      dispatchCommand("u1", "wipe_dose_history", { reauthToken: token }),
    ).resolves.toEqual({ deleted: 1 });
    expect(await doseIds()).toEqual([]);
    expect(await storedUsedAt()).toEqual(new Date("2026-04-15T12:00:00Z"));
  });

  it("is still single use: a committed wipe spends the token", async () => {
    await pgDb.seedMedication();
    const token = await mint("wipe_dose_history");

    await expect(
      dispatchCommand("u1", "wipe_dose_history", { reauthToken: token }),
    ).resolves.toEqual({ deleted: 0 });
    await pgDb.seedDose({ id: "d-b" });

    await expect(
      dispatchCommand("u1", "wipe_dose_history", { reauthToken: token }),
    ).rejects.toThrow(ReauthRequiredError);
    expect(await doseIds()).toEqual(["d-b"]);
  });

  it("a token minted for the other wipe deletes nothing and is left unspent", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    const token = await mint("wipe_archived_medications");

    await expect(
      dispatchCommand("u1", "wipe_dose_history", { reauthToken: token }),
    ).rejects.toThrow(ReauthRequiredError);
    expect(await doseIds()).toEqual(["d-a"]);
    expect(await storedUsedAt()).toBeNull();
  });

  it("through the ledger: the same command id retried after a failed wipe goes through", async () => {
    await pgDb.seedMedication();
    await pgDb.seedDose({ id: "d-a" });
    const token = await mint("wipe_dose_history");
    const command = { id: "cmd-wipe", type: "wipe_dose_history", payload: { reauthToken: token } };
    await failAuditInserts();

    const [first] = await runCommands("u1", [command]);
    expect(first.ok).toBe(false);
    // The reservation was released, so the id may be retried.
    expect(
      await pgDb.db.select().from(apiCommands).where(eq(apiCommands.idempotencyKey, "cmd-wipe")),
    ).toEqual([]);

    await healAuditInserts();
    const [second] = await runCommands("u1", [command]);
    expect(second).toEqual({ id: "cmd-wipe", ok: true, result: { deleted: 1 } });
    expect(await doseIds()).toEqual([]);
  });
});

describe("wipe_archived_medications — the redeem commits with the wipe", () => {
  it("a wipe that rolls back leaves its token unspent, and the retry succeeds", async () => {
    await pgDb.seedMedication({ id: "m-arch", isArchived: true });
    const token = await mint("wipe_archived_medications");
    await failAuditInserts();

    await expect(
      dispatchCommand("u1", "wipe_archived_medications", { reauthToken: token }),
    ).rejects.toThrow(/insert into "audit_logs"/);

    expect(await medicationIds()).toEqual(["m-arch"]);
    expect(await storedUsedAt()).toBeNull();

    await healAuditInserts();
    await expect(
      dispatchCommand("u1", "wipe_archived_medications", { reauthToken: token }),
    ).resolves.toEqual({ deleted: 1 });
    expect(await medicationIds()).toEqual([]);
    expect(await storedUsedAt()).not.toBeNull();
  });
});
