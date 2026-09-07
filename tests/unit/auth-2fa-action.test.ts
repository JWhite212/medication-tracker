import { describe, it, expect, vi, beforeEach } from "vitest";

// The real preauth module, not a mock: the whole point of this suite is
// that the cookie is UNFORGEABLE, and a mocked verifier would let a forged
// value through and prove nothing.
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-encryption-key-123" } }));

// Module-level switches the mocks read. Set per-test to drive the (mocked)
// TOTP verifier and rate limiter without rebuilding the mock chain.
const state = {
  totpResult: false,
  rateLimit: { allowed: true, retryAfterMs: 0 },
};
const rlCalls: Array<{ key: string; max: number | undefined; windowMs: number | undefined }> = [];

const verifySecondFactorForLogin = vi.fn(
  async (_userId: string, _code: string) => state.totpResult,
);
const verifyAndConsumeTOTPCode = vi.fn(async (_userId: string, _code: string) => state.totpResult);
vi.mock("$lib/server/auth/totp", () => ({
  verifySecondFactorForLogin: (userId: string, code: string) =>
    verifySecondFactorForLogin(userId, code),
  verifyAndConsumeTOTPCode: (userId: string, code: string) =>
    verifyAndConsumeTOTPCode(userId, code),
}));

// A real single-use ledger, not a switch. The burn is `checkRateLimit(key,
// 1, ...)`, so modelling it as "first call for a key wins, later calls lose"
// is faithful — and it is the only way a replay test can prove the key is
// derived from `claims.jti`. A boolean switch would pass even if consumption
// keyed on something constant.
const spentKeys = new Set<string>();
const checkRateLimit = vi.fn(async (key: string, max?: number, windowMs?: number) => {
  rlCalls.push({ key, max, windowMs });
  if (key.startsWith("preauth:")) {
    if (spentKeys.has(key)) return { allowed: false, retryAfterMs: 0 };
    spentKeys.add(key);
    return { allowed: true, retryAfterMs: 0 };
  }
  return state.rateLimit;
});
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, max?: number, windowMs?: number) =>
    checkRateLimit(key, max, windowMs),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    createSession: (userId: string, attrs: object) => createSession(userId, attrs),
    createSessionCookie: (_sessionId: string) => ({
      name: "auth_session",
      value: "sess-1",
      attributes: {},
    }),
  },
}));

vi.mock("$lib/server/audit", () => ({ logAudit: async () => {} }));

const { signPreAuthToken } = await import("../../src/lib/server/api/preauth");
const { actions, load } = await import("../../src/routes/auth/2fa/+page.server");

function makeCookies(pendingValue: string | undefined) {
  return {
    get: (name: string) => (name === "pending_2fa" ? pendingValue : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  };
}

const call = (code: string, pendingValue: string | undefined) =>
  actions.default({
    request: new Request("http://x", { method: "POST", body: new URLSearchParams({ code }) }),
    cookies: makeCookies(pendingValue),
    getClientAddress: () => "1.1.1.1",
  } as never);

const validToken = () => signPreAuthToken("pending-user");

beforeEach(() => {
  state.totpResult = false;
  state.rateLimit = { allowed: true, retryAfterMs: 0 };
  spentKeys.clear();
  rlCalls.length = 0;
  verifySecondFactorForLogin.mockClear();
  verifyAndConsumeTOTPCode.mockClear();
  checkRateLimit.mockClear();
  createSession.mockClear();
});

describe("the pending_2fa cookie is a signed claim, not a user id", () => {
  // THE defect this suite exists for. `httpOnly` stops JavaScript reading a
  // cookie; it does nothing to stop an attacker SETTING one on their own
  // request. With a raw id in there, the password was removed from the pair
  // entirely: set the cookie to a victim's id, POST a valid code, get a
  // session. The user id is not secret — it ships in every /api/v1 export.
  it.each([
    ["a raw user id", "victim-user-id"],
    ["an empty string", ""],
    ["arbitrary text", "not-a-token"],
    ["a payload with no signature", "eyJ1c2VySWQiOiJ2aWN0aW0ifQ"],
  ])("rejects %s and never reaches the verifier", async (_label, forged) => {
    state.totpResult = true;

    await expect(call("123456", forged)).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(verifySecondFactorForLogin).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects a token whose payload was edited to name a different user", async () => {
    // The signature covers the payload, so swapping the user id inside it
    // invalidates the MAC. This is the exact attack the raw id allowed.
    const [payload, mac] = validToken().split(".");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    const tampered = Buffer.from(JSON.stringify({ ...claims, userId: "victim" })).toString(
      "base64url",
    );
    state.totpResult = true;

    await expect(call("123456", `${tampered}.${mac}`)).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(verifySecondFactorForLogin).not.toHaveBeenCalled();
  });

  it("rejects an expired token", async () => {
    state.totpResult = true;
    const expired = signPreAuthToken("pending-user", -1000);

    await expect(call("123456", expired)).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(verifySecondFactorForLogin).not.toHaveBeenCalled();
  });

  it("the load function turns a forged cookie away too", async () => {
    await expect(load({ cookies: makeCookies("victim-user-id") } as never)).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
  });

  it("accepts a genuine token and reads the user id FROM the claim", async () => {
    state.totpResult = true;

    await expect(call("123456", validToken())).rejects.toMatchObject({
      status: 302,
      location: "/dashboard",
    });
    expect(verifySecondFactorForLogin).toHaveBeenCalledWith("pending-user", "123456");
    expect(createSession).toHaveBeenCalledWith("pending-user", {});
  });
});

describe("the second factor must be one the account actually enabled", () => {
  it("goes through the login arm, not the enrolment one", async () => {
    // `verifyAndConsumeTOTPCode` deliberately does NOT check
    // `twoFactorEnabled`, because enrolment calls it before the flag is
    // set. `setupTwoFactor` persists the secret when the QR is shown and
    // nothing clears it on abandon, so an account with the flag OFF can
    // hold a live credential — this door must use the arm that checks.
    state.totpResult = true;
    await expect(call("123456", validToken())).rejects.toBeDefined();

    expect(verifySecondFactorForLogin).toHaveBeenCalled();
    expect(verifyAndConsumeTOTPCode).not.toHaveBeenCalled();
  });

  it("a rejected second factor mints nothing", async () => {
    state.totpResult = false;

    const result = (await call("000000", validToken())) as { status: number };
    expect(result.status).toBe(400);
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe("the claim is single-use", () => {
  it("burns the jti before minting a session", async () => {
    state.totpResult = true;
    await expect(call("123456", validToken())).rejects.toBeDefined();

    const burn = rlCalls.find((c) => c.key.startsWith("preauth:"))!;
    expect(burn).toBeDefined();
    expect(burn.max).toBe(1);
    expect(createSession).toHaveBeenCalled();
  });

  it("redeems a token once, then refuses that SAME token", async () => {
    // Deliberately the same token twice, against a mock that spends keys for
    // real. Minting a second token and forcing the burn to fail would pass
    // even if consumption keyed on something constant — this fails unless
    // the key is derived from the claim's own jti.
    state.totpResult = true;
    const token = validToken();

    await expect(call("123456", token)).rejects.toMatchObject({ location: "/dashboard" });
    expect(createSession).toHaveBeenCalledTimes(1);

    await expect(call("123456", token)).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it("...while a DIFFERENT token still works, so the burn is per-claim", async () => {
    // The other half of the proof: spending one token must not latch the
    // door shut for every other claim.
    state.totpResult = true;

    await expect(call("123456", validToken())).rejects.toMatchObject({ location: "/dashboard" });
    await expect(call("123456", validToken())).rejects.toMatchObject({ location: "/dashboard" });
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it("the burned key carries the claim's own jti", async () => {
    state.totpResult = true;
    const token = validToken();
    const jti = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString()).jti;

    await expect(call("123456", token)).rejects.toBeDefined();

    expect(rlCalls.map((c) => c.key)).toContain(`preauth:${jti}`);
  });
});

describe("rate limiting", () => {
  it("caps attempts per ACCOUNT, and never checks the code when limited", async () => {
    // The key used to carry the client IP, which was correct while the
    // cookie was forgeable (it stopped a victim being locked out) and
    // useless as a cap (six digits at five tries per address, addresses
    // free). Signing the claim removes the lockout vector, so the limit
    // goes back to bounding the guess.
    state.rateLimit = { allowed: false, retryAfterMs: 10 * 60 * 1000 };

    const result = (await call("123456", validToken())) as { status: number };
    expect(result.status).toBe(429);
    expect(verifySecondFactorForLogin).not.toHaveBeenCalled();
    expect(rlCalls[0]).toMatchObject({ key: "2fa:pending-user", max: 5, windowMs: 900000 });
    expect(rlCalls[0].key).not.toContain("1.1.1.1");
  });

  it("counts the attempt before verifying so wrong guesses are not free", async () => {
    state.totpResult = false;

    const result = (await call("000000", validToken())) as { status: number };
    expect(result.status).toBe(400);
    expect(rlCalls.filter((c) => c.key.startsWith("2fa:"))).toHaveLength(1);
    expect(verifySecondFactorForLogin).toHaveBeenCalledWith("pending-user", "000000");
  });

  it("rejects a non-6-digit code without consuming an attempt", async () => {
    const result = (await call("12x", validToken())) as { status: number };
    expect(result.status).toBe(400);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(verifySecondFactorForLogin).not.toHaveBeenCalled();
  });
});
