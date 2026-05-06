import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

// Module-level switches the mock reads. Set these per-test to drive
// the verifier and the mock DB without rebuilding everything.
const state = {
  passwordHash: null as string | null,
  verifyResult: false,
  inserted: [] as Array<Record<string, unknown>>,
  selectMatchRowId: null as string | null,
  updateCalls: 0,
};

vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: async () => state.verifyResult,
}));

vi.mock("$lib/server/db/schema", () => ({
  users: { id: {}, passwordHash: {} },
  reauthTokens: {
    id: {},
    userId: {},
    tokenHash: {},
    purpose: {},
    expiresAt: {},
    usedAt: {},
  },
}));

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => ({
      from: (tableRef: unknown) => ({
        where: () => ({
          limit: async () => {
            // Distinguish users.select vs reauthTokens.select by which
            // table key was passed in.
            const tbl = tableRef as { passwordHash?: unknown; tokenHash?: unknown };
            if (tbl.passwordHash !== undefined) {
              return state.passwordHash !== null ? [{ passwordHash: state.passwordHash }] : [];
            }
            return state.selectMatchRowId ? [{ id: state.selectMatchRowId }] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        state.inserted.push(row);
      },
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          state.updateCalls++;
        },
      }),
    }),
  },
}));

const { confirmReauth, requireRecentReauth } = await import("../../src/lib/server/auth/reauth");

beforeEach(() => {
  state.passwordHash = null;
  state.verifyResult = false;
  state.inserted = [];
  state.selectMatchRowId = null;
  state.updateCalls = 0;
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
