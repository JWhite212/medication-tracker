import { describe, it, expect } from "vitest";
import {
  wallClockToInstant,
  shiftDayKey,
  dayOfWeekForDayKey,
  isoDayKey,
  startOfDay,
  endOfDay,
  parseDateTimeLocal,
  formatDateTimeLocal,
  parseDayRangeParam,
  isCalendarDay,
} from "$lib/utils/time";
import { computeScheduleSlots } from "$lib/utils/schedule";
import { doseEditSchema } from "$lib/utils/validation";
import { computeOverdueSlot, type OverdueRow } from "$lib/server/reminders/domain";
import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

/**
 * Wall-clock → instant conversion, pinned against DST transitions and
 * against the zones where the shipped algorithm was wrong every day.
 *
 * Default jsdom, no db mock, no PGlite, no fake timers: everything under
 * test is a pure function over strings and Dates, so neither seam criterion
 * in CLAUDE.md applies.
 *
 * Every expectation is an explicit ISO string or `Date.UTC`. None is
 * computed by the code under test, and none is a locale's rendering.
 *
 * ZONE NAMES ARE NOT INTERCHANGEABLE. `validation.ts` gates a stored
 * timezone against `Intl.supportedValuesOf("timeZone")`, which on this
 * runtime contains `America/Godthab` and `Asia/Katmandu` — NOT the
 * `America/Nuuk` / `Asia/Kathmandu` spellings. A fixture using the other
 * alias would pin a state no account can reach.
 */

/**
 * Render an instant back to a wall clock in `tz`, as `YYYY-MM-DD, HH:mm`.
 *
 * Assembled from parts rather than taken from `format()` for the same reason
 * `isoDayKey` is: field order is CLDR data, and `year: "numeric"` renders a
 * pre-1000 year as "999" rather than "0999".
 */
function localOf(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return (
    `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}` +
    `, ${get("hour")}:${get("minute")}`
  );
}

/**
 * The retired single-pass algorithm, carried verbatim so the tests below
 * keep proving they can tell the two apart.
 *
 * This is the mutation proof, made permanent rather than performed once: a
 * future "simplification" back to sample-and-trust cannot pass this file.
 * The suite was green with the bug and green without it — 98 files and 1337
 * tests moved not at all when the three functions were rewritten — so
 * without this the fix has no witness.
 */
function legacySinglePass(dateStr: string, timeOfDay: string, timezone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeOfDay.split(":").map(Number);
  const naiveUtcMs = Date.UTC(y, m - 1, d, hh, mm);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(naiveUtcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const naiveAsTzMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return new Date(naiveUtcMs - (naiveAsTzMs - naiveUtcMs));
}

/** The retired noon-UTC-anchor `startOfDay`, likewise carried verbatim. */
function legacyStartOfDay(date: Date, timezone: string): Date {
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  const guess = new Date(`${dateStr}T12:00:00.000Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(guess);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(
    guess.getTime() - (get("hour") * 3600 + get("minute") * 60 + get("second")) * 1000,
  );
}

describe("startOfDay — the UTC+12 failure, on ordinary days", () => {
  // The highest-value cases in this file, and the reason the original "DST
  // bug" framing was wrong: no DST is in sight on 15 June anywhere. The old
  // implementation anchored on `<dayKey>T12:00:00Z`, which at offset >= +12
  // is ALREADY the next civil day, so the local time-of-day it read back was
  // 00:00 and the correction subtracted nothing — it returned tomorrow's
  // midnight, every day of the year, in 18 zones.
  //
  // The single pre-existing test for this function used "UTC", the one zone
  // that can expose neither this nor the transition-day failure.
  it.each([
    ["Pacific/Auckland", "2026-06-14T12:00:00.000Z"],
    ["Pacific/Fiji", "2026-06-14T12:00:00.000Z"],
    ["Pacific/Kiritimati", "2026-06-14T10:00:00.000Z"],
  ])("%s: an ordinary June day resolves to that day's midnight", (timezone, expected) => {
    const noon = new Date("2026-06-15T03:00:00Z");
    const result = startOfDay(noon, timezone);

    expect(result.toISOString()).toBe(expected);
    expect(localOf(result, timezone)).toBe("2026-06-15, 00:00");

    // ...and the retired algorithm returned TOMORROW's midnight here.
    expect(localOf(legacyStartOfDay(noon, timezone), timezone)).toBe("2026-06-16, 00:00");
  });

  it("Europe/London is unaffected on an ordinary day — the control", () => {
    const result = startOfDay(new Date("2026-06-15T03:00:00Z"), "Europe/London");
    expect(result.toISOString()).toBe("2026-06-14T23:00:00.000Z");
  });

  it("Europe/London spring-forward day still starts at local midnight", () => {
    // 2026-03-29 is the London transition. Midnight exists; 01:00 does not.
    const result = startOfDay(new Date("2026-03-29T12:00:00Z"), "Europe/London");
    expect(result.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(localOf(result, "Europe/London")).toBe("2026-03-29, 00:00");
  });

  it("America/Santiago, where local midnight itself does not exist", () => {
    // Santiago springs forward AT 00:00, so 2026-09-06 has no 00:00 local.
    // Forward resolution keeps the day on its own civil date; resolving
    // backwards would start "today" on the previous day and pull an extra
    // day of doses into it.
    const result = startOfDay(new Date("2026-09-06T15:00:00Z"), "America/Santiago");
    expect(localOf(result, "America/Santiago")).toBe("2026-09-06, 01:00");
    expect(isoDayKey(result, "America/Santiago")).toBe("2026-09-06");
  });
});

describe("wallClockToInstant — the transition-day failures", () => {
  // Each case is one the shipped single-pass algorithm got wrong, and each
  // asserts BOTH the correct instant and that the retired algorithm differs.
  it.each([
    ["America/New_York", "2026-03-08", "05:00", "2026-03-08T09:00:00.000Z", "2026-03-08, 05:00"],
    ["Pacific/Auckland", "2026-09-27", "01:00", "2026-09-26T13:00:00.000Z", "2026-09-27, 01:00"],
    ["Australia/Sydney", "2026-10-04", "02:30", "2026-10-03T16:30:00.000Z", "2026-10-04, 03:30"],
  ])("%s %s %s", (timezone, dayKey, timeOfDay, expected, expectedLocal) => {
    const result = wallClockToInstant(dayKey, timeOfDay, timezone);

    expect(result.toISOString()).toBe(expected);
    expect(localOf(result, timezone)).toBe(expectedLocal);
    expect(legacySinglePass(dayKey, timeOfDay, timezone).toISOString()).not.toBe(expected);
  });

  it("an ordinary day is unchanged — the control", () => {
    const result = wallClockToInstant("2026-06-15", "08:00", "America/New_York");

    expect(result.toISOString()).toBe("2026-06-15T12:00:00.000Z");
    // The two algorithms agree away from a transition; that is the point.
    expect(legacySinglePass("2026-06-15", "08:00", "America/New_York").toISOString()).toBe(
      result.toISOString(),
    );
  });

  it("handles a sub-hour DST shift (Australia/Lord_Howe moves 30 minutes)", () => {
    // Any design that assumed a whole-hour shift was already dead.
    const result = wallClockToInstant("2026-10-04", "03:00", "Australia/Lord_Howe");
    expect(localOf(result, "Australia/Lord_Howe")).toBe("2026-10-04, 03:00");
  });
});

describe("wallClockToInstant — gap policy: resolve forward", () => {
  it("America/New_York 02:30 on a spring-forward day lands past the gap", () => {
    const result = wallClockToInstant("2026-03-08", "02:30", "America/New_York");

    expect(result.toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(localOf(result, "America/New_York")).toBe("2026-03-08, 03:30");
  });

  it("Europe/London 01:00 on a spring-forward day resolves forward, not back", () => {
    // The sharpest of the pair: the retired algorithm resolved this one
    // BACKWARDS, to 00:00 local — an hour before the user asked for.
    const result = wallClockToInstant("2026-03-29", "01:00", "Europe/London");

    expect(result.toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(localOf(result, "Europe/London")).toBe("2026-03-29, 02:00");
    expect(localOf(legacySinglePass("2026-03-29", "01:00", "Europe/London"), "Europe/London")).toBe(
      "2026-03-29, 00:00",
    );
  });

  it("never returns null or throws for a wall clock that does not exist", () => {
    // The two callers that would have to handle a null are the reminder
    // sweep and My Day's window, where "no answer" means a skipped dose.
    for (let minute = 0; minute < 60; minute++) {
      const result = wallClockToInstant(
        "2026-03-08",
        `02:${String(minute).padStart(2, "0")}`,
        "America/New_York",
      );
      expect(Number.isNaN(result.getTime())).toBe(false);
    }
  });
});

describe("wallClockToInstant — overlap policy: take the earlier instant", () => {
  // The shipped code was arbitrary here, not consistent: it picked the
  // earlier instant in New York and the later one in London. Stability is
  // load-bearing — `buildOverdueDedupeKey` embeds the resolved slot's ISO
  // string, so a wobbling choice mints a fresh key and re-sends a reminder
  // the user already received.
  it.each([
    ["America/New_York", "2026-11-01", "01:30", "2026-11-01T05:30:00.000Z"],
    ["Europe/London", "2026-10-25", "01:30", "2026-10-25T00:30:00.000Z"],
  ])("%s %s %s takes the first of the two", (timezone, dayKey, timeOfDay, expected) => {
    const result = wallClockToInstant(dayKey, timeOfDay, timezone);
    expect(result.toISOString()).toBe(expected);

    // Both readings render the requested wall clock; we chose deliberately.
    expect(localOf(result, timezone)).toBe(`${dayKey}, ${timeOfDay}`);
    expect(localOf(new Date(result.getTime() + 3_600_000), timezone)).toBe(
      `${dayKey}, ${timeOfDay}`,
    );
  });

  it("is stable across repeated calls, so a dedupe key cannot churn", () => {
    const first = wallClockToInstant("2026-11-01", "01:30", "America/New_York");
    const second = wallClockToInstant("2026-11-01", "01:30", "America/New_York");
    expect(first.getTime()).toBe(second.getTime());
  });
});

describe("wallClockToInstant — a resolved instant carries no civil day", () => {
  it("America/Godthab 23:30 necessarily rolls into the next day", () => {
    // Greenland springs forward at 23:00 LOCAL, so the entire 23:00–23:59
    // band does not exist on 2026-03-28. The roll is not a defect and not
    // avoidable — a guarantee that forward resolution "never leaves the
    // requested civil day" is unsatisfiable, not merely unmet.
    const result = wallClockToInstant("2026-03-28", "23:30", "America/Godthab");

    expect(result.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(localOf(result, "America/Godthab")).toBe("2026-03-29, 00:30");
    expect(isoDayKey(result, "America/Godthab")).toBe("2026-03-29");
  });

  it("all 60 minutes of that band are missing, so no policy could keep the day", () => {
    let survived = 0;
    for (let minute = 0; minute < 60; minute++) {
      const timeOfDay = `23:${String(minute).padStart(2, "0")}`;
      const result = wallClockToInstant("2026-03-28", timeOfDay, "America/Godthab");
      if (localOf(result, "America/Godthab") === `2026-03-28, ${timeOfDay}`) survived++;
    }
    expect(survived).toBe(0);
  });
});

describe("wallClockToInstant — years below 1000 round-trip", () => {
  it("resolves and re-keys 0999-04-15 without losing the year's padding", () => {
    // `Date.UTC(999, …)` is fine but `Date.UTC(50, …)` is 1950, so the
    // conversion goes through setUTCFullYear. `isoDayKey` re-pads the year
    // because `year: "numeric"` renders 999, not 0999.
    const result = wallClockToInstant("0999-04-15", "00:00", "Europe/London");
    expect(isoDayKey(result, "Europe/London")).toBe("0999-04-15");
  });

  it("keeps sub-minute historical offsets exact (London LMT is -75s)", () => {
    const result = wallClockToInstant("0999-04-15", "12:00", "Europe/London");
    expect(localOf(result, "Europe/London")).toBe("0999-04-15, 12:00");
  });
});

describe("shiftDayKey and dayOfWeekForDayKey", () => {
  it.each([
    ["2026-03-29", 1, "2026-03-30"],
    ["2026-03-29", -1, "2026-03-28"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2028-02-28", 1, "2028-02-29"],
  ])("shiftDayKey(%s, %i) === %s", (dayKey, days, expected) => {
    expect(shiftDayKey(dayKey, days)).toBe(expected);
  });

  it("shiftDayKey pads a year below 1000 to four digits", () => {
    expect(shiftDayKey("0999-01-01", -1)).toBe("0998-12-31");
  });

  it.each([
    ["2026-03-28", 6],
    ["2026-03-29", 0],
    ["2026-09-07", 1],
  ])("dayOfWeekForDayKey(%s) === %i", (dayKey, expected) => {
    expect(dayOfWeekForDayKey(dayKey)).toBe(expected);
  });
});

describe("parseDateTimeLocal — the takenAt write path", () => {
  it("delegates to the resolver on a transition day", () => {
    const result = parseDateTimeLocal("2026-03-08T05:00", "America/New_York");
    expect(result.toISOString()).toBe("2026-03-08T09:00:00.000Z");
  });

  it("takes the earlier instant for an ambiguous fall-back wall clock", () => {
    const result = parseDateTimeLocal("2026-10-25T01:30", "Europe/London");
    expect(result.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("accepts the seconds-bearing form a datetime-local input may emit", () => {
    const result = parseDateTimeLocal("2026-06-15T08:30:45", "America/New_York");
    expect(result.toISOString()).toBe("2026-06-15T12:30:45.000Z");
  });

  it("throws a RangeError on a value that is not a wall clock", () => {
    expect(() => parseDateTimeLocal("x", "UTC")).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// The cascade. Correcting the resolver alone is a REGRESSION in both of the
// call sites below, which is why they land in the same commit.
// ---------------------------------------------------------------------------

describe("endOfDay — a civil day is not always 24 hours", () => {
  it("Europe/London 2026-10-25 is 25 hours long", () => {
    const noon = new Date("2026-10-25T12:00:00Z");
    const start = startOfDay(noon, "Europe/London");
    const end = endOfDay(noon, "Europe/London");

    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);

    // `dayStart + 24h` would have ended the window an hour early, hiding
    // 23:00–23:59 local — the most common bedtime-medication slot.
    expect(new Date(start.getTime() + 24 * 3_600_000).toISOString()).toBe(
      "2026-10-25T23:00:00.000Z",
    );
  });

  it("Europe/London 2026-03-29 is 23 hours long", () => {
    const noon = new Date("2026-03-29T12:00:00Z");
    expect(
      endOfDay(noon, "Europe/London").getTime() - startOfDay(noon, "Europe/London").getTime(),
    ).toBe(23 * 3_600_000);
  });

  it("an ordinary day is exactly 24 hours", () => {
    const noon = new Date("2026-06-15T12:00:00Z");
    expect(
      endOfDay(noon, "Europe/London").getTime() - startOfDay(noon, "Europe/London").getTime(),
    ).toBe(24 * 3_600_000);
  });
});

function makeMed(overrides: Partial<Medication> = {}): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "TestMed",
    dosageAmount: "200",
    dosageUnit: "mg",
    form: "tablet",
    category: "pain",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    notificationsEnabled: true,
    notifyOverdueEmail: null,
    notifyOverduePush: null,
    notifyLowInventoryEmail: null,
    notifyLowInventoryPush: null,
    notifyOffsetMinutes: 0,
    notifyRepeatEveryMinutes: null,
    notifyMaxRepeats: 3,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeFixedTimeSchedule(
  timeOfDay: string,
  overrides: Partial<MedicationSchedule> = {},
): MedicationSchedule {
  return {
    id: `sched-${timeOfDay}`,
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("My Day across a 25-hour civil day", () => {
  it("renders both the first and the last slot of Europe/London 2026-10-25", () => {
    // Measured before the fix: the shipped code rendered 08:00 / 22:30 /
    // 23:30 and dropped 00:15, because its day START was an hour late. The
    // resolver WITHOUT this window fix rendered 00:15 / 08:00 / 22:30 and
    // dropped 23:30, because its day END was an hour early. Landing either
    // half alone just moves the invisible hour.
    const timezone = "Europe/London";
    const now = new Date("2026-10-25T12:00:00Z");
    const med = makeMed();
    const schedules = ["00:15", "08:00", "22:30", "23:30"].map((t) => makeFixedTimeSchedule(t));

    const slots = computeScheduleSlots(
      [med],
      new Map([["med-1", schedules]]),
      [] as DoseLogWithMedication[],
      {},
      startOfDay(now, timezone),
      endOfDay(now, timezone),
      timezone,
      now,
    );

    expect(slots.map((s) => localOf(new Date(s.expectedTime), timezone))).toEqual([
      "2026-10-25, 00:15",
      "2026-10-25, 08:00",
      "2026-10-25, 22:30",
      "2026-10-25, 23:30",
    ]);
  });
});

describe("day-of-week filters read the requested date, not the resolved instant", () => {
  function godthabRow(overrides: Partial<OverdueRow> = {}): OverdueRow {
    return {
      scheduleKind: "fixed_time",
      intervalHours: null,
      timeOfDay: "23:30",
      daysOfWeek: [6], // Saturday only
      userTimezone: "America/Godthab",
      lastEventAt: null,
      ...overrides,
    };
  }

  it("a Saturday-only medication still gets its slot when the slot rolls to Sunday", () => {
    // 2026-03-28 is a Saturday whose 23:30 slot resolves into Sunday the
    // 29th. Deriving the weekday from that instant produced ZERO reminder
    // slots across the transition weekend against exactly one on an
    // ordinary weekend — a silently skipped dose, not a mistimed one.
    //
    // This failure PRE-DATES the resolver: the retired code returned null
    // here too. It is in this commit because correcting the resolver
    // changes which instants the filter sees, not because it caused it.
    const slot = computeOverdueSlot(godthabRow(), new Date("2026-03-29T03:00:00Z"));

    expect(slot?.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("an ordinary Saturday behaves identically — the control", () => {
    const slot = computeOverdueSlot(godthabRow(), new Date("2026-03-22T03:00:00Z"));
    expect(localOf(slot!, "America/Godthab")).toBe("2026-03-21, 23:30");
  });

  it("a Sunday-only medication is still excluded on a Saturday", () => {
    // The filter must not simply have been loosened.
    expect(
      computeOverdueSlot(godthabRow({ daysOfWeek: [0] }), new Date("2026-03-22T03:00:00Z")),
    ).toBeNull();
  });

  it("My Day cannot show a slot that rolled out of the day, and does not pretend to", () => {
    // The honest counterpart to the case above. Saturday 2026-03-28 in
    // Godthab ENDS at 23:00 local, because that is the instant the clocks
    // jump — so the 23:30 slot resolves to 01:30Z, past `endOfDay`, and the
    // window drops it. Sunday's timeline then excludes it on day-of-week.
    //
    // That is the correct reading of "show me Saturday", and the reminder
    // sweep is the surface that still fires the dose (previous test). What
    // is NOT acceptable is the old behaviour, where neither surface did.
    const timezone = "America/Godthab";
    const saturday = new Date("2026-03-28T20:00:00Z");
    const sunday = new Date("2026-03-29T20:00:00Z");
    const schedules = new Map([["med-1", [makeFixedTimeSchedule("23:30", { daysOfWeek: [6] })]]]);
    const slotsOn = (now: Date) =>
      computeScheduleSlots(
        [makeMed()],
        schedules,
        [] as DoseLogWithMedication[],
        {},
        startOfDay(now, timezone),
        endOfDay(now, timezone),
        timezone,
        now,
      );

    expect(endOfDay(saturday, timezone).toISOString()).toBe("2026-03-29T01:00:00.000Z");
    expect(slotsOn(saturday)).toEqual([]);
    expect(slotsOn(sunday)).toEqual([]);
  });

  it("computeScheduleSlots reads the weekday off the day key too", () => {
    // A TWO-day window, deliberately. Inside a single civil day the two
    // readings cannot differ — any slot whose instant rolls forward is past
    // `endOfDay` and the window drops it either way — so a one-day window
    // makes this test unfalsifiable, which is what an earlier version of it
    // was. Widening to Saturday..Sunday is the smallest window in which the
    // Godthab 23:30 slot is inside the range AND its resolved instant reads
    // as a different weekday from the date that produced it.
    const timezone = "America/Godthab";
    const saturday = new Date("2026-03-28T12:00:00Z");
    const sunday = new Date("2026-03-29T12:00:00Z");
    const slotsFor = (daysOfWeek: number[]) =>
      computeScheduleSlots(
        [makeMed()],
        new Map([["med-1", [makeFixedTimeSchedule("23:30", { daysOfWeek })]]]),
        [] as DoseLogWithMedication[],
        {},
        startOfDay(saturday, timezone),
        endOfDay(sunday, timezone),
        timezone,
        sunday,
      );

    // Saturday's 23:30 resolves into Sunday the 29th. Keyed on the requested
    // date it is still a Saturday slot and survives; keyed on the instant it
    // reads as Sunday and a Saturday-only medication loses it entirely.
    expect(slotsFor([6]).map((s) => s.expectedTime)).toEqual(["2026-03-29T01:30:00.000Z"]);

    // ...and the filter is still a filter: Sunday-only keeps only Sunday's.
    expect(slotsFor([0]).map((s) => s.expectedTime)).toEqual(["2026-03-30T00:30:00.000Z"]);
  });
});

describe("calendar fields that overflow", () => {
  // `DATETIME_LOCAL_RE` and `DAY_KEY_RE` are shape checks, so overflowing
  // fields reach the resolver. It must normalise them the way `Date` does —
  // an earlier version built the instant on a year-2000 pivot and set the
  // year afterwards, which lost a whole year on any rollover past 31 December
  // and a day on February in a non-leap year.
  it.each([
    ["2026-12-32", "00:00", "2027-01-01T00:00:00.000Z"],
    ["2026-13-01", "00:00", "2027-01-01T00:00:00.000Z"],
    ["2026-02-31", "00:00", "2026-03-03T00:00:00.000Z"],
    ["2026-12-31", "25:00", "2027-01-01T01:00:00.000Z"],
  ])("wallClockToInstant(%s, %s) normalises like Date", (dayKey, timeOfDay, expected) => {
    expect(wallClockToInstant(dayKey, timeOfDay, "UTC").toISOString()).toBe(expected);
  });

  it("years below 100 are literal, not mapped into the 1900s", () => {
    // `Date.UTC(50, 0, 1)` is 1950. The resolver must not inherit that.
    expect(wallClockToInstant("0050-03-04", "10:00", "UTC").toISOString()).toBe(
      "0050-03-04T10:00:00.000Z",
    );
    expect(isCalendarDay(50, 3, 4)).toBe(true);
  });

  it.each([
    [2026, 2, 31],
    [2026, 13, 1],
    [2026, 12, 32],
    [2026, 0, 1],
    [2027, 2, 29],
  ])("isCalendarDay(%i, %i, %i) is false", (year, month, day) => {
    expect(isCalendarDay(year, month, day)).toBe(false);
  });

  it.each([
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 12, 31],
    [999, 4, 15],
  ])("isCalendarDay(%i, %i, %i) is true", (year, month, day) => {
    expect(isCalendarDay(year, month, day)).toBe(true);
  });

  it("the range door REJECTS an impossible day rather than normalising it", () => {
    // Silently reading `?from=2026-13-99` as April 2027 would hand back an
    // empty log with no explanation.
    expect(parseDayRangeParam("2026-13-99", "UTC", "start")).toBeNull();
    expect(parseDayRangeParam("2026-02-31", "UTC", "start")).toBeNull();
    expect(parseDayRangeParam("2026-04-15", "UTC", "start")).not.toBeNull();
  });

  it("the takenAt door rejects one too, rather than storing a normalised dose", () => {
    const base = { doseId: "d1", quantity: "1" };
    for (const takenAt of ["2026-02-31T10:00", "2026-13-01T10:00", "2026-04-15T25:00"]) {
      expect(doseEditSchema.safeParse({ ...base, takenAt }).success).toBe(false);
    }
    expect(doseEditSchema.safeParse({ ...base, takenAt: "2026-04-15T10:00" }).success).toBe(true);
  });
});

describe("formatDateTimeLocal — the inverse of parseDateTimeLocal", () => {
  // The dose-edit modal renders with this and the server parses back with
  // parseDateTimeLocal, so a round-trip that moves the instant is a silent
  // rewrite of stored history on a save the user thought was a no-op.
  it.each([
    ["America/New_York", "2026-06-15T12:30:00.000Z"],
    ["Pacific/Auckland", "2026-06-15T12:30:00.000Z"],
    ["Asia/Katmandu", "2026-06-15T12:30:00.000Z"],
    ["Europe/London", "2026-10-25T00:30:00.000Z"],
    ["America/Godthab", "2026-03-29T01:30:00.000Z"],
  ])("%s round-trips %s unchanged", (timezone, iso) => {
    const original = new Date(iso);
    const rendered = formatDateTimeLocal(original, timezone);

    expect(rendered).toBe(localOf(original, timezone).replace(", ", "T"));
    expect(parseDateTimeLocal(rendered, timezone).toISOString()).toBe(iso);
  });

  it("renders the PROFILE zone, not the runtime's — the bug it replaces", () => {
    // The retired helper offset by `new Date().getTimezoneOffset()`, so the
    // value depended on the viewer's device rather than their settings.
    const instant = new Date("2026-06-15T12:30:00.000Z");

    expect(formatDateTimeLocal(instant, "America/New_York")).toBe("2026-06-15T08:30");
    expect(formatDateTimeLocal(instant, "Pacific/Auckland")).toBe("2026-06-16T00:30");
    expect(formatDateTimeLocal(instant, "Asia/Katmandu")).toBe("2026-06-15T18:15");
  });

  it("pads a year below 1000 to four digits", () => {
    expect(formatDateTimeLocal(new Date("0999-04-15T12:00:00Z"), "UTC")).toBe("0999-04-15T12:00");
  });
});

describe("doseEditSchema.takenAt — a shape check at the door", () => {
  const base = { doseId: "dose-1", quantity: "1" };

  it.each(["2026-04-15T18:20", "2026-04-15T18:20:30"])("accepts %s", (takenAt) => {
    expect(doseEditSchema.safeParse({ ...base, takenAt }).success).toBe(true);
  });

  it.each(["x", "", "2026-04-15", "18:20", "2026-04-15 18:20", "2026-04-15T18:20:30.000Z"])(
    "rejects %s rather than letting the parser throw a 500",
    (takenAt) => {
      expect(doseEditSchema.safeParse({ ...base, takenAt }).success).toBe(false);
    },
  );

  it("every accepted value is one parseDateTimeLocal can resolve", () => {
    // The two must not be able to drift apart: anything the door admits has
    // to reach a Date, or the 500 comes straight back.
    for (const takenAt of ["2026-04-15T18:20", "2026-03-08T02:30", "0999-04-15T00:00"]) {
      const parsed = doseEditSchema.safeParse({ ...base, takenAt });
      expect(parsed.success).toBe(true);
      expect(
        Number.isNaN(parseDateTimeLocal(parsed.data!.takenAt, "America/New_York").getTime()),
      ).toBe(false);
    }
  });
});

describe("parseDayRangeParam — a bare day key is a civil day, not a UTC midnight", () => {
  it("reads the start edge in the user's zone", () => {
    expect(parseDayRangeParam("2026-04-15", "Europe/London", "start")?.toISOString()).toBe(
      "2026-04-14T23:00:00.000Z",
    );
    expect(parseDayRangeParam("2026-04-15", "Pacific/Auckland", "start")?.toISOString()).toBe(
      "2026-04-14T12:00:00.000Z",
    );
  });

  it("returns an EXCLUSIVE end so the whole requested day is in range", () => {
    // `new Date("2026-04-15")` is 00:00Z, which bounded the query BEFORE the
    // day it names — east of UTC the entire end day was excluded.
    const end = parseDayRangeParam("2026-04-15", "Europe/London", "end");
    expect(end?.toISOString()).toBe("2026-04-15T23:00:00.000Z");

    // The last local instant of 15 April is inside; the first of the 16th is not.
    const lastMoment = new Date(end!.getTime() - 1);
    expect(isoDayKey(lastMoment, "Europe/London")).toBe("2026-04-15");
    expect(isoDayKey(end!, "Europe/London")).toBe("2026-04-16");
  });

  it("spans a 25-hour civil day without clipping it", () => {
    const start = parseDayRangeParam("2026-10-25", "Europe/London", "start")!;
    const end = parseDayRangeParam("2026-10-25", "Europe/London", "end")!;
    expect(end.getTime() - start.getTime()).toBe(25 * 3_600_000);
  });

  it("passes a full ISO timestamp straight through", () => {
    expect(
      parseDayRangeParam("2026-04-15T10:30:00Z", "Europe/London", "start")?.toISOString(),
    ).toBe("2026-04-15T10:30:00.000Z");
  });

  it.each(["x", "not-a-date", "2026-13-99T99:99", "%"])(
    "returns null for %s rather than an Invalid Date",
    (value) => {
      expect(parseDayRangeParam(value, "Europe/London", "start")).toBeNull();
    },
  );

  it.each([null, undefined, ""])("returns null for an absent param (%s)", (value) => {
    expect(parseDayRangeParam(value, "Europe/London", "start")).toBeNull();
  });
});
