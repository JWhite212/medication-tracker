import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { users, oauthAccounts } from "$lib/server/db/schema";
import { and, eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { lucia } from "$lib/server/auth/lucia";
import { verifyAppleIdentityToken } from "$lib/server/api/apple";

const PROVIDER = "apple";
const body = z.object({
  identityToken: z.string().min(1),
  fullName: z.string().max(200).optional(),
});

// Inlined until Task 9's `toSessionUser` (src/lib/server/api/serialize.ts)
// lands — refactor this route to use it once that exists.
const projectUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  timezone: u.timezone,
  twoFactorEnabled: u.twoFactorEnabled,
  emailVerified: u.emailVerified,
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
    return json({ token: session.id, user: projectUser(u) });
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
  await db.insert(users).values({
    id: userId,
    email,
    name: parsed.data.fullName ?? "Apple User",
    passwordHash: null,
    emailVerified: identity.emailVerified,
    avatarUrl: null,
  });
  await db
    .insert(oauthAccounts)
    .values({ provider: PROVIDER, providerUserId: identity.appleUserId, userId });
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const session = await lucia.createSession(userId, {});
  return json({ token: session.id, user: projectUser(u) });
};
