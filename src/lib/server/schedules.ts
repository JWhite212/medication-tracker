import { createId } from "@paralleldrive/cuid2";
import { eq, and, asc } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { medicationSchedules, medications } from "$lib/server/db/schema";
import type { ScheduleInput } from "$lib/utils/validation";
import type { InferSelectModel } from "drizzle-orm";

export type MedicationSchedule = InferSelectModel<typeof medicationSchedules>;

export class MedicationOwnershipError extends Error {
  constructor() {
    super("Medication not found or not owned by user");
  }
}

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

// Delete-then-insert wrapped in a transaction (below) so a failed
// insert rolls back the delete and the original schedule rows survive.
export async function replaceSchedulesForMedication(
  medicationId: string,
  userId: string,
  schedules: ScheduleInput[],
): Promise<void> {
  // Self-defending ownership check — callers already filter by userId,
  // but verify here so a misuse can't write rows that point at another
  // user's medication via the FK.
  const [owner] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1);
  if (!owner) throw new MedicationOwnershipError();

  // Delete-then-insert in a single transaction — if the insert fails
  // (e.g. constraint violation), the original schedule rows are
  // restored on rollback.
  const rows =
    schedules.length === 0
      ? []
      : schedules.map((s, idx) => ({
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

  await dbTx.transaction(async (tx) => {
    await tx
      .delete(medicationSchedules)
      .where(
        and(
          eq(medicationSchedules.medicationId, medicationId),
          eq(medicationSchedules.userId, userId),
        ),
      );

    if (rows.length > 0) {
      await tx.insert(medicationSchedules).values(rows);
    }
  });
}
