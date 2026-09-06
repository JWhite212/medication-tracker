import { describe, it, expect } from "vitest";
import {
  relativeLuminance,
  contrastRatio,
  compositeOver,
  readableForeground,
  readableInk,
  INK_BACKDROP,
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
