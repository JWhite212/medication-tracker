import { createId } from "@paralleldrive/cuid2";
import { eq, and, asc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medicationSchedules } from "$lib/server/db/schema";
import type { ScheduleInput } from "$lib/utils/validation";
import type { InferSelectModel } from "drizzle-orm";

export type MedicationSchedule = InferSelectModel<typeof medicationSchedules>;

export class MedicationOwnershipError extends Error {
  constructor() {
    super("Medication not found or not owned by user");
    // /api/v1's runCommands passes a refusal through to the client by
    // `e.name`; without this it read "Error" and was redacted as a failure.
    this.name = "MedicationOwnershipError";
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

/**
 * Build the row payload used by both `createMedicationWithSchedules`
 * (insert fresh under a brand-new medication id) and
 * `updateMedicationWithSchedules` (delete-then-insert inside its own
 * transaction, in `medications.ts`). Single source of truth for
 * the per-kind field shape so a schema tweak (e.g. a new column on a
 * fixed-time row) only updates one place.
 */
export function buildScheduleRows(
  userId: string,
  medicationId: string,
  schedules: ScheduleInput[],
): Array<typeof medicationSchedules.$inferInsert> {
  return schedules.map((s, idx) => ({
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
}
