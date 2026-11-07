import { fail, redirect } from "@sveltejs/kit";
import { createId } from "@paralleldrive/cuid2";
import { LIMITS, enforceLimit } from "$lib/server/auth/rate-limit";
import { hashToken } from "$lib/server/auth/token";
import { db } from "$lib/server/db";
import { users, passwordResetTokens } from "$lib/server/db/schema";
import { sendPasswordResetEmail } from "$lib/server/email";
import { eq } from "drizzle-orm";
import type { Actions, PageServerLoad } from "./$types";
import { logWarn } from "$lib/server/log";

export const load: PageServerLoad = async ({ locals, url }) => {
  // The emailed link lands here with `?token=`. Forward it to the confirm
  // page BEFORE the signed-in check: a reset link opened in a browser that
  // is already signed in (the common case on a phone) used to be sent to
  // /dashboard with the token dropped, so the link silently did nothing.
  // The confirm page validates the token itself and accepts signed-in users.
  const token = url.searchParams.get("token");
  if (token) redirect(302, `/auth/reset-password/confirm?token=${encodeURIComponent(token)}`);

  // Only the "request a reset link" form is pointless while signed in.
  if (locals.user) redirect(302, "/dashboard");
};

export const actions: Actions = {
  default: async ({ request, getClientAddress }) => {
    const ip = getClientAddress();
    const { allowed, retryAfterMs } = await enforceLimit(LIMITS.passwordReset, ip);
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
      await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));

      const token = crypto.randomUUID();
      const tokenHash = await hashToken(token);
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.insert(passwordResetTokens).values({
        id: createId(),
        userId: user.id,
        tokenHash,
        expiresAt,
      });

      // sendPasswordResetEmail derives the base URL from PUBLIC_BASE_URL
      // only — never from request headers — so the link can't be poisoned.
      const result = await sendPasswordResetEmail(user.email, token);
      if (!result.ok) {
        // Log the typed reason but never the token; the response is
        // still "success" so we don't reveal whether the email exists.
        logWarn("password reset email skipped", {
          scope: "auth.resetPassword",
          reason: result.reason,
          detail: result.message,
        });
      }
    }

    // Always return success — don't reveal whether the email exists
    return { success: true };
  },
};
