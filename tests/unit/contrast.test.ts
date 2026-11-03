import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  compositeOver,
  readableForeground,
  readableHover,
  readableInk,
  INK_BACKDROP,
  INK_BACKDROP_LIGHT,
  READABLE_DARK,
  READABLE_LIGHT,
} from "$lib/utils/contrast";

describe("relativeLuminance", () => {
  it("returns 0 for black and 1 for white", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });

  it("expands three-digit hex", () => {
    expect(relativeLuminance("#fff")).toBeCloseTo(relativeLuminance("#ffffff"), 10);
  });

  it("returns 0 for an invalid hex rather than NaN", () => {
    expect(relativeLuminance("not-a-colour")).toBe(0);
  });
});

describe("contrastRatio", () => {
  it("is 21:1 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 2);
  });

  it("is 1:1 for a colour against itself", () => {
    expect(contrastRatio("#6366f1", "#6366f1")).toBeCloseTo(1, 10);
  });

  it("reproduces the measured accent-fg failure this PR fixes", () => {
    // #6366f1 is the pre-1a accent; neither foreground clears 4.5:1.
    expect(contrastRatio("#ffffff", "#6366f1")).toBeLessThan(4.5);
    expect(contrastRatio(READABLE_DARK, "#6366f1")).toBeLessThan(4.5);
  });
});

describe("compositeOver", () => {
  it("composites white alpha over a base colour", () => {
    // --color-glass is rgba(255,255,255,0.08) over --color-surface-raised.
    expect(compositeOver(0.08, "#12121a")).toBe("#25252c");
  });

  it("returns the base unchanged at zero alpha", () => {
    expect(compositeOver(0, "#12121a")).toBe("#12121a");
  });

  it("returns white at full alpha", () => {
    expect(compositeOver(1, "#12121a")).toBe("#ffffff");
  });

  it("composites a tinted overlay when one is given", () => {
    // bg-danger/20 over the modal panel's glass.
    expect(compositeOver(0.2, "#25252c", "#ef4444")).toBe("#4d2b31");
    // The default overlay is still white.
    expect(compositeOver(0.2, "#25252c", "#ffffff")).toBe(compositeOver(0.2, "#25252c"));
  });
});

/**
 * Behaviour of the derivation only. Whether it holds for the ten swatches a
 * user can actually pick is asserted in theme-tokens.test.ts, which parses
 * both the preset list and the surfaces out of the source rather than
 * restating them here.
 */
describe("readableInk", () => {
  it("leaves a colour that is already legible alone", () => {
    // Amber needs no lightening: it is 5.84:1 on the lightest surface.
    expect(readableInk("#f59e0b")).toBe("#f59e0b");
  });

  it("lightens a dark accent rather than returning a fixed hue", () => {
    const ink = readableInk("#4f46e5");
    expect(ink).not.toBe("#4f46e5");
    expect(ink).not.toBe(READABLE_LIGHT);
    expect(contrastRatio("#4f46e5", INK_BACKDROP)).toBeLessThan(4.5);
    expect(contrastRatio(ink, INK_BACKDROP)).toBeGreaterThanOrEqual(4.5);
  });

  it("stops at the first candidate that clears the target", () => {
    // One step less lightening must fail, or the ink is lighter than needed.
    const ink = readableInk("#4f46e5");
    const steps = [...Array(101).keys()].map((s) => compositeOver(s / 100, "#4f46e5"));
    const index = steps.indexOf(ink);
    expect(index).toBeGreaterThan(0);
    expect(contrastRatio(steps[index - 1], INK_BACKDROP)).toBeLessThan(4.5);
  });

  it("falls back to white ink for an invalid hex instead of NaN", () => {
    expect(readableInk("not-a-colour")).toBe(READABLE_LIGHT);
  });

  it("solves against the lightest surface, where light text is worst off", () => {
    // The darkest surface is the easy end: solving there would ship an ink
    // that fails on glass. #8f92f5 is 7.15:1 on #0a0a0f but 4.54:1 here.
    expect(INK_BACKDROP).toBe(compositeOver(0.14, "#12121a"));
    expect(contrastRatio("#8f92f5", "#0a0a0f")).toBeGreaterThan(
      contrastRatio("#8f92f5", INK_BACKDROP),
    );
  });
});

describe("readableForeground", () => {
  it("picks dark text on a light background", () => {
    expect(readableForeground("#f59e0b").color).toBe(READABLE_DARK);
  });

  it("picks light text on a dark background", () => {
    expect(readableForeground("#0a0a0f").color).toBe(READABLE_LIGHT);
  });

  it("reports the achieved ratio so callers can warn on a failure", () => {
    const { ratio } = readableForeground("#6366f1");
    expect(ratio).toBeGreaterThan(4);
    expect(ratio).toBeLessThan(4.5);
  });
});

/**
 * Behaviour of the derivation only; every preset, scheme and backdrop is
 * measured in theme-tokens.test.ts.
 */
describe("readableHover", () => {
  it("darkens a fill under a white label, 15% of the way to the dark pole", () => {
    expect(readableForeground("#4f46e5").color).toBe(READABLE_LIGHT);
    expect(readableHover("#4f46e5")).toBe(compositeOver(0.15, "#4f46e5", READABLE_DARK));
  });

  it("lightens a fill under a dark label, 15% of the way to white", () => {
    expect(readableForeground("#f59e0b").color).toBe(READABLE_DARK);
    expect(readableHover("#f59e0b")).toBe(compositeOver(0.15, "#f59e0b", READABLE_LIGHT));
  });

  it("moves away from the label, so the label gains contrast", () => {
    for (const fill of ["#4f46e5", "#f59e0b", "#64748b", "#ef4444"]) {
      const label = readableForeground(fill).color;
      expect(contrastRatio(label, readableHover(fill))).toBeGreaterThan(contrastRatio(label, fill));
    }
  });

  it("goes past the first step only as far as the target needs", () => {
    // #64748b reaches 5.91:1 at the first step, short of a 7:1 target.
    const hover = readableHover("#64748b", { target: 7 });
    const steps = [...Array(101).keys()].map((s) =>
      compositeOver(s / 100, "#64748b", READABLE_DARK),
    );
    const index = steps.indexOf(hover);
    expect(index).toBeGreaterThan(15);
    expect(contrastRatio(READABLE_LIGHT, hover)).toBeGreaterThanOrEqual(7);
    expect(contrastRatio(READABLE_LIGHT, steps[index - 1])).toBeLessThan(7);
  });

  it("keeps the label at 4.5:1 on any fill, including those no label clears at rest", () => {
    // Every 17th value per channel, plus the greys where the two labels tie
    // (about 4.34:1 each): the fills readableForeground cannot make legible.
    const fills = [0, 17, 34, 51, 68, 85, 102, 119, 136, 153, 170, 187, 204, 221, 238, 255]
      .flatMap((r, _, all) => all.flatMap((g) => all.map((b) => [r, g, b])))
      .concat([...Array(40).keys()].map((i) => [100 + i, 100 + i, 100 + i]))
      .map((rgb) => "#" + rgb.map((c) => c.toString(16).padStart(2, "0")).join(""));
    expect(fills.some((f) => readableForeground(f).ratio < 4.5)).toBe(true);
    for (const fill of fills) {
      const ratio = contrastRatio(readableForeground(fill).color, readableHover(fill));
      expect(ratio, `${fill} hovers at ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("returns the far pole for an invalid hex instead of throwing", () => {
    expect(readableHover("not-a-colour")).toBe(READABLE_DARK);
  });
});

describe("compositeOver rejects non-hex input", () => {
  // Without this guard compositeOver("garbage") returns "#23c1NaN",
  // relativeLuminance rejects it and returns 0, and contrastRatio then
  // reports ~21:1 — so a mis-parsed light token makes an assertion PASS.
  it("throws on a malformed base", () => {
    expect(() => compositeOver(0.1, "garbage")).toThrow(/not a hex colour/i);
  });

  it("throws on a malformed overlay", () => {
    expect(() => compositeOver(0.1, "#ffffff", "nope")).toThrow(/not a hex colour/i);
  });
});

describe("readableInk darkens for a light scheme", () => {
  it("solves against the darkest light surface by darkening toward black", () => {
    const ink = readableInk("#f59e0b", {
      backdrop: INK_BACKDROP_LIGHT,
      overlay: READABLE_DARK,
    });
    expect(ink).toBe("#8c5d0e");
    expect(contrastRatio(ink, INK_BACKDROP_LIGHT)).toBeGreaterThanOrEqual(4.5);
  });

  it("leaves an accent that is already legible on light untouched", () => {
    expect(readableInk("#4f46e5", { backdrop: INK_BACKDROP_LIGHT, overlay: READABLE_DARK })).toBe(
      "#4f46e5",
    );
  });

  it("still lightens for the dark scheme by default", () => {
    const ink = readableInk("#4f46e5");
    expect(contrastRatio(ink, INK_BACKDROP)).toBeGreaterThanOrEqual(4.5);
  });
});
