// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  composeDashboardPageData,
  type DashboardCompositionInputs,
} from "$lib/server/dashboard/page-data";
import { dashboardWindow } from "$lib/utils/schedule";
import { formatDoseLabel } from "$lib/utils/dashboard-copy";
import type { TimeFormat } from "$lib/utils/time";
import { logToastFromReload } from "$lib/components/dashboard/dose-toasts";
import type { DoseLogWithMedication, Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  DEMO_DOSES,
  DEMO_STARTED_AT,
  DESKTOP_NOW,
  LOGGED_DOSE,
  MEDICATIONS,
  PHONE_NOW,
  WALKTHROUGH_TZ,
} from "$lib/components/walkthrough/demo-data";
import {
  DESKTOP_AFTER,
  DESKTOP_BEFORE,
  PHONE_AFTER,
  PHONE_BEFORE,
  PHONE_LATER_ROWS,
  type StageMoment,
} from "$lib/components/walkthrough/demo-dashboard";

/*
 * The walkthrough's dashboard, checked against the app (spec D7).
 *
 * The oracle is the real `composeDashboardPageData`, run over DEMO_DOSES at
 * each story moment with the inputs `loadDashboard` would hand it: the doses
 * in `dashboardWindow`'s fetch range (and never in the future), the
 * medications in their demo order, every schedule from `DemoMedication`, and
 * `getLastDosePerMedication`'s rule for the anchors. `page-data.ts` imports
 * only types and `utils/schedule`, so none of this needs a database.
 *
 * The helpers are exported so every describe block in this file, the render
 * checks included, builds its payloads the one way. Never import this file
 * from another test: vitest would run its cases twice.
 */

export type ComposedPayload = ReturnType<typeof composeDashboardPageData>;

const DEMO_USER_ID = "demo";

/** MEDICATIONS as rows, built the way dashboard-page-data.test.ts's `makeMed` builds them. */
function demoMedications(): Medication[] {
  return MEDICATIONS.map((m, index) => ({
    id: m.id,
    userId: DEMO_USER_ID,
    name: m.name,
    dosageAmount: m.amount,
    dosageUnit: m.unit,
    form: m.form,
    category: m.category,
    colour: m.colour,
    colourSecondary: m.colourSecondary,
    pattern: m.pattern,
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
    sortOrder: index,
    isArchived: false,
    archivedAt: null,
    // At or before the analytics window's start, so neither the lifecycle
    // clip nor the schedule-edit clip drops a slot.
    startedAt: DEMO_STARTED_AT,
    endedAt: null,
    createdAt: DEMO_STARTED_AT,
    updatedAt: DEMO_STARTED_AT,
  }));
}

/** One schedule row per interval medication, one per fixed time otherwise. */
function demoSchedules(): Map<string, MedicationSchedule[]> {
  const byMed = new Map<string, MedicationSchedule[]>();
  for (const m of MEDICATIONS) {
    const shared = {
      medicationId: m.id,
      userId: DEMO_USER_ID,
      daysOfWeek: null,
      effectiveFrom: DEMO_STARTED_AT,
      effectiveTo: null,
      createdAt: DEMO_STARTED_AT,
    };
    const { schedule } = m;
    byMed.set(
      m.id,
      schedule.kind === "interval"
        ? [
            {
              ...shared,
              id: `schedule-${m.id}-0`,
              scheduleKind: "interval",
              timeOfDay: null,
              intervalHours: schedule.intervalHours,
              sortOrder: 0,
            },
          ]
        : schedule.timesOfDay.map((timeOfDay, k) => ({
            ...shared,
            id: `schedule-${m.id}-${k}`,
            scheduleKind: "fixed_time" as const,
            timeOfDay,
            intervalHours: null,
            sortOrder: k,
          })),
    );
  }
  return byMed;
}

/** A dose as `getDosesInRange` returns it. `loggedAt` is `takenAt`: every demo dose was logged as it was taken. */
function doseRow(
  d: {
    id: string;
    medicationId: string;
    takenAt: Date;
    quantity: number;
    status: DoseLogWithMedication["status"];
  },
  med: Medication,
): DoseLogWithMedication {
  return {
    id: d.id,
    userId: DEMO_USER_ID,
    medicationId: d.medicationId,
    quantity: d.quantity,
    status: d.status,
    takenAt: d.takenAt,
    loggedAt: d.takenAt,
    updatedAt: d.takenAt,
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
  };
}

/**
 * `getLastDosePerMedication`'s rule over a dose list: `lastTakenAt` is the
 * latest taken dose, `lastEventAt` the latest taken or skipped one, and a
 * medication with neither is left out.
 */
export function lastDosesOf(
  doses: readonly DoseLogWithMedication[],
): DashboardCompositionInputs["lastDoses"] {
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

/**
 * The composer's inputs at `now`: the DEMO_DOSES named by `includeIds` (or
 * all of them), cut to `takenAt <= now` and to `dashboardWindow`'s fetch
 * range, newest first as `getDosesInRange` orders them.
 */
export function buildInputs(
  now: Date,
  includeIds: readonly string[] | "all-at-or-before-now",
): DashboardCompositionInputs {
  if (includeIds !== "all-at-or-before-now") {
    for (const id of includeIds) {
      if (!DEMO_DOSES.some((d) => d.id === id)) throw new Error(`no DEMO_DOSES entry ${id}`);
    }
  }
  const window = dashboardWindow(now, WALKTHROUGH_TZ);
  const medications = demoMedications();
  const medById = new Map(medications.map((m) => [m.id, m]));
  const doses = DEMO_DOSES.filter(
    (d) => includeIds === "all-at-or-before-now" || includeIds.includes(d.id),
  )
    .filter(
      (d) =>
        d.takenAt.getTime() <= now.getTime() &&
        d.takenAt.getTime() >= window.doseFetchFrom.getTime() &&
        d.takenAt.getTime() < window.doseFetchTo.getTime(),
    )
    .sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime())
    .map((d) => {
      const med = medById.get(d.medicationId);
      if (!med) throw new Error(`DEMO_DOSES names an unknown medication: ${d.medicationId}`);
      return doseRow(d, med);
    });
  return {
    medications,
    schedulesByMedId: demoSchedules(),
    doses,
    lastDoses: lastDosesOf(doses),
    now,
    timezone: WALKTHROUGH_TZ,
  };
}

/** The composer's payload, cut to exactly the fields a `StageMoment` holds. */
export function toStageMoment(payload: ComposedPayload): StageMoment {
  return {
    now: new Date(payload.now),
    todayStart: new Date(payload.todayStart),
    status: payload.status,
    earlier: payload.earlier,
    today: payload.today,
    done: payload.done.map((row) => {
      const { dose } = row;
      if (dose.status === "missed") throw new Error(`the stage draws no missed row: ${dose.id}`);
      const med = dose.medication;
      return {
        key: row.key,
        covers: row.covers,
        dayLabel: row.dayLabel,
        dose: {
          id: dose.id,
          medicationId: dose.medicationId,
          takenAt: dose.takenAt,
          quantity: dose.quantity,
          status: dose.status,
          name: med.name,
          dosageAmount: med.dosageAmount,
          dosageUnit: med.dosageUnit,
          colour: med.colour,
          colourSecondary: med.colourSecondary,
          pattern: med.pattern,
        },
      };
    }),
    later: payload.later,
    medications: payload.medications.map((m) => ({
      id: m.id,
      name: m.name,
      dosageAmount: m.dosageAmount,
      dosageUnit: m.dosageUnit,
      colour: m.colour,
      colourSecondary: m.colourSecondary,
      pattern: m.pattern,
    })),
  };
}

/**
 * The Undo offer's message by the production path: `logToastFromReload` over
 * the AFTER payload, as DueCard's Log now calls it. It throws when the
 * payload has no Done row for the dose, because `logToastFromReload` would
 * then return its plain fallback sentence and a check could pass on that.
 */
export function expectedOfferText(
  after: ComposedPayload,
  doseId: string,
  timeFormat: TimeFormat,
): string {
  const row = after.done.find((r) => r.dose.id === doseId);
  if (!row) throw new Error(`no Done row for ${doseId}: the offer would be the fallback sentence`);
  const med = row.dose.medication;
  return logToastFromReload(
    after,
    doseId,
    {
      label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
      quantity: 1,
      takenAt: row.dose.takenAt,
      todayStart: new Date(after.todayStart),
    },
    WALKTHROUGH_TZ,
    timeFormat,
  );
}

/** Every DEMO_DOSES id but one: a BEFORE moment's input lacks the dose its beat logs. */
function allExcept(doseId: string): string[] {
  return DEMO_DOSES.map((d) => d.id).filter((id) => id !== doseId);
}

export type MomentCase = {
  name: string;
  moment: StageMoment;
  now: Date;
  include: readonly string[] | "all-at-or-before-now";
};

export const MOMENTS: readonly MomentCase[] = [
  {
    name: "DESKTOP_BEFORE",
    moment: DESKTOP_BEFORE,
    now: DESKTOP_NOW,
    include: allExcept(LOGGED_DOSE.desktop),
  },
  {
    name: "DESKTOP_AFTER",
    moment: DESKTOP_AFTER,
    now: DESKTOP_NOW,
    include: "all-at-or-before-now",
  },
  {
    name: "PHONE_BEFORE",
    moment: PHONE_BEFORE,
    now: PHONE_NOW,
    include: allExcept(LOGGED_DOSE.phone),
  },
  { name: "PHONE_AFTER", moment: PHONE_AFTER, now: PHONE_NOW, include: "all-at-or-before-now" },
];

/** The composer's payload at one moment. */
export function composeMoment(c: MomentCase): ComposedPayload {
  return composeDashboardPageData(buildInputs(c.now, c.include));
}

export const BEATS = [
  { surface: "desktop", before: MOMENTS[0], after: MOMENTS[1], doseId: LOGGED_DOSE.desktop },
  { surface: "phone", before: MOMENTS[2], after: MOMENTS[3], doseId: LOGGED_DOSE.phone },
] as const;

describe("walkthrough dashboard moments: data", () => {
  it.each(MOMENTS)("$name equals the real composer's output at its moment", (c) => {
    expect(c.moment).toEqual(toStageMoment(composeMoment(c)));
  });

  it.each(BEATS)(
    "$surface: the AFTER input is the BEFORE input plus exactly the logged dose, taken ×1 at that moment",
    ({ before, after, doseId }) => {
      const beforeIds = buildInputs(before.now, before.include).doses.map((d) => d.id);
      const afterDoses = buildInputs(after.now, after.include).doses;
      const added = afterDoses.filter((d) => !beforeIds.includes(d.id));

      expect(after.now).toEqual(before.now);
      expect(beforeIds.every((id) => afterDoses.some((d) => d.id === id))).toBe(true);
      expect(added.map((d) => d.id)).toEqual([doseId]);
      // Log now records the moment it is tapped.
      expect(added[0]).toMatchObject({ quantity: 1, status: "taken", takenAt: after.now });
    },
  );

  it.each(BEATS)(
    "$surface: Log now sits on BEFORE's only Due card, and AFTER has no Due card and the dose in Done",
    ({ before, after, doseId }) => {
      const loggedMed = DEMO_DOSES.find((d) => d.id === doseId)?.medicationId;

      expect(before.moment.earlier).toEqual([]);
      expect(before.moment.today.map((card) => card.medicationId)).toEqual([loggedMed]);
      expect(before.moment.today[0].rows[0].logNow).toBe(true);
      expect(before.moment.done.some((row) => row.dose.id === doseId)).toBe(false);

      // The whole Due section collapses with `logged`.
      expect([...after.moment.earlier, ...after.moment.today]).toEqual([]);
      expect(after.moment.done.filter((row) => row.dose.id === doseId)).toHaveLength(1);
    },
  );

  it.each(BEATS)(
    "$surface: a row in both halves of the beat is identical in both",
    ({ before, after }) => {
      for (const field of ["earlier", "today", "done", "later"] as const) {
        const beforeRows: ReadonlyArray<{ key: string }> = before.moment[field];
        const afterRows: ReadonlyArray<{ key: string }> = after.moment[field];
        for (const row of beforeRows) {
          const twin = afterRows.find((r) => r.key === row.key);
          if (twin) expect(twin).toEqual(row);
        }
      }
    },
  );

  it.each(BEATS)(
    "$surface: the offer oracle reads the logged dose's Done row, and refuses a payload without one",
    ({ before, after, doseId }) => {
      expect(() => expectedOfferText(composeMoment(before), doseId, "24h")).toThrow(/no Done row/);

      const payload = composeMoment(after);
      const row = payload.done.find((r) => r.dose.id === doseId);
      if (!row) throw new Error(`no Done row for ${doseId}`);
      const med = row.dose.medication;
      // What the toast says when it cannot see the Done row.
      const fallbackOnly = logToastFromReload(
        undefined,
        doseId,
        {
          label: formatDoseLabel(med.name, med.dosageAmount, med.dosageUnit),
          quantity: 1,
          takenAt: row.dose.takenAt,
          todayStart: new Date(payload.todayStart),
        },
        WALKTHROUGH_TZ,
        "24h",
      );
      // The Done row's covers are exactly what the offer adds to that sentence.
      expect(expectedOfferText(payload, doseId, "24h") !== fallbackOnly).toBe(
        row.covers.length > 0,
      );
    },
  );

  it("lastDosesOf follows getLastDosePerMedication's rule", () => {
    const [vitd, lis, met] = demoMedications();
    const at = (iso: string) => new Date(iso);
    const rows = [
      doseRow(
        {
          id: "a",
          medicationId: vitd.id,
          takenAt: at("2026-09-23T09:05:00Z"),
          quantity: 1,
          status: "taken",
        },
        vitd,
      ),
      doseRow(
        {
          id: "b",
          medicationId: vitd.id,
          takenAt: at("2026-09-24T09:05:00Z"),
          quantity: 1,
          status: "skipped",
        },
        vitd,
      ),
      doseRow(
        {
          id: "c",
          medicationId: lis.id,
          takenAt: at("2026-09-24T08:00:00Z"),
          quantity: 1,
          status: "skipped",
        },
        lis,
      ),
      doseRow(
        {
          id: "d",
          medicationId: met.id,
          takenAt: at("2026-09-24T07:00:00Z"),
          quantity: 1,
          status: "missed",
        },
        met,
      ),
    ];

    expect(lastDosesOf(rows)).toEqual([
      {
        medicationId: vitd.id,
        lastTakenAt: at("2026-09-23T09:05:00Z"),
        lastEventAt: at("2026-09-24T09:05:00Z"),
      },
      { medicationId: lis.id, lastTakenAt: null, lastEventAt: at("2026-09-24T08:00:00Z") },
    ]);
  });

  it("PHONE_LATER_ROWS shows a non-empty prefix of the phone's Later list, before and after the tap", () => {
    expect(Number.isInteger(PHONE_LATER_ROWS)).toBe(true);
    expect(PHONE_LATER_ROWS).toBeGreaterThanOrEqual(1);
    expect(PHONE_LATER_ROWS).toBeLessThanOrEqual(
      Math.min(PHONE_BEFORE.later.length, PHONE_AFTER.later.length),
    );
  });
});
