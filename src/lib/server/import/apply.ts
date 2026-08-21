// The only module in the import pipeline that writes.
//
// It executes a plan and makes no decisions: what to create, reuse or
// skip was already settled by `plan.ts`, so the preview the user
// approved is exactly what lands.
//
// Deliberately NOT built on createMedicationWithSchedules / logDose /
// recordInventoryEvent, for four reasons:
//
//   1. Those paths can't set `startedAt` / `effectiveFrom`, so every
//      imported medication would look like it was created today and
//      analytics would score the entire back-catalogue as "not expected
//      yet" — wrong adherence, wrong heatmap, wrong expected counts.
//   2. `logDose` decrements `inventoryCount`, but a backup already
//      carries the post-decrement value. Replaying doses through it
//      double-decrements.
//   3. `logDose` / `logSkippedDose` cannot write `status: "missed"`.
//   4. One `dbTx.transaction` and one `audit_logs` row per record: a
//      2000-dose import would be 2000 transactions (Vercel timeout) and
//      would bury the user's real audit history.
//
// Instead: bulk inserts, one transaction, one audit row.
import { createId } from "@paralleldrive/cuid2";
import { eq, sql } from "drizzle-orm";
import { dbTx } from "$lib/server/db";
import {
  doseLogs,
  inventoryEvents,
  medicationSchedules,
  medications,
  userPreferences,
  users,
} from "$lib/server/db/schema";
import { logAudit } from "$lib/server/audit";
import type { ImportPlan, ImportResult } from "./types";

/** Postgres caps a statement at 65535 bound parameters. The widest row
 * here is ~20 columns, so 500 rows per statement stays far clear while
 * keeping the number of round-trips low. */
const INSERT_CHUNK = 500;

function chunk<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export async function applyImport(userId: string, plan: ImportPlan): Promise<ImportResult> {
  const importId = createId();
  const now = new Date();

  await dbTx.transaction(async (tx) => {
    if (plan.mode === "replace") {
      // Cascading FKs on medication_schedules, dose_logs and
      // inventory_events drop every dependent row when the medication
      // goes, and dose_logs.medicationId is NOT NULL — so there is no
      // dose that can outlive its medication.
      await tx.delete(medications).where(eq(medications.userId, userId));
    }

    // --- medications + schedules -------------------------------------
    // `userId` is taken from the session on every row. The file's own
    // userId was already stripped at parse time, but re-deriving here
    // means no future change to the parser can leak one through.
    const idByRef = new Map<string, string>();
    const medicationRows: (typeof medications.$inferInsert)[] = [];
    const scheduleRows: (typeof medicationSchedules.$inferInsert)[] = [];

    for (const planned of plan.medications) {
      if (planned.action === "reuse") {
        idByRef.set(planned.ref, planned.existingId!);
        continue;
      }
      if (planned.action === "skip") continue;

      const medicationId = createId();
      idByRef.set(planned.ref, medicationId);
      const source = planned.source;
      const startedAt = source.startedAt ?? now;

      medicationRows.push({
        id: medicationId,
        userId,
        name: source.name,
        dosageAmount: source.dosageAmount,
        dosageUnit: source.dosageUnit,
        form: source.form,
        category: source.category,
        colour: source.colour,
        colourSecondary: source.colourSecondary,
        pattern: source.pattern,
        notes: source.notes,
        // Deprecated but still load-bearing: `dailyRateFor` falls back to
        // these when a medication has no schedule rows, and dropping them
        // would silently change refill forecasts and the due badges.
        scheduleType: source.scheduleType,
        scheduleIntervalHours: source.scheduleIntervalHours,
        inventoryCount: plan.sections.inventory ? source.inventoryCount : null,
        inventoryAlertThreshold: plan.sections.inventory ? source.inventoryAlertThreshold : null,
        sortOrder: source.sortOrder,
        isArchived: source.isArchived,
        archivedAt: source.isArchived ? (source.archivedAt ?? now) : null,
        startedAt,
        endedAt: source.endedAt,
        notificationsEnabled: source.notificationsEnabled ?? true,
        notifyOverdueEmail: source.notifyOverdueEmail ?? null,
        notifyOverduePush: source.notifyOverduePush ?? null,
        notifyLowInventoryEmail: source.notifyLowInventoryEmail ?? null,
        notifyLowInventoryPush: source.notifyLowInventoryPush ?? null,
        notifyOffsetMinutes: source.notifyOffsetMinutes ?? 0,
        notifyRepeatEveryMinutes: source.notifyRepeatEveryMinutes ?? null,
        notifyMaxRepeats: source.notifyMaxRepeats ?? 3,
      });

      source.schedules.forEach((schedule, index) => {
        scheduleRows.push({
          id: createId(),
          medicationId,
          userId,
          scheduleKind: schedule.scheduleKind,
          timeOfDay: schedule.timeOfDay,
          intervalHours: schedule.intervalHours,
          daysOfWeek: schedule.daysOfWeek,
          sortOrder: schedule.sortOrder || index,
          // Back-dated with the medication so a schedule change history
          // doesn't start "today" for data that's months old.
          effectiveFrom: schedule.effectiveFrom ?? startedAt,
          effectiveTo: schedule.effectiveTo,
        });
      });
    }

    for (const batch of chunk(medicationRows, INSERT_CHUNK)) {
      await tx.insert(medications).values(batch);
    }
    for (const batch of chunk(scheduleRows, INSERT_CHUNK)) {
      await tx.insert(medicationSchedules).values(batch);
    }

    // --- dose logs ---------------------------------------------------
    const doseRows: (typeof doseLogs.$inferInsert)[] = [];
    for (const planned of plan.doses) {
      if (planned.action !== "create") continue;
      const medicationId = planned.medicationRef ? idByRef.get(planned.medicationRef) : undefined;
      if (!medicationId) continue;

      doseRows.push({
        id: createId(),
        userId,
        medicationId,
        quantity: planned.source.quantity,
        takenAt: planned.source.takenAt,
        // Falls back to takenAt rather than now: the CSV carries no
        // logged-at, and dating it "today" would make every imported row
        // look like it was recorded during the import.
        loggedAt: planned.source.loggedAt ?? planned.source.takenAt,
        notes: planned.source.notes,
        sideEffects: planned.source.sideEffects,
        status: planned.source.status,
      });
    }
    for (const batch of chunk(doseRows, INSERT_CHUNK)) {
      await tx.insert(doseLogs).values(batch);
    }

    // --- inventory events --------------------------------------------
    // Only ever for medications this import created; the planner refuses
    // to touch an existing medication's ledger.
    const eventRows: (typeof inventoryEvents.$inferInsert)[] = [];
    for (const planned of plan.inventoryEvents) {
      if (planned.action !== "create") continue;
      const medicationId = planned.medicationRef ? idByRef.get(planned.medicationRef) : undefined;
      if (!medicationId) continue;

      eventRows.push({
        id: createId(),
        userId,
        medicationId,
        eventType: planned.source.eventType,
        quantityChange: planned.source.quantityChange,
        previousCount: planned.source.previousCount,
        newCount: planned.source.newCount,
        note: planned.source.note,
        createdAt: planned.source.createdAt,
      });
    }
    for (const batch of chunk(eventRows, INSERT_CHUNK)) {
      await tx.insert(inventoryEvents).values(batch);
    }

    // --- preferences + profile ---------------------------------------
    if (plan.preferences) {
      await tx
        .insert(userPreferences)
        .values({ userId, ...plan.preferences, updatedAt: now })
        .onConflictDoUpdate({
          target: userPreferences.userId,
          set: { ...plan.preferences, updatedAt: now },
        });
    }

    // Name and timezone only. Email, password, TOTP secret and the 2FA
    // and verification flags are never modelled by the parser, so a file
    // cannot rewrite who the importer is.
    if (plan.profile) {
      await tx
        .update(users)
        .set({ name: plan.profile.name, timezone: plan.profile.timezone, updatedAt: now })
        .where(eq(users.id, userId));
    }

    // --- sync epoch ---------------------------------------------------
    // Native clients can't delta-sync a bulk write (and replace mode
    // deletes rows with no per-row tombstone). Bumping the epoch forces a
    // full resync, which is the only way a client learns that a lot
    // changed at once. Same mechanism as api/wipe.ts.
    await tx
      .update(users)
      .set({ syncEpoch: sql`${users.syncEpoch} + 1` })
      .where(eq(users.id, userId));

    // One row, not one per record — a 2000-dose import must not drown
    // the user's real audit history. `computeChanges` shape kept so the
    // existing audit CSV export renders it without special-casing.
    await logAudit(
      userId,
      "data_import",
      importId,
      "create",
      {
        format: { from: null, to: plan.format },
        mode: { from: null, to: plan.mode },
        medicationsCreated: { from: 0, to: plan.summary.medicationsCreated },
        medicationsReused: { from: 0, to: plan.summary.medicationsReused },
        schedulesCreated: { from: 0, to: plan.summary.schedulesCreated },
        dosesCreated: { from: 0, to: plan.summary.dosesCreated },
        dosesSkipped: { from: 0, to: plan.summary.dosesSkipped },
        inventoryEventsCreated: { from: 0, to: plan.summary.inventoryEventsCreated },
        medicationsDeleted: { from: plan.summary.medicationsDeleted, to: 0 },
        dosesDeleted: { from: plan.summary.dosesDeleted, to: 0 },
        profileUpdated: { from: false, to: plan.summary.profileUpdated },
        preferencesUpdated: { from: false, to: plan.summary.preferencesUpdated },
      },
      tx,
    );
  });

  return { importId, summary: plan.summary };
}
