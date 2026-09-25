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
  kind: ScheduleKind;
  status: ScheduleSlotStatus;
  /** `resolvedByDoseId ?? missedByDoseId ?? null`, kept for existing readers. */
  matchedDoseId: string | null;
  /** The taken or skipped dose that resolved this slot. Covers and toasts read this. */
  resolvedByDoseId: string | null;
  /** A `missed` row matched to this slot. A missed row never resolves a slot. */
  missedByDoseId: string | null;
  /** `expectedTime < todayStart`, by instant: an "Earlier" row on the dashboard. */
  isEarlier: boolean;
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

function segmentOf(ms: number, segments: Segments): ProjectedSlot["segment"] {
  if (ms < segments.todayStart.getTime()) return "yesterday";
  if (ms < segments.end.getTime()) return "today";
  return "tomorrow";
}

/**
 * One medication's slots over the three segments, deduplicated and ascending.
 *
 * Pure arithmetic: no `Intl`, no `isoDayKey`, no `wallClockToInstant`. The
 * only timezone-dependent input is `fixedInstants`, from `projectFixedTimes`.
 *
 * - **Interval rows** anchor on `lastTakenAt` and step by whole intervals
 *   across the range. With no taken dose ever, each segment gets its own grid
 *   anchored at that segment's start, so today's grid is exactly the one a
 *   single-day projection has always drawn and nothing slides during the day.
 * - **Exact collision**: an interval point on a fixed instant is that fixed
 *   slot; the declared schedule, not the derived projection, is canonical.
 * - **Drifted twin, per segment**: interval projections drift with the user's
 *   behaviour (log at 08:55 → project 08:55). One within the matching
 *   tolerance of a declared fixed slot IN THE SAME SEGMENT is the same
 *   intended dose and is dropped. Across segments it is not: yesterday's
 *   23:30 must not delete today's 00:10.
 * - **Lifecycle clip**: nothing outside `[startedAt, endedAt]`. A medication
 *   created at 14:00 has no 08:00 slot and no yesterday.
 * - **Schedule-edit clip** (before `todayStart` only): every save rewrites a
 *   medication's schedule rows with `effectiveFrom = now`, so the current rows
 *   say nothing about what was scheduled before that save. A yesterday slot
 *   earlier than the medication's earliest `effectiveFrom` is dropped rather
 *   than shown as outstanding beside the dose that was actually due then.
 *   Today's slots are unaffected.
 */
export function projectMedicationSlots(input: {
  med: Medication;
  schedules: MedicationSchedule[];
  fixedInstants: Date[];
  lastTakenAt: Date | null;
  segments: Segments;
}): ProjectedSlot[] {
  const { med, schedules, fixedInstants, lastTakenAt, segments } = input;

  const kindAt = new Map<number, ScheduleKind>();
  for (const t of fixedInstants) kindAt.set(t.getTime(), "fixed_time");

  const segmentRanges: Array<[Date, Date]> = [
    [segments.projectStart, segments.todayStart],
    [segments.todayStart, segments.end],
    [segments.end, segments.projectEnd],
  ];
  for (const schedule of schedules) {
    if (schedule.scheduleKind !== "interval") continue;
    const intervalHours = parseIntervalHours(schedule.intervalHours);
    if (intervalHours === null) continue;
    const points = lastTakenAt
      ? expectedTimesForInterval(
          intervalHours,
          lastTakenAt,
          segments.projectStart,
          segments.projectEnd,
        )
      : segmentRanges.flatMap(([from, to]) =>
          expectedTimesForInterval(intervalHours, from, from, to),
        );
    for (const t of points) {
      // Set only when absent: an exact collision keeps fixed_time.
      if (!kindAt.has(t.getTime())) kindAt.set(t.getTime(), "interval");
    }
  }

  const candidates = [...kindAt].map(([ms, kind]) => ({
    ms,
    kind,
    segment: segmentOf(ms, segments),
  }));

  const startedMs = new Date(med.startedAt).getTime();
  const endedMs = med.endedAt ? new Date(med.endedAt).getTime() : Infinity;
  const todayStartMs = segments.todayStart.getTime();
  const effectiveFromMs = Math.min(...schedules.map((s) => new Date(s.effectiveFrom).getTime()));

  const fixed = candidates.filter((c) => c.kind === "fixed_time");

  return candidates
    .filter(
      (c) =>
        c.kind === "fixed_time" ||
        !fixed.some((f) => f.segment === c.segment && Math.abs(f.ms - c.ms) <= MATCH_TOLERANCE_MS),
    )
    .filter((c) => !(c.ms < startedMs) && !(c.ms > endedMs))
    .filter((c) => !(c.ms < todayStartMs && c.ms < effectiveFromMs))
    .sort((a, b) => a.ms - b.ms)
    .map((c) => ({ expectedTime: new Date(c.ms), kind: c.kind, segment: c.segment }));
}

/** A dose as the matcher sees it. */
export interface MatchDose {
  id: string;
  takenAt: Date;
  status: "taken" | "skipped" | "missed";
  quantity: number;
}

export interface MatchedSlot extends ProjectedSlot {
  status: ScheduleSlotStatus;
  resolvedByDoseId: string | null;
  missedByDoseId: string | null;
}

/**
 * Match one medication's projected slots to its doses.
 *
 * Every pass spends from ONE capacity map. A taken dose covers
 * `max(1, quantity)` slots; a skipped or missed row covers exactly one.
 *
 * - Pass 0 (taken only): a dose recorded at exactly a slot's instant claims
 *   that slot, with the smaller id winning a tie.
 * - Reserved skip: a skip at one of these slots' instants is that slot's own
 *   Skip. It is a pass-1 candidate for that slot only.
 * - Pass 1: the shipped ±MATCH_TOLERANCE_MS rule over the slots pass 0 left,
 *   ascending. Best by rank (taken 0, skipped/missed 1), then distance, then
 *   smaller id. A missed row goes to `missedByDoseId` and leaves the slot
 *   unresolved.
 */
export function matchMedicationSlots(
  slots: ProjectedSlot[],
  doses: MatchDose[],
  opts: { now: Date; segments: Segments; pass2Bound: Date },
): MatchedSlot[] {
  const nowMs = opts.now.getTime();
  const ordered = [...slots].sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());
  const slotMs = ordered.map((s) => s.expectedTime.getTime());
  const slotInstants = new Set(slotMs);
  const resolvedBy: (MatchDose | null)[] = ordered.map(() => null);
  const missedBy: (string | null)[] = ordered.map(() => null);

  const remaining = new Map<string, number>();
  for (const d of doses) {
    remaining.set(d.id, d.status === "taken" ? Math.max(1, d.quantity) : 1);
  }
  const hasCapacity = (d: MatchDose) => (remaining.get(d.id) ?? 0) > 0;
  const spend = (d: MatchDose) => remaining.set(d.id, (remaining.get(d.id) ?? 0) - 1);
  const isReservedSkip = (d: MatchDose) =>
    d.status === "skipped" && slotInstants.has(d.takenAt.getTime());

  // Pass 0 — exact claims, taken only.
  for (let i = 0; i < ordered.length; i++) {
    let best: MatchDose | undefined;
    for (const d of doses) {
      if (d.status !== "taken" || !hasCapacity(d)) continue;
      if (d.takenAt.getTime() !== slotMs[i]) continue;
      if (!best || d.id < best.id) best = d;
    }
    if (best) {
      resolvedBy[i] = best;
      spend(best);
    }
  }

  // Pass 1 — the shipped ±1h rule over what pass 0 left, plus reserved skips.
  for (let i = 0; i < ordered.length; i++) {
    if (resolvedBy[i]) continue;
    const t = slotMs[i];
    let best: MatchDose | undefined;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const d of doses) {
      if (!hasCapacity(d)) continue;
      const at = d.takenAt.getTime();
      const dist = Math.abs(at - t);
      if (dist > MATCH_TOLERANCE_MS) continue;
      if (isReservedSkip(d) && at !== t) continue;
      const rank = d.status === "taken" ? 0 : 1;
      const better =
        rank < bestRank ||
        (rank === bestRank && dist < bestDist) ||
        (rank === bestRank && dist === bestDist && (!best || d.id < best.id));
      if (better) {
        best = d;
        bestRank = rank;
        bestDist = dist;
      }
    }
    if (!best) continue;
    spend(best);
    if (best.status === "missed") missedBy[i] = best.id;
    else resolvedBy[i] = best;
  }

  return ordered.map((slot, i) => {
    const by = resolvedBy[i];
    let status: ScheduleSlotStatus;
    if (by) status = by.status === "skipped" ? "skipped" : "taken";
    // The shipped rule, kept until pass 2 lands: a missed row keeps its slot overdue.
    else if (missedBy[i]) status = "overdue";
    else status = slotMs[i] <= nowMs ? "overdue" : "upcoming";
    return { ...slot, status, resolvedByDoseId: by?.id ?? null, missedByDoseId: missedBy[i] };
  });
}

/**
 * Compute expected dose schedule slots.
 *
 * With `opts.window` the projection spans the dashboard's three segments
 * (`segmentsFor`): yesterday, today and tomorrow's first hour. Without it,
 * one segment `[dayStartUtc, dayEndUtc)` and nothing either side
 * (`singleDaySegments`). Either way the steps are the same, per medication:
 * `projectFixedTimes` (the one timezone-aware step), `projectMedicationSlots`
 * (arithmetic, including both clips), then `matchMedicationSlots`.
 *
 * Returns only slots before `end`: tomorrow's first hour is matched, so that
 * today's view makes the choice tomorrow's view will make, but never returned.
 * `isEarlier` flags a slot before `todayStart`; deciding which of those are
 * still visible belongs to the caller.
 */
export function computeScheduleSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  doses: DoseLogWithMedication[],
  lastDoseByMedication: Record<string, Date>,
  dayStartUtc: Date,
  dayEndUtc: Date,
  timezone: string,
  now: Date,
  opts: { window?: DashboardWindow } = {},
): ScheduleSlot[] {
  const segments = opts.window
    ? segmentsFor(opts.window)
    : singleDaySegments(dayStartUtc, dayEndUtc);
  const pass2Bound = opts.window ? opts.window.visibleStart : dayStartUtc;
  const endMs = segments.end.getTime();
  const todayStartMs = segments.todayStart.getTime();

  const dosesByMedId = new Map<string, MatchDose[]>();
  for (const dose of doses) {
    let arr = dosesByMedId.get(dose.medicationId);
    if (!arr) {
      arr = [];
      dosesByMedId.set(dose.medicationId, arr);
    }
    arr.push({
      id: dose.id,
      takenAt: new Date(dose.takenAt),
      status: dose.status,
      quantity: dose.quantity,
    });
  }

  const slots: ScheduleSlot[] = [];
  for (const med of medications) {
    const schedules = schedulesByMedId.get(med.id) ?? [];
    if (schedules.length === 0) continue;

    const projected = projectMedicationSlots({
      med,
      schedules,
      fixedInstants: projectFixedTimes(schedules, segments, timezone),
      lastTakenAt: lastDoseByMedication[med.id] ?? null,
      segments,
    });
    if (projected.length === 0) continue;

    const matched = matchMedicationSlots(projected, dosesByMedId.get(med.id) ?? [], {
      now,
      segments,
      pass2Bound,
    });

    for (const slot of matched) {
      const ms = slot.expectedTime.getTime();
      if (ms >= endMs) continue;
      slots.push({
        medicationId: med.id,
        medicationName: med.name,
        colour: med.colour,
        colourSecondary: med.colourSecondary,
        pattern: med.pattern,
        dosageAmount: med.dosageAmount,
        dosageUnit: med.dosageUnit,
        expectedTime: slot.expectedTime.toISOString(),
        kind: slot.kind,
        status: slot.status,
        matchedDoseId: slot.resolvedByDoseId ?? slot.missedByDoseId ?? null,
        resolvedByDoseId: slot.resolvedByDoseId,
        missedByDoseId: slot.missedByDoseId,
        isEarlier: ms < todayStartMs,
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
