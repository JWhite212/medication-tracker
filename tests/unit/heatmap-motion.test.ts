// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compile } from "svelte/compiler";

/**
 * Svelte scopes component <style>. A selector rooted at an ancestor attribute
 * — `[data-reduced-motion="true"] .heatmap-cell` — is unreachable from the
 * component's own scope, so the compiler emits it commented out as an unused
 * selector and the rule silently does nothing. `npm run check` runs
 * svelte-check without --fail-on-warnings, so that ships green.
 *
 * This test asserts on the compiled CSS because there is nothing else to
 * assert on. Prove it by mutation: drop the :global() wrapper and watch it go
 * red.
 */
function compileHeatmapCss(): string {
  const path = fileURLToPath(new URL("../../src/lib/components/Heatmap.svelte", import.meta.url));
  const source = readFileSync(path, "utf8");
  const { css } = compile(source, { name: "Heatmap", css: "external" });
  return css?.code ?? "";
}

describe("Heatmap reduced-motion", () => {
  it("emits a live rule for the in-app data-reduced-motion toggle", () => {
    const css = compileHeatmapCss();
    expect(css).toMatch(/\[data-reduced-motion="true"\]/);
  });

  it("does not emit that rule as an unused selector", () => {
    const css = compileHeatmapCss();
    // Svelte writes dead selectors as `/* (unused) ... */`.
    const dead = css.match(/\/\*\s*\(unused\)[^*]*data-reduced-motion[^*]*\*\//);
    expect(dead, `selector was compiled away as unused:\n${dead?.[0]}`).toBeNull();
  });

  it("still honours the OS-level media query", () => {
    const css = compileHeatmapCss();
    expect(css).toMatch(/prefers-reduced-motion/);
  });
});
