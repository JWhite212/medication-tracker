import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeSince,
  formatTime,
  startOfDay,
  calculateDaysUntilRefill,
} from "$lib/utils/time";

describe("formatTimeSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T14:30:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats seconds ago", () => {
    const thirtySecsAgo = new Date("2026-04-15T14:29:30Z");
    expect(formatTimeSince(thirtySecsAgo)).toBe("just now");
  });

  it("formats minutes ago", () => {
    const fiveMinsAgo = new Date("2026-04-15T14:25:00Z");
    expect(formatTimeSince(fiveMinsAgo)).toBe("5m ago");
  });

  it("formats hours and minutes ago", () => {
    const twoHoursAgo = new Date("2026-04-15T12:00:00Z");
    expect(formatTimeSince(twoHoursAgo)).toBe("2h 30m ago");
  });

  it("formats days ago", () => {
    const twoDaysAgo = new Date("2026-04-13T14:30:00Z");
    expect(formatTimeSince(twoDaysAgo)).toBe("2d ago");
  });

  it("formats exact hours", () => {
    const oneHourAgo = new Date("2026-04-15T13:30:00Z");
    expect(formatTimeSince(oneHourAgo)).toBe("1h 0m ago");
  });
});

describe("formatTime", () => {
  it("formats time in 12-hour format", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "UTC");
    expect(result).toBe("2:30 PM");
  });

  it("formats time with timezone", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "America/New_York");
    expect(result).toBe("10:30 AM");
  });
});

describe("startOfDay", () => {
  it("returns midnight in given timezone", () => {
    const result = startOfDay(new Date("2026-04-15T14:30:00Z"), "UTC");
    expect(result.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});

describe("calculateDaysUntilRefill", () => {
  it("calculates days from inventory and average consumption", () => {
    expect(calculateDaysUntilRefill(60, 2)).toBe(30);
  });

  it("floors partial days", () => {
    expect(calculateDaysUntilRefill(10, 3)).toBe(3);
  });

  it("returns null when inventory is null", () => {
    expect(calculateDaysUntilRefill(null, 2)).toBeNull();
  });

  it("returns null when consumption is zero", () => {
    expect(calculateDaysUntilRefill(30, 0)).toBeNull();
  });

  it("returns null when consumption is negative", () => {
    expect(calculateDaysUntilRefill(30, -1)).toBeNull();
  });

  it("returns 0 when inventory is less than daily consumption", () => {
    expect(calculateDaysUntilRefill(1, 5)).toBe(0);
  });
});
