import { createId } from "@paralleldrive/cuid2";
import { eq, and } from "drizzle-orm";
import { db } from "$lib/server/db";
import { medications } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import type { MedicationInput } from "$lib/utils/validation";

export async function getActiveMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(
      and(eq(medications.userId, userId), eq(medications.isArchived, false)),
    )
    .orderBy(medications.sortOrder);
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
      notes: input.notes ?? null,
      scheduleIntervalHours: input.scheduleIntervalHours ?? null,
      inventoryCount: input.inventoryCount ?? null,
      inventoryAlertThreshold: input.inventoryAlertThreshold ?? null,
    })
    .returning();
  await logAudit(userId, "medication", id, "create");
  return med;
}

export async function updateMedication(
  userId: string,
  id: string,
  input: MedicationInput,
) {
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

export async function archiveMedication(userId: string, id: string) {
  await db
    .update(medications)
    .set({ isArchived: true, updatedAt: new Date() })
    .where(and(eq(medications.id, id), eq(medications.userId, userId)));
  await logAudit(userId, "medication", id, "update", {
    isArchived: { from: false, to: true },
  });
}
