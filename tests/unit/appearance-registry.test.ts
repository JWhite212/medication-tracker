// @vitest-environment node
import { describe, it, expect } from "vitest";
import { APPEARANCE_ENTRIES, APPEARANCE_KEYS, actionFor, entryFor } from "$lib/appearance/registry";

describe("the appearance registry", () => {
  it("owns exactly the five options the appearance page renders", () => {
    expect([...APPEARANCE_KEYS]).toEqual([
      "accentColor",
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
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const source = readFileSync(
      fileURLToPath(new URL("../../src/lib/appearance/registry.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["']zod["']/);
    for (const match of source.matchAll(/^import\s+(type\s+)?.*from\s+["']\$lib\/server\//gm)) {
      expect(match[1], `value import from $lib/server: ${match[0]}`).toBeTruthy();
    }
  });
});
