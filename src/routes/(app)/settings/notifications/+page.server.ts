import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { notificationSchema } from "$lib/utils/validation";
import { logAudit, computeChanges } from "$lib/server/audit";
import { getVapidPublicKey } from "$lib/server/push";
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
  };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const formData = Object.fromEntries(await request.formData());
    const parsed = notificationSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    const before = await getOrCreatePreferences(locals.user!.id);
    // Dual-write the legacy columns until they are dropped (one prod
    // cycle after this PR). If a rollback happens before then, the
    // previous release reads `email_reminders` / `low_inventory_alerts`
    // and these mirror the user's most recent split-prefs choice.
    const updated = await updatePreferences(locals.user!.id, {
      ...parsed.data,
      emailReminders: parsed.data.overdueEmailReminders,
      lowInventoryAlerts: parsed.data.lowInventoryEmailAlerts,
    });

    const changes = computeChanges(
      {
        overdueEmailReminders: before.overdueEmailReminders,
        overduePushReminders: before.overduePushReminders,
        lowInventoryEmailAlerts: before.lowInventoryEmailAlerts,
        lowInventoryPushAlerts: before.lowInventoryPushAlerts,
      },
      {
        overdueEmailReminders: updated.overdueEmailReminders,
        overduePushReminders: updated.overduePushReminders,
        lowInventoryEmailAlerts: updated.lowInventoryEmailAlerts,
        lowInventoryPushAlerts: updated.lowInventoryPushAlerts,
      },
    );
    if (changes)
      await logAudit(locals.user!.id, "user_preferences", locals.user!.id, "update", changes);

    return { success: true };
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
