import { lt } from "drizzle-orm";
import { db } from "$lib/server/db";
import { passwordResetTokens, rateLimits } from "$lib/server/db/schema";
import { purgeExpiredReminderEvents } from "$lib/server/reminders/retention";
import { logError, logWarn } from "$lib/server/log";

/**
 * Everything this app deletes on a schedule, in one place.
 *
 * Three subsystems' data lifecycles used to live as three consecutive
 * `await`s inside the reminder cron handler — one with a module, two as
 * inline SQL. Two problems, and the second is the serious one.
 *
 * "What does this app retain?" had no single answer: you could only find out
 * by reading a route handler, and `docs/architecture.md` did not mention that
 * the handler did retention at all.
 *
 * And the sequence was a chain. Every purge sat below two awaited reminder
 * sweeps, so a throw anywhere above skipped all of them — silently, because
 * the loud symptom is the missing reminders and nobody goes looking for the
 * garbage collection behind them. That is the same shape as the four-month
 * CRON_SECRET outage. Each policy now runs independently and reports its own
 * failure.
 *
 * WHAT THIS IS NOT: a fix for a broken limiter. An expired `rate_limits` row
 * is already harmless — `enforceLimit`'s `CASE` arms restart the window when
 * `resetAt` has passed, so a stale row is not a live count. Skipped GC costs
 * unbounded table growth and a slower sweep, not a locked-out user. Worth
 * being exact about, because the opposite belief would make this urgent and
 * it is not.
 *
 * The `preauth:` carve-out matters here and is easy to miss: `rate_limits`
 * doubles as the single-use nonce ledger for pre-auth claims (`max: 1` — the
 * row IS the replay guard). Deleting an UNEXPIRED preauth row would let a
 * captured 2FA challenge token mint a second session. The predicate below is
 * `resetAt < now`, and a preauth row's `resetAt` is the claim's own expiry,
 * so an expired row cannot be replayed anyway — but any future change to
 * this predicate has to preserve that.
 */

export interface RetentionResult {
  policy: string;
  ok: boolean;
}

/** One named sweep. `now` is a parameter so the boundary is testable. */
interface RetentionPolicy {
  readonly name: string;
  readonly purge: (now: Date) => Promise<unknown>;
}

export const RETENTION_POLICIES: readonly RetentionPolicy[] = [
  {
    // Single-use tokens whose window has closed. A consumed token is stamped
    // rather than deleted, so this only reaps ones that were never redeemed.
    name: "password-reset-tokens",
    purge: (now) => db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now)),
  },
  {
    name: "rate-limits",
    purge: (now) => db.delete(rateLimits).where(lt(rateLimits.resetAt, now)),
  },
  {
    name: "reminder-events",
    purge: (now) => purgeExpiredReminderEvents(now),
  },
];

/**
 * Run every retention policy, independently.
 *
 * `allSettled`, not a chain: one failing sweep must not cancel the others,
 * and it must be visible rather than inferred from a table that quietly stops
 * shrinking. Never throws — the caller is a cron handler whose primary job is
 * reminders, and failing the tick over garbage collection would trade a
 * cleanup problem for a delivery one.
 */
export async function runRetention(now: Date): Promise<RetentionResult[]> {
  const settled = await Promise.allSettled(
    RETENTION_POLICIES.map(async (policy) => {
      await policy.purge(now);
      return policy.name;
    }),
  );

  return settled.map((outcome, index) => {
    const policy = RETENTION_POLICIES[index];
    if (outcome.status === "fulfilled") return { policy: policy.name, ok: true };

    logWarn("retention policy failed", { scope: "retention", policy: policy.name }, outcome.reason);
    return { policy: policy.name, ok: false };
  });
}

/**
 * `runRetention`, with a single summary line when anything failed.
 *
 * Separate from the loop above so the per-policy detail and the "this tick
 * did not fully clean up" signal are distinguishable in a log search.
 */
export async function runRetentionForTick(now: Date): Promise<RetentionResult[]> {
  const results = await runRetention(now);
  const failed = results.filter((result) => !result.ok).map((result) => result.policy);

  if (failed.length > 0) {
    logError("retention incomplete", { scope: "retention", failed, total: results.length });
  }

  return results;
}
