// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SRC = path.join(ROOT, "src");

// Matches the aliases in svelte.config.js.
const ALIASES: [string, string][] = [
  ["$components/", "src/lib/components/"],
  ["$server/", "src/lib/server/"],
  ["$lib/", "src/lib/"],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** `<script>` blocks for .svelte; the whole file otherwise. */
function scriptSources(file: string): string[] {
  const text = readFileSync(file, "utf8");
  if (!file.endsWith(".svelte")) return [text];
  return [...text.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

/**
 * Specifiers that survive type erasure — what the bundler actually pulls
 * in.
 *
 * Erasing `import type` edges is REQUIRED, not a nicety: six .svelte
 * files reach zod today through type-only chains via
 * $lib/server/schedules.ts, and the built client bundle contains no zod
 * at all. A walk that followed those edges would fail on correct code.
 */
function runtimeImports(file: string): string[] {
  const specs: string[] = [];
  for (const src of scriptSources(file)) {
    const sf = ts.createSourceFile(
      file + ".ts",
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    for (const st of sf.statements) {
      if (ts.isImportDeclaration(st)) {
        if (st.importClause?.isTypeOnly) continue;
        specs.push((st.moduleSpecifier as ts.StringLiteral).text);
      } else if (ts.isExportDeclaration(st) && st.moduleSpecifier) {
        if (st.isTypeOnly) continue;
        specs.push((st.moduleSpecifier as ts.StringLiteral).text);
      }
    }
  }
  return specs;
}

type Resolved =
  | { kind: "file"; file: string }
  | { kind: "package"; spec: string }
  | { kind: "framework"; spec: string }
  | { kind: "unresolved"; spec: string };

function resolve(spec: string, fromFile: string): Resolved {
  if (spec.startsWith("$app/") || spec.startsWith("$env/")) return { kind: "framework", spec };
  let base: string | null = null;
  for (const [alias, target] of ALIASES) {
    if (spec.startsWith(alias)) {
      base = path.join(ROOT, target, spec.slice(alias.length));
      break;
    }
  }
  if (spec === "$lib") base = path.join(ROOT, "src/lib");
  if (!base && (spec.startsWith("./") || spec.startsWith("../"))) {
    base = path.resolve(path.dirname(fromFile), spec);
  }
  if (!base) return { kind: "package", spec };
  for (const candidate of [
    base,
    base + ".ts",
    base + ".js",
    base + ".svelte",
    path.join(base, "index.ts"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile())
      return { kind: "file", file: candidate };
  }
  return { kind: "unresolved", spec };
}

const files = walk(SRC).filter((f) => /\.(ts|js|svelte)$/.test(f));
const graph = new Map(files.map((f) => [f, runtimeImports(f)]));

/** Every runtime-reachable package specifier from `entry`, transitively. */
function reachablePackages(entry: string): { packages: Set<string>; unresolved: string[] } {
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of graph.get(file) ?? runtimeImports(file)) {
      const r = resolve(spec, file);
      if (r.kind === "package") packages.add(r.spec);
      else if (r.kind === "file") queue.push(r.file);
      else if (r.kind === "unresolved")
        unresolved.push(`${path.relative(ROOT, file)} -> ${r.spec}`);
    }
  }
  return { packages, unresolved };
}

const clientEntrypoints = files.filter(
  (f) =>
    f.endsWith(".svelte") ||
    f.endsWith("src/service-worker.ts") ||
    /routes[/\\].*\+(page|layout)\.ts$/.test(f),
);

describe("the client bundle boundary", () => {
  it("finds client entrypoints to check", () => {
    expect(clientEntrypoints.length).toBeGreaterThan(50);
  });

  it("resolves every runtime import it walks", () => {
    // An unresolved specifier is a hole in the walk, and a hole is how a
    // zod import would slip past this test.
    const holes = clientEntrypoints.flatMap((e) => reachablePackages(e).unresolved);
    expect([...new Set(holes)]).toEqual([]);
  });

  it("never reaches zod from a .svelte file", () => {
    const offenders = clientEntrypoints
      .filter((e) => reachablePackages(e).packages.has("zod"))
      .map((e) => path.relative(ROOT, e));
    expect(offenders).toEqual([]);
  });

  it("never reaches drizzle-orm from a .svelte file", () => {
    const offenders = clientEntrypoints
      .filter((e) => reachablePackages(e).packages.has("drizzle-orm"))
      .map((e) => path.relative(ROOT, e));
    expect(offenders).toEqual([]);
  });

  it("detects a zod reach when one exists", () => {
    // Positive control. Without this, a walk that silently found nothing
    // -- wrong alias, wrong file extension, an empty entrypoint list --
    // would look identical to a clean boundary.
    const serverDoor = path.join(ROOT, "src/lib/utils/validation.ts");
    expect(reachablePackages(serverDoor).packages.has("zod")).toBe(true);
  });

  it("reaches the appearance registry from the appearance page, and zod from the schema module", () => {
    const page = path.join(ROOT, "src/routes/(app)/settings/appearance/+page.svelte");
    expect(reachablePackages(page).packages.has("zod")).toBe(false);
    const schema = path.join(ROOT, "src/lib/appearance/schema.ts");
    expect(reachablePackages(schema).packages.has("zod")).toBe(true);
  });
});
