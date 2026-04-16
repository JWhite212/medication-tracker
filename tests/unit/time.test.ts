import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeSince,
  formatTime,
  startOfDay,
  calculateDaysUntilRefill,
  formatDueIn,
  computeTimingStatus,
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
describe("formatDueIn", () => {
  it("returns 'Due now' for near-zero milliseconds", () => {
    expect(formatDueIn(0)).toBe("Due now");
    expect(formatDueIn(30_000)).toBe("Due now"); // 30 seconds
    expect(formatDueIn(-30_000)).toBe("Due now"); // -30 seconds
  });

  it("formats positive ms as 'Due in ...'", () => {
    expect(formatDueIn(45 * 60_000)).toBe("Due in 45m");
    expect(formatDueIn(2 * 60 * 60_000 + 15 * 60_000)).toBe("Due in 2h 15m");
    expect(formatDueIn(3 * 60 * 60_000)).toBe("Due in 3h");
  });

  it("formats negative ms as 'Overdue ...'", () => {
    expect(formatDueIn(-45 * 60_000)).toBe("Overdue 45m");
    expect(formatDueIn(-2 * 60 * 60_000 - 15 * 60_000)).toBe("Overdue 2h 15m");
    expect(formatDueIn(-1 * 60 * 60_000)).toBe("Overdue 1h");
  });

  it("formats exactly 1 minute", () => {
    expect(formatDueIn(60_000)).toBe("Due in 1m");
    expect(formatDueIn(-60_000)).toBe("Overdue 1m");
  });
});

describe("computeTimingStatus", () => {
  const now = new Date("2026-04-15T14:30:00Z");

  it("returns 'overdue' when lastTakenAt is null (never taken)", () => {
    const result = computeTimingStatus(8, null, now);
    expect(result.status).toBe("overdue");
    expect(result.minutesUntilDue).toBe(-1);
  });

  it("returns 'ok' when next dose is more than 1 hour away", () => {
    // Last taken 1 hour ago, interval 8 hours => next due in 7 hours
    const lastTaken = new Date("2026-04-15T13:30:00Z");
    const result = computeTimingStatus(8, lastTaken, now);
    expect(result.status).toBe("ok");
    expect(result.minutesUntilDue).toBe(7 * 60);
  });

  it("returns 'due_soon' when next dose is within 1 hour", () => {
    // Last taken 7.5 hours ago, interval 8 hours => next due in 30 min
    const lastTaken = new Date("2026-04-15T07:00:00Z");
    const result = computeTimingStatus(8, lastTaken, now);
    expect(result.status).toBe("due_soon");
    expect(result.minutesUntilDue).toBe(30);
  });

  it("returns 'due_now' when next dose is within 1 minute", () => {
    // Last taken exactly 8 hours ago => due right now
    const lastTaken = new Date("2026-04-15T06:30:00Z");
    const result = computeTimingStatus(8, lastTaken, now);
    expect(result.status).toBe("due_now");
    expect(result.minutesUntilDue).toBe(0);
  });

  it("returns 'overdue' when past due by more than 1 minute", () => {
    // Last taken 9 hours ago, interval 8 hours => overdue by 1 hour
    const lastTaken = new Date("2026-04-15T05:30:00Z");
    const result = computeTimingStatus(8, lastTaken, now);
    expect(result.status).toBe("overdue");
    expect(result.minutesUntilDue).toBe(-60);
  });

  it("handles fractional interval hours", () => {
    // Interval 0.5h (30 min), last taken 20 min ago => due in 10 min
    const lastTaken = new Date("2026-04-15T14:10:00Z");
    const result = computeTimingStatus(0.5, lastTaken, now);
    expect(result.status).toBe("due_soon");
    expect(result.minutesUntilDue).toBe(10);
  });
});
