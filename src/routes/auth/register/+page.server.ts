import { fail, redirect } from "@sveltejs/kit";
import { createId } from "@paralleldrive/cuid2";
import { registerSchema } from "$lib/utils/validation";
import { hashPassword } from "$lib/server/auth/password";
import { lucia } from "$lib/server/auth/lucia";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { db } from "$lib/server/db";
import { users, emailVerificationTokens } from "$lib/server/db/schema";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sendVerificationEmail } from "$lib/server/email";
import { eq } from "drizzle-orm";
import { logAudit } from "$lib/server/audit";
import type { Actions, PageServerLoad } from "./$types";

async function isPasswordBreached(password: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  const prefix = hashHex.slice(0, 5);
  const suffix = hashHex.slice(5);

  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  const text = await response.text();
  return text.split("\n").some((line) => line.startsWith(suffix));
}

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, "/dashboard");
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const ip = getClientAddress();
    const { allowed, retryAfterMs } = await checkRateLimit(`register:${ip}`, 5, 15 * 60 * 1000);
    if (!allowed) {
      return fail(429, {
        errors: {
          form: [`Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`],
        },
      });
    }

    const formData = Object.fromEntries(await request.formData());
    const parsed = registerSchema.safeParse(formData);

    if (!parsed.success) {
      return fail(400, {
        errors: parsed.error.flatten().fieldErrors,
        email: String(formData.email ?? ""),
        name: String(formData.name ?? ""),
      });
    }

    const { email, password, name } = parsed.data;

    if (await isPasswordBreached(password)) {
      return fail(400, {
        errors: {
          password: ["This password has appeared in a data breach. Please choose a different one."],
        },
        email,
        name,
      });
    }

    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (existing.length > 0) {
      return fail(400, {
        errors: { email: ["An account with this email already exists"] },
        email,
        name,
      });
    }

    const userId = createId();
    const passwordHash = await hashPassword(password);

    await db.insert(users).values({
      id: userId,
      email,
      name,
      passwordHash,
    });

    await logAudit(userId, "user", userId, "create");

    // Send email verification (non-blocking — failure doesn't prevent registration)
    try {
      const rawToken = crypto.randomUUID();
      const tokenHash = encodeHexLowerCase(sha256(new TextEncoder().encode(rawToken)));
      await db.insert(emailVerificationTokens).values({
        id: createId(),
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      await sendVerificationEmail(email, rawToken);
    } catch {
      // Email verification failure should not block registration
    }

    const session = await lucia.createSession(userId, {});
    const sessionCookie = lucia.createSessionCookie(session.id);
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });

    redirect(302, "/dashboard");
  },
};
