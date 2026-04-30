import { describe, it, expect } from "vitest";
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
    // Light yellow + dark navy: white fails on yellow, dark fails on navy.
    // Either choice is imperfect, but the function must return a stable hex.
    const fg = getReadableTextColor("#fde047", "#1e1b4b");
    expect(["#111111", "#ffffff"]).toContain(fg.color);
    expect(fg.textShadow).toMatch(/rgba\(/);
  });

  it("treats null/undefined secondary as single-colour", () => {
    expect(getReadableTextColor("#6366f1", null).color).toBe("#ffffff");
    expect(getReadableTextColor("#6366f1", undefined).color).toBe("#ffffff");
  });

  it("supports 3-digit hex shorthand", () => {
    expect(getReadableTextColor("#fff").color).toBe("#111111");
    expect(getReadableTextColor("#000").color).toBe("#ffffff");
  });
});
