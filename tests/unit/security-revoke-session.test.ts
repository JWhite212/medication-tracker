import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { sessions } from "$lib/server/db/schema";

// revokeSession must only report success when a session row was
// actually invalidated. A missing/own/stale sessionId previously fell
// through every guard and still returned { sessionRevoked: true }.
const state = {};

const invalidateSession = vi.fn(async (_id: string) => {});
vi.mock("$lib/server/auth/lucia", () => ({
  lucia: { invalidateSession: (id: string) => invalidateSession(id) },
}));

// The database comes from the shared seam, which dispatches on real table
// identity — so this file mocks no schema and binds to the real sessions table.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/auth/password", () => ({
  hashPassword: async () => "hashed",
  verifyPassword: async () => true,
}));
vi.mock("$lib/server/auth/reauth", () => ({ confirmReauth: async () => true }));
vi.mock("$lib/server/auth/totp", () => ({
  generateTOTPSecret: () => "secret",
  getTOTPUri: () => "uri",
  generateQRDataUrl: async () => "data:",
  verifyAndConsumeTOTPCode: async () => true,
  encryptTOTPSecret: () => "enc",
}));
vi.mock("$lib/server/audit", () => ({ logAudit: async () => {} }));

const { actions } = await import("../../src/routes/(app)/settings/security/+page.server");

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

const locals = { user: { id: "u1", timezone: "UTC" }, session: { id: "my-session" } };

beforeEach(() => {
  fakeDb.reset();
  invalidateSession.mockClear();
});

describe("revokeSession action", () => {
  it("fails when the target session is stale or not owned, instead of claiming success", async () => {
    // Ownership lookup finds nothing (expired or another user's).
    fakeDb.seedQueue(sessions, [[]]);
    const res = await actions.revokeSession({
      request: formRequest({ sessionId: "stale-session" }),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 404 });
    expect(invalidateSession).not.toHaveBeenCalled();
  });

  it("fails when sessionId is missing", async () => {
    const res = await actions.revokeSession({
      request: formRequest({}),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 400 });
    expect(invalidateSession).not.toHaveBeenCalled();
  });

  it("fails when targeting the caller's own session", async () => {
    const res = await actions.revokeSession({
      request: formRequest({ sessionId: "my-session" }),
      locals,
    } as never);
    expect(res).toMatchObject({ status: 400 });
    expect(invalidateSession).not.toHaveBeenCalled();
  });

  it("revokes and reports success for a valid owned target", async () => {
    fakeDb.seedQueue(sessions, [[{ id: "other-session" }]]);
    const res = await actions.revokeSession({
      request: formRequest({ sessionId: "other-session" }),
      locals,
    } as never);
    expect(res).toEqual({ sessionRevoked: true });
    expect(invalidateSession).toHaveBeenCalledWith("other-session");
  });
});
