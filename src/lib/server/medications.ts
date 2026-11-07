import { createId } from "@paralleldrive/cuid2";
import { eq, and, sql, max, inArray } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { auditLogs, medications, doseLogs, medicationSchedules } from "$lib/server/db/schema";
import { logAudit, computeChanges } from "./audit";
import { buildScheduleRows, MedicationOwnershipError, getSchedulesForUser } from "./schedules";
import type { MedicationSchedule } from "./schedules";
import { dailyRateFor, daysUntilRefill } from "./inventory";
import { expectedPerDayForSchedules } from "./analytics";
import { intervalDosesPerDay } from "$lib/utils/schedule-rate";
import type { MedicationInput, ScheduleInput } from "$lib/utils/validation";
import type { Medication, MedicationWithStats } from "$lib/types";

/**
 * The one display order for a user's medications: `sortOrder`, then creation
 * time, then id. The tie-breaks are load-bearing, not cosmetic. Medications
 * created before `createMedicationWithSchedules` assigned a position all hold
 * the column default 0, and with `sortOrder` alone their order was whatever
 * the planner returned — so ↑/↓ had no stable list to move within.
 * `swapSortOrder` renumbers by exactly this order.
 */
const DISPLAY_ORDER = [medications.sortOrder, medications.createdAt, medications.id] as const;

export async function getActiveMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.isArchived, false)))
    .orderBy(...DISPLAY_ORDER);
}

// Lean list of every medication (active first, then archived) for
// filter UIs — includes archived meds so historical ranges stay
// analysable.
export async function getMedicationOptions(userId: string) {
  return db
    .select({
      id: medications.id,
      name: medications.name,
      colour: medications.colour,
      isArchived: medications.isArchived,
    })
    .from(medications)
    .where(eq(medications.userId, userId))
    .orderBy(medications.isArchived, medications.sortOrder, medications.name);
}

export async function getMedicationsWithStats(userId: string): Promise<MedicationWithStats[]> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [meds, schedulesByMed] = await Promise.all([
    getActiveMedications(userId),
    getSchedulesForUser(userId),
  ]);
  if (meds.length === 0) return [];

  // Scope to active meds so archived rows don't hit the aggregate.
  // Taken doses only — skipped/missed rows never consumed inventory
  // and must not move "last taken" or the adherence numerator. Sum
  // quantity, not rows: a ×3 log is three doses (CLAUDE.md gotcha),
  // matching how inventory.ts and the sparkline already count.
  const medIds = meds.map((m) => m.id);
  const stats = await db
    .select({
      medicationId: doseLogs.medicationId,
      lastTakenAt: max(doseLogs.takenAt),
      weeklyDoseCount: sql<number>`coalesce(sum(CASE WHEN ${doseLogs.takenAt} >= ${sevenDaysAgo} THEN ${doseLogs.quantity} ELSE 0 END), 0)::int`,
      thirtyDayDoseCount: sql<number>`coalesce(sum(CASE WHEN ${doseLogs.takenAt} >= ${thirtyDaysAgo} THEN ${doseLogs.quantity} ELSE 0 END), 0)::int`,
    })
    .from(doseLogs)
    .where(
      and(
        eq(doseLogs.userId, userId),
        inArray(doseLogs.medicationId, medIds),
        eq(doseLogs.status, "taken"),
      ),
    )
    .groupBy(doseLogs.medicationId);

  const statsMap = new Map(
    stats.map((s) => [
      s.medicationId,
      {
        lastTakenAt: s.lastTakenAt ? new Date(s.lastTakenAt) : null,
        weeklyDoseCount: Number(s.weeklyDoseCount),
        thirtyDayDoseCount: Number(s.thirtyDayDoseCount),
      },
    ]),
  );

  return meds.map((med) =>
    medicationStatsFor(med, schedulesByMed.get(med.id), statsMap.get(med.id)),
  );
}

/**
 * Pure per-medication stats assembly. daysUntilRefill goes through
 * inventory.ts's dailyRateFor — the single source of truth (schedule
 * rows first, legacy interval column next, 30-day history for PRN) —
 * instead of only the deprecated legacy columns, which are null for
 * fixed-time medications. expectedDailyDoses is the scheduled rate
 * for the adherence denominator; null when the med has no scheduled
 * rate (PRN), so the card renders no adherence bar.
 */
export function medicationStatsFor(
  med: Medication,
  schedules: MedicationSchedule[] | undefined,
  s: { lastTakenAt: Date | null; weeklyDoseCount: number; thirtyDayDoseCount: number } | undefined,
): MedicationWithStats {
  const thirtyDayDoseCount = s?.thirtyDayDoseCount ?? 0;
  const dailyRate = dailyRateFor(
    schedules,
    med.scheduleType,
    med.scheduleIntervalHours,
    thirtyDayDoseCount,
  );

  const scheduledRate = schedules ? expectedPerDayForSchedules(schedules) : 0;
  const legacyRate =
    med.scheduleType === "scheduled" ? intervalDosesPerDay(med.scheduleIntervalHours) : 0;

  return {
    ...med,
    lastTakenAt: s?.lastTakenAt ?? null,
    weeklyDoseCount: s?.weeklyDoseCount ?? 0,
    avgDailyConsumption: thirtyDayDoseCount / 30,
    daysUntilRefill: daysUntilRefill(med.inventoryCount, dailyRate),
    expectedDailyDoses: scheduledRate > 0 ? scheduledRate : legacyRate > 0 ? legacyRate : null,
  };
}

export async function getMedicationById(userId: string, id: string) {
  const [med] = await db
    .select()
    .from(medications)
    .where(and(eq(medications.id, id), eq(medications.userId, userId)))
    .limit(1);
  return med ?? null;
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
        notificationsEnabled: input.notificationsEnabled ?? true,
        notifyOverdueEmail: input.notifyOverdueEmail ?? null,
        notifyOverduePush: input.notifyOverduePush ?? null,
        notifyLowInventoryEmail: input.notifyLowInventoryEmail ?? null,
        notifyLowInventoryPush: input.notifyLowInventoryPush ?? null,
        notifyOffsetMinutes: input.notifyOffsetMinutes ?? 0,
        notifyRepeatEveryMinutes: input.notifyRepeatEveryMinutes ?? null,
        notifyMaxRepeats: input.notifyMaxRepeats ?? 3,
        // Append to the end of the user's list. Left at the column default,
        // every medication created here shared position 0.
        sortOrder: sql`(select coalesce(max(${medications.sortOrder}), -1) + 1 from ${medications} where ${medications.userId} = ${userId})`,
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

/**
 * Update a medication and replace its schedule rows in a single
 * transaction. Mirrors createMedicationWithSchedules for the edit
 * flow: the earlier pair of non-transactional helpers (both since
 * deleted) ran in two separate transactions, so a failure between them
 * could leave the medication row updated against stale schedules (or
 * fresh schedules under an unchanged medication on partial rollback).
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
        notificationsEnabled: input.notificationsEnabled ?? true,
        notifyOverdueEmail: input.notifyOverdueEmail ?? null,
        notifyOverduePush: input.notifyOverduePush ?? null,
        notifyLowInventoryEmail: input.notifyLowInventoryEmail ?? null,
        notifyLowInventoryPush: input.notifyLowInventoryPush ?? null,
        notifyOffsetMinutes: input.notifyOffsetMinutes ?? 0,
        notifyRepeatEveryMinutes: input.notifyRepeatEveryMinutes ?? null,
        notifyMaxRepeats: input.notifyMaxRepeats ?? 3,
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

/**
 * Swap two medications' places in the user's list.
 *
 * Swapping the two rows' `sortOrder` values was not enough: medications that
 * share a value (every one created before positions were assigned holds 0)
 * swapped 0 for 0, so the move silently did nothing. Instead, under the
 * medication locks, the user's whole list is put in display order, the two
 * entries trade places, and each row is written its index. That also repairs
 * existing ties the first time the user reorders, with no data migration.
 *
 * Locks follow the dose/stock lock order: the user's medication rows, in
 * ascending id. Every write is scoped by `userId`. Returns whether the move
 * happened (false when either id is not one of this user's medications).
 */
export async function swapSortOrder(userId: string, medId1: string, medId2: string) {
  if (medId1 === medId2) return false;
  return dbTx.transaction(async (tx) => {
    const rows = await tx
      .select({
        id: medications.id,
        sortOrder: medications.sortOrder,
        createdAt: medications.createdAt,
      })
      .from(medications)
      .where(eq(medications.userId, userId))
      .orderBy(medications.id)
      .for("update");

    const ordered = [...rows].sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.createdAt.getTime() - b.createdAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    const i = ordered.findIndex((m) => m.id === medId1);
    const j = ordered.findIndex((m) => m.id === medId2);
    if (i < 0 || j < 0) return false;
    [ordered[i], ordered[j]] = [ordered[j], ordered[i]];

    for (const [index, m] of ordered.entries()) {
      if (m.sortOrder === index) continue;
      await tx
        .update(medications)
        .set({ sortOrder: index })
        .where(and(eq(medications.id, m.id), eq(medications.userId, userId)));
    }
    return true;
  });
}

/**
 * Archive and unarchive are transitions, not assignments: each one matches
 * only a row in the opposite state, and writes its audit row in the same
 * transaction, only when a row actually moved.
 *
 * Both halves matter. `lifecycleEnd` closes the expected-doses window at
 * `archivedAt`, so a second archive (a stale tab, a double submit, a replayed
 * /api/v1 command) that re-stamped it would charge every day in between as
 * expected and show it as Missed. And /api/v1's `runCommands` releases a
 * command's reservation when its handler throws, so a handler must leave no
 * write behind when it fails: an UPDATE that committed before a failed audit
 * insert was retried, and the retry re-stamped `archivedAt`.
 */
export async function archiveMedication(userId: string, id: string) {
  await dbTx.transaction(async (tx) => {
    const now = new Date();
    const moved = await tx
      .update(medications)
      .set({ isArchived: true, archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(medications.id, id),
          eq(medications.userId, userId),
          eq(medications.isArchived, false),
        ),
      )
      .returning({ id: medications.id });
    if (moved.length === 0) return;
    await logAudit(
      userId,
      "medication",
      id,
      "update",
      { isArchived: { from: false, to: true } },
      tx,
    );
  });
}

export async function unarchiveMedication(userId: string, id: string) {
  await dbTx.transaction(async (tx) => {
    const moved = await tx
      .update(medications)
      .set({ isArchived: false, archivedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(medications.id, id),
          eq(medications.userId, userId),
          eq(medications.isArchived, true),
        ),
      )
      .returning({ id: medications.id });
    if (moved.length === 0) return;
    await logAudit(
      userId,
      "medication",
      id,
      "update",
      { isArchived: { from: true, to: false } },
      tx,
    );
  });
}

export async function getArchivedMedications(userId: string) {
  return db
    .select()
    .from(medications)
    .where(and(eq(medications.userId, userId), eq(medications.isArchived, true)))
    .orderBy(medications.name);
}
