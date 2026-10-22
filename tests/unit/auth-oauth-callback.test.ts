import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { verifyPreAuthToken } from "$lib/server/api/preauth";

// Exercises the OAuth callback's post-verification branch: an existing
// oauth_accounts link must route a 2FA-enabled user through the same
// pending_2fa → /auth/2fa challenge as the password login instead of
// minting a session directly. The GitHub provider is used because its
// exchange has no PKCE cookie, keeping the fixture minimal; the branch
// under test is provider-agnostic.
const state = {};

vi.mock("$app/environment", () => ({ dev: true }));

// signPreAuthToken HMACs over this; the value only has to be present.
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-encryption-key-123" } }));

vi.mock("$lib/server/auth/oauth", () => ({
  getGoogle: () => null,
  getGitHub: () => ({
    createAuthorizationURL: () => new URL("https://github.com/login/oauth/authorize"),
    validateAuthorizationCode: async () => ({ accessToken: () => "gh-access-token" }),
  }),
}));

const createSession = vi.fn(async (_userId: string, _attrs: object) => ({ id: "sess-1" }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    createSession: (userId: string, attrs: object) => createSession(userId, attrs),
    createSessionCookie: (sessionId: string) => ({
      name: "auth_session",
      value: sessionId,
      attributes: {},
    }),
  },
}));

// The database comes from the shared seam. The old fake served one ordered
// queue for BOTH selects; table identity separates them, so the link lookup
// and the user lookup no longer depend on which runs first.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);

const inserts = () =>
  fakeDb.attempted.filter((c) => c.op === "insert").map((c) => ({ values: c.payload }));

const { GET } = await import("../../src/routes/auth/callback/[provider]/+server");

function githubFetchStub() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/user/emails")) {
      return new Response(JSON.stringify([{ email: "a@b.com", primary: true, verified: true }]));
    }
    return new Response(JSON.stringify({ id: 42, name: "Ada", avatar_url: null, login: "ada" }));
  });
}

function makeCookies(extra: Record<string, string> = {}) {
  const jar = new Map<string, string>([["oauth_state", "st-1"], ...Object.entries(extra)]);
  return {
    get: (name: string) => jar.get(name),
    set: vi.fn((name: string, value: string) => {
      jar.set(name, value);
    }),
    delete: vi.fn((name: string) => {
      jar.delete(name);
    }),
  };
}

const call = (cookies: ReturnType<typeof makeCookies>) =>
  GET({
    params: { provider: "github" },
    url: new URL("http://localhost/auth/callback/github?code=abc&state=st-1"),
    cookies,
  } as never);

const baseUser = {
  id: "u1",
  email: "a@b.com",
  name: "Ada",
  avatarUrl: null,
  timezone: "UTC",
  twoFactorEnabled: false,
  emailVerified: true,
};

beforeEach(() => {
  fakeDb.reset();
  createSession.mockClear();
  vi.stubGlobal("fetch", githubFetchStub());
});

describe("GET /auth/callback/[provider] — existing linked account", () => {
  it("redirects a 2FA-enabled user to /auth/2fa without creating a session", async () => {
    // 1st select: oauthAccounts link. 2nd select: linked user with 2FA on.
    fakeDb.seed(oauthAccounts, [{ userId: "u1" }]);
    fakeDb.seed(users, [{ ...baseUser, twoFactorEnabled: true }]);
    const cookies = makeCookies();

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/auth/2fa" });

    expect(createSession).not.toHaveBeenCalled();
    // The cookie carries a SIGNED claim, never the raw user id — a raw id
    // is forgeable, and /auth/2fa would then mint a session for anyone
    // holding a code. Verified rather than pattern-matched, so the
    // assertion cannot pass on some other opaque string.
    const [, value, options] = cookies.set.mock.calls.find(
      (c) => c[0] === "pending_2fa",
    ) as unknown as [string, string, Record<string, unknown>];
    expect(value).not.toBe("u1");
    expect(verifyPreAuthToken(value)).toMatchObject({ userId: "u1" });
    expect(options).toMatchObject({ httpOnly: true, maxAge: 300, path: "/" });
  });

  it("still creates a session directly when the linked user has 2FA disabled", async () => {
    fakeDb.seed(oauthAccounts, [{ userId: "u1" }]);
    fakeDb.seed(users, [{ ...baseUser }]);
    const cookies = makeCookies();

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/dashboard" });

    expect(createSession).toHaveBeenCalledWith("u1", { authenticatedAt: expect.any(Date) });
    expect(cookies.set).toHaveBeenCalledWith("auth_session", "sess-1", expect.anything());
    const pendingCall = cookies.set.mock.calls.find((c) => c[0] === "pending_2fa");
    expect(pendingCall).toBeUndefined();
  });
});

describe("GET /auth/callback/[provider] — returning to the page that asked for a sign-in", () => {
  const start = (cookies: ReturnType<typeof makeCookies>, query: string) =>
    GET({
      params: { provider: "github" },
      url: new URL(`http://localhost/auth/callback/github${query}`),
      cookies,
    } as never);

  it("remembers an allowed returnTo on the way out to the provider", async () => {
    const cookies = makeCookies();
    await expect(start(cookies, "?returnTo=%2Fsettings%2Fprivacy")).rejects.toMatchObject({
      status: 302,
      location: "https://github.com/login/oauth/authorize",
    });
    expect(cookies.set).toHaveBeenCalledWith(
      "auth_return_to",
      "/settings/privacy",
      expect.objectContaining({ httpOnly: true, maxAge: 600, path: "/", sameSite: "lax" }),
    );
  });

  it("clears any remembered path for a returnTo it does not allow", async () => {
    const cookies = makeCookies({ auth_return_to: "/settings/data" });
    await expect(start(cookies, "?returnTo=%2F%2Fevil.example")).rejects.toMatchObject({
      status: 302,
    });
    expect(cookies.set.mock.calls.some((c) => c[0] === "auth_return_to")).toBe(false);
    expect(cookies.delete).toHaveBeenCalledWith("auth_return_to", expect.anything());
  });

  it("sends a signed-in user back to the remembered page, once", async () => {
    fakeDb.seed(oauthAccounts, [{ userId: "u1" }]);
    fakeDb.seed(users, [{ ...baseUser }]);
    const cookies = makeCookies({ auth_return_to: "/settings/data" });

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/settings/data" });
    expect(cookies.delete).toHaveBeenCalledWith("auth_return_to", expect.anything());
  });

  it("ignores a remembered value that is not one of the pages", async () => {
    fakeDb.seed(oauthAccounts, [{ userId: "u1" }]);
    fakeDb.seed(users, [{ ...baseUser }]);
    const cookies = makeCookies({ auth_return_to: "https://evil.example" });

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/dashboard" });
  });

  it("leaves the remembered page for /auth/2fa to use when a second factor is due", async () => {
    fakeDb.seed(oauthAccounts, [{ userId: "u1" }]);
    fakeDb.seed(users, [{ ...baseUser, twoFactorEnabled: true }]);
    const cookies = makeCookies({ auth_return_to: "/settings/privacy" });

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/auth/2fa" });
    expect(cookies.delete.mock.calls.some((c) => c[0] === "auth_return_to")).toBe(false);
  });
});
