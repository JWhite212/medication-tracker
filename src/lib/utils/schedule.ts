import type { Medication, DoseLogWithMedication } from "$lib/types";
import type { MedicationSchedule } from "$lib/server/schedules";
import {
  classifyDueStatus,
  isoDayKey,
  wallClockToInstant,
  dayOfWeekForDayKey,
  startOfDay,
  endOfDay,
  shiftDayKey,
} from "./time";
import { parseIntervalHours } from "$lib/utils/schedule-rate";

export type ScheduleSlotStatus = "taken" | "skipped" | "upcoming" | "overdue";

/** The two schedule kinds that project slots. `prn` rows never do. */
export type ScheduleKind = "interval" | "fixed_time";

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

/**
 * How far either side of a slot a dose may sit and still count for it, and
 * how far past today the dashboard projects. Tomorrow's first hour is
 * matched so that today's view makes the same choice tomorrow's will.
 */
export const MATCH_TOLERANCE_MS = 60 * 60 * 1000; // 1 hour

/**
 * How long an unresolved slot from before local midnight stays on the
 * dashboard, in the "Earlier" group. `reminders/domain.ts` uses the same
 * value for how long the cron keeps reminding about such a slot. It is one
 * constant so that both surfaces fall silent at the same millisecond.
 * Today's slots are not capped by it.
 */
export const CARRY_OVER_MS = 12 * 60 * 60 * 1000;

/** Every bound the dashboard uses, computed once per request from one `now`. */
export interface DashboardWindow {
  now: Date;
  /** The user's civil day, `YYYY-MM-DD`. */
  todayKey: string;
  todayStart: Date;
  /** Exclusive: the start of the next civil day. */
  end: Date;
  /** Yesterday's local midnight. Walked by day key, never `todayStart − 24h`. */
  projectStart: Date;
  /** `end + MATCH_TOLERANCE_MS`. Tomorrow's first hour is matched, never shown. */
  projectEnd: Date;
  /** The earliest instant an Earlier row may have and still be shown. */
  visibleStart: Date;
  doseFetchFrom: Date;
  /** Exclusive. */
  doseFetchTo: Date;
}

/**
 * THE owner of the dashboard's bounds. The load, the Log-now server check
 * and `checkSlotActionTime` all call it, so none of them can disagree about
 * where "today", "Earlier" or "tomorrow's first hour" begins.
 *
 * - `projectStart` walks the day KEY. `todayStart − 24h` is wrong twice a
 *   year in every DST zone. On Europe/London 2026-10-26 it lands at 01:00
 *   BST on the 25th and loses yesterday's first hour.
 * - `visibleStart` is the first millisecond under 12 hours old: a slot at
 *   exactly `now − 12h` is hidden, and one at `now − 12h + 1ms` is shown.
 *   It is clamped into `[projectStart, todayStart]`, because the 12-hour
 *   bound applies to Earlier rows only and today's rows stay visible until
 *   midnight.
 * - `doseFetchFrom` covers pass 1's one-hour reach before the first
 *   projected slot. `doseFetchTo` covers its reach past the last slot in
 *   tomorrow's first hour.
 */
export function dashboardWindow(now: Date, tz: string): DashboardWindow {
  const todayKey = isoDayKey(now, tz);
  const todayStart = startOfDay(now, tz);
  const end = endOfDay(now, tz);
  const projectStart = wallClockToInstant(shiftDayKey(todayKey, -1), "00:00", tz);
  const visibleStartMs = Math.max(
    projectStart.getTime(),
    Math.min(todayStart.getTime(), now.getTime() - CARRY_OVER_MS + 1),
  );

  return {
    now: new Date(now.getTime()),
    todayKey,
    todayStart,
    end,
    projectStart,
    projectEnd: new Date(end.getTime() + MATCH_TOLERANCE_MS),
    visibleStart: new Date(visibleStartMs),
    doseFetchFrom: new Date(projectStart.getTime() - MATCH_TOLERANCE_MS),
    doseFetchTo: new Date(end.getTime() + 2 * MATCH_TOLERANCE_MS),
  };
}

export type SlotActionTimeProblem = "future" | "stale";

/**
 * Whether a client-sent `takenAt` (from Took it at or Skip) may still be
 * written. 'future' means the instant is after now, and no dose row is ever
 * future-dated. 'stale' means the row it came from has already left the
 * dashboard (it is older than the Earlier bound), so the tap was made on a
 * page that no longer shows what is due.
 */
export function checkSlotActionTime(at: Date, now: Date, tz: string): SlotActionTimeProblem | null {
  if (at.getTime() > now.getTime()) return "future";
  if (at.getTime() < dashboardWindow(now, tz).visibleStart.getTime()) return "stale";
  return null;
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

/**
 * A day KEY, not a label: callers compare it and use it to index slots, so it
 * goes through `isoDayKey` and never follows `preferences.dateFormat`.
 */
export function getLocalDateString(date: Date, timezone: string): string {
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
 * The projection range, cut into three segments at instants — never at day
 * keys, because a resolved instant does not carry a civil day (see
 * `wallClockToInstant`):
 *
 *   yesterday          [projectStart, todayStart)
 *   today              [todayStart,   end)
 *   tomorrow's 1st hour [end,         projectEnd)
 *
 * Tomorrow's first hour is projected and matched but never returned, so
 * today's view already makes the choice tomorrow's view will make.
 */
export interface Segments {
  projectStart: Date;
  todayStart: Date;
  end: Date;
  projectEnd: Date;
}

/** The dashboard's three segments, straight off its window. */
export function segmentsFor(window: DashboardWindow): Segments {
  return {
    projectStart: window.projectStart,
    todayStart: window.todayStart,
    end: window.end,
    projectEnd: window.projectEnd,
  };
}

/**
 * One civil day and nothing either side: yesterday and tomorrow's first hour
 * collapse to empty ranges. What `computeScheduleSlots` uses without a window.
 */
export function singleDaySegments(dayStart: Date, dayEnd: Date): Segments {
  return { projectStart: dayStart, todayStart: dayStart, end: dayEnd, projectEnd: dayEnd };
}

export interface ProjectedSlot {
  expectedTime: Date;
  kind: ScheduleKind;
  segment: "yesterday" | "today" | "tomorrow";
}

/**
 * Every fixed-time instant in `[projectStart, projectEnd)`, deduplicated and
 * ascending, for every `fixed_time` row in `schedules`.
 *
 * THE only projection step that reads a timezone. Each day key the range
 * touches is resolved with `wallClockToInstant`; the instant is then kept or
 * dropped by comparing it with the range, never by re-deriving its day.
 * Day-of-week comes from the requested date KEY, never from the resolved
 * instant: on a transition that swallows the scheduled minute the instant can
 * legitimately land on the next civil day (America/Godthab springs forward at
 * 23:00 local), and reading the weekday off it would turn a Saturday-only
 * medication into a Sunday one and drop the slot entirely.
 *
 * Callers compute this once per medication per request and hand the result
 * to `projectMedicationSlots`, which is pure arithmetic and can therefore be
 * re-run cheaply for every simulated write.
 */
export function projectFixedTimes(
  schedules: MedicationSchedule[],
  segments: Segments,
  tz: string,
): Date[] {
  const startMs = segments.projectStart.getTime();
  const endMs = segments.projectEnd.getTime();
  const fixedRows = schedules.filter((s) => s.scheduleKind === "fixed_time");
  if (fixedRows.length === 0 || endMs <= startMs) return [];

  const dayKeys = getLocalDatesInRange(segments.projectStart, segments.projectEnd, tz);
  const instants = new Set<number>();
  for (const schedule of fixedRows) {
    const timeOfDay = schedule.timeOfDay;
    if (!timeOfDay) continue;
    const allowed = schedule.daysOfWeek;
    for (const dayKey of dayKeys) {
      if (allowed && allowed.length > 0 && !allowed.includes(dayOfWeekForDayKey(dayKey))) {
        continue;
      }
      const ms = wallClockToInstant(dayKey, timeOfDay, tz).getTime();
      if (ms >= startMs && ms < endMs) instants.add(ms);
    }
  }
  return [...instants].sort((a, b) => a - b).map((ms) => new Date(ms));
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

      let status: ScheduleSlotStatus;
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
 * Derive a QuickLogBar-style timing status from a medication's My Day
 * slots: the earliest unresolved (overdue/upcoming) slot is the next
 * due dose. Returns null when nothing is pending today — used for
 * fixed-time medications, whose deprecated legacy interval columns are
 * null and who therefore never matched the interval-based path.
 */
export function timingStatusFromSlots(
  slots: ScheduleSlot[],
  now: Date,
): { status: "ok" | "due_soon" | "due_now" | "overdue"; minutesUntilDue: number } | null {
  let pending: ScheduleSlot | undefined;
  for (const s of slots) {
    if (s.status !== "overdue" && s.status !== "upcoming") continue;
    if (!pending || new Date(s.expectedTime).getTime() < new Date(pending.expectedTime).getTime()) {
      pending = s;
    }
  }
  if (!pending) return null;

  const msUntilDue = new Date(pending.expectedTime).getTime() - now.getTime();
  return {
    status: classifyDueStatus(msUntilDue),
    minutesUntilDue: Math.round(msUntilDue / 60_000),
  };
}
