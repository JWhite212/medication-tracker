import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/db", () => ({ db: {} }));

import {
  calculateStreak,
  calculateAdherence,
  calculateOveruse,
  calculateTrend,
  buildInsights,
} from "$lib/server/analytics";
import type { InsightInputs } from "$lib/server/analytics";

const baseInputs: InsightInputs = {
  totalDoses: 0,
  prevTotalDoses: 0,
  avgAdherence: 0,
  prevAvgAdherence: 0,
  medStats: [],
  dayOfWeek: [],
  hourly: [],
  sideEffectsCount: 0,
  topSideEffect: null,
  refillCriticalCount: 0,
  streak: 0,
};

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

describe("buildInsights", () => {
  it("returns empty array when there is no data", () => {
    expect(buildInsights(baseInputs)).toEqual([]);
  });

  it("emits adherence-trend when previous data exists and delta exceeds 5", () => {
    const insights = buildInsights({
      ...baseInputs,
      avgAdherence: 80,
      prevAvgAdherence: 65,
      medStats: [
        { medicationName: "A", adherence: 80, expectedTotal: 30 },
        { medicationName: "B", adherence: 80, expectedTotal: 30 },
      ],
    });
    expect(insights.find((i) => i.id === "adherence-trend")).toMatchObject({
      severity: "positive",
      text: expect.stringContaining("improved 15%"),
    });
  });

  it("does not emit adherence-trend when delta is below 5", () => {
    const insights = buildInsights({
      ...baseInputs,
      avgAdherence: 80,
      prevAvgAdherence: 78,
      medStats: [
        { medicationName: "A", adherence: 80, expectedTotal: 30 },
        { medicationName: "B", adherence: 80, expectedTotal: 30 },
      ],
    });
    expect(insights.find((i) => i.id === "adherence-trend")).toBeUndefined();
  });

  it("emits highest and lowest adherence insights when 2+ meds with data", () => {
    const insights = buildInsights({
      ...baseInputs,
      medStats: [
        { medicationName: "Best", adherence: 95, expectedTotal: 30 },
        { medicationName: "Worst", adherence: 50, expectedTotal: 30 },
      ],
    });
    expect(insights.find((i) => i.id === "highest-adherence-med")?.text).toContain("Best");
    expect(insights.find((i) => i.id === "lowest-adherence-med")?.text).toContain("Worst");
  });

  it("does not emit lowest insight when bottom adherence is healthy", () => {
    const insights = buildInsights({
      ...baseInputs,
      medStats: [
        { medicationName: "A", adherence: 95, expectedTotal: 30 },
        { medicationName: "B", adherence: 90, expectedTotal: 30 },
      ],
    });
    expect(insights.find((i) => i.id === "lowest-adherence-med")).toBeUndefined();
  });

  it("emits peak-hour when one hour holds 30%+ of doses", () => {
    const insights = buildInsights({
      ...baseInputs,
      hourly: [
        { hour: 8, count: 5 },
        { hour: 12, count: 1 },
        { hour: 20, count: 1 },
      ],
    });
    expect(insights.find((i) => i.id === "peak-hour")?.text).toContain("08:00");
  });

  it("emits streak when streak >= 3", () => {
    const insights = buildInsights({ ...baseInputs, streak: 7 });
    expect(insights.find((i) => i.id === "streak")?.text).toContain("7 days");
  });

  it("emits side-effects insight when count >= 3", () => {
    const insights = buildInsights({
      ...baseInputs,
      sideEffectsCount: 5,
      topSideEffect: "Drowsiness",
    });
    expect(insights.find((i) => i.id === "side-effects")?.text).toContain("Drowsiness");
  });

  it("orders warnings before positive before info, and slices to 5", () => {
    const insights = buildInsights({
      ...baseInputs,
      avgAdherence: 60,
      prevAvgAdherence: 80,
      medStats: [
        { medicationName: "A", adherence: 95, expectedTotal: 30 },
        { medicationName: "B", adherence: 50, expectedTotal: 30 },
      ],
      hourly: [
        { hour: 8, count: 5 },
        { hour: 12, count: 1 },
      ],
      sideEffectsCount: 4,
      topSideEffect: "Nausea",
      refillCriticalCount: 2,
      streak: 5,
    });
    expect(insights.length).toBeLessThanOrEqual(5);
    expect(insights[0].severity).toBe("warning");
  });
});
