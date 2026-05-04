import { json, error } from "@sveltejs/kit";
import { dbTx } from "$lib/server/db";
import { pushSubscriptions } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { pushSubscriptionSchema } from "$lib/utils/validation";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import type { RequestHandler } from "@sveltejs/kit";

class EndpointConflictError extends Error {
  constructor() {
    super("endpoint_conflict");
  }
}

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401);
  const userId = locals.user.id;

  const { allowed } = await checkRateLimit(`push-sub:${userId}`, 10, 60_000);
  if (!allowed) throw error(429, "Too many requests");

  const body = await request.json();
  const parsed = pushSubscriptionSchema.safeParse(body);
  if (!parsed.success) throw error(400, "Invalid subscription");

  const { endpoint, keys } = parsed.data;

  // Wrap ownership check + upsert in a single transaction so a concurrent
  // request from another user cannot insert the same endpoint between
  // SELECT and INSERT and produce a row with one user's id but another
  // user's keys. SELECT ... FOR UPDATE locks the existing row, if any.
  try {
    await dbTx.transaction(async (tx) => {
      const existing = await tx
        .select({ userId: pushSubscriptions.userId })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, endpoint))
        .for("update")
        .limit(1);

      if (existing.length > 0 && existing[0].userId !== userId) {
        throw new EndpointConflictError();
      }

      await tx
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
        });
    });
  } catch (err) {
    if (err instanceof EndpointConflictError) {
      throw error(409, "Endpoint already registered");
    }
    throw err;
  }

  return json({ success: true });
};
