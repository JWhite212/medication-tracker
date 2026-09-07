import { sql, and, eq, gt } from "drizzle-orm";
import { db } from "$lib/server/db";
import { rateLimits } from "$lib/server/db/schema";
import { QUARTER_HOUR, type LimitPolicy } from "./rate-limit-policy";

// The policy table itself lives in `rate-limit-policy.ts`, which imports no
// database. Re-exported here so a door needs one import, not two.
export * from "./rate-limit-policy";

function keyFor(policy: LimitPolicy, identity: string): string {
  return `${policy.namespace}:${identity}`;
}

/**
 * Spend one unit of `policy`'s budget for `identity`, and report whether it
 * was within it.
 *
 * One atomic upsert, so concurrent requests cannot both read the same count
 * and both decide they are allowed. The `CASE` arms roll the window over
 * in the same statement: a row whose `resetAt` has passed restarts at 1
 * rather than continuing an expired count, which is why an expired row is
 * harmless even if garbage collection never runs.
 *
 * Note this INCREMENTS. For a budget that should only be spent by failures,
 * use `peekLimit` before and `recordFailure` after — see `loginAccount`.
 */
export async function enforceLimit(
  policy: LimitPolicy,
  identity: string,
  options?: { windowMs?: number },
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  return checkRateLimit(keyFor(policy, identity), policy.max, options?.windowMs ?? policy.windowMs);
}

/**
 * Is `identity` currently over `policy`'s budget, WITHOUT spending any of it?
 *
 * The read half of a count-failures-not-attempts limit. A correct password
 * must not consume budget, or the limit becomes a denial-of-service tool
 * against the account it protects.
 *
 * A missing row and an expired row both mean "allowed": the window is closed
 * over in `enforceLimit`'s `CASE`, so a stale row is not a live count.
 */
export async function peekLimit(
  policy: LimitPolicy,
  identity: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const [row] = await db
    .select({ count: rateLimits.count, resetAt: rateLimits.resetAt })
    .from(rateLimits)
    .where(and(eq(rateLimits.key, keyFor(policy, identity)), gt(rateLimits.resetAt, new Date())))
    .limit(1);

  if (!row) return { allowed: true, retryAfterMs: 0 };

  // `<` not `<=`, and the difference is a whole extra guess.
  //
  // `enforceLimit` compares the count AFTER its own increment, so `count <=
  // max` there means "this attempt was within budget". Peek runs BEFORE the
  // attempt it is authorising, so the same comparison would admit the
  // (max + 1)th. Measured: the attacker got six guesses against a budget
  // of five.
  return {
    allowed: row.count < policy.max,
    retryAfterMs: Math.max(0, row.resetAt.getTime() - Date.now()),
  };
}

/** Spend one unit, discarding the verdict. The write half of `peekLimit`. */
export async function recordFailure(policy: LimitPolicy, identity: string): Promise<void> {
  await enforceLimit(policy, identity);
}

/**
 * The primitive. Prefer `enforceLimit` with a named policy — a raw key here
 * is a door nothing can enumerate, which is the state this module exists to
 * leave behind.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = QUARTER_HOUR,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const windowEnd = new Date(Date.now() + windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: windowEnd })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE
          WHEN ${rateLimits.resetAt} < NOW() THEN 1
          ELSE ${rateLimits.count} + 1
        END`,
        resetAt: sql`CASE
          WHEN ${rateLimits.resetAt} < NOW() THEN ${windowEnd}
          ELSE ${rateLimits.resetAt}
        END`,
      },
    })
    .returning();

  const retryAfterMs = Math.max(0, row.resetAt.getTime() - Date.now());
  return { allowed: row.count <= maxAttempts, retryAfterMs };
}
