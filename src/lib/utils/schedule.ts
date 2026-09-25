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
 * The segment limit: a dose is a pass-1 candidate for a slot only if it was
 * taken before the end of that slot's segment. Yesterday's segment ends at
 * today's midnight and today's at `end`; tomorrow's first hour has no limit.
 */
function segmentEndMs(segment: ProjectedSlot["segment"], segments: Segments): number {
  if (segment === "yesterday") return segments.todayStart.getTime();
  if (segment === "today") return segments.end.getTime();
  return Number.POSITIVE_INFINITY;
}

/**
 * Match one medication's projected slots to its doses: passes 0–2.
 *
 * Every pass spends from ONE capacity map. A taken dose covers
 * `max(1, quantity)` slots; a skipped or missed row covers exactly one. So
 * a ×3 dose can resolve one slot in each pass, and never a fourth.
 *
 * - Pass 0 (taken only): a dose recorded at exactly a slot's instant claims
 *   that slot, with the smaller id winning a tie. This is what makes "Took
 *   it at 09:00" resolve 09:00 when 08:55 is also open.
 * - Reserved skip: a skip at one of these slots' instants is that slot's own
 *   Skip. It is a pass-1 candidate for that slot only and never part of
 *   pass 2, so a real taken dose within the hour still beats it.
 * - Pass 1: the shipped ±MATCH_TOLERANCE_MS rule over the slots pass 0 left,
 *   ascending. Best by rank (taken 0, skipped/missed 1), then distance, then
 *   smaller id. The dose must also have been taken before the slot's
 *   segment ends (see `segmentEndMs`). A missed row goes to
 *   `missedByDoseId` and leaves the slot unresolved.
 * - Pass 2: leftover capacity of taken and skipped doses (never missed rows,
 *   never reserved skips) with `takenAt <= now`, replayed in (takenAt, id)
 *   order so history is never re-attributed. Each dose walks backwards from
 *   the last slot strictly before it, skips resolved slots and stops below
 *   `pass2Bound`. A dose never resolves a slot after it.
 *
 * Status: a resolved slot takes the resolving dose's status. Anything else
 * is overdue once `expectedTime <= now` and upcoming before that, including
 * a slot holding only a missed row.
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

  // Pass 1 — the shipped ±1h rule over what pass 0 left, plus the segment
  // limit and reserved skips.
  for (let i = 0; i < ordered.length; i++) {
    if (resolvedBy[i]) continue;
    const t = slotMs[i];
    const segmentEnd = segmentEndMs(ordered[i].segment, opts.segments);
    let best: MatchDose | undefined;
    let bestRank = Infinity;
    let bestDist = Infinity;
    for (const d of doses) {
      if (!hasCapacity(d)) continue;
      const at = d.takenAt.getTime();
      const dist = Math.abs(at - t);
      if (dist > MATCH_TOLERANCE_MS) continue;
      if (at >= segmentEnd) continue;
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

  // Pass 2 — late resolution.
  const bound = opts.pass2Bound.getTime();
  const late = doses
    .filter(
      (d) =>
        d.status !== "missed" &&
        !isReservedSkip(d) &&
        hasCapacity(d) &&
        d.takenAt.getTime() <= nowMs,
    )
    .sort(
      (a, b) =>
        a.takenAt.getTime() - b.takenAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  for (const d of late) {
    const at = d.takenAt.getTime();
    for (let i = ordered.length - 1; i >= 0 && hasCapacity(d); i--) {
      if (slotMs[i] >= at) continue; // never forward: only slots strictly before the dose
      if (slotMs[i] < bound) break;
      if (resolvedBy[i]) continue; // a slot holding only a missed row is still eligible
      resolvedBy[i] = d;
      spend(d);
    }
  }

  return ordered.map((slot, i) => {
    const by = resolvedBy[i];
    const status: ScheduleSlotStatus = by
      ? by.status === "skipped"
        ? "skipped"
        : "taken"
      : slotMs[i] <= nowMs
        ? "overdue"
        : "upcoming";
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
  // Pass 2 reaches back no further than what the dashboard can show:
  // visibleStart with a window, or the start of the one-segment day
  // without one.
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

// ── Dashboard buttons ─────────────────────────────────────────────────────

/**
 * How long after a taken dose Log now stays off that medication (D8). A
 * second tap inside the hour is far likelier a double log than a second
 * dose. Took it at and Skip stay, because each names its own instant.
 */
export const LOG_NOW_COOLDOWN_MS = 60 * 60 * 1000;

export interface SlotActionInput {
  med: Medication;
  schedules: MedicationSchedule[];
  /**
   * `projectFixedTimes(schedules, segmentsFor(window), tz)` for this
   * medication — computed once per request and reused by every simulation,
   * which is what keeps the simulations free of `Intl`.
   */
  fixedInstants: Date[];
  /** This medication's doses in `[window.doseFetchFrom, window.doseFetchTo)`. */
  doses: MatchDose[];
  /** All-time latest TAKEN `takenAt` (`getLastDosePerMedication`); skips never anchor. */
  lastTakenAt: Date | null;
  window: DashboardWindow;
}

/** One visible, unresolved row's secondary buttons. ISO instants, posted verbatim. */
export interface RowActions {
  /** "Took it at HH:MM": always the row's own instant, or null. */
  tookItAt: string | null;
  /** Skip at `min(expectedTime, now)`, so never future-dated, or null. */
  skipAt: string | null;
}

export interface SlotActions {
  /** ISO `expectedTime` of the one row that carries Log now, or null. */
  logNowTarget: string | null;
  /** Every visible, unresolved row, keyed by ISO `expectedTime`. */
  rows: Map<string, RowActions>;
}

/**
 * A probe's id. U+FFFF sorts after every stored id, so a simulated dose
 * never wins a tie a real row would have won — pass 0's smaller-id rule,
 * pass 1's id tie-break, pass 2's `(takenAt, id)` order.
 */
const PROBE_ID = "￿";

interface SlotIndex {
  all: Map<number, MatchedSlot>;
  visible: Map<number, MatchedSlot>;
}

/**
 * The dashboard's visibility rule: before `end`, and either on today's
 * civil day or an overdue Earlier row under 12 hours old.
 *
 * Exported (CONTROLLER RULING R3) so Task 7's composition imports this
 * implementation rather than keeping a private copy; `tests/unit/slot-actions.test.ts`
 * restates the rule independently rather than importing it, so the property
 * test remains an oracle over this function's behaviour, not a tautology.
 */
export function isVisibleSlot(slot: MatchedSlot, window: DashboardWindow): boolean {
  const t = slot.expectedTime.getTime();
  if (t >= window.end.getTime()) return false;
  if (t >= window.todayStart.getTime()) return true;
  return slot.status === "overdue" && t >= window.visibleStart.getTime();
}

function indexSlots(slots: MatchedSlot[], window: DashboardWindow): SlotIndex {
  const all = new Map<number, MatchedSlot>();
  const visible = new Map<number, MatchedSlot>();
  for (const slot of slots) {
    const t = slot.expectedTime.getTime();
    all.set(t, slot);
    if (isVisibleSlot(slot, window)) visible.set(t, slot);
  }
  return { all, visible };
}

/**
 * Does `sim` show every visible row of `base` — bar the one at `ownMs` — at
 * the same instant with the same status?
 *
 * The only licensed difference is an interval row the re-anchor stopped
 * projecting (in `base`, absent from `sim`) or newly projects (in `sim`,
 * absent from `base`): a taken probe moves `lastTakenAt`, and the next load
 * supersedes those rows the same way. Anything else — an overdue row
 * turning taken because a freed dose slid onto it, an Earlier row leaving
 * the list — means the tap would change a row it is not on.
 */
function othersUnchanged(base: SlotIndex, sim: SlotIndex, ownMs: number): boolean {
  for (const [t, before] of base.visible) {
    if (t === ownMs) continue;
    const after = sim.visible.get(t);
    if (after) {
      if (after.status !== before.status) return false;
    } else if (before.kind !== "interval" || sim.all.has(t)) {
      return false;
    }
  }
  for (const [t, after] of sim.visible) {
    if (t === ownMs || base.visible.has(t)) continue;
    if (after.kind !== "interval" || base.all.has(t)) return false;
  }
  return true;
}

/**
 * Which buttons each visible, unresolved row of ONE medication offers,
 * decided by SIMULATING the write each button makes and re-running the
 * matcher — never by a rule about which row "should" take a dose.
 *
 * - Log now probes a taken ×1 dose at `now`. Its target is the latest
 *   visible, unresolved row at most `MATCH_TOLERANCE_MS` ahead that the dose
 *   would resolve (or, for an interval row, supersede by re-anchoring) while
 *   every other visible row stays as it is. None while a taken dose sits in
 *   `(now − LOG_NOW_COOLDOWN_MS, now]`.
 * - Took it at probes a taken dose at exactly the row's instant (past rows
 *   only) and is offered when that resolves this row and moves no other.
 * - Skip probes a skip at `min(expectedTime, now)` and is offered when that
 *   moves this row, and no other, to skipped.
 *
 * Every taken probe re-projects the interval rows with
 * `lastTakenAt' = max(lastTakenAt, probe.takenAt)`, which is what the next
 * load will see. No simulation calls `isoDayKey` or `wallClockToInstant`:
 * fixed-time instants arrive precomputed in `fixedInstants`.
 *
 * Log now's "no other row moves" condition is deliberately stricter than
 * the spec's wording. On a medication mixing interval and fixed rows, the
 * re-anchor can free an old dose that pass 2 then hands to another row, or
 * supersede a later interval row while the dose itself lands on a fixed
 * one; without the guard Log now would sit on a row whose tap changes a
 * different row. tests/unit/slot-actions.test.ts pins the placement cases
 * and the slot-anchored property this guarantees.
 */
export function slotActions(input: SlotActionInput): SlotActions {
  const { med, schedules, fixedInstants, doses, lastTakenAt, window } = input;
  const now = window.now;
  const nowMs = now.getTime();
  const segments = segmentsFor(window);
  const matchOpts = { now, segments, pass2Bound: window.visibleStart };

  const project = (anchor: Date | null): ProjectedSlot[] =>
    projectMedicationSlots({ med, schedules, fixedInstants, lastTakenAt: anchor, segments });

  const baseProjection = project(lastTakenAt);
  const base = matchMedicationSlots(baseProjection, doses, matchOpts);
  const baseIndex = indexSlots(base, window);

  const simulate = (takenAt: Date, status: "taken" | "skipped"): SlotIndex => {
    const probe: MatchDose = { id: PROBE_ID, takenAt, status, quantity: 1 };
    // Only a taken dose moves the interval anchor, and only forwards.
    const reanchors =
      status === "taken" && (lastTakenAt === null || takenAt.getTime() > lastTakenAt.getTime());
    const projection = reanchors ? project(takenAt) : baseProjection;
    return indexSlots(matchMedicationSlots(projection, [...doses, probe], matchOpts), window);
  };

  const open = base
    .filter((slot) => slot.resolvedByDoseId === null && isVisibleSlot(slot, window))
    .sort((a, b) => a.expectedTime.getTime() - b.expectedTime.getTime());

  const rows = new Map<string, RowActions>();
  // Every row still ahead probes the same skip-at-now, so simulate it once.
  const skipSims = new Map<number, SlotIndex>();
  for (const slot of open) {
    const t = slot.expectedTime.getTime();

    let tookItAt: string | null = null;
    if (t <= nowMs) {
      const sim = simulate(slot.expectedTime, "taken");
      if (sim.all.get(t)?.status === "taken" && othersUnchanged(baseIndex, sim, t)) {
        tookItAt = slot.expectedTime.toISOString();
      }
    }

    const skipMs = Math.min(t, nowMs);
    let skipSim = skipSims.get(skipMs);
    if (!skipSim) {
      skipSim = simulate(new Date(skipMs), "skipped");
      skipSims.set(skipMs, skipSim);
    }
    const skipAt =
      skipSim.all.get(t)?.status === "skipped" && othersUnchanged(baseIndex, skipSim, t)
        ? new Date(skipMs).toISOString()
        : null;

    rows.set(slot.expectedTime.toISOString(), { tookItAt, skipAt });
  }

  let logNowTarget: string | null = null;
  const cooling = doses.some(
    (d) =>
      d.status === "taken" &&
      d.takenAt.getTime() > nowMs - LOG_NOW_COOLDOWN_MS &&
      d.takenAt.getTime() <= nowMs,
  );
  if (!cooling && open.length > 0) {
    const sim = simulate(now, "taken");
    const reach = nowMs + MATCH_TOLERANCE_MS;
    // Latest first: the target is the latest row a dose logged now would resolve.
    for (let k = open.length - 1; k >= 0; k--) {
      const slot = open[k];
      const t = slot.expectedTime.getTime();
      if (t > reach) continue;
      // Resolved by a taken dose, or (interval rows only) superseded by the re-anchor.
      const after = sim.all.get(t);
      const landed = after ? after.status === "taken" : slot.kind === "interval";
      if (!landed || !othersUnchanged(baseIndex, sim, t)) continue;
      logNowTarget = slot.expectedTime.toISOString();
      break;
    }
  }

  return { logNowTarget, rows };
}
