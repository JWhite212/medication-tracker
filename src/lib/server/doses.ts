import { createId } from "@paralleldrive/cuid2";
import { eq, and, gte, desc } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { startOfDay } from "$lib/utils/time";
import type { DoseLogWithMedication } from "$lib/types";

export async function getTodaysDoses(
  userId: string,
  timezone: string,
): Promise<DoseLogWithMedication[]> {
  const dayStart = startOfDay(new Date(), timezone);

  const rows = await db
    .select({
      id: doseLogs.id,
      userId: doseLogs.userId,
      medicationId: doseLogs.medicationId,
      quantity: doseLogs.quantity,
      takenAt: doseLogs.takenAt,
      loggedAt: doseLogs.loggedAt,
      notes: doseLogs.notes,
      medication: {
        name: medications.name,
        dosageAmount: medications.dosageAmount,
        dosageUnit: medications.dosageUnit,
        form: medications.form,
        colour: medications.colour,
      },
    })
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, dayStart)))
    .orderBy(desc(doseLogs.takenAt));

  return rows;
}

export async function logDose(
  userId: string,
  medicationId: string,
  quantity: number,
  takenAt?: Date,
  notes?: string,
) {
  const id = createId();
  const now = new Date();

  const [dose] = await db
    .insert(doseLogs)
    .values({
      id,
      userId,
      medicationId,
      quantity,
      takenAt: takenAt ?? now,
      loggedAt: now,
      notes: notes ?? null,
    })
    .returning();

  // Decrement inventory
  const [med] = await db
    .select({ inventoryCount: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, medicationId))
    .limit(1);

  if (med?.inventoryCount !== null) {
    await db
      .update(medications)
      .set({
        inventoryCount: Math.max(0, (med.inventoryCount ?? 0) - quantity),
      })
      .where(eq(medications.id, medicationId));
  }

  await logAudit(userId, "dose_log", id, "create");
  return dose;
}

export async function deleteDose(userId: string, doseId: string) {
  const [dose] = await db
    .select()
    .from(doseLogs)
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .limit(1);

  if (!dose) return false;

  // Restore inventory
  const [med] = await db
    .select({ inventoryCount: medications.inventoryCount })
    .from(medications)
    .where(eq(medications.id, dose.medicationId))
    .limit(1);

  if (med?.inventoryCount !== null) {
    await db
      .update(medications)
      .set({ inventoryCount: (med.inventoryCount ?? 0) + dose.quantity })
      .where(eq(medications.id, dose.medicationId));
  }

  await db.delete(doseLogs).where(eq(doseLogs.id, doseId));
  await logAudit(userId, "dose_log", doseId, "delete");
  return true;
}

export async function updateDose(
  userId: string,
  doseId: string,
  updates: { takenAt?: Date; quantity?: number; notes?: string },
) {
  const [existing] = await db
    .select()
    .from(doseLogs)
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .limit(1);

  if (!existing) return null;

  // Adjust inventory if quantity changed
  if (
    updates.quantity !== undefined &&
    updates.quantity !== existing.quantity
  ) {
    const diff = updates.quantity - existing.quantity;
    const [med] = await db
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(eq(medications.id, existing.medicationId))
      .limit(1);

    if (med?.inventoryCount !== null) {
      await db
        .update(medications)
        .set({ inventoryCount: Math.max(0, (med.inventoryCount ?? 0) - diff) })
        .where(eq(medications.id, existing.medicationId));
    }
  }

  const [updated] = await db
    .update(doseLogs)
    .set({
      ...(updates.takenAt && { takenAt: updates.takenAt }),
      ...(updates.quantity && { quantity: updates.quantity }),
      ...(updates.notes !== undefined && { notes: updates.notes || null }),
    })
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .returning();

  const changes = computeChanges(existing, updated);
  if (changes) await logAudit(userId, "dose_log", doseId, "update", changes);
  return updated;
}
