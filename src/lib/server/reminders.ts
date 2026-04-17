import { sql, eq, and, isNotNull } from "drizzle-orm";
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  users,
  userPreferences,
} from "$lib/server/db/schema";
import { sendReminderEmail, sendLowInventoryEmail } from "./email";
import { sendPushNotification } from "./push";
import { formatTimeSince } from "$lib/utils/time";

export async function checkOverdueMedications() {
  const medsWithLastDose = await db
    .select({
      medicationId: medications.id,
      medicationName: medications.name,
      scheduleIntervalHours: medications.scheduleIntervalHours,
      userId: medications.userId,
      userEmail: users.email,
      lastTakenAt: sql<Date | null>`(
        SELECT ${doseLogs.takenAt}
        FROM ${doseLogs}
        WHERE ${doseLogs.medicationId} = ${medications.id}
        ORDER BY ${doseLogs.takenAt} DESC
        LIMIT 1
      )`,
    })
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .innerJoin(userPreferences, eq(users.id, userPreferences.userId))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.scheduleIntervalHours),
        eq(userPreferences.emailReminders, true),
      ),
    );

  for (const med of medsWithLastDose) {
    if (!med.lastTakenAt) continue;
    const intervalMs = Number(med.scheduleIntervalHours) * 3600000;
    const elapsed = Date.now() - new Date(med.lastTakenAt).getTime();
    if (elapsed > intervalMs) {
      await sendReminderEmail(
        med.userEmail,
        med.medicationName,
        formatTimeSince(new Date(med.lastTakenAt)),
      );

      try {
        await sendPushNotification(med.userId, {
          title: `${med.medicationName} overdue`,
          body: `Last taken ${formatTimeSince(new Date(med.lastTakenAt))} ago`,
          url: "/dashboard",
          tag: `overdue-${med.medicationId}`,
        });
      } catch {
        // Push failure should not block email sending
      }
    }
  }
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
