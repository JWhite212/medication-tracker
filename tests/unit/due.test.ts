import { describe, it, expect } from "vitest";
import { effectiveSchedules, legacyScheduleId } from "$lib/utils/due";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

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
    scheduleIntervalHours: "8",
    inventoryCount: null,
    inventoryAlertThreshold: null,
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: new Date("2026-01-01T00:00:00Z"),
    endedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Medication;
}

function makeScheduleRow(overrides: Partial<MedicationSchedule> = {}): MedicationSchedule {
  return {
    id: "sched-1",
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours: "8",
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as MedicationSchedule;
}

describe("effectiveSchedules", () => {
  it("passes real schedule rows through unchanged", () => {
    const rows = [makeScheduleRow({ id: "sched-a" })];
    const out = effectiveSchedules(makeMed(), rows);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("sched-a");
    expect(out[0].scheduleKind).toBe("interval");
    expect(out[0].intervalHours).toBe("8");
  });

  it("ignores the legacy columns entirely when real rows exist", () => {
    const rows = [
      makeScheduleRow({
        id: "sched-a",
        scheduleKind: "fixed_time",
        timeOfDay: "09:00",
        intervalHours: null,
      }),
    ];
    const out = effectiveSchedules(makeMed({ scheduleIntervalHours: "4" }), rows);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("fixed_time");
  });

  it("synthesises an interval schedule from the legacy columns when there are no rows", () => {
    const out = effectiveSchedules(makeMed({ scheduleIntervalHours: "6" }), []);
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("interval");
    expect(out[0].intervalHours).toBe("6");
    expect(out[0].id).toBe(legacyScheduleId("med-1"));
  });

  it("synthesises a prn schedule for a legacy as_needed medication", () => {
    const out = effectiveSchedules(
      makeMed({ scheduleType: "as_needed", scheduleIntervalHours: null }),
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].scheduleKind).toBe("prn");
  });

  it("synthesises nothing when the legacy interval is zero", () => {
    // validation.ts admits "0" via /^\d+(\.\d+)?$/ — an unguarded
    // 24/0 would yield Infinity, so this must produce no schedule.
    expect(effectiveSchedules(makeMed({ scheduleIntervalHours: "0" }), [])).toEqual([]);
  });

  it("synthesises nothing when the legacy interval is absent", () => {
    expect(effectiveSchedules(makeMed({ scheduleIntervalHours: null }), [])).toEqual([]);
  });

  it("gives every synthesised schedule a stable id derived from the medication", () => {
    const a = effectiveSchedules(makeMed(), [])[0];
    const b = effectiveSchedules(makeMed(), [])[0];
    expect(a.id).toBe(b.id);
    expect(a.id).toBe("legacy:med-1");
  });
});

import { occurrencesFor } from "$lib/utils/due";
import type { EffectiveSchedule, Lifecycle } from "$lib/utils/due";

const LIFE: Lifecycle = { startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null };
const DAY_START = new Date("2026-05-01T00:00:00Z");
const DAY_END = new Date("2026-05-02T00:00:00Z");

function sched(overrides: Partial<EffectiveSchedule> = {}): EffectiveSchedule {
  return {
    id: "s1",
    scheduleKind: "interval",
    timeOfDay: null,
    intervalHours: "8",
    daysOfWeek: null,
    effectiveFrom: null,
    effectiveTo: null,
    ...overrides,
  };
}

describe("occurrencesFor", () => {
  it("projects interval occurrences across the window from the anchor", () => {
    const anchor = new Date("2026-05-01T00:00:00Z");
    const out = occurrencesFor(sched(), DAY_START, DAY_END, "UTC", anchor, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T08:00:00.000Z",
      "2026-05-01T16:00:00.000Z",
    ]);
  });

  it("starts one interval AFTER startedAt when there is no event", () => {
    // startedAt is when the medication began, not a dose occurrence: the
    // first expected dose is startedAt + intervalHours. Projecting from
    // startedAt itself would make a brand-new medication instantly overdue,
    // which is the badge behaviour this change exists to replace.
    const life: Lifecycle = { startedAt: new Date("2026-05-01T02:00:00Z"), endedAt: null };
    const out = occurrencesFor(sched(), DAY_START, DAY_END, "UTC", null, life);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T10:00:00.000Z",
      "2026-05-01T18:00:00.000Z",
    ]);
  });

  it("produces one fixed-time occurrence per local day at the given time", () => {
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    const out = occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual(["2026-05-01T09:00:00.000Z"]);
  });

  it("filters fixed-time occurrences by daysOfWeek on the occurrence's own date", () => {
    // 2026-05-01 is a Friday (day 5).
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      daysOfWeek: [1],
    });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("produces no occurrences for prn", () => {
    const s = sched({ scheduleKind: "prn", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("produces no occurrences before startedAt", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T12:00:00Z"), endedAt: null };
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, life)).toEqual([]);
  });

  it("produces no occurrences after endedAt", () => {
    const life: Lifecycle = {
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: new Date("2026-04-30T00:00:00Z"),
    };
    const s = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, life)).toEqual([]);
  });

  it("guards a zero or non-numeric interval", () => {
    expect(
      occurrencesFor(sched({ intervalHours: "0" }), DAY_START, DAY_END, "UTC", DAY_START, LIFE),
    ).toEqual([]);
    expect(
      occurrencesFor(sched({ intervalHours: null }), DAY_START, DAY_END, "UTC", DAY_START, LIFE),
    ).toEqual([]);
  });

  it("guards a sub-millisecond interval instead of looping forever", () => {
    // An interval under 1ms cannot advance a Date — `new Date(t + 0.36)`
    // truncates back to `t` — so the projection loop would never terminate,
    // hanging the dashboard request or the reminder cron for every user.
    // `z.coerce.number().positive()` admits 1e-7, so this is reachable input.
    // If this test ever hangs rather than fails, the guard has been removed.
    expect(
      occurrencesFor(
        sched({ intervalHours: "0.0000001" }),
        DAY_START,
        DAY_END,
        "UTC",
        DAY_START,
        LIFE,
      ),
    ).toEqual([]);
  });

  it("catches up from an anchor several intervals before the window", () => {
    // Anchor is 16 hours (2 intervals) before window start.
    const anchor = new Date("2026-04-30T08:00:00Z");
    const out = occurrencesFor(sched(), DAY_START, DAY_END, "UTC", anchor, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T00:00:00.000Z",
      "2026-05-01T08:00:00.000Z",
      "2026-05-01T16:00:00.000Z",
    ]);
  });

  it("catches up from an anchor exactly one interval before the window", () => {
    // Anchor is 4 hours (half interval) before window start at odd time.
    const anchor = new Date("2026-04-30T20:00:00Z");
    const windowStart = new Date("2026-05-01T00:00:00Z");
    const windowEnd = new Date("2026-05-02T00:00:00Z");
    const out = occurrencesFor(sched(), windowStart, windowEnd, "UTC", anchor, LIFE);
    expect(out.map((d) => d.toISOString())).toEqual([
      "2026-05-01T04:00:00.000Z",
      "2026-05-01T12:00:00.000Z",
      "2026-05-01T20:00:00.000Z",
    ]);
  });
});

import { isOutstanding, resolvesSlot, type DoseEvent } from "$lib/utils/due";

const NOW = new Date("2026-05-01T15:00:00Z");

describe("resolvesSlot", () => {
  it("counts taken and skipped, never missed", () => {
    expect(resolvesSlot("taken")).toBe(true);
    expect(resolvesSlot("skipped")).toBe(true);
    expect(resolvesSlot("missed")).toBe(false);
  });
});

describe("isOutstanding — interval", () => {
  it("is not outstanding inside the interval window", () => {
    const anchor = new Date("2026-05-01T12:00:00Z"); // 3h ago, 8h interval
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: anchor }, "UTC", NOW, LIFE);
    expect(got).toBeNull();
  });

  it("is outstanding once the interval has elapsed", () => {
    const anchor = new Date("2026-05-01T04:00:00Z"); // 11h ago, 8h interval
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: anchor }, "UTC", NOW, LIFE);
    expect(got?.toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });

  it("events mode: a missed dose is ignored when extracting the anchor", () => {
    // Two doses: a taken dose at 04:00, then a missed dose at 12:00.
    // The missed dose should be ignored, so the anchor is the taken dose at 04:00.
    // Expected slot after 04:00 is 12:00. The missed dose at 12:00 doesn't resolve it.
    const doses: DoseEvent[] = [
      {
        id: "dose-1",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T04:00:00Z"),
        status: "taken",
        quantity: 1,
      },
      {
        id: "dose-2",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T12:00:00Z"),
        status: "missed",
        quantity: 1,
      },
    ];
    const got = isOutstanding(sched(), { kind: "events", doses }, "UTC", NOW, LIFE);
    // Anchor is 04:00, so next slot is 12:00. Missed dose doesn't resolve, so 12:00 is outstanding.
    expect(got?.toISOString()).toBe("2026-05-01T12:00:00.000Z");
  });

  it("events mode: a skipped dose resolves just as a taken dose does", () => {
    // Same scenario as above but with skipped instead of missed.
    // Now the dose at 12:00 should resolve the 12:00 slot.
    const doses: DoseEvent[] = [
      {
        id: "dose-1",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T04:00:00Z"),
        status: "taken",
        quantity: 1,
      },
      {
        id: "dose-2",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T12:00:00Z"),
        status: "skipped",
        quantity: 1,
      },
    ];
    const got = isOutstanding(sched(), { kind: "events", doses }, "UTC", NOW, LIFE);
    // Anchor is now 12:00 (the skipped dose), so next slot is 20:00, which is after NOW.
    expect(got).toBeNull();
  });

  it("events mode: with multiple resolving doses, uses the latest as anchor", () => {
    // Multiple doses: some before 12:00, one missed, and one taken after.
    // The latest resolving dose (at 12:00) should be the anchor.
    const doses: DoseEvent[] = [
      {
        id: "dose-1",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T00:00:00Z"),
        status: "taken",
        quantity: 1,
      },
      {
        id: "dose-2",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T08:00:00Z"),
        status: "taken",
        quantity: 1,
      },
      {
        id: "dose-3",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T12:30:00Z"),
        status: "missed", // ignored
        quantity: 1,
      },
      {
        id: "dose-4",
        medicationId: "med-1",
        takenAt: new Date("2026-05-01T12:00:00Z"),
        status: "skipped",
        quantity: 1,
      },
    ];
    // With an 8h interval, doses at 08:00 and 12:00, the latest resolving is 12:00.
    // Next slot after 12:00 is 20:00. With NOW=15:00, that's not outstanding yet.
    const got = isOutstanding(sched(), { kind: "events", doses }, "UTC", NOW, LIFE);
    expect(got).toBeNull();
  });

  it("a never-handled interval medication is outstanding once startedAt + interval has passed", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T00:00:00Z"), endedAt: null };
    const got = isOutstanding(sched(), { kind: "anchor", lastEventAt: null }, "UTC", NOW, life);
    expect(got?.toISOString()).toBe("2026-05-01T08:00:00.000Z");
  });

  it("a never-handled interval medication is NOT outstanding before startedAt + interval", () => {
    const life: Lifecycle = { startedAt: new Date("2026-05-01T14:00:00Z"), endedAt: null };
    expect(
      isOutstanding(sched(), { kind: "anchor", lastEventAt: null }, "UTC", NOW, life),
    ).toBeNull();
  });
});

describe("isOutstanding — fixed time", () => {
  const fixed = sched({ scheduleKind: "fixed_time", timeOfDay: "09:00", intervalHours: null });

  it("is outstanding when today's elapsed slot has no event", () => {
    const got = isOutstanding(fixed, { kind: "anchor", lastEventAt: null }, "UTC", NOW, LIFE);
    expect(got?.toISOString()).toBe("2026-05-01T09:00:00.000Z");
  });

  it("is not outstanding when an event lands inside the tolerance", () => {
    const at = new Date("2026-05-01T08:30:00Z"); // 30 min before the slot
    expect(isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE)).toBeNull();
  });

  it("is outstanding when the event is older than the tolerance", () => {
    const at = new Date("2026-05-01T07:00:00Z"); // 2h before the slot
    expect(
      isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE),
    ).not.toBeNull();
  });

  it("treats a late dose as resolving the slot however late", () => {
    const at = new Date("2026-05-01T14:00:00Z"); // 5h after the slot
    expect(isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE)).toBeNull();
  });

  it("falls back to yesterday's slot when today's has not arrived", () => {
    const earlyNow = new Date("2026-05-01T06:00:00Z");
    const got = isOutstanding(fixed, { kind: "anchor", lastEventAt: null }, "UTC", earlyNow, LIFE);
    expect(got?.toISOString()).toBe("2026-04-30T09:00:00.000Z");
  });

  it("does not reach back beyond the look-back window", () => {
    const life: Lifecycle = { startedAt: new Date("2026-01-01T00:00:00Z"), endedAt: null };
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      daysOfWeek: [0],
    });
    // 2026-05-01 is Friday, 2026-04-30 Thursday — neither is Sunday, so
    // nothing inside the look-back qualifies.
    expect(isOutstanding(s, { kind: "anchor", lastEventAt: null }, "UTC", NOW, life)).toBeNull();
  });

  it("resolves at exactly the tolerance boundary (slot - SLOT_TOLERANCE_MS)", () => {
    // Slot at 09:00, dose at exactly 08:00 (1h before). Tolerance is 1h.
    // This should resolve because dose >= slot - tolerance.
    const at = new Date("2026-05-01T08:00:00Z");
    expect(isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE)).toBeNull();
  });

  it("does not resolve just beyond the tolerance boundary (slot - SLOT_TOLERANCE_MS - 1ms)", () => {
    // Slot at 09:00, dose at 07:59:59.999 (1ms before the 1h boundary).
    // This should NOT resolve because dose < slot - tolerance.
    const at = new Date("2026-05-01T07:59:59.999Z");
    expect(
      isOutstanding(fixed, { kind: "anchor", lastEventAt: at }, "UTC", NOW, LIFE),
    ).not.toBeNull();
  });
});

describe("occurrencesFor — the schedule's own effective window", () => {
  it("produces no occurrences after the schedule's effectiveTo", () => {
    // A superseded schedule stops applying. Nothing read effectiveTo before
    // this, so such a schedule kept generating occurrences indefinitely.
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      effectiveTo: new Date("2026-04-30T00:00:00Z"),
    });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("produces no occurrences before the schedule's effectiveFrom", () => {
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toEqual([]);
  });

  it("still produces occurrences inside the effective window", () => {
    const s = sched({
      scheduleKind: "fixed_time",
      timeOfDay: "09:00",
      intervalHours: null,
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-12-31T00:00:00Z"),
    });
    expect(occurrencesFor(s, DAY_START, DAY_END, "UTC", null, LIFE)).toHaveLength(1);
  });
});
