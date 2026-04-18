import type { Medication, DoseLogWithMedication } from "$lib/types";

export type ScheduleSlotStatus = "taken" | "upcoming" | "overdue";

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

/**
 * Get the local hour of a Date in the given timezone.
 */
function getLocalHour(date: Date, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hour12: false,
  }).formatToParts(date);
  return Number(parts.find((p) => p.type === "hour")?.value ?? 0);
}

/**
 * Compute expected dose schedule slots for today.
 *
 * For each scheduled medication with a known interval, project forward from
 * the last dose in `intervalHours` increments and clip to today's boundaries.
 * Then match actual doses within +/- 1 hour tolerance.
 */
export function computeScheduleSlots(
  medications: Medication[],
  todaysDoses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
): ScheduleSlot[] {
  const slots: ScheduleSlot[] = [];

  // Pre-index doses by medicationId to avoid repeated O(n) filtering
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
    if (med.scheduleType !== "scheduled") continue;
    const intervalHours = Number(med.scheduleIntervalHours);
    if (!intervalHours || intervalHours <= 0) continue;

    const intervalMs = intervalHours * 60 * 60 * 1000;

    const lastDose = lastDoseByMedication[med.id];
    const anchor = lastDose
      ? new Date(lastDose.getTime())
      : new Date(dayStartUtc.getTime());

    const expectedTimes: Date[] = [];

    let t = new Date(anchor.getTime());
    if (t.getTime() < dayStartUtc.getTime()) {
      const diff = dayStartUtc.getTime() - t.getTime();
      const intervals = Math.ceil(diff / intervalMs);
      t = new Date(t.getTime() + intervals * intervalMs);
    }

    while (t.getTime() < dayEndUtc.getTime()) {
      expectedTimes.push(new Date(t.getTime()));
      t = new Date(t.getTime() + intervalMs);
    }

    // Anchor may fall within today but not on an interval boundary from day start
    if (
      lastDose &&
      lastDose.getTime() >= dayStartUtc.getTime() &&
      lastDose.getTime() < dayEndUtc.getTime()
    ) {
      if (!expectedTimes.some((et) => et.getTime() === lastDose.getTime())) {
        expectedTimes.push(new Date(lastDose.getTime()));
      }
    }

    expectedTimes.sort((a, b) => a.getTime() - b.getTime());

    const medDoses = dosesByMedId.get(med.id) ?? [];

    for (const expected of expectedTimes) {
      const matchedDose = medDoses.find(
        (d) =>
          Math.abs(new Date(d.takenAt).getTime() - expected.getTime()) <=
          MATCH_TOLERANCE_MS,
      );

      let status: ScheduleSlotStatus;
      if (matchedDose) {
        status = "taken";
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
export function groupSlotsByTimeOfDay(
  slots: ScheduleSlot[],
  timezone: string,
): TimeOfDayGroup[] {
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
      (a, b) =>
        new Date(a.expectedTime).getTime() - new Date(b.expectedTime).getTime(),
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
