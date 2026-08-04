import { describe, it, expect, vi, beforeEach } from "vitest";

// Exercises the OAuth callback's post-verification branch: an existing
// oauth_accounts link must route a 2FA-enabled user through the same
// pending_2fa → /auth/2fa challenge as the password login instead of
// minting a session directly. The GitHub provider is used because its
// exchange has no PKCE cookie, keeping the fixture minimal; the branch
// under test is provider-agnostic.
const state = {
  selectQueue: [] as Array<Record<string, unknown>[]>,
};

vi.mock("$app/environment", () => ({ dev: true }));

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

vi.mock("$lib/server/db/schema", () => ({
  users: { id: {}, email: {} },
  oauthAccounts: { provider: {}, providerUserId: {}, userId: {} },
}));

const inserts: Array<{ values: unknown }> = [];
vi.mock("$lib/server/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.selectQueue.shift() ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: async (values: unknown) => {
        inserts.push({ values });
      },
    }),
  },
}));

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

function makeCookies() {
  const jar = new Map<string, string>([["oauth_state", "st-1"]]);
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
  state.selectQueue = [];
  inserts.length = 0;
  createSession.mockClear();
  vi.stubGlobal("fetch", githubFetchStub());
});

describe("GET /auth/callback/[provider] — existing linked account", () => {
  it("redirects a 2FA-enabled user to /auth/2fa without creating a session", async () => {
    // 1st select: oauthAccounts link. 2nd select: linked user with 2FA on.
    state.selectQueue = [[{ userId: "u1" }], [{ ...baseUser, twoFactorEnabled: true }]];
    const cookies = makeCookies();

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/auth/2fa" });

    expect(createSession).not.toHaveBeenCalled();
    expect(cookies.set).toHaveBeenCalledWith(
      "pending_2fa",
      "u1",
      expect.objectContaining({ httpOnly: true, maxAge: 300, path: "/" }),
    );
  });

  it("still creates a session directly when the linked user has 2FA disabled", async () => {
    state.selectQueue = [[{ userId: "u1" }], [{ ...baseUser }]];
    const cookies = makeCookies();

    await expect(call(cookies)).rejects.toMatchObject({ status: 302, location: "/dashboard" });

    expect(createSession).toHaveBeenCalledWith("u1", {});
    expect(cookies.set).toHaveBeenCalledWith("auth_session", "sess-1", expect.anything());
    const pendingCall = cookies.set.mock.calls.find((c) => c[0] === "pending_2fa");
    expect(pendingCall).toBeUndefined();
  });
});
