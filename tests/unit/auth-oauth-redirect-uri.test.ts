import { describe, expect, it, vi } from "vitest";

// Real arctic, real oauth.ts: only the environment is stubbed. Every other
// suite mocks `$lib/server/auth/oauth` wholesale, which is how a relative
// redirect URI survived from the first OAuth commit.
vi.mock("$env/dynamic/private", () => ({
  env: {
    GOOGLE_CLIENT_ID: "g-id",
    GOOGLE_CLIENT_SECRET: "g-secret",
    GITHUB_CLIENT_ID: "gh-id",
    GITHUB_CLIENT_SECRET: "gh-secret",
  },
}));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_BASE_URL: "https://app.example/" } }));
vi.mock("$app/environment", () => ({ dev: false }));

const { getGoogle, getGitHub } = await import("$lib/server/auth/oauth");

function redirectUriOf(url: URL): string {
  const uri = url.searchParams.get("redirect_uri");
  expect(uri).not.toBeNull();
  // Absolute: parses with no base.
  expect(() => new URL(uri!)).not.toThrow();
  return uri!;
}

describe("OAuth redirect URIs are absolute and built from PUBLIC_BASE_URL", () => {
  it("Google", () => {
    const url = getGoogle()!.createAuthorizationURL("state", "verifier", ["openid"]);
    expect(redirectUriOf(url)).toBe("https://app.example/auth/callback/google");
  });

  it("GitHub", () => {
    const url = getGitHub()!.createAuthorizationURL("state", ["user:email"]);
    expect(redirectUriOf(url)).toBe("https://app.example/auth/callback/github");
  });
});
