import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeSince,
  formatTime,
  formatUserDate,
  startOfDay,
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
  // formatUserTime uses en-GB which renders "am"/"pm" lowercase.
  // formatTime is a thin wrapper that delegates with "12h".
  it("formats time in 12-hour format", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "UTC");
    expect(result).toBe("2:30 pm");
  });

  it("formats time with timezone", () => {
    const date = new Date("2026-04-15T14:30:00Z");
    const result = formatTime(date, "America/New_York");
    expect(result).toBe("10:30 am");
  });
});

describe("formatUserDate", () => {
  // 15 Apr 2026 is a Wednesday. 18:20 London so the UTC instant and the
  // London civil date agree, keeping the timezone cases legible.
  const date = new Date("2026-04-15T17:20:00Z");

  it("orders the fields per the stored preference", () => {
    expect(formatUserDate(date, "UTC", "DD/MM/YYYY")).toBe("15 Apr 2026");
    expect(formatUserDate(date, "UTC", "MM/DD/YYYY")).toBe("Apr 15, 2026");
    expect(formatUserDate(date, "UTC", "YYYY-MM-DD")).toBe("2026-04-15");
  });

  it("renders YYYY-MM-DD as a real ISO date, never a named month", () => {
    // The one option whose label is literally an all-numeric pattern. The
    // year is forced on even when the call site asks for no year, because
    // an ISO date without one is not an ISO date.
    expect(formatUserDate(date, "UTC", "YYYY-MM-DD", { year: false })).toBe("2026-04-15");
    expect(formatUserDate(date, "UTC", "YYYY-MM-DD", { weekday: true })).toBe("Wed, 2026-04-15");
  });

  // Regression guard. The ISO branch used to hand the whole job to
  // Intl.DateTimeFormat("en-CA", ...) and trust the result to come back as
  // YYYY-MM-DD. ECMA-402 does not promise that — en-CA's pattern changed
  // once already in ICU 72 — and because this runs client-side, the ICU that
  // matters is the viewer's browser, not the one under this suite. These
  // assert the *shape*, so they hold even where a pattern assumption would
  // not, and they are the check a locale change would otherwise slip past.
  it("assembles the ISO date from parts, not from a locale pattern", () => {
    const ISO = /^\d{4}-\d{2}-\d{2}$/;

    for (const tz of [
      "UTC",
      "Europe/London",
      "America/New_York",
      "Pacific/Auckland",
      "Asia/Kolkata",
    ]) {
      expect(formatUserDate(date, tz, "YYYY-MM-DD")).toMatch(ISO);
    }

    // Zero-padded on a single-digit month and day, which is where a
    // "numeric" fallback would visibly diverge from ISO.
    expect(formatUserDate(new Date("2026-01-05T12:00:00Z"), "UTC", "YYYY-MM-DD")).toBe(
      "2026-01-05",
    );

    // The weekday is a rendering choice layered on top; the ISO half of the
    // string keeps its exact shape underneath it.
    const withWeekday = formatUserDate(date, "UTC", "YYYY-MM-DD", { weekday: true });
    expect(withWeekday).toMatch(/^[A-Za-z.]+, \d{4}-\d{2}-\d{2}$/);
    expect(withWeekday.split(", ")[1]).toMatch(ISO);
  });

  it("lets the call site choose the fields and the preference choose the order", () => {
    expect(formatUserDate(date, "UTC", "DD/MM/YYYY", { weekday: true, year: false })).toBe(
      "Wed 15 Apr",
    );
    expect(formatUserDate(date, "UTC", "MM/DD/YYYY", { weekday: true, year: false })).toBe(
      "Wed, Apr 15",
    );
  });

  it("defaults to DD/MM/YYYY, matching the schema column default", () => {
    expect(formatUserDate(date, "UTC")).toBe(formatUserDate(date, "UTC", "DD/MM/YYYY"));
  });

  it("resolves the date in the given timezone, not the runtime's", () => {
    // 17:20Z is still the 15th in London but already the 16th in Auckland.
    expect(formatUserDate(date, "Pacific/Auckland", "YYYY-MM-DD")).toBe("2026-04-16");
    expect(formatUserDate(date, "America/New_York", "YYYY-MM-DD")).toBe("2026-04-15");
  });

  // The reason the preference maps to a locale rather than to a literal
  // pattern string: every call site below previously hardcoded its own
  // Intl options, and the default preference has to reproduce them exactly
  // or shipping this changes what every untouched account already sees.
  it("reproduces each previously-hardcoded format on the default preference", () => {
    const asBefore = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(date);

    // export-pdf.ts formatDateInTz
    expect(formatUserDate(date, "UTC", "DD/MM/YYYY", { weekday: true, year: true })).toBe(
      asBefore({ weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    );

    // (app)/log/+page.svelte formatDateLabel
    expect(formatUserDate(date, "UTC", "DD/MM/YYYY", { weekday: true, year: false })).toBe(
      asBefore({ weekday: "short", day: "numeric", month: "short" }),
    );

    // (app)/medications/[id]/+page.svelte formatEventTime — date half only;
    // that site formatted day as "2-digit", which differs from "numeric"
    // for single-digit days alone (see the next case).
    expect(formatUserDate(date, "UTC", "DD/MM/YYYY")).toBe(
      asBefore({ day: "2-digit", month: "short", year: "numeric" }),
    );
  });

  it("drops the leading zero on single-digit days", () => {
    // The one accepted rendering change: inventory history used to pad to
    // "05 Apr 2026". Unifying on the canonical formatter costs the pad
    // rather than adding a per-site knob for it.
    const fifth = new Date("2026-04-05T12:00:00Z");
    expect(formatUserDate(fifth, "UTC", "DD/MM/YYYY")).toBe("5 Apr 2026");
  });
});

describe("startOfDay", () => {
  it("returns midnight in given timezone", () => {
    const result = startOfDay(new Date("2026-04-15T14:30:00Z"), "UTC");
    expect(result.toISOString()).toBe("2026-04-15T00:00:00.000Z");
  });
});

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
