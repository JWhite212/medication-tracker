import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { timingSafeEqual } from "crypto";
import { lt } from "drizzle-orm";
import { checkOverdueMedications } from "$lib/server/reminders";
import { db } from "$lib/server/db";
import { passwordResetTokens, rateLimits } from "$lib/server/db/schema";
import type { RequestHandler } from "./$types";

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

  // Clean up expired password reset tokens
  await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, new Date()));

  // Clean up expired rate limit entries
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, new Date()));

  return json({ ok: true });
};
