// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The one server gate on the four browser deletions nothing can undo.
 *
 * fake-db, not PGlite: the guard is one read of `users.password_hash`
 * followed by branches in TypeScript (the sign-in time arrives on the
 * session, already read), so nothing about it is decided by the database
 * (CLAUDE.md's test-seam rule).
 *
 * `reauthMessage`'s own wording is pinned in auth-reauth.test.ts; here the
 * mock only proves the guard delegates to it.
 */

const { confirmReauth, reauthMessage, configuredWebProviders } = vi.hoisted(() => ({
  confirmReauth: vi.fn(),
  reauthMessage: vi.fn(() => "REAUTH MESSAGE"),
  configuredWebProviders: vi.fn((): ("google" | "github")[] => ["google", "github"]),
}));

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/auth/reauth", () => ({ confirmReauth, reauthMessage }));
vi.mock("$lib/server/auth/oauth", () => ({ configuredWebProviders }));

import { fakeDb, predicateIncludes } from "./helpers/fake-db";
import { oauthAccounts, users } from "$lib/server/db/schema";
import {
  accountHasPassword,
  checkDestructiveGuard,
  destructiveConfirmation,
  signedInRecently,
} from "../../src/lib/server/auth/destructive-guard";
import {
  RECENT_SIGN_IN_MESSAGE,
  RECENT_SIGN_IN_WINDOW_MS,
} from "../../src/lib/utils/destructive-confirm";

const NOW = new Date("2026-10-22T09:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
/** Signed in a millisecond ago: the ordinary case, so every older test keeps its meaning. */
const RECENT = { userId: "u1", authenticatedAt: ago(1) };
const DOSES = { word: "DELETE", purpose: "wipe_dose_history", now: NOW } as const;

function seedPassword() {
  fakeDb.seed(users, [{ passwordHash: "$argon2id$x" }]);
}
function seedPasswordless() {
  fakeDb.seed(users, [{ passwordHash: null }]);
}
function seedNoRow() {
  fakeDb.seed(users, []);
}

function fd(fields: { confirmWord?: string; password?: string }): FormData {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(key, value);
  }
  return form;
}

beforeEach(() => {
  fakeDb.reset();
  confirmReauth.mockReset();
  reauthMessage.mockClear();
  configuredWebProviders.mockReset();
  configuredWebProviders.mockReturnValue(["google", "github"]);
});

it("refuses a missing word before reading the account or spending a password attempt", async () => {
  seedPassword();
  expect(await checkDestructiveGuard(RECENT, fd({ password: "hunter2" }), DOSES)).toEqual({
    ok: false,
    error: "Type DELETE to confirm.",
  });
  expect(confirmReauth).not.toHaveBeenCalled();
  expect(fakeDb.attempted).toEqual([]); // no select at all
});

it("refuses a wrong word, case-sensitively, naming the word it wants", async () => {
  seedPasswordless();
  for (const typed of ["delete", "Delete", "DELET", "DELETE!"]) {
    expect(await checkDestructiveGuard(RECENT, fd({ confirmWord: typed }), DOSES)).toEqual({
      ok: false,
      error: "Type DELETE to confirm.",
    });
  }
  expect(
    await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE" }), {
      word: "REPLACE",
      purpose: "import_replace_data",
      now: NOW,
    }),
  ).toEqual({ ok: false, error: "Type REPLACE to confirm." });
});

it("trims the typed word", async () => {
  seedPasswordless();
  expect(await checkDestructiveGuard(RECENT, fd({ confirmWord: "  DELETE \n" }), DOSES)).toEqual({
    ok: true,
  });
});

it("asks a password account for its password without spending an attempt", async () => {
  seedPassword();
  expect(await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE" }), DOSES)).toEqual({
    ok: false,
    error: "Password is required to confirm this action.",
  });
  expect(confirmReauth).not.toHaveBeenCalled();
});

it("re-authenticates a password account for the purpose given, and reports a refusal through reauthMessage", async () => {
  seedPassword();
  const refusal = { ok: false, rateLimited: true, retryAfterMs: 60_000 };
  confirmReauth.mockResolvedValueOnce(refusal);
  expect(
    await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE", password: "hunter2" }), DOSES),
  ).toEqual({ ok: false, error: "REAUTH MESSAGE" });
  expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "wipe_dose_history");
  expect(reauthMessage).toHaveBeenCalledWith(refusal);
});

it("passes a password account with the word and a confirmed password", async () => {
  seedPassword();
  confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
  expect(
    await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE", password: "hunter2" }), DOSES),
  ).toEqual({ ok: true });
});

it("passes an account with no password on the word and a recent sign-in, and never calls confirmReauth", async () => {
  seedPasswordless();
  expect(
    await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE", password: "ignored" }), DOSES),
  ).toEqual({ ok: true });
  expect(confirmReauth).not.toHaveBeenCalled();
});

it("reads the password state of the user it was given", async () => {
  seedPasswordless();
  await checkDestructiveGuard(RECENT, fd({ confirmWord: "DELETE" }), DOSES);
  const read = fakeDb.attempted.find((c) => c.op === "select" && c.table === "users");
  expect(read, "the guard should read the users table").toBeDefined();
  expect(predicateIncludes(read?.predicate, "u1")).toBe(true);
});

describe("an account with no password must have signed in recently", () => {
  const REFUSED = { ok: false, error: RECENT_SIGN_IN_MESSAGE };
  const asOf = (authenticatedAt: Date | null) => ({ userId: "u1", authenticatedAt });

  it("passes one millisecond inside the window", async () => {
    seedPasswordless();
    const signedIn = asOf(ago(RECENT_SIGN_IN_WINDOW_MS - 1));
    expect(await checkDestructiveGuard(signedIn, fd({ confirmWord: "DELETE" }), DOSES)).toEqual({
      ok: true,
    });
  });

  it("refuses exactly one window after signing in", async () => {
    seedPasswordless();
    const signedIn = asOf(ago(RECENT_SIGN_IN_WINDOW_MS));
    expect(await checkDestructiveGuard(signedIn, fd({ confirmWord: "DELETE" }), DOSES)).toEqual(
      REFUSED,
    );
  });

  it("refuses a session with no recorded sign-in, as every pre-existing session has", async () => {
    seedPasswordless();
    expect(await checkDestructiveGuard(asOf(null), fd({ confirmWord: "DELETE" }), DOSES)).toEqual(
      REFUSED,
    );
  });

  it("checks the word before the sign-in time", async () => {
    seedPasswordless();
    expect(await checkDestructiveGuard(asOf(null), fd({ confirmWord: "delete" }), DOSES)).toEqual({
      ok: false,
      error: "Type DELETE to confirm.",
    });
  });

  it("never asks a password account about its sign-in time", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
    expect(
      await checkDestructiveGuard(
        asOf(null),
        fd({ confirmWord: "DELETE", password: "hunter2" }),
        DOSES,
      ),
    ).toEqual({ ok: true });
    expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "wipe_dose_history");
  });

  it("reads the clock when none is given", async () => {
    seedPasswordless();
    const { now: _now, ...noClock } = DOSES;
    const justNow = asOf(new Date(Date.now() - 1000));
    expect(await checkDestructiveGuard(justNow, fd({ confirmWord: "DELETE" }), noClock)).toEqual({
      ok: true,
    });
  });
});

describe("signedInRecently", () => {
  it("is false with no sign-in, and false from exactly one window on", () => {
    expect(signedInRecently(null, NOW)).toBe(false);
    expect(signedInRecently(ago(RECENT_SIGN_IN_WINDOW_MS), NOW)).toBe(false);
    expect(signedInRecently(ago(RECENT_SIGN_IN_WINDOW_MS + 60_000), NOW)).toBe(false);
  });

  it("is true inside the window, and for a stamp slightly in the future (clock drift)", () => {
    expect(signedInRecently(ago(RECENT_SIGN_IN_WINDOW_MS - 1), NOW)).toBe(true);
    expect(signedInRecently(ago(0), NOW)).toBe(true);
    expect(signedInRecently(ago(-5_000), NOW)).toBe(true);
  });

  it("is a ten-minute window", () => {
    expect(RECENT_SIGN_IN_WINDOW_MS).toBe(10 * 60 * 1000);
    expect(RECENT_SIGN_IN_MESSAGE).toBe("Sign in again to confirm.");
  });
});

describe("destructiveConfirmation: what the dialog says the guard will ask", () => {
  const linked = (...providers: string[]) =>
    fakeDb.seed(
      oauthAccounts,
      providers.map((provider) => ({ provider })),
    );

  it("describes a password account as a password confirmation, and reads no links", async () => {
    seedPassword();
    expect(await destructiveConfirmation(asOfNull(), NOW)).toEqual({ kind: "password" });
    expect(fakeDb.attempted.some((c) => c.table === "oauth_accounts")).toBe(false);
  });

  it("offers the linked providers that can sign in on the web and are configured, Google first", async () => {
    seedPasswordless();
    linked("github", "apple", "google");
    expect(await destructiveConfirmation(RECENT, NOW)).toEqual({
      kind: "recentSignIn",
      recent: true,
      providers: ["google", "github"],
    });
  });

  it("drops a linked provider whose sign-in is not configured", async () => {
    seedPasswordless();
    linked("google");
    configuredWebProviders.mockReturnValue(["github"]);
    expect(await destructiveConfirmation(RECENT, NOW)).toMatchObject({ providers: [] });
  });

  it("reads the links of the user it was given", async () => {
    seedPasswordless();
    linked("google");
    await destructiveConfirmation({ userId: "u-42", authenticatedAt: null }, NOW);
    const read = fakeDb.attempted.find((c) => c.op === "select" && c.table === "oauth_accounts");
    expect(predicateIncludes(read?.predicate, "u-42")).toBe(true);
  });

  it("reports recent by the same rule as the guard", async () => {
    seedPasswordless();
    linked("google");
    expect(await destructiveConfirmation(RECENT, NOW)).toMatchObject({ recent: true });
    const stale = { userId: "u1", authenticatedAt: ago(RECENT_SIGN_IN_WINDOW_MS) };
    expect(await destructiveConfirmation(stale, NOW)).toMatchObject({ recent: false });
    expect(await destructiveConfirmation(asOfNull(), NOW)).toMatchObject({ recent: false });
  });
});

function asOfNull() {
  return { userId: "u1", authenticatedAt: null };
}

describe("accountHasPassword", () => {
  it("is true for a hash, false for null and for no row", async () => {
    seedPassword();
    expect(await accountHasPassword("u1")).toBe(true);
    seedPasswordless();
    expect(await accountHasPassword("u1")).toBe(false);
    seedNoRow();
    expect(await accountHasPassword("u1")).toBe(false);
  });

  it("asks about the user it was given", async () => {
    seedPassword();
    await accountHasPassword("u-42");
    const read = fakeDb.attempted.find((c) => c.op === "select" && c.table === "users");
    expect(predicateIncludes(read?.predicate, "u-42")).toBe(true);
  });
});
