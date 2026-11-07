// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "../../../src/lib/server/db/schema";

// "Sign in again to confirm" on an account with a second factor ends at
// /auth/2fa, not at the OAuth callback: the callback hands over a pending_2fa
// claim and this action mints the session. Whether the session the browser
// arrived with survives is decided by what is left in the `sessions` table, so
// this runs Lucia's real Drizzle adapter against the real migrations, beside
// tests/unit/pg/oauth-callback-session-rotation.test.ts which pins the same
// rule for the callback. Only the TOTP check is stubbed: the code itself is
// not what is under test.
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-key-2fa" } }));
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

const totp = vi.hoisted(() => ({ ok: true }));
vi.mock("$lib/server/auth/totp", () => ({
  verifySecondFactorForLogin: async () => totp.ok,
  verifyAndConsumeTOTPCode: async () => totp.ok,
}));

import { pgDb } from "../helpers/pg-db";

const { lucia } = await import("../../../src/lib/server/auth/lucia");
const { signPreAuthToken } = await import("../../../src/lib/server/api/preauth");
const { actions } = await import("../../../src/routes/auth/2fa/+page.server");

function makeCookies(pendingFor: string) {
  const jar = new Map<string, string>([["pending_2fa", signPreAuthToken(pendingFor)]]);
  return {
    jar,
    get: (name: string) => jar.get(name),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  };
}

async function completeTwoFactor(
  pendingFor: string,
  session: Awaited<ReturnType<typeof lucia.createSession>> | null,
) {
  const cookies = makeCookies(pendingFor);
  let result: unknown;
  try {
    result = await actions.default({
      request: new Request("http://localhost/auth/2fa", {
        method: "POST",
        body: new URLSearchParams({ code: "123456" }),
      }),
      cookies,
      getClientAddress: () => "127.0.0.1",
      locals: { session, user: null },
    } as never);
  } catch (e) {
    // A completed second factor is a thrown redirect.
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
  totp.ok = true;
  await pgDb.seedUser({ id: "u1", email: "ada@example.com", twoFactorEnabled: true });
});

describe("/auth/2fa ends the session the browser arrived with", () => {
  it("rotates rather than adds when a signed-in user re-confirms through 2FA", async () => {
    const before = await signedIn("u1");
    // Another device's session is not this browser's to end.
    const otherDevice = await signedIn("u1");

    const { result, cookies } = await completeTwoFactor("u1", before);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    const minted = cookies.jar.get(lucia.sessionCookieName);
    expect(minted).toBeDefined();
    expect(minted).not.toBe(before.id);
    expect(await sessionIds("u1")).toEqual([minted, otherDevice.id].sort());
  });

  it("ends a different account's session when completing 2FA as someone else", async () => {
    await pgDb.seedUser({ id: "u2", email: "bob@example.com" });
    const bob = await signedIn("u2");

    const { result, cookies } = await completeTwoFactor("u1", bob);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    expect(await sessionIds("u2")).toEqual([]);
    expect(await sessionIds("u1")).toEqual([cookies.jar.get(lucia.sessionCookieName)]);
  });

  it("leaves the session alone when the code is wrong and nothing is minted", async () => {
    totp.ok = false;
    const before = await signedIn("u1");

    const { result } = await completeTwoFactor("u1", before);

    expect(result).toMatchObject({ status: 400 });
    expect(await sessionIds("u1")).toEqual([before.id]);
  });

  it("signs in a visitor with no session as before", async () => {
    const { result, cookies } = await completeTwoFactor("u1", null);

    expect(result).toMatchObject({ status: 302, location: "/dashboard" });
    expect(await sessionIds("u1")).toEqual([cookies.jar.get(lucia.sessionCookieName)]);
  });
});
