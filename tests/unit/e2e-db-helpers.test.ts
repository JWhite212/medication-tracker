// @vitest-environment node
//
// The E2E suite's database helpers run under Playwright, which loads test
// files in plain Node rather than through Vite. The app's db module
// (src/lib/server/db/index.ts) imports `$env/dynamic/private`, a SvelteKit
// virtual module, so anything under tests/e2e that reaches it fails with
// ERR_MODULE_NOT_FOUND the first time it touches the database. E2E does not
// run in CI (`RUN_E2E` is unset), so nothing else would notice.
//
// Vitest cannot reproduce that by importing the helper here, because its
// SvelteKit plugin provides `$env`. The second test therefore runs the helper
// in a separate plain-Node process (tsx, as scripts/db.ts documents), which is
// the loader shape Playwright has.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const e2eDir = join(repoRoot, "tests/e2e");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(ts|js|mjs)$/.test(name) ? [path] : [];
  });
}

// `.../server/db` or `.../server/db/index`, quoted, in a static or dynamic
// import. `.../server/db/schema` is plain Drizzle and is allowed.
const APP_DB_MODULE = /["'](?:\$lib|(?:\.\.\/)+src\/lib)\/server\/db(?:\/index(?:\.ts)?)?["']/;

describe("E2E database helpers", () => {
  it("no file under tests/e2e imports the app db module", () => {
    const offenders = walk(e2eDir)
      .filter((file) => APP_DB_MODULE.test(readFileSync(file, "utf8")))
      .map((file) => relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });

  it("the pattern matches the import shapes it exists to catch", () => {
    for (const probe of [
      'import("../../../src/lib/server/db")',
      'import("../../src/lib/server/db")',
      'from "$lib/server/db"',
      "from '../../src/lib/server/db/index.ts'",
    ]) {
      expect(APP_DB_MODULE.test(probe), probe).toBe(true);
    }
    expect(APP_DB_MODULE.test('from "../../../src/lib/server/db/schema"')).toBe(false);
  });

  it("reaches the database driver in plain Node, without $env", () => {
    // Calls a real helper against an address nothing listens on. The query
    // must fail at the network, not at module resolution.
    const probe = `
      const helpers = await import(${JSON.stringify(join(e2eDir, "helpers/db.ts"))});
      try {
        await helpers.getUserIdByEmail("nobody@example.test");
        console.log(JSON.stringify({ code: "none", message: "resolved" }));
      } catch (err) {
        console.log(JSON.stringify({ code: err?.code ?? null, message: String(err?.message ?? err) }));
      }
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", probe],
      {
        cwd: repoRoot,
        encoding: "utf8",
        timeout: 60_000,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          TMPDIR: process.env.TMPDIR ?? "",
          DATABASE_URL: "postgresql://test:test@127.0.0.1:9/test",
        },
      },
    );
    expect(result.status, result.stderr).toBe(0);
    const outcome = JSON.parse(result.stdout.trim().split("\n").pop() ?? "{}") as {
      code: string | null;
      message: string;
    };
    expect(outcome.code).not.toBe("ERR_MODULE_NOT_FOUND");
    expect(outcome.message).not.toContain("$env");
    // Drizzle's wrapper for a query the driver could not run: proof the
    // helper got as far as sending SQL.
    expect(outcome.message).toMatch(/^Failed query: select/);
  });
});
