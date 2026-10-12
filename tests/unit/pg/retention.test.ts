// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { asc } from "drizzle-orm";
import { rateLimits, passwordResetTokens, doseLogTrash } from "../../../src/lib/server/db/schema";
import { DOSE_UNDO_WINDOW_MS } from "../../../src/lib/utils/dose-undo";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
vi.mock("$lib/server/log", () => ({
  logWarn: (message: string, fields: Record<string, unknown>) => logged.push({ message, fields }),
  logError: (message: string, fields: Record<string, unknown>) => logged.push({ message, fields }),
}));

import { pgDb, queryLog } from "../helpers/pg-db";

const { runRetention, runRetentionForTick, RETENTION_POLICIES } =
  await import("../../../src/lib/server/retention");

/**
 * Retention is four DELETE predicates, so it belongs on real Postgres —
 * `fake-db` records a `where` without evaluating it, and which rows survive
 * is the whole behaviour.
 *
 * The property that matters most is not the deletes themselves but the
 * INDEPENDENCE: these used to be consecutive awaits below two reminder
 * sweeps, so one throw skipped every purge below it, silently.
 */

const NOW = new Date("2026-04-15T12:00:00Z");
const HOUR = 3_600_000;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
  await pgDb.seedUser();
  logged.length = 0;
});

async function seedRateLimit(key: string, resetAt: Date) {
  await pgDb.db.insert(rateLimits).values({ key, count: 3, resetAt });
}

describe("what each policy deletes", () => {
  it("reaps expired rate-limit rows and leaves live ones", async () => {
    await seedRateLimit("login-ip:1.2.3.4", new Date(NOW.getTime() - HOUR));
    await seedRateLimit("login-account:ada@example.com", new Date(NOW.getTime() + HOUR));

    await runRetention(NOW);

    const remaining = await pgDb.db.select().from(rateLimits);
    expect(remaining.map((row) => row.key)).toEqual(["login-account:ada@example.com"]);
  });

  it("leaves an UNEXPIRED preauth burn row alone", async () => {
    // `rate_limits` doubles as the single-use nonce ledger for pre-auth
    // claims — the row IS the replay guard. Deleting a live one would let a
    // captured 2FA challenge token mint a second session.
    await seedRateLimit("preauth:jti-live", new Date(NOW.getTime() + 5 * 60_000));
    await seedRateLimit("preauth:jti-dead", new Date(NOW.getTime() - 1));

    await runRetention(NOW);

    const remaining = await pgDb.db.select().from(rateLimits);
    expect(remaining.map((row) => row.key)).toEqual(["preauth:jti-live"]);
  });

  it("reaps expired password-reset tokens and leaves live ones", async () => {
    await pgDb.db.insert(passwordResetTokens).values([
      { id: "t-dead", userId: "u1", tokenHash: "a", expiresAt: new Date(NOW.getTime() - HOUR) },
      { id: "t-live", userId: "u1", tokenHash: "b", expiresAt: new Date(NOW.getTime() + HOUR) },
    ]);

    await runRetention(NOW);

    const remaining = await pgDb.db.select().from(passwordResetTokens);
    expect(remaining.map((row) => row.id)).toEqual(["t-live"]);
  });

  it("reports every policy it ran", async () => {
    const results = await runRetention(NOW);

    expect(results.map((r) => r.policy).sort()).toEqual(
      RETENTION_POLICIES.map((p) => p.name).sort(),
    );
    expect(results.every((r) => r.ok)).toBe(true);
  });
});

describe("the dose-log-trash policy", () => {
  /** "Expired" is `deleted_at <= now − window`: the cutoff itself is expired. */
  const cutoff = NOW.getTime() - DOSE_UNDO_WINDOW_MS;

  async function seedTrashForTwoUsers() {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com" });
    await pgDb.seedMedication({ id: "m1", userId: "u1" });
    await pgDb.seedMedication({ id: "m2", userId: "u2" });
    await pgDb.seedTrash({ id: "u1-at-cutoff", userId: "u1", deletedAt: new Date(cutoff) });
    await pgDb.seedTrash({ id: "u1-live", userId: "u1", deletedAt: new Date(cutoff + 1) });
    await pgDb.seedTrash({
      id: "u2-old",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(cutoff - HOUR),
    });
    await pgDb.seedTrash({
      id: "u2-live",
      userId: "u2",
      medicationId: "m2",
      deletedAt: new Date(NOW.getTime() - 60_000),
    });
  }

  it("is registered", () => {
    expect(RETENTION_POLICIES.map((p) => p.name)).toContain("dose-log-trash");
  });

  it("purges every user's expired rows, the cutoff included, and keeps live ones", async () => {
    await seedTrashForTwoUsers();

    const results = await runRetention(NOW);

    expect(results.find((r) => r.policy === "dose-log-trash")?.ok).toBe(true);
    const remaining = await pgDb.db
      .select({ id: doseLogTrash.id })
      .from(doseLogTrash)
      .orderBy(asc(doseLogTrash.id));
    expect(remaining.map((row) => row.id)).toEqual(["u1-live", "u2-live"]);
  });

  it("never waits on a row another transaction holds, and is scoped by time alone", async () => {
    // A purge that waited could close a lock cycle with a restore, a wipe or
    // a cascade. One that skips a locked row only purges it on a later tick.
    queryLog.length = 0;

    await RETENTION_POLICIES.find((p) => p.name === "dose-log-trash")!.purge(NOW);

    const purge = queryLog.filter((q) => q.includes(`"dose_log_trash"`));
    expect(purge.length).toBeGreaterThan(0);
    expect(purge.some((q) => /for update skip locked/.test(q))).toBe(true);
    expect(purge.some((q) => q.includes(`"user_id"`))).toBe(false);
  });
});

describe("one failing policy does not cancel the others", () => {
  it("still runs the rest, and says which one failed", async () => {
    // The defect this module exists for: a chain of awaits meant the first
    // throw skipped everything below it, and the only symptom was a table
    // that quietly stopped shrinking.
    const broken = RETENTION_POLICIES.find((p) => p.name === "password-reset-tokens")!;
    const original = broken.purge;
    (broken as { purge: unknown }).purge = async () => {
      throw new Error("relation does not exist");
    };

    try {
      await seedRateLimit("login-ip:1.2.3.4", new Date(NOW.getTime() - HOUR));

      const results = await runRetentionForTick(NOW);

      // The survivor still ran.
      expect(await pgDb.db.select().from(rateLimits)).toEqual([]);

      expect(results.find((r) => r.policy === "password-reset-tokens")?.ok).toBe(false);
      expect(results.find((r) => r.policy === "rate-limits")?.ok).toBe(true);
    } finally {
      (broken as { purge: unknown }).purge = original;
    }
  });

  it("never throws, so a cleanup failure cannot fail the reminder tick", async () => {
    const broken = RETENTION_POLICIES.find((p) => p.name === "rate-limits")!;
    const original = broken.purge;
    (broken as { purge: unknown }).purge = async () => {
      throw new Error("boom");
    };

    try {
      await expect(runRetentionForTick(NOW)).resolves.toBeDefined();

      // ...and it is visible rather than inferred.
      expect(logged.map((l) => l.message)).toContain("retention policy failed");
      expect(logged.map((l) => l.message)).toContain("retention incomplete");
    } finally {
      (broken as { purge: unknown }).purge = original;
    }
  });

  it("logs nothing when every policy succeeds", async () => {
    await runRetentionForTick(NOW);
    expect(logged).toEqual([]);
  });
});
