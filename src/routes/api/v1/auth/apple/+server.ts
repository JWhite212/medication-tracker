import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db, dbTx } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { lucia } from "$lib/server/auth/lucia";
import { verifyAppleIdentityToken } from "$lib/server/api/apple";
import { toSessionUser } from "$lib/server/api/serialize";

const PROVIDER = "apple";
const body = z.object({
  identityToken: z.string().min(1),
  fullName: z.string().max(200).optional(),
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid payload");

  const identity = await verifyAppleIdentityToken(parsed.data.identityToken).catch(() => null);
  if (!identity) throw error(401, "Invalid Apple token");

  // 1. existing link → sign in
  const [link] = await db
    .select()
    .from(oauthAccounts)
    .where(
      and(
        eq(oauthAccounts.provider, PROVIDER),
        eq(oauthAccounts.providerUserId, identity.appleUserId),
      ),
    )
    .limit(1);
  if (link) {
    const [u] = await db.select().from(users).where(eq(users.id, link.userId)).limit(1);
    const session = await lucia.createSession(u.id, {});
    return json({ token: session.id, user: toSessionUser(u) });
  }

  // 2. email collision with a non-Apple account → refuse to auto-link
  if (identity.email) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, identity.email.toLowerCase()))
      .limit(1);
    if (existing) throw error(409, "email_conflict");
  }

  // 3. create fresh account + link
  const userId = createId();
  const email = identity.email?.toLowerCase() ?? `${identity.appleUserId}@privaterelay.appleid.com`;
  await dbTx.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email,
      name: parsed.data.fullName ?? "Apple User",
      passwordHash: null,
      emailVerified: identity.emailVerified,
      avatarUrl: null,
    });
    await tx
      .insert(oauthAccounts)
      .values({ provider: PROVIDER, providerUserId: identity.appleUserId, userId });
  });
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const session = await lucia.createSession(userId, {});
  return json({ token: session.id, user: toSessionUser(u) });
};
