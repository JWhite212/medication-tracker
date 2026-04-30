import { describe, it, expect } from "vitest";
import { buildSparklineShape } from "$lib/utils/sparkline";

describe("buildSparklineShape", () => {
  it("returns empty shape for empty values", () => {
    const s = buildSparklineShape([], 80, 24);
    expect(s.line).toBe("");
    expect(s.area).toBe("");
    expect(s.dotX).toBeNull();
    expect(s.dotY).toBeNull();
  });

  it("returns a centred dot for a single value", () => {
    const s = buildSparklineShape([5], 80, 24);
    expect(s.line).toBe("");
    expect(s.area).toBe("");
    expect(s.dotX).toBe(40);
    expect(s.dotY).toBe(12);
  });

  it("draws a flat horizontal line when all values equal", () => {
    const s = buildSparklineShape([5, 5, 5], 80, 24);
    expect(s.line).toBe("M 0 12 L 40 12 L 80 12");
    expect(s.area).toContain("L 80 24 L 0 24 Z");
    expect(s.dotX).toBeNull();
    expect(s.dotY).toBeNull();
  });

  it("draws a varying line for distinct values", () => {
    const s = buildSparklineShape([1, 5, 3, 8, 2], 80, 24);
    expect(s.line).toMatch(/^M 0 \d/);
    expect(s.line).toContain("L 20 ");
    expect(s.line).toContain("L 40 ");
    expect(s.line).toContain("L 60 ");
    expect(s.line).toContain("L 80 ");
    // Max value (8) lands near the top of the SVG (y close to strokeWidth/2).
    expect(s.line).toContain("L 60 0.8");
  });

  it("appends a closing area path that returns to the bottom", () => {
    const s = buildSparklineShape([1, 5, 3, 8, 2], 80, 24);
    expect(s.area.endsWith("L 80 24 L 0 24 Z")).toBe(true);
  });

  it("respects custom width and height", () => {
    const s = buildSparklineShape([0, 10], 100, 40);
    expect(s.line).toBe("M 0 39.3 L 100 0.8");
  });
});
