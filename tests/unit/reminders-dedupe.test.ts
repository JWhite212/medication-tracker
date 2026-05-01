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
  lastTakenAt?: Date | null;
  userTimezone?: string;
}): OverdueRow {
  return {
    scheduleKind: "interval",
    intervalHours: opts.intervalHours ?? null,
    timeOfDay: null,
    daysOfWeek: null,
    userTimezone: opts.userTimezone ?? "UTC",
    lastTakenAt: opts.lastTakenAt ?? null,
  };
}

function fixedTimeRow(opts: {
  timeOfDay?: string | null;
  daysOfWeek?: number[] | null;
  userTimezone?: string;
  lastTakenAt?: Date | null;
}): OverdueRow {
  return {
    scheduleKind: "fixed_time",
    intervalHours: null,
    timeOfDay: opts.timeOfDay ?? null,
    daysOfWeek: opts.daysOfWeek ?? null,
    userTimezone: opts.userTimezone ?? "UTC",
    lastTakenAt: opts.lastTakenAt ?? null,
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
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastTakenAt: oneHourAgo }), now),
    ).toBe(false);
  });

  it("interval taken longer ago than the window is overdue", () => {
    const eightHoursAgo = new Date(now.getTime() - 8 * 3_600_000);
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastTakenAt: eightHoursAgo }), now),
    ).toBe(true);
  });

  it("interval at exactly the window boundary is not overdue (strict greater-than)", () => {
    const sixHoursAgo = new Date(now.getTime() - 6 * 3_600_000);
    expect(
      isScheduleOverdue(intervalRow({ intervalHours: "6", lastTakenAt: sixHoursAgo }), now),
    ).toBe(false);
  });
});

describe("isScheduleOverdue — fixed-time schedules (UTC)", () => {
  it("future slot today is not overdue", () => {
    expect(isScheduleOverdue(fixedTimeRow({ timeOfDay: "23:00" }), now)).toBe(false);
  });

  it("past slot today with no dose is overdue", () => {
    expect(isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00" }), now)).toBe(true);
  });

  it("past slot today with a dose inside tolerance is not overdue", () => {
    const slotEightAm = new Date("2026-05-01T08:00:00.000Z");
    expect(
      isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", lastTakenAt: slotEightAm }), now),
    ).toBe(false);
  });

  it("past slot today with a dose outside tolerance is overdue", () => {
    // Tolerance is 60 minutes; doses far earlier shouldn't suppress the slot.
    const wayEarlier = new Date("2026-04-30T05:00:00.000Z");
    expect(
      isScheduleOverdue(fixedTimeRow({ timeOfDay: "08:00", lastTakenAt: wayEarlier }), now),
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
  it("interval slot is lastTakenAt + intervalHours", () => {
    const lastTaken = new Date("2026-05-01T03:00:00.000Z");
    const slot = computeOverdueSlot(
      intervalRow({ intervalHours: "6", lastTakenAt: lastTaken }),
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
    expect(computeOverdueSlot(fixedTimeRow({ timeOfDay: "23:00" }), now)).toBeNull();
  });

  it("interval & fixed-time produce DIFFERENT dedupe keys for the same med", () => {
    const lastTaken = new Date("2026-05-01T03:00:00.000Z");
    const intervalSlot = computeOverdueSlot(
      intervalRow({ intervalHours: "6", lastTakenAt: lastTaken }),
      now,
    )!;
    const fixedSlot = computeOverdueSlot(fixedTimeRow({ timeOfDay: "08:00" }), now)!;
    const intervalKey = buildOverdueDedupeKey("u", "m", "interval", "s1", intervalSlot);
    const fixedKey = buildOverdueDedupeKey("u", "m", "fixed_time", "s2", fixedSlot);
    expect(intervalKey).not.toBe(fixedKey);
  });
});
