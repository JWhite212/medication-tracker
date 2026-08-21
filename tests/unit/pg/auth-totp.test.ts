// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { generateTOTP } from "@oslojs/otp";
import { decodeBase32 } from "@oslojs/encoding";
import { eq } from "drizzle-orm";
import { users } from "../../../src/lib/server/db/schema";

vi.mock("$env/dynamic/private", () => ({
  env: { ENCRYPTION_KEY: "test-key-totp" },
}));

// The replay guard is a conditional UPDATE:
//   WHERE id = $1 AND (totp_last_counter IS NULL OR totp_last_counter < $2)
// Stage 1's seam captures predicates without evaluating them, which is why
// the sibling file had to simulate this clause by hand. Here it really runs.
vi.mock("$lib/server/db", async () => (await import("../helpers/pg-db")).dbMock);

import { pgDb } from "../helpers/pg-db";

const { generateTOTPSecret, encryptTOTPSecret, verifyAndConsumeTOTPCode, currentTOTPStep } =
  await import("../../../src/lib/server/auth/totp");

function currentCode(secret: string): string {
  return generateTOTP(decodeBase32(secret), 30, 6);
}

beforeAll(() => {
  // Fake ONLY Date. Faking timers wholesale stalls PGlite's WASM layer,
  // which uses real setTimeout internally.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-04-15T12:00:00Z"));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await pgDb.reset();
});

async function seedUserWithSecret(secret: string, totpLastCounter: number | null = null) {
  await pgDb.seedUser({ totpSecret: encryptTOTPSecret(secret), totpLastCounter });
}

async function storedCounter(): Promise<number | null> {
  const [row] = await pgDb.db.select().from(users).where(eq(users.id, "u1"));
  return row.totpLastCounter;
}

describe("verifyAndConsumeTOTPCode against real Postgres", () => {
  it("accepts a valid code and stamps the step", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);

    expect(await verifyAndConsumeTOTPCode("u1", currentCode(secret))).toBe(true);
    expect(await storedCounter()).toBe(currentTOTPStep());
  });

  it("rejects a replay of the same code, via the real WHERE clause", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);
    const code = currentCode(secret);

    expect(await verifyAndConsumeTOTPCode("u1", code)).toBe(true);
    // The second attempt fails the `totp_last_counter < step` predicate in
    // Postgres itself. No simulation involved.
    expect(await verifyAndConsumeTOTPCode("u1", code)).toBe(false);
  });

  it("rejects a code whose step is older than the stored counter", async () => {
    const secret = generateTOTPSecret();
    // Counter already ahead of the current step.
    await seedUserWithSecret(secret, currentTOTPStep() + 5);

    expect(await verifyAndConsumeTOTPCode("u1", currentCode(secret))).toBe(false);
    expect(await storedCounter()).toBe(currentTOTPStep() + 5);
  });

  it("returns false when the user has no totp secret", async () => {
    await pgDb.seedUser();
    expect(await verifyAndConsumeTOTPCode("u1", "123456")).toBe(false);
  });

  it("lets only one of two concurrent consumes of the same step win", async () => {
    const secret = generateTOTPSecret();
    await seedUserWithSecret(secret);
    const code = currentCode(secret);

    const results = await Promise.all([
      verifyAndConsumeTOTPCode("u1", code),
      verifyAndConsumeTOTPCode("u1", code),
    ]);

    // The compare-and-set is what makes this deterministic. A read-then-write
    // would let both through.
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
