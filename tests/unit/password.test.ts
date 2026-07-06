import { describe, it, expect } from "vitest";
import {
  hashPassword,
  verifyPassword,
  needsRehash,
  ARGON2_PARAMS,
} from "$lib/server/auth/password";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("mysecurepassword");
    expect(hash).not.toBe("mysecurepassword");
    expect(hash.length).toBeGreaterThan(0);

    const valid = await verifyPassword(hash, "mysecurepassword");
    expect(valid).toBe(true);
  });

  it("rejects wrong password", async () => {
    const hash = await hashPassword("correctpassword");
    const valid = await verifyPassword(hash, "wrongpassword");
    expect(valid).toBe(false);
  });

  it("produces different hashes for same password", async () => {
    const hash1 = await hashPassword("samepassword");
    const hash2 = await hashPassword("samepassword");
    expect(hash1).not.toBe(hash2);
  });
});

describe("needsRehash", () => {
  it("embeds the current parameters in fresh hashes", async () => {
    const hash = await hashPassword("password");
    expect(hash).toContain(
      `$m=${ARGON2_PARAMS.memoryCost},t=${ARGON2_PARAMS.timeCost},p=${ARGON2_PARAMS.parallelism}$`,
    );
  });

  it("returns false for a hash created with current parameters", async () => {
    const hash = await hashPassword("password");
    expect(needsRehash(hash)).toBe(false);
  });

  it("returns true when memory cost differs from current parameters", async () => {
    const hash = await hashPassword("password");
    const outdated = hash.replace(`m=${ARGON2_PARAMS.memoryCost}`, "m=4096");
    expect(needsRehash(outdated)).toBe(true);
  });

  it("returns true when time cost differs from current parameters", async () => {
    const hash = await hashPassword("password");
    const outdated = hash.replace(`t=${ARGON2_PARAMS.timeCost},`, "t=1,");
    expect(needsRehash(outdated)).toBe(true);
  });

  it("returns true for unrecognised hash formats", () => {
    expect(needsRehash("$2b$10$legacybcrypthashvalue")).toBe(true);
    expect(needsRehash("plaintext-or-garbage")).toBe(true);
    expect(needsRehash("")).toBe(true);
  });
});
