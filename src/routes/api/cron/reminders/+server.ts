import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { timingSafeEqual } from "crypto";
import { lt } from "drizzle-orm";
import { checkOverdueMedications, checkLowInventoryMedications } from "$lib/server/reminders";
import { purgeExpiredReminderEvents } from "$lib/server/reminders/retention";
import { db } from "$lib/server/db";
import { passwordResetTokens, rateLimits } from "$lib/server/db/schema";
import type { RequestHandler } from "./$types";

// The reminder tick is sequential by design: reminders.ts awaits
// withReminderClaim once per medication in a `for` loop, and dispatch caps
// each send at SEND_TIMEOUT_MS (4s). Vercel's default function limit is 10s,
// so a tick where three medications all hit slow providers is killed
// mid-loop — and because the loop is ordered, it is always the same tail of
// medications that gets dropped, every tick, silently. Raising the ceiling
// does not make a slow provider fast; it stops one slow provider from
// costing every medication behind it in the queue its reminder.
//
// 60 is the Hobby maximum. If a build ever rejects this value, the error
// names the cap for the current plan — lower it to that, don't delete it.
export const config = { maxDuration: 60 };

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: RequestHandler = async ({ request }) => {
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) error(500, "CRON_SECRET not configured");
  const authHeader = request.headers.get("authorization") ?? "";
  if (!safeCompare(authHeader, `Bearer ${cronSecret}`)) {
    error(401, "Unauthorized");
  }
  await checkOverdueMedications();
  await checkLowInventoryMedications();

  // Clean up expired password reset tokens
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, new Date()));

  // Clean up expired rate limit entries
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()));

  // Purge reminder_events past the retention window (see retention.ts).
  await purgeExpiredReminderEvents(new Date());

  return json({ ok: true });
};
