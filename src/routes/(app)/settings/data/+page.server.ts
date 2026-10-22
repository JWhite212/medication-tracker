import { error, fail, redirect } from "@sveltejs/kit";
import { count, eq } from "drizzle-orm";
import { db } from "$lib/server/db";
import { doseLogs, medications, users } from "$lib/server/db/schema";
import { getOrCreatePreferences, updatePreferences } from "$lib/server/preferences";
import { dataSchema } from "$lib/utils/validation";
import { logAudit } from "$lib/server/audit";
import { lucia } from "$lib/server/auth/lucia";
import {
  destructiveConfirmation,
  checkDestructiveGuard,
  signedInFrom,
} from "$lib/server/auth/destructive-guard";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
  const userId = locals.user!.id;
  // The counts are what the account-deletion dialog says goes with it.
  const [prefs, medicationRow, doseRow, confirmation] = await Promise.all([
    getOrCreatePreferences(userId),
    db.select({ value: count() }).from(medications).where(eq(medications.userId, userId)),
    db.select({ value: count() }).from(doseLogs).where(eq(doseLogs.userId, userId)),
    destructiveConfirmation(signedInFrom(locals)),
  ]);
  return {
    preferences: prefs,
    counts: { medications: medicationRow[0]?.value ?? 0, doses: doseRow[0]?.value ?? 0 },
    confirmation,
  };
};

export const actions: Actions = {
  updateFormat: async ({ request, locals }) => {
    // Form actions run BEFORE layout load functions, so the (app) group's
    // auth guard has not executed at this point. Without this check an
    // anonymous POST reaches `locals.user!.id` and 500s.
    if (!locals.user) error(401, "Unauthorized");

    const formData = Object.fromEntries(await request.formData());
    const parsed = dataSchema.safeParse(formData);
    if (!parsed.success) return fail(400, { errors: parsed.error.flatten().fieldErrors });

    await updatePreferences(locals.user!.id, parsed.data);

    return { success: true };
  },

  deleteAccount: async ({ request, locals, cookies }) => {
    if (!locals.user) error(401, "Unauthorized");
    const userId = locals.user.id;
    const formData = await request.formData();
    const guard = await checkDestructiveGuard(signedInFrom(locals), formData, {
      word: "DELETE",
      purpose: "delete_account",
    });
    if (!guard.ok) return fail(400, { error: guard.error });

    await logAudit(userId, "user", userId, "delete");
    await lucia.invalidateUserSessions(userId);
    await db.delete(users).where(eq(users.id, userId));
    const sessionCookie = lucia.createBlankSessionCookie();
    cookies.set(sessionCookie.name, sessionCookie.value, {
      path: ".",
      ...sessionCookie.attributes,
    });
    redirect(302, "/");
  },
};
