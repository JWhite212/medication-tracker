import { createId } from "@paralleldrive/cuid2";
import { eq, and, desc } from "drizzle-orm";
import { db, dbTx } from "$lib/server/db";
import { inventoryEvents, medications, type InventoryEventType } from "$lib/server/db/schema";

export type { InventoryEventType };

// Drizzle's HTTP `db` and the websocket-pool transaction yielded by
// `dbTx.transaction` carry different driver-specific result types
// (NeonHttpQueryResult vs QueryResult). `Pick<typeof db, "insert">`
// only structurally matches the HTTP variant. Union both so callers
// inside a transaction can pass `tx` without a cast.
type DbTransaction = Parameters<Parameters<typeof dbTx.transaction>[0]>[0];
type InventoryClient = typeof db | DbTransaction;

export type RecordInventoryEventInput = {
  userId: string;
  medicationId: string;
  eventType: InventoryEventType;
  quantityChange: number;
  previousCount: number | null;
  newCount: number | null;
  note?: string | null;
};

/**
 * Append an inventory_events row using the supplied client (the
 * global `db` for autocommit, or a transaction yielded from
 * `dbTx.transaction` to compose inside another unit of work).
 *
 * Skipped doses do not decrement inventory and do not record an
 * event; callers gate at the call site.
 */
export async function recordInventoryEvent(
  client: InventoryClient,
  input: RecordInventoryEventInput,
): Promise<void> {
  await client.insert(inventoryEvents).values({
    id: createId(),
    userId: input.userId,
    medicationId: input.medicationId,
    eventType: input.eventType,
    quantityChange: input.quantityChange,
    previousCount: input.previousCount,
    newCount: input.newCount,
    note: input.note ?? null,
  });
}

/**
 * Most recent events for a medication, newest first. Scoped by both
 * userId and medicationId so a misuse cannot surface another user's
 * history via the FK.
 */
export async function getInventoryHistory(userId: string, medicationId: string, limit = 20) {
  return db
    .select({
      id: inventoryEvents.id,
      eventType: inventoryEvents.eventType,
      quantityChange: inventoryEvents.quantityChange,
      previousCount: inventoryEvents.previousCount,
      newCount: inventoryEvents.newCount,
      note: inventoryEvents.note,
      createdAt: inventoryEvents.createdAt,
    })
    .from(inventoryEvents)
    .where(and(eq(inventoryEvents.userId, userId), eq(inventoryEvents.medicationId, medicationId)))
    .orderBy(desc(inventoryEvents.createdAt))
    .limit(limit);
}

export class MedicationNotFoundError extends Error {
  constructor() {
    super("Medication not found or not owned by user");
    this.name = "MedicationNotFoundError";
  }
}

export class InvalidRefillQuantityError extends Error {
  constructor() {
    super("Refill quantity must be a positive integer");
    this.name = "InvalidRefillQuantityError";
  }
}

/**
 * Apply a refill: read the previous count, add `quantity`, append a
 * `refill` event. The whole sequence runs inside a single transaction
 * so the count and the event commit atomically.
 *
 * If the medication has no inventory tracking (`inventoryCount` is
 * null), the refill seeds the count to `quantity`.
 */
export async function refillMedication(
  userId: string,
  medicationId: string,
  quantity: number,
  note?: string | null,
): Promise<{ previousCount: number | null; newCount: number }> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new InvalidRefillQuantityError();
  }

  return dbTx.transaction(async (tx) => {
    const [med] = await tx
      .select({ inventoryCount: medications.inventoryCount })
      .from(medications)
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)))
      .limit(1);

    if (!med) throw new MedicationNotFoundError();

    const previousCount = med.inventoryCount;
    const newCount = (previousCount ?? 0) + quantity;

    await tx
      .update(medications)
      .set({ inventoryCount: newCount, updatedAt: new Date() })
      .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

    await recordInventoryEvent(tx, {
      userId,
      medicationId,
      eventType: "refill",
      quantityChange: quantity,
      previousCount,
      newCount,
      note: note ?? null,
    });

    return { previousCount, newCount };
  });
}
