// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { rateLimits, passwordResetTokens } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

const logged: Array<{ message: string; fields: Record<string, unknown> }> = [];
vi.mock("$lib/server/log", () => ({
  logWarn: (message: string, fields: Record<string, unknown>) => logged.push({ message, fields }),
  logError: (message: string, fields: Record<string, unknown>) => logged.push({ message, fields }),
}));

import { pgDb } from "../helpers/pg-db";

const { runRetention, runRetentionForTick, RETENTION_POLICIES } =
  await import("../../../src/lib/server/retention");

/**
 * Retention is three DELETE predicates, so it belongs on real Postgres —
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
