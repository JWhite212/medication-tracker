import { describe, it, expect, vi } from "vitest";
import { isRedirect } from "@sveltejs/kit";

// The load only routes; it runs no query, so the db must stay untouched.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);
vi.mock("$lib/server/email", () => ({ sendPasswordResetEmail: async () => ({ ok: true }) }));

const { load } = await import("../../src/routes/auth/reset-password/+page.server");

const SIGNED_IN = { id: "user-1", email: "a@example.com" };

async function run(search: string, user: unknown) {
  try {
    await load({
      locals: { user, session: user ? { id: "sess-1" } : null },
      url: new URL(`http://x/auth/reset-password${search}`),
    } as never);
  } catch (e) {
    if (isRedirect(e)) return { status: e.status, location: e.location };
    throw e;
  }
  return null;
}

describe("reset-password load", () => {
  it("forwards the emailed token to the confirm page when signed in", async () => {
    // The link was opened in a browser that already has a session: the
    // token must survive rather than be dropped on the way to /dashboard.
    expect(await run("?token=tok-123", SIGNED_IN)).toEqual({
      status: 302,
      location: "/auth/reset-password/confirm?token=tok-123",
    });
  });

  it("forwards the emailed token to the confirm page when signed out", async () => {
    expect(await run("?token=tok-123", null)).toEqual({
      status: 302,
      location: "/auth/reset-password/confirm?token=tok-123",
    });
  });

  it("re-encodes the token so it cannot add parameters to the confirm URL", async () => {
    expect(await run("?token=a%26b%3Dc", null)).toEqual({
      status: 302,
      location: "/auth/reset-password/confirm?token=a%26b%3Dc",
    });
  });

  it("still sends a signed-in user with no token to the dashboard", async () => {
    expect(await run("", SIGNED_IN)).toEqual({ status: 302, location: "/dashboard" });
  });

  it("renders the request form for a signed-out user with no token", async () => {
    expect(await run("", null)).toBeNull();
  });
});
