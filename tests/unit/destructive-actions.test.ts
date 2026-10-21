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
import { rateLimitSurface } from "./helpers/rate-limit";

const h = vi.hoisted(() => ({
  confirmReauth: vi.fn(),
  wipeDoseHistory: vi.fn(async () => ({ deleted: 1204 })),
  wipeArchivedMedications: vi.fn(async () => ({ deleted: 2 })),
  invalidateSession: vi.fn(async () => {}),
  invalidateUserSessions: vi.fn(async () => {}),
  logAudit: vi.fn(async () => {}),
  /** What the import planner hands back: a replace that deletes 6 medications and 1,204 doses. */
  PLAN: {
    format: "json",
    mode: "replace",
    summary: { medicationsCreated: 1, dosesCreated: 2, medicationsDeleted: 6, dosesDeleted: 1204 },
    warnings: [],
    unmatchedNames: [],
    medications: [],
  } as never as { summary: unknown },
  buildPlanFromFile: vi.fn(),
  applyImport: vi.fn(),
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
vi.mock("$lib/server/auth/rate-limit", () =>
  rateLimitSurface({ primitive: async () => ({ allowed: true, retryAfterMs: 0 }) }),
);
vi.mock("$lib/server/import/pipeline", () => ({ buildPlanFromFile: h.buildPlanFromFile }));
vi.mock("$lib/server/import/plan", () => ({ planIsEmpty: () => false }));
vi.mock("$lib/server/import/apply", () => ({ applyImport: h.applyImport }));

import { fakeDb } from "./helpers/fake-db";
import { users } from "$lib/server/db/schema";

const privacy = await import("../../src/routes/(app)/settings/privacy/+page.server");
const data = await import("../../src/routes/(app)/settings/data/+page.server");
const dataImport = await import("../../src/routes/(app)/settings/data/import/+page.server");

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
  h.buildPlanFromFile.mockImplementation(async () => ({ ok: true, plan: h.PLAN }));
  h.applyImport.mockImplementation(async () => ({ summary: h.PLAN.summary, importId: "i1" }));
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

describe("data ?/deleteAccount", () => {
  /** Whether the action reached its one DELETE, the row every cascade hangs off. */
  const deletedUser = () => fakeDb.attempted.some((c) => c.op === "delete" && c.table === "users");

  it("refuses a direct POST without the word, for both kinds of account, deleting nothing", async () => {
    for (const seed of [seedPassword, seedPasswordless]) {
      fakeDb.reset();
      seed();
      expect(await call(data.actions, "deleteAccount", { password: "hunter2" })).toMatchObject({
        status: 400,
        data: { error: "Type DELETE to confirm." },
      });
      expect(deletedUser()).toBe(false);
      expect(h.invalidateUserSessions).not.toHaveBeenCalled();
      expect(h.logAudit).not.toHaveBeenCalled();
    }
    expect(confirmReauth).not.toHaveBeenCalled();
  });

  it("refuses a password account with the word but no password", async () => {
    seedPassword();
    expect(await call(data.actions, "deleteAccount", { confirmWord: "DELETE" })).toMatchObject({
      status: 400,
      data: { error: "Password is required to confirm this action." },
    });
    expect(confirmReauth).not.toHaveBeenCalled();
    expect(deletedUser()).toBe(false);
    expect(h.invalidateUserSessions).not.toHaveBeenCalled();
  });

  it("refuses a wrong password through the reauth message, deleting nothing", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: false });
    expect(
      await call(data.actions, "deleteAccount", { confirmWord: "DELETE", password: "wrong" }),
    ).toMatchObject({ status: 400, data: { error: "Incorrect password." } });
    expect(deletedUser()).toBe(false);
  });

  it("deletes a password account with the word and a confirmed password, and redirects home", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
    await expect(
      call(data.actions, "deleteAccount", { confirmWord: "DELETE", password: "hunter2" }),
    ).rejects.toMatchObject({ status: 302, location: "/" });
    expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "delete_account");
    expect(deletedUser()).toBe(true);
    expect(h.invalidateUserSessions).toHaveBeenCalledWith("u1");
  });

  it("now deletes an account with no password on the word alone", async () => {
    seedPasswordless();
    await expect(
      call(data.actions, "deleteAccount", { confirmWord: "DELETE" }),
    ).rejects.toMatchObject({ status: 302, location: "/" });
    expect(deletedUser()).toBe(true);
    expect(confirmReauth).not.toHaveBeenCalled();
  });
});

describe("import ?/commit", () => {
  const { PLAN, applyImport } = h;
  const commit = (fields: Record<string, string | File>) =>
    call(dataImport.actions, "commit", {
      file: new File(["{}"], "backup.json", { type: "application/json" }),
      ...fields,
    });

  it("refuses a replace posted without the word, for both kinds of account, writing nothing", async () => {
    for (const seed of [seedPassword, seedPasswordless]) {
      fakeDb.reset();
      seed();
      expect(await commit({ mode: "replace", password: "hunter2" })).toMatchObject({
        status: 400,
        data: { error: "Type REPLACE to confirm." },
      });
    }
    expect(applyImport).not.toHaveBeenCalled();
    expect(confirmReauth).not.toHaveBeenCalled();
  });

  it("refuses a password account's replace with the word but no password — it used to need only the password", async () => {
    seedPassword();
    expect(await commit({ mode: "replace", confirmWord: "REPLACE" })).toMatchObject({
      status: 400,
      data: { error: "Password is required to confirm this action." },
    });
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("refuses a wrong password through the reauth message, writing nothing", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: false });
    expect(
      await commit({ mode: "replace", confirmWord: "REPLACE", password: "wrong" }),
    ).toMatchObject({ status: 400, data: { error: "Incorrect password." } });
    expect(applyImport).not.toHaveBeenCalled();
  });

  it("replaces for a password account with REPLACE and a confirmed password", async () => {
    seedPassword();
    confirmReauth.mockResolvedValueOnce({ ok: true, token: "t" });
    expect(await commit({ mode: "replace", confirmWord: "REPLACE", password: "hunter2" })).toEqual({
      imported: PLAN.summary,
      importId: "i1",
    });
    expect(confirmReauth).toHaveBeenCalledWith("u1", "hunter2", "import_replace_data");
    expect(applyImport).toHaveBeenCalledTimes(1);
  });

  it("replaces for an account with no password on REPLACE, now posted as confirmWord", async () => {
    seedPasswordless();
    expect(await commit({ mode: "replace", confirmPhrase: "REPLACE" })).toMatchObject({
      status: 400,
      data: { error: "Type REPLACE to confirm." },
    }); // the old field no longer counts
    expect(applyImport).not.toHaveBeenCalled();
    expect(await commit({ mode: "replace", confirmWord: "REPLACE" })).toEqual({
      imported: PLAN.summary,
      importId: "i1",
    });
    expect(confirmReauth).not.toHaveBeenCalled();
  });

  it("asks nothing of a merge", async () => {
    seedPassword();
    expect(await commit({ mode: "merge" })).toEqual({ imported: PLAN.summary, importId: "i1" });
    expect(confirmReauth).not.toHaveBeenCalled();
    // Not even the account read: a merge deletes nothing.
    expect(fakeDb.attempted.some((c) => c.op === "select" && c.table === "users")).toBe(false);
  });

  it("reports every other failure under `error` too, so the dialog shows the server's words", async () => {
    expect(await commit({ mode: "merge", file: "" })).toMatchObject({
      status: 400,
      data: { error: "Choose a file to import." },
    });
    h.buildPlanFromFile.mockResolvedValueOnce({ ok: false, reason: "That file isn't JSON." });
    expect(await commit({ mode: "merge" })).toMatchObject({
      status: 400,
      data: { error: "That file isn't JSON." },
    });
  });
});
