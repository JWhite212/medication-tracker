import { fail, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { loginSchema } from "$lib/utils/validation";
import {
  verifyPassword,
  verifyDummyPassword,
  needsRehash,
  hashPassword,
} from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { LIMITS, enforceLimit, peekLimit, recordFailure } from "$lib/server/auth/rate-limit";
import { hasOAuthProviders } from "$lib/server/auth/oauth";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";
import { signPreAuthToken } from "$lib/server/api/preauth";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(302, "/dashboard");
  const oauthError = url.searchParams.get("error");
  return { hasOAuth: hasOAuthProviders(), oauthError };
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const ip = getClientAddress();
    const tooBusy = (retryAfterMs: number) =>
      fail(429, {
        errors: {
          form: [`Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`],
        },
      });

    // Volume, by address. Cheap for an attacker to rotate, which is exactly
    // why it was never sufficient on its own — see the account budget below.
    const byIp = await enforceLimit(LIMITS.loginIp, ip);
    if (!byIp.allowed) return tooBusy(byIp.retryAfterMs);

    const formData = Object.fromEntries(await request.formData());
    const parsed = loginSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
      });
    }

    const { email, password } = parsed.data;

    // Guessing, by account. This door had NOTHING here, so an attacker with
    // a pool of addresses had an unlimited budget against any known email —
    // and the address is the one part of the request they control freely.
    //
    // PEEK, not spend: the budget is consumed by failures only (below), so a
    // correct password never counts and there is no lockout to hand to
    // anyone who knows the address.
    const byAccount = await peekLimit(LIMITS.loginAccount, email);
    if (!byAccount.allowed) return tooBusy(byAccount.retryAfterMs);

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.passwordHash) {
      // Unknown or password-less accounts still burn an Argon2 verify
      // so response timing cannot enumerate registered emails. The failure
      // is counted for the same reason: a budget spent only on real accounts
      // would answer "does this email exist?" through the 429.
      await verifyDummyPassword(password);
      await recordFailure(LIMITS.loginAccount, email);
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    const validPassword = await verifyPassword(user.passwordHash, password);
    if (!validPassword) {
      await logAudit(user.id, "session", "n/a", "failed_login");
      await recordFailure(LIMITS.loginAccount, email);
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    // Transparent Argon2 parameter upgrade: if the stored hash was
    // created with older cost settings, re-hash now — the only moment
    // the plaintext is available.
    if (needsRehash(user.passwordHash)) {
      await db
        .update(users)
        .set({ passwordHash: await hashPassword(password) })
        .where(eq(users.id, user.id));
    }

    // If 2FA is enabled, redirect to TOTP verification
    if (user.twoFactorEnabled) {
      // A SIGNED claim, not the raw id — the id alone is forgeable, and
      // /auth/2fa would then mint a session for anyone holding a code. The
      // token's own TTL matches this cookie's maxAge.
      cookies.set("pending_2fa", signPreAuthToken(user.id), {
        path: "/",
        maxAge: 300,
        httpOnly: true,
        secure: !dev,
        sameSite: "lax",
      });
      redirect(302, "/auth/2fa");
    }

    const session = await lucia.createSession(user.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    await logAudit(user.id, "session", session.id, "create");
    redirect(302, "/dashboard");
  },
};
