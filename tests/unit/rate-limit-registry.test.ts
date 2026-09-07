import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, type LimitPolicy } from "$lib/server/auth/rate-limit-policy";

/**
 * The registry is only worth having if nothing can route around it and no two
 * policies can collide. Both are structural facts, so both are scans.
 *
 * The state this replaces: twenty-five call sites each hand-writing a key
 * namespace, a maximum and a window. Nothing could enumerate the doors, and
 * so nothing noticed that the browser login door was throttled by address
 * alone while `/api/v1/auth/login` was throttled by address AND email.
 */

const policies = Object.entries(LIMITS) as Array<[string, LimitPolicy]>;

describe("the policy table", () => {
  it("has a disjoint namespace per policy", () => {
    // A collision is silent and worse than a duplicate: two doors would share
    // one budget, so traffic to a sync endpoint could lock someone out of
    // login. Same rule, same reason, as the push tag registry's namespaces.
    const namespaces = policies.map(([, policy]) => policy.namespace);
    expect(new Set(namespaces).size).toBe(namespaces.length);
  });

  it("has no namespace that prefixes another", () => {
    // Keys are `${namespace}:${identity}`, so `login` and `login-ip` are
    // distinct — but a test elsewhere matching on `key.startsWith("login:")`
    // is only unambiguous while no namespace is a prefix of another.
    for (const [nameA, a] of policies) {
      for (const [nameB, b] of policies) {
        if (nameA === nameB) continue;
        expect(
          { pair: `${nameA}/${nameB}`, prefixes: a.namespace.startsWith(`${b.namespace}:`) },
          `${a.namespace} must not extend ${b.namespace}`,
        ).toEqual({ pair: `${nameA}/${nameB}`, prefixes: false });
      }
    }
  });

  it.each(policies)("%s declares a usable budget", (_name, policy) => {
    expect(policy.max).toBeGreaterThan(0);
    expect(Number.isInteger(policy.max)).toBe(true);
    expect(policy.windowMs).toBeGreaterThan(0);
    expect(policy.namespace).toMatch(/^[a-z0-9-]+$/);
    expect(["ip", "account", "token"]).toContain(policy.identity);
  });
});

describe("the credential doors specifically", () => {
  it("the two login doors spend the SAME policies", () => {
    // The defect the registry exists for. These were four hand-written
    // budgets across two doors; the browser one had no account-scoped limit
    // at all, so rotating addresses bought unlimited guesses at a known
    // email. Both doors now name these two, so they cannot drift again.
    const doors = [
      "src/routes/auth/login/+page.server.ts",
      "src/routes/api/v1/auth/login/+server.ts",
    ];

    for (const door of doors) {
      const source = readFileSync(door, "utf8");
      expect({ door, ip: source.includes("LIMITS.loginIp") }).toEqual({ door, ip: true });
      expect({ door, account: source.includes("LIMITS.loginAccount") }).toEqual({
        door,
        account: true,
      });
    }
  });

  it("the account budget is PEEKED before the check and spent only on failure", () => {
    // Counting every attempt bounds the attacker and also hands anyone who
    // knows an email a refreshable 15-minute lockout of the real owner.
    for (const door of [
      "src/routes/auth/login/+page.server.ts",
      "src/routes/api/v1/auth/login/+server.ts",
    ]) {
      const source = readFileSync(door, "utf8");
      expect({ door, peeked: source.includes("peekLimit(LIMITS.loginAccount") }).toEqual({
        door,
        peeked: true,
      });
      expect({ door, spent: source.includes("enforceLimit(LIMITS.loginAccount") }).toEqual({
        door,
        spent: false,
      });
      // Both failure arms: a wrong password AND an unknown email, or the 429
      // itself answers "does this address exist?".
      expect({
        door,
        failures: (source.match(/recordFailure\(LIMITS\.loginAccount/g) ?? []).length,
      }).toEqual({ door, failures: 2 });
    }
  });

  it("both 2FA doors share one namespace, deliberately", () => {
    // They consume the same signed pre-auth claim, so a per-door budget would
    // let an attacker spend the allowance twice by switching transport.
    for (const door of [
      "src/routes/auth/2fa/+page.server.ts",
      "src/routes/api/v1/auth/2fa/+server.ts",
    ]) {
      expect(readFileSync(door, "utf8")).toContain("LIMITS.twoFactor");
    }
  });
});

describe("no door routes around the registry", () => {
  /**
   * `checkRateLimit` remains exported as the primitive, and the PGlite suite
   * drives it directly — but no ROUTE or service may call it, because a raw
   * key is a door nothing can enumerate.
   */
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|svelte)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it("finds no raw checkRateLimit call outside the module itself", () => {
    const offenders = walk("src")
      .filter((file) => !file.includes(join("auth", "rate-limit")))
      .filter((file) => /\bcheckRateLimit\s*\(/.test(readFileSync(file, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("every policy in the table is actually named by some door", () => {
    // An unused policy is either a door that lost its limiter or a rule
    // nobody enforces. Either way the table should not claim it.
    const sources = walk("src")
      .filter((file) => !file.includes(join("auth", "rate-limit")))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    const unused = policies
      .map(([name]) => name)
      .filter((name) => !sources.includes(`LIMITS.${name}`));

    expect(unused).toEqual([]);
  });
});
