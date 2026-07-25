import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { loginSchema } from "$lib/utils/validation";
import { verifyPassword } from "$lib/server/auth/password";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { lucia } from "$lib/server/auth/lucia";
import { signPreAuthToken } from "$lib/server/api/preauth";

// Inlined until Task 9's `toSessionUser` (src/lib/server/api/serialize.ts)
// lands — refactor this route to use it once that exists.
const toSessionUser = (u: typeof users.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  avatarUrl: u.avatarUrl,
  timezone: u.timezone,
  twoFactorEnabled: u.twoFactorEnabled,
  emailVerified: u.emailVerified,
});

export const POST: RequestHandler = async ({ request }) => {
  const parsed = loginSchema.safeParse(await request.json());
  if (!parsed.success) throw error(400, "Invalid credentials payload");
  const email = parsed.data.email.toLowerCase().trim();

  const { allowed, retryAfterMs } = await checkRateLimit(`api-login:${email}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, parsed.data.password)
    : false;
  if (!user || !ok) throw error(401, "Invalid email or password");

  if (user.twoFactorEnabled) {
    return json({ challenge: "totp", preAuthToken: signPreAuthToken(user.id) });
  }

  const session = await lucia.createSession(user.id, {});
  return json({ token: session.id, user: toSessionUser(user) });
};
