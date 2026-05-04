import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";

export type ScheduleSlotStatus = "taken" | "skipped" | "upcoming" | "overdue";

export interface ScheduleSlot {
  medicationId: string;
  medicationName: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  dosageAmount: string;
  dosageUnit: string;
  expectedTime: string; // ISO string
  status: ScheduleSlotStatus;
  matchedDoseId: string | null;
}

export type TimeOfDay = "morning" | "afternoon" | "evening" | "night";

export interface TimeOfDayGroup {
  key: TimeOfDay;
  label: string;
  icon: string;
  slots: ScheduleSlot[];
}

const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

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

function getLocalDatesInRange(start: Date, end: Date, timezone: string): string[] {
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

function expectedTimesForInterval(
  intervalHours: number,
  anchor: Date,
  dayStartUtc: Date,
  dayEndUtc: Date,
): Date[] {
  if (!intervalHours || intervalHours <= 0) return [];
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const out: Date[] = [];

  let t = new Date(anchor.getTime());
  if (t.getTime() < dayStartUtc.getTime()) {
    const diff = dayStartUtc.getTime() - t.getTime();
    const intervals = Math.ceil(diff / intervalMs);
    t = new Date(t.getTime() + intervals * intervalMs);
  }

  while (t.getTime() < dayEndUtc.getTime()) {
    out.push(new Date(t.getTime()));
    t = new Date(t.getTime() + intervalMs);
  }

  if (
    anchor.getTime() >= dayStartUtc.getTime() &&
    anchor.getTime() < dayEndUtc.getTime() &&
    !out.some((et) => et.getTime() === anchor.getTime())
  ) {
    out.push(new Date(anchor.getTime()));
  }

  out.sort((a, b) => a.getTime() - b.getTime());
  return out;
}

function expectedTimesForFixedTime(
  schedule: MedicationSchedule,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
): Date[] {
  if (!schedule.timeOfDay) return [];
  const out: Date[] = [];
  const allowed = schedule.daysOfWeek;

  for (const dateStr of getLocalDatesInRange(dayStartUtc, dayEndUtc, timezone)) {
    const utc = localTimeOnDateToUtc(dateStr, schedule.timeOfDay, timezone);
    if (utc.getTime() < dayStartUtc.getTime() || utc.getTime() >= dayEndUtc.getTime()) {
      continue;
    }
    if (allowed && allowed.length > 0) {
      if (!allowed.includes(getLocalDayOfWeek(utc, timezone))) continue;
    }
    out.push(utc);
  }

  return out;
}

/**
 * Compute expected dose schedule slots for the window.
 *
 * Walks every schedule row for each medication. Interval rows project
 * forward from the last dose (or window start) by intervalHours.
 * Fixed-time rows produce one slot per local-time-of-day per local
 * day in the window, optionally filtered by daysOfWeek. PRN rows
 * produce no slots.
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
  const slots: ScheduleSlot[] = [];

  const dosesByMedId = new Map<string, DoseLogWithMedication[]>();
  for (const dose of todaysDoses) {
    let arr = dosesByMedId.get(dose.medicationId);
    if (!arr) {
      arr = [];
      dosesByMedId.set(dose.medicationId, arr);
    }
    arr.push(dose);
  }

  for (const med of medications) {
    const medSchedules = schedulesByMedId.get(med.id) ?? [];
    if (medSchedules.length === 0) continue;

    const expectedTimes: Date[] = [];

    for (const schedule of medSchedules) {
      if (schedule.scheduleKind === "prn") continue;

      if (schedule.scheduleKind === "interval") {
        const intervalHours = schedule.intervalHours ? Number(schedule.intervalHours) : 0;
        if (!intervalHours || intervalHours <= 0) continue;
        const lastDose = lastDoseByMedication[med.id];
        const anchor = lastDose ? new Date(lastDose.getTime()) : new Date(dayStartUtc.getTime());
        expectedTimes.push(
          ...expectedTimesForInterval(intervalHours, anchor, dayStartUtc, dayEndUtc),
        );
      } else if (schedule.scheduleKind === "fixed_time") {
        expectedTimes.push(
          ...expectedTimesForFixedTime(schedule, dayStartUtc, dayEndUtc, timezone),
        );
      }
    }

    if (expectedTimes.length === 0) continue;

    // Dedupe — two schedule rows might emit the same expected time.
    const seen = new Set<number>();
    const dedup: Date[] = [];
    for (const t of expectedTimes) {
      if (seen.has(t.getTime())) continue;
      seen.add(t.getTime());
      dedup.push(t);
    }
    dedup.sort((a, b) => a.getTime() - b.getTime());

    const medDoses = dosesByMedId.get(med.id) ?? [];
    const usedDoseIds = new Set<string>();

    for (const expected of dedup) {
      const matchedDose = medDoses.find(
        (d) =>
          !usedDoseIds.has(d.id) &&
          Math.abs(new Date(d.takenAt).getTime() - expected.getTime()) <= MATCH_TOLERANCE_MS,
      );
      if (matchedDose) usedDoseIds.add(matchedDose.id);

      let status: ScheduleSlotStatus;
      if (matchedDose) {
        status = matchedDose.status === "skipped" ? "skipped" : "taken";
      } else if (expected.getTime() <= now.getTime()) {
        status = "overdue";
      } else {
        status = "upcoming";
      }

      slots.push({
        medicationId: med.id,
        medicationName: med.name,
        colour: med.colour,
        colourSecondary: med.colourSecondary,
        pattern: med.pattern,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        expectedTime: expected.toISOString(),
        status,
        matchedDoseId: matchedDose?.id ?? null,
      });
    }
  }

  return slots;
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
