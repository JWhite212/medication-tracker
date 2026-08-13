import type { Medication } from "$lib/types";
// Type-only import: erased at compile time, so this does NOT pull
// server code into the client bundle. Never make this a value import.
import type { MedicationSchedule } from "$lib/server/schedules";

/** The one match tolerance. A dose this close to an occurrence resolves it. */
export const SLOT_TOLERANCE_MS = 60 * 60 * 1000;

/** How many local days back the fixed-time scan looks for an elapsed occurrence. */
export const OVERDUE_LOOKBACK_DAYS = 1;

export type ScheduleKind = "fixed_time" | "interval" | "prn";

export type EffectiveSchedule = {
  id: string;
  scheduleKind: ScheduleKind;
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/**
 * The schedule-row fields this module reads. Structural rather than
 * `MedicationSchedule` so a caller assembling a row from a join projection
 * can pass it directly — no cast, no invented `userId`/`createdAt`.
 * Every real `MedicationSchedule` satisfies it.
 */
export type ScheduleRowInput = {
  id: string;
  scheduleKind: string;
  timeOfDay: string | null;
  intervalHours: string | null;
  daysOfWeek: number[] | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
};

/** Stable synthetic id for a schedule derived from the deprecated columns. */
export function legacyScheduleId(medicationId: string): string {
  return `legacy:${medicationId}`;
}

/**
 * A medication's schedules, or one synthesised from the deprecated
 * `scheduleType` / `scheduleIntervalHours` columns when it has none.
 *
 * Medications with zero schedule rows are still creatable: the import
 * schema defaults `schedules` to `[]` while accepting the legacy
 * columns, and `import/apply.ts` synthesises nothing. Absorbing that
 * here keeps the deprecated columns out of every caller.
 */
export function effectiveSchedules(
  med: Pick<Medication, "id" | "scheduleType" | "scheduleIntervalHours">,
  rows: ScheduleRowInput[],
): EffectiveSchedule[] {
  if (rows.length > 0) {
    return rows.map((r) => ({
      id: r.id,
      scheduleKind: r.scheduleKind as ScheduleKind,
      timeOfDay: r.timeOfDay,
      intervalHours: r.intervalHours,
      daysOfWeek: r.daysOfWeek,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
    }));
  }

  const base = {
    id: legacyScheduleId(med.id),
    timeOfDay: null,
    intervalHours: null,
    daysOfWeek: null,
    effectiveFrom: null,
    effectiveTo: null,
  };

  if (med.scheduleType === "as_needed") {
    return [{ ...base, scheduleKind: "prn" }];
  }

  if (med.scheduleType === "scheduled" && med.scheduleIntervalHours !== null) {
    const hrs = Number(med.scheduleIntervalHours);
    if (Number.isFinite(hrs) && hrs > 0) {
      return [{ ...base, scheduleKind: "interval", intervalHours: med.scheduleIntervalHours }];
    }
  }

  return [];
}
