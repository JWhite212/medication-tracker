import { describe, it, expect } from "vitest";
import {
  computeOverdueSlot,
  isScheduleOverdue,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
  computeNagIndex,
  LOW_INVENTORY_NAG_POLICY,
  NO_REPEAT,
  type OverdueRow,
  type NagPolicy,
} from "$lib/server/reminders/domain";
import { CARRY_OVER_MS, checkSlotActionTime } from "$lib/utils/schedule";

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

// This describe used to open with "changes only when the count changes",
// which was the defect written down as a requirement: the count in the key
// made the THRESHOLD decide the alert volume (a threshold of 10 sent eleven
// alerts on one descent), and then suppressed each individual count for the
// 90-day life of its reminder_events row — so a user who refilled and ran
// low again heard nothing at all. The key is now scoped to the episode.
describe("buildLowInventoryDedupeKey", () => {
  const episode = new Date("2026-05-01T08:00:00.000Z");
  const laterEpisode = new Date("2026-06-01T08:00:00.000Z");

  it("changes only when the episode changes", () => {
    expect(buildLowInventoryDedupeKey("u", "m", episode)).toBe(
      buildLowInventoryDedupeKey("u", "m", episode),
    );
    expect(buildLowInventoryDedupeKey("u", "m", episode)).not.toBe(
      buildLowInventoryDedupeKey("u", "m", laterEpisode),
    );
  });

  it("is stable while the count moves inside one episode", () => {
    // The property the old key could not have: the count is no longer an
    // input, so running 10 → 9 → 8 cannot mint three keys.
    const key = buildLowInventoryDedupeKey("u", "m", episode);
    expect(buildLowInventoryDedupeKey("u", "m", episode)).toBe(key);
  });

  it("encodes the episode as ISO-8601", () => {
    expect(buildLowInventoryDedupeKey("u", "m", episode)).toContain("2026-05-01T08:00:00.000Z");
  });

  it("appends nothing for the first alert of an episode", () => {
    // Same convention as buildOverdueDedupeKey: index 0 is the bare key.
    expect(buildLowInventoryDedupeKey("u", "m", episode, 0)).toBe(
      buildLowInventoryDedupeKey("u", "m", episode),
    );
  });

  it("distinguishes each bounded nudge within one episode", () => {
    const first = buildLowInventoryDedupeKey("u", "m", episode, 0);
    const second = buildLowInventoryDedupeKey("u", "m", episode, 1);
    const third = buildLowInventoryDedupeKey("u", "m", episode, 2);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(second).toContain(":n1");
  });

  it("includes the low_inventory marker so it cannot collide with overdue keys", () => {
    expect(buildLowInventoryDedupeKey("u", "m", episode)).toContain(":low_inventory:");
  });
});

describe("LOW_INVENTORY_NAG_POLICY", () => {
  it("bounds an episode to three alerts", () => {
    // Chosen, not emergent. The shipped behaviour sent `threshold + 1`
    // alerts, a number nobody picked.
    expect(LOW_INVENTORY_NAG_POLICY.maxRepeats).toBe(2);
  });

  it("paces the nudges in days, not the minutes an overdue dose uses", () => {
    // The per-medication notifyRepeatEveryMinutes is deliberately NOT used
    // here: a medication set to repeat every 30 minutes would otherwise nag
    // about its stock every 30 minutes.
    expect(LOW_INVENTORY_NAG_POLICY.repeatEveryMinutes).toBe(24 * 60);
  });

  it("fires the first alert immediately and then one a day, capped", () => {
    const episode = new Date("2026-05-01T08:00:00.000Z");
    const at = (hours: number) =>
      computeNagIndex(
        episode,
        LOW_INVENTORY_NAG_POLICY,
        new Date(episode.getTime() + hours * 3_600_000),
      );
    expect(at(0)).toBe(0);
    expect(at(23)).toBe(0);
    expect(at(25)).toBe(1);
    expect(at(49)).toBe(2);
    // ...and then silent for the rest of the episode, however long it runs.
    expect(at(24 * 30)).toBe(2);
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
    //
    // Evaluated at 09:00, ten hours after the slot. At the suite's 15:00
    // `now` the slot is 16 hours old, and the pre-midnight cap returns null
    // before the dose is ever consulted. This case would then pass even
    // with the late-dose rule deleted.
    const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
    expect(
      isScheduleOverdue(
        fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
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
    // Evaluated at 09:00, ten hours after the slot. At the suite's 15:00
    // `now` the pre-midnight cap returns null first and the dose is never
    // consulted.
    const yesterdayEvening = new Date("2026-04-30T23:00:00.000Z");
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "23:00", lastEventAt: yesterdayEvening }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("fixed-time slot falls back to yesterday when today's has not arrived", () => {
    // 09:00, ten hours after yesterday's 23:00, which is inside the 12-hour cap.
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "23:00" }),
      new Date("2026-05-01T09:00:00.000Z"),
    );
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
  // The original production shape was a daily cron at 09:00 UTC and a
  // medication due at 20:00 UTC. Before the look-back, that returned null
  // forever. The 09:00 tick is now deliberately silent about yesterday's
  // 20:00: the slot is thirteen hours old and past the pre-midnight cap
  // (see the next describe). So the look-back is exercised at 06:00 UTC,
  // the first reminder-tick run of the day ("*/30 6-22 * * *"), ten hours
  // after the slot. Every case keeps the property it is named for.
  const sixAmTick = new Date("2026-05-01T06:00:00.000Z");

  it("catches an evening slot that elapsed since the previous tick", () => {
    const slot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), sixAmTick);
    expect(slot).not.toBeNull();
    expect(slot!.toISOString()).toBe("2026-04-30T20:00:00.000Z");
  });

  it("dedupe key differs per day, so a daily slot reminds once per day", () => {
    const dayOne = computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00" }), sixAmTick)!;
    const dayTwo = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-05-02T06:00:00.000Z"),
    )!;
    expect(dayOne.toISOString()).toBe("2026-04-30T20:00:00.000Z");
    expect(dayTwo.toISOString()).toBe("2026-05-01T20:00:00.000Z");
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
    // Sunday-only schedule at 20:00, evaluated Friday 06:00. The most
    // recent Sunday slot is five days old, too stale to act on. (The
    // 12-hour cap would silence it as well: every slot two or more days
    // back is already past the cap.)
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [0] }), sixAmTick),
    ).toBeNull();
  });

  it("applies day-of-week to the looked-back date, not to today", () => {
    // 2026-05-01 is a Friday, so the fallback lands on Thursday (4).
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [4] }), sixAmTick),
    ).not.toBeNull();
    // Friday-only: yesterday (Thursday) is excluded and today's 20:00
    // has not arrived, so there is nothing to report yet.
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", daysOfWeek: [5] }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken late still satisfies the slot", () => {
    // Taken at 22:00 for a 20:00 slot: two hours late, well outside the
    // one-hour tolerance, but clearly taken. Reporting it as overdue the
    // next morning would be a false alarm.
    const takenLate = new Date("2026-04-30T22:00:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenLate }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken shortly BEFORE the slot still satisfies it", () => {
    const takenEarly = new Date("2026-04-30T19:30:00.000Z");
    expect(
      computeOverdueSlot(fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenEarly }), sixAmTick),
    ).toBeNull();
  });

  it("a dose taken before the previous slot does not satisfy it", () => {
    const takenTwoDaysBefore = new Date("2026-04-28T20:00:00.000Z");
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00", lastEventAt: takenTwoDaysBefore }),
        sixAmTick,
      ),
    ).not.toBeNull();
  });

  it("resolves the look-back slot in the user's timezone during BST", () => {
    // 20:00 Europe/London on 30 Apr is 19:00 UTC (BST, UTC+1), eleven
    // hours before the tick.
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      sixAmTick,
    );
    expect(slot!.toISOString()).toBe("2026-04-30T19:00:00.000Z");
  });

  it("resolves the look-back slot in the user's timezone during GMT", () => {
    // 20:00 Europe/London in January is 20:00 UTC (GMT, no offset).
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00", userTimezone: "Europe/London" }),
      new Date("2026-01-15T06:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-01-14T20:00:00.000Z");
  });

  it("crosses a month boundary when looking back", () => {
    const slot = computeOverdueSlot(
      fixedTimeRow({ timeOfDay: "20:00" }),
      new Date("2026-06-01T06:00:00.000Z"),
    );
    expect(slot!.toISOString()).toBe("2026-05-31T20:00:00.000Z");
  });
});

// ---------------------------------------------------------------------
// The 12-hour cap on pre-midnight fixed-time slots.
//
// The dashboard shows an unresolved slot from before local midnight under
// "Earlier" until it is 12 hours old, then drops it. The cron now stops at
// the same instant, so a reminder never points at a row the dashboard no
// longer offers. The bound is CARRY_OVER_MS, imported rather than written
// out again, and it applies to fixed-time rows only.
// ---------------------------------------------------------------------
describe("computeOverdueSlot — pre-midnight fixed-time slots stop at 12 hours", () => {
  const eightPmYesterday = new Date("2026-04-30T20:00:00.000Z");

  it("uses the dashboard's CARRY_OVER_MS as the boundary", () => {
    expect(new Date("2026-05-01T08:00:00.000Z").getTime() - eightPmYesterday.getTime()).toBe(
      CARRY_OVER_MS,
    );
  });

  it("returns null for a pre-midnight slot exactly 12 hours old", () => {
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T08:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("still returns a pre-midnight slot 1ms short of 12 hours", () => {
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T07:59:59.999Z"),
      ),
    ).toEqual(eightPmYesterday);
  });

  it("the daily 09:00 UTC backstop returns null for the previous day's 20:00", () => {
    // This is the shape the look-back was first written for. The slot is
    // thirteen hours old at the Vercel cron's only run, and the dashboard
    // has already dropped it, so the cron drops it too. The accepted cost
    // is written up in .github/workflows/reminder-tick.yml.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "20:00" }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("never caps today's slot, however old", () => {
    // Today's rows stay on the dashboard until midnight, so they keep
    // reminding until then: a 00:30 slot is 23 hours old at 23:30.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "00:30" }),
        new Date("2026-05-01T23:30:00.000Z"),
      ),
    ).toEqual(new Date("2026-05-01T00:30:00.000Z"));
  });

  it("measures midnight in the user's zone, not UTC", () => {
    // 00:30 BST on 1 May is 23:30Z on 30 April. That is yesterday in UTC
    // but TODAY for the user, so twelve and a half hours later it must
    // still remind.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "00:30", userTimezone: "Europe/London" }),
        new Date("2026-05-01T12:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-30T23:30:00.000Z"));
  });

  it("compares by instant, so a slot that rolled past midnight counts as today's", () => {
    // Godthab springs forward at 23:00 on Saturday 2026-03-28, so
    // Saturday's 23:30 resolves to 01:30Z, after Sunday's local midnight
    // (01:00Z). The dashboard files it under Sunday by instant. A day-key
    // test here ("every slot one day back is pre-midnight") would silence
    // it at 13:30Z while the dashboard still shows it as a Sunday row.
    expect(
      computeOverdueSlot(
        fixedTimeRow({ timeOfDay: "23:30", userTimezone: "America/Godthab" }),
        new Date("2026-03-29T14:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-03-29T01:30:00.000Z"));
  });

  it("does not cap interval rows", () => {
    // An interval reminder is for the FIRST missed occurrence after the
    // last event, not for a projected day. Capping it would silently end
    // that medication's reminders. Aligning the two belongs to the
    // due-ness unification.
    expect(
      computeOverdueSlot(
        intervalRow({ intervalHours: "6", lastEventAt: new Date("2026-04-30T06:00:00.000Z") }),
        new Date("2026-05-01T09:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-04-30T12:00:00.000Z"));
  });

  it("falls silent at exactly the instant the dashboard stops offering the row", () => {
    // One row and one clock, checked against both surfaces: the cron
    // returns null exactly when checkSlotActionTime calls the slot stale.
    // The sweep runs at the reminder-tick cadence across the day in which
    // yesterday's 20:00 BST is the latest elapsed candidate, plus one tick
    // either side of the boundary.
    const tz = "Europe/London";
    const row = fixedTimeRow({ timeOfDay: "20:00", userTimezone: tz });
    const slot = new Date("2026-04-30T19:00:00.000Z"); // 20:00 BST
    const ticks: Date[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += 30) {
      ticks.push(new Date(slot.getTime() + minutes * 60_000));
    }
    ticks.push(
      new Date(slot.getTime() + CARRY_OVER_MS - 1),
      new Date(slot.getTime() + CARRY_OVER_MS),
    );

    let silent = 0;
    for (const tick of ticks) {
      const reminded = computeOverdueSlot(row, tick);
      const stale = checkSlotActionTime(slot, tick, tz) === "stale";
      expect(reminded === null, tick.toISOString()).toBe(stale);
      if (reminded === null) silent++;
      else expect(reminded, tick.toISOString()).toEqual(slot);
    }
    // Non-vacuous in both directions: the sweep sees the row reminded AND
    // silenced (24 half-hour ticks from 12h to 23.5h, plus the exact-12h tick).
    expect(silent).toBe(25);
  });
});

describe("overdue dedupe key — pinned contract (pre-nag-ordinal)", () => {
  const slot = new Date("2026-05-01T08:00:00.000Z");

  it("has exactly six colon-separated segments and no nag suffix", () => {
    const key = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", slot);
    expect(key).toBe("u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z");
  });

  it("one slot yields exactly one key however far `now` advances", () => {
    // The #110 invariant, exercised directly against the key rather than
    // against two hand-picked instants: sweep `now` across the rest of
    // the slot's local day and confirm every resulting key collapses to
    // the same one. A key that churned with `now` would produce distinct
    // Set members here instead of one.
    const row = fixedTimeRow({ timeOfDay: "08:00", lastEventAt: null });
    const keys = new Set<string>();
    for (let minutesAfterSlot = 0; minutesAfterSlot <= 14 * 60; minutesAfterSlot += 30) {
      const now = new Date(slot.getTime() + minutesAfterSlot * 60_000);
      const overdueSlot = computeOverdueSlot(row, now);
      if (overdueSlot === null) continue;
      keys.add(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", overdueSlot));
    }
    expect(keys.size).toBe(1);
    expect([...keys]).toEqual(["u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z"]);
  });

  it("a fixed-time slot stays fixed as `now` advances", () => {
    // This is the #110 invariant. isOutstanding returned the most recent
    // ELAPSED occurrence, which advanced by one interval every interval;
    // the slot is part of the dedupe key, so the key churned without
    // bound and claimReminderSlot never suppressed the repeat.
    const row = fixedTimeRow({ timeOfDay: "08:00", lastEventAt: null });
    const early = computeOverdueSlot(row, new Date("2026-05-01T09:00:00.000Z"));
    const late = computeOverdueSlot(row, new Date("2026-05-01T14:00:00.000Z"));
    expect(early).not.toBeNull();
    expect(late).not.toBeNull();
    expect(late!.toISOString()).toBe(early!.toISOString());
  });

  it("an interval slot is a fixed instant derived from the last event", () => {
    const row = intervalRow({
      intervalHours: "6",
      lastEventAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    const early = computeOverdueSlot(row, new Date("2026-05-01T07:00:00.000Z"));
    const late = computeOverdueSlot(row, new Date("2026-05-01T20:00:00.000Z"));
    expect(early!.toISOString()).toBe("2026-05-01T06:00:00.000Z");
    expect(late!.toISOString()).toBe("2026-05-01T06:00:00.000Z");
  });
});

const SLOT = new Date("2026-05-01T08:00:00.000Z");
const at = (iso: string) => new Date(iso);
const policy = (over: Partial<NagPolicy> = {}): NagPolicy => ({
  offsetMinutes: 0,
  repeatEveryMinutes: null,
  maxRepeats: 3,
  ...over,
});

describe("computeNagIndex", () => {
  it("is 0 when no repeat is configured, however late", () => {
    expect(computeNagIndex(SLOT, NO_REPEAT, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, NO_REPEAT, at("2026-05-01T23:00:00.000Z"))).toBe(0);
  });

  it("returns null before the offset has elapsed", () => {
    const p = policy({ offsetMinutes: 30 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:29:00.000Z"))).toBeNull();
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:30:00.000Z"))).toBe(0);
  });

  it("advances one index per repeat interval", () => {
    const p = policy({ repeatEveryMinutes: 30 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:29:59.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:30:00.000Z"))).toBe(1);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T09:00:00.000Z"))).toBe(2);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T09:30:00.000Z"))).toBe(3);
  });

  it("CLAMPS at maxRepeats instead of returning null", () => {
    // The whole point. A hard cutoff would LOSE reminders that fire
    // today: a 22:00 slot sits through the overnight scheduler blackout,
    // so by the 06:00 tick eight hours have elapsed. Cutting off would
    // send nothing at all for a dose that was never taken.
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T10:00:00.000Z"))).toBe(3);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T16:00:00.000Z"))).toBe(3);
    expect(computeNagIndex(SLOT, p, at("2026-05-02T04:00:00.000Z"))).toBe(3);
  });

  it("a gap in ticks skips windows rather than firing a burst", () => {
    // Two consecutive ticks 8 hours apart yield ONE index, not eight.
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 10 });
    const first = computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"));
    const afterGap = computeNagIndex(SLOT, p, at("2026-05-01T16:00:00.000Z"));
    expect(first).toBe(0);
    expect(afterGap).toBe(10);
    expect(typeof afterGap).toBe("number");
  });

  it("maxRepeats 0 means exactly one reminder", () => {
    const p = policy({ repeatEveryMinutes: 30, maxRepeats: 0 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T08:00:00.000Z"))).toBe(0);
    expect(computeNagIndex(SLOT, p, at("2026-05-01T20:00:00.000Z"))).toBe(0);
  });

  it("treats a sub-minute interval as no repeat rather than exploding", () => {
    // #110 blocker (4): a 0.36s interval allocated ~390k Dates per row.
    // The schema floors this at 1, so reaching here means bad data — it
    // must degrade to one reminder, never to an unbounded key space.
    const p = policy({ repeatEveryMinutes: 0, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, p, at("2026-05-01T20:00:00.000Z"))).toBe(0);
    const negative = policy({ repeatEveryMinutes: -5, maxRepeats: 3 });
    expect(computeNagIndex(SLOT, negative, at("2026-05-01T20:00:00.000Z"))).toBe(0);
  });

  it("the key space for one slot is finite", () => {
    // The single property separating this feature from the #110 outage.
    const p = policy({ repeatEveryMinutes: 1, maxRepeats: 3 });
    const keys = new Set<string>();
    for (let m = 0; m < 5000; m++) {
      const idx = computeNagIndex(SLOT, p, new Date(SLOT.getTime() + m * 60_000));
      keys.add(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, idx ?? 0));
    }
    expect(keys.size).toBe(4);
  });
});

describe("buildOverdueDedupeKey — nag ordinal", () => {
  it("omits the suffix entirely at index 0, matching the pre-feature key", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 0)).toBe(
      "u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z",
    );
  });

  it("defaults to index 0 when the argument is omitted", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT)).toBe(
      buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 0),
    );
  });

  it("appends the ordinal from index 1", () => {
    expect(buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 2)).toBe(
      "u1:m1:overdue:fixed_time:s1:2026-05-01T08:00:00.000Z:n2",
    );
  });

  it("different ordinals are different keys, same ordinal is the same key", () => {
    const a = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 1);
    const b = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 1);
    const c = buildOverdueDedupeKey("u1", "m1", "fixed_time", "s1", SLOT, 2);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
