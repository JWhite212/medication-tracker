import { sql } from "drizzle-orm";
import { db } from "$lib/server/db";
import { rateLimits } from "$lib/server/db/schema";

export async function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const windowEnd = new Date(Date.now() + windowMs);

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: windowEnd })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE
          WHEN ${rateLimits.resetAt} < NOW() THEN 1
          ELSE ${rateLimits.count} + 1
        END`,
        resetAt: sql`CASE
          WHEN ${rateLimits.resetAt} < NOW() THEN ${windowEnd}
          ELSE ${rateLimits.resetAt}
        END`,
      },
    })
    .returning();

  const retryAfterMs = Math.max(0, row.resetAt.getTime() - Date.now());
  return { allowed: row.count <= maxAttempts, retryAfterMs };
}

export async function resetRateLimit(key: string): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
}
