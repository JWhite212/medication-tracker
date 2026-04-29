import { describe, it, expect, vi } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";

vi.mock("$env/dynamic/private", () => ({
  env: {
    ENCRYPTION_KEY: "test-key-totp",
  },
}));

const { generateTOTPSecret, encryptTOTPSecret, verifyTOTPCode } =
  await import("../../src/lib/server/auth/totp");

function currentCode(secret: string): string {
  return generateTOTP(decodeBase32(secret), 30, 6);
}

describe("totp", () => {
  it("generateTOTPSecret returns a base32 string of 32 chars (160 bits)", () => {
    const secret = generateTOTPSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  });

  it("verifyTOTPCode accepts a code derived from the encrypted secret", () => {
    const secret = generateTOTPSecret();
    const stored = encryptTOTPSecret(secret);
    expect(stored.startsWith("v1:")).toBe(true);

    const code = currentCode(secret);
    expect(verifyTOTPCode(stored, code)).toBe(true);
  });

  it("verifyTOTPCode accepts a code with legacy plaintext stored secret", () => {
    const secret = generateTOTPSecret();
    const code = currentCode(secret);
    // Pre-encryption rows store the raw base32 secret.
    expect(verifyTOTPCode(secret, code)).toBe(true);
  });

  it("verifyTOTPCode rejects an invalid 6-digit code", () => {
    const secret = generateTOTPSecret();
    const stored = encryptTOTPSecret(secret);
    expect(verifyTOTPCode(stored, "000000")).toBe(false);
  });
});
