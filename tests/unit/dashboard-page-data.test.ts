import { describe, it, expect } from "vitest";
import {
  composeDashboardPageData,
  computeNextRefreshAt,
  type DashboardCompositionInputs,
} from "$lib/server/dashboard/page-data";
import { dashboardWindow, type MatchedSlot } from "$lib/utils/schedule";
import type { DoseLogWithMedication, DueCard, DueRow, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

/*
 * Every expectation below is derived by hand from rules this module does NOT
 * own — the window, projection, passes 0–2 and slotActions in
 * utils/schedule.ts — and each case's comment walks the derivation, so a
 * failure says which layer disagrees before anyone edits an expectation.
 *
 * UTC unless a case says otherwise, so a local time IS its ISO string.
 * 2026-04-15/16/17 are Wednesday, Thursday, Friday.
 */
const wed = (hhmm: string) => `2026-04-15T${hhmm}:00.000Z`;
const thu = (hhmm: string) => `2026-04-16T${hhmm}:00.000Z`;
const fri = (hhmm: string) => `2026-04-17T${hhmm}:00.000Z`;

const EPOCH = new Date("2026-01-01T00:00:00Z");

function makeMed(overrides: Partial<Medication> & Pick<Medication, "id" | "name">): Medication {
  return {
    userId: "u1",
    dosageAmount: "1",
    dosageUnit: "mg",
    form: "tablet",
    category: "other",
    colour: "#6366f1",
    colourSecondary: null,
    pattern: "solid",
    notes: null,
    scheduleType: "scheduled",
    scheduleIntervalHours: null,
    inventoryCount: null,
    inventoryAlertThreshold: null,
    lowInventoryEpisodeAt: null,
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
    startedAt: EPOCH,
    endedAt: null,
    createdAt: EPOCH,
    updatedAt: EPOCH,
    ...overrides,
  };
}

const METFORMIN = makeMed({ id: "med-a", name: "Metformin", dosageAmount: "500", sortOrder: 0 });
const IBUPROFEN = makeMed({
  id: "med-b",
  name: "Ibuprofen",
  dosageAmount: "200",
  sortOrder: 1,
  colour: "#f59e0b",
});
const LISINOPRIL = makeMed({
  id: "med-c",
  name: "Lisinopril",
  dosageAmount: "10",
  sortOrder: 2,
  colour: "#10b981",
});

function fixed(med: Medication, timeOfDay: string, daysOfWeek: number[] | null = null) {
  const row: MedicationSchedule = {
    id: `${med.id}-${timeOfDay}`,
    medicationId: med.id,
    userId: "u1",
    scheduleKind: "fixed_time",
    timeOfDay,
    intervalHours: null,
    daysOfWeek,
    sortOrder: 0,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    createdAt: EPOCH,
  };
  return row;
}

function prn(med: Medication): MedicationSchedule {
  return { ...fixed(med, "00:00"), id: `${med.id}-prn`, scheduleKind: "prn", timeOfDay: null };
}

function schedulesOf(...rows: MedicationSchedule[]): Map<string, MedicationSchedule[]> {
  const map = new Map<string, MedicationSchedule[]>();
  for (const row of rows) map.set(row.medicationId, [...(map.get(row.medicationId) ?? []), row]);
  return map;
}

function dose(
  id: string,
  med: Medication,
  takenAt: string,
  overrides: Partial<DoseLogWithMedication> = {},
): DoseLogWithMedication {
  return {
    id,
    userId: "u1",
    medicationId: med.id,
    quantity: 1,
    status: "taken",
    takenAt: new Date(takenAt),
    loggedAt: new Date(takenAt),
    updatedAt: new Date(takenAt),
    notes: null,
    sideEffects: null,
    medication: {
      name: med.name,
      dosageAmount: med.dosageAmount,
      dosageUnit: med.dosageUnit,
      form: med.form,
      colour: med.colour,
      colourSecondary: med.colourSecondary,
      pattern: med.pattern,
    },
    ...overrides,
  };
}

/** What getLastDosePerMedication would return for these doses. */
function lastDosesOf(doses: DoseLogWithMedication[]): DashboardCompositionInputs["lastDoses"] {
  const byMed = new Map<string, { lastTakenAt: Date | null; lastEventAt: Date }>();
  for (const d of doses) {
    if (d.status === "missed") continue;
    const entry = byMed.get(d.medicationId) ?? { lastTakenAt: null, lastEventAt: d.takenAt };
    if (d.takenAt.getTime() > entry.lastEventAt.getTime()) entry.lastEventAt = d.takenAt;
    if (
      d.status === "taken" &&
      (entry.lastTakenAt === null || d.takenAt.getTime() > entry.lastTakenAt.getTime())
    ) {
      entry.lastTakenAt = d.takenAt;
    }
    byMed.set(d.medicationId, entry);
  }
  return [...byMed].map(([medicationId, entry]) => ({ medicationId, ...entry }));
}

function compose(args: Omit<Partial<DashboardCompositionInputs>, "now"> & { now: string }) {
  const doses = args.doses ?? [];
  return composeDashboardPageData({
    medications: args.medications ?? [],
    schedulesByMedId: args.schedulesByMedId ?? new Map(),
    doses,
    lastDoses: args.lastDoses ?? lastDosesOf(doses),
    now: new Date(args.now),
    timezone: args.timezone ?? "UTC",
  });
}

function row(
  med: Medication,
  expectedTime: string,
  state: DueRow["state"],
  actions: { logNow?: boolean; tookItAt?: string | null; skipAt?: string | null } = {},
): DueRow {
  return {
    key: `${med.id}:${expectedTime}`,
    kind: "fixed_time",
    expectedTime,
    state,
    logNow: actions.logNow ?? false,
    tookItAt: actions.tookItAt ?? null,
    skipAt: actions.skipAt ?? null,
  };
}

const rowsOf = (cards: DueCard[]) => cards.map((card) => ({ key: card.key, rows: card.rows }));

describe("computeNextRefreshAt", () => {
  function matched(
    expectedTime: string,
    segment: MatchedSlot["segment"],
    status: MatchedSlot["status"],
  ): MatchedSlot {
    return {
      expectedTime: new Date(expectedTime),
      kind: "fixed_time",
      segment,
      status,
      resolvedByDoseId: null,
      missedByDoseId: null,
    };
  }

  function refreshAt(
    now: string,
    slots: MatchedSlot[],
    doses: Array<Pick<DoseLogWithMedication, "status" | "takenAt">> = [],
  ): string {
    const at = new Date(now);
    return computeNextRefreshAt({
      now: at,
      window: dashboardWindow(at, "UTC"),
      slots,
      doses,
    }).toISOString();
  }

  it("falls back to the end of the civil day", () => {
    expect(refreshAt(thu("13:30"), [])).toBe(fri("00:00"));
  });

  it("never arms a timer for less than five seconds", () => {
    expect(
      refreshAt("2026-04-16T13:59:58.000Z", [matched(thu("14:00"), "today", "upcoming")]),
    ).toBe("2026-04-16T14:00:03.000Z");
  });

  it("wakes when a slot comes within the hour", () => {
    // Otherwise 15:00 would sit read-only in Later until 15:00, with the
    // header saying "All caught up" and no Log now for that whole hour.
    expect(refreshAt(thu("13:30"), [matched(thu("15:00"), "today", "upcoming")])).toBe(
      thu("14:00"),
    );
  });

  it("wakes when a due-now slot turns overdue", () => {
    expect(refreshAt(thu("13:30"), [matched(thu("12:45"), "today", "overdue")])).toBe(thu("13:45"));
  });

  it("wakes an hour before a tomorrow's-first-hour slot", () => {
    expect(refreshAt(thu("22:00"), [matched(fri("00:30"), "tomorrow", "upcoming")])).toBe(
      thu("23:30"),
    );
  });

  it("wakes when an Earlier slot turns twelve hours old, but only while it is outstanding", () => {
    expect(refreshAt(thu("07:00"), [matched(wed("22:00"), "yesterday", "overdue")])).toBe(
      thu("10:00"),
    );
    // Resolved, so not visible: there is no expiry to wait for.
    expect(refreshAt(thu("07:00"), [matched(wed("22:00"), "yesterday", "taken")])).toBe(
      fri("00:00"),
    );
  });

  it("wakes when a future-dated dose's time arrives", () => {
    expect(
      refreshAt(thu("13:30"), [], [{ status: "taken", takenAt: new Date(thu("15:00")) }]),
    ).toBe(thu("15:00"));
  });

  it("ends a taken dose's cooldown on time; a skip starts none", () => {
    expect(
      refreshAt(
        thu("13:30"),
        [],
        [
          { status: "taken", takenAt: new Date(thu("13:10")) },
          // Were skips counted, 12:40 + 1h = 13:40 would win.
          { status: "skipped", takenAt: new Date(thu("12:40")) },
        ],
      ),
    ).toBe(thu("14:10"));
  });
});

describe("composeDashboardPageData — Due and Later", () => {
  it("files today's outstanding slots as overdue, due-now or Later by distance from now", () => {
    // 13:30. Metformin 11:00 is 2.5h late (overdue): pass 2 gives a dose
    // logged now to it, pass 0 gives Took it at 11:00 to it, and its skip is
    // reserved at 11:00. Ibuprofen 13:45 is 15m ahead (due-now): pass 1 gives
    // a dose logged now to it; Took it at is not offered (not yet happened);
    // its skip is at min(13:45, now) = 13:30. Lisinopril 20:00 is 6.5h ahead
    // (Later). Yesterday's slots are over 12h old, so hidden.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "11:00"),
        fixed(IBUPROFEN, "13:45"),
        fixed(LISINOPRIL, "20:00"),
      ),
    });

    expect(data.earlier).toEqual([]);
    expect(data.today).toEqual([
      {
        key: "today:med-a",
        medicationId: "med-a",
        name: "Metformin",
        dosageAmount: "500",
        dosageUnit: "mg",
        colour: "#6366f1",
        colourSecondary: null,
        pattern: "solid",
        rows: [
          row(METFORMIN, thu("11:00"), "overdue", {
            logNow: true,
            tookItAt: thu("11:00"),
            skipAt: thu("11:00"),
          }),
        ],
      },
      {
        key: "today:med-b",
        medicationId: "med-b",
        name: "Ibuprofen",
        dosageAmount: "200",
        dosageUnit: "mg",
        colour: "#f59e0b",
        colourSecondary: null,
        pattern: "solid",
        rows: [row(IBUPROFEN, thu("13:45"), "due-now", { logNow: true, skipAt: thu("13:30") })],
      },
    ]);
    expect(data.later).toEqual([
      {
        key: `med-c:${thu("20:00")}`,
        medicationId: "med-c",
        name: "Lisinopril",
        dosageAmount: "10",
        dosageUnit: "mg",
        colour: "#10b981",
        colourSecondary: null,
        pattern: "solid",
        expectedTime: thu("20:00"),
      },
    ]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 2,
      doneToday: 0,
      totalToday: 3,
      loggedToday: 0,
      next: null,
    });
  });

  it("hides Took it at on a due-now row that also shows Log now, and keeps Skip", () => {
    // 13:30, slot 13:00 (due-now). Pass 1 gives a dose logged now to it, so
    // it is the target. slotActions offers Took it at 13:00 as well; the
    // presentation rule drops it because both resolve the same row.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "13:00")),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [row(METFORMIN, thu("13:00"), "due-now", { logNow: true, skipAt: thu("13:00") })],
      },
    ]);
  });

  it("nests a medication's other outstanding rows latest first under its Log-now row", () => {
    // 13:30, slots 08:55, 09:00, 11:00, nothing logged. Pass 2 gives a dose
    // logged now to the latest, 11:00: that is the target and the top row.
    // All three are past, so each offers Took it at its own time (pass 0)
    // and a reserved Skip.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "08:55"),
        fixed(METFORMIN, "09:00"),
        fixed(METFORMIN, "11:00"),
      ),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("11:00"), "overdue", {
            logNow: true,
            tookItAt: thu("11:00"),
            skipAt: thu("11:00"),
          }),
          row(METFORMIN, thu("09:00"), "overdue", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
          row(METFORMIN, thu("08:55"), "overdue", { tookItAt: thu("08:55"), skipAt: thu("08:55") }),
        ],
      },
    ]);
    expect(data.status).toMatchObject({ kind: "due", dueCount: 3 });
  });

  it("puts the Log-now target on top even when it is not the latest row", () => {
    // 09:30, slots 08:55 and 09:00. Pass 1 ascends, so a dose logged now
    // (35m from 08:55) lands on 08:55, not 09:00: 08:55 is the target and
    // leads the card. 09:00 keeps Took it at (pass 0 resolves exactly it)
    // because it is not the Log-now row.
    const data = compose({
      now: thu("09:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "08:55"), fixed(METFORMIN, "09:00")),
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("08:55"), "due-now", { logNow: true, skipAt: thu("08:55") }),
          row(METFORMIN, thu("09:00"), "due-now", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
        ],
      },
    ]);
  });

  it("withholds Log now inside the one-hour cooldown but keeps Took it at and Skip", () => {
    // 13:30, slots 09:00 and 13:00, a dose at 12:45. Pass 1 gives it to
    // 13:00; 09:00 is 4.5h late. 12:45 is inside (12:30, 13:30], so this
    // medication has no Log now anywhere.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "09:00"), fixed(METFORMIN, "13:00")),
      doses: [dose("d1", METFORMIN, thu("12:45"))],
    });

    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [
          row(METFORMIN, thu("09:00"), "overdue", { tookItAt: thu("09:00"), skipAt: thu("09:00") }),
        ],
      },
    ]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 1,
      doneToday: 1,
      totalToday: 2,
      loggedToday: 1,
      next: null,
    });
  });

  it("gives a medication one card per sub-group", () => {
    // 07:00, slots 06:30 and 22:00. Yesterday's 22:00 is 9h old (Earlier:
    // Took it at and a reserved Skip, but no Log now). This morning's 06:30
    // is 30m late (due-now) and pass 1 gives it a dose logged now. Tonight's
    // 22:00 is Later. Yesterday's 06:30 is over 12h old, so hidden.
    const data = compose({
      now: thu("07:00"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "06:30"), fixed(METFORMIN, "22:00")),
    });

    expect(rowsOf(data.earlier)).toEqual([
      {
        key: "earlier:med-a",
        rows: [
          row(METFORMIN, wed("22:00"), "earlier", { tookItAt: wed("22:00"), skipAt: wed("22:00") }),
        ],
      },
    ]);
    expect(rowsOf(data.today)).toEqual([
      {
        key: "today:med-a",
        rows: [row(METFORMIN, thu("06:30"), "due-now", { logNow: true, skipAt: thu("06:30") })],
      },
    ]);
    expect(data.later.map((r) => r.expectedTime)).toEqual([thu("22:00")]);
    expect(data.status).toEqual({
      kind: "due",
      dueCount: 2,
      doneToday: 0,
      totalToday: 2,
      loggedToday: 0,
      next: null,
    });
  });

  it("orders cards by top-row time, then sortOrder, whatever order medications arrive in", () => {
    const data = compose({
      now: thu("13:30"),
      medications: [IBUPROFEN, METFORMIN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(IBUPROFEN, "11:00"),
        fixed(METFORMIN, "11:00"),
        fixed(LISINOPRIL, "10:00"),
      ),
    });

    expect(data.today.map((card) => card.key)).toEqual([
      "today:med-c",
      "today:med-a",
      "today:med-b",
    ]);
  });
});

describe("composeDashboardPageData — state boundaries", () => {
  it("a slot exactly an hour past is due-now; a millisecond later it is overdue", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "13:00")),
    };
    expect(compose({ ...setup, now: thu("14:00") }).today[0].rows[0].state).toBe("due-now");
    expect(compose({ ...setup, now: "2026-04-16T14:00:00.001Z" }).today[0].rows[0].state).toBe(
      "overdue",
    );
  });

  it("a slot exactly an hour ahead is in Due; a millisecond further out it is in Later", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "15:00")),
    };
    const onBoundary = compose({ ...setup, now: thu("14:00") });
    expect(onBoundary.today[0].rows[0].state).toBe("due-now");
    expect(onBoundary.later).toEqual([]);

    const beyond = compose({ ...setup, now: "2026-04-16T13:59:59.999Z" });
    expect(beyond.today).toEqual([]);
    expect(beyond.later.map((r) => r.expectedTime)).toEqual([thu("15:00")]);
  });

  it("an Earlier row shows until it is twelve hours old, to the millisecond", () => {
    const setup = {
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "22:00")),
    };
    // visibleStart = now − 12h + 1ms. At 09:59:59.999 that is exactly
    // yesterday 22:00:00.000, so the slot is in.
    const last = compose({ ...setup, now: "2026-04-16T09:59:59.999Z" });
    expect(last.earlier.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [[wed("22:00"), "earlier"]],
    ]);
    // At 10:00:00.000 visibleStart is 22:00:00.001, so the slot is gone, and Due with it.
    const gone = compose({ ...setup, now: thu("10:00") });
    expect(gone.earlier).toEqual([]);
    expect(gone.status.kind).toBe("caught-up");
  });
});

describe("composeDashboardPageData — Done", () => {
  it("lists today's doses and backdated doses logged today, oldest first", () => {
    // 07:00. Lisinopril is fixed 22:00. d-back is a "Took it at yesterday
    // 22:00" tapped this morning: pass 0 gives it yesterday's 22:00, and it
    // must be in Done so it can be undone. d-old was logged yesterday for
    // yesterday, so it is history, not Done.
    const doses = [
      dose("d-old", LISINOPRIL, wed("20:00")),
      dose("d-back", LISINOPRIL, wed("22:00"), { loggedAt: new Date(thu("06:50")) }),
      dose("d-prn", IBUPROFEN, thu("06:40"), { quantity: 2 }),
      dose("d-skip", IBUPROFEN, thu("06:45"), { status: "skipped" }),
    ];
    const data = compose({
      now: thu("07:00"),
      medications: [LISINOPRIL, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(LISINOPRIL, "22:00"), prn(IBUPROFEN)),
      doses,
    });

    expect(data.done.map((r) => [r.key, r.dayLabel, r.covers])).toEqual([
      // It resolved its own minute, so it covers nothing extra.
      ["d-back", "yesterday", []],
      ["d-prn", null, []],
      ["d-skip", null, []],
    ]);
    expect(data.done[0].dose).toBe(doses[1]);
    // Yesterday's 22:00 is resolved, so nothing is Due; tonight's is ahead.
    expect(data.earlier).toEqual([]);
    expect(data.status).toEqual({
      kind: "caught-up",
      dueCount: 0,
      doneToday: 0,
      totalToday: 1,
      loggedToday: 2,
      next: {
        name: "Lisinopril",
        dosageAmount: "10",
        dosageUnit: "mg",
        expectedTime: thu("22:00"),
        alsoCount: 0,
      },
    });
  });

  it("lists a backdated dose logged today only from yesterday's midnight on", () => {
    // Both were logged this morning. d-edge is at yesterday's midnight, the
    // first instant "yesterday" is true of. d-older was edited on /log to
    // two days ago; labelling it "yesterday" would be false, so it is
    // history, not Done.
    const data = compose({
      now: thu("07:00"),
      medications: [LISINOPRIL],
      schedulesByMedId: schedulesOf(fixed(LISINOPRIL, "22:00")),
      doses: [
        dose("d-older", LISINOPRIL, "2026-04-14T23:30:00.000Z", {
          loggedAt: new Date(thu("06:50")),
        }),
        dose("d-edge", LISINOPRIL, wed("00:00"), { loggedAt: new Date(thu("06:50")) }),
      ],
    });

    expect(data.done.map((r) => r.key)).toEqual(["d-edge"]);
  });

  it("covers lists the slots a dose resolved, minus its own minute", () => {
    // The spec's live case: slots 08:55, 09:00, 11:00, with ×4 at 13:31 and
    // ×3 at 21:48; now 22:00. Pass 1 finds nothing within an hour of either
    // dose. Pass 2 replays in time order: 13:31 walks back over 11:00,
    // 09:00 and 08:55 and stops at todayStart (= visibleStart) with a unit
    // spare; 21:48 finds every slot already resolved.
    const data = compose({
      now: thu("22:00"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "08:55"),
        fixed(METFORMIN, "09:00"),
        fixed(METFORMIN, "11:00"),
      ),
      doses: [
        dose("d1", METFORMIN, thu("13:31"), { quantity: 4 }),
        dose("d2", METFORMIN, thu("21:48"), { quantity: 3 }),
      ],
    });

    expect(data.done.map((r) => [r.key, r.covers])).toEqual([
      ["d1", [thu("08:55"), thu("09:00"), thu("11:00")]],
      ["d2", []],
    ]);
    expect(data.today).toEqual([]);
    expect(data.status).toEqual({
      kind: "all-done",
      dueCount: 0,
      doneToday: 3,
      totalToday: 3,
      loggedToday: 2,
      next: null,
    });
    // d2's cooldown (21:48 + 1h) ends before midnight.
    expect(data.nextRefreshAt).toBe(thu("22:48"));
  });

  it("covers never names tomorrow's first hour, though the dose resolved it", () => {
    // Fixed 23:50 and 00:20, ×3 at 23:55. Pass 1 ascends: tonight's 23:50
    // (5m), then tomorrow's 00:20 (25m, which has no segment limit). Pass 2
    // walks the last unit back past 23:50 (resolved) to this morning's
    // 00:20. Tomorrow's 00:20 is matched but never shown, counted or credited.
    const data = compose({
      now: thu("23:58"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "23:50"), fixed(METFORMIN, "00:20")),
      doses: [dose("d1", METFORMIN, thu("23:55"), { quantity: 3 })],
    });

    expect(data.done.map((r) => r.covers)).toEqual([[thu("00:20"), thu("23:50")]]);
    expect(data.status).toMatchObject({ kind: "all-done", doneToday: 2, totalToday: 2 });
    expect(data.later).toEqual([]);
    expect(data.nextRefreshAt).toBe(fri("00:00"));
  });
});

describe("composeDashboardPageData — header status", () => {
  it("caught-up: names the earliest slot ahead and how many share its instant", () => {
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN, LISINOPRIL],
      schedulesByMedId: schedulesOf(
        fixed(METFORMIN, "20:00"),
        fixed(IBUPROFEN, "20:00"),
        fixed(LISINOPRIL, "20:00"),
      ),
    });

    expect(data.status).toEqual({
      kind: "caught-up",
      dueCount: 0,
      doneToday: 0,
      totalToday: 3,
      loggedToday: 0,
      next: {
        name: "Metformin",
        dosageAmount: "500",
        dosageUnit: "mg",
        expectedTime: thu("20:00"),
        alsoCount: 2,
      },
    });
    expect(data.later.map((r) => r.medicationId)).toEqual(["med-a", "med-b", "med-c"]);
  });

  it("none-today: a scheduled medication with no slot today", () => {
    // Monday-only; the window touches Wednesday, Thursday and Friday.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "08:00", [1])),
      doses: [dose("d1", METFORMIN, thu("09:00"))],
    });

    expect(data.status).toEqual({
      kind: "none-today",
      dueCount: 0,
      doneToday: 0,
      totalToday: 0,
      loggedToday: 1,
      next: null,
    });
  });

  it("as-needed-only: no ACTIVE medication has a timed schedule — an archived one's rows are ignored", () => {
    const ARCHIVED = makeMed({ id: "med-old", name: "Old", isArchived: true });
    const data = compose({
      now: thu("13:30"),
      // METFORMIN has no schedule rows at all.
      medications: [IBUPROFEN, METFORMIN],
      schedulesByMedId: schedulesOf(prn(IBUPROFEN), fixed(ARCHIVED, "08:00")),
      doses: [
        dose("d1", IBUPROFEN, thu("09:00")),
        dose("d2", IBUPROFEN, thu("11:00")),
        dose("d3", IBUPROFEN, thu("12:00"), { status: "skipped" }),
      ],
    });

    // loggedToday counts taken events; the skip is in Done but is not a dose logged.
    expect(data.status).toEqual({
      kind: "as-needed-only",
      dueCount: 0,
      doneToday: 0,
      totalToday: 0,
      loggedToday: 2,
      next: null,
    });
    expect(data.done.map((r) => r.key)).toEqual(["d1", "d2", "d3"]);
    expect([data.earlier, data.today, data.later]).toEqual([[], [], []]);
  });
});

describe("composeDashboardPageData — nextRefreshAt", () => {
  it("is the next slot boundary", () => {
    // 13:30: Ibuprofen's 13:45 is the nearest of t−1h, t and t+1h over the visible slots.
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "11:00"), fixed(IBUPROFEN, "13:45")),
    });
    expect(data.nextRefreshAt).toBe(thu("13:45"));
  });

  it("includes the moment an Earlier row turns twelve hours old", () => {
    // 07:00: yesterday's 22:00 expires at 10:00. Yesterday's 18:00 is
    // already hidden, so it gets no card and contributes nothing.
    const data = compose({
      now: thu("07:00"),
      medications: [METFORMIN, IBUPROFEN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "22:00"), fixed(IBUPROFEN, "18:00")),
    });
    expect(data.earlier.map((c) => c.key)).toEqual(["earlier:med-a"]);
    expect(data.nextRefreshAt).toBe(thu("10:00"));
  });

  it("includes the end of a taken dose's cooldown", () => {
    // 13:30 with a dose at 12:45: Log now may return at 13:45, before the
    // next slot boundary (13:00 + 1h = 14:00).
    const data = compose({
      now: thu("13:30"),
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "09:00"), fixed(METFORMIN, "13:00")),
      doses: [dose("d1", METFORMIN, thu("12:45"))],
    });
    expect(data.nextRefreshAt).toBe(thu("13:45"));
  });
});

describe("composeDashboardPageData — payload", () => {
  it("echoes the request's instant and zone and resolves slots in that zone", () => {
    // 13:30 BST. Fixed 11:00 London is 10:00Z; London's midnight is 23:00Z the day before.
    const data = compose({
      now: "2026-04-16T12:30:00.000Z",
      timezone: "Europe/London",
      medications: [METFORMIN],
      schedulesByMedId: schedulesOf(fixed(METFORMIN, "11:00")),
    });

    expect(data.now).toBe("2026-04-16T12:30:00.000Z");
    expect(data.timezone).toBe("Europe/London");
    expect(data.todayStart).toBe("2026-04-15T23:00:00.000Z");
    expect(data.today.map((c) => c.rows.map((r) => [r.expectedTime, r.state]))).toEqual([
      [["2026-04-16T10:00:00.000Z", "overdue"]],
    ]);
    expect(data.medications).toEqual([METFORMIN]);
    expect(data).not.toHaveProperty("refillForecast");
  });
});
