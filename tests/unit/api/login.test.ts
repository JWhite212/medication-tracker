import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "../helpers/fake-db";
import { users } from "$lib/server/db/schema";

// The row the user lookup finds; null means "no such user".
function seedUser(row: Record<string, unknown> | null) {
  fakeDb.seed(users, row ? [row] : []);
}

// Module-level switches the mocks read. Set per-test to drive the
// (mocked) DB row, verifier result, rehash decision, and the two
// rate-limit outcomes (per-email and per-IP) without rebuilding the
// mock chain each time.
const state = {
  verifyResult: false,
  needsRehashResult: false,
  rateLimitEmail: { allowed: true, retryAfterMs: 0 },
  rateLimitIp: { allowed: true, retryAfterMs: 0 },
};
const rlCalls: Array<{ key: string; max: number | undefined; windowMs: number | undefined }> = [];
// Recorded update payloads, derived from the seam's traffic.
const updates = () =>
  fakeDb.attempted
    .filter((c) => c.op === "update")
    .map((c) => c.payload as Record<string, unknown>);

const verifyPassword = vi.fn(async (_hash: string, _password: string) => state.verifyResult);
const verifyDummyPassword = vi.fn(async (_password: string) => false as const);
const needsRehash = vi.fn((_hash: string) => state.needsRehashResult);
const hashPassword = vi.fn(async (_password: string) => "upgraded-hash");
vi.mock("$lib/server/auth/password", () => ({
  verifyPassword: (hash: string, password: string) => verifyPassword(hash, password),
  verifyDummyPassword: (password: string) => verifyDummyPassword(password),
  needsRehash: (hash: string) => needsRehash(hash),
  hashPassword: (password: string) => hashPassword(password),
}));

const checkRateLimit = vi.fn(async (key: string, max?: number, windowMs?: number) => {
  rlCalls.push({ key, max, windowMs });
  return key.startsWith("api-login-ip:") ? state.rateLimitIp : state.rateLimitEmail;
});
vi.mock("$lib/server/auth/rate-limit", () => ({
  checkRateLimit: (key: string, max?: number, windowMs?: number) =>
    checkRateLimit(key, max, windowMs),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { createSession: (userId: string, attrs: object) => createSession(userId, attrs) },
}));

const signPreAuthToken = vi.fn((_userId: string) => "pretok");
vi.mock("$lib/server/api/preauth", () => ({
  signPreAuthToken: (userId: string) => signPreAuthToken(userId),
}));

const logAudit = vi.fn(async (..._args: unknown[]) => {});
vi.mock("$lib/server/audit", () => ({
  logAudit: (...args: unknown[]) => logAudit(...args),
}));

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real users table.
vi.mock("$lib/server/db", async () => (await import("../helpers/fake-db")).dbMock);

const { POST } = await import("../../../src/routes/api/v1/auth/login/+server");

const call = (body: object) => rawCall(JSON.stringify(body));

const rawCall = (body: string) =>
  POST({
    request: new Request("http://x", { method: "POST", body }),
    getClientAddress: () => "9.9.9.9",
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
  fakeDb.reset();
  seedUser(null);
  state.verifyResult = false;
  state.needsRehashResult = false;
  state.rateLimitEmail = { allowed: true, retryAfterMs: 0 };
  state.rateLimitIp = { allowed: true, retryAfterMs: 0 };
  rlCalls.length = 0;
  verifyPassword.mockClear();
  verifyDummyPassword.mockClear();
  needsRehash.mockClear();
  hashPassword.mockClear();
  checkRateLimit.mockClear();
  createSession.mockClear();
  signPreAuthToken.mockClear();
  logAudit.mockClear();
});

describe("POST /api/v1/auth/login", () => {
  it("returns 400 (not 500) for a malformed JSON body", async () => {
    await expect(rawCall("{not json")).rejects.toMatchObject({ status: 400 });
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("returns 401 for an unknown email (uniform message, no enumeration)", async () => {
    seedUser(null);
    await expect(call({ email: "nobody@b.com", password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("burns a dummy Argon2 verify for an unknown email so timing matches real accounts", async () => {
    seedUser(null);
    await expect(call({ email: "nobody@b.com", password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyDummyPassword).toHaveBeenCalledWith("whatever");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("burns a dummy Argon2 verify for an OAuth-only account with no password hash", async () => {
    seedUser({ ...baseUser, passwordHash: null });
    await expect(call({ email: baseUser.email, password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
    expect(verifyDummyPassword).toHaveBeenCalledWith("whatever");
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it("returns 401 for a wrong password", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = false;
    await expect(call({ email: baseUser.email, password: "wrong" })).rejects.toMatchObject({
      status: 401,
    });
  });

  it("writes a failed_login audit row for a real account with the wrong password", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = false;
    await expect(call({ email: baseUser.email, password: "wrong" })).rejects.toMatchObject({
      status: 401,
    });
    expect(logAudit).toHaveBeenCalledWith("u1", "session", "n/a", "failed_login");
  });

  it("does not write an audit row for an unknown email (no user id to attribute)", async () => {
    seedUser(null);
    await expect(call({ email: "nobody@b.com", password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does not write an audit row for an OAuth-only account with no password hash", async () => {
    seedUser({ ...baseUser, passwordHash: null });
    await expect(call({ email: baseUser.email, password: "whatever" })).rejects.toMatchObject({
      status: 401,
    });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("does not write a failed_login audit row on a successful login", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = true;
    await call({ email: baseUser.email, password: "correct" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("returns { token, user } on correct credentials with no 2FA", async () => {
    seedUser({ ...baseUser, twoFactorEnabled: false });
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

  it("transparently upgrades a stale Argon2 hash on successful login", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = true;
    state.needsRehashResult = true;

    await call({ email: baseUser.email, password: "correct" });
    expect(hashPassword).toHaveBeenCalledWith("correct");
    expect(updates()).toEqual([{ passwordHash: "upgraded-hash" }]);
  });

  it("does not rewrite the hash when parameters are current", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = true;
    state.needsRehashResult = false;

    await call({ email: baseUser.email, password: "correct" });
    expect(updates()).toEqual([]);
  });

  it("returns a totp challenge when the user has 2FA enabled, without creating a session", async () => {
    seedUser({ ...baseUser, twoFactorEnabled: true });
    state.verifyResult = true;

    const res = await call({ email: baseUser.email, password: "correct" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ challenge: "totp", preAuthToken: "pretok" });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rate-limits per IP as well as per email", async () => {
    seedUser({ ...baseUser });
    state.verifyResult = true;

    await call({ email: baseUser.email, password: "correct" });
    expect(rlCalls.map((c) => c.key)).toEqual([
      "api-login-ip:9.9.9.9",
      `api-login:${baseUser.email}`,
    ]);
    // Assert the actual budgets/windows, not just the keys, so a
    // loosened limit can't pass CI silently.
    expect(rlCalls[0]).toMatchObject({ max: 10, windowMs: 900_000 });
    expect(rlCalls[1]).toMatchObject({ max: 5, windowMs: 900_000 });
  });

  it("returns 429 when the IP budget is exhausted, before touching the email budget", async () => {
    state.rateLimitIp = { allowed: false, retryAfterMs: 30_000 };

    const res = await call({ email: baseUser.email, password: "whatever" });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(rlCalls.map((c) => c.key)).toEqual(["api-login-ip:9.9.9.9"]);
  });

  it("returns 429 with Retry-After when rate-limited per email (does not throw)", async () => {
    state.rateLimitEmail = { allowed: false, retryAfterMs: 60000 };

    const res = await call({ email: baseUser.email, password: "whatever" });
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limited", retryAfterSeconds: 60 });
    expect(res.headers.get("Retry-After")).toBe("60");
  });
});
