import type { Medication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

export type ScheduleMode = "interval" | "fixed_time" | "prn";

const SCHEDULE_MODES = new Set<ScheduleMode>(["interval", "fixed_time", "prn"]);

export function isScheduleMode(v: unknown): v is ScheduleMode {
  return typeof v === "string" && SCHEDULE_MODES.has(v as ScheduleMode);
}

export const DAY_LABELS: { value: number; short: string }[] = [
  { value: 1, short: "Mon" },
  { value: 2, short: "Tue" },
  { value: 3, short: "Wed" },
  { value: 4, short: "Thu" },
  { value: 5, short: "Fri" },
  { value: 6, short: "Sat" },
  { value: 0, short: "Sun" },
];

/**
 * Resolve which schedule mode the editor should open in.
 *
 * Precedence (highest first):
 *   1. A previously submitted form value (after a validation failure
 *      the action sends `formValues.scheduleMode` back so the user
 *      doesn't lose their last selection).
 *   2. The schedules saved on the medication (homogeneous matches;
 *      mixed kinds fall back to fixed_time, the most flexible).
 *   3. The legacy `medication.scheduleType === "as_needed"` flag.
 *   4. Default to interval for brand-new medications.
 */
export function deriveInitialMode(input: {
  formValueMode?: string | undefined;
  schedules: MedicationSchedule[];
  medication?: Medication;
}): ScheduleMode {
  if (isScheduleMode(input.formValueMode)) return input.formValueMode;
  if (input.schedules.length > 0) {
    const kinds = new Set(input.schedules.map((s) => s.scheduleKind));
    if (kinds.size === 1) {
      const only = [...kinds][0];
      if (only === "fixed_time") return "fixed_time";
      if (only === "prn") return "prn";
      return "interval";
    }
    return "fixed_time";
  }
  if (input.medication?.scheduleType === "as_needed") return "prn";
  return "interval";
}

/**
 * Initial list of fixed-time slots for the editor. Returns the saved
 * times for fixed-time schedules, or a single 08:00 default for
 * brand-new medications.
 */
export function deriveInitialFixedTimes(schedules: MedicationSchedule[]): string[] {
  const fixed = schedules.filter((s) => s.scheduleKind === "fixed_time" && s.timeOfDay);
  if (fixed.length > 0) return fixed.map((s) => s.timeOfDay!);
  return ["08:00"];
}

/**
 * Initial day-of-week filter. Returns the saved days for the first
 * fixed-time schedule that has them, or an empty array (every day).
 */
export function deriveInitialDaysOfWeek(schedules: MedicationSchedule[]): number[] {
  const fixed = schedules.find((s) => s.scheduleKind === "fixed_time" && s.daysOfWeek);
  return (fixed?.daysOfWeek ?? []) as number[];
}
