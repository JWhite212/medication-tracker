// @vitest-environment node
import { describe, it, expect } from "vitest";
import { APPEARANCE_ENTRIES, APPEARANCE_KEYS, actionFor, entryFor } from "$lib/appearance/registry";

describe("the appearance registry", () => {
  it("owns exactly the six options the appearance page renders", () => {
    expect([...APPEARANCE_KEYS]).toEqual([
      "accentColor",
      "theme",
      "dateFormat",
      "timeFormat",
      "uiDensity",
      "reducedMotion",
    ]);
  });

  it("gives every entry a label and a control kind", () => {
    for (const entry of APPEARANCE_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0);
      expect(["swatch", "select", "checkbox"]).toContain(entry.control);
    }
  });

  it("offers ten accent presets, all six-digit hex", () => {
    const accent = entryFor("accentColor");
    expect(accent.presets).toHaveLength(10);
    for (const preset of accent.presets) expect(preset).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps select option values distinct within each entry", () => {
    for (const entry of APPEARANCE_ENTRIES) {
      if (entry.control !== "select") continue;
      const values = entry.options.map((o) => o.value);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("derives the form action from the key", () => {
    expect(actionFor("uiDensity")).toBe("?/uiDensity");
  });

  it("names a DOM binding for the options the app subtree reads", () => {
    expect(entryFor("accentColor").dom).toMatchObject({
      kind: "css-var",
      property: "--color-accent",
    });
    expect(entryFor("uiDensity").dom).toEqual({
      kind: "data-attribute",
      attribute: "data-density",
    });
    expect(entryFor("reducedMotion").dom).toEqual({
      kind: "data-attribute",
      attribute: "data-reduced-motion",
    });
  });

  it("imports no zod and no server value", async () => {
    // The page imports this module. A zod import here would put zod in
    // the client bundle for the first time; a value import from
    // $lib/server would drag drizzle in with it.
    //
    // Parsed with the TypeScript compiler API rather than pattern-matched:
    // a regex over import statements has false negatives a real parse
    // doesn't — a Prettier-wrapped multi-line import, a side-effect
    // import with no `from` clause, and a re-export all slip past a
    // `^import ... from` regex undetected. This walks every
    // module-specifier-bearing declaration (import, export-from, and
    // import-equals) and asks the AST whether each is type-only.
    const ts = (await import("typescript")).default;
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("../../src/lib/appearance/registry.ts", import.meta.url));
    const source = readFileSync(path, "utf8");
    const sourceFile = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );

    type ModuleRef = { specifier: string; isValueImport: boolean; text: string };
    const refs: ModuleRef[] = [];

    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement)) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        const clause = statement.importClause;
        let isValueImport: boolean;
        if (!clause) {
          // Side-effect import — `import "y";` — has no clause at all
          // and is a runtime edge by definition.
          isValueImport = true;
        } else if (clause.isTypeOnly) {
          // Whole-clause `import type { X } from "y"` — erased entirely,
          // even if it names several bindings.
          isValueImport = false;
        } else if (clause.name) {
          // A default binding (`import X from "y"`) is always a value
          // reference when the clause itself isn't type-only.
          isValueImport = true;
        } else if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
          isValueImport = true;
        } else if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          // Per-specifier `import { type X, y } from "z"` — a runtime
          // edge only if at least one named binding isn't `type`-marked.
          isValueImport = clause.namedBindings.elements.some((el) => !el.isTypeOnly);
        } else {
          isValueImport = false;
        }
        refs.push({ specifier, isValueImport, text: statement.getText(sourceFile) });
      } else if (ts.isExportDeclaration(statement)) {
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const specifier = statement.moduleSpecifier.text;
        let isValueImport: boolean;
        if (statement.isTypeOnly) {
          isValueImport = false;
        } else if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          isValueImport = statement.exportClause.elements.some((el) => !el.isTypeOnly);
        } else {
          // `export * from "y"` (no export clause) re-exports everything,
          // including runtime bindings.
          isValueImport = true;
        }
        refs.push({ specifier, isValueImport, text: statement.getText(sourceFile) });
      } else if (ts.isImportEqualsDeclaration(statement)) {
        const ref = statement.moduleReference;
        if (ts.isExternalModuleReference(ref) && ts.isStringLiteral(ref.expression)) {
          // `import x = require("y")` has no type-only form worth
          // distinguishing here — it's always a runtime edge.
          refs.push({
            specifier: ref.expression.text,
            isValueImport: true,
            text: statement.getText(sourceFile),
          });
        }
      }
    }

    const zodRefs = refs.filter((r) => r.specifier === "zod");
    expect(zodRefs, `zod referenced: ${zodRefs.map((r) => r.text).join("; ")}`).toHaveLength(0);

    const serverValueRefs = refs.filter(
      (r) => r.specifier.startsWith("$lib/server/") && r.isValueImport,
    );
    expect(
      serverValueRefs,
      `value reference to $lib/server: ${serverValueRefs.map((r) => r.text).join("; ")}`,
    ).toHaveLength(0);
  });
});
