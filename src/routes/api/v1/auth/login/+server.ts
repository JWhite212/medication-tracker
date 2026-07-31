import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "@sveltejs/kit";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { loginSchema } from "$lib/utils/validation";
import {
  verifyPassword,
  verifyDummyPassword,
  needsRehash,
  hashPassword,
} from "$lib/server/auth/password";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { readJson } from "$lib/server/api/read-json";
import { rateLimitedResponse } from "$lib/server/api/rate-limit-response";
import { lucia } from "$lib/server/auth/lucia";
import { signPreAuthToken } from "$lib/server/api/preauth";
import { toSessionUser } from "$lib/server/api/serialize";
import { logAudit } from "$lib/server/audit";

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) throw error(400, "Invalid credentials payload");
  const email = parsed.data.email.toLowerCase().trim();

  // Per-IP first (throttles spraying across many emails from one
  // source), then per-email (throttles a distributed attack on one
  // account). The IP budget is looser: shared NATs are legitimate.
  const byIp = await checkRateLimit(`api-login-ip:${getClientAddress()}`, 10, 15 * 60 * 1000);
  if (!byIp.allowed) return rateLimitedResponse(byIp.retryAfterMs);
  const byEmail = await checkRateLimit(`api-login:${email}`, 5, 15 * 60 * 1000);
  if (!byEmail.allowed) return rateLimitedResponse(byEmail.retryAfterMs);

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Unknown or password-less (OAuth-only) accounts still burn an Argon2
  // verify so response timing cannot enumerate registered emails. No
  // audit row here: there is no user id to attribute a failed_login to
  // for an unknown email, and this matches the web login action.
  if (!user || !user.passwordHash) {
    await verifyDummyPassword(parsed.data.password);
    throw error(401, "Invalid email or password");
  }

  const ok = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!ok) {
    await logAudit(user.id, "session", "n/a", "failed_login");
    throw error(401, "Invalid email or password");
  }

  // Transparent Argon2 parameter upgrade — same as the web login: this
  // is the only moment the plaintext is available.
  if (needsRehash(user.passwordHash)) {
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(parsed.data.password) })
      .where(eq(users.id, user.id));
  }

  if (user.twoFactorEnabled) {
    return json({ challenge: "totp", preAuthToken: signPreAuthToken(user.id) });
  }

  const session = await lucia.createSession(user.id, {});
  return json({ token: session.id, user: toSessionUser(user) });
};
