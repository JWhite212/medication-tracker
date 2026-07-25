import { describe, it, expect, vi } from "vitest";
vi.mock("$env/dynamic/private", () => ({ env: { ENCRYPTION_KEY: "test-encryption-key-123" } }));
const { signPreAuthToken, verifyPreAuthToken } =
  await import("../../../src/lib/server/api/preauth");

describe("preauth token", () => {
  it("round-trips a userId", () => {
    const t = signPreAuthToken("user-42");
    expect(verifyPreAuthToken(t)).toBe("user-42");
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
});
