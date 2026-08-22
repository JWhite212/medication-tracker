import { describe, it, expect, vi, beforeEach } from "vitest";

// hooks.server.ts is the only thing putting security headers on dynamic
// responses, and it had no test at all. The risk it carries is specific:
// applySecurityHeaders is called from two separate return paths (the
// no-cookie short-circuit and the normal path), so a header added to one
// and not the other is invisible unless both are exercised.

const envState = { dev: false };
vi.mock("$app/environment", () => ({
  get dev() {
    return envState.dev;
  },
}));

// Bare side-effect import in hooks.server.ts that validates real env vars.
vi.mock("$lib/server/env", () => ({}));

const validateSession = vi.fn(async (_id: string) => ({ session: null, user: null }) as unknown);
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    sessionCookieName: "auth_session",
    validateSession: (id: string) => validateSession(id),
    createSessionCookie: (id: string) => ({
      name: "auth_session",
      value: id,
      attributes: {},
    }),
    createBlankSessionCookie: () => ({ name: "auth_session", value: "", attributes: {} }),
  },
}));

const { handle } = await import("../../src/hooks.server");

function makeEvent(sessionCookie?: string) {
  return {
    cookies: {
      get: (name: string) => (name === "auth_session" ? sessionCookie : undefined),
      set: vi.fn(),
    },
    locals: {} as Record<string, unknown>,
  };
}

const resolve = async () => new Response("ok");

async function run(sessionCookie?: string): Promise<Response> {
  return handle({ event: makeEvent(sessionCookie), resolve } as never);
}

const ALWAYS_ON: [string, string][] = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
];

beforeEach(() => {
  envState.dev = false;
  validateSession.mockReset();
  validateSession.mockResolvedValue({ session: null, user: null });
});

describe("security headers on the anonymous path", () => {
  it.each(ALWAYS_ON)("sets %s", async (key, value) => {
    const response = await run(undefined);
    expect(response.headers.get(key)).toBe(value);
  });

  it("disables the sensor and payment APIs via Permissions-Policy", async () => {
    const response = await run(undefined);
    const policy = response.headers.get("Permissions-Policy") ?? "";
    for (const feature of ["camera", "geolocation", "microphone", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`);
    }
  });

  it("does not consult lucia when there is no session cookie", async () => {
    await run(undefined);
    expect(validateSession).not.toHaveBeenCalled();
  });
});

describe("security headers on the authenticated path", () => {
  // The second return path. A header added only to the anonymous branch
  // would leave every logged-in page — the ones showing medical data —
  // uncovered, which is exactly the wrong way round.
  beforeEach(() => {
    validateSession.mockResolvedValue({
      session: { id: "sess-1", fresh: false },
      user: { id: "user-1" },
    });
  });

  it.each(ALWAYS_ON)("sets %s", async (key, value) => {
    const response = await run("sess-1");
    expect(response.headers.get(key)).toBe(value);
  });
});

describe("security headers when the session is rejected", () => {
  it.each(ALWAYS_ON)("still sets %s", async (key, value) => {
    validateSession.mockResolvedValue({ session: null, user: null });
    const response = await run("stale-session");
    expect(response.headers.get(key)).toBe(value);
  });
});

describe("HSTS", () => {
  it("is sent in production with at least a one-year max-age", async () => {
    envState.dev = false;
    const response = await run(undefined);
    const hsts = response.headers.get("Strict-Transport-Security") ?? "";
    expect(Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0)).toBeGreaterThanOrEqual(31536000);
    expect(hsts).toContain("includeSubDomains");
  });

  it("is withheld in dev so localhost is not pinned to https", async () => {
    // Setting HSTS on localhost poisons the browser for every other project
    // served from the same origin, and it cannot be cleared per-port.
    envState.dev = true;
    const response = await run(undefined);
    expect(response.headers.get("Strict-Transport-Security")).toBeNull();
  });
});
