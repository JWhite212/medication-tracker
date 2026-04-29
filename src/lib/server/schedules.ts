import { createId } from "@paralleldrive/cuid2";
import { eq, and, asc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medicationSchedules } from "$lib/server/db/schema";
import type { ScheduleInput } from "$lib/utils/validation";
import type { InferSelectModel } from "drizzle-orm";

export type MedicationSchedule = InferSelectModel<typeof medicationSchedules>;

export async function getSchedulesForUser(
  userId: string,
): Promise<Map<string, MedicationSchedule[]>> {
  const rows = await db
    .select()
    .from(medicationSchedules)
    .where(eq(medicationSchedules.userId, userId))
    .orderBy(asc(medicationSchedules.medicationId), asc(medicationSchedules.sortOrder));

  const map = new Map<string, MedicationSchedule[]>();
  for (const row of rows) {
    let arr = map.get(row.medicationId);
    if (!arr) {
      arr = [];
      map.set(row.medicationId, arr);
    }
    arr.push(row);
  }
  return map;
}

export async function getSchedulesForMedication(
  medicationId: string,
  userId: string,
): Promise<MedicationSchedule[]> {
  return db
    .select()
    .from(medicationSchedules)
    .where(
      and(
        eq(medicationSchedules.medicationId, medicationId),
        eq(medicationSchedules.userId, userId),
      ),
    )
    .orderBy(asc(medicationSchedules.sortOrder));
}

// Delete-then-insert. Neon HTTP driver does not support real
// transactions, so this is best-effort atomic — the window between
// the delete and the insert is one HTTP round-trip.
export async function replaceSchedulesForMedication(
  medicationId: string,
  userId: string,
  schedules: ScheduleInput[],
): Promise<void> {
  await db
    .delete(medicationSchedules)
    .where(
      and(
        eq(medicationSchedules.medicationId, medicationId),
        eq(medicationSchedules.userId, userId),
      ),
    );

  if (schedules.length === 0) return;

  const rows = schedules.map((s, idx) => ({
    id: createId(),
    medicationId,
    userId,
    scheduleKind: s.scheduleKind,
    timeOfDay: s.scheduleKind === "fixed_time" ? s.timeOfDay : null,
    intervalHours: s.scheduleKind === "interval" ? String(s.intervalHours) : null,
    daysOfWeek:
      s.scheduleKind === "fixed_time" && s.daysOfWeek && s.daysOfWeek.length > 0
        ? s.daysOfWeek
        : null,
    sortOrder: idx,
  }));

  await db.insert(medicationSchedules).values(rows);
}
