import { describe, it, expect, vi } from "vitest";
import {
  getMedicationBackground,
  getReadableTextColor,
  PATTERN_OPTIONS,
} from "$lib/utils/medication-style";

describe("PATTERN_OPTIONS", () => {
  it("has 8 pattern choices", () => {
    expect(PATTERN_OPTIONS).toHaveLength(8);
  });

  it("each has id and name", () => {
    for (const opt of PATTERN_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.name).toBeTruthy();
    }
  });
});

describe("getMedicationBackground", () => {
  it("returns solid colour for single colour with solid pattern", () => {
    expect(getMedicationBackground("#6366f1", null, "solid")).toBe("#6366f1");
  });

  it("returns primary colour when secondary is null regardless of pattern", () => {
    expect(getMedicationBackground("#6366f1", null, "gradient")).toBe("#6366f1");
    expect(getMedicationBackground("#6366f1", undefined, "stripes")).toBe("#6366f1");
  });

  it("returns primary colour for solid pattern even with secondary", () => {
    expect(getMedicationBackground("#6366f1", "#ec4899", "solid")).toBe("#6366f1");
  });

  it("returns linear-gradient for gradient pattern", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "gradient");
    expect(bg).toContain("linear-gradient");
    expect(bg).toContain("#6366f1");
    expect(bg).toContain("#ec4899");
  });

  it("returns split gradient for split pattern", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "split");
    expect(bg).toContain("linear-gradient");
    expect(bg).toContain("50%");
  });

  it("returns repeating-linear-gradient for stripes", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "stripes");
    expect(bg).toContain("repeating-linear-gradient");
    expect(bg).toContain("45deg");
  });

  it("returns repeating-linear-gradient for h-stripes", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "h-stripes");
    expect(bg).toContain("repeating-linear-gradient");
    expect(bg).toContain("0deg");
  });

  it("returns radial-gradient for dots", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "dots");
    expect(bg).toContain("radial-gradient");
  });

  it("returns conic-gradient for checkerboard", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "checkerboard");
    expect(bg).toContain("conic-gradient");
  });

  it("returns radial-gradient for radial pattern", () => {
    const bg = getMedicationBackground("#6366f1", "#ec4899", "radial");
    expect(bg).toContain("radial-gradient");
    expect(bg).toContain("30%");
  });

  it("falls back to gradient for geometric patterns when small=true", () => {
    for (const pattern of ["stripes", "h-stripes", "dots", "checkerboard"]) {
      const bg = getMedicationBackground("#6366f1", "#ec4899", pattern, true);
      expect(bg).toContain("linear-gradient");
      expect(bg).toContain("135deg");
    }
  });

  it("returns primary colour for unknown pattern", () => {
    expect(getMedicationBackground("#6366f1", "#ec4899", "unknown")).toBe("#6366f1");
  });
});

describe("getReadableTextColor", () => {
  it("uses dark text on a near-white background", () => {
    expect(getReadableTextColor("#ffffff").color).toBe("#111111");
  });

  it("uses light text on a near-black background", () => {
    expect(getReadableTextColor("#000000").color).toBe("#ffffff");
  });

  it("uses dark text on light yellows where white would fail WCAG", () => {
    // Yellow #fde047 is a typical light pill colour where white text is unreadable
    expect(getReadableTextColor("#fde047").color).toBe("#111111");
  });

  it("uses light text on saturated mid-tones like indigo", () => {
    expect(getReadableTextColor("#6366f1").color).toBe("#ffffff");
  });

  it("returns the same outline shadow tone as the chosen text colour family", () => {
    const onLight = getReadableTextColor("#fde047");
    expect(onLight.color).toBe("#111111");
    expect(onLight.textShadow).toContain("rgba(255,255,255");

    const onDark = getReadableTextColor("#1e1b4b");
    expect(onDark.color).toBe("#ffffff");
    expect(onDark.textShadow).toContain("rgba(0,0,0");
  });

  it("considers both colours for split/gradient pills and picks the safer fg", () => {
    // Light yellow + dark navy on a non-solid pattern: white fails on yellow,
    // dark fails on navy. Either choice is imperfect, but the function must
    // return a stable hex.
    const fg = getReadableTextColor("#fde047", "#1e1b4b", "split");
    expect(["#111111", "#ffffff"]).toContain(fg.color);
    expect(fg.textShadow).toMatch(/rgba\(/);
  });

  it("ignores secondary colour when pattern is solid (matches getMedicationBackground)", () => {
    // Light yellow primary + dark navy secondary on solid: only yellow renders,
    // so contrast must be computed against yellow alone → dark text.
    const fg = getReadableTextColor("#fde047", "#1e1b4b", "solid");
    expect(fg.color).toBe("#111111");
  });

  it("uses secondary colour for non-solid patterns", () => {
    // Same colours on a stripes pattern: both render, so the safer fg differs
    // from the solid case (white instead of dark).
    const solid = getReadableTextColor("#fde047", "#1e1b4b", "solid");
    const stripes = getReadableTextColor("#fde047", "#1e1b4b", "stripes");
    expect(solid.color).toBe("#111111");
    expect(stripes.color).not.toBe(solid.color);
  });

  it("treats null/undefined secondary as single-colour", () => {
    expect(getReadableTextColor("#6366f1", null).color).toBe("#ffffff");
    expect(getReadableTextColor("#6366f1", undefined).color).toBe("#ffffff");
  });

  it("supports 3-digit hex shorthand", () => {
    expect(getReadableTextColor("#fff").color).toBe("#111111");
    expect(getReadableTextColor("#000").color).toBe("#ffffff");
  });

  it("does not throw on invalid hex input and returns a stable fallback", () => {
    // Invalid hex falls back to luminance 0 (black) → white text. Function must
    // not throw and must always return a usable foreground + outlined shadow.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const bad of ["not-a-hex", "", "#zzz", "#12", "rgb(0,0,0)", "blue"]) {
        let fg!: { color: string; textShadow: string; hoverOverlay: string };
        expect(() => {
          fg = getReadableTextColor(bad);
        }).not.toThrow();
        expect(["#111111", "#ffffff"]).toContain(fg.color);
        expect(fg.textShadow).toMatch(/rgba\(/);
        expect(fg.hoverOverlay).toMatch(/rgba\(/);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns a darken hover overlay for light pills (visible on white/yellow)", () => {
    // Light pill → dark text → hover should darken (rgba(0,0,0,...)) so it
    // remains visible on a near-white background where a white overlay would
    // disappear into the pill colour.
    expect(getReadableTextColor("#fde047").hoverOverlay).toContain("rgba(0,0,0");
    expect(getReadableTextColor("#ffffff").hoverOverlay).toContain("rgba(0,0,0");
  });

  it("returns a lighten hover overlay for dark pills (visible on indigo/navy)", () => {
    // Dark pill → white text → hover should lighten so it shows up against a
    // dark background.
    expect(getReadableTextColor("#1e1b4b").hoverOverlay).toContain("rgba(255,255,255");
    expect(getReadableTextColor("#6366f1").hoverOverlay).toContain("rgba(255,255,255");
  });
});
