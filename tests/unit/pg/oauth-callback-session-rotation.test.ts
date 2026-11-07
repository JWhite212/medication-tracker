// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { oauthAccounts, sessions, users } from "../../../src/lib/server/db/schema";

// A signed-in user reaches the OAuth callback on purpose: "Sign in again to
// confirm" sends them through it. Whether the session they arrived with
// survives is decided by what is left in the `sessions` table, so this runs
// Lucia's real Drizzle adapter against the real migrations — the fake-db
// suite mocks Lucia and would only see that a method was called.
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-key-oauth" } }));
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);
vi.mock("$lib/server/auth/oauth", () => ({
  getGoogle: () => null,
  getGitHub: () => ({
    createAuthorizationURL: () => new URL("https://github.com/login/oauth/authorize"),
    validateAuthorizationCode: async () => ({ accessToken: () => "gh-access-token" }),
  }),
}));

import { pgDb } from "../helpers/pg-db";

const { lucia } = await import("../../../src/lib/server/auth/lucia");
const { GET } = await import("../../../src/routes/auth/callback/[provider]/+server");

const GITHUB_ID = "42";

function stubGitHub(email: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/user/emails")) {
        return new Response(JSON.stringify([{ email, primary: true, verified: true }]));
      }
      return new Response(JSON.stringify({ id: Number(GITHUB_ID), name: "Ada", login: "ada" }));
    }),
  );
}

function makeCookies() {
  const jar = new Map<string, string>([["oauth_state", "st-1"]]);
  return {
    jar,
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  };
}

async function callback(session: Awaited<ReturnType<typeof lucia.createSession>> | null) {
  const cookies = makeCookies();
  // Every outcome of this handler is a thrown redirect; capture it.
  let result: unknown;
  try {
    await GET({
      params: { provider: "github" },
      url: new URL("http://localhost/auth/callback/github?code=abc&state=st-1"),
      cookies,
      locals: { session, user: null },
    } as never);
  } catch (e) {
    result = e;
  }
  return { result, cookies };
}

const sessionIds = async (userId: string) =>
  (await pgDb.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)))
    .map((r) => r.id)
    .sort();

const signedIn = (userId: string) =>
  lucia.createSession(userId, { authenticatedAt: new Date("2026-01-01T00:00:00Z") });

beforeEach(async () => {
  await pgDb.reset();
  stubGitHub("ada@example.com");
});

describe("OAuth callback ends the session the browser arrived with", () => {
  it("rotates rather than adds on a re-sign-in to the same account", async () => {
    await pgDb.seedUser({ id: "u1", email: "ada@example.com" });
    await pgDb.db
      .insert(oauthAccounts)
      .values({ provider: "github", providerUserId: GITHUB_ID, userId: "u1" });
    const before = await signedIn("u1");
    // Another device's session is not this browser's to end.
    const otherDevice = await signedIn("u1");

    const { result, cookies } = await callback(before);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    const minted = cookies.jar.get(lucia.sessionCookieName);
    expect(minted).toBeDefined();
    expect(minted).not.toBe(before.id);
    expect(await sessionIds("u1")).toEqual([minted, otherDevice.id].sort());
  });

  it("ends a different account's session when signing in as someone else", async () => {
    await pgDb.seedUser({ id: "u1", email: "ada@example.com" });
    await pgDb.seedUser({ id: "u2", email: "bob@example.com" });
    await pgDb.db
      .insert(oauthAccounts)
      .values({ provider: "github", providerUserId: GITHUB_ID, userId: "u1" });
    const bob = await signedIn("u2");

    const { result, cookies } = await callback(bob);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    expect(await sessionIds("u2")).toEqual([]);
    expect(await sessionIds("u1")).toEqual([cookies.jar.get(lucia.sessionCookieName)]);
  });

  it("ends it on the new-account path too", async () => {
    await pgDb.seedUser({ id: "u2", email: "bob@example.com" });
    const bob = await signedIn("u2");

    const { result, cookies } = await callback(bob);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    expect(await sessionIds("u2")).toEqual([]);
    const [created] = await pgDb.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "ada@example.com"));
    expect(await sessionIds(created.id)).toEqual([cookies.jar.get(lucia.sessionCookieName)]);
  });

  it("leaves the session alone when a second factor is still due and nothing is minted", async () => {
    await pgDb.seedUser({ id: "u1", email: "ada@example.com", twoFactorEnabled: true });
    await pgDb.db
      .insert(oauthAccounts)
      .values({ provider: "github", providerUserId: GITHUB_ID, userId: "u1" });
    const before = await signedIn("u1");

    const { result } = await callback(before);

    expect(result).toMatchObject({ status: 302, location: "/auth/2fa" });
    expect(await sessionIds("u1")).toEqual([before.id]);
  });

  it("signs in a visitor with no session as before", async () => {
    await pgDb.seedUser({ id: "u1", email: "ada@example.com" });
    await pgDb.db
      .insert(oauthAccounts)
      .values({ provider: "github", providerUserId: GITHUB_ID, userId: "u1" });

    const { result, cookies } = await callback(null);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    expect(await sessionIds("u1")).toEqual([cookies.jar.get(lucia.sessionCookieName)]);
  });
});
