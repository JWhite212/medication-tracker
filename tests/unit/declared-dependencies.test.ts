// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

/**
 * Every package the repo imports by name is declared in package.json.
 *
 * A package that is only installed because something else depends on it
 * resolves today through npm's hoisting, and stops resolving the day a
 * second version of its parent appears in the tree — with no package.json
 * change to blame. `eslint.config.js` imported `svelte-eslint-parser` and
 * `@typescript-eslint/parser` that way, and `tests/unit/helpers/axe-ssr.ts`
 * imported `axe-core` (installed by `@axe-core/playwright`) in every unit
 * run.
 *
 * Scanned: `src/`, `tests/`, `scripts/` and the root config files. Ignored:
 * relative paths, SvelteKit's `$` aliases, `virtual:` modules and Node
 * builtins.
 */

const ROOT = process.cwd();
const SCANNED_DIRS = ["src", "tests", "scripts"];
const SOURCE = /\.(?:ts|js|mjs|cjs|svelte)$/;

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (SOURCE.test(entry.name)) out.push(path);
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  for (const dir of SCANNED_DIRS) walk(join(ROOT, dir), out);
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && SOURCE.test(entry.name)) out.push(join(ROOT, entry.name));
  }
  return out;
}

/**
 * Bare specifiers in static imports, re-exports, `import()`, `require()`,
 * `vi.mock()` and `vi.importActual()`. Static forms are anchored to a line
 * start, so a specifier quoted mid-line in a string is not read as one.
 */
const SPECIFIER =
  /^\s*(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"'./$][^"']*)["']|^\s*import\s*["']([^"'./$][^"']*)["']|\b(?:import|require|vi\.mock|vi\.importActual)\(\s*["']([^"'./$][^"']*)["']/gm;

function packageName(specifier: string): string | null {
  if (specifier.startsWith("node:") || specifier.startsWith("virtual:")) return null;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return builtinModules.includes(name) ? null : name;
}

describe("declared dependencies", () => {
  it("every package imported by name is in dependencies or devDependencies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);

    const undeclared: string[] = [];
    let scanned = 0;
    for (const file of sourceFiles()) {
      // Comment lines quote example imports (`import X from "y"`); drop them.
      const text = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
        .join("\n");
      for (const match of text.matchAll(SPECIFIER)) {
        const name = packageName(match[1] ?? match[2] ?? match[3]);
        if (name === null) continue;
        scanned++;
        if (!declared.has(name)) undeclared.push(`${name} (${relative(ROOT, file)})`);
      }
    }

    expect([...new Set(undeclared)].sort()).toEqual([]);
    // Non-vacuity: the scan sees the app's real imports.
    expect(scanned).toBeGreaterThan(200);
  });
});
