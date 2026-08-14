import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { notificationSchema } from "$lib/utils/validation";
import {
  getVapidPublicKey,
  getPushHealth,
  sendTestPush,
  describeTestPushResult,
} from "$lib/server/push";
import { isEmailConfigured, sendVerificationEmail } from "$lib/server/email";
import { checkRateLimit } from "$lib/server/auth/rate-limit";
import { db } from "$lib/server/db";
import { users, emailVerificationTokens } from "$lib/server/db/schema";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const prefs = await getOrCreatePreferences(locals.user!.id);
  // Re-read emailVerified directly so a same-session verification
  // (token consumed in another tab) is reflected without requiring a
  // logout. locals.user is populated at session-create time and may
  // be stale.
  const [user] = await db
    .select({ emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, locals.user!.id))
    .limit(1);

  return {
    preferences: prefs,
    vapidPublicKey: getVapidPublicKey(),
    emailVerified: user?.emailVerified ?? false,
    emailConfigured: isEmailConfigured(),
    pushHealth: await getPushHealth(locals.user!.id),
  };
};

export const actions: Actions = {
  // SvelteKit rejects a `default` action when ANY named action is
  // also defined — the resendVerification action below makes this
  // page named-only, so the Save Changes form targets `?/savePrefs`
  // explicitly. Previously the default coexistence threw a 500 on
  // every POST. https://svelte.dev/docs/kit/form-actions#named-actions
  savePrefs: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = notificationSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    await updatePreferences(locals.user!.id, parsed.data);

    return { success: true };
  },

  /**
   * Fire a test push to every device the user has registered, so they
   * can confirm delivery without waiting for a real dose to fall due.
   *
   * Rate-limited per user: the action needs no input, so without a limit
   * it would be a one-click way to flood a user's own devices, and an
   * authenticated amplifier against the push services.
   */
  sendTest: async ({ locals }) => {
    const userId = locals.user!.id;
    const { allowed, retryAfterMs } = await checkRateLimit(
      `push-test:${userId}`,
      5,
      15 * 60 * 1000,
    );
    if (!allowed) {
      return fail(429, {
        testError: `Too many test notifications. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    const result = await sendTestPush(userId);
    const { ok, message } = describeTestPushResult(result);

    if (!ok) {
      // The provider's own error text stays in the logs; only the
      // categorised message from describeTestPushResult goes back to
      // the browser.
      if (!result.ok) {
        console.warn(`test push failed (${result.reason}): ${result.message}`);
      }
      const status =
        !result.ok && result.reason === "not_configured"
          ? 503
          : !result.ok && result.reason === "no_subscriptions"
            ? 400
            : 502;
      return fail(status, { testError: message });
    }

    return { testOk: true, testMessage: message };
  },

  /**
   * Re-send the verification email for the current user. Replaces a
   * misleading link to /auth/verify (which only consumes tokens, never
   * issues them). Rate-limited per user to prevent abuse.
   */
  resendVerification: async ({ locals }) => {
    const userId = locals.user!.id;
    const { allowed, retryAfterMs } = await checkRateLimit(
      `email-resend:${userId}`,
      3,
      15 * 60 * 1000,
    );
    if (!allowed) {
      return fail(429, {
        resendError: `Too many requests. Try again in ${Math.ceil(retryAfterMs / 60000)} minutes.`,
      });
    }

    const [user] = await db
      .select({ id: users.id, email: users.email, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return fail(404, { resendError: "User not found." });
    if (user.emailVerified) return { resendOk: true, alreadyVerified: true };

    // Invalidate prior unconsumed tokens for this user before issuing a
    // new one so the most recent email always wins.
    await db.delete(emailVerificationTokens).where(eq(emailVerificationTokens.userId, userId));

    const rawToken = crypto.randomUUID();
    const tokenHash = encodeHexLowerCase(sha256(new TextEncoder().encode(rawToken)));
    await db.insert(emailVerificationTokens).values({
      id: createId(),
      userId,
      tokenHash,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const result = await sendVerificationEmail(user.email, rawToken);
    if (!result.ok) {
      console.warn(`resend verification email failed (${result.reason}): ${result.message}`);
      return fail(500, {
        resendError: "Could not send the verification email. Please try again later.",
      });
    }
    return { resendOk: true, alreadyVerified: false };
  },
};
