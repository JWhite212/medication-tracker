import { describe, it, expect } from "vitest";
import {
  CARRY_OVER_MS,
  MATCH_TOLERANCE_MS,
  checkSlotActionTime,
  dashboardWindow,
} from "$lib/utils/schedule";

/**
 * The dashboard's bounds. These are pure functions over Dates, so the suite
 * uses default jsdom with no db mock and no fake timers. Every expectation
 * is an explicit ISO string. None is computed by the code under test.
 */

const iso = (d: Date) => d.toISOString();
const HOUR = 60 * 60 * 1000;

describe("window constants", () => {
  it("keeps the match tolerance at one hour and sets the carry-over at twelve", () => {
    expect(MATCH_TOLERANCE_MS).toBe(HOUR);
    expect(CARRY_OVER_MS).toBe(12 * HOUR);
  });
});

describe("dashboardWindow — Europe/London in BST", () => {
  // Thursday 16 April 2026, 08:00 BST.
  const now = new Date("2026-04-16T07:00:00.000Z");
  const w = dashboardWindow(now, "Europe/London");

  it("carries the one `now` and the user's civil day", () => {
    expect(iso(w.now)).toBe("2026-04-16T07:00:00.000Z");
    expect(w.todayKey).toBe("2026-04-16");
  });

  it("bounds today at local midnights, end exclusive", () => {
    expect(iso(w.todayStart)).toBe("2026-04-15T23:00:00.000Z");
    expect(iso(w.end)).toBe("2026-04-16T23:00:00.000Z");
  });

  it("projects from yesterday's local midnight to the end of tomorrow's first hour", () => {
    expect(iso(w.projectStart)).toBe("2026-04-14T23:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-04-17T00:00:00.000Z");
  });

  it("shows Earlier rows from the first millisecond under 12 hours old", () => {
    expect(iso(w.visibleStart)).toBe("2026-04-15T19:00:00.001Z");
  });

  it("fetches doses from an hour before the projection to two hours past today", () => {
    expect(iso(w.doseFetchFrom)).toBe("2026-04-14T22:00:00.000Z");
    expect(iso(w.doseFetchTo)).toBe("2026-04-17T01:00:00.000Z");
  });
});

describe("dashboardWindow — the October transition", () => {
  it("walks the day key back, so yesterday is the whole 25-hour day", () => {
    // Monday 26 October, the day after London falls back. todayStart − 24h
    // is 00:00Z on the 25th, which is 01:00 BST, an hour into yesterday. It
    // would silently drop yesterday's 00:00–00:59 slots.
    const w = dashboardWindow(new Date("2026-10-26T08:00:00.000Z"), "Europe/London");
    expect(iso(w.todayStart)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2026-10-24T23:00:00.000Z");
    expect(w.projectStart.getTime()).not.toBe(w.todayStart.getTime() - 24 * HOUR);
    expect(w.todayStart.getTime() - w.projectStart.getTime()).toBe(25 * HOUR);
    expect(iso(w.end)).toBe("2026-10-27T00:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-10-27T01:00:00.000Z");
    expect(iso(w.visibleStart)).toBe("2026-10-25T20:00:00.001Z");
    expect(iso(w.doseFetchFrom)).toBe("2026-10-24T22:00:00.000Z");
    expect(iso(w.doseFetchTo)).toBe("2026-10-27T02:00:00.000Z");
  });

  it("ends a 25-hour today at the next local midnight, not todayStart + 24h", () => {
    const w = dashboardWindow(new Date("2026-10-25T12:00:00.000Z"), "Europe/London");
    expect(w.todayKey).toBe("2026-10-25");
    expect(iso(w.todayStart)).toBe("2026-10-24T23:00:00.000Z");
    expect(iso(w.end)).toBe("2026-10-26T00:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2026-10-23T23:00:00.000Z");
    expect(iso(w.projectEnd)).toBe("2026-10-26T01:00:00.000Z");
  });
});

describe("dashboardWindow — visibleStart stays between yesterday's and today's midnights", () => {
  it("never reaches into today: late in the evening, Earlier is empty", () => {
    // 22:00 BST. now − 12h is 10:00 BST today, but the 12-hour bound applies
    // to Earlier rows only. Today's rows stay visible until midnight.
    const w = dashboardWindow(new Date("2026-04-16T21:00:00.000Z"), "Europe/London");
    expect(iso(w.visibleStart)).toBe(iso(w.todayStart));
    expect(iso(w.visibleStart)).toBe("2026-04-15T23:00:00.000Z");
  });

  it("never reaches before yesterday's midnight (Pacific/Apia skipped 2011-12-30)", () => {
    // Apia crossed the date line, so 29 December was followed by 31
    // December. "Yesterday" resolves forward onto today's own midnight.
    // now − 12h then lies before every projected instant, and the max() holds
    // visibleStart at projectStart.
    const w = dashboardWindow(new Date("2011-12-30T16:00:00.000Z"), "Pacific/Apia");
    expect(w.todayKey).toBe("2011-12-31");
    expect(iso(w.todayStart)).toBe("2011-12-30T10:00:00.000Z");
    expect(iso(w.projectStart)).toBe("2011-12-30T10:00:00.000Z");
    expect(iso(w.visibleStart)).toBe("2011-12-30T10:00:00.000Z");
  });

  it("gets today's midnight, not tomorrow's, at UTC+12", () => {
    const w = dashboardWindow(new Date("2026-04-16T07:00:00.000Z"), "Pacific/Auckland");
    expect(w.todayKey).toBe("2026-04-16");
    expect(iso(w.todayStart)).toBe("2026-04-15T12:00:00.000Z");
    expect(iso(w.end)).toBe("2026-04-16T12:00:00.000Z");
  });
});

describe("the 12-hour boundary, to the millisecond", () => {
  it("hides a slot exactly 12 hours old and shows one a millisecond younger", () => {
    const now = new Date("2026-04-16T07:00:00.000Z");
    const w = dashboardWindow(now, "Europe/London");
    const exactly12h = new Date(now.getTime() - CARRY_OVER_MS);
    expect(iso(exactly12h)).toBe("2026-04-15T19:00:00.000Z");
    expect(exactly12h.getTime()).toBeLessThan(w.visibleStart.getTime());
    expect(exactly12h.getTime() + 1).toBe(w.visibleStart.getTime());
  });
});

describe("checkSlotActionTime", () => {
  const tz = "Europe/London";
  const now = new Date("2026-04-16T07:00:00.000Z"); // 08:00 BST

  it("rejects an instant after now as future", () => {
    expect(checkSlotActionTime(new Date("2026-04-16T07:00:00.001Z"), now, tz)).toBe("future");
  });

  it("accepts now itself", () => {
    expect(checkSlotActionTime(now, now, tz)).toBeNull();
  });

  it("accepts an Earlier slot a millisecond under 12 hours old", () => {
    expect(checkSlotActionTime(new Date("2026-04-15T19:00:00.001Z"), now, tz)).toBeNull();
  });

  it("rejects an Earlier slot exactly 12 hours old as stale", () => {
    expect(checkSlotActionTime(new Date("2026-04-15T19:00:00.000Z"), now, tz)).toBe("stale");
  });

  it("accepts any of today's slots, however old, and measures today in the user's zone", () => {
    // 22:00 BST. Today's 00:00 BST (23:00Z yesterday in UTC terms) is 22
    // hours old and still accepted. A UTC reading of "today" would call it
    // stale. One millisecond before local midnight is yesterday, and older
    // than 12 hours, so it is stale.
    const late = new Date("2026-04-16T21:00:00.000Z");
    expect(checkSlotActionTime(new Date("2026-04-15T23:00:00.000Z"), late, tz)).toBeNull();
    expect(checkSlotActionTime(new Date("2026-04-15T22:59:59.999Z"), late, tz)).toBe("stale");
  });
});
