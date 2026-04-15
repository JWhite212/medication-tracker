import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "$lib/server/auth/password";

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
