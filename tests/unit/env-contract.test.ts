// @vitest-environment node
//
// `node` because one case spawns the real build script, and because
// `import.meta.url` must be a file: URL to locate it — under jsdom it is not.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  REQUIRED_PRIVATE_ENV,
  STRICT_VERCEL_ENVS,
  missingRequiredEnv,
  publicBaseUrlProblem,
  buildEnvProblems,
} from "../../src/lib/server/env-contract.js";

/**
 * The boot contract, and the build-time gate that stops a deploy which cannot
 * satisfy it.
 *
 * The defect this exists for: `ENCRYPTION_KEY` was added to the boot-required
 * list, main was merged, the Vercel build went green, and every route returned
 * 500 — because nothing compared the required list against the deploying
 * environment. docs/DEPLOYMENT.md had listed the variable as required in
 * production for months. Documentation is not a check.
 */

const repoRoot = join(fileURLToPath(new URL("../../", import.meta.url)));

/** A minimal environment that satisfies the whole contract. */
function goodEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL_ENV: "production",
    DATABASE_URL: "postgres://u:p@host/db",
    ENCRYPTION_KEY: "a-key",
    PUBLIC_BASE_URL: "https://example.test",
    ...overrides,
  };
}

describe("missingRequiredEnv", () => {
  it("passes a complete environment", () => {
    expect(missingRequiredEnv(goodEnv())).toEqual([]);
  });

  it.each(REQUIRED_PRIVATE_ENV)("reports %s when it is absent", (key) => {
    expect(missingRequiredEnv(goodEnv({ [key]: undefined }))).toEqual([key]);
  });

  it.each(REQUIRED_PRIVATE_ENV)("reports %s when it is an empty string", (key) => {
    // Vercel stores a cleared variable as "" rather than dropping the key, so
    // presence is not the question — usability is.
    expect(missingRequiredEnv(goodEnv({ [key]: "" }))).toEqual([key]);
  });

  it("reports every missing variable at once, not just the first", () => {
    const env = Object.fromEntries(REQUIRED_PRIVATE_ENV.map((k) => [k, undefined]));
    expect(missingRequiredEnv(env)).toEqual([...REQUIRED_PRIVATE_ENV]);
  });

  it("requires ENCRYPTION_KEY, which is the one that took production down", () => {
    // Pinned by name rather than only through the derived cases above: this is
    // the variable whose absence fails AFTER a password is accepted, and a
    // future edit that quietly drops it should fail a test that says so.
    expect(REQUIRED_PRIVATE_ENV).toContain("ENCRYPTION_KEY");
  });

  it("does NOT require CRON_SECRET, which would turn a degraded job into an outage", () => {
    expect(REQUIRED_PRIVATE_ENV).not.toContain("CRON_SECRET");
  });
});

describe("publicBaseUrlProblem", () => {
  it("accepts an https origin", () => {
    expect(publicBaseUrlProblem("https://example.test")).toBeNull();
  });

  it.each([
    ["undefined", undefined],
    ["an empty string", ""],
  ])("rejects %s", (_label, value) => {
    expect(publicBaseUrlProblem(value)).toMatch(/must be set in production/);
  });

  it("rejects a value that is not a URL", () => {
    expect(publicBaseUrlProblem("not a url")).toMatch(/not a valid URL/);
  });

  it("rejects http, because email links must not be downgradeable", () => {
    expect(publicBaseUrlProblem("http://example.test")).toMatch(/must use https/);
  });
});

describe("buildEnvProblems — the gate", () => {
  it.each(STRICT_VERCEL_ENVS)("checks the %s environment", (vercelEnv) => {
    const problems = buildEnvProblems(
      goodEnv({ VERCEL_ENV: vercelEnv, ENCRYPTION_KEY: undefined }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("ENCRYPTION_KEY");
  });

  it.each([
    ["development", "development"],
    ["a local build with no VERCEL_ENV at all", undefined],
  ])("skips %s, where the server boots with dev === true", (_label, vercelEnv) => {
    // `vercel dev` and `npm run build` on a laptop have no production secrets
    // and env.ts is correspondingly lenient. Checking here would fail builds
    // that would have run fine.
    expect(buildEnvProblems({ VERCEL_ENV: vercelEnv, DATABASE_URL: undefined })).toEqual([]);
  });

  it("passes a complete production environment", () => {
    expect(buildEnvProblems(goodEnv())).toEqual([]);
  });

  it("reports a missing variable and a bad base URL together", () => {
    // One redeploy per problem is a bad way to spend an outage.
    const problems = buildEnvProblems(
      goodEnv({ ENCRYPTION_KEY: undefined, PUBLIC_BASE_URL: "http://example.test" }),
    );
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toContain("ENCRYPTION_KEY");
    expect(problems.join("\n")).toContain("must use https");
  });
});

describe("the contract has exactly one statement", () => {
  it("env.ts delegates rather than restating the list", () => {
    // The whole point. A second literal list is how a variable ends up
    // required at boot and unchecked at build time — which is the outage.
    const source = readFileSync(join(repoRoot, "src/lib/server/env.ts"), "utf8");

    expect(source).toContain("env-contract.js");
    for (const key of REQUIRED_PRIVATE_ENV) {
      expect(source).not.toContain(`"${key}"`);
    }
  });

  it("the build script delegates too", () => {
    const source = readFileSync(join(repoRoot, "scripts/vercel-build.mjs"), "utf8");

    expect(source).toContain("buildEnvProblems");
    for (const key of REQUIRED_PRIVATE_ENV) {
      expect(source).not.toContain(`"${key}"`);
    }
  });
});

describe("scripts/vercel-build.mjs", () => {
  /**
   * Spawns the real script. Only failure cases are driven this way — a passing
   * run would proceed to `drizzle-kit push` and a full vite build, which is
   * not something a unit suite should do. The gate's passing behaviour is
   * covered above, on the pure function.
   */
  function runBuildScript(env: Record<string, string | undefined>) {
    return spawnSync(process.execPath, [join(repoRoot, "scripts/vercel-build.mjs")], {
      cwd: repoRoot,
      encoding: "utf8",
      // A clean environment, or the developer's own DATABASE_URL leaks in and
      // the case under test stops being the case under test.
      env: { PATH: process.env.PATH ?? "", ...env } as NodeJS.ProcessEnv,
    });
  }

  it("aborts the build when a required variable is missing", () => {
    const result = runBuildScript(goodEnv({ ENCRYPTION_KEY: undefined }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ENCRYPTION_KEY");
    expect(result.stderr).toContain("cannot boot");
  });

  it("aborts BEFORE touching the database", () => {
    // The check is first on purpose: a deploy that cannot boot should not get
    // as far as pushing schema changes to the production database.
    const result = runBuildScript(goodEnv({ ENCRYPTION_KEY: undefined }));

    expect(result.stdout).not.toContain("drizzle-kit push");
    expect(result.stdout).not.toContain("Schema sync");
  });

  it("names the environment the operator has to go and fix", () => {
    const result = runBuildScript(goodEnv({ VERCEL_ENV: "preview", ENCRYPTION_KEY: undefined }));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("preview");
  });
});
