import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";

vi.mock("$env/dynamic/private", () => ({
  env: {
    ENCRYPTION_KEY: "test-key-totp",
  },
}));

// Everything left in this file is pure crypto and encoding — no database is
// reached. unusedDb THROWS on any property access, so if that ever stops
// being true the failure is loud and named rather than a silent [].
//
// This file used to carry a bespoke fake whose update SIMULATED the
// production WHERE clause, because the shared seam captures predicates
// without evaluating them. That simulation is gone: the database-backed
// tests for verifyAndConsumeTOTPCode now live in tests/unit/pg/auth-totp.test.ts,
// where the real compare-and-set runs against Postgres instead of a
// hand-written imitation of it.
vi.mock("$lib/server/db", async () => (await import("./helpers/fake-db")).unusedDb);

const { generateTOTPSecret, encryptTOTPSecret, verifyTOTPCode, getTOTPUri, generateQRDataUrl } =
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

describe("getTOTPUri", () => {
  it("emits an otpauth URI containing issuer, label, and the secret", () => {
    const secret = generateTOTPSecret();
    const uri = getTOTPUri(secret, "user@example.com");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    // Issuer and label are URL-encoded inside the path/query.
    expect(uri).toContain("MedTracker");
    expect(uri).toContain("user%40example.com");
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain("period=30");
    expect(uri).toContain("digits=6");
  });
});

describe("generateQRDataUrl", () => {
  it("produces a base64 PNG data URL for the given otpauth URI", async () => {
    const secret = generateTOTPSecret();
    const uri = getTOTPUri(secret, "user@example.com");
    const dataUrl = await generateQRDataUrl(uri);
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    // Round-trip the base64 payload to confirm it decodes to a non-trivial blob.
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(b64, "base64");
    expect(buf.length).toBeGreaterThan(50);
  });
});
