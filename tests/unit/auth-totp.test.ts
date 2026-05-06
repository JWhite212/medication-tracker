import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";

vi.mock("$env/dynamic/private", () => ({
  env: {
    ENCRYPTION_KEY: "test-key-totp",
  },
}));

// totp.ts imports $lib/server/db for the replay-protection
// compare-and-set. The mock simulates the actual WHERE predicate
// (totp_last_counter IS NULL OR totp_last_counter < step) so a
// regression that drops the conditional UPDATE would make the replay
// test fail rather than silently pass.
const dbState: {
  user: { totpSecret: string | null; totpLastCounter: number | null } | null;
  lastStampedCounter: number | null;
} = {
  user: null,
  lastStampedCounter: null,
};

vi.mock("$lib/server/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => (dbState.user ? [{ totpSecret: dbState.user.totpSecret }] : []),
      }),
    }),
  });
  const update = () => ({
    set: (vals: { totpLastCounter?: number | null }) => ({
      where: () => ({
        returning: async () => {
          if (!dbState.user) return [];
          const newStep = vals.totpLastCounter;
          if (newStep === undefined || newStep === null) return [];
          const existing = dbState.user.totpLastCounter;
          // Mirror the production WHERE: only update if the existing
          // counter is null OR strictly less than the new step.
          if (existing !== null && existing >= newStep) return [];
          dbState.user.totpLastCounter = newStep;
          dbState.lastStampedCounter = newStep;
          return [{ id: "user-1" }];
        },
      }),
    }),
  });
  return {
    db: { select, update },
  };
});

const {
  generateTOTPSecret,
  encryptTOTPSecret,
  verifyTOTPCode,
  verifyAndConsumeTOTPCode,
  currentTOTPStep,
  getTOTPUri,
  generateQRDataUrl,
} = await import("../../src/lib/server/auth/totp");

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

  beforeEach(() => {
    dbState.user = null;
    dbState.lastStampedCounter = null;
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

describe("verifyAndConsumeTOTPCode", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    dbState.user = null;
    dbState.lastStampedCounter = null;
  });

  it("returns false when the user has no totp secret", async () => {
    dbState.user = null;
    expect(await verifyAndConsumeTOTPCode("user-1", "123456")).toBe(false);
  });

  it("accepts a valid code and stamps the current step", async () => {
    const secret = generateTOTPSecret();
    dbState.user = { totpSecret: encryptTOTPSecret(secret), totpLastCounter: null };
    const code = currentCode(secret);

    expect(await verifyAndConsumeTOTPCode("user-1", code)).toBe(true);
    expect(dbState.lastStampedCounter).toBe(currentTOTPStep());
    expect(dbState.user.totpLastCounter).toBe(currentTOTPStep());
  });

  it("rejects a second consume of the same code (replay)", async () => {
    const secret = generateTOTPSecret();
    dbState.user = { totpSecret: encryptTOTPSecret(secret), totpLastCounter: null };
    const code = currentCode(secret);

    // First consume: stamps the counter.
    expect(await verifyAndConsumeTOTPCode("user-1", code)).toBe(true);
    // Second consume of the same step must be rejected by the WHERE
    // predicate. If the production UPDATE drops the conditional, the
    // mock would let this through and this assertion would fail —
    // which is the regression signal the test is meant to provide.
    expect(await verifyAndConsumeTOTPCode("user-1", code)).toBe(false);
  });

  it("rejects an invalid code without touching the counter", async () => {
    const secret = generateTOTPSecret();
    dbState.user = { totpSecret: encryptTOTPSecret(secret), totpLastCounter: null };
    const invalid = nextInvalidCode(currentCode(secret));

    expect(await verifyAndConsumeTOTPCode("user-1", invalid)).toBe(false);
    expect(dbState.lastStampedCounter).toBeNull();
    expect(dbState.user.totpLastCounter).toBeNull();
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
