import { createId } from "@paralleldrive/cuid2";
import { eq, and, gte, desc, sql, isNotNull, max } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { doseLogs, medications } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { startOfDay } from "$lib/utils/time";
import type { DoseLogWithMedication, SideEffect } from "$lib/types";

export class MedicationNotFoundError extends Error {
  constructor(medicationId: string) {
    super(`Medication ${medicationId} not found for user`);
    this.name = "MedicationNotFoundError";
  }
}

async function assertMedicationBelongsToUser(userId: string, medicationId: string): Promise<void> {
  const [row] = await db
    .select({ id: medications.id })
    .from(medications)
    .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
    .limit(1);

  if (!row) throw new MedicationNotFoundError(medicationId);
}

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
      status: doseLogs.status,
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
  await assertMedicationBelongsToUser(userId, medicationId);
  const id = createId();
  const now = new Date();

  // Insert + inventory decrement in a single transaction — partial
  // failure rolls back both. Audit log runs after the tx commits; a
  // rollback throws past it, so rolled-back writes are not audited.
  const dose = await dbTx.transaction(async (tx) => {
    const [inserted] = await tx
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
        status: "taken",
      })
      .returning();

    await tx
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

    return inserted;
  });

  await logAudit(userId, "dose_log", id, "create");
  return dose;
}

export async function logSkippedDose(userId: string, medicationId: string) {
  await assertMedicationBelongsToUser(userId, medicationId);
  const id = createId();
  const now = new Date();
  await db.insert(doseLogs).values({
    id,
    userId,
    medicationId,
    quantity: 1,
    takenAt: now,
    loggedAt: now,
    notes: null,
    sideEffects: null,
    status: "skipped",
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

  // Skipped/missed doses never decremented inventory, so don't restore.
  // Delete + (conditional) inventory restore in a single transaction —
  // either both happen or neither does.
  const shouldRestoreInventory = dose.status === "taken";
  await dbTx.transaction(async (tx) => {
    await tx.delete(doseLogs).where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)));

    if (shouldRestoreInventory) {
      await tx
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
        );
    }
  });
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

  // Only taken doses ever decremented inventory, so only taken doses
  // get a quantity-diff adjustment. Editing a skipped dose's quantity
  // is bookkeeping only.
  const inventoryAffectingChange =
    existing.status === "taken" &&
    updates.quantity !== undefined &&
    updates.quantity !== existing.quantity;

  // Dose update + (optional) inventory diff in a single transaction
  // so a partial failure rolls back both.
  const updated = await dbTx.transaction(async (tx) => {
    const [u] = await tx
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

    if (inventoryAffectingChange) {
      const diff = updates.quantity! - existing.quantity;
      await tx
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
        );
    }

    return u;
  });

  const changes = computeChanges(existing, updated);
  if (changes) await logAudit(userId, "dose_log", doseId, "update", changes);
  return updated;
}

export async function getLastDosePerMedication(
  userId: string,
): Promise<Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>> {
  // lastTakenAt anchors the schedule projection (only "taken" events count).
  // lastEventAt drives "is this overdue?" timing — both "taken" and
  // "skipped" advance the clock so the user can dismiss an overdue slot
  // by skipping it.
  const rows = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: sql<
        string | null
      >`max(${doseLogs.takenAt}) filter (where ${doseLogs.status} = 'taken')`,
      lastEventAt: max(doseLogs.takenAt),
    })
    .from(doseLogs)
    .where(eq(doseLogs.userId, userId))
    .groupBy(doseLogs.medicationId);

  return rows
    .filter((r) => r.lastEventAt !== null)
    .map((r) => ({
      medicationId: r.medicationId,
      lastTakenAt: r.lastTakenAt ? new Date(r.lastTakenAt) : null,
      lastEventAt: new Date(r.lastEventAt!),
    }));
}
