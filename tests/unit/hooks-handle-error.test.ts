import { describe, it, expect, vi, beforeEach } from "vitest";

// `hooks.server.ts` imports `$lib/server/env`, which throws unless the boot
// vars are present, and lucia, which reaches the database.
vi.mock("$env/dynamic/private", () => ({
  env: { DATABASE_URL: "postgres://x", ENCRYPTION_KEY: "k" },
}));
vi.mock("$env/dynamic/public", () => ({ env: { PUBLIC_BASE_URL: "https://x.test" } }));
vi.mock("$app/environment", () => ({ dev: true, building: false }));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { sessionCookieName: "auth_session" },
}));

const logged: Array<{ message: string; fields: Record<string, unknown>; error: unknown }> = [];
vi.mock("$lib/server/log", () => ({
  logError: (message: string, fields: Record<string, unknown>, error: unknown) =>
    logged.push({ message, fields, error }),
  logWarn: () => {},
}));

const { handleError } = await import("../../src/hooks.server");

/**
 * The failure seam. SvelteKit calls `handleError` only for errors nobody
 * threw on purpose — an `error(404, …)` bypasses it — so everything arriving
 * here is a genuine crash.
 *
 * Two jobs, and the second one is a security boundary: record it once,
 * server-side, with enough context to find it again; and return something the
 * user can quote that contains NOTHING from the exception.
 */

function event(overrides: Record<string, unknown> = {}) {
  return {
    request: { method: "POST" },
    route: { id: "/(app)/dashboard" },
    url: new URL("https://x.test/dashboard?q=secret"),
    locals: { user: { id: "u1" } },
    ...overrides,
  };
}

function call(error: unknown, overrides: Record<string, unknown> = {}) {
  return handleError!({
    error,
    event: event(overrides),
    status: 500,
    message: "Internal Error",
  } as never) as { message: string; errorId: string };
}

beforeEach(() => {
  logged.length = 0;
});

describe("handleError — what reaches the user", () => {
  it("returns a fixed message and a reference, never the exception", () => {
    const result = call(new Error("connection string postgres://user:hunter2@db/prod"));

    expect(result.message).toBe("Something went wrong on our end.");
    expect(result.errorId).toMatch(/^[0-9a-f]{8}$/);
  });

  it.each([
    [
      "a Postgres constraint violation",
      new Error('duplicate key value violates "users_email_key"'),
    ],
    ["a thrown string", "ENCRYPTION_KEY is not set"],
    ["a thrown object", { secret: "hunter2" }],
  ])("leaks nothing from %s", (_label, thrown) => {
    const result = call(thrown);

    // The whole returned object is serialised into the page, so it is the
    // thing that must be clean — not just the message field.
    expect(JSON.stringify(result)).not.toMatch(/hunter2|users_email_key|ENCRYPTION_KEY/);
  });

  it("mints a different reference every time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => call(new Error("x")).errorId));
    expect(ids.size).toBe(50);
  });
});

describe("handleError — what reaches the log", () => {
  it("records exactly one line, carrying the same id the user was shown", () => {
    const result = call(new Error("boom"));

    expect(logged).toHaveLength(1);
    expect(logged[0].fields.errorId).toBe(result.errorId);
  });

  it("carries the request context needed to find it again", () => {
    call(new Error("boom"));

    expect(logged[0].fields).toMatchObject({
      scope: "http",
      status: 500,
      method: "POST",
      routeId: "/(app)/dashboard",
      path: "/dashboard",
      userId: "u1",
    });
  });

  it("passes the original error through, so the stack survives", () => {
    const thrown = new Error("boom");
    call(thrown);
    expect(logged[0].error).toBe(thrown);
  });

  it("logs the path but NOT the query string", () => {
    // Query strings carry user input — the log search term on /log, for one.
    call(new Error("boom"));
    expect(JSON.stringify(logged[0].fields)).not.toContain("secret");
  });

  it("survives an anonymous request", () => {
    const result = call(new Error("boom"), { locals: { user: null } });

    expect(result.errorId).toMatch(/^[0-9a-f]{8}$/);
    expect(logged[0].fields.userId).toBeUndefined();
  });
});
