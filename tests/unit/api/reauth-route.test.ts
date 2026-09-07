import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * POST /api/v1/auth/reauth — the API's half of the password gate on
 * destructive commands.
 *
 * The browser has always demanded a password before wiping dose history;
 * `/api/v1/commands` demanded nothing, so a stolen bearer token was enough
 * to irreversibly delete the whole log. This endpoint mints the proof and
 * `requireRecentReauth` redeems it inside the command handler.
 */

// The route imports the real reauth module (for REAUTH_PURPOSES) which
// imports `db`, but the route itself runs no query — confirmReauth is
// mocked. unusedDb THROWS on any access, so an accidental query would fail
// loudly by name rather than returning [].
vi.mock("$lib/server/db", async () => (await import("../helpers/fake-db")).unusedDb);

const requireApiUser = vi.fn(async (_request: Request) => ({ user: { id: "u1" } }));
vi.mock("$lib/server/api/auth", () => ({
  requireApiUser: (request: Request) => requireApiUser(request),
}));

const confirmReauth = vi.fn(
  async (_userId: string, _password: string, _purpose: string) =>
    state.result as Record<string, unknown>,
);
vi.mock("$lib/server/auth/reauth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  confirmReauth: (userId: string, password: string, purpose: string) =>
    confirmReauth(userId, password, purpose),
}));

const state = {
  result: { ok: true, token: "raw-token" } as Record<string, unknown>,
};

const { POST } = await import("../../../src/routes/api/v1/auth/reauth/+server");

function call(payload: unknown) {
  return POST({
    request: new Request("http://x/api/v1/auth/reauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  } as never) as Promise<Response>;
}

async function statusOf(promise: Promise<Response>): Promise<number> {
  try {
    return (await promise).status;
  } catch (thrown) {
    return (thrown as { status?: number }).status ?? 500;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  requireApiUser.mockResolvedValue({ user: { id: "u1" } });
  state.result = { ok: true, token: "raw-token" };
});

describe("POST /api/v1/auth/reauth", () => {
  it("returns a token for the right password", async () => {
    const response = await call({ password: "correct", purpose: "wipe_dose_history" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ reauthToken: "raw-token" });
    expect(confirmReauth).toHaveBeenCalledWith("u1", "correct", "wipe_dose_history");
  });

  it("takes the user id from the authenticated session, never the payload", async () => {
    await call({ password: "correct", purpose: "wipe_dose_history", userId: "victim" });
    expect(confirmReauth).toHaveBeenCalledWith("u1", "correct", "wipe_dose_history");
  });

  it("401s on a wrong password and mints nothing", async () => {
    state.result = { ok: false };
    expect(await statusOf(call({ password: "wrong", purpose: "wipe_dose_history" }))).toBe(401);
  });

  it("passes the limiter's refusal through as a 429, not a 401", async () => {
    // A refusal is not a wrong password, and the client needs the
    // distinction to back off rather than re-prompt.
    state.result = { ok: false, rateLimited: true, retryAfterMs: 60_000 };

    const response = await call({ password: "correct", purpose: "wipe_dose_history" });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it.each([
    ["no password", { purpose: "wipe_dose_history" }],
    ["an empty password", { password: "", purpose: "wipe_dose_history" }],
    ["no purpose", { password: "correct" }],
    ["an unknown purpose", { password: "correct", purpose: "something_else" }],
  ])("400s on %s without touching the verifier", async (_label, payload) => {
    expect(await statusOf(call(payload))).toBe(400);
    expect(confirmReauth).not.toHaveBeenCalled();
  });

  it("requires an authenticated caller", async () => {
    requireApiUser.mockRejectedValueOnce(Object.assign(new Error("no"), { status: 401 }));
    expect(await statusOf(call({ password: "x", purpose: "wipe_dose_history" }))).toBe(401);
  });
});
