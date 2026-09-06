// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio, compositeOver, readableForeground } from "$lib/utils/contrast";

/**
 * Parses the real @theme block rather than duplicating the palette, so this
 * test cannot drift from the stylesheet it is guarding. If someone edits a
 * token in app.css and breaks a pair, this goes red.
 */
function readThemeTokens(): Record<string, string> {
  const cssPath = fileURLToPath(new URL("../../src/app.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  const block = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  if (!block) throw new Error("Could not find the @theme block in src/app.css");
  const tokens: Record<string, string> = {};
  for (const line of block[1].split("\n")) {
    const m = line.match(/^\s*(--[\w-]+):\s*(.+?);\s*$/);
    if (m) tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/** rgba(255,255,255,A) -> A. Throws on anything else, so a token that stops
 *  being white-alpha fails loudly instead of being silently skipped. */
function whiteAlpha(value: string): number {
  const m = value.match(/^rgba\(255,\s*255,\s*255,\s*([\d.]+)\)$/);
  if (!m) throw new Error(`Expected a white-alpha token, got: ${value}`);
  return Number(m[1]);
}

/**
 * The accent swatches offered on /settings/appearance, read from the page
 * itself. These are not @theme tokens — they are the values written to
 * `user_preferences.accent_color` and then set inline as --color-accent,
 * where they beat every stylesheet rule. Raising the @theme accent without
 * raising these left every real user on the failing pair.
 */
function readAccentPresets(): string[] {
  const path = fileURLToPath(
    new URL("../../src/routes/(app)/settings/appearance/+page.svelte", import.meta.url),
  );
  const src = readFileSync(path, "utf8");
  const block = src.match(/const presetColours = \[([\s\S]*?)\]/);
  if (!block) throw new Error("Could not find presetColours in the appearance page");
  const hexes = block[1].match(/#[0-9a-f]{6}/gi) ?? [];
  if (hexes.length === 0) throw new Error("presetColours parsed to an empty list");
  return hexes;
}

const T = readThemeTokens();

/** Every opaque surface a foreground token is actually rendered on. */
function surfaces(): Record<string, string> {
  const raised = T["--color-surface-raised"];
  return {
    surface: T["--color-surface"],
    "surface-raised": raised,
    "surface-overlay": T["--color-surface-overlay"],
    "glass-on-surface": compositeOver(whiteAlpha(T["--color-glass"]), T["--color-surface"]),
    "glass-on-raised": compositeOver(whiteAlpha(T["--color-glass"]), raised),
    "glass-hover": compositeOver(whiteAlpha(T["--color-glass-hover"]), raised),
  };
}

/**
 * Pairs knowingly shipping below threshold. Every entry needs a reason and an
 * owner. An empty list is the goal; an entry is a decision, not a shrug.
 */
const ALLOWED_BELOW_THRESHOLD: { token: string; surface: string; why: string }[] = [];

describe("@theme parsing", () => {
  it("finds the tokens it is about to assert on", () => {
    expect(T["--color-surface"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(T["--color-text-primary"]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(Object.keys(T).length).toBeGreaterThan(15);
  });
});

describe("text tokens meet 4.5:1 on every surface they render on", () => {
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
    for (const [name, bg] of Object.entries(surfaces())) {
      const allowed = ALLOWED_BELOW_THRESHOLD.some((a) => a.token === token && a.surface === name);
      it.skipIf(allowed)(`${token} on ${name}`, () => {
        expect(T[token], `${token} is not defined in @theme`).toBeDefined();
        const ratio = contrastRatio(T[token], bg);
        expect(ratio, `${T[token]} on ${bg} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});

describe("every accent preset a user can pick carries a legible foreground", () => {
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
  }
});

describe("solid fills carry a legible foreground", () => {
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

describe("control boundaries meet the 3:1 non-text minimum (WCAG 1.4.11)", () => {
  for (const [name, bg] of Object.entries(surfaces())) {
    if (name.startsWith("glass")) continue; // a control never sits on its own hover state
    it(`--color-border-strong on ${name}`, () => {
      expect(T["--color-border-strong"], "--color-border-strong is not defined").toBeDefined();
      const border = compositeOver(whiteAlpha(T["--color-border-strong"]), bg);
      const ratio = contrastRatio(border, bg);
      expect(ratio, `composites to ${border}, ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("the heatmap ramp is distinguishable step to step", () => {
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
