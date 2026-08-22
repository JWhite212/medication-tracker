import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { timingSafeEqual } from "crypto";
import { lt } from "drizzle-orm";
import { checkOverdueMedications, checkLowInventoryMedications } from "$lib/server/reminders";
import { pingHeartbeat } from "$lib/server/heartbeat";
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
const MAX_DURATION_SECONDS = 60;
export const config = { maxDuration: MAX_DURATION_SECONDS };

// Headroom left unspent so the response can be serialised and returned
// inside the limit. Without it the heartbeat could spend the last of the
// budget and have the platform record a tick that successfully sent
// every reminder as a failed request — a false alarm that sends whoever
// is debugging it looking in entirely the wrong place.
const RESPONSE_RESERVE_MS = 1500;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: RequestHandler = async ({ request }) => {
  const startedAt = Date.now();
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

  // Last, and only on the success path. Everything above either awaited
  // cleanly or threw out of this handler, so reaching this line is the
  // strongest health signal the system produces: it proves the database
  // is reachable and writable and that the reminder sweeps completed,
  // which no unauthenticated liveness probe can establish.
  const budgetMs = MAX_DURATION_SECONDS * 1000 - (Date.now() - startedAt) - RESPONSE_RESERVE_MS;
  const heartbeat = await pingHeartbeat({ budgetMs });

  return json({ ok: true, heartbeat: heartbeat.status });
};
