import { localTimeOnDateToUtc, getLocalDateString, getLocalDayOfWeek } from "$lib/utils/schedule";

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
  lastTakenAt: Date | null;
};

export type ReminderType = "overdue" | "low_inventory";

export function computeOverdueSlot(row: OverdueRow, now: Date): Date | null {
  if (row.scheduleKind === "interval") {
    if (!row.intervalHours || !row.lastTakenAt) return null;
    const intervalMs = Number(row.intervalHours) * 3600000;
    const lastMs = new Date(row.lastTakenAt).getTime();
    if (now.getTime() - lastMs <= intervalMs) return null;
    return new Date(lastMs + intervalMs);
  }

  if (row.scheduleKind === "fixed_time") {
    if (!row.timeOfDay) return null;
    const tz = row.userTimezone || "UTC";
    const todayStr = getLocalDateString(now, tz);
    const lastMs = row.lastTakenAt ? new Date(row.lastTakenAt).getTime() : null;

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

export function buildOverdueDedupeKey(
  userId: string,
  medicationId: string,
  scheduleKind: string,
  scheduleId: string,
  nextDueAt: Date,
): string {
  return `${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt.toISOString()}`;
}

export function buildLowInventoryDedupeKey(
  userId: string,
  medicationId: string,
  inventoryCount: number,
): string {
  return `${userId}:${medicationId}:low_inventory:${inventoryCount}`;
}
