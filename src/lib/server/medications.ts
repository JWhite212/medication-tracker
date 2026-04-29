import { createId } from "@paralleldrive/cuid2";
import { eq, and, sql, max, count } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications, doseLogs } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import type { MedicationInput } from "$lib/utils/validation";
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

  // Aggregate dose stats per medication in a single query
  const stats = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: max(doseLogs.takenAt),
      weeklyDoseCount: count(sql`CASE WHEN ${doseLogs.takenAt} >= ${sevenDaysAgo} THEN 1 END`),
      thirtyDayDoseCount: count(sql`CASE WHEN ${doseLogs.takenAt} >= ${thirtyDaysAgo} THEN 1 END`),
    })
    .from(doseLogs)
    .where(eq(doseLogs.userId, userId))
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
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
  await logAudit(userId, "medication", id, "update", {
    isArchived: { from: false, to: true },
  });
}

export async function unarchiveMedication(userId: string, id: string) {
  await db
    .update(medications)
    .set({ isArchived: false, updatedAt: new Date() })
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
