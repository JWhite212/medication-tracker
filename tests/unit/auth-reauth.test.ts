import { rateLimitSurface } from "./helpers/rate-limit";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// The database comes from the shared seam, which dispatches on real table
// identity — so the two selects are told apart by the table itself rather
// than by duck-typing a mocked table's keys.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { users } from "$lib/server/db/schema";

// Same surface the hand-rolled mock exposed, so every assertion below reads
// unchanged: the two writable fields seed a table, the two readable ones are
// derived from recorded traffic.
const state = {
  verifyResult: false,
  rateLimit: { allowed: true, retryAfterMs: 0 } as { allowed: boolean; retryAfterMs: number },

  set passwordHash(hash: string | null) {
    fakeDb.seed(users, hash !== null ? [{ passwordHash: hash }] : []);
  },

  get inserted() {
    return fakeDb.attempted
      .filter((c) => c.op === "insert")
      .map((c) => c.payload as Record<string, unknown>);
  },
};

const verifyPassword = vi.fn(async () => state.verifyResult);
vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: () => verifyPassword(),
}));

// The limiter itself is SQL and is tested against real Postgres in
// tests/unit/pg/rate-limit.test.ts. What belongs HERE is that confirmReauth
// consults it and short-circuits — composition, not SQL semantics.
const rlCalls: Array<{ key: string; max?: number; windowMs?: number }> = [];
vi.mock("$lib/server/auth/rate-limit", () =>
  rateLimitSurface({
    primitive: async (key: string, max?: number, windowMs?: number) => {
      rlCalls.push({ key, max, windowMs });
      return state.rateLimit;
    },
  }),
);

const { confirmReauth, REAUTH_MAX_ATTEMPTS, REAUTH_WINDOW_MS, reauthMessage } =
  await import("../../src/lib/server/auth/reauth");

beforeEach(() => {
  // reset() clears both seeds and recorded traffic, which is what the four
  // separate resets here used to do by hand.
  fakeDb.reset();
  state.passwordHash = null;
  state.verifyResult = false;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
  rlCalls.length = 0;
  verifyPassword.mockClear();
});

describe("confirmReauth", () => {
  it("returns ok=false when the user has no password hash (OAuth-only user)", async () => {
    state.passwordHash = null;
    const result = await confirmReauth("u1", "anything", "change_password");
    expect(result.ok).toBe(false);
    expect(result.token).toBeUndefined();
    expect(state.inserted).toHaveLength(0);
  });

  it("returns ok=false when the password is incorrect", async () => {
    state.passwordHash = "stored-hash";
    state.verifyResult = false;
    const result = await confirmReauth("u1", "wrong", "delete_account");
    expect(result.ok).toBe(false);
    expect(state.inserted).toHaveLength(0);
  });

  it("inserts a token row and returns the raw token on success", async () => {
    state.passwordHash = "stored-hash";
    state.verifyResult = true;
    const result = await confirmReauth("u1", "correct", "wipe_dose_history");
    expect(result.ok).toBe(true);
    expect(typeof result.token).toBe("string");
    // 32 bytes hex = 64 chars.
    expect(result.token!.length).toBe(64);
    expect(state.inserted).toHaveLength(1);
    const row = state.inserted[0] as {
      userId: string;
      purpose: string;
      tokenHash: string;
      expiresAt: Date;
    };
    expect(row.userId).toBe("u1");
    expect(row.purpose).toBe("wipe_dose_history");
    expect(row.tokenHash).not.toBe(result.token);
    // Token hash matches the SHA-256 of the raw token.
    expect(row.tokenHash).toBe(createHash("sha256").update(result.token!).digest("hex"));
  });

  it("sets an expiry roughly 5 minutes in the future", async () => {
    state.passwordHash = "h";
    state.verifyResult = true;
    const before = Date.now();
    await confirmReauth("u1", "correct", "enable_2fa");
    const row = state.inserted[0] as { expiresAt: Date };
    const delta = row.expiresAt.getTime() - before;
    expect(delta).toBeGreaterThanOrEqual(4 * 60 * 1000);
    expect(delta).toBeLessThanOrEqual(6 * 60 * 1000);
  });
});

describe("confirmReauth — the attempt budget", () => {
  // Five doors call this — change password, enable/disable 2FA, delete
  // account, wipe data, replace-mode import — and none of them limited
  // anything. Anyone holding a stolen session cookie could guess the account
  // password without limit and without leaving a failed-login audit row,
  // each guess burning a full Argon2 verify.
  it("counts the attempt per account, before anything else", async () => {
    state.passwordHash = "stored-hash";
    state.verifyResult = true;

    await confirmReauth("u1", "correct", "change_password");

    expect(rlCalls).toHaveLength(1);
    expect(rlCalls[0]).toEqual({
      key: "reauth:u1",
      max: REAUTH_MAX_ATTEMPTS,
      windowMs: REAUTH_WINDOW_MS,
    });
  });

  it("spends no Argon2 on a refused attempt", async () => {
    // The whole point of counting BEFORE the verify: otherwise the limiter
    // caps the oracle but not the CPU cost, and the endpoint stays an
    // exhaustion lever on a serverless budget.
    state.passwordHash = "stored-hash";
    state.verifyResult = true;
    state.rateLimit = { allowed: false, retryAfterMs: 5 * 60 * 1000 };

    const result = await confirmReauth("u1", "correct", "change_password");

    expect(result.ok).toBe(false);
    expect(result.rateLimited).toBe(true);
    expect(verifyPassword).not.toHaveBeenCalled();
    expect(state.inserted).toHaveLength(0);
  });

  it("a refused attempt does not mint a token even with the right password", async () => {
    state.passwordHash = "stored-hash";
    state.verifyResult = true;
    state.rateLimit = { allowed: false, retryAfterMs: 1000 };

    expect((await confirmReauth("u1", "correct", "delete_account")).token).toBeUndefined();
  });

  it("one bucket per account, not per purpose", async () => {
    // A per-purpose bucket would hand an attacker eight times the guesses
    // for the cost of rotating a form field.
    state.passwordHash = "h";
    state.verifyResult = true;

    await confirmReauth("u1", "p", "enable_2fa");
    await confirmReauth("u1", "p", "delete_account");

    expect(new Set(rlCalls.map((c) => c.key))).toEqual(new Set(["reauth:u1"]));
  });

  it("reauthMessage distinguishes a refusal from a wrong password", async () => {
    // Telling a user their own password is wrong when the limiter turned
    // them away is misleading, and alarming mid-recovery.
    expect(reauthMessage({ rateLimited: true, retryAfterMs: 5 * 60 * 1000 })).toContain(
      "5 minutes",
    );
    expect(reauthMessage({})).toBe("Incorrect password.");
  });
});

// `requireRecentReauth` MOVED to tests/unit/pg/auth-reauth-redeem.test.ts.
// It is now a single conditional UPDATE whose WHERE decides whether the
// write happens at all, and `fake-db` captures predicates without evaluating
// them — it cannot tell a guarded UPDATE from an unguarded one, which is the
// entire property under test. Per CLAUDE.md's seam rule that belongs on
// PGlite. `confirmReauth` stays here: it is composition, not SQL semantics.
