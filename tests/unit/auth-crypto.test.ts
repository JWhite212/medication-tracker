import { describe, it, expect, vi } from "vitest";

vi.mock("$env/dynamic/private", () => ({
  env: {
    ENCRYPTION_KEY: "test-key-fixed-for-determinism",
  },
}));

const { encryptSecret, decryptSecret, isEncrypted } =
  await import("../../src/lib/server/auth/crypto");

describe("crypto.encryptSecret / decryptSecret", () => {
  it("round-trips a plaintext value", () => {
    const plaintext = "JBSWY3DPEHPK3PXP";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
  });

  it("uses the v1: prefix", () => {
    expect(encryptSecret("x").startsWith("v1:")).toBe(true);
  });

  it("returns legacy plaintext unchanged when decrypted", () => {
    const legacy = "JBSWY3DPEHPK3PXP";
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it("isEncrypted returns true only for v1: payloads", () => {
    expect(isEncrypted("plaintext")).toBe(false);
    expect(isEncrypted("v1:")).toBe(true);
    expect(isEncrypted(encryptSecret("x"))).toBe(true);
  });

  it("rejects malformed v1 payloads", () => {
    expect(() => decryptSecret("v1:bad")).toThrow(/Malformed/);
  });
});
