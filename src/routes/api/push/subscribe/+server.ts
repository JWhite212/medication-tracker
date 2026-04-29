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

  const { allowed } = await checkRateLimit(`push-sub:${locals.user.id}`, 10, 60_000);
  if (!allowed) throw error(429, "Too many requests");

  const body = await request.json();
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) throw error(400, "Invalid subscription");

  const { endpoint, keys } = parsed.data;

  // Reject if endpoint already belongs to a different user
  const existing = await db
    .select({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .limit(1);

  if (existing.length > 0 && existing[0].userId !== locals.user.id) {
    throw error(409, "Endpoint already registered");
  }

  await db
    .insert(pushSubscriptions)
    .values({
      id: createId(),
      userId: locals.user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: keys.p256dh, auth: keys.auth },
    });

  return json({ success: true });
};
