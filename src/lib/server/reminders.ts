import { sql, eq, and, isNotNull, ne, inArray, max } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "$lib/server/db";
import {
  medications,
  doseLogs,
  users,
  userPreferences,
  medicationSchedules,
  reminderEvents,
} from "$lib/server/db/schema";
import { sendReminderEmail, sendLowInventoryEmail } from "./email";
import { sendPushNotification } from "./push";
import { formatTimeSince } from "$lib/utils/time";
import {
  computeOverdueSlot,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
  type ReminderType,
} from "./reminders/domain";

export {
  computeOverdueSlot,
  isScheduleOverdue,
  buildOverdueDedupeKey,
  buildLowInventoryDedupeKey,
} from "./reminders/domain";

async function tryRecordReminderEvent(input: {
  userId: string;
  medicationId: string;
  reminderType: ReminderType;
  dedupeKey: string;
}): Promise<boolean> {
  const inserted = await db
    .insert(reminderEvents)
    .values({
      id: createId(),
      userId: input.userId,
      medicationId: input.medicationId,
      reminderType: input.reminderType,
      dedupeKey: input.dedupeKey,
    })
    .onConflictDoNothing({ target: reminderEvents.dedupeKey })
    .returning({ id: reminderEvents.id });
  return inserted.length === 1;
}

export async function checkOverdueMedications() {
  // P3 will split email/push prefs; for now the existing
  // `emailReminders` toggle gates this entire pipeline. emailVerified
  // is selected so the email send (but not the push send) can be
  // skipped for unverified users — see the per-row branch below.
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
      userEmailVerified: users.emailVerified,
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

  for (const scheduleRow of scheduleRows) {
    const row = {
      ...scheduleRow,
      lastTakenAt: lastTakenByMedication.get(scheduleRow.medicationId) ?? null,
    };
    const slot = computeOverdueSlot(row, now);
    if (!slot) continue;

    const dedupeKey = buildOverdueDedupeKey(
      row.userId,
      row.medicationId,
      row.scheduleKind,
      row.scheduleId,
      slot,
    );
    const recorded = await tryRecordReminderEvent({
      userId: row.userId,
      medicationId: row.medicationId,
      reminderType: "overdue",
      dedupeKey,
    });
    if (!recorded) continue;

    const sinceLabel = row.lastTakenAt ? formatTimeSince(new Date(row.lastTakenAt)) : "never";

    if (row.userEmailVerified) {
      const emailResult = await sendReminderEmail(row.userEmail, row.medicationName, sinceLabel);
      if (!emailResult.ok) {
        console.warn(
          `overdue email skipped for med=${row.medicationId} (${emailResult.reason}): ${emailResult.message}`,
        );
      }
    } else {
      console.warn(`overdue email skipped for med=${row.medicationId}: user email not verified`);
    }

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
      // Push failure should not block the rest of the loop.
    }
  }
}

export async function checkLowInventoryMedications() {
  const lowMeds = await db
    .select({
      medicationId: medications.id,
      medicationName: medications.name,
      userId: medications.userId,
      inventoryCount: medications.inventoryCount,
      inventoryAlertThreshold: medications.inventoryAlertThreshold,
      userEmail: users.email,
      userEmailVerified: users.emailVerified,
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
    const dedupeKey = buildLowInventoryDedupeKey(med.userId, med.medicationId, med.inventoryCount!);
    const recorded = await tryRecordReminderEvent({
      userId: med.userId,
      medicationId: med.medicationId,
      reminderType: "low_inventory",
      dedupeKey,
    });
    if (!recorded) continue;

    if (!med.userEmailVerified) {
      console.warn(
        `low-inventory email skipped for med=${med.medicationId}: user email not verified`,
      );
      continue;
    }

    const emailResult = await sendLowInventoryEmail(
      med.userEmail,
      med.medicationName,
      med.inventoryCount!,
      med.inventoryAlertThreshold!,
    );
    if (!emailResult.ok) {
      console.warn(
        `low-inventory email skipped for med=${med.medicationId} (${emailResult.reason}): ${emailResult.message}`,
      );
    }
  }
}
