import { dbTx } from "$lib/server/db";
import { doseLogTrash, doseLogs, medications, users } from "$lib/server/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import { logAudit } from "$lib/server/audit";

// Bulk wipes used by both the web "Settings > Privacy" data-wipe actions
// and the /api/v1/commands `wipe_dose_history` / `wipe_archived_medications`
// command handlers. Native clients cannot delta-sync a bulk delete (there's
// no per-row tombstone), so both wipes bump `users.syncEpoch` inside the
// same transaction as the delete — the sync endpoint compares a client's
// last-seen epoch and forces a full resync when it's behind, which is the
// only way a client can learn "a lot of rows disappeared at once".
//
// The delete + epoch bump + audit row all happen inside a single
// `dbTx.transaction` so they commit or roll back together: an audit entry
// must never exist for a wipe that didn't actually happen (and vice versa),
// and a command retry must never see a torn state where the epoch was
// bumped without the corresponding rows actually being gone.
export async function wipeDoseHistory(userId: string): Promise<{ deleted: number }> {
  return dbTx.transaction(async (tx) => {
    // D7: every medication row first, in ascending id order like any
    // multi-row lock. Each delete and restore locks its medication before it
    // touches a dose or a trash row, so holding all of them makes this wipe
    // wait for any in flight and shuts out any that would start. Without it
    // a restore could commit after the DELETE below had taken its snapshot,
    // and bring a dose back into a history the user had just wiped.
    await tx
      .select({ id: medications.id })
      .from(medications)
      .where(eq(medications.userId, userId))
      .orderBy(asc(medications.id))
      .for("update");

    const rows = await tx
      .delete(doseLogs)
      .where(eq(doseLogs.userId, userId))
      .returning({ id: doseLogs.id });
    const deleted = rows.length;

    // The Undo copies go too. A wiped history must not be restorable, and
    // the trash would otherwise keep the deleted doses' notes on the server
    // until the retention sweep. Not counted in `deleted`, which is the
    // history the user could see.
    await tx.delete(doseLogTrash).where(eq(doseLogTrash.userId, userId));

    await tx
      .update(users)
      .set({ syncEpoch: sql`${users.syncEpoch} + 1` })
      .where(eq(users.id, userId));

    await logAudit(userId, "dose_log", "*", "delete", { deleted: { from: deleted, to: 0 } }, tx);

    return { deleted };
  });
}

export async function wipeArchivedMedications(userId: string): Promise<{ deleted: number }> {
  return dbTx.transaction(async (tx) => {
    // Cascading FKs on dose_logs, medication_schedules and the dose trash
    // (the Undo copies of deleted doses) drop the dependent rows when the
    // medication row goes.
    const rows = await tx
      .delete(medications)
      .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
      .returning({ id: medications.id });
    const deleted = rows.length;

    await tx
      .update(users)
      .set({ syncEpoch: sql`${users.syncEpoch} + 1` })
      .where(eq(users.id, userId));

    await logAudit(
      userId,
      "medication",
      "*",
      "delete",
      {
        deleted: { from: deleted, to: 0 },
        filter: { from: null, to: "archived" },
      },
      tx,
    );

    return { deleted };
  });
}
