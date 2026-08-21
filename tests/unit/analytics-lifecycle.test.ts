import { describe, it, expect } from "vitest";
import { clampEffectiveDays, isActiveOn, lifecycleEnd } from "$lib/server/analytics/lifecycle";

const APR_15 = new Date("2026-04-15T00:00:00.000Z");
const APR_25 = new Date("2026-04-25T00:00:00.000Z");
const MAY_01 = new Date("2026-05-01T00:00:00.000Z");
const MAY_15 = new Date("2026-05-15T00:00:00.000Z");

describe("clampEffectiveDays", () => {
  it("returns full range when lifecycle fully contains it", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, null)).toBe(16);
  });

  it("clamps left edge when med started mid-range", () => {
    // Range is 16 days; med started 2026-04-25 → 6 effective days.
    expect(clampEffectiveDays(APR_15, MAY_01, APR_25, null)).toBe(6);
  });

  it("clamps right edge when med ended mid-range", () => {
    // Range is 16 days; med ended 2026-04-25 → 10 effective days.
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, APR_25)).toBe(10);
  });

  it("clamps both edges when lifecycle is interior to range", () => {
    expect(clampEffectiveDays(APR_15, MAY_15, APR_25, MAY_01)).toBe(6);
  });

  it("returns 0 when med started after the range ends", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, MAY_15, null)).toBe(0);
  });

  it("returns 0 when med ended before the range starts", () => {
    expect(clampEffectiveDays(MAY_01, MAY_15, APR_15, APR_25)).toBe(0);
  });

  it("treats endedAt = null as still active (open right edge)", () => {
    expect(clampEffectiveDays(APR_15, MAY_01, APR_15, null)).toBe(16);
  });

  it("returns 0 for a zero-width range", () => {
    expect(clampEffectiveDays(APR_15, APR_15, APR_15, null)).toBe(0);
  });
});

describe("isActiveOn", () => {
  it("is true when date is exactly at startedAt", () => {
    expect(isActiveOn(APR_25, APR_25, null)).toBe(true);
  });

  it("is false when date is before startedAt", () => {
    expect(isActiveOn(APR_15, APR_25, null)).toBe(false);
  });

  it("is true when date is between startedAt and endedAt", () => {
    expect(isActiveOn(APR_25, APR_15, MAY_01)).toBe(true);
  });

  it("is false when date is after endedAt", () => {
    expect(isActiveOn(MAY_15, APR_15, MAY_01)).toBe(false);
  });

  it("treats endedAt = null as open on the right", () => {
    expect(isActiveOn(MAY_15, APR_15, null)).toBe(true);
  });

  it("is true at the exact endedAt instant (inclusive boundary)", () => {
    expect(isActiveOn(MAY_01, APR_15, MAY_01)).toBe(true);
  });
});

describe("regression — the user-facing scenarios from the plan", () => {
  it("'med added yesterday' → today's adherence denominator is 1 day, not 30", () => {
    const today = new Date("2026-05-01T12:00:00.000Z");
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
    const yesterday = new Date(today.getTime() - 1 * 86_400_000);
    expect(clampEffectiveDays(thirtyDaysAgo, today, yesterday, null)).toBe(1);
  });

  it("'ended med' → days after endedAt don't drag adherence down", () => {
    const today = new Date("2026-05-01T12:00:00.000Z");
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86_400_000);
    const fiveDaysAgo = new Date(today.getTime() - 5 * 86_400_000);
    // Med was active for the first 25 days of the 30-day window.
    expect(clampEffectiveDays(thirtyDaysAgo, today, thirtyDaysAgo, fiveDaysAgo)).toBe(25);
  });
});

// Two columns can close a medication's window, written by different things:
// `endedAt` arrives only via import or the API, while archiving is the sole
// "I stopped taking this" signal the app itself writes — and it sets
// `archivedAt` alone. Reading either one on its own gets a real user wrong.
describe("lifecycleEnd", () => {
  it("is null while the medication is still running", () => {
    expect(lifecycleEnd({ endedAt: null, archivedAt: null })).toBeNull();
  });

  it("uses endedAt when that is the only bound", () => {
    expect(lifecycleEnd({ endedAt: MAY_01, archivedAt: null })).toBe(MAY_01);
  });

  it("uses archivedAt when that is the only bound", () => {
    // The case that mattered in practice: no UI writes endedAt, so for a
    // web-app user this is the ONLY signal that a medication stopped.
    expect(lifecycleEnd({ endedAt: null, archivedAt: APR_25 })).toBe(APR_25);
  });

  it("takes the earlier bound when a medication was ended before archiving", () => {
    expect(lifecycleEnd({ endedAt: APR_25, archivedAt: MAY_01 })).toBe(APR_25);
  });

  it("takes the earlier bound when a medication was archived before ending", () => {
    expect(lifecycleEnd({ endedAt: MAY_15, archivedAt: MAY_01 })).toBe(MAY_01);
  });

  it("closes the adherence window at the archive date", () => {
    const life = { endedAt: null, archivedAt: MAY_01 };
    // Archived on 1 May, asked about 15 April - 15 May: 16 of those 30
    // days were expected of you. Not all 30 (which would score archiving
    // as two weeks of missed doses) and not none (which would erase the
    // fortnight you were actually taking it).
    expect(clampEffectiveDays(APR_15, MAY_15, APR_15, lifecycleEnd(life))).toBe(16);
    expect(isActiveOn(APR_25, APR_15, lifecycleEnd(life))).toBe(true);
    expect(isActiveOn(MAY_15, APR_15, lifecycleEnd(life))).toBe(false);
  });
});
