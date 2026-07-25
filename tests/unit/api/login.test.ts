import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level switches the mocks read. Set per-test to drive the
// (mocked) DB row, verifier result, and rate-limit outcome without
// rebuilding the mock chain each time.
const state = {
  userRow: null as Record<string, unknown> | null,
  verifyResult: false,
  rateLimit: { allowed: true, retryAfterMs: 0 },
};

const verifyPassword = vi.fn(async (_hash: string, _password: string) => state.verifyResult);
vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: (hash: string, password: string) => verifyPassword(hash, password),
}));

const checkRateLimit = vi.fn(
  async (_key: string, _maxAttempts: number, _windowMs: number) => state.rateLimit,
);
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, maxAttempts: number, windowMs: number) =>
    checkRateLimit(key, maxAttempts, windowMs),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { createSession: (userId: string, attrs: object) => createSession(userId, attrs) },
}));

const signPreAuthToken = vi.fn((_userId: string) => "pretok");
vi.mock("$lib/server/api/preauth", () => ({
  signPreAuthToken: (userId: string) => signPreAuthToken(userId),
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
  },
}));

const { POST } = await import("../../../src/routes/api/v1/auth/login/+server");

const call = (body: object) =>
  POST({
    request: new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
  } as never);

const baseUser = {
  id: "u1",
  email: "a@b.com",
  name: "Ada",
  passwordHash: "stored-hash",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

beforeEach(() => {
  state.userRow = null;
  state.verifyResult = false;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
  verifyPassword.mockClear();
  checkRateLimit.mockClear();
  createSession.mockClear();
  signPreAuthToken.mockClear();
});

describe("POST /api/v1/auth/login", () => {
  it("returns 401 for an unknown email (uniform message, no enumeration)", async () => {
    state.userRow = null;
    await expect(call({ email: "nobody@b.com", password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns 401 for a wrong password", async () => {
    state.userRow = { ...baseUser };
    state.verifyResult = false;
    await expect(call({ email: baseUser.email, password: "wrong" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns { token, user } on correct credentials with no 2FA", async () => {
    state.userRow = { ...baseUser, twoFactorEnabled: false };
    state.verifyResult = true;

    const res = await call({ email: baseUser.email, password: "correct" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      token: "sess-1",
      user: {
        id: "u1",
        email: "a@b.com",
        name: "Ada",
        avatarUrl: null,
        timezone: "UTC",
        twoFactorEnabled: false,
        emailVerified: true,
      },
    });
    expect(createSession).toHaveBeenCalledWith("u1", {});
  });

  it("returns a totp challenge when the user has 2FA enabled, without creating a session", async () => {
    state.userRow = { ...baseUser, twoFactorEnabled: true };
    state.verifyResult = true;

    const res = await call({ email: baseUser.email, password: "correct" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ challenge: "totp", preAuthToken: "pretok" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate-limited (does not throw)", async () => {
    state.rateLimit = { allowed: false, retryAfterMs: 60000 };

    const res = await call({ email: baseUser.email, password: "whatever" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limited", retryAfterSeconds: 60 });
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
