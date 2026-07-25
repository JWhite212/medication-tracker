import { describe, it, expect, vi } from "vitest";

const validateSession = vi.fn();
vi.mock("$lib/server/auth/lucia", () => ({ lucia: { validateSession } }));

const { resolveApiUser, requireApiUser } = await import("../../../src/lib/server/api/auth");

const reqWith = (auth?: string) =>
  new Request("http://x/api/v1/sync", { headers: auth ? { authorization: auth } : {} });

describe("resolveApiUser", () => {
  it("returns null with no header", async () => {
    expect(await resolveApiUser(reqWith())).toBeNull();
  });
  it("returns null for a non-bearer scheme", async () => {
    expect(await resolveApiUser(reqWith("Basic abc"))).toBeNull();
  });
  it("returns null when lucia rejects", async () => {
    validateSession.mockResolvedValueOnce({ session: null, user: null });
    expect(await resolveApiUser(reqWith("Bearer bad"))).toBeNull();
  });
  it("returns user + sessionId on success", async () => {
    validateSession.mockResolvedValueOnce({
      session: { id: "s1" },
      user: { id: "u1", email: "a@b.c" },
    });
    const r = await resolveApiUser(reqWith("Bearer s1"));
    expect(r).toEqual({ user: { id: "u1", email: "a@b.c" }, sessionId: "s1" });
  });
});

describe("requireApiUser", () => {
  it("throws 401 when unauthorized", async () => {
    validateSession.mockResolvedValueOnce({ session: null, user: null });
    await expect(requireApiUser(reqWith("Bearer bad"))).rejects.toMatchObject({ status: 401 });
  });
  it("returns the resolved user when authorized", async () => {
    validateSession.mockResolvedValueOnce({
      session: { id: "s1" },
      user: { id: "u1", email: "a@b.c" },
    });
    const r = await requireApiUser(reqWith("Bearer s1"));
    expect(r).toEqual({ user: { id: "u1", email: "a@b.c" }, sessionId: "s1" });
  });
});
