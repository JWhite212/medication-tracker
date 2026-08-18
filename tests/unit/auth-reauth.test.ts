import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// The database comes from the shared seam, which dispatches on real table
// identity — so the two selects are told apart by the table itself rather
// than by duck-typing a mocked table's keys.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

import { fakeDb } from "./helpers/fake-db";
import { users, reauthTokens } from "$lib/server/db/schema";

// Same surface the hand-rolled mock exposed, so every assertion below reads
// unchanged: the two writable fields seed a table, the two readable ones are
// derived from recorded traffic.
const state = {
  verifyResult: false,

  set passwordHash(hash: string | null) {
    fakeDb.seed(users, hash !== null ? [{ passwordHash: hash }] : []);
  },

  set selectMatchRowId(id: string | null) {
    fakeDb.seed(reauthTokens, id ? [{ id }] : []);
  },

  get inserted() {
    return fakeDb.attempted
      .filter((c) => c.op === "insert")
      .map((c) => c.payload as Record<string, unknown>);
  },

  get updateCalls() {
    return fakeDb.attempted.filter((c) => c.op === "update").length;
  },
};

vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: async () => state.verifyResult,
}));

const { confirmReauth, requireRecentReauth } = await import("../../src/lib/server/auth/reauth");

beforeEach(() => {
  // reset() clears both seeds and recorded traffic, which is what the four
  // separate resets here used to do by hand.
  fakeDb.reset();
  state.passwordHash = null;
  state.verifyResult = false;
  state.selectMatchRowId = null;
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

describe("requireRecentReauth", () => {
  it("returns false when no matching row exists", async () => {
    state.selectMatchRowId = null;
    const ok = await requireRecentReauth("u1", "change_password", "any");
    expect(ok).toBe(false);
    expect(state.updateCalls).toBe(0);
  });

  it("returns true and stamps usedAt when a fresh, unused token matches", async () => {
    state.selectMatchRowId = "row1";
    const ok = await requireRecentReauth("u1", "change_password", "rawtok");
    expect(ok).toBe(true);
    expect(state.updateCalls).toBe(1);
  });
});
