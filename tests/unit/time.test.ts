import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatTimeSince,
  formatTime,
  formatUserDate,
  startOfDay,
  formatDueIn,
  formatDuration,
  isoDayKey,
  isoDayKeyFormatter,
  wallClockToInstant,
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

  // The case above asserts a shape that the *old* locale-delegating
  // implementation also satisfies on this runtime, so on its own it would not
  // notice a revert. A year below 1000 does notice: `year: "numeric"` renders
  // "999", and only the explicit padStart in `isoDate` widens it to "0999".
  // This is the one assertion in the suite that fails if YYYY-MM-DD is ever
  // handed back to a locale — which is exactly how this regressed once before.
  it("pads a year below 1000, which locale delegation would not", () => {
    const earlyYear = new Date(Date.UTC(999, 0, 5));
    expect(formatUserDate(earlyYear, "UTC", "YYYY-MM-DD")).toBe("0999-01-05");
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

  it("prints days instead of hundreds of hours", () => {
    // Live on the dashboard: a medication last taken three weeks ago read
    // "Overdue 504h 20m".
    expect(formatDueIn(-(504 * 60 + 20) * 60_000)).toBe("Overdue 21d");
  });
});

describe("formatDuration", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  it("short style at every threshold", () => {
    expect(formatDuration(59_999)).toBe("<1m");
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(45 * MIN)).toBe("45m");
    expect(formatDuration(60 * MIN)).toBe("1h");
    expect(formatDuration(2 * HOUR + 15 * MIN)).toBe("2h 15m");
    expect(formatDuration(23 * HOUR + 59 * MIN)).toBe("23h 59m");
    expect(formatDuration(24 * HOUR)).toBe("1d");
    expect(formatDuration(24 * HOUR + 59 * MIN)).toBe("1d");
    expect(formatDuration(25 * HOUR)).toBe("1d 1h");
    expect(formatDuration(49 * HOUR)).toBe("2d 1h");
  });

  it("long style at every threshold", () => {
    const long = (ms: number) => formatDuration(ms, { style: "long" });
    expect(long(59_999)).toBe("less than a minute");
    expect(long(60_000)).toBe("1 minute");
    expect(long(45 * MIN)).toBe("45 minutes");
    expect(long(60 * MIN)).toBe("1 hour");
    expect(long(2 * HOUR + 15 * MIN)).toBe("2 hours 15 minutes");
    expect(long(23 * HOUR + 59 * MIN)).toBe("23 hours 59 minutes");
    expect(long(24 * HOUR)).toBe("1 day");
    expect(long(24 * HOUR + 59 * MIN)).toBe("1 day");
    expect(long(25 * HOUR)).toBe("1 day 1 hour");
    expect(long(49 * HOUR)).toBe("2 days 1 hour");
  });

  it("maxUnits 1 keeps only the largest non-zero unit, floored", () => {
    // The dashboard's copy shape: "2 hours ago", never "3 hours ago" for 2h15m.
    const one = (ms: number) => formatDuration(ms, { style: "long", maxUnits: 1 });
    expect(one(59_999)).toBe("less than a minute");
    expect(one(45 * MIN)).toBe("45 minutes");
    expect(one(2 * HOUR + 15 * MIN)).toBe("2 hours");
    expect(one(23 * HOUR + 59 * MIN)).toBe("23 hours");
    expect(one(25 * HOUR)).toBe("1 day");
    expect(formatDuration(2 * HOUR + 15 * MIN, { maxUnits: 1 })).toBe("2h");
  });

  it("floors at every unit, so lateness is never overstated", () => {
    expect(formatDuration(2 * MIN - 1)).toBe("1m");
    expect(formatDuration(HOUR - 1)).toBe("59m");
    expect(formatDuration(24 * HOUR - 1)).toBe("23h 59m");
  });

  it("uses the magnitude, so the sign never reaches the label", () => {
    expect(formatDuration(-(2 * HOUR + 15 * MIN))).toBe("2h 15m");
    expect(formatDuration(-59_999, { style: "long" })).toBe("less than a minute");
  });

  it("drops zero units, and drops minutes once days appear", () => {
    expect(formatDuration(2 * HOUR + 30_000)).toBe("2h");
    expect(formatDuration(24 * HOUR + 5 * MIN, { style: "long" })).toBe("1 day");
    // The live defect: three weeks and twenty minutes.
    expect(formatDuration((504 * 60 + 20) * MIN)).toBe("21d");
  });

  it("defaults to the short style and two units", () => {
    expect(formatDuration(2 * HOUR + 15 * MIN)).toBe(
      formatDuration(2 * HOUR + 15 * MIN, { style: "short", maxUnits: 2 }),
    );
  });
});

describe("machine formatter memo", () => {
  // Counts Intl.DateTimeFormat constructions by putting a subclass in its
  // place. vi.spyOn cannot do this job: a spied constructor builds instances
  // on the MOCK's prototype, which has no formatToParts, so the code under
  // test would throw instead of being observed.
  //
  // The memo is module-level and outlives each case. So every counting case
  // uses a zone that no other case in this file touches, and asserts an
  // EXACT count. If the stand-in never reached time.ts, the count would be
  // 0 and the case would fail loudly, not pass as "at most one".
  let constructed = 0;

  class CountingDateTimeFormat extends Intl.DateTimeFormat {
    constructor(...args: ConstructorParameters<typeof Intl.DateTimeFormat>) {
      super(...args);
      constructed++;
    }
  }

  beforeEach(() => {
    constructed = 0;
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl), { DateTimeFormat: CountingDateTimeFormat }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds one day-key formatter per timezone, however many keys are asked for", () => {
    for (let day = 1; day <= 50; day++) {
      isoDayKey(new Date(Date.UTC(2026, 0, day, 12)), "Asia/Tokyo");
    }
    isoDayKeyFormatter("Asia/Tokyo")(new Date("2026-04-15T17:20:00Z"));
    expect(constructed).toBe(1);
  });

  it("builds one offset formatter per timezone for wallClockToInstant", () => {
    for (let hour = 0; hour < 24; hour++) {
      wallClockToInstant("2026-04-15", `${String(hour).padStart(2, "0")}:00`, "Asia/Seoul");
    }
    expect(constructed).toBe(1);
  });

  it("never answers for one zone with another zone's formatter", () => {
    // Guards the memo KEY. A cache keyed without the timezone passes both
    // counting cases above and fails here.
    const instant = new Date("2026-04-15T17:20:00Z");
    expect(isoDayKey(instant, "Australia/Perth")).toBe("2026-04-16");
    expect(isoDayKey(instant, "America/Los_Angeles")).toBe("2026-04-15");
    expect(isoDayKey(instant, "Australia/Perth")).toBe("2026-04-16");
    expect(wallClockToInstant("2026-04-15", "08:00", "Australia/Perth").toISOString()).toBe(
      "2026-04-15T00:00:00.000Z",
    );
    expect(wallClockToInstant("2026-04-15", "08:00", "America/Los_Angeles").toISOString()).toBe(
      "2026-04-15T15:00:00.000Z",
    );
  });

  it("still throws for a zone the runtime rejects, every time", () => {
    // Behaviour identical to the unmemoised code. The constructor throws
    // before anything is cached, so a bad zone is never remembered as good.
    expect(() => isoDayKey(new Date(), "Not/A_Zone")).toThrow(RangeError);
    expect(() => isoDayKey(new Date(), "Not/A_Zone")).toThrow(RangeError);
    expect(() => wallClockToInstant("2026-04-15", "08:00", "Not/A_Zone")).toThrow(RangeError);
  });
});
