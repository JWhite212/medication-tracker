import { describe, it, expect, vi, beforeEach } from "vitest";
import { fakeDb } from "./helpers/fake-db";
import { users } from "$lib/server/db/schema";

// setupTwoFactor must refuse while 2FA is already on. Otherwise it overwrites
// the live TOTP secret (twoFactorEnabled stays true) without any code from the
// current factor — a code-free path around disableTwoFactor, and a lockout
// when a stale tab's Set Up is clicked and the QR abandoned.

vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).dbMock);
vi.mock("$lib/server/auth/lucia", () => ({ lucia: {} }));
vi.mock("$lib/server/auth/password", () => ({
  hashPassword: async () => "hashed",
  verifyPassword: async () => true,
}));
vi.mock("$lib/server/auth/reauth", () => ({
  confirmReauth: async () => ({ ok: true }),
  reauthMessage: () => "Incorrect password",
}));
vi.mock("$lib/server/auth/totp", () => ({
  generateTOTPSecret: () => "NEWSECRET",
  getTOTPUri: () => "uri",
  generateQRDataUrl: async () => "data:",
  verifyAndConsumeTOTPCode: async () => true,
  encryptTOTPSecret: (s: string) => `enc:${s}`,
}));
vi.mock("$lib/server/audit", () => ({ logAudit: async () => {} }));

const { actions } = await import("../../src/routes/(app)/settings/security/+page.server");

function formRequest(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request("http://x", { method: "POST", body: fd });
}

beforeEach(() => fakeDb.reset());

describe("setupTwoFactor while 2FA is enabled", () => {
  it("refuses and leaves the live TOTP secret untouched", async () => {
    // OAuth-only account (no password) with 2FA already on.
    fakeDb.seed(users, [
      { id: "u1", passwordHash: null, twoFactorEnabled: true, totpSecret: "enc:LIVE" },
    ]);
    const locals = {
      user: { id: "u1", email: "a@example.com", timezone: "UTC", twoFactorEnabled: true },
      session: { id: "s1" },
    };

    const res = await actions.setupTwoFactor({
      request: formRequest({ currentPassword: "" }),
      locals,
    } as never);

    expect(res).toMatchObject({ status: 400 });
    const secretWrites = fakeDb.attempted.filter(
      (c) =>
        c.op === "update" &&
        c.table === "users" &&
        c.payload !== undefined &&
        "totpSecret" in (c.payload as Record<string, unknown>),
    );
    expect(secretWrites).toEqual([]);
  });

  it("still issues a secret for an account without 2FA", async () => {
    fakeDb.seed(users, [
      { id: "u1", passwordHash: null, twoFactorEnabled: false, totpSecret: null },
    ]);
    const locals = {
      user: { id: "u1", email: "a@example.com", timezone: "UTC", twoFactorEnabled: false },
      session: { id: "s1" },
    };

    const res = await actions.setupTwoFactor({
      request: formRequest({ currentPassword: "" }),
      locals,
    } as never);

    expect(res).toMatchObject({ totpSetup: { secret: "NEWSECRET" } });
  });
});
