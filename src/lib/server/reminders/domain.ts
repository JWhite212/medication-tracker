// Reminder-identity helpers.
//
// "Is this dose due?" no longer lives here — it is answered once, for every
// surface, by `$lib/utils/due`. What remains is the dedupe key: the string
// that identifies one reminder occasion so the dispatcher can claim it
// exactly once (ADR-0005).

export type ReminderType = "overdue" | "low_inventory";

/**
 * Identifies one overdue reminder occasion.
 *
 * `scheduleKind` and `scheduleId` are part of the key so two schedules on
 * the same medication cannot collide. A medication with no schedule rows
 * uses the synthetic id `legacy:{medicationId}` that `effectiveSchedules`
 * derives from its deprecated interval columns.
 */
export function buildOverdueDedupeKey(
  userId: string,
  medicationId: string,
  scheduleKind: string,
  scheduleId: string,
  nextDueAt: Date,
): string {
  return `${userId}:${medicationId}:overdue:${scheduleKind}:${scheduleId}:${nextDueAt.toISOString()}`;
}

export function buildLowInventoryDedupeKey(
  userId: string,
  medicationId: string,
  inventoryCount: number,
): string {
  return `${userId}:${medicationId}:low_inventory:${inventoryCount}`;
}
