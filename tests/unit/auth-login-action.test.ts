import { describe, it, expect, vi, beforeEach } from "vitest";

// Focused on the anti-enumeration timing behavior: unknown or
// password-less accounts must still burn an Argon2 verification so
// response timing cannot distinguish them from real accounts.
const state = {
  userRow: null as Record<string, unknown> | null,
  verifyResult: false,
};

const verifyPassword = vi.fn(async (_hash: string, _password: string) => state.verifyResult);
const verifyDummyPassword = vi.fn(async (_password: string) => false as const);
vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: (hash: string, password: string) => verifyPassword(hash, password),
  verifyDummyPassword: (password: string) => verifyDummyPassword(password),
  needsRehash: () => false,
  hashPassword: async () => "new-hash",
}));

vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$lib/server/auth/oauth", () => ({ hasOAuthProviders: () => false }));
vi.mock("$lib/server/audit", () => ({ logAudit: async () => {} }));
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: async () => ({ allowed: true, retryAfterMs: 0 }),
}));

vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    createSession: async (_userId: string, _attrs: object) => ({ id: "sess-1" }),
    createSessionCookie: (_sessionId: string) => ({
      name: "auth_session",
      value: "sess-1",
      attributes: {},
    }),
  },
}));

vi.mock("$lib/server/db/schema", () => ({
  users: { id: {}, email: {}, passwordHash: {} },
}));

vi.mock("$lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.userRow ? [state.userRow] : []),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

const { actions } = await import("../../src/routes/auth/login/+page.server");

const call = (email: string, password: string) =>
  actions.default({
    request: new Request("http://x", {
      method: "POST",
      body: new URLSearchParams({ email, password }),
    }),
    cookies: { get: () => undefined, set: vi.fn(), delete: vi.fn() },
    getClientAddress: () => "1.1.1.1",
  } as never);

const baseUser = {
  id: "u1",
  email: "a@b.com",
  passwordHash: "stored-hash",
  twoFactorEnabled: false,
};

beforeEach(() => {
  state.userRow = null;
  state.verifyResult = false;
  verifyPassword.mockClear();
  verifyDummyPassword.mockClear();
});

describe("web login action — enumeration timing", () => {
  it("burns a dummy Argon2 verify for an unknown email", async () => {
    state.userRow = null;

    const result = (await call("nobody@b.com", "whatever")) as { status: number };
    expect(result.status).toBe(400);
    expect(verifyDummyPassword).toHaveBeenCalledWith("whatever");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("burns a dummy Argon2 verify for an OAuth-only account with no password hash", async () => {
    state.userRow = { ...baseUser, passwordHash: null };

    const result = (await call(baseUser.email, "whatever")) as { status: number };
    expect(result.status).toBe(400);
    expect(verifyDummyPassword).toHaveBeenCalledWith("whatever");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("verifies against the real hash (no dummy) for a known account", async () => {
    state.userRow = { ...baseUser };
    state.verifyResult = false;

    const result = (await call(baseUser.email, "wrong")) as { status: number };
    expect(result.status).toBe(400);
    expect(verifyPassword).toHaveBeenCalledWith("stored-hash", "wrong");
    expect(verifyDummyPassword).not.toHaveBeenCalled();
  });
});
