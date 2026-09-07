// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { LIMITS, enforceLimit, peekLimit, recordFailure } =
  await import("../../../src/lib/server/auth/rate-limit");

/**
 * `peekLimit` is a SQL predicate — "is there a live row over budget?" — so
 * `fake-db` cannot test it: it captures `where` clauses without evaluating
 * them, and evaluating them is the entire behaviour.
 *
 * What this pins is the count-failures-not-attempts rule that removes the
 * login lockout. Getting it wrong in either direction is a real defect: peek
 * that increments hands anyone who knows an email a way to lock its owner
 * out, and peek that never sees an expired row makes the limit permanent.
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
});

const ACCOUNT = "ada@example.com";

describe("peekLimit does not spend", () => {
  it("reports allowed for an identity with no row, and creates none", async () => {
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });

    // The point: a correct password must leave no trace, or repeated
    // successful logins would eventually lock the account.
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: true });
  });

  it("a thousand peeks never exhaust the budget", async () => {
    for (let i = 0; i < 1000; i++) await peekLimit(LIMITS.loginAccount, ACCOUNT);
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: true });
  });

  it("sees a budget that failures HAVE spent, and refuses the attempt AFTER the last one", async () => {
    // The boundary peek gets wrong if it reuses enforceLimit's comparison:
    // peek authorises an attempt that has not happened yet, so `max`
    // recorded failures must already mean "no more".
    for (let i = 0; i < LIMITS.loginAccount.max - 1; i++) {
      await recordFailure(LIMITS.loginAccount, ACCOUNT);
    }
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: true });

    await recordFailure(LIMITS.loginAccount, ACCOUNT);
    const verdict = await peekLimit(LIMITS.loginAccount, ACCOUNT);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBeGreaterThan(0);
  });

  it("treats an EXPIRED row as allowed rather than as a live count", async () => {
    // Without this the limit would be permanent whenever garbage collection
    // lagged — and GC runs in the cron tick, which can be skipped.
    for (let i = 0; i < LIMITS.loginAccount.max; i++) {
      await recordFailure(LIMITS.loginAccount, ACCOUNT);
    }
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: false });

    vi.setSystemTime(new Date(Date.now() + LIMITS.loginAccount.windowMs + 1000));
    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: true });
  });

  it("scopes by identity", async () => {
    for (let i = 0; i < LIMITS.loginAccount.max; i++) {
      await recordFailure(LIMITS.loginAccount, ACCOUNT);
    }

    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: false });
    expect(await peekLimit(LIMITS.loginAccount, "someone@else.test")).toMatchObject({
      allowed: true,
    });
  });

  it("scopes by policy, so one door cannot exhaust another", async () => {
    // The namespace disjointness rule, observed rather than asserted about.
    for (let i = 0; i < LIMITS.loginAccount.max; i++) {
      await recordFailure(LIMITS.loginAccount, ACCOUNT);
    }

    expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: false });
    expect(await peekLimit(LIMITS.reauth, ACCOUNT)).toMatchObject({ allowed: true });
  });
});

describe("enforceLimit spends, and rolls its own window over", () => {
  it("refuses only once past the policy's max", async () => {
    const verdicts = [];
    for (let i = 0; i < LIMITS.loginIp.max + 1; i++) {
      verdicts.push((await enforceLimit(LIMITS.loginIp, "1.2.3.4")).allowed);
    }

    expect(verdicts.filter(Boolean)).toHaveLength(LIMITS.loginIp.max);
    expect(verdicts.at(-1)).toBe(false);
  });

  it("restarts an expired window rather than continuing the count", async () => {
    for (let i = 0; i < LIMITS.loginIp.max + 1; i++) await enforceLimit(LIMITS.loginIp, "1.2.3.4");
    expect((await enforceLimit(LIMITS.loginIp, "1.2.3.4")).allowed).toBe(false);

    vi.setSystemTime(new Date(Date.now() + LIMITS.loginIp.windowMs + 1000));
    expect((await enforceLimit(LIMITS.loginIp, "1.2.3.4")).allowed).toBe(true);
  });

  it("honours a per-call window, which only preauthBurn uses", async () => {
    // The burn row must expire exactly when the claim does.
    expect((await enforceLimit(LIMITS.preauthBurn, "jti-1", { windowMs: 2000 })).allowed).toBe(
      true,
    );
    expect((await enforceLimit(LIMITS.preauthBurn, "jti-1", { windowMs: 2000 })).allowed).toBe(
      false,
    );

    vi.setSystemTime(new Date(Date.now() + 3000));
    expect((await enforceLimit(LIMITS.preauthBurn, "jti-1", { windowMs: 2000 })).allowed).toBe(
      true,
    );
  });
});

describe("the login budgets, end to end", () => {
  it("a correct password after failures does not push the account over", async () => {
    // Four failures, then success. The success must not be the fifth strike.
    for (let i = 0; i < 4; i++) await recordFailure(LIMITS.loginAccount, ACCOUNT);

    for (let i = 0; i < 50; i++) {
      expect(await peekLimit(LIMITS.loginAccount, ACCOUNT)).toMatchObject({ allowed: true });
    }
  });

  it("an attacker still gets only `max` wrong guesses per window", async () => {
    let refusedAt = -1;
    for (let attempt = 1; attempt <= 20; attempt++) {
      if (!(await peekLimit(LIMITS.loginAccount, ACCOUNT)).allowed) {
        refusedAt = attempt;
        break;
      }
      await recordFailure(LIMITS.loginAccount, ACCOUNT);
    }

    expect(refusedAt).toBe(LIMITS.loginAccount.max + 1);
    // ...and that is exactly `max` wrong guesses, not one more.
  });
});
