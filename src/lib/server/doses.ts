import { createId } from "@paralleldrive/cuid2";
import { eq, and, gte, desc, sql, isNotNull, max } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { startOfDay } from "$lib/utils/time";
import type { DoseLogWithMedication, SideEffect } from "$lib/types";

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
      sideEffects: doseLogs.sideEffects,
      medication: {
        name: medications.name,
        dosageAmount: medications.dosageAmount,
        dosageUnit: medications.dosageUnit,
        form: medications.form,
        colour: medications.colour,
        colourSecondary: medications.colourSecondary,
        pattern: medications.pattern,
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
  sideEffects?: SideEffect[],
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
      sideEffects: sideEffects ?? null,
    })
    .returning();

  // Atomic inventory decrement
  await db
    .update(medications)
    .set({
      inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${quantity})`,
    })
    .where(
      and(
        eq(medications.id, medicationId),
        eq(medications.userId, userId),
        isNotNull(medications.inventoryCount),
      ),
    );

  await logAudit(userId, "dose_log", id, "create");
  return dose;
}

export async function logSkippedDose(userId: string, medicationId: string) {
  const id = createId();
  const now = new Date();
  await db.insert(doseLogs).values({
    id,
    userId,
    medicationId,
    quantity: 0,
    takenAt: now,
    loggedAt: now,
    notes: "Skipped",
    sideEffects: null,
  });
  await logAudit(userId, "dose_log", id, "create");
  return id;
}

export async function deleteDose(userId: string, doseId: string) {
  const [dose] = await db
    .select()
    .from(doseLogs)
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .limit(1);

  if (!dose) return false;

  // Inventory restore + delete in parallel
  await Promise.all([
    db
      .update(medications)
      .set({
        inventoryCount: sql`${medications.inventoryCount} + ${dose.quantity}`,
      })
      .where(
        and(
          eq(medications.id, dose.medicationId),
          eq(medications.userId, userId),
          isNotNull(medications.inventoryCount),
        ),
      ),
    db.delete(doseLogs).where(eq(doseLogs.id, doseId)),
  ]);
  await logAudit(userId, "dose_log", doseId, "delete");
  return true;
}

export async function updateDose(
  userId: string,
  doseId: string,
  updates: {
    takenAt?: Date;
    quantity?: number;
    notes?: string;
    sideEffects?: SideEffect[] | null;
  },
) {
  const [existing] = await db
    .select()
    .from(doseLogs)
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .limit(1);

  if (!existing) return null;

  // Inventory adjustment + dose update in parallel
  const doseUpdatePromise = db
    .update(doseLogs)
    .set({
      ...(updates.takenAt && { takenAt: updates.takenAt }),
      ...(updates.quantity && { quantity: updates.quantity }),
      ...(updates.notes !== undefined && { notes: updates.notes || null }),
      ...(updates.sideEffects !== undefined && {
        sideEffects: updates.sideEffects ?? null,
      }),
    })
    .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
    .returning();

  const parallel: Promise<unknown>[] = [doseUpdatePromise];
  if (
    updates.quantity !== undefined &&
    updates.quantity !== existing.quantity
  ) {
    const diff = updates.quantity - existing.quantity;
    parallel.push(
      db
        .update(medications)
        .set({
          inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${diff})`,
        })
        .where(
          and(
            eq(medications.id, existing.medicationId),
            eq(medications.userId, userId),
            isNotNull(medications.inventoryCount),
          ),
        ),
    );
  }
  await Promise.all(parallel);
  const [updated] = await doseUpdatePromise;

  const changes = computeChanges(existing, updated);
  if (changes) await logAudit(userId, "dose_log", doseId, "update", changes);
  return updated;
}

export async function getLastDosePerMedication(
  userId: string,
): Promise<Array<{ medicationId: string; lastTakenAt: Date }>> {
  const rows = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: max(doseLogs.takenAt),
    })
    .from(doseLogs)
    .where(eq(doseLogs.userId, userId))
    .groupBy(doseLogs.medicationId);

  return rows
    .filter((r) => r.lastTakenAt !== null)
    .map((r) => ({
      medicationId: r.medicationId,
      lastTakenAt: new Date(r.lastTakenAt!),
    }));
}
