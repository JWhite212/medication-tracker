import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";

vi.mock("$env/dynamic/private", () => ({
  env: {
    ENCRYPTION_KEY: "test-key-totp",
  },
}));

// totp.ts imports $lib/server/db for the replay-protection
// compare-and-set. Stub it out — each test installs its own behavior
// by mutating dbState below.
const dbState: {
  selectResult: Array<{ totpSecret: string | null }>;
  updateResult: Array<{ id: string }>;
  lastUpdateSet: { totpLastCounter?: number } | null;
} = {
  selectResult: [],
  updateResult: [],
  lastUpdateSet: null,
};

vi.mock("$lib/server/db", () => {
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: async () => dbState.selectResult,
      }),
    }),
  });
  const update = () => ({
    set: (vals: { totpLastCounter?: number }) => {
      dbState.lastUpdateSet = vals;
      return {
        where: () => ({
          returning: async () => dbState.updateResult,
        }),
      };
    },
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
    dbState.selectResult = [];
    dbState.updateResult = [];
    dbState.lastUpdateSet = null;
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
    dbState.selectResult = [];
    dbState.updateResult = [];
    dbState.lastUpdateSet = null;
  });

  it("returns false when the user has no totp secret", async () => {
    dbState.selectResult = [];
    expect(await verifyAndConsumeTOTPCode("user-1", "123456")).toBe(false);
  });

  it("accepts a valid code and stamps the current step", async () => {
    const secret = generateTOTPSecret();
    dbState.selectResult = [{ totpSecret: encryptTOTPSecret(secret) }];
    dbState.updateResult = [{ id: "user-1" }];
    const code = currentCode(secret);

    expect(await verifyAndConsumeTOTPCode("user-1", code)).toBe(true);
    expect(dbState.lastUpdateSet?.totpLastCounter).toBe(currentTOTPStep());
  });

  it("rejects when the conditional update finds the same step already consumed", async () => {
    const secret = generateTOTPSecret();
    dbState.selectResult = [{ totpSecret: encryptTOTPSecret(secret) }];
    // Simulate the WHERE clause filtering the UPDATE out (counter
    // already advanced) — concurrent attempt or replay of the same code.
    dbState.updateResult = [];
    const code = currentCode(secret);

    expect(await verifyAndConsumeTOTPCode("user-1", code)).toBe(false);
  });

  it("rejects an invalid code without touching the counter", async () => {
    const secret = generateTOTPSecret();
    dbState.selectResult = [{ totpSecret: encryptTOTPSecret(secret) }];
    const invalid = nextInvalidCode(currentCode(secret));

    expect(await verifyAndConsumeTOTPCode("user-1", invalid)).toBe(false);
    expect(dbState.lastUpdateSet).toBeNull();
  });
});
