// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  contrastRatio,
  compositeOver,
  readableForeground,
  readableHover,
  readableInk,
  INK_BACKDROP,
  INK_BACKDROP_LIGHT,
  READABLE_LIGHT,
  READABLE_DARK,
} from "$lib/utils/contrast";
import { entryFor } from "$lib/appearance/registry";
import { accentInkFor, ACCENT_CHIP_ALPHA } from "$lib/appearance/theme-css";
import { TONE_CLASSES, type Tone } from "$lib/utils/status-tone";
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

/** `bg-warning/15` -> the token and alpha a class string fills with; no `bg-` class -> null (transparent). */
function fillOf(classes: string): { token: string; alpha: number } | null {
  const m = classes.match(/(?:^|\s)bg-([a-z-]+?)(?:\/(\d+))?(?=\s|$)/);
  return m ? { token: `--color-${m[1]}`, alpha: m[2] ? Number(m[2]) / 100 : 1 } : null;
}

/** The one `text-*` colour in a class string, as its token. Throws on none or several. */
function inkOf(classes: string): string {
  const found = [...classes.matchAll(/(?:^|\s)text-([a-z-]+)(?=\s|$)/g)];
  if (found.length !== 1) {
    throw new Error(`Expected one text colour in "${classes}", found ${found.length}`);
  }
  return `--color-${found[0][1]}`;
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

  it("has no --color-info: neutral replaced it as a status colour", () => {
    // Its hue sat next to the accent's, so the refill "watch" tier and a
    // selected control looked the same. The owner scan rejects *-info classes.
    expect(T["--color-info"]).toBeUndefined();
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
      // success and warning are the happened and needs-you text (TONE_CLASSES).
      "--color-success",
      "--color-warning",
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
  ({ name: schemeName, T, inkBackdrop, inkOverlay, pickInkBackdrop }) => {
    const presets = readAccentPresets();

    it("offers the swatches the page is documented to offer", () => {
      expect(presets).toHaveLength(10);
      expect(presets[0]).toBe(T["--color-accent"]);
    });

    // The backdrops a tinted accent chip actually paints on — the sidebar /
    // mobile-header avatar initial (resting AND hovered) and the onboarding
    // step numerals. `card` is built the same way the status-tone describe
    // below builds it (MedicationCard: .bg-glass > page <main> on
    // --color-surface) — the onboarding numeral's real parent is exactly
    // that bg-glass card. `surface-raised` is the avatar's own resting
    // backdrop (the `<aside>` / `<header>` it sits in). `surface-overlay` is
    // the avatar's HOVERED backdrop: Sidebar's `<a href="/settings">`
    // wrapping the avatar carries `hover:bg-surface-overlay`, an opaque
    // token that replaces `surface-raised` outright on hover (not a second
    // layer stacked on it). These composite DARKER in luminance than any
    // opaque surface `surfaces()` enumerates, so the ink solved against the
    // worst OPAQUE surface (inkBackdrop) does not automatically clear them —
    // see Important Finding 1. `accentInkFor` (src/lib/appearance/theme-css.ts)
    // is the production fix: it solves against the binding backdrop across
    // both the opaque surfaces and these three chip composites, so this test
    // asserts the real derivation rather than a copy of it.
    //
    // Deliberately NOT `cardHover` (glass-hover composited over
    // --color-surface): no element among the five changed sites carries that
    // combination. MobileHeader's avatar and the onboarding numerals have no
    // hover state of their own at all, and Sidebar's chip `<div>` doesn't
    // either — only its WRAPPING `<a>` does, and on hover that `<a>` paints
    // opaque `surface-overlay`, not glass-hover over --color-surface-raised.
    // Reusing `cardHover` verbatim would test a pixel combination nothing in
    // the app ever paints, which is exactly the failure mode `surfaces()`'s
    // own docstring warns against ("the real DOM nesting, read off the
    // component, not a representative surface").
    const glass = alphaOf(T["--color-glass"]);
    const ACCENT_CHIP_BACKDROPS: Record<string, string> = {
      card: compositeOver(glass.alpha, T["--color-surface"], glass.overlay),
      "surface-raised": T["--color-surface-raised"],
      "surface-overlay (avatar hovered)": T["--color-surface-overlay"],
    };

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

      // bg-accent/15 text-accent-ink: Sidebar/MobileHeader avatar initial
      // (resting and hovered), OnboardingWelcome step numerals (Important
      // Finding 1). The ink's opaque-surface guarantee does not reach a
      // tinted chip. Was /20 — failed here for 6 of 10 presets in light and
      // 1 in dark (#f97316 on the onboarding-numeral card backdrop); /15
      // alone did not fix it either — all ten presets still fail in light
      // (3.68-4.34) when the ink is solved only against the opaque
      // inkBackdrop. `accentInkFor` fixes the derivation itself.
      it(`${preset} accent/15 chip clears 4.5:1 (avatar initial, onboarding numerals)`, () => {
        const ink = accentInkFor(schemeName, preset);
        for (const [site, bg] of Object.entries(ACCENT_CHIP_BACKDROPS)) {
          const chip = compositeOver(ACCENT_CHIP_ALPHA, bg, preset);
          const ratio = contrastRatio(ink, chip);
          expect(
            ratio,
            `${preset} -> ${ink} on accent/${ACCENT_CHIP_ALPHA * 100} over ${site} (${chip}) is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }

    // INK_BACKDROP / INK_BACKDROP_LIGHT are constants in utils/, which cannot
    // read this stylesheet. If a surface token moves, this is what says so.
    //
    // It pins the worst OPAQUE surface — but that is not the worst backdrop
    // the ink actually renders on. A tinted chip (`bg-accent/20` and
    // friends) composites darker in light mode than any opaque surface
    // `surfaces()` enumerates, so an ink that clears this pin can still fail
    // on a chip. That boundary — opaque surfaces covered here, tinted chips
    // not — is exactly the gap Important Finding 1 shipped through; see the
    // `accent/15 chip clears 4.5:1` tests above for the fix.
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

/** CSS `brightness(k)`: every sRGB channel times k, clamped. Filter functions run in sRGB. */
function brighten(hex: string, k: number): string {
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)))
      .map((c) => c.toString(16).padStart(2, "0"))
      .join("")
  );
}

/** The three backdrops a Button sits on: the page, a glass card, a dialog. */
const HOVER_BACKDROPS = ["page", "card", "dialog"] as const;
type HoverBackdrop = (typeof HOVER_BACKDROPS)[number];

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|svelte)$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every one-line quoted class string in src/ that paints the accent as a
 * solid fill, at rest or on hover, and declares a hover: Button's primary,
 * DoseEditForm's Save, DoseActionForm's primary, the medications card's Log
 * (accent only while hovered) and the landing page's CTA. Read from the
 * source rather than listed, so an accent control added with a fade of its
 * own is measured below without anyone remembering to add a row.
 */
const ACCENT_HOVER_SITES = walk(SRC).flatMap((path) => {
  const source = readFileSync(path, "utf8");
  const file = relative(SRC, path).split(/[\\/]/).join("/");
  return [...source.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)]
    .map((m) => ({ classes: m[1] ?? m[2], index: m.index }))
    .filter(
      ({ classes }) =>
        /(?:^|\s)(?:hover:)?bg-accent(?=\s|$)/.test(classes) && /(?:^|\s)hover:/.test(classes),
    )
    .map(({ classes, index }) => ({
      site: `${file}:${source.slice(0, index).split("\n").length}`,
      classes,
    }));
});

/**
 * The label and the fill `classes` paint while hovered over `base`: the
 * hover's own fill and label if it names them, then its filter, then its
 * opacity, which is the order CSS applies them in. A hover utility this does
 * not model throws, so a new kind of hover is a decision made here rather
 * than a silent pass. Shadows paint outside the box and are skipped.
 */
function hoveredPair(
  classes: string,
  tokens: Record<string, string>,
  base: string,
): { label: string; fill: string } {
  const list = classes.split(/\s+/).filter(Boolean);
  const colour = (prefix: string) =>
    list
      .map((u) => u.match(new RegExp(`^${prefix}([a-z-]+)$`))?.[1])
      .find((name) => name !== undefined && `--color-${name}` in tokens);
  const fillName = colour("hover:bg-") ?? colour("bg-");
  const labelName = colour("hover:text-") ?? colour("text-");
  if (!fillName || !labelName) throw new Error(`No fill or label colour in "${classes}"`);
  let fill = tokens[`--color-${fillName}`];
  let label = tokens[`--color-${labelName}`];
  let brightness = 1;
  let opacity = 1;
  for (const u of list.filter((u) => u.startsWith("hover:"))) {
    const filter = u.match(/^hover:brightness-(\d+)$/);
    const fade = u.match(/^hover:opacity-(\d+)$/);
    if (filter) brightness = Number(filter[1]) / 100;
    else if (fade) opacity = Number(fade[1]) / 100;
    else if (u === `hover:bg-${fillName}` || u === `hover:text-${labelName}`) continue;
    else if (!u.startsWith("hover:shadow-")) throw new Error(`Unmodelled hover "${u}"`);
  }
  [fill, label] = [brighten(fill, brightness), brighten(label, brightness)];
  return { label: compositeOver(opacity, base, label), fill: compositeOver(opacity, base, fill) };
}

/** Inside (app): the stored hex, and the three tokens the layout derives from it. */
function signedIn(scheme: "dark" | "light", T: Record<string, string>, preset: string) {
  return {
    ...T,
    "--color-accent": preset,
    "--color-accent-fg": readableForeground(preset).color,
    "--color-accent-hover": readableHover(preset),
    "--color-accent-ink": accentInkFor(scheme, preset),
  };
}

/**
 * A hovered accent control's label, over each backdrop a Button sits on.
 * Every solid accent fill hovers with `hover:bg-accent-hover`, an OPAQUE fill,
 * so the backdrop cannot reach the pixels. It replaced `hover:opacity-90`,
 * which let the backdrop through and took #ef4444, #3b82f6 and #64748b below
 * 4.5:1, and DoseActionForm's `hover:brightness-110`, which took #64748b to
 * 4.03:1. Inside (app) the fill is the user's preset with the accent-fg and
 * accent-hover the layout derives from it, so every preset is measured, not
 * just the @theme default; logged-out pages run the @theme pair, measured
 * too. The backdrops are still walked because `hoveredPair` composites
 * whatever opacity the classes leave, so a fade put back fails here.
 */
describe.each(SCHEMES)("$name — a hovered accent fill keeps a legible label", ({ name, T }) => {
  const glass = alphaOf(T["--color-glass"]);
  const BACKDROPS: Record<HoverBackdrop, string> = {
    page: T["--color-surface"],
    card: compositeOver(glass.alpha, T["--color-surface"], glass.overlay),
    dialog: T["--color-surface-raised"],
  };
  const CONTEXTS: [string, Record<string, string>][] = [
    ["the @theme pair", T],
    ...readAccentPresets().map(
      (preset) => [`preset ${preset}`, signedIn(name, T, preset)] as [string, typeof T],
    ),
  ];

  for (const { site, classes } of ACCENT_HOVER_SITES) {
    for (const [context, tokens] of CONTEXTS) {
      it(`${site} with ${context}, over every backdrop`, () => {
        for (const where of HOVER_BACKDROPS) {
          const { label, fill } = hoveredPair(classes, tokens, BACKDROPS[where]);
          const ratio = contrastRatio(label, fill);
          expect(
            ratio,
            `hovered "${classes}" paints ${label} on ${fill} over ${where}: ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  // A hover must still look like one: as far from the fill as the logged-out
  // #4f46e5 to #4338ca step, near enough (1.26:1), and not the fill itself.
  it("moves every preset's hover visibly off its fill", () => {
    for (const preset of readAccentPresets()) {
      const ratio = contrastRatio(readableHover(preset), preset);
      expect(ratio, `${preset} hovers to ${readableHover(preset)}`).toBeGreaterThanOrEqual(1.1);
    }
    expect(contrastRatio(T["--color-accent-hover"], T["--color-accent"])).toBeGreaterThanOrEqual(
      1.1,
    );
  });

  it("danger brightened to 110%", () => {
    const ratio = contrastRatio(
      brighten(T["--color-danger-fg"], 1.1),
      brighten(T["--color-danger"], 1.1),
    );
    expect(ratio, `hovered danger is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

it("finds the accent buttons it measures, and every one parses", () => {
  const files = new Set(ACCENT_HOVER_SITES.map(({ site }) => site.replace(/:\d+$/, "")));
  for (const file of [
    "lib/components/ui/Button.svelte",
    "lib/components/DoseEditForm.svelte",
    "lib/components/dashboard/DoseActionForm.svelte",
  ]) {
    expect(files, `${file} has no accent hover`).toContain(file);
  }
  for (const { classes } of ACCENT_HOVER_SITES) {
    expect(() => hoveredPair(classes, DARK, DARK["--color-surface"])).not.toThrow();
  }
});

// Guard the guard: the two hovers the accent fills used to have, measured by
// the same painter, fail for #64748b. Without these the sweep above could be
// passing because hoveredPair stopped modelling a fade or a filter.
it("would have failed #64748b's hover:opacity-90 over a light page", () => {
  const { label, fill } = hoveredPair(
    "bg-accent text-accent-fg hover:opacity-90",
    signedIn("light", LIGHT, "#64748b"),
    LIGHT["--color-surface"],
  );
  expect(contrastRatio(label, fill)).toBeLessThan(4.5);
});

it("would have failed #64748b's hover:brightness-110 on the dashboard's Log now", () => {
  const { label, fill } = hoveredPair(
    "bg-accent text-accent-fg hover:brightness-110",
    signedIn("dark", DARK, "#64748b"),
    DARK["--color-surface"],
  );
  expect(contrastRatio(label, fill)).toBeLessThan(4.5);
});

// Guard the guard: 90% opacity, the hover danger first had, fails in a dark dialog.
it("would have failed danger at 90% opacity in a dark dialog", () => {
  const dialog = DARK["--color-surface-raised"];
  const ratio = contrastRatio(
    compositeOver(0.9, dialog, DARK["--color-danger-fg"]),
    compositeOver(0.9, dialog, DARK["--color-danger"]),
  );
  expect(ratio).toBeLessThan(4.5);
});

// Guard the guard: the Refills row's old hover, 90% opacity on the whole
// row, took its amber label below AA in light. That is why it hovers with
// glass-hover instead ("refillsRowHover" below).
it("would have failed a Refills row's amber label at 90% opacity in light", () => {
  const surface = LIGHT["--color-surface"];
  const fill = fillOf(TONE_CLASSES["needs-you"].alert)!;
  const row = compositeOver(fill.alpha, surface, LIGHT[fill.token]);
  const ratio = contrastRatio(
    compositeOver(0.9, surface, LIGHT[inkOf(TONE_CLASSES["needs-you"].text)]),
    compositeOver(0.9, surface, row),
  );
  expect(ratio).toBeLessThan(4.5);
});

/**
 * Tinted chips are not rendered on the opaque surfaces above: a chip paints a
 * fraction of its own fill over whatever is behind it, which lightens the
 * backdrop and costs the foreground contrast. Nothing asserted that, so live
 * combinations were sitting below 4.5 while every token passed on its own.
 *
 * Every status tone the owner can produce, over every backdrop its element is
 * really drawn on. The pairs are READ from TONE_CLASSES, not restated, so an
 * opacity tuned in status-tone.ts is re-measured here, and a tone or element
 * added there is measured without anyone remembering to add a row. That is
 * how the happened chip came to be /10: at /15 it is 4.33:1 on a hovered card
 * in dark.
 *
 * `bar` and `border` have no rows. Neither carries text, and the word or glyph
 * beside them carries the status. WCAG 1.4.11 asks 3:1 of a graphic only when
 * it is the sole carrier. The neutral bar's border-strong already clears 3:1
 * on every surface in the control-boundary describe below.
 *
 * Text on opaque surfaces and on a resting card is already in the text-token
 * table above (surfaces() includes surface-raised and glass-on-surface), so
 * `text` adds only glass-hover over the page, which surfaces() does not
 * composite: a hovered card, and a hovered Refills row, whose hover replaces
 * its tint.
 */
describe.each(SCHEMES)(
  "$name — every status tone is legible over the backdrops its element is drawn on",
  ({ T }) => {
    const glass = alphaOf(T["--color-glass"]);
    const glassHover = alphaOf(T["--color-glass-hover"]);
    const card = compositeOver(glass.alpha, T["--color-surface"], glass.overlay);
    const cardHover = compositeOver(glassHover.alpha, T["--color-surface"], glassHover.overlay);
    const modalGlass = compositeOver(glass.alpha, T["--color-surface-raised"], glass.overlay);

    // [backdrop, hex, the component that really draws this element there].
    const BACKDROPS: Record<"chip" | "marker" | "alert" | "text", [string, string, string][]> = {
      chip: [
        ["card", card, "MedicationCard refill chip; Log row status and side-effect chips"],
        ["cardHover", cardHover, "the same rows hovered (both carry hover:bg-glass-hover)"],
        ["modalGlass", modalGlass, "SideEffectPicker severity chip in the DoseEditForm modal"],
      ],
      marker: [["card", card, "StatusMarker in a DueCard <li> and in the Done card"]],
      alert: [
        ["card", card, "a banner inside a GlassCard or the auth card"],
        [
          "surface",
          T["--color-surface"],
          "a banner on the page itself (notifications' saved line)",
        ],
        [
          "surface-raised",
          T["--color-surface-raised"],
          "DoseEditForm's and DestructiveConfirm's error, in the Modal panel",
        ],
      ],
      text: [
        ["cardHover", cardHover, "a status word on a hovered Log row or medication card"],
        [
          "refillsRowHover",
          cardHover,
          "a hovered Refills row's label: hover:bg-glass-hover replaces the row's tint (refills-card-ssr pins the class)",
        ],
      ],
    };

    for (const tone of Object.keys(TONE_CLASSES) as Tone[]) {
      const c = TONE_CLASSES[tone];
      const headline = tone === "neutral" ? "--color-text-primary" : inkOf(c.text);
      const CASES: [
        element: keyof typeof BACKDROPS,
        classes: string,
        fgs: string[],
        threshold: number,
      ][] = [
        ["chip", c.chip, [inkOf(c.chip)], 4.5],
        // 3:1: the marker's foreground is a glyph in a status circle (WCAG 1.4.11).
        ["marker", c.marker, [inkOf(c.marker)], 3],
        // The headline, the icon (the tone's text), the body (text-secondary),
        // and plain text in a row boxed the same way.
        [
          "alert",
          c.alert,
          [...new Set([headline, inkOf(c.text), "--color-text-secondary", "--color-text-primary"])],
          4.5,
        ],
        ["text", "", [inkOf(c.text)], 4.5],
      ];
      for (const [element, classes, fgs, threshold] of CASES) {
        for (const [name, base, site] of BACKDROPS[element]) {
          for (const fg of fgs) {
            it(`${tone} ${element}: ${fg} over ${name} — ${site}`, () => {
              expect(T[fg], `${fg} is not defined`).toBeDefined();
              const fill = fillOf(classes);
              const bg = !fill
                ? base
                : fill.alpha === 1
                  ? T[fill.token]
                  : compositeOver(fill.alpha, base, T[fill.token]);
              const ratio = contrastRatio(T[fg], bg);
              expect(
                ratio,
                `${T[fg]} on ${bg} (${classes || "no fill"} over ${base}) is ${ratio.toFixed(2)}:1`,
              ).toBeGreaterThanOrEqual(threshold);
            });
          }
        }
      }
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

// Important Finding 2: a hover affordance guards a property this file had
// never asserted — that a hover state paints DIFFERENT pixels from the
// resting state, not that it is legible (that is what the status-tone and
// text-token tests above already cover). Floor is deliberately modest (1.02, not the
// 4.5/3 thresholds used elsewhere) — this is not a legibility check.
//
// This guards --color-surface-overlay, not --color-glass-hover. The 17
// `hover:bg-glass-hover` sites split into two real patterns: PAIRED
// elements also carry a resting `bg-glass`, and `bg-*`/`hover:bg-*` are two
// STATES of the same element, not two stacked layers — resting shows
// bg-glass (0.72 alpha), hover replaces it with glass-hover (0.4 alpha),
// both composited over the same page (--color-surface), and the lower
// alpha is simply the darker of the two (see app.css's own
// --color-glass-hover comment). That pattern is correct and untouched.
// HOVER-ONLY elements carry no resting background
// of their own and sit directly on --color-surface-raised, so on THEM
// `hover:bg-glass-hover` composites 40% white over an already-white
// surface in light mode — a literal no-op (1.000:1, asserted below) — and
// those 12 files were moved to `hover:bg-surface-overlay` instead (an
// opaque, deliberately darker/lighter token, following the precedent at
// MedicationFilterSelect.svelte:86). A test that asserted the property on
// --color-glass-hover itself would fail here regardless of that site fix —
// the token is unchanged and correctly so, since the PAIRED sites still
// depend on today's value. Asserting it on the token those HOVER-ONLY sites
// actually use is what makes this test true.
describe.each(SCHEMES)("$name — the hover-only affordance is not a no-op", ({ T }) => {
  it("--color-surface-overlay reads as a different pixel than --color-surface-raised", () => {
    const raised = T["--color-surface-raised"];
    const overlay = T["--color-surface-overlay"];
    expect(overlay, "--color-surface-overlay is not defined").toBeDefined();
    const ratio = contrastRatio(overlay, raised);
    expect(
      ratio,
      `--color-surface-overlay (${overlay}) on --color-surface-raised (${raised}) is ${ratio.toFixed(3)}:1`,
    ).toBeGreaterThanOrEqual(1.02);
  });
});
