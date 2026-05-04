import { json, error } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { pushSubscriptions } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { pushSubscriptionSchema } from "$lib/utils/validation";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "@sveltejs/kit";

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401);
  const userId = locals.user.id;

  const { allowed } = await checkRateLimit(`push-sub:${userId}`, 10, 60_000);
  if (!allowed) throw error(429, "Too many requests");

  const body = await request.json();
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) throw error(400, "Invalid subscription");

  const { endpoint, keys } = parsed.data;

  // Atomic upsert: INSERT, and on unique conflict only UPDATE when the
  // existing row already belongs to the current user. If a different
  // user owns the endpoint the conflict's WHERE filters the UPDATE out
  // so RETURNING produces no row — that's the conflict signal.
  //
  // SELECT-then-INSERT cannot solve this race in PostgreSQL because
  // SELECT ... FOR UPDATE does not place a gap lock on a missing row,
  // so two concurrent inserts of the same endpoint can both pass the
  // ownership check. Pushing the ownership filter into the conflict
  // clause makes it a single atomic statement.
  const upsert = await db
    .insert(pushSubscriptions)
    .values({
      id: createId(),
      userId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth },
      where: eq(pushSubscriptions.userId, userId),
    })
    .returning({ id: pushSubscriptions.id });

  if (upsert.length === 0) {
    throw error(409, "Endpoint already registered");
  }

  return json({ success: true });
};
