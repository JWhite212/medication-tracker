import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPreAuthToken } from "$lib/server/api/preauth";
import { verifyAndConsumeTOTPCode } from "$lib/server/auth/totp";
import { lucia } from "$lib/server/auth/lucia";
import { toSessionUser } from "$lib/server/api/serialize";

const body = z.object({ preAuthToken: z.string(), code: z.string().regex(/^\d{6}$/) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid payload");

  const userId = verifyPreAuthToken(parsed.data.preAuthToken);
  if (!userId) throw error(401, "Challenge expired — sign in again");

  const ok = await verifyAndConsumeTOTPCode(userId, parsed.data.code);
  if (!ok) throw error(401, "Invalid code");

  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw error(401, "Unknown user");

  const session = await lucia.createSession(user.id, {});
  return json({ token: session.id, user: toSessionUser(user) });
};
