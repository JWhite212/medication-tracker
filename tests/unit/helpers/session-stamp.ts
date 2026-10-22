/**
 * Matches the `authenticatedAt` a sign-in passes to `lucia.createSession`:
 * a Date taken during the test, never one from before it started and never
 * one in the future. `expect.any(Date)` is not enough, because a caller that
 * stamped the session's `expiresAt` (30 days ahead) or an epoch would pass
 * it, and the destructive guard reads that stamp to decide whether an
 * account with no password signed in recently.
 *
 * Usage: record `testStart = Date.now()` in `beforeEach`, then
 * `toHaveBeenCalledWith(id, { authenticatedAt: stampedSince(testStart) })`.
 */
export function stampedSince(testStart: number) {
  return {
    asymmetricMatch: (actual: unknown) =>
      actual instanceof Date && actual.getTime() >= testStart && actual.getTime() <= Date.now(),
    toString: () => "StampedSince",
    toAsymmetricMatcher: () => `a Date between ${new Date(testStart).toISOString()} and now`,
  };
}
