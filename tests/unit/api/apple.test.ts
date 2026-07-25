import { describe, it, expect, vi } from "vitest";
vi.mock("$env/dynamic/private", () => ({ env: { APPLE_CLIENT_ID: "com.jamiewhite.medtracker" } }));
const jwtVerify = vi.fn();
vi.mock("jose", () => ({ createRemoteJWKSet: () => ({}), jwtVerify }));
const { verifyAppleIdentityToken } = await import("../../../src/lib/server/api/apple");

describe("verifyAppleIdentityToken", () => {
  it("maps sub/email/email_verified", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: "000123.abc", email: "a@b.c", email_verified: "true" },
    });
    expect(await verifyAppleIdentityToken("tok")).toEqual({
      appleUserId: "000123.abc",
      email: "a@b.c",
      emailVerified: true,
    });
  });
  it("handles boolean email_verified and missing email", async () => {
    jwtVerify.mockResolvedValueOnce({ payload: { sub: "000123.abc", email_verified: true } });
    expect(await verifyAppleIdentityToken("tok")).toEqual({
      appleUserId: "000123.abc",
      email: null,
      emailVerified: true,
    });
  });
  it("throws when jose rejects", async () => {
    jwtVerify.mockRejectedValueOnce(new Error("bad signature"));
    await expect(verifyAppleIdentityToken("tok")).rejects.toThrow();
  });
});
