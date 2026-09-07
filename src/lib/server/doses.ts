import { createId } from "@paralleldrive/cuid2";
import { eq, and, gte, desc, sql, isNotNull, max } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { doseLogs, medications, syncTombstones } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { recordInventoryEvent } from "./inventory-events";
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
      updatedAt: doseLogs.updatedAt,
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

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  const dose = await dbTx.transaction(async (tx) => {
    // Snapshot the count BEFORE anything else. It is needed in two places:
    // the inventory event records both ends of the change, and the dose row
    // stores how much it ACTUALLY removed — which is not `quantity` whenever
    // the clamp below engages. Reading it before the insert rather than
    // after is what lets that value be written with the row instead of in a
    // second update.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1);
    const previousCount = med?.inventoryCount ?? null;

    // What will really leave the bottle. `GREATEST(0, …)` cannot take more
    // than there is, so a dose of 3 logged against a stock of 1 removes 1 —
    // and a delete that gave back 3 would invent the other two.
    const inventoryApplied =
      previousCount === null ? 0 : previousCount - Math.max(0, previousCount - quantity);

    const [inserted] = await tx
      .insert(doseLogs)
      .values({
        id,
        userId,
        medicationId,
        quantity,
        inventoryApplied,
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

    // Only record an event when inventory was actually tracked.
    // The actual delta accounts for the GREATEST(0, ...) clamp.
    if (previousCount !== null) {
      await recordInventoryEvent(tx, {
        userId,
        medicationId,
        eventType: "dose_taken",
        quantityChange: -inventoryApplied,
        previousCount,
        newCount: previousCount - inventoryApplied,
      });
    }

    await logAudit(userId, "dose_log", id, "create", undefined, tx);

    return inserted;
  });

  return dose;
}

export async function logSkippedDose(userId: string, medicationId: string) {
  await assertMedicationBelongsToUser(userId, medicationId);
  const id = createId();
  const now = new Date();
  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  await dbTx.transaction(async (tx) => {
    await tx.insert(doseLogs).values({
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
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
  });
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
      const [med] = await tx
        .select({ inventoryCount: medications.inventoryCount })
        .from(medications)
        .where(and(eq(medications.id, dose.medicationId), eq(medications.userId, userId)))
        .limit(1);
      const previousCount = med?.inventoryCount ?? null;

      // Give back exactly what this dose took, which is not always what it
      // says it took. NULL means the row predates the column (or its
      // backfill was skipped by a `drizzle-kit push`), and falling back to
      // `quantity` reproduces the historical behaviour rather than
      // restoring nothing — the same bug in the opposite direction.
      const applied = dose.inventoryApplied ?? dose.quantity;

      await tx
        .update(medications)
        .set({
          inventoryCount: sql`${medications.inventoryCount} + ${applied}`,
        })
        .where(
          and(
            eq(medications.id, dose.medicationId),
            eq(medications.userId, userId),
            isNotNull(medications.inventoryCount),
          ),
        );

      if (previousCount !== null) {
        await recordInventoryEvent(tx, {
          userId,
          medicationId: dose.medicationId,
          eventType: "dose_deleted",
          quantityChange: applied,
          previousCount,
          newCount: previousCount + applied,
        });
      }
    }

    await tx.insert(syncTombstones).values({
      id: createId(),
      userId,
      entityType: "dose_log",
      entityId: doseId,
    });

    await logAudit(userId, "dose_log", doseId, "delete", undefined, tx);
  });
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
    // The inventory arm has to run first: it needs the count as it stands
    // before this edit, and it decides the `inventoryApplied` the row is
    // written with.
    let nextApplied: number | undefined;
    let inventoryWrite: (() => Promise<void>) | undefined;

    if (inventoryAffectingChange) {
      const [med] = await tx
        .select({ inventoryCount: medications.inventoryCount })
        .from(medications)
        .where(and(eq(medications.id, existing.medicationId), eq(medications.userId, userId)))
        .limit(1);
      const previousCount = med?.inventoryCount ?? null;

      // What this dose took, and what it will take instead. Editing moves
      // the APPLIED amount, never the difference of the two quantities: a
      // dose of 3 logged against a stock of 1 only ever removed 1, so
      // lowering it to 1 must change nothing, where `count - (1 - 3)`
      // credited two doses that had never left the bottle.
      //
      // The new amount cannot exceed what the bottle would hold once this
      // dose gives back what it took, hence `previousCount + applied`.
      const applied = existing.inventoryApplied ?? existing.quantity;
      nextApplied =
        previousCount === null
          ? 0
          : Math.max(0, Math.min(updates.quantity!, previousCount + applied));
      const delta = applied - nextApplied;

      inventoryWrite = async () => {
        await tx
          .update(medications)
          .set({
            // GREATEST is belt-and-braces: `nextApplied <= previousCount +
            // applied` already makes the result non-negative.
            inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} + ${delta})`,
          })
          .where(
            and(
              eq(medications.id, existing.medicationId),
              eq(medications.userId, userId),
              isNotNull(medications.inventoryCount),
            ),
          );

        if (previousCount !== null) {
          await recordInventoryEvent(tx, {
            userId,
            medicationId: existing.medicationId,
            eventType: "dose_quantity_updated",
            quantityChange: delta,
            previousCount,
            newCount: previousCount + delta,
          });
        }
      };
    }

    const [u] = await tx
      .update(doseLogs)
      .set({
        ...(updates.takenAt !== undefined && { takenAt: updates.takenAt }),
        // `!== undefined`, matching the gate at `inventoryAffectingChange`
        // above. A truthiness test here let a quantity of 0 pass that gate,
        // adjust the inventory, and never write the row — the two guards
        // must agree. Unreachable today only because all four doors bound
        // quantity at `min(1)`.
        ...(updates.quantity !== undefined && { quantity: updates.quantity }),
        ...(nextApplied !== undefined && { inventoryApplied: nextApplied }),
        ...(updates.notes !== undefined && { notes: updates.notes || null }),
        ...(updates.sideEffects !== undefined && {
          sideEffects: updates.sideEffects ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .returning();

    if (inventoryWrite) await inventoryWrite();

    const changes = computeChanges(existing, u);
    if (changes) await logAudit(userId, "dose_log", doseId, "update", changes, tx);

    return u;
  });

  return updated;
}

export async function getLastDosePerMedication(
  userId: string,
): Promise<Array<{ medicationId: string; lastTakenAt: Date | null; lastEventAt: Date }>> {
  // lastTakenAt anchors the schedule projection (only "taken" events count).
  // lastEventAt drives "is this overdue?" timing — "taken" and "skipped"
  // advance the clock so the user can dismiss an overdue slot by skipping
  // it. "missed" is excluded so a (future) auto-mark-missed job can't
  // silently push the clock past an unhandled slot.
  const rows = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: sql<
        string | null
      >`max(${doseLogs.takenAt}) filter (where ${doseLogs.status} = 'taken')`,
      lastEventAt: sql<
        string | null
      >`max(${doseLogs.takenAt}) filter (where ${doseLogs.status} in ('taken', 'skipped'))`,
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
