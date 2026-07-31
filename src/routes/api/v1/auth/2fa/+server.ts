import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { z } from "zod";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { verifyPreAuthToken } from "$lib/server/api/preauth";
import { readJson } from "$lib/server/api/read-json";
import { verifyAndConsumeTOTPCode } from "$lib/server/auth/totp";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { lucia } from "$lib/server/auth/lucia";
import { toSessionUser } from "$lib/server/api/serialize";

const body = z.object({ preAuthToken: z.string(), code: z.string().regex(/^\d{6}$/) });

export const POST: RequestHandler = async ({ request }) => {
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) throw error(400, "Invalid payload");

  const claims = verifyPreAuthToken(parsed.data.preAuthToken);
  if (!claims) throw error(401, "Challenge expired — sign in again");

  // Wrong codes are otherwise free to guess: the TOTP step counter only
  // advances on success, so cap verification attempts per user.
  const { allowed, retryAfterMs } = await checkRateLimit(`2fa:${claims.userId}`, 5, 15 * 60 * 1000);
  if (!allowed) {
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    return json(
      { error: "rate_limited", retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    );
  }

  const ok = await verifyAndConsumeTOTPCode(claims.userId, parsed.data.code);
  if (!ok) throw error(401, "Invalid code");

  // Burn the token's jti atomically (maxAttempts=1 against the
  // rate-limit ledger): a captured pre-auth token cannot mint a second
  // session after a successful login.
  const consumeWindowMs = Math.max(claims.exp - Date.now(), 1000);
  const consumed = await checkRateLimit(`preauth:${claims.jti}`, 1, consumeWindowMs);
  if (!consumed.allowed) throw error(401, "Challenge expired — sign in again");

  const [user] = await db.select().from(users).where(eq(users.id, claims.userId)).limit(1);
  if (!user) throw error(401, "Unknown user");

  const session = await lucia.createSession(user.id, {});
  return json({ token: session.id, user: toSessionUser(user) });
};
