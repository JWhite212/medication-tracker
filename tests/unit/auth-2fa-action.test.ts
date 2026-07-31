import { describe, it, expect, vi, beforeEach } from "vitest";

// Module-level switches the mocks read. Set per-test to drive the
// (mocked) TOTP verifier and rate limiter without rebuilding the
// mock chain each time.
const state = {
  totpResult: false,
  rateLimit: { allowed: true, retryAfterMs: 0 },
};
const rlCalls: Array<{ key: string; max: number | undefined; windowMs: number | undefined }> = [];

const verifyAndConsumeTOTPCode = vi.fn(async (_userId: string, _code: string) => state.totpResult);
vi.mock("$lib/server/auth/totp", () => ({
  verifyAndConsumeTOTPCode: (userId: string, code: string) =>
    verifyAndConsumeTOTPCode(userId, code),
}));

const checkRateLimit = vi.fn(async (key: string, max?: number, windowMs?: number) => {
  rlCalls.push({ key, max, windowMs });
  return state.rateLimit;
});
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, max?: number, windowMs?: number) =>
    checkRateLimit(key, max, windowMs),
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

vi.mock("$lib/server/audit", () => ({ logAudit: async () => {} }));

const { actions } = await import("../../src/routes/auth/2fa/+page.server");

function makeCookies(pendingUserId: string | undefined) {
  return {
    get: (name: string) => (name === "pending_2fa" ? pendingUserId : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

const call = (code: string, pendingUserId: string | undefined = "pending-user") =>
  actions.default({
    request: new Request("http://x", { method: "POST", body: new URLSearchParams({ code }) }),
    cookies: makeCookies(pendingUserId),
    getClientAddress: () => "1.1.1.1",
  } as never);

beforeEach(() => {
  state.totpResult = false;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
  rlCalls.length = 0;
  verifyAndConsumeTOTPCode.mockClear();
  checkRateLimit.mockClear();
});

describe("web 2FA action", () => {
  it("rate-limits per pending user AND client IP (so a forged pending_2fa cookie can't lock out a victim) and never checks the code when limited", async () => {
    state.rateLimit = { allowed: false, retryAfterMs: 10 * 60 * 1000 };

    const result = (await call("123456")) as { status: number };
    expect(result.status).toBe(429);
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
    // Compound key includes the IP: an attacker who forges pending_2fa
    // to a victim's id burns their OWN ip's bucket, not the victim's.
    expect(rlCalls[0]).toMatchObject({ key: "2fa:pending-user:1.1.1.1", max: 5, windowMs: 900000 });
  });

  it("counts the attempt before verifying so wrong guesses are not free", async () => {
    state.totpResult = false;

    const result = (await call("000000")) as { status: number };
    expect(result.status).toBe(400);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(verifyAndConsumeTOTPCode).toHaveBeenCalledWith("pending-user", "000000");
  });

  it("redirects to the dashboard on a correct code", async () => {
    state.totpResult = true;

    await expect(call("123456")).rejects.toMatchObject({
      status: 302,
      location: "/dashboard",
    });
  });

  it("rejects a non-6-digit code without consuming a rate-limit attempt", async () => {
    const result = (await call("12x")) as { status: number };
    expect(result.status).toBe(400);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
  });
});
