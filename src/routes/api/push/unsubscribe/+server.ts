import { json, error } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { pushSubscriptions } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import type { RequestHandler } from "@sveltejs/kit";

const unsubscribeSchema = z.object({ endpoint: z.string().url().max(2048) });

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) throw error(401);

  const parsed = unsubscribeSchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid request");

  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, locals.user.id),
        eq(pushSubscriptions.endpoint, parsed.data.endpoint),
      ),
    );

  return json({ success: true });
};
