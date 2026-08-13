import { describe, it, expect } from "vitest";
import { outstandingSlots, isOutstanding, effectiveSchedules } from "$lib/utils/due";
import type { DoseEvent } from "$lib/utils/due";
import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

/**
 * The two projections must not disagree.
 *
 * `outstandingSlots` (the UI, full dose rows) and `isOutstanding` (the cron,
 * one aggregated anchor) implement the same rule over different evidence.
 * The original defect this whole change exists to fix was exactly such a
 * disagreement going unnoticed for months, so it gets its own test.
 *
 * BOUND 1 — evidence. Parity holds for a single schedule whose window
 * contains at most ONE dose event. With several events the `events`
 * projection is strictly more precise: it resolves each occurrence
 * independently, while `anchor` can only reason about the most recent
 * event. Documented in the spec under "Limits of the anchor projection".
 *
 * BOUND 2 — late doses. Parity holds for a dose at or BEFORE its
 * occurrence. For a dose AFTER it the two deliberately differ, and the
 * difference is pre-existing and intentional:
 *
 *   - the cron treats any dose at or after an occurrence as resolving it
 *     HOWEVER LATE — its tolerance extends backwards only, because
 *     "reporting a taken-but-late dose as overdue is a false alarm"
 *     (CLAUDE.md's reminder invariant, and the rule computeOverdueSlot
 *     always implemented)
 *   - the timeline pairs a dose to a slot only within a symmetric ±1h
 *     window, because with several slots a day a 5-hours-late dose is
 *     genuinely ambiguous about which slot it belongs to
 *
 * Both are right for the question each answers. The asymmetry is pinned by
 * its own test below so it cannot be "tidied away" later.
 *
 * Do not widen this test past either bound; an unbounded version cannot pass.
 */

const TZ = "UTC";
const NOW = new Date("2026-05-01T15:00:00Z");
const DAY = {
  startUtc: new Date("2026-05-01T00:00:00Z"),
  endUtc: new Date("2026-05-02T00:00:00Z"),
};
const STARTED_AT = new Date("2026-01-01T00:00:00Z");

function med(): Medication {
  return {
    id: "med-1",
    userId: "user-1",
    name: "Parity",
    dosageAmount: "1",
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
    sortOrder: 0,
    isArchived: false,
    archivedAt: null,
    startedAt: STARTED_AT,
    endedAt: null,
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  } as Medication;
}

/** A fixed-time schedule at 09:00 — clock-based, so both projections see the same occurrence. */
function fixedRow(): MedicationSchedule {
  return {
    id: "s1",
    medicationId: "med-1",
    userId: "user-1",
    scheduleKind: "fixed_time",
    timeOfDay: "09:00",
    intervalHours: null,
    daysOfWeek: null,
    sortOrder: 0,
    effectiveFrom: STARTED_AT,
    effectiveTo: null,
    createdAt: STARTED_AT,
  } as MedicationSchedule;
}

function dose(status: string, at: string): DoseEvent {
  return { id: "d1", medicationId: "med-1", takenAt: new Date(at), status, quantity: 1 };
}

/** The UI projection's verdict for the 09:00 slot. */
function uiSaysOutstanding(doses: DoseEvent[]): boolean {
  const slots = outstandingSlots(
    [med()],
    new Map([["med-1", [fixedRow()]]]),
    { kind: "events", doses },
    DAY,
    TZ,
    NOW,
  );
  const slot = slots.find((s) => s.expectedTime === "2026-05-01T09:00:00.000Z");
  return slot?.status === "overdue";
}

/** The cron projection's verdict for the same slot, from the same evidence. */
function cronSaysOutstanding(doses: DoseEvent[]): boolean {
  // The cron's aggregate is "latest taken-or-skipped dose" — the same
  // filter reminders.ts applies in SQL.
  const resolving = doses.filter((d) => d.status === "taken" || d.status === "skipped");
  const lastEventAt =
    resolving.length > 0 ? new Date(Math.max(...resolving.map((d) => d.takenAt.getTime()))) : null;
  const schedule = effectiveSchedules(med(), [fixedRow()])[0];
  return (
    isOutstanding(schedule, { kind: "anchor", lastEventAt }, TZ, NOW, {
      startedAt: STARTED_AT,
      endedAt: null,
    }) !== null
  );
}

describe("projection parity — one schedule, at most one dose event", () => {
  const cases: Array<[string, DoseEvent[]]> = [
    ["no doses at all", []],
    ["taken inside tolerance", [dose("taken", "2026-05-01T08:30:00Z")]],
    ["taken outside tolerance", [dose("taken", "2026-05-01T06:00:00Z")]],
    ["taken exactly at the slot", [dose("taken", "2026-05-01T09:00:00Z")]],
    ["skipped inside tolerance", [dose("skipped", "2026-05-01T08:30:00Z")]],
    ["skipped exactly at the slot", [dose("skipped", "2026-05-01T09:00:00Z")]],
    ["missed inside tolerance", [dose("missed", "2026-05-01T08:30:00Z")]],
    ["missed outside tolerance", [dose("missed", "2026-05-01T06:00:00Z")]],
  ];

  for (const [name, doses] of cases) {
    it(`agrees: ${name}`, () => {
      expect(cronSaysOutstanding(doses)).toBe(uiSaysOutstanding(doses));
    });
  }

  it("both report the 09:00 slot outstanding when nothing resolves it", () => {
    // Guards against the degenerate pass where both sides answer false for
    // every case and "parity" means only that neither ever fires.
    expect(uiSaysOutstanding([])).toBe(true);
    expect(cronSaysOutstanding([])).toBe(true);
  });

  it("both stop reporting it once a skip resolves it — the divergence this change fixes", () => {
    const skipped = [dose("skipped", "2026-05-01T09:15:00Z")];
    expect(uiSaysOutstanding(skipped)).toBe(false);
    expect(cronSaysOutstanding(skipped)).toBe(false);
  });

  it("a missed dose leaves it outstanding on both sides", () => {
    const missed = [dose("missed", "2026-05-01T09:15:00Z")];
    expect(uiSaysOutstanding(missed)).toBe(true);
    expect(cronSaysOutstanding(missed)).toBe(true);
  });
});

describe("the one place the projections deliberately differ: a very late dose", () => {
  // Pinned so it cannot be "tidied away" into false parity. A dose five
  // hours after the 09:00 slot:
  //   - stops the cron nagging (its tolerance extends backwards only, so
  //     any dose at or after the occurrence resolves it however late)
  //   - does NOT pair with the slot on the timeline (symmetric ±1h window,
  //     because with several slots a day a very late dose is ambiguous)
  const lateTaken = [dose("taken", "2026-05-01T14:00:00Z")];
  const lateSkipped = [dose("skipped", "2026-05-01T14:00:00Z")];

  it("the cron stops reminding — a taken-but-late dose is not a false alarm", () => {
    expect(cronSaysOutstanding(lateTaken)).toBe(false);
    expect(cronSaysOutstanding(lateSkipped)).toBe(false);
  });

  it("the timeline still shows the slot unfulfilled — the dose is too far away to pair", () => {
    expect(uiSaysOutstanding(lateTaken)).toBe(true);
    expect(uiSaysOutstanding(lateSkipped)).toBe(true);
  });
});
