// Reminder dispatch primitives.
//
// claimReminderSlot atomically claims an attempt to send a reminder
// identified by its dedupe key. It returns the row id and the new
// attempt count when the caller owns the send for this run, or null
// when the row exists but is not retryable (already sent, max
// attempts reached, or the cooldown has not elapsed).
//
// completeReminder records the outcome of a dispatched attempt.
//
// The two together replace the previous "insert and pray" pattern
// where the existence of the row meant "the email/push call did not
// throw" — a row could exist while a reminder was, in fact, never
// delivered.

import { createId } from "@paralleldrive/cuid2";
import { eq, sql } from "drizzle-orm";
import { db } from "$lib/server/db";
import {
  reminderEvents,
  type ReminderChannelStatus,
  type ReminderStatus,
} from "$lib/server/db/schema";

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAY_MS = 30 * 60 * 1000;

export type ReminderType = "overdue" | "low_inventory";

export type Claim = { id: string; attemptCount: number };

export type CompleteInput = {
  emailStatus: ReminderChannelStatus;
  pushStatus: ReminderChannelStatus;
  lastError: string | null;
};

/**
 * Atomically claim an attempt to send the reminder identified by
 * `dedupeKey`. Returns `{ id, attemptCount }` when the caller owns the
 * send for this attempt, or `null` when the row exists but is not
 * retryable.
 *
 * Retryable when `attempt_count < MAX_ATTEMPTS` AND
 * `last_attempt_at < now() - RETRY_DELAY_MS` AND status is one of:
 *   - `failed`: explicit retry-after-cooldown, the original case.
 *   - `pending`: lease recovery. If a worker crashed mid-dispatch, the
 *     row would stay `pending` forever; treating a stale pending as
 *     abandoned (older than the same threshold) lets the next cron
 *     tick reclaim it instead of leaking the slot.
 */
export async function claimReminderSlot(input: {
  userId: string;
  medicationId: string;
  reminderType: ReminderType;
  dedupeKey: string;
}): Promise<Claim | null> {
  const id = createId();
  const retryThreshold = new Date(Date.now() - RETRY_DELAY_MS);

  // INSERT ... ON CONFLICT DO UPDATE WHERE <retryable>. When the row
  // already exists and the predicate is false, no row is returned and
  // the caller skips the attempt.
  const rows = await db
    .insert(reminderEvents)
    .values({
      id,
      userId: input.userId,
      medicationId: input.medicationId,
      reminderType: input.reminderType,
      dedupeKey: input.dedupeKey,
      status: "pending",
      attemptCount: 1,
    })
    .onConflictDoUpdate({
      target: reminderEvents.dedupeKey,
      set: {
        status: "pending",
        attemptCount: sql`${reminderEvents.attemptCount} + 1`,
        lastAttemptAt: sql`now()`,
        lastError: null,
      },
      setWhere: sql`(${reminderEvents.status} = 'failed' OR ${reminderEvents.status} = 'pending') AND ${reminderEvents.attemptCount} < ${MAX_ATTEMPTS} AND ${reminderEvents.lastAttemptAt} < ${retryThreshold}`,
    })
    .returning({ id: reminderEvents.id, attemptCount: reminderEvents.attemptCount });

  if (rows.length === 0) return null;
  return rows[0];
}

/**
 * Record the outcome of a dispatched attempt. The overall `status`
 * is derived from the channel statuses by `deriveOverallStatus`.
 */
export async function completeReminder(id: string, input: CompleteInput): Promise<void> {
  const status = deriveOverallStatus(input.emailStatus, input.pushStatus);
  await db
    .update(reminderEvents)
    .set({
      status,
      emailStatus: input.emailStatus,
      pushStatus: input.pushStatus,
      lastError: input.lastError,
      lastAttemptAt: new Date(),
    })
    .where(eq(reminderEvents.id, id));
}

/**
 * - `sent` if any configured channel succeeded, OR if no channel was
 *   configured (best-effort, nothing to retry).
 * - `failed` if at least one channel was configured and all
 *   configured channels failed.
 */
export function deriveOverallStatus(
  emailStatus: ReminderChannelStatus,
  pushStatus: ReminderChannelStatus,
): ReminderStatus {
  const channels = [emailStatus, pushStatus];
  const configured = channels.filter((s) => s !== "not_configured");
  if (configured.length === 0) return "sent";
  if (configured.some((s) => s === "sent")) return "sent";
  return "failed";
}
