// Read-only view of the target account, used by the planner for
// duplicate detection. Separated from plan.ts so the planner stays pure
// and testable without a database.
import { asc, count, eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, inventoryEvents, medications } from "$lib/server/db/schema";
import { doseKey, inventoryEventKey, type AccountSnapshot, type ImportMode } from "./types";

/**
 * @param mode In `replace` the account is wiped before anything is
 * written, so per-row dedupe keys can never match. Loading them would
 * mean pulling every dose row for nothing, so only the counts needed for
 * the "this will delete N rows" preview are fetched.
 */
export async function loadAccountSnapshot(
  userId: string,
  mode: ImportMode,
): Promise<AccountSnapshot> {
  const medRows = await db
    .select({
      id: medications.id,
      name: medications.name,
      isArchived: medications.isArchived,
      sortOrder: medications.sortOrder,
    })
    .from(medications)
    .where(eq(medications.userId, userId))
    .orderBy(asc(medications.isArchived), asc(medications.sortOrder));

  const maxSortOrder = medRows.reduce((max, row) => Math.max(max, row.sortOrder), -1);
  const base = {
    medications: medRows.map(({ id, name, isArchived }) => ({ id, name, isArchived })),
    maxSortOrder,
  };

  if (mode === "replace") {
    const [row] = await db
      .select({ value: count() })
      .from(doseLogs)
      .where(eq(doseLogs.userId, userId));
    return {
      ...base,
      doseKeys: new Set<string>(),
      inventoryEventKeys: new Set<string>(),
      existingDoseCount: row?.value ?? 0,
    };
  }

  const [doseRows, eventRows] = await Promise.all([
    db
      .select({
        medicationId: doseLogs.medicationId,
        takenAt: doseLogs.takenAt,
        status: doseLogs.status,
        quantity: doseLogs.quantity,
      })
      .from(doseLogs)
      .where(eq(doseLogs.userId, userId)),
    db
      .select({
        medicationId: inventoryEvents.medicationId,
        createdAt: inventoryEvents.createdAt,
        eventType: inventoryEvents.eventType,
        quantityChange: inventoryEvents.quantityChange,
      })
      .from(inventoryEvents)
      .where(eq(inventoryEvents.userId, userId)),
  ]);

  return {
    ...base,
    // Both precisions, so whichever the source format calls for is
    // already present without a second pass over the table.
    doseKeys: new Set(
      doseRows.flatMap((row) => [
        doseKey(row.medicationId, new Date(row.takenAt), row.status, row.quantity, "exact"),
        doseKey(row.medicationId, new Date(row.takenAt), row.status, row.quantity, "minute"),
      ]),
    ),
    inventoryEventKeys: new Set(
      eventRows.map((row) =>
        inventoryEventKey(
          row.medicationId,
          new Date(row.createdAt),
          row.eventType,
          row.quantityChange,
        ),
      ),
    ),
    existingDoseCount: doseRows.length,
  };
}
