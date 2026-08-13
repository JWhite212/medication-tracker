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
});
