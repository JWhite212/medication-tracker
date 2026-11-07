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

/** One schedule row exactly as the form posts it in its `schedules` field. */
export type PostedScheduleRow =
  | { scheduleKind: "interval"; intervalHours: number }
  | { scheduleKind: "fixed_time"; timeOfDay: string | null; daysOfWeek: number[] | null }
  | { scheduleKind: "prn" };

/**
 * What the editor posts for its current state. The form models ONE schedule
 * shape: a single interval row, a single as-needed row, or any number of
 * fixed times that all share one set of days.
 */
export function serialiseFormSchedules(state: {
  mode: ScheduleMode;
  intervalHours: string;
  fixedTimes: string[];
  daysOfWeek: number[];
}): PostedScheduleRow[] {
  if (state.mode === "prn") return [{ scheduleKind: "prn" }];
  if (state.mode === "interval") {
    const hrs = Number(state.intervalHours);
    return [{ scheduleKind: "interval", intervalHours: Number.isFinite(hrs) && hrs > 0 ? hrs : 0 }];
  }
  return state.fixedTimes
    .filter((t) => /^\d{2}:\d{2}$/.test(t))
    .map((t) => ({
      scheduleKind: "fixed_time",
      timeOfDay: t,
      daysOfWeek: state.daysOfWeek.length > 0 ? state.daysOfWeek : null,
    }));
}

/**
 * A stored schedule row in the posted shape, unchanged. An empty day list is
 * written as null, which `buildScheduleRows` stores for an empty list anyway,
 * so both mean "every day".
 */
export function storedScheduleAsPosted(s: MedicationSchedule): PostedScheduleRow {
  if (s.scheduleKind === "interval") {
    return { scheduleKind: "interval", intervalHours: Number(s.intervalHours) };
  }
  if (s.scheduleKind === "fixed_time") {
    const days = (s.daysOfWeek ?? null) as number[] | null;
    return {
      scheduleKind: "fixed_time",
      timeOfDay: s.timeOfDay,
      daysOfWeek: days && days.length > 0 ? days : null,
    };
  }
  return { scheduleKind: "prn" };
}

/**
 * Can the editor show these stored rows without changing them on save?
 *
 * Decided by round trip, not by a list of shapes: seed the editor's state the
 * way MedicationForm does, serialise it the way MedicationForm does, and
 * compare with the stored rows. So anything the form would rewrite (fixed
 * times on different days, interval and fixed rows together, two interval
 * rows) is unrepresentable by construction, and a future change to the form's
 * model moves this answer with it. `/api/v1` and import can store all of
 * those shapes; the edit page shows them read-only and posts them back as
 * they are.
 */
export function isRepresentableByForm(schedules: MedicationSchedule[]): boolean {
  if (schedules.length === 0) return true;
  const seeded = serialiseFormSchedules({
    mode: deriveInitialMode({ schedules }),
    intervalHours: schedules.find((s) => s.scheduleKind === "interval")?.intervalHours ?? "",
    fixedTimes: deriveInitialFixedTimes(schedules),
    daysOfWeek: deriveInitialDaysOfWeek(schedules),
  });
  return JSON.stringify(seeded) === JSON.stringify(schedules.map(storedScheduleAsPosted));
}

/** A stored row as one read-only line, for a schedule the form cannot edit. */
export function describeStoredSchedule(s: MedicationSchedule): string {
  if (s.scheduleKind === "interval") return `Every ${Number(s.intervalHours)} hours`;
  if (s.scheduleKind === "prn") return "As needed";
  const days = (s.daysOfWeek ?? []) as number[];
  const when =
    days.length === 0
      ? "every day"
      : DAY_LABELS.filter((d) => days.includes(d.value))
          .map((d) => d.short)
          .join(", ");
  return `${s.timeOfDay ?? "No time"}, ${when}`;
}

export type NotificationChoice = "inherit" | "on" | "off";

const NOTIFICATION_CHOICES = new Set<NotificationChoice>(["inherit", "on", "off"]);

/**
 * Which option a tri-state notification select should open on.
 *
 * Precedence mirrors deriveInitialMode: a resubmitted form value wins, so
 * a validation failure elsewhere on the form does not silently discard
 * the user's notification choice, then the saved column, then inherit.
 */
export function deriveNotificationValue(
  formValue: string | undefined,
  saved: boolean | null | undefined,
): NotificationChoice {
  if (formValue !== undefined && NOTIFICATION_CHOICES.has(formValue as NotificationChoice)) {
    return formValue as NotificationChoice;
  }
  if (saved === true) return "on";
  if (saved === false) return "off";
  return "inherit";
}
