// @vitest-environment node
import { rateLimitSurface } from "../helpers/rate-limit";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { reauthTokens } from "../../../src/lib/server/db/schema";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/auth/password", () => ({ verifyPassword: async () => true }));
vi.mock("$lib/server/auth/rate-limit", () =>
  rateLimitSurface({ primitive: async () => ({ allowed: true, retryAfterMs: 0 }) }),
);

import { pgDb } from "../helpers/pg-db";

const { confirmReauth, requireRecentReauth } = await import("../../../src/lib/server/auth/reauth");

/**
 * Redeeming a reauth token is a compare-and-set, and this file is where that
 * is decided.
 *
 * `fake-db` captures predicates without evaluating them, so it cannot tell a
 * guarded UPDATE from an unguarded one — and "guarded" is the entire
 * property. The previous two-step form (SELECT ... WHERE used_at IS NULL,
 * then UPDATE by id) passed a fake-backed suite while letting two concurrent
 * redemptions of the same token both succeed.
 *
 * That matters because single-use is what makes one password entry authorise
 * ONE destructive action. `/api/v1/commands` allows 60 requests a minute and
 * the reserve-first idempotency ledger only serialises duplicates of the same
 * command id — not two different ids carrying the same token.
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

async function mint(purpose = "wipe_dose_history" as const): Promise<string> {
  const result = await confirmReauth("u1", "correct", purpose);
  return result.token!;
}

/** Each test mints at most one token, so the single row is unambiguous. */
async function storedUsedAt(): Promise<Date | null> {
  const rows = await pgDb.db.select().from(reauthTokens);
  expect(rows).toHaveLength(1);
  return rows[0].usedAt;
}

describe("requireRecentReauth — single use, decided by the WHERE", () => {
  it("redeems a fresh token once and stamps used_at", async () => {
    const token = await mint();

    expect(await requireRecentReauth("u1", "wipe_dose_history", token)).toBe(true);
    expect(await storedUsedAt()).not.toBeNull();
  });

  it("refuses the same token a second time", async () => {
    const token = await mint();

    expect(await requireRecentReauth("u1", "wipe_dose_history", token)).toBe(true);
    expect(await requireRecentReauth("u1", "wipe_dose_history", token)).toBe(false);
  });

  it("lets only ONE of two concurrent redemptions win", async () => {
    // The defect this file exists for. Under the two-step form both of these
    // returned true, so one password entry authorised two wipes.
    const token = await mint();

    const results = await Promise.all([
      requireRecentReauth("u1", "wipe_dose_history", token),
      requireRecentReauth("u1", "wipe_dose_history", token),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("lets only one of FIVE concurrent redemptions win", async () => {
    const token = await mint();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => requireRecentReauth("u1", "wipe_dose_history", token)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("requireRecentReauth — what a token is bound to", () => {
  it("refuses a token minted for a different purpose, and leaves it unspent", async () => {
    // A token minted to delete the account must not also authorise a wipe —
    // and a refused attempt must not burn it, or the wrong door could spend
    // the user's confirmation.
    const token = await mint("delete_account" as never);

    expect(await requireRecentReauth("u1", "wipe_dose_history", token)).toBe(false);
    expect(await storedUsedAt()).toBeNull();
    expect(await requireRecentReauth("u1", "delete_account", token)).toBe(true);
  });

  it("refuses another user's token", async () => {
    await pgDb.seedUser({ id: "u2", email: "u2@example.com", passwordHash: "argon2-hash" });
    const token = await mint();

    expect(await requireRecentReauth("u2", "wipe_dose_history", token)).toBe(false);
    expect(await storedUsedAt()).toBeNull();
  });

  it("refuses an unknown token", async () => {
    await mint();
    expect(await requireRecentReauth("u1", "wipe_dose_history", "not-the-token")).toBe(false);
  });

  it("refuses an expired token", async () => {
    const token = await mint();
    // The TTL is 5 minutes; step past it.
    vi.setSystemTime(new Date("2026-04-15T12:06:00Z"));

    expect(await requireRecentReauth("u1", "wipe_dose_history", token)).toBe(false);
    expect(await storedUsedAt()).toBeNull();
  });

  it("stores a HASH, never the raw token", async () => {
    const token = await mint();
    const [row] = await pgDb.db.select().from(reauthTokens).where(eq(reauthTokens.userId, "u1"));

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toHaveLength(64);
  });
});
