import { describe, it, expect } from "vitest";
import {
  computeOverdueSlot,
  isScheduleOverdue,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
  type OverdueRow,
} from "$lib/server/reminders/domain";

const now = new Date("2026-05-01T15:00:00.000Z");

function intervalRow(opts: {
  intervalHours?: string | null;
  lastEventAt?: Date | null;
  userTimezone?: string;
}): OverdueRow {
  return {
    scheduleKind: "interval",
    intervalHours: opts.intervalHours ?? null,
    timeOfDay: null,
    daysOfWeek: null,
    userTimezone: opts.userTimezone ?? "UTC",
    lastEventAt: opts.lastEventAt ?? null,
  };
}

function fixedTimeRow(opts: {
  timeOfDay?: string | null;
  daysOfWeek?: number[] | null;
  userTimezone?: string;
  lastEventAt?: Date | null;
}): OverdueRow {
  return {
    scheduleKind: "fixed_time",
    intervalHours: null,
    timeOfDay: opts.timeOfDay ?? null,
    daysOfWeek: opts.daysOfWeek ?? null,
    userTimezone: opts.userTimezone ?? "UTC",
    lastEventAt: opts.lastEventAt ?? null,
  };
}

describe("buildOverdueDedupeKey", () => {
  it("is deterministic for the same inputs", () => {
    const slot = new Date("2026-05-01T08:00:00.000Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot)).toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot),
    );
  });

  it("differs when slot differs", () => {
    const a = buildOverdueDedupeKey("u", "m", "fixed_time", "s", new Date("2026-05-01T08:00:00Z"));
    const b = buildOverdueDedupeKey("u", "m", "fixed_time", "s", new Date("2026-05-01T20:00:00Z"));
    expect(a).not.toBe(b);
  });

  it("differs when scheduleId differs", () => {
    const slot = new Date("2026-05-01T08:00:00Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s1", slot)).not.toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s2", slot),
    );
  });

  it("encodes the slot as ISO-8601", () => {
    const slot = new Date("2026-05-01T08:00:00.000Z");
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", slot)).toContain(
      "2026-05-01T08:00:00.000Z",
    );
  });
});

describe("buildLowInventoryDedupeKey", () => {
  it("changes only when the count changes", () => {
    expect(buildLowInventoryDedupeKey("u", "m", 5)).toBe(buildLowInventoryDedupeKey("u", "m", 5));
    expect(buildLowInventoryDedupeKey("u", "m", 5)).not.toBe(
      buildLowInventoryDedupeKey("u", "m", 4),
    );
  });

  it("includes the low_inventory marker so it cannot collide with overdue keys", () => {
    expect(buildLowInventoryDedupeKey("u", "m", 5)).toContain(":low_inventory:");
  });
});

describe("isScheduleOverdue — interval schedules", () => {
  it("never-taken interval is not overdue (no baseline)", () => {
    expect(isScheduleOverdue(intervalRow({ intervalHours: "6" }), now)).toBe(false);
  });

  it("interval taken inside the window is not overdue", () => {
    const oneHourAgo = new Date(now.getTime() - 3_600_000);
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastEventAt: oneHourAgo }), now),
    ).toBe(false);
  });

  it("interval taken longer ago than the window is overdue", () => {
    const eightHoursAgo = new Date(now.getTime() - 8 * 3_600_000);
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastEventAt: eightHoursAgo }), now),
    ).toBe(true);
  });

  it("interval at exactly the window boundary is not overdue (strict greater-than)", () => {
    const sixHoursAgo = new Date(now.getTime() - 6 * 3_600_000);
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastEventAt: sixHoursAgo }), now),
    ).toBe(false);
  });
});

describe("isScheduleOverdue — fixed-time schedules (UTC)", () => {
  it("future slot today falls back to yesterday's slot, which was taken → not overdue", () => {
    // Today's 23:00 has not arrived yet, so the most recent elapsed
    // occurrence is yesterday's. A dose at that slot satisfies it.
    const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
    expect(
      isScheduleOverdue(fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }), now),
    ).toBe(false);
  });

  it("past slot today with no dose is overdue", () => {
    expect(isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00" }), now)).toBe(true);
  });

  it("past slot today with a dose inside tolerance is not overdue", () => {
    const slotEightAm = new Date("2026-05-01T08:00:00.000Z");
    expect(
      isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", lastEventAt: slotEightAm }), now),
    ).toBe(false);
  });

  it("past slot today with a dose outside tolerance is overdue", () => {
    // Tolerance is 60 minutes; doses far earlier shouldn't suppress the slot.
    const wayEarlier = new Date("2026-04-30T05:00:00.000Z");
    expect(
      isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", lastEventAt: wayEarlier }), now),
    ).toBe(true);
  });

  it("day-of-week excludes today → not overdue", () => {
    // 2026-05-01 is a Friday (day 5). Restrict to Mon (1) only.
    expect(isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", daysOfWeek: [1] }), now)).toBe(
      false,
    );
  });

  it("day-of-week includes today → still overdue when slot in past", () => {
    // 2026-05-01 is a Friday (day 5).
    expect(isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", daysOfWeek: [5] }), now)).toBe(
      true,
    );
  });
});

describe("computeOverdueSlot — returns the actual slot Date used in dedupe keys", () => {
  it("interval slot is lastEventAt + intervalHours", () => {
    const lastTaken = new Date("2026-05-01T03:00:00.000Z");
    const slot = computeOverdueSlot(
      intervalRow({ intervalHours: "6", lastEventAt: lastTaken }),
      now,
    );
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("fixed-time slot is the slot UTC for today", () => {
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "08:00" }), now);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("returns null when not overdue", () => {
    // Today's 23:00 is still ahead and yesterday's was taken on time.
    const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }), now),
    ).toBeNull();
  });

  it("fixed-time slot falls back to yesterday when today's has not arrived", () => {
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "23:00" }), now);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-04-30T23:00:00.000Z");
  });

  it("interval & fixed-time produce DIFFERENT dedupe keys for the same med", () => {
    const lastTaken = new Date("2026-05-01T03:00:00.000Z");
    const intervalSlot = computeOverdueSlot(
      intervalRow({ intervalHours: "6", lastEventAt: lastTaken }),
      now,
    )!;
    const fixedSlot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "08:00" }), now)!;
    const intervalKey = buildOverdueDedupeKey("u", "m", "interval", "s1", intervalSlot);
    const fixedKey = buildOverdueDedupeKey("u", "m", "fixed_time", "s2", fixedSlot);
    expect(intervalKey).not.toBe(fixedKey);
  });

  it("a zero interval is not a schedule and yields no slot", () => {
    // `intervalHours` is a Drizzle numeric — a STRING — so `"0"` is truthy and
    // `!row.intervalHours` never rejected it. intervalMs became 0, so the slot
    // came back as lastEventAt and the medication was overdue the instant it
    // was logged. One spurious reminder per dose.
    const lastTaken = new Date("2026-05-01T09:00:00.000Z");
    expect(
      computeOverdueSlot(intervalRow({ intervalHours: "0", lastEventAt: lastTaken }), now),
    ).toBeNull();
  });

  it("a zero interval is not overdue", () => {
    const lastTaken = new Date("2026-05-01T09:00:00.000Z");
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "0", lastEventAt: lastTaken }), now),
    ).toBe(false);
  });

  it("an interval above the door cap still produces a slot", () => {
    // 168h weekly. The cap is a door policy; readers must not apply it, or a
    // weekly injection stops reminding entirely. See Decision 3.
    const lastTaken = new Date("2026-04-01T09:00:00.000Z");
    const slot = computeOverdueSlot(
      intervalRow({ intervalHours: "168", lastEventAt: lastTaken }),
      now,
    );
    expect(slot).toEqual(new Date("2026-04-08T09:00:00.000Z"));
  });
});

// ---------------------------------------------------------------------
// Regression: fixed-time slots that fall after the cron tick.
//
// The scan used to evaluate ONLY today's local slot and bail when that
// slot was still in the future. On a once-daily cron that made every
// schedule timed after the tick permanently invisible: future at every
// tick, and by the next tick the local date had rolled over so the
// elapsed occurrence was never revisited. In production this silenced
// three of five fixed-time schedules outright (10:00 UTC, 11:00
// Europe/London and 20:00 UTC against a 09:00 UTC tick).
// ---------------------------------------------------------------------
describe("computeOverdueSlot — look-back across the cron tick", () => {
  // The real production shape: cron fires at 09:00 UTC, medication is
  // due at 20:00 UTC. Before the fix this returned null forever.
  const nineAmTick = new Date("2026-05-01T09:00:00.000Z");

  it("catches an evening slot that elapsed since the previous tick", () => {
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), nineAmTick);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-04-30T20:00:00.000Z");
  });

  it("dedupe key differs per day, so a daily slot reminds once per day", () => {
    const dayOne = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), nineAmTick)!;
    const dayTwo = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-05-02T09:00:00.000Z"),
    )!;
    expect(buildOverdueDedupeKey("u", "m", "fixed_time", "s", dayOne)).not.toBe(
      buildOverdueDedupeKey("u", "m", "fixed_time", "s", dayTwo),
    );
  });

  it("prefers today's elapsed slot over yesterday's", () => {
    // At 15:00 an 08:00 schedule has today's slot already behind it.
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "08:00" }), now);
    expect(slot!.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("does not reach back beyond the look-back window", () => {
    // Sunday-only schedule at 20:00, evaluated Friday 09:00. The most
    // recent Sunday slot is five days old — too stale to act on.
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [0] }), nineAmTick),
    ).toBeNull();
  });

  it("applies day-of-week to the looked-back date, not to today", () => {
    // 2026-05-01 is a Friday, so the fallback lands on Thursday (4).
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [4] }), nineAmTick),
    ).not.toBeNull();
    // Friday-only: yesterday (Thursday) is excluded and today's 20:00
    // has not arrived, so there is nothing to report yet.
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [5] }), nineAmTick),
    ).toBeNull();
  });

  it("a dose taken late still satisfies the slot", () => {
    // Taken at 22:00 for a 20:00 slot — two hours late, well outside
    // the one-hour tolerance, but unmistakably taken. Reporting this as
    // overdue the next morning would be a false alarm.
    const takenLate = new Date("2026-04-30T22:00:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenLate }), nineAmTick),
    ).toBeNull();
  });

  it("a dose taken shortly BEFORE the slot still satisfies it", () => {
    const takenEarly = new Date("2026-04-30T19:30:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenEarly }), nineAmTick),
    ).toBeNull();
  });

  it("a dose taken before the previous slot does not satisfy it", () => {
    const takenTwoDaysBefore = new Date("2026-04-28T20:00:00.000Z");
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenTwoDaysBefore }),
        nineAmTick,
      ),
    ).not.toBeNull();
  });

  it("resolves the look-back slot in the user's timezone during BST", () => {
    // 20:00 Europe/London on 30 Apr is 19:00 UTC (BST, UTC+1).
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      nineAmTick,
    );
    expect(slot!.toISOString()).toBe("2026-04-30T19:00:00.000Z");
  });

  it("resolves the look-back slot in the user's timezone during GMT", () => {
    // 20:00 Europe/London in January is 20:00 UTC (GMT, no offset).
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      new Date("2026-01-15T09:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-01-14T20:00:00.000Z");
  });

  it("crosses a month boundary when looking back", () => {
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-06-01T09:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-05-31T20:00:00.000Z");
  });
});
