import { createId } from "@paralleldrive/cuid2";
import { eq, and, sql, max, count, inArray } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { auditLogs, medications, doseLogs, medicationSchedules } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { buildScheduleRows, MedicationOwnershipError } from "./schedules";
import type { MedicationInput, ScheduleInput } from "$lib/utils/validation";
import type { MedicationWithStats } from "$lib/types";
import { calculateDaysUntilRefill } from "$lib/utils/time";

export async function getActiveMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.isArchived, false)))
    .orderBy(medications.sortOrder);
}

export async function getMedicationsWithStats(userId: string): Promise<MedicationWithStats[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const meds = await getActiveMedications(userId);
  if (meds.length === 0) return [];

  // Scope to active meds so archived rows don't hit the aggregate.
  const medIds = meds.map((m) => m.id);
  const stats = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: max(doseLogs.takenAt),
      weeklyDoseCount: count(sql`CASE WHEN ${doseLogs.takenAt} >= ${sevenDaysAgo} THEN 1 END`),
      thirtyDayDoseCount: count(sql`CASE WHEN ${doseLogs.takenAt} >= ${thirtyDaysAgo} THEN 1 END`),
    })
    .from(doseLogs)
    .where(and(eq(doseLogs.userId, userId), inArray(doseLogs.medicationId, medIds)))
    .groupBy(doseLogs.medicationId);

  const statsMap = new Map(
    stats.map((s) => [
      s.medicationId,
      {
        lastTakenAt: s.lastTakenAt ? new Date(s.lastTakenAt) : null,
        weeklyDoseCount: Number(s.weeklyDoseCount),
        avgDailyConsumption: Number(s.thirtyDayDoseCount) / 30,
      },
    ]),
  );

  return meds.map((med) => {
    const s = statsMap.get(med.id);
    const avgDaily = s?.avgDailyConsumption ?? 0;

    return {
      ...med,
      lastTakenAt: s?.lastTakenAt ?? null,
      weeklyDoseCount: s?.weeklyDoseCount ?? 0,
      avgDailyConsumption: avgDaily,
      daysUntilRefill: calculateDaysUntilRefill(
        med.inventoryCount,
        avgDaily,
        med.scheduleType,
        med.scheduleIntervalHours,
      ),
    };
  });
}

export async function getMedicationById(userId: string, id: string) {
  const [med] = await db
    .select()
    .from(medications)
    .where(and(eq(medications.id, id), eq(medications.userId, userId)))
    .limit(1);
  return med ?? null;
}

export async function createMedication(userId: string, input: MedicationInput) {
  const id = createId();
  const [med] = await db
    .insert(medications)
    .values({
      id,
      userId,
      name: input.name,
      dosageAmount: input.dosageAmount,
      dosageUnit: input.dosageUnit,
      form: input.form,
      category: input.category,
      colour: input.colour,
      colourSecondary: input.colourSecondary || null,
      pattern: input.pattern ?? "solid",
      scheduleType: input.scheduleType ?? "scheduled",
      notes: input.notes ?? null,
      scheduleIntervalHours: input.scheduleIntervalHours ?? null,
      inventoryCount: input.inventoryCount ?? null,
      inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
    })
    .returning();
  await logAudit(userId, "medication", id, "create");
  return med;
}

/**
 * Create a medication and its initial schedule rows in a single
 * transaction. Replaces the previous "create then replace
 * schedules" pattern in /medications/new — that flow could leave a
 * medication row with no schedules if the schedule insert failed,
 * which the analytics and dashboard then choke on.
 *
 * The audit row is written through the same transaction, so a
 * partial failure rolls back medication + schedules + audit
 * atomically.
 */
export async function createMedicationWithSchedules(
  userId: string,
  input: MedicationInput,
  schedules: ScheduleInput[],
) {
  const id = createId();
  const scheduleRows = buildScheduleRows(userId, id, schedules);

  return dbTx.transaction(async (tx) => {
    const [med] = await tx
      .insert(medications)
      .values({
        id,
        userId,
        name: input.name,
        dosageAmount: input.dosageAmount,
        dosageUnit: input.dosageUnit,
        form: input.form,
        category: input.category,
        colour: input.colour,
        colourSecondary: input.colourSecondary || null,
        pattern: input.pattern ?? "solid",
        scheduleType: input.scheduleType ?? "scheduled",
        notes: input.notes ?? null,
        scheduleIntervalHours: input.scheduleIntervalHours ?? null,
        inventoryCount: input.inventoryCount ?? null,
        inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
      })
      .returning();

    if (scheduleRows.length > 0) {
      await tx.insert(medicationSchedules).values(scheduleRows);
    }

    await tx
      .insert(auditLogs)
      .values({ id: createId(), userId, entityType: "medication", entityId: id, action: "create" });

    return med;
  });
}

export async function updateMedication(userId: string, id: string, input: MedicationInput) {
  const before = await getMedicationById(userId, id);
  if (!before) return null;
  const [updated] = await db
    .update(medications)
    .set({
      name: input.name,
      dosageAmount: input.dosageAmount,
      dosageUnit: input.dosageUnit,
      form: input.form,
      category: input.category,
      colour: input.colour,
      colourSecondary: input.colourSecondary || null,
      pattern: input.pattern ?? "solid",
      scheduleType: input.scheduleType ?? "scheduled",
      notes: input.notes ?? null,
      scheduleIntervalHours: input.scheduleIntervalHours ?? null,
      inventoryCount: input.inventoryCount ?? null,
      inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)))
    .returning();
  const changes = computeChanges(before, updated);
  if (changes) await logAudit(userId, "medication", id, "update", changes);
  return updated;
}

/**
 * Update a medication and replace its schedule rows in a single
 * transaction. Mirrors createMedicationWithSchedules for the edit
 * flow: previously updateMedication and replaceSchedulesForMedication
 * ran in two separate transactions, so a failure between them could
 * leave the medication row updated against stale schedules (or fresh
 * schedules under an unchanged medication on partial rollback).
 *
 * Returns null when the medication is not owned by the user; throws
 * MedicationOwnershipError if the FK guard inside the transaction
 * fails (defence-in-depth — the caller should already filter).
 */
export async function updateMedicationWithSchedules(
  userId: string,
  id: string,
  input: MedicationInput,
  schedules: ScheduleInput[],
) {
  const before = await getMedicationById(userId, id);
  if (!before) return null;
  const scheduleRows = buildScheduleRows(userId, id, schedules);

  return dbTx.transaction(async (tx) => {
    const [updated] = await tx
      .update(medications)
      .set({
        name: input.name,
        dosageAmount: input.dosageAmount,
        dosageUnit: input.dosageUnit,
        form: input.form,
        category: input.category,
        colour: input.colour,
        colourSecondary: input.colourSecondary || null,
        pattern: input.pattern ?? "solid",
        scheduleType: input.scheduleType ?? "scheduled",
        notes: input.notes ?? null,
        scheduleIntervalHours: input.scheduleIntervalHours ?? null,
        inventoryCount: input.inventoryCount ?? null,
        inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(medications.id, id), eq(medications.userId, userId)))
      .returning();

    if (!updated) throw new MedicationOwnershipError();

    await tx
      .delete(medicationSchedules)
      .where(and(eq(medicationSchedules.medicationId, id), eq(medicationSchedules.userId, userId)));

    if (scheduleRows.length > 0) {
      await tx.insert(medicationSchedules).values(scheduleRows);
    }

    const changes = computeChanges(before, updated);
    if (changes) {
      await tx.insert(auditLogs).values({
        id: createId(),
        userId,
        entityType: "medication",
        entityId: id,
        action: "update",
        changes,
      });
    }

    return updated;
  });
}

export async function swapSortOrder(userId: string, medId1: string, medId2: string) {
  const [m1] = await db
    .select({ sortOrder: medications.sortOrder })
    .from(medications)
    .where(and(eq(medications.id, medId1), eq(medications.userId, userId)))
    .limit(1);
  const [m2] = await db
    .select({ sortOrder: medications.sortOrder })
    .from(medications)
    .where(and(eq(medications.id, medId2), eq(medications.userId, userId)))
    .limit(1);
  if (!m1 || !m2) return;
  await db.update(medications).set({ sortOrder: m2.sortOrder }).where(eq(medications.id, medId1));
  await db.update(medications).set({ sortOrder: m1.sortOrder }).where(eq(medications.id, medId2));
}

export async function archiveMedication(userId: string, id: string) {
  await db
    .update(medications)
    .set({ isArchived: true, archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
  await logAudit(userId, "medication", id, "update", {
    isArchived: { from: false, to: true },
  });
}

export async function unarchiveMedication(userId: string, id: string) {
  await db
    .update(medications)
    .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
  await logAudit(userId, "medication", id, "update", {
    isArchived: { from: true, to: false },
  });
}

export async function getArchivedMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
    .orderBy(medications.name);
}
