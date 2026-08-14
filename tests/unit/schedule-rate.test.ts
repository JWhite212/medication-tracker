import { describe, it, expect } from "vitest";
import {
  MAX_INTERVAL_HOURS,
  parseIntervalHours,
  intervalDosesPerDay,
} from "$lib/utils/schedule-rate";

describe("parseIntervalHours", () => {
  it("parses a positive integer string, the shape Drizzle returns", () => {
    expect(parseIntervalHours("8")).toBe(8);
  });

  it("parses a decimal string, because a numeric column can carry one", () => {
    expect(parseIntervalHours("12.5")).toBe(12.5);
  });

  it("parses a plain number, for callers that already converted", () => {
    expect(parseIntervalHours(6)).toBe(6);
  });

  it("REJECTS the string zero — the defect this module exists for", () => {
    // `"0"` is truthy, so the old guard `if (!intervalHours)` let it through
    // and computeOverdueSlot reported a dose overdue the instant it was logged.
    expect(parseIntervalHours("0")).toBeNull();
  });

  it("rejects a negative interval", () => {
    expect(parseIntervalHours("-4")).toBeNull();
  });

  it("rejects null, undefined and the empty string", () => {
    expect(parseIntervalHours(null)).toBeNull();
    expect(parseIntervalHours(undefined)).toBeNull();
    expect(parseIntervalHours("")).toBeNull();
  });

  it("rejects a non-numeric string", () => {
    expect(parseIntervalHours("every 8 hours")).toBeNull();
  });

  it("ACCEPTS a value above MAX_INTERVAL_HOURS — the cap is a door policy", () => {
    // 168h is a weekly injection. Stored rows predate the bound and must keep
    // producing a rate; rejecting on read would drop the medication out of
    // refill forecasting, out of adherence and out of reminders.
    expect(parseIntervalHours("168")).toBe(168);
  });
});

describe("intervalDosesPerDay", () => {
  it("computes 24 / hours", () => {
    expect(intervalDosesPerDay("24")).toBe(1);
    expect(intervalDosesPerDay("12")).toBe(2);
    expect(intervalDosesPerDay("8")).toBeCloseTo(3, 5);
  });

  it("returns 0 for an unusable interval rather than Infinity", () => {
    expect(intervalDosesPerDay("0")).toBe(0);
    expect(intervalDosesPerDay(null)).toBe(0);
  });

  it("returns a sub-daily rate for an interval above the door cap", () => {
    expect(intervalDosesPerDay("168")).toBeCloseTo(1 / 7, 5);
  });
});

describe("MAX_INTERVAL_HOURS", () => {
  it("is 72, the bound both strict doors have always enforced", () => {
    expect(MAX_INTERVAL_HOURS).toBe(72);
  });
});
