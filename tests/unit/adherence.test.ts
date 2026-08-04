import { describe, it, expect } from "vitest";
import { expectedWeeklyDoses, adherencePercent } from "$lib/utils/adherence";

describe("expectedWeeklyDoses", () => {
  it("uses the schedule-aware daily rate when available", () => {
    // Twice-daily fixed-time med: 2/day → 14/week. The old inline card
    // math defaulted to 24h (once daily) because the legacy interval
    // column is null for fixed-time schedules.
    expect(expectedWeeklyDoses(2, null)).toBe(14);
  });

  it("handles daysOfWeek-weighted rates", () => {
    // Mon/Wed/Fri once daily → 3/7 per day → 3/week.
    expect(expectedWeeklyDoses(3 / 7, "24")).toBe(3);
  });

  it("falls back to the legacy interval column when no schedule rate exists", () => {
    expect(expectedWeeklyDoses(null, "12")).toBe(14);
  });

  it("defaults to once daily when neither source is available", () => {
    expect(expectedWeeklyDoses(null, null)).toBe(7);
  });
});

describe("adherencePercent", () => {
  it("reports 50% for half the expected doses", () => {
    expect(adherencePercent(7, 14)).toBe(50);
  });

  it("reports 100% for full adherence and caps overshoot", () => {
    expect(adherencePercent(7, 7)).toBe(100);
    expect(adherencePercent(20, 14)).toBe(100);
  });

  it("returns 0 when nothing is expected", () => {
    expect(adherencePercent(5, 0)).toBe(0);
  });
});
