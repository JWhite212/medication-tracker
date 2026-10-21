// @vitest-environment node
//
// The four browser deletions nothing can undo, posted directly: Privacy's
// two wipes, Data's account deletion and Import's replace mode. Each runs
// `checkDestructiveGuard` after its 401 check and before any write, so a POST
// that skips the dialog still has to carry the typed word, and the password
// where the account has one. An account with no password now runs all four
// on the word alone.
//
// `node`, not jsdom: the import cases post a real `File`, and jsdom's `File`
// and undici's `FormData` are different realms. fake-db, because nothing here
// is decided by the database (the guard's one read is a password_hash).
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  confirmReauth: vi.fn(),
  wipeDoseHistory: vi.fn(async () => ({ deleted: 1204 })),
  wipeArchivedMedications: vi.fn(async () => ({ deleted: 2 })),
  invalidateSession: vi.fn(async () => {}),
  invalidateUserSessions: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
}));

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/auth/reauth", () => ({
  confirmReauth: h.confirmReauth,
  reauthMessage: () => "Incorrect password.",
}));
vi.mock("$lib/server/api/wipe", () => ({
  wipeDoseHistory: h.wipeDoseHistory,
  wipeArchivedMedications: h.wipeArchivedMedications,
}));
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: {
    invalidateSession: h.invalidateSession,
    invalidateUserSessions: h.invalidateUserSessions,
    createBlankSessionCookie: () => ({ name: "auth_session", value: "", attributes: {} }),
  },
}));
vi.mock("$lib/server/audit", () => ({ logAudit: h.logAudit }));

import { fakeDb } from "./helpers/fake-db";
import { users } from "$lib/server/db/schema";

const privacy = await import("../../src/routes/(app)/settings/privacy/+page.server");

const { confirmReauth } = h;

type ActionMap = Record<string, (event: never) => unknown>;

function seedPassword() {
  fakeDb.seed(users, [{ passwordHash: "$argon2id$x" }]);
}
function seedPasswordless() {
  fakeDb.seed(users, [{ passwordHash: null }]);
}

/** Post `fields` to the named action as the signed-in user u1. */
async function call(actions: ActionMap, name: string, fields: Record<string, string | File>) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  return actions[name]({
    request: new Request("http://localhost/settings", { method: "POST", body }),
    locals: { user: { id: "u1", timezone: "UTC" }, session: { id: "s1" } },
    cookies: { set: vi.fn() },
  } as never);
}

beforeEach(() => {
  fakeDb.reset();
  vi.clearAllMocks();
  confirmReauth.mockReset();
});

describe.each([
  ["wipeDoseHistory", h.wipeDoseHistory, "wipe_dose_history", { wipeDosesOk: true, removed: 1204 }],
  [
    "wipeArchivedMedications",
    h.wipeArchivedMedications,
    "wipe_archived_medications",
    { wipeArchivedOk: true, removed: 2 },
  ],
] as const)("privacy ?/%s", (name, wipeFn, purpose, okResult) => {
  it("refuses a direct POST without the word, for a password account, deleting nothing", async () => {
    seedPassword();
    expect(await call(privacy.actions, name, { password: "hunter2" })).toMatchObject({
      status: 400,
      data: { error: "Type DELETE to confirm." },
    });
    expect(wipeFn).not.toHaveBeenCalled();
    expect(confirmReauth).not.toHaveBeenCalled();
  });

  it("refuses a direct POST without the word, for an account with no password", async () => {
    seedPasswordless();
    expect(await call(privacy.actions, name, {})).toMatchObject({
      status: 400,
      data: { error: "Type DELETE to confirm." },
    });
    expect(wipeFn).not.toHaveBeenCalled();
  });

  it("refuses a password account that typed the word but sent no password", async () => {
    seedPassword();
    expect(await call(privacy.actions, name, { confirmWord: "DELETE" })).toMatchObject({
      status: 400,
      data: { error: "Password is required to confirm this action." },
    });
    expect(wipeFn).not.toHaveBeenCalled();
  });

  it("refuses a wrong password through the reauth message, deleting nothing", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: false });
    expect(
      await call(privacy.actions, name, { confirmWord: "DELETE", password: "wrong" }),
    ).toMatchObject({ status: 400, data: { error: "Incorrect password." } });
    expect(wipeFn).not.toHaveBeenCalled();
  });

  it("runs for a password account with the word and a confirmed password", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
    expect(
      await call(privacy.actions, name, { confirmWord: "DELETE", password: "hunter2" }),
    ).toEqual(okResult);
    expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", purpose);
    expect(wipeFn).toHaveBeenCalledWith("u1");
  });

  it("now runs for an account with no password, on the word alone", async () => {
    seedPasswordless();
    expect(await call(privacy.actions, name, { confirmWord: "DELETE" })).toEqual(okResult);
    expect(confirmReauth).not.toHaveBeenCalled();
    expect(wipeFn).toHaveBeenCalledWith("u1");
  });
});
