import * as POLICY from "$lib/server/auth/rate-limit-policy";
import type { LimitPolicy } from "$lib/server/auth/rate-limit-policy";

type Verdict = { allowed: boolean; retryAfterMs: number };
type Primitive = (key: string, max?: number, windowMs?: number) => Promise<Verdict> | Verdict;

/**
 * The mocked surface of `$lib/server/auth/rate-limit`, built from one spy on
 * the primitive.
 *
 * Twelve suites mock this module, and every one of them mocked
 * `checkRateLimit` alone — which is why the whole app could move onto named
 * policies without a single assertion noticing. Routing `enforceLimit`
 * through the same spy, with the key rebuilt exactly as the real module
 * builds it, keeps those assertions meaningful: a test that pins
 * `preauth:jti-1` is still pinning the key production writes.
 *
 * `peekLimit` is deliberately NOT routed through the spy by default. It
 * reads without spending, so counting it as a call would inflate every
 * `rlCalls.length` assertion in the login suites; and its real behaviour is
 * a SQL predicate, which belongs on PGlite rather than behind a fake. Pass
 * `peek` when a test needs to drive it.
 */
export function rateLimitSurface(options: { primitive: Primitive; peek?: Primitive }) {
  const spend = (policy: LimitPolicy, identity: string, windowMs?: number) =>
    options.primitive(`${policy.namespace}:${identity}`, policy.max, windowMs ?? policy.windowMs);

  return {
    ...POLICY,
    checkRateLimit: options.primitive,
    enforceLimit: (policy: LimitPolicy, identity: string, o?: { windowMs?: number }) =>
      spend(policy, identity, o?.windowMs),
    peekLimit: (policy: LimitPolicy, identity: string) =>
      options.peek
        ? options.peek(`${policy.namespace}:${identity}`, policy.max, policy.windowMs)
        : { allowed: true, retryAfterMs: 0 },
    recordFailure: async (policy: LimitPolicy, identity: string) => {
      await spend(policy, identity);
    },
  };
}
