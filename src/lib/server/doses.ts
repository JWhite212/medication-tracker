import { createId } from "@paralleldrive/cuid2";
import { eq, and, gt, gte, lt, lte, asc, desc, sql, isNotNull, max, inArray } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import {
  doseLogs,
  doseLogTrash,
  medications,
  medicationSchedules,
  syncTombstones,
} from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { recordInventoryEvent } from "./inventory-events";
import { dashboardWindow, projectFixedTimes, segmentsFor, slotActions } from "$lib/utils/schedule";
import type { DoseLogWithMedication, SideEffect } from "$lib/types";
import { DOSE_UNDO_WINDOW_MS } from "$lib/utils/dose-undo";

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
 * Take `amount` doses from stock, never below zero, and return how many
 * actually left the bottle.
 *
 * This is the only copy of the clamp. A taken dose (`insertTakenDose`) and a
 * restored one (`restoreDose`) both come through here, so the
 * `inventoryApplied` a row records is always what this UPDATE removed. A dose
 * of 3 logged against a stock of 1 removes 1, and a delete that later gave
 * back 3 would invent the other two.
 *
 * `previousCount` is the caller's read of `medications.inventoryCount` inside
 * the same transaction. NULL means inventory is not tracked: nothing is
 * taken, no event is written, and 0 is returned.
 *
 * The UPDATE subtracts `amount`, not the result. The two give the same count
 * whenever `previousCount` is still the live value, which it is when the
 * caller read it under the medication lock (D7). The `GREATEST` keeps the
 * column non-negative even when it is not.
 */
async function takeFromStock(
  tx: DbTransaction,
  i: {
    userId: string;
    medicationId: string;
    previousCount: number | null;
    amount: number;
    eventType: "dose_taken" | "dose_restored";
  },
): Promise<number> {
  const applied = i.previousCount === null ? 0 : Math.min(i.previousCount, i.amount);

  await tx
    .update(medications)
    .set({
      inventoryCount: sql`GREATEST(0, ${medications.inventoryCount} - ${i.amount})`,
    })
    .where(
      and(
        eq(medications.id, i.medicationId),
        eq(medications.userId, i.userId),
        isNotNull(medications.inventoryCount),
      ),
    );

  // An event only when inventory was actually tracked, recording what really
  // left the bottle after the clamp.
  if (i.previousCount !== null) {
    await recordInventoryEvent(tx, {
      userId: i.userId,
      medicationId: i.medicationId,
      eventType: i.eventType,
      quantityChange: -applied,
      previousCount: i.previousCount,
      newCount: i.previousCount - applied,
    });
  }

  return applied;
}

/**
 * The one taken-dose write: the stock decrement, the inventory event, the
 * row and the audit entry, all inside the caller's transaction.
 *
 * `logDose` and `logDoseForSlot` both end here, so a Log-now dose and a chip
 * dose cannot drift apart on `inventoryApplied`, the column `deleteDose`
 * gives back. `previousCount` is the caller's own read of
 * `medications.inventoryCount`, taken inside the same transaction before
 * this insert, under the medication row lock every caller takes first (D7),
 * so no other stock writer can commit between that read and this decrement.
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

  // What will really leave the bottle: not `quantity` whenever the clamp
  // engages. The stock moves first, because the row records the result.
  const inventoryApplied = await takeFromStock(tx, {
    userId,
    medicationId,
    previousCount,
    amount: quantity,
    eventType: "dose_taken",
  });

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
  // The action's clock. A dose posted without a `takenAt` is recorded at the
  // moment the request arrived, so this is read before any lock wait.
  const now = new Date();
  const at = takenAt ?? now;
  const guard = opts.exactInstantGuard === true;

  // Insert + inventory decrement + audit log all happen inside a single
  // transaction so logDose is all-or-nothing: on any throw, nothing —
  // including the audit row — is durably committed. This is required by
  // runCommands' reserve-first idempotency (see commands.ts), which relies
  // on "handler threw" meaning "safe to retry" for every command handler.
  const dose = await dbTx.transaction(async (tx) => {
    // D7: the medication row first, locked, on EVERY path. The count read
    // here is what `inventoryApplied` is computed from. Unlocked, a
    // concurrent stock writer (a refill, an adjust, a delete, a restore)
    // could commit between this read and the decrement below, and the dose
    // would record an `inventoryApplied` larger than what really left the
    // bottle, which a later delete then minted back. The lock also makes two
    // "Took it at 09:00" posts serialise, so the second one's lookup below
    // sees the first one's row instead of both inserting.
    //
    // The read is scoped by user, so it is also the ownership check: another
    // user's medication is simply not there.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!med) throw new MedicationNotFoundError(medicationId);
    const previousCount = med.inventoryCount;

    // `loggedAt` orders writes to this medication: restore's since-delete
    // guard compares it with a trash row's `deletedAt`. Read after the lock,
    // clock order is commit order (D7).
    const loggedAt = new Date();

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
      loggedAt,
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
  // The action's clock, read before any lock wait: a skip posted without a
  // `takenAt` is recorded at the moment the request arrived.
  const now = new Date();
  const at = takenAt ?? now;

  // Insert + audit log in a single transaction so logSkippedDose is
  // all-or-nothing (see logDose above for why this matters for
  // runCommands' reserve-first idempotency).
  return dbTx.transaction(async (tx) => {
    // D7 on BOTH paths. A skip is a per-dose write like any other, and its
    // `loggedAt` must be read after the medication lock for the restore's
    // since-delete guard to see commit order. Under the guard the lock also
    // makes two Skip taps, or a Skip racing "Took it at" on another device,
    // serialise. The read is scoped by user, so it is the ownership check
    // on both paths too.
    const [locked] = await tx
      .select({ id: medications.id })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    if (!locked) throw new MedicationNotFoundError(medicationId);

    const loggedAt = new Date();

    if (opts.exactInstantGuard) {
      // The dashboard's Skip posts the slot's own instant. Look at what that
      // instant already holds.
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
      loggedAt,
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

    // `takenAt` is the action's `now`: the instant the tap names. `loggedAt`
    // orders writes to this medication, so it is read after the lock (D7).
    const loggedAt = new Date();

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
      loggedAt,
      notes: null,
      sideEffects: null,
      previousCount: med.inventoryCount,
    });
  });
}

/** What `deleteDose` reports: enough for a toast to name the dose and for Undo to key its restore. */
export interface DeletedDose {
  doseId: string;
  medicationId: string;
  deletedAt: Date;
}

/** The global `db` (autocommit: the retention sweep) or a transaction. */
type DbExecutor = typeof db | DbTransaction;

/**
 * Delete trash rows whose undo window has closed:
 * `deleted_at <= now − DOSE_UNDO_WINDOW_MS`, the same rule `restoreDose`
 * uses for "expired".
 *
 * - With a `userId` it purges only that user's rows. The on-write purges in
 *   `deleteDose` and `restoreDose` use this form.
 * - Without one it purges everyone's. The retention sweep uses this form.
 *
 * It never waits. The ids come from a `FOR UPDATE SKIP LOCKED` subquery, so a
 * row that a restore, a wipe or a cascade has locked is left for a later
 * purge instead of being queued behind. A purge that never waits cannot close
 * a lock cycle with any of those (spec D7). This is the only copy of the purge
 * SQL; the retention policy calls this function as well.
 */
export async function purgeExpiredTrash(
  executor: DbExecutor,
  opts: { now: Date; userId?: string },
): Promise<void> {
  const cutoff = new Date(opts.now.getTime() - DOSE_UNDO_WINDOW_MS);
  const expired = executor
    .select({ id: doseLogTrash.id })
    .from(doseLogTrash)
    .where(
      and(
        opts.userId ? eq(doseLogTrash.userId, opts.userId) : undefined,
        lte(doseLogTrash.deletedAt, cutoff),
      ),
    )
    .for("update", { skipLocked: true });

  await executor.delete(doseLogTrash).where(inArray(doseLogTrash.id, expired));
}

/**
 * Delete one dose and give back what it took from stock. When the caller will
 * offer an Undo, also keep the dose in `dose_log_trash`, so that `restoreDose`
 * can put the same row back.
 *
 * Everything runs in one transaction, in D7's lock order: the medication row
 * first, then the dose.
 *
 * **Double delete.** Two overlapping deletes of one dose serialise on the
 * medication lock. The second one's `DELETE … RETURNING` then finds nothing,
 * so it writes nothing: no second credit, event, trash row, tombstone or
 * audit row. The code this replaces read the dose outside its transaction,
 * deleted without checking the row count and always credited. So the losing
 * delete minted a second dose's worth of stock, and the ledger reconciled
 * with the mint.
 *
 * **Edit, then delete.** The credit comes from RETURNING's after-image, not
 * an earlier read. An edit that committed first is therefore credited at its
 * edited applied amount.
 *
 * **What the trash row records.** `inventoryCredited` is what this delete
 * actually gave back, which is not always `inventoryApplied`: nothing is
 * credited while tracking is off. A restore takes back only
 * `inventoryCredited`. So a dose deleted while tracking was off, then
 * restored after tracking came back on, takes nothing it never gave.
 *
 * **When to keep nothing.** `keepForUndo: false` is for deletes nobody can
 * undo (D8): the Mac app's `delete_dose`, and the delete behind a create's
 * Undo.
 *
 * **The clock.** `deletedAt` is read from the app clock AFTER the medication
 * lock (D7), so it orders correctly against every `loggedAt` written under
 * the same lock. `opts.now` overrides it for tests.
 */
export async function deleteDose(
  userId: string,
  doseId: string,
  opts: { keepForUndo: boolean; now?: Date },
): Promise<DeletedDose | null> {
  return dbTx.transaction(async (tx): Promise<DeletedDose | null> => {
    // 1. Find which medication to lock. This read needs no lock, because a
    //    dose's medicationId never changes.
    const [found] = await tx
      .select({ medicationId: doseLogs.medicationId })
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1);
    if (!found) return null;
    const { medicationId } = found;

    // 2. Lock the medication (D7), which also makes this count read exact.
    //    Only then read the clock.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const previousCount = med?.inventoryCount ?? null;
    const now = opts.now ?? new Date();

    // 3. The delete. A second delete of this dose waited on the lock above
    //    and finds nothing here, so it stops before writing anything.
    const [deleted] = await tx
      .delete(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .returning();
    if (!deleted) return null;

    // 4. Give the stock back. Skipped and missed rows never took any.
    let credited = 0;
    if (deleted.status === "taken") {
      // NULL means the row predates the column, or a `drizzle-kit push`
      // skipped its backfill. Falling back to `quantity` keeps the
      // historical behaviour; giving back nothing would be the same bug in
      // the other direction.
      const applied = deleted.inventoryApplied ?? deleted.quantity;

      await tx
        .update(medications)
        .set({ inventoryCount: sql`${medications.inventoryCount} + ${applied}` })
        .where(
          and(
            eq(medications.id, medicationId),
            eq(medications.userId, userId),
            isNotNull(medications.inventoryCount),
          ),
        );

      if (previousCount !== null) {
        credited = applied;
        await recordInventoryEvent(tx, {
          userId,
          medicationId,
          eventType: "dose_deleted",
          quantityChange: applied,
          previousCount,
          newCount: previousCount + applied,
        });
      }
    }

    // 5. Keep the dose for Undo: every stored column except `updatedAt`,
    //    which a restore rewrites. Purge first, so the trash stays bounded.
    if (opts.keepForUndo) {
      await purgeExpiredTrash(tx, { now, userId });
      const { updatedAt: _updatedAt, ...kept } = deleted;
      await tx
        .insert(doseLogTrash)
        .values({ ...kept, inventoryCredited: credited, deletedAt: now });
    }

    // 6. The sync tombstone and the audit row. The audit row carries no diff,
    //    so no note text reaches the audit log, which is synced and never
    //    purged.
    await tx.insert(syncTombstones).values({
      id: createId(),
      userId,
      entityType: "dose_log",
      entityId: doseId,
    });
    await logAudit(userId, "dose_log", doseId, "delete", undefined, tx);

    return { doseId, medicationId, deletedAt: now };
  });
}

export type RestoreOutcome = "restored" | "already_restored" | "gone" | "logged_since";

/**
 * A delete's Undo: move the trashed dose back into `dose_logs` under the SAME
 * id, and take its stock again.
 *
 * The token is `(doseId, deletedAt)`, exactly what `deleteDose` returned, so
 * an out-of-date Undo cannot reverse a newer delete of the same dose (D6).
 * The outcomes:
 *
 * - `restored`: the dose is back.
 * - `already_restored`: there is no trash row for the token, but the dose is
 *   live. This is a retried Undo whose first attempt landed, and the action
 *   answers it as success.
 * - `gone`: there is no trash row and no live dose (it was purged, wiped, or
 *   its medication was deleted), or the 10-minute window has closed.
 * - `logged_since`: a dose of this medication was LOGGED after the delete.
 *   Restoring then would record two doses for one slot and take stock twice
 *   (Remove 08:00, Log now at 08:40, Undo). The trash row stays.
 *
 * **Lock order (D7).** The medication row is locked first, then the trash
 * row. The clock is read after the medication lock, so it orders correctly
 * against every `loggedAt` and `deletedAt` written under that lock.
 *
 * **Stock.** It takes back what the delete CREDITED (`inventoryCredited`),
 * clamped at what is there now. It never uses `inventoryApplied` or
 * `quantity`. A dose deleted while tracking was off credited nothing, so
 * restoring it once tracking is back takes nothing. Using `inventoryApplied`
 * there would take stock that was never given back.
 *
 * **Tombstones.** Every tombstone for the dose is deleted, not just the
 * latest. The Mac app applies upserts before tombstones within one delta,
 * so a survivor would delete the restored dose there for good.
 *
 * **Audit.** The audit row carries no diff, so the dose's notes never reach
 * the synced, never-purged audit log.
 *
 * `now` is for tests. Production callers omit it, and the clock is read after
 * the lock.
 */
export async function restoreDose(
  userId: string,
  doseId: string,
  deletedAt: Date,
  now?: Date,
): Promise<RestoreOutcome> {
  return dbTx.transaction(async (tx): Promise<RestoreOutcome> => {
    const trashKey = and(
      eq(doseLogTrash.id, doseId),
      eq(doseLogTrash.userId, userId),
      eq(doseLogTrash.deletedAt, deletedAt),
    );

    // No trash row under this token. If the dose is live, an earlier restore
    // of it landed; otherwise it is gone for good.
    const noTrashRow = async (): Promise<RestoreOutcome> => {
      const [live] = await tx
        .select({ id: doseLogs.id })
        .from(doseLogs)
        .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
        .limit(1);
      return live ? "already_restored" : "gone";
    };

    // 1. Find which medication to lock. This read needs no lock, because a
    //    dose's medication never changes.
    const [found] = await tx
      .select({ medicationId: doseLogTrash.medicationId })
      .from(doseLogTrash)
      .where(trashKey)
      .limit(1);
    if (!found) return noTrashRow();

    // 2. Lock the medication first (D7), then read the clock.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, found.medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const at = now ?? new Date();

    // 3. Then lock the trash row. If it has gone, a concurrent restore or a
    //    cascade took it while this one waited.
    const [trash] = await tx.select().from(doseLogTrash).where(trashKey).limit(1).for("update");
    if (!trash) return noTrashRow();

    // 4. The window. "Expired" is `deleted_at <= now − window`, the same
    //    rule `purgeExpiredTrash` uses. This call already holds the row's
    //    lock, so it deletes the expired row itself instead of leaving it
    //    for a purge.
    if (trash.deletedAt.getTime() <= at.getTime() - DOSE_UNDO_WINDOW_MS) {
      await tx.delete(doseLogTrash).where(trashKey);
      return "gone";
    }

    // 5. The since-delete guard. Both clocks are the app's, and both were
    //    read under this medication's lock, so for one medication `loggedAt`
    //    order is commit order. The trash row stays: another Undo of it is
    //    refused the same way.
    const [loggedSince] = await tx
      .select({ id: doseLogs.id })
      .from(doseLogs)
      .where(
        and(
          eq(doseLogs.userId, userId),
          eq(doseLogs.medicationId, trash.medicationId),
          gt(doseLogs.loggedAt, trash.deletedAt),
        ),
      )
      .limit(1);
    if (loggedSince) return "logged_since";

    // 6. Take it out of the trash.
    await tx.delete(doseLogTrash).where(trashKey);

    // 7. Take the stock again: what the delete credited, clamped at what is
    //    there now. Skipped and missed entries never took any.
    const inventoryApplied =
      trash.status === "taken"
        ? await takeFromStock(tx, {
            userId,
            medicationId: trash.medicationId,
            previousCount: med?.inventoryCount ?? null,
            amount: trash.inventoryCredited,
            eventType: "dose_restored",
          })
        : trash.inventoryApplied;

    // 8. Re-insert the same id with every stored field, the original
    //    loggedAt included, so that a later restore's since-delete guard does
    //    not mistake this row for a new log. `updatedAt` moves, so delta sync
    //    sends the dose again.
    await tx.insert(doseLogs).values({
      id: trash.id,
      userId,
      medicationId: trash.medicationId,
      quantity: trash.quantity,
      inventoryApplied,
      takenAt: trash.takenAt,
      loggedAt: trash.loggedAt,
      notes: trash.notes,
      sideEffects: trash.sideEffects,
      status: trash.status,
      updatedAt: at,
    });

    // 9. Delete every tombstone for it. The table has no uniqueness, so
    //    there can be more than one.
    await tx
      .delete(syncTombstones)
      .where(
        and(
          eq(syncTombstones.userId, userId),
          eq(syncTombstones.entityType, "dose_log"),
          eq(syncTombstones.entityId, doseId),
        ),
      );

    // 10. Purge this user's expired trash, then audit with no diff.
    await purgeExpiredTrash(tx, { now: at, userId });
    await logAudit(userId, "dose_log", doseId, "restore", undefined, tx);

    return "restored";
  });
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
  // Everything in one transaction, in D7 order: the medication row, then the
  // dose row. The dose used to be read BEFORE the transaction, without a
  // lock, and two things got through that gap. A Remove that committed
  // there left the UPDATE below with no row, and
  // `computeChanges(existing, undefined)` threw: a 500 on Save. A Remove
  // followed by its Undo re-inserted the dose with a recomputed
  // `inventoryApplied`, and the edit then moved stock by the stale amount.
  // Every value this edit computes from is now read under both locks.
  return dbTx.transaction(async (tx) => {
    // Which medication to lock. `medicationId` never changes, so this read
    // needs no lock of its own.
    const [ref] = await tx
      .select({ medicationId: doseLogs.medicationId })
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1);
    if (!ref) return null;

    // The count as it stands before this edit, under the lock that every
    // other stock writer also takes first.
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, ref.medicationId), eq(medications.userId, userId)))
      .limit(1)
      .for("update");
    const previousCount = med?.inventoryCount ?? null;

    // Re-read the dose under its own lock. A delete may have committed while
    // this transaction waited for the medication, and that has to end here,
    // before anything is written.
    const [existing] = await tx
      .select()
      .from(doseLogs)
      .where(and(eq(doseLogs.id, doseId), eq(doseLogs.userId, userId)))
      .limit(1)
      .for("update");
    if (!existing) return null;

    // Only taken doses ever decremented inventory, so only taken doses
    // get a quantity-diff adjustment. Editing a skipped dose's quantity
    // is bookkeeping only.
    const inventoryAffectingChange =
      existing.status === "taken" &&
      updates.quantity !== undefined &&
      updates.quantity !== existing.quantity;

    // The inventory arm is computed first: it decides the `inventoryApplied`
    // the row is written with. Its write runs after the row's, once the row
    // is known to still be there.
    let nextApplied: number | undefined;
    let inventoryWrite: (() => Promise<void>) | undefined;

    if (inventoryAffectingChange) {
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

    // Unreachable while the row is locked above. Kept so that a later change
    // to that read cannot turn a vanished row back into a stock write for a
    // dose that no longer exists, or into `computeChanges(existing,
    // undefined)`, which throws.
    if (!u) return null;

    if (inventoryWrite) await inventoryWrite();

    const changes = computeChanges(existing, u);
    if (changes) await logAudit(userId, "dose_log", doseId, "update", changes, tx);

    return u;
  });
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
