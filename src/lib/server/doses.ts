import { createId } from "@paralleldrive/cuid2";
import { eq, and, gte, lt, asc, desc, sql, isNotNull, max } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { doseLogs, medications, medicationSchedules, syncTombstones } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { recordInventoryEvent } from "./inventory-events";
import { dashboardWindow, projectFixedTimes, segmentsFor, slotActions } from "$lib/utils/schedule";
import type { DoseLogWithMedication, SideEffect } from "$lib/types";

export class MedicationNotFoundError extends Error {
  constructor(medicationId: string) {
    super(`Medication ${medicationId} not found for user`);
    this.name = "MedicationNotFoundError";
  }
}

/**
 * A guarded write was asked for at an instant that already holds a TAKEN
 * dose.
 *
 * Only the guarded writes throw it: the dashboard's "Took it at" and Skip,
 * which post the slot's own instant. For Skip, taken beats skip in the
 * matcher, so a skip written there would record a decision the page could
 * never show. For "Took it at", the page that offered the button was stale,
 * and the dose is already there. Either way the honest answer is "refresh,
 * it's already logged".
 */
export class SlotAlreadyTakenError extends Error {
  constructor(message = "A taken dose already exists at this instant") {
    super(message);
    this.name = "SlotAlreadyTakenError";
  }
}

/**
 * The button that was tapped no longer names what the tap would do.
 *
 * `logDoseForSlot` throws it when Log now was posted for a row that is no
 * longer where a dose logged now would land. Causes: render-to-tap drift, a
 * page left open across midnight, the 12h expiry, a double tap, a second
 * device. The guarded Skip throws it when the instant already holds a skip,
 * which a fresh page never offers. Neither writes anything.
 */
export class SlotTargetChangedError extends Error {
  constructor(message = "The Log-now target has changed") {
    super(message);
    this.name = "SlotTargetChangedError";
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

/**
 * The columns a dashboard dose read returns: the dose plus the medication
 * fields its row renders. `inventoryApplied` is deliberately absent — see
 * `DoseLog` in `$lib/types`.
 */
const doseWithMedicationColumns = {
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
};

/**
 * Every dose with `from ≤ takenAt < to`, newest first, with the medication
 * fields a dashboard row renders.
 *
 * Half-open, so a dose exactly at `to` belongs to the next range and never
 * to both. The dashboard passes `dashboardWindow`'s `doseFetchFrom` /
 * `doseFetchTo`, which reach an hour before yesterday's midnight and two
 * hours past tonight's — pass 1's reach either side of the slots it
 * matches. The read it replaced stopped at today's midnight, so no dose from
 * before it could reach the matcher.
 */
export async function getDosesInRange(
  userId: string,
  from: Date,
  to: Date,
): Promise<DoseLogWithMedication[]> {
  const rows = await db
    .select(doseWithMedicationColumns)
    .from(doseLogs)
    .innerJoin(medications, eq(doseLogs.medicationId, medications.id))
    .where(and(eq(doseLogs.userId, userId), gte(doseLogs.takenAt, from), lt(doseLogs.takenAt, to)))
    .orderBy(desc(doseLogs.takenAt));

  return rows;
}

type DbTransaction = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];

/**
 * The one taken-dose write: the row, the stock decrement, the inventory
 * event and the audit entry, all inside the caller's transaction.
 *
 * `logDose` and `logDoseForSlot` both end here, so a Log-now dose and a chip
 * dose cannot drift apart on `inventoryApplied`, the column `deleteDose`
 * restores from. `previousCount` is the caller's own read of
 * `medications.inventoryCount`, taken inside the same transaction before
 * this insert. The caller decides whether that read locks.
 */
async function insertTakenDose(
  tx: DbTransaction,
  input: {
    userId: string;
    medicationId: string;
    quantity: number;
    takenAt: Date;
    loggedAt: Date;
    notes: string | null;
    sideEffects: SideEffect[] | null;
    previousCount: number | null;
  },
) {
  const { userId, medicationId, quantity, previousCount } = input;
  const id = createId();

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
      takenAt: input.takenAt,
      loggedAt: input.loggedAt,
      notes: input.notes,
      sideEffects: input.sideEffects,
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
}

export async function logDose(
  userId: string,
  medicationId: string,
  quantity: number,
  takenAt?: Date,
  notes?: string,
  sideEffects?: SideEffect[],
  opts: { exactInstantGuard?: boolean } = {},
) {
  await assertMedicationBelongsToUser(userId, medicationId);
  const now = new Date();
  const at = takenAt ?? now;
  const guard = opts.exactInstantGuard === true;

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  const dose = await dbTx.transaction(async (tx) => {
    // Snapshot the count BEFORE anything else. It is needed in two places:
    // the inventory event records both ends of the change, and the dose row
    // stores how much it ACTUALLY removed — which is not `quantity` whenever
    // the clamp engages.
    const medRead = tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1);
    // Under the guard the read LOCKS. Two "Took it at 09:00" posts for one
    // medication serialise here, so the second one's lookup below sees the
    // first one's row instead of both inserting. Unguarded callers (the
    // chips, `/api/v1`) keep the plain read. So does
    // `tests/unit/doses-inventory.test.ts`, whose fake-db has no select
    // `.for()` and must not grow one (CLAUDE.md, test-seam rule).
    const [med] = guard ? await medRead.for("update") : await medRead;
    const previousCount = med?.inventoryCount ?? null;

    if (guard) {
      // "Took it at" names the slot's own instant to the millisecond. A fresh
      // page never offers it on an instant that already holds a taken dose,
      // because pass 0 resolves that slot, so a taken row here means the page
      // is stale: a double tap, a second device, or a row that arrived by
      // import, `/api/v1` or an edit. Refuse, so a double tap still writes
      // and decrements once, and the caller never reports someone else's row
      // as this tap's (its Undo would delete that record). A SKIP there does
      // not count: taken beats skip, and pass 0 then gives the slot to the
      // taken dose.
      const [existing] = await tx
        .select()
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
            eq(doseLogs.status, "taken"),
          ),
        )
        .orderBy(asc(doseLogs.id))
        .limit(1);
      if (existing) {
        throw new SlotAlreadyTakenError(
          `Medication ${medicationId} already has a taken dose at ${at.toISOString()}`,
        );
      }
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity,
      takenAt: at,
      loggedAt: now,
      notes: notes ?? null,
      sideEffects: sideEffects ?? null,
      previousCount,
    });
  });

  return dose;
}

export async function logSkippedDose(
  userId: string,
  medicationId: string,
  takenAt?: Date,
  opts: { exactInstantGuard?: boolean } = {},
): Promise<string> {
  await assertMedicationBelongsToUser(userId, medicationId);
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  return dbTx.transaction(async (tx) => {
    if (opts.exactInstantGuard) {
      // The dashboard's Skip posts the slot's own instant. Lock the
      // medication so two Skip taps, or a Skip racing "Took it at" on another
      // device, serialise. Then look at what that instant already holds.
      const [locked] = await tx
        .select({ id: medications.id })
        .from(medications)
        .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
        .limit(1)
        .for("update");
      if (!locked) throw new MedicationNotFoundError(medicationId);

      const atInstant = await tx
        .select({ id: doseLogs.id, status: doseLogs.status })
        .from(doseLogs)
        .where(
          and(
            eq(doseLogs.userId, userId),
            eq(doseLogs.medicationId, medicationId),
            eq(doseLogs.takenAt, at),
          ),
        )
        .orderBy(asc(doseLogs.id));

      // Taken beats skip: a skip written here could never show.
      if (atInstant.some((d) => d.status === "taken")) {
        throw new SlotAlreadyTakenError(
          `Medication ${medicationId} already has a taken dose at ${at.toISOString()}`,
        );
      }
      // A fresh page never offers Skip on an instant that already holds a
      // skip: that skip resolves the slot. So this is a stale page, and
      // returning the existing id would hand its Undo someone else's row.
      if (atInstant.some((d) => d.status === "skipped")) {
        throw new SlotTargetChangedError(
          `Medication ${medicationId} already has a skip at ${at.toISOString()}`,
        );
      }
    }

    const id = createId();
    await tx.insert(doseLogs).values({
      id,
      userId,
      medicationId,
      quantity: 1,
      takenAt: at,
      loggedAt: now,
      notes: null,
      sideEffects: null,
      status: "skipped",
    });
    await logAudit(userId, "dose_log", id, "create", undefined, tx);
    return id;
  });
}

/**
 * Log now's write.
 *
 * The page rendered Log now on the row a dose logged at render time would
 * resolve. By the time the tap arrives, that can be a different row: a slot
 * came within the hour, midnight passed, the 12h expiry hid the row, or
 * another device logged. So the server re-derives the target with the SAME
 * pure functions the load used (`dashboardWindow`, `projectFixedTimes`,
 * `slotActions`), from rows read inside this transaction, and writes only
 * if the target is still `forSlot`.
 *
 * The medication row is locked first, so two Log-now posts for one
 * medication serialise. The second reads the first one's dose, finds the
 * one-hour cooldown active and throws SlotTargetChangedError instead of
 * writing a second dose. PGlite is one backend and serialises transactions
 * itself, so the lock's effect is unexercisable in the suite.
 * `tests/unit/pg/dose-slot-writes.test.ts` pins the lock by its SQL and
 * proves the recompute reads inside the transaction.
 *
 * Always ×1. A larger dose could resolve rows the simulation never proved,
 * and Log now's contract is "this row".
 */
export async function logDoseForSlot(
  userId: string,
  medicationId: string,
  forSlot: Date,
  now: Date,
  timezone: string,
): Promise<typeof doseLogs.$inferSelect> {
  const window = dashboardWindow(now, timezone);

  return dbTx.transaction(async (tx) => {
    const [med] = await tx
      .select()
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);

    // The load lists active medications only (`getActiveMedications`), so an
    // archived one has no Log-now target there and must have none here.
    if (med.isArchived) {
      throw new SlotTargetChangedError(`Medication ${medicationId} is archived`);
    }

    const schedules = await tx
      .select()
      .from(medicationSchedules)
      .where(
        and(
          eq(medicationSchedules.medicationId, medicationId),
          eq(medicationSchedules.userId, userId),
        ),
      )
      .orderBy(asc(medicationSchedules.sortOrder));

    // The load's bounds, so pass 1 reaches as far either side of the window
    // here as it did when the button was drawn.
    const doses = await tx
      .select({
        id: doseLogs.id,
        takenAt: doseLogs.takenAt,
        status: doseLogs.status,
        quantity: doseLogs.quantity,
      })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, medicationId),
          gte(doseLogs.takenAt, window.doseFetchFrom),
          lt(doseLogs.takenAt, window.doseFetchTo),
        ),
      );

    // All-time and taken-only: `getLastDosePerMedication`'s `lastTakenAt`,
    // the anchor the load projects interval rows from.
    const [last] = await tx
      .select({ at: max(doseLogs.takenAt) })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, medicationId),
          eq(doseLogs.status, "taken"),
        ),
      );

    const fixedInstants = projectFixedTimes(schedules, segmentsFor(window), timezone);
    const { logNowTarget } = slotActions({
      med,
      schedules,
      fixedInstants,
      doses,
      lastTakenAt: last?.at ?? null,
      window,
    });

    if (logNowTarget !== forSlot.toISOString()) {
      throw new SlotTargetChangedError(
        `Log-now target for ${medicationId} is ${logNowTarget ?? "none"}, not ${forSlot.toISOString()}`,
      );
    }

    return insertTakenDose(tx, {
      userId,
      medicationId,
      quantity: 1,
      takenAt: now,
      loggedAt: now,
      notes: null,
      sideEffects: null,
      previousCount: med.inventoryCount,
    });
  });
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
