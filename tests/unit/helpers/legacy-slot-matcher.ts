/**
 * THE ORACLE for tests/unit/schedule-matching-properties.test.ts: the
 * dashboard's slot matcher exactly as it shipped before passes 0–2, from
 * commit fd9ff74, src/lib/utils/schedule.ts lines 51–293.
 *
 * Everything between the two marker comments below is that range byte for
 * byte, with four mechanical renames and nothing else:
 * - `getLocalDateString` loses its `export`
 * - `ScheduleSlotStatus` → `LegacyScheduleSlotStatus`
 * - `ScheduleSlot[]` → `LegacyScheduleSlot[]`
 * - `computeScheduleSlots(` → `legacyComputeScheduleSlots(`
 * The header of the properties test holds the check that proves it.
 *
 * Never fix, refactor, reformat or "modernise" this file: a corrected
 * oracle compares against nothing. It is not a test (vitest collects only
 * `*.test.ts`), and nothing under src/ may import it.
 */
import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import { isoDayKey, wallClockToInstant, dayOfWeekForDayKey } from "$lib/utils/time";
import { parseIntervalHours } from "$lib/utils/schedule-rate";

export type LegacyScheduleSlotStatus = "taken" | "skipped" | "upcoming" | "overdue";

export interface LegacyScheduleSlot {
  medicationId: string;
  medicationName: string;
  colour: string;
  colourSecondary: string | null;
  pattern: string;
  dosageAmount: string;
  dosageUnit: string;
  expectedTime: string; // ISO string
  status: LegacyScheduleSlotStatus;
  matchedDoseId: string | null;
}

const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

// ---- VERBATIM-START ----
/**
 * A day KEY, not a label: callers compare it and use it to index slots, so it
 * goes through `isoDayKey` and never follows `preferences.dateFormat`.
 */
function getLocalDateString(date: Date, timezone: string): string {
  return isoDayKey(date, timezone);
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
    // Day-of-week comes from the requested date KEY, never from the resolved
    // instant. On a transition that swallows the scheduled minute the instant
    // can legitimately land on the next civil day (America/Godthab springs
    // forward at 23:00 local), and reading the weekday off it would turn a
    // Saturday-only medication into a Sunday one and drop the slot entirely.
    if (allowed && allowed.length > 0) {
      if (!allowed.includes(dayOfWeekForDayKey(dateStr))) continue;
    }

    const utc = wallClockToInstant(dateStr, schedule.timeOfDay, timezone);
    if (utc.getTime() < dayStartUtc.getTime() || utc.getTime() >= dayEndUtc.getTime()) {
      continue;
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
export function legacyComputeScheduleSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  todaysDoses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
): LegacyScheduleSlot[] {
  const slots: LegacyScheduleSlot[] = [];

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

    const expectedTimes: { time: Date; kind: "interval" | "fixed_time" }[] = [];

    for (const schedule of medSchedules) {
      if (schedule.scheduleKind === "prn") continue;

      if (schedule.scheduleKind === "interval") {
        const intervalHours = parseIntervalHours(schedule.intervalHours);
        if (intervalHours === null) continue;
        const lastDose = lastDoseByMedication[med.id];
        const anchor = lastDose ? new Date(lastDose.getTime()) : new Date(dayStartUtc.getTime());
        for (const t of expectedTimesForInterval(intervalHours, anchor, dayStartUtc, dayEndUtc)) {
          expectedTimes.push({ time: t, kind: "interval" });
        }
      } else if (schedule.scheduleKind === "fixed_time") {
        for (const t of expectedTimesForFixedTime(schedule, dayStartUtc, dayEndUtc, timezone)) {
          expectedTimes.push({ time: t, kind: "fixed_time" });
        }
      }
    }

    if (expectedTimes.length === 0) continue;

    // Dedupe — two schedule rows might emit the same expected time.
    // On an exact collision keep the fixed_time entry so the declared
    // schedule, not the derived interval projection, is canonical.
    const byTime = new Map<number, { time: Date; kind: "interval" | "fixed_time" }>();
    for (const e of expectedTimes) {
      const key = e.time.getTime();
      const existing = byTime.get(key);
      if (!existing || (existing.kind === "interval" && e.kind === "fixed_time")) {
        byTime.set(key, e);
      }
    }

    // Interval projections anchor to the *actual* last-taken time, so
    // they drift with the user's behaviour (log at 08:55 → project
    // 08:55). When such a projection lands within the matching
    // tolerance of a declared fixed_time slot it is the same intended
    // dose, not an extra one — drop the phantom twin and keep the
    // declared time. Explicit fixed_time rows are never collapsed.
    const fixedMs = [...byTime.values()]
      .filter((e) => e.kind === "fixed_time")
      .map((e) => e.time.getTime());
    const dedup = [...byTime.values()]
      .filter(
        (e) =>
          e.kind === "fixed_time" ||
          !fixedMs.some((f) => Math.abs(f - e.time.getTime()) <= MATCH_TOLERANCE_MS),
      )
      .map((e) => e.time);
    dedup.sort((a, b) => a.getTime() - b.getTime());

    const medDoses = dosesByMedId.get(med.id) ?? [];

    // Capacity-based matching: a single logged dose can satisfy several
    // nearby slots, up to the number of units actually taken. A `taken`
    // dose has a capacity equal to its quantity (so logging ×3 in one go
    // covers up to three slots within the vicinity window); a `skipped` or
    // `missed` row can only ever clear one slot. `remaining` is decremented
    // as slots consume each dose's capacity.
    const remaining = new Map<string, number>();
    for (const d of medDoses) {
      remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
    }

    for (const expected of dedup) {
      const expectedMs = expected.getTime();

      // Pick the best in-vicinity dose with capacity left: prefer a real
      // `taken` dose over a `skipped`/`missed` one, then the nearest in
      // time, tie-broken by id for deterministic output.
      let matchedDose: DoseLogWithMedication | undefined;
      let bestRank = Infinity;
      let bestDist = Infinity;
      for (const d of medDoses) {
        if ((remaining.get(d.id) ?? 0) <= 0) continue;
        const dist = Math.abs(new Date(d.takenAt).getTime() - expectedMs);
        if (dist > MATCH_TOLERANCE_MS) continue;
        const rank = d.status === "taken" ? 0 : 1;
        const better =
          rank < bestRank ||
          (rank === bestRank && dist < bestDist) ||
          (rank === bestRank && dist === bestDist && (!matchedDose || d.id < matchedDose.id));
        if (better) {
          matchedDose = d;
          bestRank = rank;
          bestDist = dist;
        }
      }
      if (matchedDose) {
        remaining.set(matchedDose.id, (remaining.get(matchedDose.id) ?? 0) - 1);
      }

      let status: LegacyScheduleSlotStatus;
      if (matchedDose) {
        if (matchedDose.status === "skipped") status = "skipped";
        // A "missed" dose row hasn't actually been consumed, so the slot
        // is still unfulfilled — render it as overdue, not green-check
        // taken.
        else if (matchedDose.status === "missed") status = "overdue";
        else status = "taken";
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
// ---- VERBATIM-END ----
