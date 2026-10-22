// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

// Where "Sign in again to confirm" sends the user back to. The allowlist is
// exact on purpose: a redirect target taken from a query string and then a
// cookie is an open redirect the moment it accepts a prefix.
vi.mock("$app/environment", () => ({ dev: false }));

import {
  RETURN_PATHS,
  returnPathOrNull,
  signInAgainHref,
} from "../../src/lib/utils/destructive-confirm";
import {
  RETURN_PATH_COOKIE,
  rememberReturnPath,
  takeReturnPath,
} from "../../src/lib/server/auth/return-path";

function jar(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (name: string) => values.get(name),
    set: vi.fn((name: string, value: string) => void values.set(name, value)),
    delete: vi.fn((name: string) => void values.delete(name)),
  };
}

describe("returnPathOrNull", () => {
  it("accepts exactly the three deletion pages", () => {
    expect([...RETURN_PATHS]).toEqual([
      "/settings/privacy",
      "/settings/data",
      "/settings/data/import",
    ]);
    for (const path of RETURN_PATHS) expect(returnPathOrNull(path)).toBe(path);
  });

  it("refuses everything else", () => {
    for (const candidate of [
      "/dashboard",
      "//evil.example",
      "/\\evil.example",
      "https://evil.example/settings/privacy",
      "/settings/privacy?x=1",
      "/settings/privacy/",
      "/settings/privacy#x",
      "/settings/data/import/../..",
      "%2Fsettings%2Fprivacy",
      "/Settings/Privacy",
      " /settings/privacy",
      "",
      null,
      undefined,
    ]) {
      expect(returnPathOrNull(candidate), String(candidate)).toBeNull();
    }
  });

  it("round-trips every return path through a built href", () => {
    for (const provider of ["google", "github"] as const) {
      for (const path of RETURN_PATHS) {
        const url = new URL(signInAgainHref(provider, path), "http://localhost");
        expect(url.pathname).toBe(`/auth/callback/${provider}`);
        expect(returnPathOrNull(url.searchParams.get("returnTo"))).toBe(path);
      }
    }
  });
});

describe("the return-path cookie", () => {
  it("is remembered for an allowed path, with the oauth_state cookie's options", () => {
    const cookies = jar();
    rememberReturnPath(cookies as never, "/settings/data/import");
    expect(cookies.set).toHaveBeenCalledWith(RETURN_PATH_COOKIE, "/settings/data/import", {
      path: "/",
      httpOnly: true,
      secure: true,
      maxAge: 600,
      sameSite: "lax",
    });
    expect(RETURN_PATH_COOKIE).toBe("auth_return_to");
  });

  it("is cleared, not set, for anything else, so an abandoned attempt cannot steer this one", () => {
    for (const candidate of ["//evil.example", null]) {
      const cookies = jar({ auth_return_to: "/settings/privacy" });
      rememberReturnPath(cookies as never, candidate);
      expect(cookies.set).not.toHaveBeenCalled();
      expect(cookies.delete).toHaveBeenCalledWith(RETURN_PATH_COOKIE, { path: "/" });
      expect(cookies.values.has(RETURN_PATH_COOKIE)).toBe(false);
    }
  });

  it("is taken once: read, deleted, and re-checked, since a cookie is the user's to edit", () => {
    const good = jar({ auth_return_to: "/settings/privacy" });
    expect(takeReturnPath(good as never)).toBe("/settings/privacy");
    expect(good.delete).toHaveBeenCalledWith(RETURN_PATH_COOKIE, { path: "/" });
    expect(takeReturnPath(good as never)).toBeNull();

    const tampered = jar({ auth_return_to: "https://evil.example" });
    expect(takeReturnPath(tampered as never)).toBeNull();
    expect(tampered.values.has(RETURN_PATH_COOKIE)).toBe(false);

    expect(takeReturnPath(jar() as never)).toBeNull();
  });
});
