import { fail, redirect } from "@sveltejs/kit";
import { createId } from "@paralleldrive/cuid2";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { db } from "$lib/server/db";
import { users, passwordResetTokens } from "$lib/server/db/schema";
import { sendPasswordResetEmail } from "$lib/server/email";
import { eq } from "drizzle-orm";
import type { Actions, PageServerLoad } from "./$types";

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const load: PageServerLoad = async ({ locals, url }) => {
  if (locals.user) redirect(302, "/dashboard");

  // If a token is present (email link lands here), forward to confirm page
  const token = url.searchParams.get("token");
  if (token) redirect(302, `/auth/reset-password/confirm?token=${token}`);
};

export const actions: Actions = {
  default: async ({ request, url, getClientAddress }) => {
    const ip = getClientAddress();
    const { allowed, retryAfterMs } = await checkRateLimit(
      `reset:${ip}`,
      3,
      15 * 60 * 1000,
    );
    if (!allowed) {
      return fail(429, {
        error: `Too many attempts. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    const formData = await request.formData();
    const email = String(formData.get("email") ?? "")
      .trim()
      .toLowerCase();

    if (!email) {
      return fail(400, { error: "Email is required." });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user) {
      // Delete any existing tokens for this user
      await db
        .delete(passwordResetTokens)
        .where(eq(passwordResetTokens.userId, user.id));

      const token = crypto.randomUUID();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(passwordResetTokens).values({
        id: createId(),
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      const baseUrl = url.origin;
      await sendPasswordResetEmail(user.email, token, baseUrl);
    }

    // Always return success — don't reveal whether the email exists
    return { success: true };
  },
};
