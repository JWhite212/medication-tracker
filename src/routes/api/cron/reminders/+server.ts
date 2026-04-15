import { json, error } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { lt } from "drizzle-orm";
import { checkOverdueMedications } from "$lib/server/reminders";
import { db } from "$lib/server/db";
import { passwordResetTokens, rateLimits } from "$lib/server/db/schema";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
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
