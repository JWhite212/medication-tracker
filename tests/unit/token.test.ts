import { describe, it, expect } from "vitest";
import { hashToken } from "../../src/lib/server/auth/token";

describe("auth/token.hashToken", () => {
  it("matches the known SHA-256 hex digest of 'hello'", async () => {
    expect(await hashToken("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("matches the known SHA-256 hex digest of the empty string", async () => {
    expect(await hashToken("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic across calls", async () => {
    const a = await hashToken("password-reset-token-fixture");
    const b = await hashToken("password-reset-token-fixture");
    expect(a).toBe(b);
    expect(a).toBe("556c56d5befe6da06cb91701982a31d7b19c72180445b32b3722365583b81dd3");
  });

  it("produces different digests for different inputs", async () => {
    expect(await hashToken("a")).not.toBe(await hashToken("b"));
  });

  it("returns 64 lowercase hex characters", async () => {
    const out = await hashToken("anything");
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });
});
