import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level switches the mocks read. Set per-test to drive the
// (mocked) preauth/totp/db behavior without rebuilding the mock chain
// each time. `rateLimit` answers the per-user 2FA attempt limit;
// `consume` answers the single-use preauth-jti consumption check.
const state = {
  preAuthClaims: null as { userId: string; jti: string; exp: number } | null,
  totpResult: false,
  userRow: null as Record<string, unknown> | null,
  rateLimit: { allowed: true, retryAfterMs: 0 },
  consume: { allowed: true, retryAfterMs: 0 },
};
const rlCalls: Array<{ key: string; max: number | undefined; windowMs: number | undefined }> = [];

const verifyPreAuthToken = vi.fn((_token: string) => state.preAuthClaims);
vi.mock("$lib/server/api/preauth", () => ({
  verifyPreAuthToken: (token: string) => verifyPreAuthToken(token),
}));

const verifyAndConsumeTOTPCode = vi.fn(async (_userId: string, _code: string) => state.totpResult);
vi.mock("$lib/server/auth/totp", () => ({
  verifyAndConsumeTOTPCode: (userId: string, code: string) =>
    verifyAndConsumeTOTPCode(userId, code),
}));

const checkRateLimit = vi.fn(async (key: string, max?: number, windowMs?: number) => {
  rlCalls.push({ key, max, windowMs });
  return key.startsWith("preauth:") ? state.consume : state.rateLimit;
});
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, max?: number, windowMs?: number) =>
    checkRateLimit(key, max, windowMs),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { createSession: (userId: string, attrs: object) => createSession(userId, attrs) },
}));

vi.mock("$lib/server/db/schema", () => ({
  users: { id: {}, email: {} },
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

const { POST } = await import("../../../src/routes/api/v1/auth/2fa/+server");

const call = (body: object) =>
  POST({
    request: new Request("http://x", { method: "POST", body: JSON.stringify(body) }),
  } as never);

const rawCall = (body: string) =>
  POST({
    request: new Request("http://x", { method: "POST", body }),
  } as never);

const baseUser = {
  id: "u1",
  email: "a@b.com",
  name: "Ada",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: true,
  emailVerified: true,
};

const claims = () => ({ userId: "u1", jti: "jti-1", exp: Date.now() + 300_000 });

beforeEach(() => {
  state.preAuthClaims = null;
  state.totpResult = false;
  state.userRow = null;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
  state.consume = { allowed: true, retryAfterMs: 0 };
  rlCalls.length = 0;
  verifyPreAuthToken.mockClear();
  verifyAndConsumeTOTPCode.mockClear();
  checkRateLimit.mockClear();
  createSession.mockClear();
});

describe("POST /api/v1/auth/2fa", () => {
  it("returns 400 (not 500) for a malformed JSON body", async () => {
    await expect(rawCall("{not json")).rejects.toMatchObject({ status: 400 });
    expect(verifyPreAuthToken).not.toHaveBeenCalled();
  });

  it("returns 401 for a bad/expired preAuthToken and never checks the code", async () => {
    state.preAuthClaims = null;

    await expect(call({ preAuthToken: "garbage", code: "123456" })).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
  });

  it("rate-limits attempts per user and never checks the code when limited", async () => {
    state.preAuthClaims = claims();
    state.rateLimit = { allowed: false, retryAfterMs: 120_000 };

    const res = await call({ preAuthToken: "pretok", code: "123456" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limited", retryAfterSeconds: 120 });
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(rlCalls[0]).toMatchObject({ key: "2fa:u1", max: 5 });
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
  });

  it("returns 401 for a valid token with the wrong code, without consuming the token", async () => {
    state.preAuthClaims = claims();
    state.totpResult = false;

    await expect(call({ preAuthToken: "pretok", code: "000000" })).rejects.toMatchObject({
      status: 401,
    });
    expect(rlCalls.some((c) => c.key.startsWith("preauth:"))).toBe(false);
  });

  it("returns { token, user } for a valid code and consumes the token single-use", async () => {
    state.preAuthClaims = claims();
    state.totpResult = true;
    state.userRow = { ...baseUser };

    const res = await call({ preAuthToken: "pretok", code: "123456" });
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
        twoFactorEnabled: true,
        emailVerified: true,
      },
    });
    expect(verifyAndConsumeTOTPCode).toHaveBeenCalledWith("u1", "123456");
    const consume = rlCalls.find((c) => c.key === "preauth:jti-1");
    expect(consume).toMatchObject({ max: 1 });
    expect(createSession).toHaveBeenCalledWith("u1", {});
  });

  it("returns 401 for a replayed token that was already consumed, without minting a session", async () => {
    state.preAuthClaims = claims();
    state.totpResult = true;
    state.userRow = { ...baseUser };
    state.consume = { allowed: false, retryAfterMs: 200_000 };

    await expect(call({ preAuthToken: "pretok", code: "123456" })).rejects.toMatchObject({
      status: 401,
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body (missing code)", async () => {
    await expect(call({ preAuthToken: "pretok" })).rejects.toMatchObject({ status: 400 });
    expect(verifyPreAuthToken).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-6-digit code", async () => {
    await expect(call({ preAuthToken: "pretok", code: "12" })).rejects.toMatchObject({
      status: 400,
    });
    expect(verifyPreAuthToken).not.toHaveBeenCalled();
  });
});
