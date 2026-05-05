import { fail } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { notificationSchema } from "$lib/utils/validation";
import { logAudit, computeChanges } from "$lib/server/audit";
import { getVapidPublicKey } from "$lib/server/push";
import { isEmailConfigured } from "$lib/server/email";
import { db } from "$lib/server/db";
import { users } from "$lib/server/db/schema";
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
    const updated = await updatePreferences(locals.user!.id, parsed.data);

    const changes = computeChanges(
      {
        emailReminders: before.emailReminders,
        lowInventoryAlerts: before.lowInventoryAlerts,
      },
      {
        emailReminders: updated.emailReminders,
        lowInventoryAlerts: updated.lowInventoryAlerts,
      },
    );
    if (changes)
      await logAudit(locals.user!.id, "user_preferences", locals.user!.id, "update", changes);

    return { success: true };
  },
};
