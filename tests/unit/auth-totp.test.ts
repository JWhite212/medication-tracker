import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
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

function nextInvalidCode(validCode: string): string {
  // Increment by 1 mod 1_000_000 so it cannot collide with the valid one.
  const next = (Number(validCode) + 1) % 1_000_000;
  return next.toString().padStart(6, "0");
}

describe("totp", () => {
  // Pin the clock so currentCode() and verifyTOTPCode() always sit in
  // the same TOTP window. Without this the test can flake when the
  // 30-second boundary rolls between the two calls.
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

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
    const code = currentCode(secret);
    // Derive an invalid code from the valid one so it cannot
    // accidentally collide with the live TOTP value.
    const invalidCode = nextInvalidCode(code);
    expect(verifyTOTPCode(stored, invalidCode)).toBe(false);
  });
});
