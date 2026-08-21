// Reminder event retention.
//
// reminder_events is an audit trail, not state: a dedupe key only needs
// to outlive its slot (see claimReminderSlot in dispatch.ts). Phase 2's
// repeat-until-acted policy mints up to maxRepeats + 1 rows per slot
// instead of one, so the table's growth rate stopped being negligible.

import { lt } from "drizzle-orm";
import { db } from "$lib/server/db";
import { reminderEvents } from "$lib/server/db/schema";

export const REMINDER_EVENT_RETENTION_DAYS = 90;

/**
 * Delete reminder_events rows whose sentAt is strictly older than
 * `now - REMINDER_EVENT_RETENTION_DAYS` days.
 *
 * `now` is a parameter rather than a `Date.now()` read so the retention
 * boundary is testable without faking the clock.
 *
 * The comparison is `lt`, not `lte`: a row exactly at the cutoff survives
 * one more pass rather than racing the cron tick's own clock skew.
 *
 * On NULL sentAt: `sentAt` is NOT NULL with defaultNow() (schema.ts) and
 * is stamped the moment a slot is claimed, not when a send completes —
 * so a row can't actually have a NULL sentAt today. Even so, `lt` is
 * NULL-safe by construction: SQL's `NULL < x` is unknown, not true, so a
 * hypothetical NULL row would never match this predicate and would be
 * left behind rather than silently swept. That's the correct behaviour
 * for a claimed-but-never-completed row — it's audit evidence for a
 * stuck dispatch, not expired history — and it's recorded here
 * deliberately so a future reader doesn't have to rediscover it.
 */
export async function purgeExpiredReminderEvents(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - REMINDER_EVENT_RETENTION_DAYS * 86_400_000);
  await db.delete(reminderEvents).where(lt(reminderEvents.sentAt, cutoff));
}
