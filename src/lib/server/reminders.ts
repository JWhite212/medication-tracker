import { sql, eq, and, isNotNull, ne, inArray, max } from "drizzle-orm";
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  users,
  userPreferences,
  medicationSchedules,
} from "$lib/server/db/schema";
import { sendReminderEmail, sendLowInventoryEmail } from "./email";
import { sendPushNotification } from "./push";
import { formatTimeSince } from "$lib/utils/time";
import { localTimeOnDateToUtc, getLocalDateString, getLocalDayOfWeek } from "$lib/utils/schedule";

const FIXED_TIME_TOLERANCE_MS = 60 * 60 * 1000;

export async function checkOverdueMedications() {
  const scheduleRows = await db
    .select({
      scheduleId: medicationSchedules.id,
      scheduleKind: medicationSchedules.scheduleKind,
      intervalHours: medicationSchedules.intervalHours,
      timeOfDay: medicationSchedules.timeOfDay,
      daysOfWeek: medicationSchedules.daysOfWeek,
      medicationId: medications.id,
      medicationName: medications.name,
      userId: medications.userId,
      userEmail: users.email,
      userTimezone: users.timezone,
    })
    .from(medicationSchedules)
    .innerJoin(medications, eq(medicationSchedules.medicationId, medications.id))
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        ne(medicationSchedules.scheduleKind, "prn"),
        eq(userPreferences.emailReminders, true),
      ),
    );

  // Fetch the most recent taken dose per medication in one grouped query
  // instead of running a correlated subquery per schedule row.
  const medicationIds = Array.from(new Set(scheduleRows.map((r) => r.medicationId)));
  const lastTakenByMedication = new Map<string, Date>();
  if (medicationIds.length > 0) {
    const lastTakenRows = await db
      .select({
        medicationId: doseLogs.medicationId,
        lastTakenAt: max(doseLogs.takenAt),
      })
      .from(doseLogs)
      .where(and(inArray(doseLogs.medicationId, medicationIds), eq(doseLogs.status, "taken")))
      .groupBy(doseLogs.medicationId);

    for (const r of lastTakenRows) {
      if (r.lastTakenAt !== null) {
        lastTakenByMedication.set(r.medicationId, new Date(r.lastTakenAt));
      }
    }
  }

  const now = new Date();
  // A single overdue medication should produce one email per cron run
  // even when multiple schedules say so.
  const notified = new Set<string>();

  for (const scheduleRow of scheduleRows) {
    const row = {
      ...scheduleRow,
      lastTakenAt: lastTakenByMedication.get(scheduleRow.medicationId) ?? null,
    };
    if (!isScheduleOverdue(row, now)) continue;
    if (notified.has(row.medicationId)) continue;
    notified.add(row.medicationId);

    const sinceLabel = row.lastTakenAt ? formatTimeSince(new Date(row.lastTakenAt)) : "never";

    await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);

    try {
      await sendPushNotification(row.userId, {
        title: `${row.medicationName} overdue`,
        body: row.lastTakenAt
          ? `Last taken ${formatTimeSince(new Date(row.lastTakenAt))} ago`
          : "Not yet taken",
        url: "/dashboard",
        tag: `overdue-${row.medicationId}`,
      });
    } catch {
      // Push failure should not block email sending
    }
  }
}

type OverdueRow = {
  scheduleKind: string;
  intervalHours: string | null;
  timeOfDay: string | null;
  daysOfWeek: number[] | null;
  userTimezone: string;
  lastTakenAt: Date | null;
};

function isScheduleOverdue(row: OverdueRow, now: Date): boolean {
  if (row.scheduleKind === "interval") {
    if (!row.intervalHours || !row.lastTakenAt) return false;
    const intervalMs = Number(row.intervalHours) * 3600000;
    const elapsed = now.getTime() - new Date(row.lastTakenAt).getTime();
    return elapsed > intervalMs;
  }

  if (row.scheduleKind === "fixed_time") {
    if (!row.timeOfDay) return false;
    const tz = row.userTimezone || "UTC";
    const todayStr = getLocalDateString(now, tz);
    const slotUtc = localTimeOnDateToUtc(todayStr, row.timeOfDay, tz);

    // Slot still in the future — not overdue.
    if (slotUtc.getTime() > now.getTime()) return false;

    if (row.daysOfWeek && row.daysOfWeek.length > 0) {
      const dow = getLocalDayOfWeek(slotUtc, tz);
      if (!row.daysOfWeek.includes(dow)) return false;
    }

    if (row.lastTakenAt) {
      const last = new Date(row.lastTakenAt).getTime();
      if (Math.abs(last - slotUtc.getTime()) <= FIXED_TIME_TOLERANCE_MS) return false;
    }
    return true;
  }

  return false;
}

export async function checkLowInventoryMedications() {
  const lowMeds = await db
    .select({
      medicationName: medications.name,
      inventoryCount: medications.inventoryCount,
      inventoryAlertThreshold: medications.inventoryAlertThreshold,
      userEmail: users.email,
    })
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.inventoryCount),
        isNotNull(medications.inventoryAlertThreshold),
        eq(userPreferences.lowInventoryAlerts, true),
        sql`${medications.inventoryCount} <= ${medications.inventoryAlertThreshold}`,
      ),
    );

  for (const med of lowMeds) {
    await sendLowInventoryEmail(
      med.userEmail,
      med.medicationName,
      med.inventoryCount!,
      med.inventoryAlertThreshold!,
    );
  }
}
