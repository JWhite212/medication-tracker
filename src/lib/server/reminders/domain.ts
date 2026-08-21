import { localTimeOnDateToUtc, getLocalDateString, getLocalDayOfWeek } from "$lib/utils/schedule";
import { parseIntervalHours } from "$lib/utils/schedule-rate";

export const FIXED_TIME_TOLERANCE_MS = 60 * 60 * 1000;

/**
 * How many local days back from `now` the fixed-time scan looks for the
 * most recent elapsed slot.
 *
 * One day is the minimum that makes the scan correct at any cron cadence
 * up to daily: if today's occurrence has not arrived yet, yesterday's
 * has, and that is the dose the user actually missed. Reaching further
 * back would surface doses too stale to act on — by then the point is
 * adherence history, not a reminder.
 */
export const OVERDUE_LOOKBACK_DAYS = 1;

/**
 * Shift a local calendar date string (YYYY-MM-DD) by whole days.
 *
 * Done as pure UTC calendar arithmetic rather than by subtracting 24h
 * from an instant: `Date.UTC` rolls months and years over correctly and
 * has no DST, so "the previous local date" is exact even across a
 * transition, where a 24-hour subtraction can land on the wrong day.
 */
function shiftLocalDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

export type OverdueRow = {
  scheduleKind: string;
  intervalHours: string | null;
  timeOfDay: string | null;
  daysOfWeek: number[] | null;
  userTimezone: string;
  lastEventAt: Date | null;
};

export type ReminderType = "overdue" | "low_inventory";

export function computeOverdueSlot(row: OverdueRow, now: Date): Date | null {
  if (row.scheduleKind === "interval") {
    const hours = parseIntervalHours(row.intervalHours);
    if (hours === null || !row.lastEventAt) return null;
    const intervalMs = hours * 3600000;
    const lastMs = new Date(row.lastEventAt).getTime();
    if (now.getTime() - lastMs <= intervalMs) return null;
    return new Date(lastMs + intervalMs);
  }

  if (row.scheduleKind === "fixed_time") {
    if (!row.timeOfDay) return null;
    const tz = row.userTimezone || "UTC";
    const todayStr = getLocalDateString(now, tz);
    const lastMs = row.lastEventAt ? new Date(row.lastEventAt).getTime() : null;

    // Walk back day by day and return the most recent slot that has
    // already elapsed.
    //
    // Evaluating only TODAY's slot (the original behaviour) made every
    // schedule timed after the cron tick permanently invisible: the slot
    // was still in the future at each tick, and by the next tick the
    // local date had rolled over, so the elapsed occurrence was never
    // revisited. It was not a delayed reminder — it was no reminder,
    // ever. See the regression tests in tests/unit/reminders-dedupe.
    for (let daysBack = 0; daysBack <= OVERDUE_LOOKBACK_DAYS; daysBack++) {
      const dateStr = daysBack === 0 ? todayStr : shiftLocalDate(todayStr, daysBack);
      const slotUtc = localTimeOnDateToUtc(dateStr, row.timeOfDay, tz);

      // Not yet due — try the previous day's occurrence.
      if (slotUtc.getTime() > now.getTime()) continue;

      // Day-of-week is a property of the slot's own date, not of today.
      if (row.daysOfWeek && row.daysOfWeek.length > 0) {
        if (!row.daysOfWeek.includes(getLocalDayOfWeek(slotUtc, tz))) continue;
      }

      // A dose at or after the slot satisfies it however late it was —
      // reporting a taken-but-late dose as overdue is a false alarm, and
      // the look-back makes that case reachable where it previously was
      // not. The tolerance therefore only extends backwards, covering a
      // dose taken shortly before the scheduled time.
      if (lastMs !== null && lastMs >= slotUtc.getTime() - FIXED_TIME_TOLERANCE_MS) return null;

      return slotUtc;
    }

    return null;
  }

  return null;
}

export function isScheduleOverdue(row: OverdueRow, now: Date): boolean {
  return computeOverdueSlot(row, now) !== null;
}

/**
 * A medication's re-notification policy.
 *
 * `repeatEveryMinutes === null` means one reminder per slot, which is
 * what every medication did before this existed.
 */
export type NagPolicy = {
  offsetMinutes: number;
  repeatEveryMinutes: number | null;
  maxRepeats: number;
};

export const NO_REPEAT: NagPolicy = {
  offsetMinutes: 0,
  repeatEveryMinutes: null,
  maxRepeats: 0,
};

/**
 * Which reminder in a slot's series is due now, or null if none is yet.
 *
 * This is the machine #110 broke, built deliberately. There, the SLOT
 * advanced every interval, so the dedupe key churned without bound and
 * claimReminderSlot could never suppress a repeat: "one reminder per
 * interval, forever". Three properties prevent that here.
 *
 *   1. The slot is fixed. computeOverdueSlot is untouched; only this
 *      ordinal moves.
 *   2. The ordinal is BOUNDED by maxRepeats, so one slot owns at most
 *      maxRepeats + 1 keys.
 *   3. It is derived from elapsed time, not counted in a table — O(1),
 *      no loop, and a missed tick skips windows instead of firing a
 *      burst.
 *
 * It CLAMPS rather than cutting off. Returning null past the cap would
 * lose reminders that fire today: a 22:00 slot sits through the
 * overnight scheduler blackout, and by the 06:00 tick the raw index is
 * far past the cap. Saturating means the final reminder is claimed once,
 * sent once, and suppressed thereafter.
 */
export function computeNagIndex(slot: Date, policy: NagPolicy, now: Date): number | null {
  const firstNagAt = slot.getTime() + policy.offsetMinutes * 60_000;
  if (now.getTime() < firstNagAt) return null;

  // A non-positive or non-finite interval must degrade to a single
  // reminder. The schema floors it at 1, so arriving here means bad or
  // legacy data, and an unbounded key space is the one outcome that is
  // not survivable.
  const every = policy.repeatEveryMinutes;
  if (every === null || !Number.isFinite(every) || every < 1) return 0;

  const elapsed = now.getTime() - firstNagAt;
  const raw = Math.floor(elapsed / (every * 60_000));
  const cap = Number.isFinite(policy.maxRepeats) ? Math.max(0, policy.maxRepeats) : 0;
  return Math.min(raw, cap);
}

export function buildOverdueDedupeKey(
  userId: string,
  medicationId: string,
  scheduleKind: string,
  scheduleId: string,
  nextDueAt: Date,
  nagIndex = 0,
): string {
  const base = `${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt.toISOString()}`;
  // Index 0 produces the pre-feature key byte-for-byte, so every
  // medication that does not repeat keeps its existing key and every
  // in-flight reminder_events row stays addressable across the deploy.
  return nagIndex > 0 ? `${base}:n${nagIndex}` : base;
}

export function buildLowInventoryDedupeKey(
  userId: string,
  medicationId: string,
  inventoryCount: number,
): string {
  return `${userId}:${medicationId}:low_inventory:${inventoryCount}`;
}
