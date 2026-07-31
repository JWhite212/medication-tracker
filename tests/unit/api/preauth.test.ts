import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-encryption-key-123" } }));
const { signPreAuthToken, verifyPreAuthToken } =
  await import("../../../src/lib/server/api/preauth");

describe("preauth token", () => {
  it("round-trips a userId", () => {
    const t = signPreAuthToken("user-42");
    expect(verifyPreAuthToken(t)).toMatchObject({ userId: "user-42" });
  });
  it("embeds a unique single-use id (jti) per token", () => {
    const a = verifyPreAuthToken(signPreAuthToken("user-42"));
    const b = verifyPreAuthToken(signPreAuthToken("user-42"));
    expect(a?.jti).toEqual(expect.any(String));
    expect(a!.jti.length).toBeGreaterThanOrEqual(16);
    expect(b!.jti).not.toBe(a!.jti);
  });
  it("exposes the expiry so callers can bound the consumption window", () => {
    const before = Date.now();
    const claims = verifyPreAuthToken(signPreAuthToken("user-42"));
    expect(claims!.exp).toBeGreaterThan(before);
  });
  it("rejects a tampered token", () => {
    const t = signPreAuthToken("user-42");
    expect(verifyPreAuthToken(t.slice(0, -2) + "xy")).toBeNull();
  });
  it("rejects an expired token", () => {
    const t = signPreAuthToken("user-42", -1000); // already expired
    expect(verifyPreAuthToken(t)).toBeNull();
  });
  it("rejects garbage", () => {
    expect(verifyPreAuthToken("not-a-token")).toBeNull();
  });
  it("rejects a legacy-format token without a jti", () => {
    // Hand-build the pre-jti token shape, signed with the same key —
    // tokens minted before the single-use upgrade must not verify.
    const payload = Buffer.from(
      JSON.stringify({ userId: "user-42", exp: Date.now() + 60_000 }),
    ).toString("base64url");
    const mac = createHmac("sha256", "test-encryption-key-123").update(payload).digest("base64url");
    expect(verifyPreAuthToken(`${payload}.${mac}`)).toBeNull();
  });
});
