import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level switches the mocks read. Set per-test to drive the
// (mocked) preauth/totp/db behavior without rebuilding the mock chain
// each time.
const state = {
  preAuthUserId: null as string | null,
  totpResult: false,
  userRow: null as Record<string, unknown> | null,
};

const verifyPreAuthToken = vi.fn((_token: string) => state.preAuthUserId);
vi.mock("$lib/server/api/preauth", () => ({
  verifyPreAuthToken: (token: string) => verifyPreAuthToken(token),
}));

const verifyAndConsumeTOTPCode = vi.fn(async (_userId: string, _code: string) => state.totpResult);
vi.mock("$lib/server/auth/totp", () => ({
  verifyAndConsumeTOTPCode: (userId: string, code: string) =>
    verifyAndConsumeTOTPCode(userId, code),
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

const baseUser = {
  id: "u1",
  email: "a@b.com",
  name: "Ada",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: true,
  emailVerified: true,
};

beforeEach(() => {
  state.preAuthUserId = null;
  state.totpResult = false;
  state.userRow = null;
  verifyPreAuthToken.mockClear();
  verifyAndConsumeTOTPCode.mockClear();
  createSession.mockClear();
});

describe("POST /api/v1/auth/2fa", () => {
  it("returns 401 for a bad/expired preAuthToken and never checks the code", async () => {
    state.preAuthUserId = null;

    await expect(call({ preAuthToken: "garbage", code: "123456" })).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
  });

  it("returns 401 for a valid token with the wrong code", async () => {
    state.preAuthUserId = "u1";
    state.totpResult = false;

    await expect(call({ preAuthToken: "pretok", code: "000000" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("returns { token, user } for a valid token with a valid code, and consumes it atomically", async () => {
    state.preAuthUserId = "u1";
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
    expect(createSession).toHaveBeenCalledWith("u1", {});
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
