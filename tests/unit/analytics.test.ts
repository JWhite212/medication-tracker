import { describe, it, expect, vi } from "vitest";

vi.mock("$lib/server/db", () => ({ db: {} }));

import { calculateStreak, calculateAdherence } from "$lib/server/analytics";

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
});
