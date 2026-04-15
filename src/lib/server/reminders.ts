import { sql, eq, and, isNotNull } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications, doseLogs, users } from "$lib/server/db/schema";
import { sendReminderEmail } from "./email";
import { formatTimeSince } from "$lib/utils/time";

export async function checkOverdueMedications() {
  const medsWithSchedule = await db
    .select({
      medicationId: medications.id,
      medicationName: medications.name,
      scheduleIntervalHours: medications.scheduleIntervalHours,
      userId: medications.userId,
      userEmail: users.email,
    })
    .from(medications)
    .innerJoin(users, eq(medications.userId, users.id))
    .where(
      and(
        eq(medications.isArchived, false),
        isNotNull(medications.scheduleIntervalHours),
      ),
    );

  for (const med of medsWithSchedule) {
    const intervalMs = Number(med.scheduleIntervalHours) * 3600000;
    const [lastDose] = await db
      .select({ takenAt: doseLogs.takenAt })
      .from(doseLogs)
      .where(eq(doseLogs.medicationId, med.medicationId))
      .orderBy(sql`${doseLogs.takenAt} DESC`)
      .limit(1);

    if (!lastDose) continue;
    const elapsed = Date.now() - new Date(lastDose.takenAt).getTime();
    if (elapsed > intervalMs) {
      await sendReminderEmail(
        med.userEmail,
        med.medicationName,
        formatTimeSince(new Date(lastDose.takenAt)),
      );
    }
  }
}
