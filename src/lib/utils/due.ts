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

import {
  getLocalDateString,
  getLocalDatesInRange,
  getLocalDayOfWeek,
  localTimeOnDateToUtc,
} from "$lib/utils/schedule";
import { classifyDueStatus } from "$lib/utils/time";

export type Lifecycle = { startedAt: Date; endedAt: Date | null };

function withinLifecycle(t: Date, lifecycle: Lifecycle): boolean {
  if (t.getTime() < lifecycle.startedAt.getTime()) return false;
  if (lifecycle.endedAt && t.getTime() > lifecycle.endedAt.getTime()) return false;
  return true;
}

/**
 * The times this schedule expects a dose inside [windowStart, windowEnd).
 *
 * `anchor` is the last resolving event (taken or skipped). Interval
 * schedules phase from it; when absent they phase from `startedAt`, so a
 * never-logged medication still has occurrences. Fixed-time schedules
 * ignore the anchor entirely — they are clock-based.
 */
export function occurrencesFor(
  schedule: EffectiveSchedule,
  windowStartUtc: Date,
  windowEndUtc: Date,
  timezone: string,
  anchor: Date | null,
  lifecycle: Lifecycle,
): Date[] {
  const out: Date[] = [];

  if (schedule.scheduleKind === "interval") {
    const hrs = schedule.intervalHours !== null ? Number(schedule.intervalHours) : NaN;
    if (!Number.isFinite(hrs) || hrs <= 0) return [];
    const intervalMs = hrs * 60 * 60 * 1000;

    // With an event, phase from it. Without one, the first expected dose is
    // one interval AFTER startedAt — startedAt is when the medication began,
    // not a dose occurrence.
    let t = anchor
      ? new Date(anchor.getTime())
      : new Date(lifecycle.startedAt.getTime() + intervalMs);
    if (t.getTime() < windowStartUtc.getTime()) {
      const gap = windowStartUtc.getTime() - t.getTime();
      t = new Date(t.getTime() + Math.ceil(gap / intervalMs) * intervalMs);
    }
    while (t.getTime() < windowEndUtc.getTime()) {
      out.push(new Date(t.getTime()));
      t = new Date(t.getTime() + intervalMs);
    }
  } else if (schedule.scheduleKind === "fixed_time") {
    if (!schedule.timeOfDay) return [];
    for (const dateStr of getLocalDatesInRange(windowStartUtc, windowEndUtc, timezone)) {
      const utc = localTimeOnDateToUtc(dateStr, schedule.timeOfDay, timezone);
      if (utc.getTime() < windowStartUtc.getTime() || utc.getTime() >= windowEndUtc.getTime()) {
        continue;
      }
      // Day-of-week is a property of the occurrence's own date, not today's.
      if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
        if (!schedule.daysOfWeek.includes(getLocalDayOfWeek(utc, timezone))) continue;
      }
      out.push(utc);
    }
  }
  // prn projects nothing.

  return out.filter((t) => withinLifecycle(t, lifecycle)).sort((a, b) => a.getTime() - b.getTime());
}

/**
 * The dose fields this module reads. Declared structurally rather than as
 * `DoseLogWithMedication` so the module stays independent of the Drizzle
 * row type — every real dose row satisfies it, so callers pass their rows
 * straight through with no mapping and no cast.
 */
export type DoseEvent = {
  id: string;
  medicationId: string;
  takenAt: Date;
  status: string;
  quantity: number;
};

/**
 * What a caller can tell the module about doses.
 *
 * `events` is full fidelity — every dose row for the window, which is what
 * makes per-occurrence matching possible. `anchor` is a single aggregated
 * "last resolving event", which is all the reminder cron can afford while
 * scanning every user. `anchor` is therefore a conservative approximation
 * of `events`, never a contradiction of it.
 */
export type Evidence =
  | { kind: "events"; doses: DoseEvent[] }
  | { kind: "anchor"; lastEventAt: Date | null };

/** A dose resolves an occurrence when it was taken or deliberately skipped. */
export function resolvesSlot(status: string): boolean {
  return status === "taken" || status === "skipped";
}

function anchorOf(evidence: Evidence): Date | null {
  if (evidence.kind === "anchor") return evidence.lastEventAt;
  let latest: Date | null = null;
  for (const d of evidence.doses) {
    if (!resolvesSlot(d.status)) continue;
    if (!latest || d.takenAt.getTime() > latest.getTime()) latest = d.takenAt;
  }
  return latest;
}

function shiftLocalDate(dateStr: string, days: number): string {
  // Pure UTC calendar arithmetic: Date.UTC rolls months and years over
  // correctly and has no DST, so "the previous local date" stays exact
  // across a transition where subtracting 24h would land on the wrong day.
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

/**
 * The most recent elapsed occurrence that no dose has resolved, or null.
 *
 * Walks back `OVERDUE_LOOKBACK_DAYS` local days so an occurrence timed
 * between two cron ticks is not lost when the local date rolls over.
 */
export function isOutstanding(
  schedule: EffectiveSchedule,
  evidence: Evidence,
  timezone: string,
  now: Date,
  lifecycle: Lifecycle,
): Date | null {
  if (schedule.scheduleKind === "prn") return null;

  const tz = timezone || "UTC";
  const anchor = anchorOf(evidence);
  const todayStr = getLocalDateString(now, tz);

  const windowStart = localTimeOnDateToUtc(
    shiftLocalDate(todayStr, OVERDUE_LOOKBACK_DAYS),
    "00:00",
    tz,
  );
  const windowEnd = new Date(now.getTime() + 1);

  const occurrences = occurrencesFor(schedule, windowStart, windowEnd, tz, anchor, lifecycle);

  for (let i = occurrences.length - 1; i >= 0; i--) {
    const slot = occurrences[i];
    if (slot.getTime() > now.getTime()) continue;
    // A dose at or after the occurrence resolves it however late it was;
    // the tolerance only extends backwards, covering a dose taken shortly
    // before the scheduled time.
    if (anchor !== null && anchor.getTime() >= slot.getTime() - SLOT_TOLERANCE_MS) return null;
    return slot;
  }

  return null;
}

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

/**
 * Compute expected dose schedule slots for the window.
 *
 * Walks every schedule row for each medication. Interval rows project
 * forward from the last dose (or window start) by intervalHours.
 * Fixed-time rows produce one slot per local-time-of-day per local
 * day in the window, optionally filtered by daysOfWeek. PRN rows
 * produce no slots.
 *
 * `evidence` supplies both the per-medication interval anchor and the
 * doses matched against each expected slot. The anchor is the latest
 * `taken` row per medication — the same rule the caller used to apply
 * when it built the old, separately-sourced last-dose map.
 */
export function outstandingSlots(
  medications: Medication[],
  schedulesByMedId: Map<string, MedicationSchedule[]>,
  evidence: Evidence,
  window: { startUtc: Date; endUtc: Date },
  timezone: string,
  now: Date,
): ScheduleSlot[] {
  const doses = evidence.kind === "events" ? evidence.doses : [];
  const dayStartUtc = window.startUtc;
  const dayEndUtc = window.endUtc;

  // Anchor on the last RESOLVING event — taken or skipped. A skip advances
  // the interval clock exactly as the QuickLogBar badge already did, so the
  // timeline and the badge finally answer the question the same way.
  const anchorByMed = new Map<string, Date>();
  for (const d of doses) {
    if (!resolvesSlot(d.status)) continue;
    const existing = anchorByMed.get(d.medicationId);
    if (!existing || d.takenAt.getTime() > existing.getTime()) {
      anchorByMed.set(d.medicationId, d.takenAt);
    }
  }

  const slots: ScheduleSlot[] = [];

  const dosesByMedId = new Map<string, DoseEvent[]>();
  for (const dose of doses) {
    let arr = dosesByMedId.get(dose.medicationId);
    if (!arr) {
      arr = [];
      dosesByMedId.set(dose.medicationId, arr);
    }
    arr.push(dose);
  }

  for (const med of medications) {
    // effectiveSchedules absorbs the deprecated-column fallback, so a
    // medication with no schedule rows still projects instead of vanishing.
    const medSchedules = effectiveSchedules(med, schedulesByMedId.get(med.id) ?? []);
    if (medSchedules.length === 0) continue;

    const anchor = anchorByMed.get(med.id) ?? null;
    const lifecycle: Lifecycle = { startedAt: med.startedAt, endedAt: med.endedAt };

    const expectedTimes: { time: Date; kind: ScheduleKind }[] = [];

    for (const schedule of medSchedules) {
      if (schedule.scheduleKind === "prn") continue;
      for (const t of occurrencesFor(
        schedule,
        dayStartUtc,
        dayEndUtc,
        timezone,
        anchor,
        lifecycle,
      )) {
        expectedTimes.push({ time: t, kind: schedule.scheduleKind });
      }
    }

    if (expectedTimes.length === 0) continue;

    // Dedupe — two schedule rows might emit the same expected time.
    // On an exact collision keep the fixed_time entry so the declared
    // schedule, not the derived interval projection, is canonical.
    const byTime = new Map<number, { time: Date; kind: ScheduleKind }>();
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
          !fixedMs.some((f) => Math.abs(f - e.time.getTime()) <= SLOT_TOLERANCE_MS),
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
      let matchedDose: DoseEvent | undefined;
      let bestRank = Infinity;
      let bestDist = Infinity;
      for (const d of medDoses) {
        if ((remaining.get(d.id) ?? 0) <= 0) continue;
        const dist = Math.abs(new Date(d.takenAt).getTime() - expectedMs);
        if (dist > SLOT_TOLERANCE_MS) continue;
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
