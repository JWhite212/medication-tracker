import { describe, it, expect, vi, beforeEach } from "vitest";

// Cancel on a provider's consent screen comes back to the callback as an
// error response with no code (RFC 6749 §4.1.2.1). The handler used to read
// "no code" as "start a new attempt" and redirect straight back to the
// provider, so Cancel looped and the user could never leave. These pin that
// an error response ends the attempt instead.
vi.mock("$app/environment", () => ({ dev: true }));
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-key-cancel" } }));

const authorize = vi.hoisted(() => ({ google: vi.fn(), github: vi.fn() }));
vi.mock("$lib/server/auth/oauth", () => ({
  getGoogle: () => ({
    createAuthorizationURL: (...args: unknown[]) => {
      authorize.google(...args);
      return new URL("https://accounts.google.com/o/oauth2/v2/auth");
    },
  }),
  getGitHub: () => ({
    createAuthorizationURL: (...args: unknown[]) => {
      authorize.github(...args);
      return new URL("https://github.com/login/oauth/authorize");
    },
  }),
}));

// Cancelling signs nobody in and reads nothing: both of these throw if touched.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: new Proxy(
    {},
    {
      get: (_t, prop) => {
        throw new Error(`lucia.${String(prop)} must not be reached when sign-in is cancelled`);
      },
    },
  ),
}));

const { GET } = await import("../../src/routes/auth/callback/[provider]/+server");

function makeCookies() {
  const jar = new Map<string, string>([
    ["oauth_state", "st-1"],
    ["google_code_verifier", "cv-1"],
    ["auth_return_to", "/settings/privacy"],
  ]);
  return {
    jar,
    get: (name: string) => jar.get(name),
    set: vi.fn((name: string, value: string) => void jar.set(name, value)),
    delete: vi.fn((name: string) => void jar.delete(name)),
  };
}

async function callback(provider: string, query: string) {
  const cookies = makeCookies();
  let result: unknown;
  try {
    await GET({
      params: { provider },
      url: new URL(`http://localhost/auth/callback/${provider}${query}`),
      cookies,
      locals: { session: null, user: null },
    } as never);
  } catch (e) {
    result = e;
  }
  return { result, cookies };
}

beforeEach(() => {
  authorize.google.mockClear();
  authorize.github.mockClear();
});

describe("GET /auth/callback/[provider] — the provider returned an error", () => {
  it.each(["google", "github"])(
    "Cancel on %s's consent screen lands on sign-in with a reason, not back at the provider",
    async (provider) => {
      const { result, cookies } = await callback(provider, "?error=access_denied&state=st-1");

      expect(result).toMatchObject({ status: 302, location: "/auth/login?error=oauth_cancelled" });
      expect(authorize.google).not.toHaveBeenCalled();
      expect(authorize.github).not.toHaveBeenCalled();
      // The attempt is over: none of its cookies survive, and none is re-set.
      expect(cookies.jar.has("oauth_state")).toBe(false);
      expect(cookies.jar.has("google_code_verifier")).toBe(false);
      expect(cookies.jar.has("auth_return_to")).toBe(false);
      expect(cookies.set).not.toHaveBeenCalled();
    },
  );

  it("names any other provider error as a failed sign-in rather than a cancel", async () => {
    const { result, cookies } = await callback("github", "?error=server_error&state=st-1");

    expect(result).toMatchObject({ status: 302, location: "/auth/login?error=oauth_failed" });
    expect(authorize.github).not.toHaveBeenCalled();
    expect(cookies.jar.has("oauth_state")).toBe(false);
  });

  it("still starts an attempt when there is neither a code nor an error", async () => {
    const { result } = await callback("github", "");

    expect(result).toMatchObject({
      status: 302,
      location: "https://github.com/login/oauth/authorize",
    });
    expect(authorize.github).toHaveBeenCalledTimes(1);
  });
});
