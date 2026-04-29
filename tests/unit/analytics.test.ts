import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/db", () => ({ db: {} }));

import {
  calculateStreak,
  calculateAdherence,
  calculateOveruse,
  calculateTrend,
} from "$lib/server/analytics";

describe("calculateStreak", () => {
  it("returns 0 for empty dates", () => {
    expect(calculateStreak([])).toBe(0);
  });

  it("counts consecutive days ending today", () => {
    const today = new Date();
    const dates = [
      today.toISOString().split("T")[0],
      new Date(today.getTime() - 86400000).toISOString().split("T")[0],
      new Date(today.getTime() - 2 * 86400000).toISOString().split("T")[0],
    ];
    expect(calculateStreak(dates)).toBe(3);
  });

  it("breaks on gap", () => {
    const today = new Date();
    const dates = [
      today.toISOString().split("T")[0],
      new Date(today.getTime() - 3 * 86400000).toISOString().split("T")[0],
    ];
    expect(calculateStreak(dates)).toBe(1);
  });
});

describe("calculateAdherence", () => {
  it("returns 100% when all doses taken", () => {
    expect(calculateAdherence(7, 7)).toBe(100);
  });

  it("returns correct percentage", () => {
    expect(calculateAdherence(5, 7)).toBeCloseTo(71.4, 0);
  });

  it("returns 0 for no expected doses", () => {
    expect(calculateAdherence(0, 0)).toBe(0);
  });

  it("caps at 100% when taken exceeds expected", () => {
    expect(calculateAdherence(10, 7)).toBe(100);
    expect(calculateAdherence(20, 1)).toBe(100);
  });
});

describe("calculateOveruse", () => {
  it("is 0 when taken does not exceed expected", () => {
    expect(calculateOveruse(0, 0)).toBe(0);
    expect(calculateOveruse(5, 7)).toBe(0);
    expect(calculateOveruse(7, 7)).toBe(0);
  });

  it("reports overflow as a percentage above 100% adherence", () => {
    // 10 taken / 7 expected = 142.9% adherence -> 42.9% overuse
    expect(calculateOveruse(10, 7)).toBeCloseTo(42.9, 0);
    // 14 / 7 = 200% adherence -> 100% overuse
    expect(calculateOveruse(14, 7)).toBe(100);
  });

  it("returns 0 when expected is 0 (avoid divide-by-zero)", () => {
    expect(calculateOveruse(5, 0)).toBe(0);
  });
});

describe("calculateTrend", () => {
  it("returns up when current exceeds previous", () => {
    const result = calculateTrend(100, 80);
    expect(result.direction).toBe("up");
    expect(result.percent).toBe(25);
  });

  it("returns down when current is less than previous", () => {
    const result = calculateTrend(60, 80);
    expect(result.direction).toBe("down");
    expect(result.percent).toBe(25);
  });

  it("returns flat when both are zero", () => {
    const result = calculateTrend(0, 0);
    expect(result.direction).toBe("flat");
    expect(result.percent).toBe(0);
  });

  it("returns flat when values are equal", () => {
    const result = calculateTrend(50, 50);
    expect(result.direction).toBe("flat");
    expect(result.percent).toBe(0);
  });

  it("returns up 100% when previous is zero and current is positive", () => {
    const result = calculateTrend(10, 0);
    expect(result.direction).toBe("up");
    expect(result.percent).toBe(100);
  });

  it("returns down 100% when current drops to zero", () => {
    const result = calculateTrend(0, 50);
    expect(result.direction).toBe("down");
    expect(result.percent).toBe(100);
  });

  it("rounds percent to nearest integer", () => {
    const result = calculateTrend(10, 3);
    expect(result.direction).toBe("up");
    expect(result.percent).toBe(233);
  });
});
