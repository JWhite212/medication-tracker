import { fail, redirect } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { loginSchema } from "$lib/utils/validation";
import { verifyPassword } from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
import { eq } from "drizzle-orm";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { hasOAuthProviders } from "$lib/server/auth/oauth";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(302, "/dashboard");
  const oauthError = url.searchParams.get("error");
  return { hasOAuth: hasOAuthProviders(), oauthError };
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const ip = getClientAddress();
    const { allowed, retryAfterMs } = await checkRateLimit(`login:${ip}`);
    if (!allowed) {
      return fail(429, {
        errors: {
          form: [`Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`],
        },
      });
    }

    const formData = Object.fromEntries(await request.formData());
    const parsed = loginSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
      });
    }

    const { email, password } = parsed.data;

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.passwordHash) {
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    const validPassword = await verifyPassword(user.passwordHash, password);
    if (!validPassword) {
      await logAudit(user.id, "session", "n/a", "failed_login");
      return fail(400, {
        errors: { form: ["Invalid email or password"] },
        email,
      });
    }

    // If 2FA is enabled, redirect to TOTP verification
    if (user.twoFactorEnabled) {
      cookies.set("pending_2fa", user.id, {
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
