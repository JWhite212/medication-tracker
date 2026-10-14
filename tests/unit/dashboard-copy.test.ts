import { describe, it, expect, vi } from "vitest";
import {
  dashboardHeaderCopy,
  doneCoversLine,
  doneDoseText,
  formatDoseLabel,
  formatSlotTime,
  headerEyebrow,
  laterUntil,
  rowStatusLine,
  toastForDoseRemoved,
  toastForLog,
  toastForSkip,
  toastForTookItAt,
  tookItAtLabel,
} from "$lib/utils/dashboard-copy";
import type { DashboardStatus, DueRow } from "$lib/types";
import { formatUserDate, type TimeFormat } from "$lib/utils/time";

// UTC keeps every local time equal to its ISO string. Every 24h time asserted
// here has a two-digit hour on purpose: formatUserTime's en-GB 24h output does
// not pad a single-digit hour ("9:05"), and that is the shared formatter's
// business, not this module's.
const TZ = "UTC";
const TODAY_START = new Date("2026-04-16T00:00:00.000Z");
const at = (iso: string) => new Date(iso);

describe("formatDoseLabel", () => {
  it("joins name and dose the way every dashboard surface already does", () => {
    expect(formatDoseLabel("Metformin", "500", "mg")).toBe("Metformin 500mg");
    expect(formatDoseLabel("Vitamin D", "1000", "IU")).toBe("Vitamin D 1000IU");
  });
});

describe("formatSlotTime", () => {
  it("renders a time on today's civil day plainly", () => {
    expect(formatSlotTime(at("2026-04-16T22:00:00.000Z"), TODAY_START, TZ, "24h")).toBe("22:00");
  });

  it("prefixes 'yesterday' for any instant before today's midnight", () => {
    expect(formatSlotTime(at("2026-04-15T22:00:00.000Z"), TODAY_START, TZ, "24h")).toBe(
      "yesterday 22:00",
    );
    expect(formatSlotTime(at("2026-04-15T23:59:59.999Z"), TODAY_START, TZ, "24h")).toBe(
      "yesterday 23:59",
    );
  });

  it("follows the 12h preference", () => {
    expect(formatSlotTime(at("2026-04-16T13:31:00.000Z"), TODAY_START, TZ, "12h")).toBe("1:31 pm");
  });

  it("decides 'yesterday' against todayStart, in the user's zone", () => {
    // Midnight on 16 April in London (BST) is 23:00Z on the 15th.
    const londonStart = at("2026-04-15T23:00:00.000Z");
    expect(
      formatSlotTime(at("2026-04-15T21:00:00.000Z"), londonStart, "Europe/London", "24h"),
    ).toBe("yesterday 22:00");
    expect(
      formatSlotTime(at("2026-04-16T12:31:00.000Z"), londonStart, "Europe/London", "24h"),
    ).toBe("13:31");
  });
});

describe("rowStatusLine", () => {
  function line(
    expectedTime: string,
    serverNow: string,
    state: DueRow["state"] = "overdue",
    timeFormat: TimeFormat = "24h",
  ): string {
    return rowStatusLine(
      { state, expectedTime: at(expectedTime) },
      at(serverNow),
      TODAY_START,
      TZ,
      timeFormat,
    );
  }

  it("states the slot time and how long ago it was", () => {
    expect(line("2026-04-16T11:00:00.000Z", "2026-04-16T13:00:00.000Z")).toBe(
      "Due 11:00 · 2 hours ago",
    );
  });

  it("floors, so lateness is never overstated", () => {
    expect(line("2026-04-16T11:00:00.000Z", "2026-04-16T13:59:00.000Z")).toBe(
      "Due 11:00 · 2 hours ago",
    );
  });

  it("prefixes an Earlier row's time with 'yesterday'", () => {
    expect(line("2026-04-15T22:00:00.000Z", "2026-04-16T07:00:00.000Z", "earlier")).toBe(
      "Due yesterday 22:00 · 9 hours ago",
    );
  });

  it("counts down to a slot still ahead", () => {
    expect(line("2026-04-16T13:45:00.000Z", "2026-04-16T13:30:00.000Z", "due-now")).toBe(
      "Due 13:45 · in 15 minutes",
    );
  });

  it("says 'now' for anything under a minute either side", () => {
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:30:59.999Z", "due-now")).toBe(
      "Due 13:30 · now",
    );
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:29:00.001Z", "due-now")).toBe(
      "Due 13:30 · now",
    );
  });

  it("switches to minutes at exactly one minute, singular", () => {
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:31:00.000Z", "due-now")).toBe(
      "Due 13:30 · 1 minute ago",
    );
    expect(line("2026-04-16T13:30:00.000Z", "2026-04-16T13:29:00.000Z", "due-now")).toBe(
      "Due 13:30 · in 1 minute",
    );
  });

  it("takes 'ago' or 'in' from the clock, never from the state", () => {
    // A due-now row half an hour past its slot still reads "ago".
    expect(line("2026-04-16T13:00:00.000Z", "2026-04-16T13:30:00.000Z", "due-now")).toBe(
      "Due 13:00 · 30 minutes ago",
    );
  });

  it("follows the 12h preference", () => {
    expect(line("2026-04-16T13:45:00.000Z", "2026-04-16T13:30:00.000Z", "due-now", "12h")).toBe(
      "Due 1:45 pm · in 15 minutes",
    );
  });
});

describe("dashboardHeaderCopy", () => {
  const SERVER_NOW = at("2026-04-16T17:00:00.000Z");
  const NEXT = {
    name: "Lisinopril",
    dosageAmount: "10",
    dosageUnit: "mg",
    expectedTime: "2026-04-16T20:00:00.000Z",
    alsoCount: 0,
  };
  const status = (overrides: Partial<DashboardStatus>): DashboardStatus => ({
    kind: "due",
    dueCount: 0,
    doneToday: 0,
    totalToday: 0,
    loggedToday: 0,
    next: null,
    ...overrides,
  });
  const copy = (s: DashboardStatus, timeFormat: TimeFormat = "24h") =>
    dashboardHeaderCopy(s, SERVER_NOW, TZ, timeFormat);

  it("due: counts every Due row and how much of today is done", () => {
    expect(copy(status({ kind: "due", dueCount: 5, doneToday: 2, totalToday: 7 }))).toEqual({
      sentence: "5 doses due",
      supporting: "2 of 7 done today",
    });
  });

  it("due: singular, and no progress line while nothing today is done", () => {
    expect(copy(status({ kind: "due", dueCount: 1, doneToday: 0, totalToday: 7 }))).toEqual({
      sentence: "1 dose due",
      supporting: null,
    });
  });

  it("caught-up: names the next slot and how far away it is", () => {
    expect(copy(status({ kind: "caught-up", next: NEXT }))).toEqual({
      sentence: "All caught up",
      supporting: "Next: Lisinopril 10mg at 20:00 · in 3 hours",
    });
  });

  it("caught-up: folds other slots at the same instant into 'and N more'", () => {
    expect(copy(status({ kind: "caught-up", next: { ...NEXT, alsoCount: 2 } })).supporting).toBe(
      "Next: Lisinopril 10mg and 2 more at 20:00 · in 3 hours",
    );
  });

  it("caught-up: follows the 12h preference", () => {
    expect(copy(status({ kind: "caught-up", next: NEXT }), "12h").supporting).toBe(
      "Next: Lisinopril 10mg at 8:00 pm · in 3 hours",
    );
  });

  it("caught-up: no supporting line without a next slot", () => {
    expect(copy(status({ kind: "caught-up", next: null }))).toEqual({
      sentence: "All caught up",
      supporting: null,
    });
  });

  it("all-done", () => {
    expect(copy(status({ kind: "all-done", doneToday: 7, totalToday: 7 }))).toEqual({
      sentence: "All done for today",
      supporting: "7 of 7 done today",
    });
  });

  it("none-today: reports what was logged, and omits the line at zero", () => {
    expect(copy(status({ kind: "none-today", loggedToday: 2 }))).toEqual({
      sentence: "Nothing scheduled today",
      supporting: "2 doses logged today",
    });
    expect(copy(status({ kind: "none-today", loggedToday: 1 })).supporting).toBe(
      "1 dose logged today",
    );
    expect(copy(status({ kind: "none-today", loggedToday: 0 })).supporting).toBeNull();
  });

  it("as-needed-only: the count is the sentence, the hint is the line", () => {
    expect(copy(status({ kind: "as-needed-only", loggedToday: 2 }))).toEqual({
      sentence: "2 doses logged today",
      supporting: "Tap a medication below to log a dose.",
    });
    expect(copy(status({ kind: "as-needed-only", loggedToday: 1 })).sentence).toBe(
      "1 dose logged today",
    );
    expect(copy(status({ kind: "as-needed-only", loggedToday: 0 })).sentence).toBe(
      "No doses logged yet today",
    );
  });

  it("never prints 'overdue' — that word lives only in StatusMarker's accessible name", () => {
    const every: DashboardStatus[] = [
      status({ kind: "due", dueCount: 3, doneToday: 1, totalToday: 4 }),
      status({ kind: "caught-up", next: NEXT }),
      status({ kind: "all-done", doneToday: 2, totalToday: 2 }),
      status({ kind: "none-today", loggedToday: 1 }),
      status({ kind: "as-needed-only", loggedToday: 1 }),
    ];
    for (const s of every) {
      const { sentence, supporting } = copy(s);
      expect(`${sentence} ${supporting ?? ""}`).not.toMatch(/overdue/i);
    }
    expect(
      rowStatusLine(
        { state: "overdue", expectedTime: at("2026-04-16T11:00:00.000Z") },
        SERVER_NOW,
        TODAY_START,
        TZ,
        "24h",
      ),
    ).not.toMatch(/overdue/i);
  });
});

describe("toast builders", () => {
  const clock = { todayStart: TODAY_START, tz: TZ, timeFormat: "24h" as TimeFormat };
  const LOGGED_AT = at("2026-04-16T13:31:00.000Z");

  it("Log now: says which slots the dose counted for, in time order", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [
          at("2026-04-16T12:00:00.000Z"),
          at("2026-04-16T10:55:00.000Z"),
          at("2026-04-16T11:00:00.000Z"),
        ],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 10:55, 11:00 and 12:00 doses");
  });

  it("joins two slots with 'and'", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T10:55:00.000Z"), at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 10:55 and 11:00 doses");
  });

  it("names a single slot in the singular", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 13:31 — counted for your 11:00 dose");
  });

  it("prefixes a slot before midnight with 'yesterday'", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: at("2026-04-16T10:31:00.000Z"),
        covers: [at("2026-04-15T22:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 10:31 — counted for your yesterday 22:00 dose");
  });

  it("drops the clause when the dose counted for nothing (also the reload-failed fallback)", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [],
      }),
    ).toBe("Metformin 500mg logged at 13:31");
  });

  it("shows the quantity when a chip logged more than one", () => {
    expect(
      toastForLog({
        ...clock,
        label: "Ibuprofen 200mg",
        quantity: 2,
        takenAt: LOGGED_AT,
        covers: [],
      }),
    ).toBe("Ibuprofen 200mg ×2 logged at 13:31");
  });

  it("follows the 12h preference", () => {
    expect(
      toastForLog({
        ...clock,
        timeFormat: "12h",
        label: "Metformin 500mg",
        quantity: 1,
        takenAt: LOGGED_AT,
        covers: [at("2026-04-16T11:00:00.000Z")],
      }),
    ).toBe("Metformin 500mg logged at 1:31 pm — counted for your 11:00 am dose");
  });

  it("Took it at: names the recorded time, prefixed when it was yesterday", () => {
    expect(
      toastForTookItAt({ ...clock, label: "Metformin 500mg", at: at("2026-04-15T22:00:00.000Z") }),
    ).toBe("Metformin 500mg recorded as taken at yesterday 22:00");
    expect(
      toastForTookItAt({ ...clock, label: "Metformin 500mg", at: at("2026-04-16T11:00:00.000Z") }),
    ).toBe("Metformin 500mg recorded as taken at 11:00");
  });

  it("Skip: names the slot, prefixed when it was yesterday", () => {
    expect(
      toastForSkip({ ...clock, label: "Metformin 500mg", slot: at("2026-04-16T11:00:00.000Z") }),
    ).toBe("Metformin 500mg: 11:00 dose skipped");
    expect(
      toastForSkip({ ...clock, label: "Metformin 500mg", slot: at("2026-04-15T22:00:00.000Z") }),
    ).toBe("Metformin 500mg: yesterday 22:00 dose skipped");
  });
});

describe("toastForDoseRemoved", () => {
  // One sentence for a delete's Undo offer, on /log and in the dashboard's
  // edit dialog. The caller decides the day; nothing here reads a heading.
  it.each<[Parameters<typeof toastForDoseRemoved>[2], string]>([
    ["today", "Dose removed: Metformin 500mg at 22:00"],
    ["yesterday", "Dose removed: Metformin 500mg yesterday at 22:00"],
    [{ on: "Tue 14 Apr" }, "Dose removed: Metformin 500mg on Tue 14 Apr at 22:00"],
  ])("names the day %j", (day, message) => {
    expect(toastForDoseRemoved("Metformin 500mg", "22:00", day)).toBe(message);
  });
});

describe("headerEyebrow", () => {
  // Noon UTC on Thursday 24 September 2026.
  const NOON = at("2026-09-24T12:00:00.000Z");

  it("is formatUserDate with a weekday and no year, in every date format", () => {
    for (const dateFormat of ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const) {
      expect(headerEyebrow(NOON, TZ, dateFormat)).toBe(
        formatUserDate(NOON, TZ, dateFormat, { weekday: true, year: false }),
      );
    }
  });

  it("lets the preference order the fields, and never adds a year to a named month", () => {
    // en-GB's short September is "Sept" on ICU 72+ and "Sep" before it. This
    // runs in the viewer's browser, so the shape is pinned, not the spelling.
    expect(headerEyebrow(NOON, TZ, "DD/MM/YYYY")).toMatch(/^Thu 24 Sept?$/);
    expect(headerEyebrow(NOON, TZ, "MM/DD/YYYY")).toMatch(/^Thu, Sep 24$/);
    // ISO is assembled field by field, and always carries its year.
    expect(headerEyebrow(NOON, TZ, "YYYY-MM-DD")).toBe("Thu, 2026-09-24");
  });

  it("names the day in the user's zone, not the server's", () => {
    // 23:30 UTC on the 24th is already Friday the 25th in Auckland (NZST, +12).
    const late = at("2026-09-24T23:30:00.000Z");
    expect(headerEyebrow(late, "UTC", "YYYY-MM-DD")).toBe("Thu, 2026-09-24");
    expect(headerEyebrow(late, "Pacific/Auckland", "YYYY-MM-DD")).toBe("Fri, 2026-09-25");
  });
});

describe("laterUntil", () => {
  const SERVER_NOW = at("2026-04-16T13:00:00.000Z");
  const until = (expectedTime: string) => laterUntil(expectedTime, SERVER_NOW);

  it("says how far off a Later row is, in words", () => {
    expect(until("2026-04-16T20:00:00.000Z")).toBe("in 7 hours");
    expect(until("2026-04-16T14:00:00.000Z")).toBe("in 1 hour");
    expect(until("2026-04-16T13:45:00.000Z")).toBe("in 45 minutes");
  });

  it("shows one unit, floored, like every duration on the page", () => {
    expect(until("2026-04-16T14:30:00.000Z")).toBe("in 1 hour");
    expect(until("2026-04-16T20:59:00.000Z")).toBe("in 7 hours");
  });

  it("measures from the page's serverNow, never the device clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(at("2027-03-01T00:00:00.000Z"));
      expect(until("2026-04-16T20:00:00.000Z")).toBe("in 7 hours");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("doneDoseText", () => {
  const text = (quantity: number, status = "taken") =>
    doneDoseText({ dosageAmount: "500", dosageUnit: "mg", quantity, status });

  it("is the medication's dose, with no multiplier for a single dose", () => {
    expect(text(1)).toBe("500mg");
    expect(
      doneDoseText({ dosageAmount: "2.5", dosageUnit: "ml", quantity: 1, status: "taken" }),
    ).toBe("2.5ml");
  });

  it("adds ×n to a taken dose of more than one", () => {
    expect(text(2)).toBe("500mg ×2");
    expect(text(4)).toBe("500mg ×4");
  });

  it("never shows a quantity on a skipped or missed row", () => {
    expect(text(3, "skipped")).toBe("500mg");
    expect(text(2, "missed")).toBe("500mg");
  });
});

describe("doneCoversLine", () => {
  const line = (covers: string[], timeFormat: TimeFormat = "24h") =>
    doneCoversLine(covers, TODAY_START, TZ, timeFormat);

  it("is null when the dose resolved no slot beyond its own minute", () => {
    expect(line([])).toBeNull();
  });

  it("lists the slots the dose resolved, prefixing yesterday's", () => {
    expect(
      line(["2026-04-15T22:30:00.000Z", "2026-04-16T10:55:00.000Z", "2026-04-16T11:00:00.000Z"]),
    ).toBe("for yesterday 22:30, 10:55, 11:00");
  });

  it("keeps the order it is given: the composer sorts covers, this only words them", () => {
    expect(line(["2026-04-16T11:00:00.000Z", "2026-04-16T10:55:00.000Z"])).toBe("for 11:00, 10:55");
  });

  it("follows the 12h preference", () => {
    expect(line(["2026-04-16T13:31:00.000Z"], "12h")).toMatch(/^for 0?1:31 pm$/);
  });

  it("decides 'yesterday' against todayStart, in the user's zone", () => {
    // Midnight on 16 April in London (BST) is 23:00Z on the 15th.
    const londonStart = at("2026-04-15T23:00:00.000Z");
    expect(doneCoversLine(["2026-04-15T21:00:00.000Z"], londonStart, "Europe/London", "24h")).toBe(
      "for yesterday 22:00",
    );
  });
});

describe("tookItAtLabel", () => {
  it("names the instant Took it at records", () => {
    expect(tookItAtLabel("11:00")).toBe("Took it at 11:00");
  });

  it("carries an Earlier row's day, because its time arrives already prefixed", () => {
    const time = formatSlotTime(at("2026-04-15T22:00:00.000Z"), TODAY_START, TZ, "24h");
    expect(tookItAtLabel(time)).toBe("Took it at yesterday 22:00");
  });
});
