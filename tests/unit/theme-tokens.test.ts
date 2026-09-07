// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  contrastRatio,
  compositeOver,
  readableForeground,
  readableInk,
  INK_BACKDROP,
  INK_BACKDROP_LIGHT,
  READABLE_LIGHT,
  READABLE_DARK,
} from "$lib/utils/contrast";
import { entryFor } from "$lib/appearance/registry";
import { blockBody, parseDeclarations } from "./helpers/css-tokens";

function readAppCss(): string {
  return readFileSync(fileURLToPath(new URL("../../src/app.css", import.meta.url)), "utf8");
}

const CSS = readAppCss();

const DARK = parseDeclarations(blockBody(CSS, /@theme\s*\{/, "the @theme block"));

/** The light arm's body — everything inside `@media (prefers-color-scheme: light)`. */
const LIGHT_ARM = blockBody(CSS, /@media \(prefers-color-scheme: light\)\s*\{/, "the light arm");

/** The stylesheet with the light arm removed, so `HC_DARK` cannot match the light one. */
const CSS_DARK_ONLY = CSS.replace(LIGHT_ARM, "");

const HC_DARK = parseDeclarations(
  blockBody(
    blockBody(CSS_DARK_ONLY, /@media \(prefers-contrast: more\)\s*\{/, "the dark contrast block"),
    /:root\s*\{/,
    "the dark contrast :root",
  ),
);

/**
 * The light palette as the BROWSER resolves it: the light arm overrides
 * @theme, it does not replace it. Asserting the arm alone would silently
 * exempt every token it does not redeclare.
 */
const LIGHT = {
  ...DARK,
  ...parseDeclarations(blockBody(LIGHT_ARM, /:root\s*\{/, "the light :root")),
};

const HC_LIGHT = parseDeclarations(
  blockBody(
    blockBody(LIGHT_ARM, /@media \(prefers-contrast: more\)\s*\{/, "the light contrast block"),
    /:root\s*\{/,
    "the light contrast :root",
  ),
);

/**
 * `rgba(R,G,B,A)` -> the alpha and the colour it composites toward.
 *
 * Was `whiteAlpha`, which threw on anything but white — correct while the
 * app was dark-only, and fatal the moment the light arm flips glass-hover,
 * glass-border and border-strong to black-alpha. It still throws on a value
 * that is neither pure white nor pure black, so a token that stops being a
 * simple overlay fails loudly rather than being silently skipped.
 */
function alphaOf(value: string): { alpha: number; overlay: string } {
  const m = value.match(/^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/);
  if (!m) throw new Error(`Expected an rgba() token, got: ${value}`);
  const [r, g, b] = [m[1], m[2], m[3]];
  if (r === "255" && g === "255" && b === "255") return { alpha: Number(m[4]), overlay: "#ffffff" };
  if (r === "0" && g === "0" && b === "0") return { alpha: Number(m[4]), overlay: "#000000" };
  throw new Error(`Expected a white- or black-alpha token, got: ${value}`);
}

/**
 * The accent swatches offered on /settings/appearance. These are not
 * @theme tokens — they are the values written to
 * `user_preferences.accent_color` and then set inline as --color-accent,
 * where they beat every stylesheet rule. Raising the @theme accent
 * without raising these left every real user on the failing pair.
 *
 * Read from the registry rather than scraped out of the page: the
 * registry is the single description of the option and the page renders
 * from it.
 */
function readAccentPresets(): string[] {
  return [...entryFor("accentColor").presets];
}

/** Every opaque surface a foreground token is actually rendered on. */
function surfaces(T: Record<string, string>): Record<string, string> {
  const raised = T["--color-surface-raised"];
  const glass = alphaOf(T["--color-glass"]);
  const hover = alphaOf(T["--color-glass-hover"]);
  return {
    surface: T["--color-surface"],
    "surface-raised": raised,
    "surface-overlay": T["--color-surface-overlay"],
    "glass-on-surface": compositeOver(glass.alpha, T["--color-surface"], glass.overlay),
    "glass-on-raised": compositeOver(glass.alpha, raised, glass.overlay),
    "glass-hover": compositeOver(hover.alpha, raised, hover.overlay),
  };
}

/**
 * Pairs knowingly shipping below threshold. Every entry needs a reason and an
 * owner. An empty list is the goal; an entry is a decision, not a shrug — a
 * preset that is merely one step off its ramp gets moved, not excused, which
 * is why #6366f1 (4.47) and #8b5cf6 (4.46) are not listed here.
 * For an accent preset, `token` is the hex and `surface` is "accent preset".
 */
const ALLOWED_BELOW_THRESHOLD: { token: string; surface: string; why: string }[] = [];

/**
 * One entry per `prefers-color-scheme`. Both "dark" and "light" exist now
 * that Task 3 has added the light palette to app.css.
 */
const SCHEMES = [
  {
    name: "dark",
    T: DARK,
    HC: HC_DARK,
    inkBackdrop: INK_BACKDROP,
    inkOverlay: READABLE_LIGHT,
    /** Dark solves the ink against the LIGHTEST surface; light, the darkest. */
    pickInkBackdrop: (a: string, b: string) =>
      contrastRatio(b, "#ffffff") < contrastRatio(a, "#ffffff") ? b : a,
  },
  {
    name: "light",
    T: LIGHT,
    HC: HC_LIGHT,
    inkBackdrop: INK_BACKDROP_LIGHT,
    inkOverlay: READABLE_DARK,
    /** Light solves the ink against the DARKEST surface — the operator inverts. */
    pickInkBackdrop: (a: string, b: string) =>
      contrastRatio(b, "#000000") < contrastRatio(a, "#000000") ? b : a,
  },
] as const;

describe.each(SCHEMES)("$name — @theme parsing", ({ T }) => {
  it("finds the tokens it is about to assert on", () => {
    expect(T["--color-surface"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(T["--color-text-primary"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(T).length).toBeGreaterThan(15);
  });
});

describe.each(SCHEMES)(
  "$name — text tokens meet 4.5:1 on every surface they render on",
  ({ T }) => {
    const TEXT_TOKENS = [
      "--color-text-primary",
      "--color-text-secondary",
      "--color-text-muted",
      "--color-accent-ink",
      "--color-danger-ink",
      // success and warning are asserted here too: they are used as text in 14
      // and 15 files respectively, and both already pass, so this pins that.
      "--color-success",
      "--color-warning",
      // info is rendered as text on the medications list chip.
      "--color-info",
      // --color-accent-hover is deliberately NOT here. It is a fill-only token
      // (see app.css) and would need to be near #4f46e5's lightness to work as
      // text, which is the opposite of what white-on-fill needs. It is asserted
      // in the fill table below instead — it used to be asserted nowhere, which
      // is how it regressed to 2.81:1 while being rendered as text at 3 sites.
    ];

    for (const token of TEXT_TOKENS) {
      for (const [name, bg] of Object.entries(surfaces(T))) {
        const allowed = ALLOWED_BELOW_THRESHOLD.some(
          (a) => a.token === token && a.surface === name,
        );
        it.skipIf(allowed)(`${token} on ${name}`, () => {
          expect(T[token], `${token} is not defined in @theme`).toBeDefined();
          const ratio = contrastRatio(T[token], bg);
          expect(ratio, `${T[token]} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
            4.5,
          );
        });
      }
    }
  },
);

describe.each(SCHEMES)(
  "$name — every accent preset a user can pick carries a legible foreground",
  ({ T, inkBackdrop, inkOverlay, pickInkBackdrop }) => {
    const presets = readAccentPresets();

    it("offers the swatches the page is documented to offer", () => {
      expect(presets).toHaveLength(10);
      expect(presets[0]).toBe(T["--color-accent"]);
    });

    for (const preset of presets) {
      const allowed = ALLOWED_BELOW_THRESHOLD.some(
        (a) => a.token === preset && a.surface === "accent preset",
      );
      it.skipIf(allowed)(`${preset} as a fill`, () => {
        const { color, ratio } = readableForeground(preset);
        expect(ratio, `best foreground ${color} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          4.5,
        );
      });

      // The layout derives --color-accent-ink from the same stored hex, so the
      // ink has to hold for every swatch too, not just for the @theme fallback.
      it(`${preset} derives an ink legible on every surface`, () => {
        const ink = readableInk(preset, { backdrop: inkBackdrop, overlay: inkOverlay });
        for (const [name, bg] of Object.entries(surfaces(T))) {
          const ratio = contrastRatio(ink, bg);
          expect(
            ratio,
            `${preset} -> ${ink} on ${name} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    it("solves the ink against the surface the scheme's worst case lands on", () => {
      const chosen = Object.values(surfaces(T)).reduce(pickInkBackdrop);
      expect(inkBackdrop).toBe(chosen);
    });
  },
);

describe.each(SCHEMES)("$name — solid fills carry a legible foreground", ({ T }) => {
  const PAIRS: [fill: string, fg: string][] = [
    ["--color-accent", "--color-accent-fg"],
    ["--color-accent-hover", "--color-accent-fg"],
    ["--color-danger", "--color-danger-fg"],
    ["--color-success", "--color-success-fg"],
    ["--color-warning", "--color-warning-fg"],
  ];

  for (const [fill, fg] of PAIRS) {
    it(`${fg} on ${fill}`, () => {
      expect(T[fill], `${fill} is not defined`).toBeDefined();
      expect(T[fg], `${fg} is not defined`).toBeDefined();
      const ratio = contrastRatio(T[fg], T[fill]);
      expect(ratio, `${T[fg]} on ${T[fill]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/**
 * Tinted chips: `bg-danger/20 text-danger-ink` and friends. The opaque
 * surfaces above are not what these render on — the chip paints a fraction of
 * its own fill over whatever is behind it, which lightens the backdrop and
 * costs the foreground contrast. Nothing asserted that, so live combinations
 * were sitting below 4.5 while every token passed on its own.
 *
 * Each backdrop below is the real DOM nesting, read off the component, not a
 * representative surface.
 */
describe.each(SCHEMES)(
  "$name — tinted chips are legible over the backdrop they actually paint on",
  ({ T }) => {
    const glass = alphaOf(T["--color-glass"]);
    const glassHover = alphaOf(T["--color-glass-hover"]);

    // MedicationCard: .bg-glass.hover:bg-glass-hover > page <main> on --color-surface.
    const card = compositeOver(glass.alpha, T["--color-surface"], glass.overlay);
    const cardHover = compositeOver(glassHover.alpha, T["--color-surface"], glassHover.overlay);
    // SideEffectPicker severity chips: .bg-glass > DoseEditForm > Modal panel
    // on --color-surface-raised.
    const modalGlass = compositeOver(glass.alpha, T["--color-surface-raised"], glass.overlay);
    // MyDayTimeline: row.hover:bg-glass-hover > .bg-glass group > page.
    const row = card;
    const rowHover = compositeOver(glassHover.alpha, card, glassHover.overlay);

    // [fill, alpha, backdrop, foreground, threshold]. 3:1 rather than 4.5 where
    // the foreground is a glyph in a status circle (WCAG 1.4.11), not text.
    const CHIPS: [string, number, string, string, number, string][] = [
      ["--color-info", 0.15, card, "--color-info", 4.5, "medications refill chip (watch)"],
      ["--color-info", 0.15, cardHover, "--color-info", 4.5, "…hovered"],
      ["--color-warning", 0.15, card, "--color-warning", 4.5, "medications refill chip (warning)"],
      ["--color-warning", 0.15, cardHover, "--color-warning", 4.5, "…hovered"],
      [
        "--color-danger",
        0.15,
        card,
        "--color-danger-ink",
        4.5,
        "medications refill chip (critical)",
      ],
      ["--color-danger", 0.15, cardHover, "--color-danger-ink", 4.5, "…hovered"],
      [
        "--color-danger",
        0.2,
        modalGlass,
        "--color-danger-ink",
        4.5,
        "side effect severity: severe",
      ],
      [
        "--color-warning",
        0.2,
        modalGlass,
        "--color-warning",
        4.5,
        "side effect severity: moderate",
      ],
      [
        "--color-text-secondary",
        0.3,
        modalGlass,
        "--color-text-primary",
        4.5,
        "side effect severity: mild",
      ],
      ["--color-success", 0.2, row, "--color-success", 3, "timeline status glyph: taken"],
      ["--color-success", 0.2, rowHover, "--color-success", 3, "…hovered"],
      ["--color-warning", 0.2, row, "--color-warning", 3, "timeline status glyph: skipped"],
      ["--color-warning", 0.2, rowHover, "--color-warning", 3, "…hovered"],
    ];

    for (const [fill, alpha, base, fg, threshold, site] of CHIPS) {
      it(`${fg} on ${fill}/${alpha * 100} — ${site}`, () => {
        expect(T[fill], `${fill} is not defined`).toBeDefined();
        expect(T[fg], `${fg} is not defined`).toBeDefined();
        const chip = compositeOver(alpha, base, T[fill]);
        const ratio = contrastRatio(T[fg], chip);
        expect(
          ratio,
          `${T[fg]} on ${chip} (${T[fill]} at ${alpha} over ${base}) is ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(threshold);
      });
    }
  },
);

describe.each(SCHEMES)(
  "$name — control boundaries meet the 3:1 non-text minimum (WCAG 1.4.11)",
  ({ T }) => {
    for (const [name, bg] of Object.entries(surfaces(T))) {
      if (name.startsWith("glass")) continue; // a control never sits on its own hover state
      it(`--color-border-strong on ${name}`, () => {
        expect(T["--color-border-strong"], "--color-border-strong is not defined").toBeDefined();
        const border = alphaOf(T["--color-border-strong"]);
        const composited = compositeOver(border.alpha, bg, border.overlay);
        const ratio = contrastRatio(composited, bg);
        expect(ratio, `composites to ${composited}, ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          3,
        );
      });
    }
  },
);

describe.each(SCHEMES)(
  "$name — prefers-contrast: more raises contrast on every token it overrides",
  ({ T, HC }) => {
    /**
     * How each override is measured. An override with no entry here fails the
     * first test rather than being silently skipped — adding a line to the
     * block must be a decision about what "more contrast" means for it.
     *
     * "text"        worst ratio across the six surfaces
     * "white-alpha" worst ratio of the composited hairline against its surface
     * "fill"        ratio against --color-accent-fg
     */
    const ROLES: Record<string, "text" | "white-alpha" | "fill"> = {
      "--color-text-muted": "text",
      "--color-text-secondary": "text",
      "--color-glass-border": "white-alpha",
      "--color-border-strong": "white-alpha",
      "--color-accent": "fill",
    };

    function worstRatio(role: string, value: string): number {
      if (role === "fill") return contrastRatio(T["--color-accent-fg"], value);
      const ratios = Object.values(surfaces(T)).map((bg) => {
        if (role !== "white-alpha") return contrastRatio(value, bg);
        const overlay = alphaOf(value);
        return contrastRatio(compositeOver(overlay.alpha, bg, overlay.overlay), bg);
      });
      return Math.min(...ratios);
    }

    it("declares a role for every token it overrides", () => {
      expect(Object.keys(HC).sort()).toEqual(Object.keys(ROLES).sort());
    });

    for (const [token, role] of Object.entries(ROLES)) {
      it(`${token} beats the base it shadows`, () => {
        expect(HC[token], `${token} is not overridden in the prefers-contrast block`).toBeDefined();
        expect(T[token], `${token} is not defined in @theme`).toBeDefined();
        const base = worstRatio(role, T[token]);
        const high = worstRatio(role, HC[token]);
        expect(
          high,
          `${HC[token]} is ${high.toFixed(2)}:1 but the base ${T[token]} is ${base.toFixed(2)}:1`,
        ).toBeGreaterThan(base);
      });
    }

    for (const [token, role] of Object.entries(ROLES)) {
      if (role === "white-alpha") continue; // hairlines and fills carry their own thresholds
      it(`${token} still meets 4.5:1`, () => {
        const high = worstRatio(role, HC[token]);
        expect(high, `${HC[token]} is ${high.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  },
);

describe.each(SCHEMES)("$name — the heatmap ramp is distinguishable step to step", ({ T }) => {
  it("holds at least 1.35:1 between adjacent steps", () => {
    const ramp = [0, 1, 2, 3, 4].map((i) => {
      const v = T[`--color-heatmap-${i}`];
      expect(v, `--color-heatmap-${i} is not defined`).toBeDefined();
      return v;
    });
    for (let i = 1; i < ramp.length; i++) {
      const ratio = contrastRatio(ramp[i], ramp[i - 1]);
      expect(ratio, `step ${i - 1}->${i} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.35);
    }
  });
});
