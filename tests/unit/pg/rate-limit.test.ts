// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { rateLimits } from "../../../src/lib/server/db/schema";

// Real Postgres, not the fake: every assertion below is about what the
// two CASE arms in the upsert evaluate to, which a fake cannot produce.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { checkRateLimit } = await import("../../../src/lib/server/auth/rate-limit");

beforeEach(async () => {
  await pgDb.reset();
});

describe("checkRateLimit — counting inside the window", () => {
  it("increments on each attempt and denies once the ceiling is passed", async () => {
    const key = "login:u1";
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 1
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 2
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(true); // count 3
    expect((await checkRateLimit(key, 3, 60_000)).allowed).toBe(false); // count 4
  });

  it("does not extend the window when an attempt is made inside it", async () => {
    const key = "login:u1";
    const original = new Date(Date.now() + 60_000);
    await pgDb.db.insert(rateLimits).values({ key, count: 1, resetAt: original });

    await checkRateLimit(key, 5, 15 * 60_000);

    const [row] = await pgDb.db.select().from(rateLimits).where(eq(rateLimits.key, key));
    // The ELSE arm keeps the original resetAt. If it did not, an attacker
    // could push their own lockout further out by continuing to hammer.
    expect(row.resetAt.getTime()).toBe(original.getTime());
    expect(row.count).toBe(2);
  });
});

describe("checkRateLimit — window expiry", () => {
  it("resets the counter to 1 once resetAt is in the past", async () => {
    const key = "login:u1";
    await pgDb.db.insert(rateLimits).values({
      key,
      count: 99,
      resetAt: new Date(Date.now() - 1_000),
    });

    const result = await checkRateLimit(key, 5, 60_000);

    // 99 attempts, but the window had expired: the CASE resets to 1 and
    // the caller is allowed through.
    expect(result.allowed).toBe(true);
    const [row] = await pgDb.db.select().from(rateLimits).where(eq(rateLimits.key, key));
    expect(row.count).toBe(1);
    expect(row.resetAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("keeps separate keys independent", async () => {
    await checkRateLimit("login:u1", 1, 60_000);
    await checkRateLimit("login:u1", 1, 60_000);
    // u2 is untouched by u1 exhausting its allowance.
    expect((await checkRateLimit("login:u2", 1, 60_000)).allowed).toBe(true);
  });
});
