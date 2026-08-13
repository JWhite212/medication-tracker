import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import { outstandingSlots, type DoseEvent, type ScheduleSlot } from "./due";

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface TimeOfDayGroup {
  key: TimeOfDay;
  label: string;
  icon: string;
  slots: ScheduleSlot[];
}

/**
 * Classify an hour (0-23 in user's local timezone) into a time-of-day bucket.
 */
export function classifyHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

function getLocalHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

export function getLocalDateString(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getLocalDatesInRange(start: Date, end: Date, timezone: string): string[] {
  const dates = new Set<string>();
  const stepMs = 6 * 60 * 60 * 1000;
  for (let t = start.getTime(); t < end.getTime(); t += stepMs) {
    dates.add(getLocalDateString(new Date(t), timezone));
  }
  if (end.getTime() > start.getTime()) {
    dates.add(getLocalDateString(new Date(end.getTime() - 1), timezone));
  }
  return [...dates].sort();
}

/**
 * Resolve "HH:mm on local date dateStr in timezone" to a UTC instant,
 * accounting for DST.
 */
export function localTimeOnDateToUtc(dateStr: string, timeOfDay: string, timezone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeOfDay.split(":").map(Number);

  const naiveUtcMs = Date.UTC(y, m - 1, d, hh, mm);
  const naiveUtc = new Date(naiveUtcMs);

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(naiveUtc);

  const tzY = Number(parts.find((p) => p.type === "year")?.value);
  const tzMo = Number(parts.find((p) => p.type === "month")?.value);
  const tzD = Number(parts.find((p) => p.type === "day")?.value);
  const tzH = Number(parts.find((p) => p.type === "hour")?.value);
  const tzMi = Number(parts.find((p) => p.type === "minute")?.value);

  const naiveAsTzMs = Date.UTC(tzY, tzMo - 1, tzD, tzH, tzMi);
  const offsetMs = naiveAsTzMs - naiveUtcMs;

  return new Date(naiveUtcMs - offsetMs);
}

export function getLocalDayOfWeek(date: Date, timezone: string): number {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day] ?? 0;
}

/**
 * Group schedule slots into time-of-day sections.
 * Only returns groups that have at least one slot.
 */
export function groupSlotsByTimeOfDay(slots: ScheduleSlot[], timezone: string): TimeOfDayGroup[] {
  const groups: Record<TimeOfDay, ScheduleSlot[]> = {
    morning: [],
    afternoon: [],
    evening: [],
    night: [],
  };

  for (const slot of slots) {
    const hour = getLocalHour(new Date(slot.expectedTime), timezone);
    const bucket = classifyHour(hour);
    groups[bucket].push(slot);
  }

  for (const key of Object.keys(groups) as TimeOfDay[]) {
    groups[key].sort(
      (a, b) => new Date(a.expectedTime).getTime() - new Date(b.expectedTime).getTime(),
    );
  }

  const config: { key: TimeOfDay; label: string; icon: string }[] = [
    { key: "morning", label: "Morning", icon: "\u2600\uFE0F" },
    { key: "afternoon", label: "Afternoon", icon: "\uD83C\uDF24\uFE0F" },
    { key: "evening", label: "Evening", icon: "\uD83C\uDF05" },
    { key: "night", label: "Night", icon: "\uD83C\uDF19" },
  ];

  return config
    .filter((c) => groups[c.key].length > 0)
    .map((c) => ({ ...c, slots: groups[c.key] }));
}

/**
 * Temporary compatibility shim. `dashboard/+page.server.ts` still calls the
 * pre-move 8-argument shape, with `todaysDoses` and `lastDoseByMedication`
 * as two separately-sourced parameters (the latter from a standalone
 * "most recent dose per medication" query). `outstandingSlots` takes a
 * single `Evidence` instead and derives its own per-medication anchor from
 * `taken` rows in that same evidence — see the doc comment on
 * `outstandingSlots` in due.ts — so this shim folds the legacy last-dose
 * map into synthetic `taken` rows alongside the real doses.
 *
 * A medication that already has a `taken` dose today is left alone: since
 * `lastDoseByMedication[id]` is `MAX(takenAt) WHERE status = 'taken'`
 * across all time, it can never be earlier than today's own latest taken
 * dose, so today's real rows already reproduce the same anchor. Skipping
 * it there also avoids a same-instant synthetic duplicate racing the real
 * dose's id for a slot match.
 *
 * Task 7 migrates the call site to `outstandingSlots` directly and
 * deletes this function.
 */
export function computeScheduleSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  todaysDoses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
): ScheduleSlot[] {
  const takenToday = new Set(
    todaysDoses.filter((d) => d.status === "taken").map((d) => d.medicationId),
  );
  const anchorDoses: DoseEvent[] = Object.entries(lastDoseByMedication)
    .filter(([medicationId]) => !takenToday.has(medicationId))
    .map(([medicationId, takenAt]) => ({
      id: `legacy-anchor:${medicationId}`,
      medicationId,
      takenAt,
      status: "taken",
      quantity: 1,
    }));

  return outstandingSlots(
    medications,
    schedulesByMedId,
    { kind: "events", doses: [...todaysDoses, ...anchorDoses] },
    { startUtc: dayStartUtc, endUtc: dayEndUtc },
    timezone,
    now,
  );
}

export { timingStatusFromSlots } from "./due";
export type { ScheduleSlot, ScheduleSlotStatus } from "./due";
