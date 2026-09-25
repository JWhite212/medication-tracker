import { describe, it, expect } from "vitest";
import {
  dashboardHeaderCopy,
  formatDoseLabel,
  formatSlotTime,
  rowStatusLine,
  toastForLog,
  toastForSkip,
  toastForTookItAt,
} from "$lib/utils/dashboard-copy";
import type { DashboardStatus, DueRow } from "$lib/types";
import type { TimeFormat } from "$lib/utils/time";

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
