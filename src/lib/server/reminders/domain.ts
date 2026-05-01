import { localTimeOnDateToUtc, getLocalDateString, getLocalDayOfWeek } from "$lib/utils/schedule";

export const FIXED_TIME_TOLERANCE_MS = 60 * 60 * 1000;

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
    const slotUtc = localTimeOnDateToUtc(todayStr, row.timeOfDay, tz);

    if (slotUtc.getTime() > now.getTime()) return null;

    if (row.daysOfWeek && row.daysOfWeek.length > 0) {
      const dow = getLocalDayOfWeek(slotUtc, tz);
      if (!row.daysOfWeek.includes(dow)) return null;
    }

    if (row.lastTakenAt) {
      const last = new Date(row.lastTakenAt).getTime();
      if (Math.abs(last - slotUtc.getTime()) <= FIXED_TIME_TOLERANCE_MS) return null;
    }

    return slotUtc;
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
